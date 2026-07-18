# NeuraTalk — P0 Production Recovery Report

Scope: resolve every launch blocker found during the live production audit of `https://neuratalk.in`. No new features, no unrelated refactors. Two code fixes were made (`/readyz`, `/metrics`); everything else is root-cause analysis and operator actions.

---

## P0-1 — `/readyz` returns HTTP 504 in production

**Root cause: application-level, triggering a proxy-level symptom.** The handler ran five dependency checks — database, auth-schema, Redis, provider-env, MSG91 — **sequentially**, each `await`ed in turn. The database and auth-schema checks had **no timeout at all**, and the MSG91 check had a broken timeout (outer race set to 4000ms, but the function it wrapped, `isMSG91Healthy()`, had its own internal 5000ms timeout — the outer race would always "win" first and misreport a timeout).

Worst case, and plausibly even typical case, sequential latency in production (DB + authSchema + Redis + provider-env + MSG91) could exceed 6–9 seconds. DigitalOcean App Platform's edge/Envoy proxy has its own upstream timeout; when the app takes too long to respond, the edge aborts the connection and returns exactly the observed message ("App Platform failed to forward this request to the application... via_upstream") — a **proxy-layer 504**, not a crash. This was corroborated locally: `/readyz` in dev mode (no MSG91/provider checks) already took 2.86s end-to-end, dominated by a 2.07s Neon Postgres round-trip with no explicit bound. `/healthz` and `/api/health` stayed up throughout the incident window per the prior audit, ruling out a process crash-loop.

**Classification:** Application logic bug (unbounded/sequential health checks), not infrastructure. The proxy timeout is a real platform constraint, but the fix belongs in the app.

**Fix applied** (`server/production-routes.ts`):
- All five checks now run concurrently via `Promise.all`, so total latency is bounded by the *slowest single check*, not their sum.
- Every check (DB, authSchema, Redis, MSG91) now has an explicit timeout via the existing `withTimeout` helper (3s each); DB and authSchema previously had none.
- Removed the redundant/broken outer timeout wrapper around MSG91 — `isMSG91Healthy()` already resolves safely within 5s and never throws.
- The `systemHealthLogs` diagnostic insert is now fire-and-forget instead of blocking the response.

**Verified locally:** ran the local dev server, hit `/readyz`, confirmed 200 with per-check latencies reported and no hang. Confirmed no new TypeScript errors (`tsc --noEmit`).

**Operator action required:** none to ship this fix. Recommended but optional: check the DO App Platform component's configured upstream/health-check timeout — if it is set unusually low (e.g. well under 3s), raise it slightly for margin, since Neon cold-start latency alone can approach 2s from some network paths.

---

## P0-2 — Razorpay reports `razorpay:false` in production

**Root cause: missing operator configuration, not a code or deployment-wiring bug.**

- `/api/health/keys` (`server/routes.ts:110`) reports `razorpay: has("RAZORPAY_KEY_ID") && has("RAZORPAY_KEY_SECRET")` — a direct, correct read of `process.env`. No caching, no stale state.
- `payment-service.ts`'s `getRazorpayClient()` returns `null` when either key is missing, and `createCheckoutOrder()` explicitly `throw`s `PAYMENT_GATEWAY_NOT_CONFIGURED` in that case — **confirmed no mock/fake payment fallback exists anywhere in the codebase.** The only test-injection seam (`__setTestRazorpayClient`) is explicitly commented "never set outside tests" and isn't reachable from any production code path.
- `.do/app.yaml` lists `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` / `RAZORPAY_WEBHOOK_SECRET` only inside a **comment block** instructing the operator to set them as encrypted secrets via the DO dashboard — they are not declared as real `envs:` entries the way other (non-secret) config values are. Nothing provisions them automatically.
- Confirmed locally: this checkout's `.env` has all three Razorpay keys present as empty strings.

**Conclusion:** the Razorpay secrets were simply never entered into the DO App Platform dashboard for the production app component.

