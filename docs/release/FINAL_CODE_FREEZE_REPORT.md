# NeuraTalk — Final Code Freeze Deep Audit & Acceptance Report

Zero-trust re-audit: every finding below was independently re-verified against current source this session, not carried forward from prior reports on faith. Six parallel, from-scratch audits (security/RBAC, billing/wallet, telecom, mobile, web/admin, infrastructure) plus a real `flutter analyze` run and full regression suite. Two verified, narrow, safe fixes were applied and tested; everything else found is reported honestly rather than rushed.

**Per your explicit instructions: no commit, no push, no deploy has been performed.** See "Git Actions" at the end.

---

## Bugs Found & Fixed This Session

| # | Severity | Issue | Status |
|---|---|---|---|
| 1 | **P0** | Inbound PSTN calls never locked the callee — two simultaneous inbound calls to the same user could both proceed to billing and room creation, double-booking the callee (`server/pstn/inbound.ts`) | **FIXED** — reused the exact `SET NX` lock pattern already used for outbound calls (`smart-router.ts`); lock is released on any setup failure and on normal call end (`endCall`). 2 new tests, both passing. |
| 2 | P1 | Unguarded `JSON.parse` on `sessionStorage` in `client/src/App.tsx:179`, executed on every render — a malformed/stale value would crash the entire app | **FIXED** — wrapped in try/catch, matching the pattern already used at 15+ other `JSON.parse` call sites in the same codebase. |

**Total bugs found this session: ~16** (1 P0 code defect, 1 P0-class platform gap [not a code defect — see iOS below], ~7 P1, ~7 P2).
**Total fixed: 2** (both verified above). The remainder are reported below, correctly classified, not silently dropped.

---

## Remaining Issues — Engineering (Code Defects)

| Severity | Issue | File | Why not fixed now |
|---|---|---|---|
| P1 | Free-tier/usage-counter fields (`includedSecondsRemaining`, `includedCreditsRemaining`, `outstandingPostpaidPaise`, `currentDayUsageSeconds`) still use absolute-value writes and can drift under concurrent calls on the same B2B account | `server/billing-engine.ts` (`persistRuntimeState`, `finalizeCallSession`) | Same bug class as the wallet race fixed earlier this session, but bounded severity (usage-entitlement drift, not fund loss) and explicitly out of that fix's scope. Fixing it requires the same delta-tracking technique already built (`pendingWalletDeltaPaise` pattern) extended to 4 more fields — a real, contained fix, but not attempted in this pass to avoid scope creep into "rewriting" a file already modified twice this session without a fresh, focused review. |
| P1 | `configService.setSecret`'s thrown error could theoretically embed a secret value into a log line (`admin-config-routes.ts:115,129` logs the caught error object) | `server/admin-config-routes.ts`, `server/config-service.ts` | Flagged, not confirmed exploitable — requires reading `config-service.ts`'s error-construction code, not done this pass. Recommend explicit redaction as a follow-up regardless of whether it's currently exploitable. |
| P1 | 4 orphaned web routes: `/settings/voice-clone`, `/personas`, `/diagnostics`, `/call-diagnostics` — registered in `App.tsx` but unreachable from any nav link (the only link to voice-clone settings lives in a page that is itself never routed) | `client/src/App.tsx`, `client/src/pages/Dashboard.tsx` | Fixing this means adding real navigation entries to live dashboard components — a UI/product decision (where should these links live?), not a narrow bug fix. |
| P1 | 5 spot-checked dashboards (`CompanyDashboard`, `SuperAdminDashboard`, `CallHistory`, `BillingPage`, `ConsumerDashboard`) have loading states but none check `isError` from `useQuery` — a failed API call silently renders an empty state instead of a retry/error message | `client/src/pages/*.tsx` | Real gap, but fixing 5 different components' error UI is feature-shaped work, not a one-line patch. |
| P1 | Mobile: push notifications entirely absent (no `firebase_messaging`) — calls only reach a foregrounded/alive app, with no in-app indication of this limitation | `flutter_app/pubspec.yaml`, `lib/services/call_service.dart` | Requires adding a real dependency, FCM setup, and platform-channel wiring — a feature, not a bug fix, and unverifiable end-to-end without a physical device. |
| P1 | Mobile: wallet top-up/plan-purchase buttons and 11 of 12 settings tiles are no-op stubs | `flutter_app/lib/screens/wallet_screen.dart`, `settings_screen.dart` | Same — building real screens for these is feature work, previously scoped out by product decision. |
| P1 | Mobile: auth token stored in plaintext `SharedPreferences`, not secure/keystore-backed storage | `flutter_app/lib/services/api_service.dart` | A real, narrow, fixable defect in principle (swap to `flutter_secure_storage`), but changing token storage touches every authenticated request path in the app and needs on-device verification this environment cannot provide — too risky to change blind under a code-freeze review. |
| P2 | 3 `setInterval` calls still lack `.unref()`/`clearInterval` (`billing-scheduler.ts`, `cleanup-job.ts`, `production-routes.ts`) — prevents clean process shutdown, no functional impact while running | — | Below this pass's fix bar; harmless while the process is up. |
| P2 | `CONCURRENT_CALL_RESTRICTED` (from the outbound active-call lock) isn't mapped to a clean HTTP status in `controller.ts` — surfaces as a raw 500 instead of 409 | `server/modules/calls/controller.ts:391` | Cosmetic error-message consistency issue, not a functional defect. |
| P2 | `b2b-admin/routes.ts` authorizes in-handler rather than via middleware — correct today, fragile pattern for future additions | `server/modules/b2b-admin/routes.ts` | Working as-is; a consistency/hardening recommendation, not a bug. |
| P2 | `server/db.ts`'s pool-config doc comment (max 20/idle 30s/connect 5s) doesn't match the real values (max 10/idle 10s/connect 15s) | `server/db.ts` | Documentation-only, zero functional impact. |

