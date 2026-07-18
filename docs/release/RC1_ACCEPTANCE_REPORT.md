# NeuraTalk RC1 Final Acceptance Report

Read-only acceptance review. No code was modified. (The build-verification step in §4 regenerated `dist/` with new content hashes as a necessary side effect of running `npm run build`; this was reverted via `git checkout -- dist/` + `git clean -fd dist/` immediately after evidence was captured, restoring the working tree to its pre-review state.)

---

## 1. Previously Reported P0 Issues — Resolution Status

| P0 | Status | Evidence |
|---|---|---|
| **Wallet double-spend race condition** (`billing-engine.ts`) | **RESOLVED in codebase** | `reserveWalletAmount` (atomic conditional UPDATE), `flushAccountBalanceDelta`, and `WalletReservationConflictError` all present and unmodified since the prior sprint (`server/billing-engine.ts:38,568,610`). 5 concurrency tests pass, including the 1000-concurrent-attempt stress test. |
| **Unhandled async rejection crashes the process** (Express 4) | **RESOLVED in codebase** | `import "express-async-errors";` present in `server/index.ts:14`, confirmed compiled into `dist/index.cjs`. 4 chaos tests pass, including 1000 forced DB failures → 1000 HTTP errors, 0 crashes. |

Both fixes are present in the reviewed codebase, unregressed, and covered by passing automated tests. **However — see §7 — neither fix is live in production yet** (see below).

---

## 2. Regressions

**None found.** Full test suite: **139/139 passed**, 17/17 files, identical result to the prior sprint's run. TypeScript compile: **0 errors**. No test that passed before this review now fails; no new failures introduced.

---

## 3. Automated Test Re-Run

| Suite | Result |
|---|---|
| `tsc --noEmit` | **Pass** — 0 errors |
| `vitest run` (unit + integration, 17 files) | **Pass** — 139/139 tests |
| `tests/integration/billing-wallet-race-condition.test.ts` | **Pass** — 5/5 (includes 1000-concurrent stress test) |
| `tests/integration/async-crash-prevention.test.ts` | **Pass** — 4/4 (includes 1000-forced-failure chaos test) |
| Playwright e2e (`tests/e2e/*.spec.ts`) | **NOT RUN** — same limitation as the prior sprint: requires a running app + browser binaries not provisioned in this environment; the two existing specs (transcript-system, voice-clone-enrollment) don't exercise either P0 fix. Marked **NOT VERIFIED**, not assumed passing. |

---

## 4. Build Artifacts

| Check | Result |
|---|---|
| `npm run build` | **Pass** — client (Vite) and server (`esbuild` → `dist/index.cjs`, 12.0MB) both built cleanly, 53s |
| `node --check dist/index.cjs` | **Pass** — syntactically valid |
| Fix presence in bundle | **Confirmed** — `dist/index.cjs` contains `reserveWalletAmount`/`WalletReservationConflict` (7 references) and the `express-async-errors` patch (1 reference) |
| `dist/public/` | Present — `index.html`, hashed asset bundles, service worker assets, manifest, sitemap all generated |

Build artifacts are sound and include both P0 fixes.

---

## 5. Deployment Configuration (`.do/app.yaml`)

| Check | Result |
|---|---|
| Service definition | 1 web service, Node.js buildpack, `instance_size_slug: apps-s-1vcpu-1gb`, `instance_count: 1` (no horizontal scaling configured — single point of failure, noted as a risk, not a blocker) |
| `build_command` | `npm ci --omit=dev` — does **not** explicitly include `npm run build`. `express-async-errors` is correctly listed under regular `dependencies` (not `devDependencies`), so `--omit=dev` won't strip it. Whether `dist/` actually gets produced during DO's build phase depends on the Node buildpack auto-running the `package.json` `build` script — **this cannot be confirmed from this sandbox**, but the fact that `https://neuratalk.in` is live and serving current-looking content today is strong real-world evidence this pipeline already works in practice. Flagged as **NOT FULLY VERIFIED** rather than either passed or failed. |
| `run_command` | `node dist/index.cjs` — matches the build output path |
| `health_check.http_path` | `/api/health` — **not** `/readyz`. This is a meaningful clarification for this RC: DO's own deploy-gating health check hits the cheap, dependency-free `/api/health` endpoint (always fast, always 200 if the process is up), not the `/readyz` endpoint the P0 sprint fixed. The `/readyz` 504 bug was never actually blocking DO deploys — it affects whatever external caller (uptime monitor, manual check, or a future stricter deploy gate) hits `/readyz` directly. The fix is still correct and worth shipping, but its operational impact is on external monitoring correctness, not on DO's own rollout gating. |
| Deploy trigger | `deploy_on_push: true` on branch `neuratalk-clean-release` — matches the current working branch |
| Secrets block | Documents 20 required encrypted secrets (SESSION_SECRET, SUPER_ADMIN_*, DATABASE_URL, REDIS_URL, LIVEKIT_*, OPENAI_API_KEY, MSG91_*, AZURE_*, RAZORPAY_*, FIREBASE_SERVICE_ACCOUNT_JSON, TURN_*, SENTRY_DSN) |
| **Gap found**: `METRICS_TOKEN` | **Not documented anywhere** in `.do/app.yaml` or `.env.example`. This env var was introduced by the earlier P0 Production Recovery sprint to gate `/metrics`; the code fails open (with a warning) if it's unset, so this isn't a functional regression, but an operator following only the `.do/app.yaml` checklist has no prompt to ever set it. |

---

## 6. Production Operator Checklist — Live Verification

Safe, read-only checks against `https://neuratalk.in` (no state mutation), to establish current ground truth rather than rely on prior-session memory:

| Check | Result |
|---|---|
| `GET /api/health` | `200`, `{"status":"ok", "uptime": 1155026s}` — process has been up ~13.4 days, i.e. since well before today's fixes were written |
| `GET /readyz` | **`504`**, DO edge `via_upstream` error — **the exact bug from the P0 sprint, still reproducing live** |
| `GET /api/health/keys` | `razorpay: false` — still unconfigured, unchanged from prior audits |
| `GET /metrics` | Still returns full Prometheus output with **no authentication required** |

**This is the single most important finding of this acceptance review**: the process uptime (~13.4 days) predates every fix made in this session (the wallet race condition fix, the async-crash fix, the `/readyz` fix, and the `/metrics` token gate). Combined with `git log -1` showing the last commit dated 2026-06-30 and `git status` showing all of this session's changes as **uncommitted, unpushed working-tree modifications**, this confirms: **RC1, as reviewed and tested in this report, has not been deployed.** Production is still running pre-RC1 code. `deploy_on_push: true` never fired because nothing has been pushed.

**Outstanding operator checklist** (unchanged from the prior sprint's report, since none of it has been actioned):
- [ ] Commit and push RC1 to `neuratalk-clean-release` to trigger deployment (prerequisite for every item below to take effect)
- [ ] Set `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` / `RAZORPAY_WEBHOOK_SECRET` as encrypted secrets
- [ ] Set `METRICS_TOKEN` as an encrypted secret (and add it to `.do/app.yaml`'s documented secrets list)
- [ ] Confirm `MSG91_WEBHOOK_SECRET`, `PUBLIC_OBJECT_SEARCH_PATHS`, `PRIVATE_OBJECT_DIR` are actually set (unconfirmed both locally and in production self-report)
- [ ] Place one real production PSTN/SIP test call to confirm the LiveKit SIP trunk works end-to-end, not just "configured"
- [ ] After deploy, re-verify `/readyz` returns 200 and `/metrics` requires the token

---

## 7. Remaining Launch Blockers

### Engineering Issues
*(from the full prior audit — unchanged, out of this sprint's scope, not re-verified in depth this session)*
- SLA metrics partially fabricated/hardcoded (`sla-management.ts`)
- Voice clone has no moderation/approval gate
- `requireCompanyAccess` RBAC middleware defined but never applied (dead code)
- Attended call transfer and blind-transfer-to-PSTN are stubs
- Enterprise call queue and IVR built but unwired from the live call path
- QoS telemetry (jitter/packet loss) permanently reports 0 — dead instrumentation
- Zero test coverage remains on `smart-router.ts`, `role-middleware.ts`, `livekit-service.ts`, `production-routes.ts` (billing-engine.ts's reservation logic is now covered; the rest of that file and these other modules are not)

### Infrastructure Issues
- Single instance (`instance_count: 1`) — no redundancy/horizontal scaling configured
- Backup scripts exist but no confirmed scheduler/cron wiring
- Build pipeline's implicit reliance on the Node buildpack auto-running `npm run build` is unconfirmed from this environment (real-world precedent suggests it works, but it's not explicit in `app.yaml`)

### Operator Actions
- **RC1 has not been deployed — this blocks everything else in this section from taking effect**
- Razorpay production secrets
- `METRICS_TOKEN` secret + documentation
- `MSG91_WEBHOOK_SECRET` / Object Storage confirmation
- Live SIP test call

### Business Dependencies
- Whether to disclose the external-integration gap (WhatsApp, Telegram, Zoom, Teams, Meet, Slack, CRM — all confirmed missing in the full audit) to any prospect told these exist
- Whether mobile push notifications (confirmed entirely absent — calls only reach a foregrounded app) are a pre-launch blocker or a fast-follow

---

## Passed Checks
- Both confirmed P0 defects fixed in code, unregressed since last sprint
- 139/139 automated tests pass; 0 TypeScript errors
- Production build succeeds; both fixes confirmed present in the compiled bundle
- Deployment config structurally sound (service, health check, secrets scaffolding all present)

## Failed Checks
- `/readyz` still returns 504 in live production (fix not yet deployed)
- `/metrics` still unauthenticated in live production (fix not yet deployed)
- `razorpay: false` in live production (operator action never completed)
- `METRICS_TOKEN` undocumented in deployment config

## Risks
- **Deployment gap**: RC1 exists only as tested, uncommitted local changes — real-world risk of this work being lost, conflicting with concurrent changes, or simply never shipping if not committed/pushed soon
- Single-instance deployment — any process crash or redeploy causes a full outage window
- Build pipeline's `dist/` generation step is implicit/unconfirmed in `app.yaml`
- Everything listed under "Engineering Issues" above remains a live production-quality gap, independent of this sprint

## Production Readiness Percentage
**~50%.** The two named P0s are genuinely fixed and well-tested — real progress. But "fixed in a local working tree with passing tests" is not "fixed in production," and production right now (uptime ~13.4 days, pre-dating every fix this session) still has both original P0s live, plus every other open item from the full audit (Razorpay, SLA fabrication, missing moderation, missing push notifications, etc.) untouched.

## GO / CONDITIONAL GO / NO-GO

**CONDITIONAL GO** — conditional specifically on: (1) committing and deploying RC1, (2) re-verifying `/readyz` and `/metrics` against production post-deploy to confirm the fixes actually take effect there (not just locally), and (3) completing the operator checklist in §6. The code itself is acceptance-worthy; the deployment is not yet done. This is **not a NO-GO**, because no new P0 was found and nothing regressed — but it is also not a clean GO, because the review surfaced that the very fixes being accepted have not yet reached the system they were written to protect.