**Operator checklist to enable Razorpay in production:**
1. Log into the Razorpay dashboard, generate **live-mode** (not test-mode) API keys.
2. In the DigitalOcean App Platform dashboard, open the app component → Settings → App-Level Environment Variables (or component-level, matching where other encrypted secrets live).
3. Add `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, and `RAZORPAY_WEBHOOK_SECRET` as **encrypted** secrets (never plaintext `envs:` in the committed yaml).
4. In the Razorpay dashboard, register the production webhook URL and copy the resulting webhook secret into `RAZORPAY_WEBHOOK_SECRET`.
5. Redeploy the app component so it picks up the new secrets.
6. Verify via `GET /api/health/keys` on production that `razorpay` flips to `true`.
7. Run one real low-value transaction end-to-end before declaring billing live.

No code change needed or made for this item.

---

## P3 — `/metrics` is publicly exposed with no authentication

**Audit finding:** confirmed `/metrics` was reachable with zero auth, returning Prometheus-format operational data (latency percentiles, queue depths, error counters, active-call counts, payment/voice-clone event counters). No PII or call content is in the payload, but it does reveal internal operational posture (e.g. error rates, queue backlogs) to anyone on the internet — useful reconnaissance for an attacker, and not appropriate for a production system.

**Fix applied** (`server/production-metrics.ts`): added a static bearer-token gate, the standard way to protect a Prometheus scrape endpoint (scrapers authenticate via a token in their scrape config, not a logged-in user session, so the existing session-based `role-middleware.ts` auth wasn't a fit).
- If `METRICS_TOKEN` env var is set, every request to `/metrics` must present it via `Authorization: Bearer <token>` or `?token=<token>` (constant-time comparison via `crypto.timingSafeEqual`); otherwise returns `401`.
- If `METRICS_TOKEN` is **not** set, the endpoint stays open (today's behavior, so nothing breaks on deploy) but logs one warning so operators notice.
- Observability itself is untouched — no metrics were removed or gated behind anything beyond this one shared token.

**Operator action required:** set `METRICS_TOKEN` (a long random value) as a secret in the DO dashboard, and configure the Prometheus/Grafana Agent scrape config to send it as a bearer token. Until this is set, `/metrics` remains open (same as before the fix) — this is a real, still-open item until the operator configures the token.

---

## P4 — Live call success/drop rate (40% success / 53.3% drop)

**How it's calculated** (`server/production-metrics.ts:84-89, 180-189`): a single cumulative, all-time SQL aggregate over `callBillingRecords` —
```
total   = count(*)
ended   = count(*) where status in ('completed','ended')
dropped = count(*) where status in ('dropped','failed')
```
with `neuratalk_call_success_rate = ended/total` and `neuratalk_call_drop_rate = dropped/total`.

**Key finding: the "dropped" status is never actually written anywhere in the codebase.** `finalizeCallSession()`'s type signature allows `"dropped"`, but no call site ever passes it. So the entire "drop rate" number is really a **"failed" rate** — calls where `initiateCall`/`initiateConference` threw during setup, or `endCall` was invoked with reason `"failed"`/`"PROVIDER_TIMEOUT"`. That's a labeling/terminology issue worth fixing later (rename the metric or start actually using a "dropped" status for true mid-call network drops), but since 40% + 53.3% ≈ 93% of records are terminal, this is **not** primarily a measurement artifact of stuck/abandoned records — most calls really are reaching a terminal "failed" state.

**Top contributing causes, traced from the actual throw sites that feed this status** (`server/modules/calls/smart-router.ts`):
- `PAYMENT_REQUIRED` (line 1063, 1341) — auth/balance check failing before a call can even be provisioned. This connects directly to **P0-2**: with Razorpay unconfigured in production, users who need to top up their wallet cannot, so calls that would otherwise proceed fail at the balance gate instead.
- `PSTN_NOT_CONFIGURED`, `APP_BASE_URL_REQUIRED_FOR_PSTN_WEBHOOKS`, `LIVEKIT_SIP_DOMAIN_REQUIRED_FOR_PSTN` (lines 1182-1188, 1473-1479) — PSTN/SIP call attempts failing fast because required config is missing or a webhook base URL isn't reachable. This connects directly to **P5**: LiveKit SIP env vars are present, but no live SIP call was ever placed to confirm the config actually works end-to-end in production (domain DNS, trunk provisioning, etc. can all be "configured" yet non-functional).
- `CONCURRENT_CALL_RESTRICTED` — a user already has an active call; expected/benign under normal use but still counts toward "failed" in this metric, further muddying the label.

**Classification:** partially real production failures (payment-gated calls, PSTN/SIP calls that fail fast on missing/unverified config), and partially a **metric-definition problem** (mislabeled "drop rate," lumping benign rejections like `CONCURRENT_CALL_RESTRICTED` in with genuine failures). No code change made here per the "don't build new features" scope — this is reported as findings; recommend a follow-up ticket to (a) actually use a `dropped` status for real mid-call network drops distinct from `failed` provisioning errors, and (b) exclude expected-rejection reasons like `CONCURRENT_CALL_RESTRICTED` from the failure count.

---

## P5 — Production configuration dependency verification

| Dependency | Local `.env` state | Production status | Notes |
|---|---|---|---|
| `MSG91_WEBHOOK_SECRET` | Present but **empty** | **Unconfirmed** — not exposed by `/api/health/keys` | Needed to verify inbound MSG91 webhook signatures; if unset in production, webhook signature verification is either disabled or failing silently depending on the handler — worth an operator check via the DO secrets dashboard directly, since no safe read-only HTTP probe can confirm this. |
| Object Storage (`PUBLIC_OBJECT_SEARCH_PATHS`, `PRIVATE_OBJECT_DIR`) | **Not present at all** | **Unconfirmed** | Same limitation — not surfaced by any health endpoint. |
| LiveKit SIP (`LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, `LIVEKIT_SIP_DOMAIN`) | All **set** locally | Production self-reports `livekit: true` via `/api/health/keys` (confirms `LIVEKIT_API_KEY`/`SECRET` only — that check doesn't cover `LIVEKIT_SIP_DOMAIN`) | Presence of the SIP domain var doesn't confirm the SIP trunk itself works — see P4's finding that `LIVEKIT_SIP_DOMAIN_REQUIRED_FOR_PSTN` is a real throw site. No live PSTN call has been placed against production to confirm end-to-end. |
| Health endpoints | N/A | `/healthz`, `/api/health` confirmed responsive; `/readyz` fixed in P0-1 | — |

**Operator action required:** confirm in the DO dashboard (not derivable remotely) whether `MSG91_WEBHOOK_SECRET`, `PUBLIC_OBJECT_SEARCH_PATHS`, and `PRIVATE_OBJECT_DIR` are actually set in production. If not, set them. Then place one real test PSTN call against production to confirm the LiveKit SIP trunk is functionally correct, not just "configured."

---

## Risk Assessment

| Item | Risk if unaddressed | Residual risk after this work |
|---|---|---|
| P0-1 `/readyz` 504 | Platform health checks fail → orchestrator may restart/route around a healthy app, or block deploys gated on readiness | **Resolved** in code; verify in production after deploy |
| P0-2 Razorpay | No production revenue collection possible; also a real contributor to call failures via the balance gate (P4) | **Not resolved** — pure operator action (add secrets), no code change was appropriate |
| P3 `/metrics` exposure | Internal operational data (error rates, queue depth) visible to anyone on the internet — recon value for an attacker | **Mitigated** in code; still fully open until operator sets `METRICS_TOKEN` |
| P4 call failure rate | Real user-facing call failures for a subset of PSTN/payment-gated calls; also a misleading metric label | **Partially resolved** — root causes identified and tied to P0-2/P5; the metric-definition cleanup is a follow-up, not done here (out of "no new features" scope) |
| P5 config gaps | Webhook signature verification and/or object storage may be non-functional in production; SIP trunk unverified | **Not resolved** — requires operator confirmation/testing that can't be done safely from here |

---

## Updated GO/NO-GO Recommendation

**NO-GO for full production traffic until operator actions are completed.** Specifically:
- **Must-fix before GO:** Razorpay secrets provisioned (P0-2) and at least one live PSTN/SIP test call placed successfully (P5) — both directly explain a meaningful share of the observed call failure rate (P4).
- **Should-fix before GO:** `METRICS_TOKEN` set (P3) — low blast-radius but trivial to close.
- **Confirm before GO:** `MSG91_WEBHOOK_SECRET` and Object Storage vars actually set in the DO dashboard (P5).
- **Already shippable:** the `/readyz` fix (P0-1) and the `/metrics` auth gate (P3 code side) — both verified locally, no operator action blocks deploying them.

None of the remaining items are external infrastructure dependencies outside this team's control — they are all operator-configuration gaps in the existing DO App Platform deployment.