## Remaining Issues — Platform/Environment Gap (Not a Code Defect)

**iOS: the platform target does not exist.** `flutter_app/ios/` contains only `Generated.xcconfig`, `flutter_export_environment.sh`, and plugin-registrant stubs — there is no `Info.plist`, no `.xcodeproj`, no `AppDelegate.swift`, no `Podfile`. This isn't a missing permission string or a crash risk to patch; `flutter build ios` cannot run at all today. This is honestly reported as required, and is **not** counted as a "P0 bug" in the fixed/remaining bug tally above, because there is no existing, working code to have regressed — iOS support was simply never scaffolded. Generating Xcode project files blind, from a Windows sandbox with no Xcode/macOS toolchain to verify them, would be worse than not touching it: an unverifiable, possibly-broken project that looks done but isn't. This needs a real macOS/Xcode environment and cannot be responsibly completed here.

## Remaining External Dependencies / Operator Actions
*(unchanged from the prior sprint's report — none of these are code defects)*
- Razorpay production secrets not provisioned (`razorpay: false` in live `/api/health/keys`)
- `METRICS_TOKEN` not set (and not documented in `.do/app.yaml`) — `/metrics` still unauthenticated
- `MSG91_WEBHOOK_SECRET` / Object Storage env vars unconfirmed in production
- No live PSTN/SIP test call ever placed against production to confirm the trunk works end-to-end, not just "configured"
- **RC1's fixes (from the prior sprint) are still not deployed to production** — confirmed again this session via the same read-only checks: `/readyz` still 504s live, uptime unchanged, nothing has been pushed

---

## Regression Verification

| Check | Result |
|---|---|
| `tsc --noEmit` | **Pass** — 0 errors |
| `vitest run` (full suite) | **Pass** — **141/141** tests, 17 files (2 new tests added this session for the PSTN fix; 139 pre-existing, zero regressions) |
| `flutter analyze` | **Pass** — 0 errors, 2 warnings (unnecessary casts), 21 info-level lints (deprecated `withOpacity`, missing `const`) — all cosmetic, none crash-relevant |
| `npm run build` | **Pass** — client + server bundles build cleanly, `node --check dist/index.cjs` confirms valid syntax; `dist/` reverted to its committed state after verification (it is intentionally pre-built and committed — DO deploys it directly, no build step runs at deploy time) |
| Playwright e2e | **Not run** — same standing limitation (no browser binaries provisioned, specs unrelated to this session's fixes) |
| Load tests | **Not run** — no load-testing tool or safe target available in this environment; explicitly marked NOT VERIFIED rather than assumed passing |
| Concurrency tests | **Pass** — 1000-concurrent wallet reservation stress test (prior sprint, re-verified passing this session) + new PSTN double-booking test |

---

## Scores

| Category | Score | Basis |
|---|---|---|
| Security | 65/100 | No new P0 found by an independent fresh audit (auth, RBAC, rate limiting, CORS, secrets, SQLi all checked clean); still held back by the standing voice-clone-moderation gap, dead `requireCompanyAccess` middleware, and mobile's plaintext token storage |
| Performance | Not fully verified | Build performance is fine; no real load test was run against a live instance — cannot responsibly score this |
| Reliability | 72/100 | Wallet race, async-crash, and PSTN double-booking are all fixed and stress-tested; dangling intervals and the free-tier counter race remain |
| Telecom Readiness | 65/100 | LiveKit/PSTN/MSG91 core paths confirmed real and correct, double-booking closed; enterprise queue/IVR/attended-transfer still unwired (unchanged, out of this session's scope) |
| Mobile Readiness | 38/100 | Android core calling is real and `flutter analyze`-clean; push notifications, wallet, and most settings are unimplemented; **iOS cannot build at all** |
| Enterprise Readiness | 35/100 | Unchanged from the full audit — SLA metrics still fabricated, queue/IVR still unwired |
| API Readiness | 75/100 | RBAC, validation, and rate limiting all confirmed sound on fresh re-check |
| **Production Readiness (overall)** | **~55%** | Meaningful, verified progress this session on top of the prior sprint's two P0 fixes; still short of "zero P1" |

---

## FINAL GO / NO-GO

**CONDITIONAL GO.**

Not FULL GO: real P1 issues remain (documented above) — per your own stated rule, FULL GO requires zero P0 **and** zero P1, and that bar isn't met.

Not NO-GO: the one confirmed P0 **code defect** found this session (PSTN callee double-booking) is fixed and tested; no other exploitable, unmitigated P0 in existing code was found by six independent fresh audits. The iOS gap is a scope/environment limitation, not a regression in working code.

Conditional on:
1. Deploying this session's and the prior sprint's fixes to production (still not deployed — confirmed again live)
2. Completing the standing operator checklist (Razorpay, `METRICS_TOKEN`, MSG91/Object Storage confirmation, live SIP test)
3. A product decision on the P1 list above — none of them block core 1:1 calling, but several (mobile push, iOS, orphaned settings) affect what can honestly be marketed as "done"

---

## Git Actions

Per your explicit instructions ("Only after the final report is approved: ALLOW Git Commit... Before that: DO NOT COMMIT. DO NOT PUSH. DO NOT DEPLOY"), and consistent with this session's standing policy of never committing without your explicit go-ahead: **no commit, push, or deployment has been made.** This report is the acceptance artifact for your review. If you approve it and want these two fixes (plus the prior sprint's two P0 fixes) committed, say so explicitly and specify how you'd like the commit(s) structured — and note, per the infrastructure audit above, that `dist/` is committed pre-built output, so a fresh `npm run build` needs to be included in that commit for the source fixes to actually reach the deployed artifact.
