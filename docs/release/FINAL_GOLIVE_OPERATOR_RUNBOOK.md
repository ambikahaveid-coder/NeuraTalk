# NeuraTalk — Final Go-Live Operator Runbook

**Date:** 2026-07-13
**Prepared as:** launch-readiness verification, not a feature/engineering pass. No production code was modified to produce this report.

## How this report differs from the prior certification — read this first

While preparing this runbook, I discovered something the prior certification (`docs/PRODUCTION_READINESS_CERTIFICATION.md`) did not know: **a live production deployment already exists and is reachable right now at `https://neuratalk.in`**, fronted by Cloudflare, deployed via DigitalOcean App Platform (`.do/app.yaml`, `deploy_on_push: true` from GitHub branch `neuratalk-clean-release` — the branch this work is on). Process uptime at time of check: **~12.9 days (1,111,510s)**.

This matters enormously: the prior certification's "External Dependency" conclusions for Razorpay/Sentry/etc. were based on **this local sandbox's `.env` file**, which is a development file, not the production secret store. DigitalOcean App Platform manages production secrets separately, via its own encrypted-secrets vault (`.do/app.yaml` explicitly documents which 17 secrets must be set there). So instead of guessing, **I queried the live production system's own self-reported config-status endpoint** — real, current, authoritative evidence, not inference.

All checks below against `https://neuratalk.in` were **read-only GET requests with no side effects** (health/status/metrics endpoints, one deliberate 401-check against an auth-required endpoint). I did **not** attempt login, OTP, payment order creation, or any other mutating/costly action against the live system — those require a human operator's explicit go-ahead, since they touch real user-facing infrastructure, could send real SMS/email, or could create real financial records. Where the runbook calls for those, I have marked them **NOT EXECUTED — Requires Explicit Operator Authorization**, not faked as passing.

---

## PHASE 1 — Production Secrets Verification

Two independent sources were checked: (A) this local sandbox's `.env` (development only, **not what production runs on**), and (B) the live production system's own `/api/health/keys` self-report (authoritative for what's actually configured in the DO encrypted-secrets vault).

| Secret | Local `.env` | **Live Production (authoritative)** | Status |
|---|---|---|---|
| `DATABASE_URL` | Present, non-empty | `database: true` | ✅ Production Verified |
| `REDIS_URL` | Present, non-empty | `redis: true` | ✅ Production Verified |
| `LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET` | Present, non-empty | `livekit: true` | ✅ Production Verified |
| `LIVEKIT_SIP_DOMAIN` | Present, non-empty (`1m2u036kt9m.sip.livekit.cloud` per `.do/app.yaml`) | Implied by `livekit: true` | 🟡 Configured; live SIP call not placed (see Phase 3) |
| `ELEVENLABS_API_KEY` | Present, non-empty | **Not in the `/api/health/keys` report** — this diagnostic endpoint doesn't check ElevenLabs specifically | 🟡 Cannot confirm from this endpoint; local key exists |
| `OPENAI_API_KEY` | Present, non-empty | `openai: true` | ✅ Production Verified |
| Azure Speech / Translator | Present, non-empty | `azure_stt: true`, `azure_translate: true` | ✅ Production Verified |
| `MSG91_AUTH_KEY` | Present, non-empty | `msg91: true` | ✅ Production Verified |
| **`MSG91_WEBHOOK_SECRET`** | **Present, EMPTY** | Not exposed by this endpoint (only checks `MSG91_AUTH_KEY`, not the webhook secret specifically) | 🔴 **Cannot confirm production has this set — see below** |
| **`RAZORPAY_KEY_ID` / `_SECRET`** | **Present, EMPTY** | **`razorpay: false`** | 🔴 **Confirmed NOT configured in production** |
| `RAZORPAY_WEBHOOK_SECRET` | Present, EMPTY | Implied unconfigured (gateway itself is off) | 🔴 Not configured |
| Firebase Admin | Present, non-empty | `firebase_admin: true` | ✅ Production Verified |
| `SESSION_SECRET` | Present, non-empty | `session: true` | ✅ Production Verified |
| `SUPER_ADMIN_EMAIL` / `SUPER_ADMIN_SECRET` | Email present; Secret **missing from local `.env`** | `super_admin: true` | ✅ Production Verified (production has it even though local sandbox doesn't) |
| **`SENTRY_DSN`** | **Absent entirely** | Not exposed by this endpoint | 🔴 Cannot confirm; local absence is a real signal it's likely also unset in prod, since `.do/app.yaml`'s secrets checklist lists it as required-but-optional and it's not templated with a value the way non-secret config is |
| `POSTHOG_API_KEY` | Absent entirely | Not exposed | 🔴 Same reasoning as Sentry |
| Google Maps credentials | **No code references this at all** | N/A | ⚪ **Not Applicable — not a real dependency of this app** (grep found zero usage in `server/` or `client/src/`) |
| Object Storage (`PUBLIC_OBJECT_SEARCH_PATHS`, `PRIVATE_OBJECT_DIR`) | **Absent from local `.env`** | Not exposed by this endpoint | 🔴 Locally unconfigured; production status unconfirmed — **this backs voice-sample audio file storage (Voice Clone), so if unset in prod, voice enrollment uploads would fail at the object-storage step** |
| `TURN_SERVER_USERNAME` / `_CREDENTIAL` | Not checked (not in original secrets list) | Not exposed | 🟡 Listed as required in `.do/app.yaml`'s own checklist — unverified |

**Critical gap in this verification method:** `/api/health/keys` is a coarse boolean presence check (confirmed via source read earlier this cycle — it does not validate that a key actually *works*, only that an env var is non-empty). A present-but-invalid/expired key would still report `true`. This phase proves *configuration presence* for 10 of 17 required secrets, not *functional validity*, for any of them.

---

## PHASE 2 — Infrastructure Verification

| Item | Finding | Status |
|---|---|---|
| **Database** | Live production reports `database: true`; not independently pinged from here beyond that self-report | 🟡 Configured; deep query-level check not performed |
| **Redis** | Live production reports `redis: true` | 🟡 Configured; deep ping-latency check not performed |
| **LiveKit** | Live production reports `livekit: true`; room/SIP domain configured per `.do/app.yaml` | 🟡 Configured; no real call placed |
| **SIP Bridge** | `LIVEKIT_SIP_DOMAIN` configured (`1m2u036kt9m.sip.livekit.cloud`) | 🔴 **External Dependency** — real PSTN call never placed, this session or prior |
| **Object Storage** | Not confirmed configured (see Phase 1) | 🔴 Unconfirmed — real risk to Voice Clone uploads if unset |
| **Monitoring** | `/metrics` is live and returning real Prometheus data | 🟡 **Endpoint works, but is PUBLICLY reachable with zero authentication** — see Phase 4 finding |
| **Background Jobs** | Cannot verify the 24h retention-sweep cron actually fired in production without log access, which this session doesn't have | 🔴 Unverified |
| **Health Endpoints** | `/api/health` → 200 OK (0.47s). `/healthz` → 200 OK (0.30s). **`/readyz` → 504, 3/3 consecutive attempts, "App Platform failed to forward this request to the application"** | 🔴 **`/readyz` is broken in production right now** — real, live, reproducible finding |
| **TLS** | Valid cert (Google Trust Services, `CN=neuratalk.in`), **valid window Jun 24 2026 – Sep 22 2026** (~2.3 months remaining), HSTS with `preload` + `includeSubDomains` | ✅ Production Verified |
| **DNS** | `neuratalk.in` resolves and is served through Cloudflare (confirmed via `Server: cloudflare` header, CF-RAY, `cf-cache-status`) | ✅ Production Verified |
| **Rate Limits** | Code-level rate limiters exist for auth/OTP/payments (verified in earlier cycles' code audits); a single unauthenticated request to a non-rate-limited status endpoint showed no `X-RateLimit-*` headers, which is *expected* for that specific endpoint (it has no limiter attached by design) — did not attempt to trigger a real limiter against production (would require many requests against a live system) | 🟡 Code-verified in isolation; live-trigger not attempted (avoids hammering production) |
| **Backups** | `backupJobs` table and related code exist (confirmed in an earlier cycle); whether a real backup has run recently in production is unverifiable without DO/Neon dashboard access | 🔴 Unverified |
| **Rollback** | No CI/CD pipeline exists (`.github/workflows/` absent). Deployment is `deploy_on_push: true` directly from the `neuratalk-clean-release` branch — **meaning every push to this branch auto-deploys to production with no automated test gate in between** | 🔴 **Real risk** — a bad commit reaches production automatically |
| **Deployment Strategy** | `instance_count: 1` in `.do/app.yaml` — **single instance, no redundancy.** Docker `HEALTHCHECK` (30s interval, `/healthz`) plus DO's own `health_check.http_path: /api/health` (30s initial delay) both exist and both point at *working* endpoints, so an unhealthy container should be auto-restarted by the platform | 🟡 Restart-on-crash mechanism exists and points at healthy endpoints; **but single-instance means a restart is real downtime, not a seamless failover** |

---

## PHASE 3 — Real Production Smoke Tests

Per your explicit instruction ("never fake success"), every row below is either a real check I actually performed (read-only, safe) or explicitly marked as not executed, with the reason.

| Test | Result |
|---|---|
| **Web login** | NOT EXECUTED — Requires Explicit Operator Authorization (would need real credentials or would create a real account) |
| **Android login** | NOT EXECUTED — no device available in this environment, and same real-account concern as above |
| **OTP** | NOT EXECUTED — Requires Explicit Operator Authorization (sending a real OTP costs money via MSG91/Firebase and sends a real SMS/email to a real number) |
| **Translation Call** | NOT EXECUTED — requires two real authenticated participants; External Dependency (no test device/account provided) |
| **Transcript Generation** | NOT EXECUTED — depends on a real call happening first |
| **Transcript Search** | NOT EXECUTED — requires an authenticated session |
| **Transcript Export** | NOT EXECUTED — requires an authenticated session |
| **Voice Clone Enrollment** | NOT EXECUTED — requires a real authenticated session + real audio upload; also blocked pending Object Storage confirmation (Phase 1) |
| **Voice Clone Deletion** | NOT EXECUTED — same as above |
| **Payment Order** | **CANNOT BE EXECUTED — `razorpay: false` in live production, confirmed via self-report.** Not a "didn't try" — the gateway is off. |
| **Payment Verification** | Same — blocked by the same confirmed-off gateway |
| **Payment Refund** | Same |
| **Webhook Verification** | Razorpay webhook: gateway off, moot. MSG91 webhook: `MSG91_WEBHOOK_SECRET` status in production unconfirmed (Phase 1) — **if unset, this is a live security gap, not just an untested feature** |
| **Push Notifications** | NOT EXECUTED — requires a real device with FCM/APNs registration |
| **Background Calls** | Not applicable as a *test* — architecturally not built yet (polling-only on Android, confirmed in the Mobile module's own certification); nothing to test |
| **Health Endpoints** | ✅ **Executed. `/api/health` 200 OK. `/healthz` 200 OK. `/readyz` 504 — FAILING.** |
| **Metrics** | ✅ **Executed. `/metrics` returns real data:** `active_calls: 0`, `total_calls: 0` (in-memory counter, reset at last restart), `call_success_rate: 0.4`, `call_drop_rate: 0.53` (from persisted DB records, pre-dating the current process uptime), translation latency percentiles all `0` (no recent in-memory samples since last restart 12.9 days ago) |
| **Monitoring** | ✅ Executed (see Phase 4/5) — `/metrics` publicly reachable with no auth is itself a finding, not just a confirmation it works |

**A genuinely concerning data point surfaced here, not requested but found while checking `/metrics` honestly:** live production reports a **53.3% call drop rate** and only a **40% call success rate** from persisted billing records. This wasn't visible in any prior certification because no one had queried live `/metrics` before. It may reflect real call-quality problems, or it may reflect a metric-definition issue (e.g., short test/no-answer calls counted as "dropped" rather than "missed") — **I cannot tell which from here, and I am not going to guess.** This needs an operator to look at the underlying `callBillingRecords` data before launch messaging claims a specific reliability number.

---

## PHASE 4 — Security Verification

| Item | Finding |
|---|---|
| **RBAC** | ✅ Live-verified: unauthenticated `GET /api/auth/me` → **401 `{"message":"Not authenticated"}`**, real evidence auth gating is active in production, not just in tests. |
| **Webhook signatures** | Code-verified in an earlier cycle (HMAC-SHA256, constant-time compare, 6 tests forging/tampering real signatures). Razorpay webhook is moot (gateway off). MSG91 webhook secret's production value is unconfirmed. |
| **JWT** | **Not applicable** — this system uses opaque Bearer session tokens (`sess_<64 hex>`), not JWTs, confirmed via code read in an earlier cycle. This is a legitimate architectural choice (can't be decoded/forged without server-side lookup), not a gap. |
| **Rate limiting** | Code-verified (dedicated limiters on auth/OTP/payment-create/verify/refund/webhook). Not live-triggered against production (would require deliberately hammering a live system, which I did not do without authorization). |
| **Audit logs** | Code-verified extensively in the Payments cycle (10 audit action types, reusing one framework, no second system). Whether entries are actually accumulating in the live production DB is unverifiable without DB access from here. |
| **Encryption** | AES-256-GCM for voice samples (code-verified, earlier cycle). TLS 1.2+/HSTS confirmed live on the production domain. |
| **Secrets** | Confirmed production keeps them separate from this sandbox's `.env` (DO encrypted-secrets vault) — a correct, real security boundary. |
| **Ownership validation** | Code-verified (Transcripts, Payments refund RBAC — owner/org-member/admin-override matrix, tested this cycle with 7 real unit tests). |
| **Replay protection** | Payments: idempotency-key + duplicate-in-progress DB checks (code + test verified, earlier cycle). Webhook replay: Razorpay's `payment.captured` handler uses a Redis lock + DB status check to prevent double-provisioning on redelivery (code-verified earlier cycle). |
| **Idempotency** | Same as above — genuinely tested with real forged-retry scenarios in the Payments cycle, not just asserted. |
| **New finding: `/metrics` has no authentication** | Confirmed live — anyone on the internet can currently read process memory, active call counts, error rates, and provider health for this production system with zero credentials. The data itself is described as privacy-safe (no PII, no call content) per the code's own design intent, but exposing *operational* metrics publicly is still a real information-disclosure misconfiguration — it tells an attacker exactly when the system is under load, degraded, or has zero active traffic (a good time to attempt something noisy). |

---

## PHASE 5 — Performance Verification

All numbers in this section are **real, live measurements taken during this runbook**, not synthetic or inherited.

| Metric | Value | Source |
|---|---|---|
| `/api/health` response time | 0.47s | Live curl, this session |
| `/healthz` response time | 0.30s | Live curl, this session |
| `/api/payments/status` response time | 2.01s | Live curl, this session |
| `/api/payments/plans` response time | 2.14s | Live curl, this session |
| Process memory (heap used) | 73.1 MB | Live `/metrics` |
| Process memory (heap total) | 84.7 MB | Live `/metrics` |
| Process memory (RSS) | 212.1 MB | Live `/metrics` |
| Event loop lag | 0ms | Live `/metrics` |
| Process uptime | 1,111,510s (~12.86 days) | Live `/metrics` |
| Active calls (right now) | 0 | Live `/metrics` |
| Call success rate (persisted) | 40% | Live `/metrics`, from `callBillingRecords` |
| Call drop rate (persisted) | 53.3% | Live `/metrics`, same source — **flagged above as needing investigation** |
| Translation latency p50/p95/p99 | 0ms / 0ms / 0ms | Live `/metrics` — no in-memory samples since last restart; **not evidence translation is instant, evidence the sample buffer is empty** |
| CPU usage | Not exposed by the live `/metrics` at the time of this check (the CPU-percent metric added this cycle requires the reliability-monitor's periodic sampler to have run at least once since deploy — **this specific commit may not yet be the one running in production**, see note below) | — |
| Concurrent call capacity | Not tested — would require generating real simultaneous call load against production, not attempted | — |

**Important caveat:** the response times above (0.3–2.1s) were measured from this sandbox's network location to a `blr` (Bangalore)-region DO deployment — they include this sandbox's own network path, not a clean same-region measurement. They're directionally useful (payments endpoints are ~4-7x slower than health endpoints) but not a substitute for a proper APM trace.

**Also important:** I cannot confirm from here whether the **specific code changes made across Modules 1–8 this engineering cycle (Transcripts certification, Mobile fixes, SDKs, Payments refund API, Reliability infrastructure) are actually the code currently running in that live production process.** Given `deploy_on_push: true` and this session working on the `neuratalk-clean-release` branch, they likely are or will be shortly, but I have no deploy-log access to confirm the currently-running commit SHA. **This is a real gap an operator must close before trusting any of the "production" evidence above as reflecting this cycle's changes specifically** — some of what I measured (e.g., the CPU metric not appearing) may simply mean production hasn't redeployed since the Reliability module's commits landed.

---

## PHASE 6 — Launch Decision

### Executive Summary

A live, publicly reachable production deployment of NeuraTalk exists at `https://neuratalk.in`, has been running for ~13 days, has strong TLS/security-header configuration, and correctly enforces authentication on protected endpoints. Core infrastructure (database, Redis, LiveKit, OpenAI, Azure, MSG91, Firebase, session management) all self-report as configured. However, this runbook surfaced **new, live, previously-undocumented findings** that were not visible in prior code-only certifications: **Razorpay is confirmed off in production** (not just "untested" — actually disabled), **`/readyz` is broken** (504 from the platform's own edge, 3/3 reproducions), **`/metrics` is publicly exposed with no authentication**, **there is no CI/CD gate before auto-deploy**, **the deployment is single-instance with no redundancy**, and **live call-quality metrics show a 53% drop rate** that has never been investigated. None of these are hypothetical — every one was observed against the real, live system during this session.

### Critical Blockers (P0)

1. **Razorpay is disabled in production.** Any launch messaging that includes payments is false until this is fixed. This alone is launch-blocking for any monetized feature.
2. **`/readyz` returns 504 in production, reproducibly.** While it doesn't currently block the platform's own restart-on-crash mechanism (which uses `/healthz`/`/api/health`, both healthy), it means operators have **no working deep-dependency health check** right now — if DB or Redis silently degrades, nothing will surface it via the intended endpoint.

### High Risks

3. **`/metrics` publicly exposed, no auth** — real information-disclosure misconfiguration on a live system.
4. **No CI/CD gate before deploy** — every push to `neuratalk-clean-release` auto-deploys to production with zero automated test run in between, despite 130+ real tests existing in this repo that could catch regressions first.
5. **Single production instance, no redundancy** — any crash or redeploy is real user-facing downtime, not a graceful failover.
6. **53.3% call drop rate / 40% success rate in persisted billing records** — unexplained, un-investigated, and directly contradicts any "reliable calling" launch claim until an operator determines whether this is a real quality problem or a metric-definition artifact.
7. **`MSG91_WEBHOOK_SECRET` production status unconfirmed** — if unset (as it is in this local sandbox), inbound PSTN webhooks are currently accepted without signature verification, per this codebase's own documented fallback behavior.
8. **Object Storage configuration unconfirmed in production** — if unset, Voice Clone sample uploads fail at the storage step, silently degrading a certified-complete feature to broken in the field.

### Medium Risks

9. iOS cannot be built at all (no Xcode project) — any iOS launch commitment needs a macOS environment provisioned first, from zero.
10. Swift SDK is compiler-unverified — real bugs already caught by manual review; more may exist.
11. Sentry/PostHog credentials could not be confirmed present or absent in production from this session (the diagnostic endpoint doesn't report them) — local absence is a real but not conclusive signal.
12. No confirmation the code deployed in production reflects this cycle's changes (Reliability, Payments-refund, Mobile fixes, Transcripts) — deploy-log access was not available from this session.

### Operator Tasks (in priority order)

1. Confirm current production deploy's commit SHA matches this branch's HEAD; redeploy if not.
2. Set real Razorpay production/live credentials in DO's encrypted secrets, then run one real order→payment→refund cycle.
3. Investigate why `/readyz` returns 504 at the DO App Platform edge — check DO's route/ingress configuration for that specific path, check application logs for the same window.
4. Put `/metrics` behind authentication or an internal-network-only path (DO App Platform internal routing, or an IP allowlist, or a bearer-token check).
5. Add a CI gate (GitHub Actions running `npm run check && npm test`) before `deploy_on_push` is allowed to proceed, or disable `deploy_on_push` in favor of a manual/gated promotion step.
6. Query `callBillingRecords` directly (DB access, not available from this session) to understand the 53.3% drop rate — is it real degraded calls, or short test/no-answer calls being misclassified?
7. Confirm `MSG91_WEBHOOK_SECRET` and Object Storage (`PUBLIC_OBJECT_SEARCH_PATHS`/`PRIVATE_OBJECT_DIR`) are actually set in the DO secrets vault — this session cannot read them.
8. Scale to `instance_count: 2+` (or accept single-instance downtime risk explicitly, in writing, as a launch decision).
9. Set up Sentry + PostHog projects and their env vars; confirm one real error/event appears in each dashboard.
10. Provision a macOS/Xcode environment for iOS; provision a real Swift toolchain to compile-verify the Swift SDK.

### Production Checklist
- [ ] Razorpay live credentials set + one real transaction cycle completed
- [ ] `/readyz` fixed and returning 200 with real DB/Redis dependency checks
- [ ] `/metrics` gated behind auth
- [ ] CI gate added before auto-deploy
- [ ] Drop-rate/success-rate investigated and explained
- [ ] `MSG91_WEBHOOK_SECRET` confirmed set in production
- [ ] Object Storage confirmed configured in production
- [ ] Current deploy confirmed to match this cycle's commits
- [ ] Instance redundancy decision made explicitly

### Rollback Checklist
- [ ] Confirm DO App Platform's deployment history retains the prior known-good build for one-click rollback
- [ ] Document the exact commit SHA considered "last known good" before this cycle's changes go live
- [ ] Verify `npm run db:push` changes (schema additions this cycle: `payment_refunds` table, `PARTIALLY_REFUNDED` status) are backward-compatible with the prior code version in case of rollback — **new tables are additive and safe to roll back past; no existing column was altered destructively this cycle**, per this cycle's own schema diffs
- [ ] Confirm single-instance deploys don't leave the app in a half-deployed state during rollback (no blue/green currently configured)

### Incident Response Checklist
- [ ] On-call owner identified for `neuratalk.in` (not established in any artifact reviewed this session)
- [ ] Sentry (once configured) wired to a real alert channel (email/Slack/PagerDuty) — currently would alert nowhere, since Sentry isn't configured
- [ ] `/readyz` fixed so it can serve as the real incident-detection signal it's designed to be
- [ ] Runbook for "Razorpay down" scenario (currently: it's *always* down in production — this is the baseline, not an incident, until credentials are set)

### 24-Hour Monitoring Plan
- Poll `/api/health`, `/healthz` every 5 minutes (both confirmed working)
- Do **not** rely on `/readyz` until fixed
- Watch `/metrics`'s `neuratalk_errors_total` and `neuratalk_call_drop_rate` for the first 24h after any deploy from this cycle's changes
- Manually spot-check `/api/health/keys` after setting any new secret, to confirm the boolean flips to `true`

### 7-Day Stabilization Plan
- Resolve the `/readyz` 504 and confirm it's stable for 48h before trusting it operationally
- Complete one real Razorpay test-mode transaction cycle and confirm audit logs + metrics counters increment correctly in production (not just in this session's mocked tests)
- Investigate and resolve or explain the call drop-rate finding

### 30-Day Operations Plan
- Stand up Prometheus/Grafana against the now-authenticated `/metrics`
- Complete the iOS build environment and Swift SDK compiler verification
- Add the CI gate and confirm at least one deploy has gone through it successfully
- Re-run this entire runbook's Phase 3 live smoke tests, this time with explicit operator authorization to perform the mutating tests (real login, real OTP, real payment cycle, real translated call) that this session correctly declined to perform unilaterally

---

## Final Module Classification

| Module | Classification | Basis |
|---|---|---|
| Core Translation | 🟡 Engineering Complete – Operator Action Required | Credentials confirmed live in production; no live call placed this cycle to reconfirm quality |
| Transcript System | 🟡 Engineering Complete – Operator Action Required | Strong engineering evidence (E2E, real exports); no live authenticated smoke test performed against production this cycle |
| Voice Clone | 🟡 Engineering Complete – Operator Action Required | ElevenLabs key present locally; Object Storage config unconfirmed in production — a real, specific blocker for this feature |
| Mobile (Android) | 🟡 Engineering Complete – Operator Action Required | Real build succeeds; never run on a physical device |
| Mobile (iOS) | 🔴 Not Ready | No buildable project exists |
| Developer SDKs | 🟡 Engineering Complete – Operator Action Required | 5/6 build-verified; Swift unverified |
| Payments | 🔴 Not Ready | **Confirmed disabled in live production** — this is not a "pending verification" state, it is an off switch |
| PSTN/Telecom | 🔴 Not Ready | Live SIP call never placed; webhook secret status in production unconfirmed |
| Reliability Infrastructure | 🟡 Engineering Complete – Operator Action Required | Self-hosted pieces real and live (health endpoints, metrics); `/readyz` actively broken; `/metrics` insecurely exposed; third-party delivery (Sentry/PostHog) unconfirmed |

## Final Production Readiness Percentage: **58%**

Lower than the prior code-only certification's 69%, specifically *because* this runbook found real, live, previously-unknown problems (`/readyz` down, `/metrics` exposed, Razorpay confirmed off, unexplained drop rate, no CI gate) that a code audit alone could not surface. This is the system getting *more accurately* scored, not worse — the underlying engineering didn't regress; the picture became clearer.

## Final Recommendation: **NO-GO**

Two P0 blockers exist (Razorpay confirmed disabled in production; `/readyz` broken with no working deep-health-check replacement). Per your own instruction — *"If ANY P0 issue exists, recommend NO-GO"* — that is the honest conclusion this evidence supports, not Conditional GO.

**Path to Conditional GO:** resolve the two P0 items above (Razorpay credentials + `/readyz` fix) and the "Object Storage unconfirmed" and "`MSG91_WEBHOOK_SECRET` unconfirmed" items, since both directly threaten certified-complete features (Payments, Voice Clone, PSTN webhook security) in ways this session cannot rule out from where it sits. Once those are closed, the remaining items (CI gate, redundancy, iOS, Swift, Sentry/PostHog, drop-rate investigation) are real but do not individually block a scoped initial launch (e.g., web + Android, translation + transcripts + voice clone, payments and PSTN explicitly excluded from the initial launch surface until their blockers clear).

**Do not represent this system as launch-ready to a CTO, investors, or enterprise customers until at minimum the two P0 items are closed and re-verified against live production, not against this session's local sandbox.**
