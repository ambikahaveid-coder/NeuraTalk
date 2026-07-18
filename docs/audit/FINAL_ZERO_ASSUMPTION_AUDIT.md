# NeuraTalk — Final Zero-Assumption End-to-End Production Audit

Method: 8 parallel code-reading audits across mobile (Flutter), web (React), telecom core, billing, admin/RBAC, enterprise B2B, external integrations/infrastructure, and backend code quality. Every finding below is anchored to a specific file:line read from the actual repository at audit time. No documentation, comment, or prior report was trusted as evidence — only executable code. Where code could not be exercised at runtime (no device, no live call, no production traffic from this environment), it is explicitly marked **NOT VERIFIED** or **ENGINEERING COMPLETE – NOT PRODUCTION VERIFIED** rather than assumed working.

---

## EXECUTIVE SUMMARY

NeuraTalk's core 1:1 calling path (LiveKit voice/video, web and now mobile, with real PSTN inbound/outbound via MSG91) is genuinely implemented, not a mockup — this is the strongest part of the product. Around that core, three classes of problem block a full production GO:

1. **A real financial race condition** in wallet reservation (`billing-engine.ts`) that permits double-spend under concurrent call starts — a P0.
2. **A process-crash risk**: Express 4 does not auto-forward async rejections, and several route handlers (confirmed: `server/routes.ts:454-473`) have no try/catch, so a single DB hiccup on those routes throws an `unhandledRejection` that this app's own handler responds to by **shutting the whole server down** — a P0 stability issue, not a theoretical one.
3. **Enterprise SLA reporting is partially fabricated** — `sla-management.ts` returns hardcoded `uptime: 99.95`, `avgCallQuality: 4.5`, and a `failedCalls` count computed as a fixed 0.5% of total rather than derived from real failure data. If this is shown to any real enterprise customer as their SLA number, that's a trust and possibly contractual/legal risk, not just a bug.

Beyond these, the audit found a wide gap between the *requested* product surface and what's *actually built*: every third-party integration in the "External Integrations" list (WhatsApp, Telegram, Zoom, Teams, Google Meet, Slack, Salesforce, HubSpot, Zoho) is missing except cosmetic link-text formatting; enterprise queue management and IVR are fully absent from the live call path despite having admin CRUD; mobile push notifications don't exist at all (no `firebase_messaging` dependency), so incoming calls only reach a foregrounded, alive app; and the two most critical backend modules (`smart-router.ts`, `billing-engine.ts`) have **zero test coverage**, not even incidental.

**Final Recommendation: NO-GO.** Two confirmed P0 code defects (financial race condition, process-crash-on-unhandled-rejection) exist. Per the audit's own rule, any P0 forces NO-GO regardless of how much else works.

---

## MODULE-BY-MODULE FINDINGS

### B2C Mobile (Flutter)
| Feature | Status | Evidence |
|---|---|---|
| Auth/OTP | Working | `auth_provider.dart:24-114` — real Firebase phone auth + backend token exchange |
| 1:1 calling | Working | `call_service.dart`, `call_screen.dart` (real `livekit_client` usage), `calls_screen.dart:225-238` wired to real `POST /api/calls/create` |
| Group calling | Working | `teams_screen.dart:159-191` wired to real `POST /api/calls/conference` |
| Incoming-call detection | Partial | 4s poll loop only (`main.dart:73-131`); works foreground/backgrounded-but-alive |
| Push notifications / killed-app calls | **Missing** | No `firebase_messaging` in `pubspec.yaml` — confirmed by grep |
| Wallet top-up / plan purchase | **Dead Code** | `wallet_screen.dart:86,146` — buttons are literal `onPressed: () {}` |
| Settings (profile, languages, voice clone, privacy, help) | **Dead Code** | `settings_screen.dart:22-42` — every tile except Logout is `() {}` |
| Voice clone (mobile) | **Missing** | No screen/service exists |
| Token storage | Security Risk | Plaintext `shared_preferences`, no `flutter_secure_storage` dependency |

### Web (React)
| Feature | Status | Evidence |
|---|---|---|
| 1:1 call flow | Working | `use-livekit-call.ts` — complete real LiveKit integration, SSE+poll fallback |
| Company dashboard | Working | `CompanyDashboard.tsx:115-121` real `useQuery` against `/api/b2b/company/dashboard` |
| Consumer `Dashboard.tsx` | Dead Code | Never imported by `App.tsx` — unreachable |
| Auth/OTP | Working | `Landing.tsx` real Firebase + server OTP flows |
| Payments | Working | `ConsumerDashboard.tsx:232-345` real Razorpay Checkout.js integration, no mock path found |
| Admin route gating | Partial | Client-side role gating is real (`App.tsx:143-165`) but is defense-in-depth only; server-side authorization on the same APIs not verified in this pass |
| Voice Clone UI | Working code, orphaned nav | `VoiceCloneSettings.tsx` fully functional and routed, but only reachable link lives inside dead `Dashboard.tsx` — no live nav path to it |
| Live-call captions/transcript | **Missing from primary path** | `TranslationSubtitles.tsx` only used in legacy, flag-gated `JoinCall.tsx`; zero usage in `C2CCallPage.tsx` |
| Error handling | Partial | Many secondary calls swallow errors in empty `catch {}` blocks (e.g. hold toggle) — silent failure, no user-facing signal |

### Telecom Core
| Feature | Status | Evidence |
|---|---|---|
| LiveKit room/token | Working | `livekit-service.ts:114-166` real SDK, resilience-wrapped, health-checked |
| PSTN outbound | Working | `smart-router.ts:1208-1247` + `pstn/msg91.ts:79-127` real HTTP call to MSG91, retried 3x |
| PSTN inbound + webhook auth | Working | `pstn/routes.ts:113-131`, HMAC-SHA256 signature verification, fail-closed if secret unset |
| Retry/reconnect (PSTN dial, translator-bot) | Working | Real backoff logic confirmed |
| Reconnect/resume for LiveKit-based calls | **Missing** | No server-side ICE-restart/rejoin logic for the smart-router path — delegated entirely to LiveKit client SDK |
| QoS telemetry (jitter, packet loss) | **Broken/Dead Code** | `recordJitter`/`recordPacketDrop`/`recordPacketReceived` defined in `observability.ts` but have **zero callers** anywhere — Prometheus-exported jitter/drop-rate are permanently 0 |
| Twilio legacy bridge | Working (parallel path) | Confirmed live and reachable via `/api/sim-calls/*`, not dead as previously assumed |
| Concurrency lock (double-booking) | Partial | Covers outbound `initiateCall`/`initiateConference`; **inbound PSTN calls never acquire the lock** — a callee can be double-booked |

### Billing/Payments
| Feature | Status | Evidence |
|---|---|---|
| Per-second call debit | Working | Redis-locked + DB transaction (`billing-engine.ts:1040,1108,1189`) |
| **Initial wallet reservation** | **P0 — Race Condition** | `startCallSession` (`billing-engine.ts:751-1014`) has no lock at all — confirmed double-spend scenario: two concurrent call starts on the same account can both reserve the same balance |
| Razorpay webhook signature | Working | HMAC-SHA256 + constant-time compare, audit-logged (`payment-service.ts:1141-1157`) |
| Webhook idempotency | Working | Per-transaction Redis lock + status re-check before crediting (`payment-service.ts:527-601`) |
| Recurring subscription auto-charge | **Partial/Missing** | Only grace-period suspension automation exists; no auto-renewal charge job found |
| Refunds | Working | Real Razorpay refund API calls, audit-logged |
| Invoicing | Partial | Real HTML generation; no PDF conversion implemented |
| Credit-limit enforcement | Working | `CREDIT_LIMIT_EXCEEDED` actually terminates the call, not just logs |
| Currency arithmetic | Working | Integer paise throughout, no float bugs found |

### Admin / RBAC / Audit Logging
| Feature | Status | Evidence |
|---|---|---|
| `admin-user-routes.ts` authorization | Working | All 9 routes gated by `requireAuth, requireRole("super_admin")` |
| `tenant-admin-routes.ts` authorization | Working | `requireSuperAdmin` applied consistently |
| `b2b-admin/routes.ts` authorization | Partial | No middleware-level check — relies on inline `isSuperAdmin()`/`isOrgAdmin()` calls per handler; correct today but structurally fragile |
| `requireCompanyAccess` middleware | **Dead Code / Security Risk** | Defined in `role-middleware.ts:753` specifically to prevent cross-org data access, **never imported or applied anywhere** |
| Audit logging | Working | Real `auditLogs` table, 40+ genuine write call sites across billing/auth/calls/admin |
| Audit logging gap | Partial | `b2b-admin/routes.ts` writes zero audit entries for DID/skill/caller-ID/virtual-number changes |
| Super-admin impersonation | Not present (N/A) | Feature doesn't exist in codebase |
| Voice clone moderation | **Missing — Trust/Security Risk** | No review/approval state; clones go straight from processing to `ready` with no human gate |
| Password hashing | Working | `scrypt`, salted, `timingSafeEqual` |
| Stale role check bug | Broken | `server/routes.ts:454-535` checks role against `"admin"`, which isn't a valid role in `ROLE_HIERARCHY` — `company_admin` users can never pass; over-restrictive functional bug |

### Enterprise B2B Telecom
| Feature | Status | Evidence |
|---|---|---|
| Skill-based routing | Partial | Real logic exists (`smart-router.ts:886-912`) but always invoked with an empty skills array from `pstn/inbound.ts:70` — degrades to "any available agent" |
| Department routing | **Missing** | CRUD-only, never referenced in the actual call path |
| Call queue (waiting/position/overflow) | **Missing** | CRUD-only, no enqueue/dequeue logic anywhere |
| Agent presence | Working (weak effect) | Real upsert/heartbeat; routing only reads a separate boolean flag, not the richer presence enum |
| Blind transfer (app-to-app) | Working | Real second-participant join |
| Blind transfer to PSTN | **Missing** | Explicit `400` — "not yet supported" |
| Attended transfer | **Dead Code / Stub** | Just tells the client to call a different endpoint manually; no real two-leg bridge |
| Conference calls | Partial | Real multi-participant LiveKit rooms; **no enforced participant limit** |
| Supervisor listen | Working | Real LiveKit join as room participant |
| Supervisor whisper/barge | **UI-only, not enforced** | Mode stored as metadata only; no differentiated publish/subscribe permissions issued |
| SLA metrics | **Broken — fabricated data** | Hardcoded `uptime: 99.95`, `avgCallQuality: 4.5`, `failedCalls` = fixed 0.5% of total, not real |
| Enterprise analytics/reporting | Working | Real DB aggregates |
| IVR | **Dead Code** | Fully built CRUD, explicitly bypassed in the actual inbound call handler |
| Virtual number / DID | Partial | Pooling/rotation over pre-loaded numbers; no live provisioning via a telecom provider API |

### External Integrations & Infrastructure
| Item | Status |
|---|---|
| WhatsApp, Telegram, Slack, Salesforce, HubSpot, Zoho | **Missing** — zero implementation code found |
| Zoom, Microsoft Teams, Google Meet | **Missing** — link-text formatting only, no real API integration |
| Public SDK/REST API for third parties | Working — `/api/sdk/*` real, API-key gated |
| Outbound webhooks | Partial — schema field exists, no dispatch logic |
| Sentry | Working — real init + active `captureException` usage |
| PostHog | Working — real init + active event capture |
| Prometheus/Grafana | Working — dashboards and provisioning committed in-repo (`infra/monitoring/grafana/`) |
| Backups | Partial — real scripts exist, but no cron/scheduler wiring found; appears manually triggered |
| SSL/DNS | External Dependency — correctly no custom cert code, relies on DO platform |
| Rate limiting | Working on auth/OTP/payment routes; full route-wiring completeness not exhaustively verified |
| Secrets logging | No leak found in this pass |

### Backend Code Quality
| Item | Status | Evidence |
|---|---|---|
| Test coverage on critical modules | **Missing** | `smart-router.ts`, `billing-engine.ts`, `role-middleware.ts`, `livekit-service.ts`, `routes.ts`, `production-routes.ts`, `production-metrics.ts` — zero coverage instrumentation AND zero test files reference them |
| Dead code (spot check) | Working | All 6 spot-checked "suspect" files are genuinely wired in, including the Twilio legacy bridge |
| TODO/FIXME density | Working | Effectively zero markers found |
| Unhandled async rejections | **P0 — Risk** | Express 4 (no auto-forwarding, no `express-async-errors`); confirmed bare handlers with no try/catch at `server/routes.ts:454-473`; an unhandled rejection there triggers `process`-level `shutdownServer(1)` — **one bad DB call can take down the whole server**, not just fail one request |
| Dangling `setInterval`s | Risk | 7 files (`billing-scheduler.ts`, `cleanup-job.ts`, `production-metrics.ts`, `production-routes.ts`, `rate-limit.ts`, `cache.ts`, `api-key-auth.ts`) never call `clearInterval`/`.unref()` — prevents clean shutdown, minor handle accumulation risk |
| Environment validation | Working | Hard-blocks startup on missing critical secrets, confirmed real enforcement |

---

## SCORES (0–100, evidence-based, not inflated)

| Category | Score | Basis |
|---|---|---|
| Consumer (B2C) Readiness | 55 | Core auth/calling/payments real; mobile push, wallet top-up, most settings are stubs |
| Enterprise (B2B) Readiness | 35 | Routing/presence/conference/supervisor-listen real; SLA fabricated, queue/IVR/attended-transfer missing or unwired |
| Telecom Readiness | 55 | Real LiveKit + PSTN in/out with signed webhooks; no QoS telemetry, no LiveKit reconnect/resume, inbound lock gap |
| AI Readiness (translation/STT/TTS/voice clone) | Not fully re-verified this pass — pipeline exists per earlier session findings; voice clone moderation confirmed **Missing** | — |
| Infrastructure Readiness | 60 | Sentry/PostHog/Grafana genuinely wired; backups unscheduled; single-service DO topology |
| Security Score | 45 | Real strengths (password hashing, signed+idempotent webhooks, rate limiting) undercut by the wallet race condition, absent voice-clone moderation, dead RBAC middleware, plaintext mobile token storage |
| Code Quality | 50 | Clean of debt markers and mostly well-wired, but the two highest-risk modules in the entire system have zero tests, plus a real process-crash class of bug |
| Test Coverage | ~25 | Only ancillary modules (payments, transcripts, PSTN registry, reliability) are covered; call orchestration and billing core are untested |
| Deployment Readiness | Conditional | Health checks fixed this session; Razorpay secrets, `METRICS_TOKEN`, and MSG91/SIP config still need operator confirmation |

**Final Production Readiness: ~45%.**

---

## BUGS BY SEVERITY

**Critical (P0 — blocks GO):**
1. Wallet reservation race condition / double-spend (`billing-engine.ts:751-1014`, no lock on `startCallSession`)
2. Unhandled async rejection crashes the whole process (Express 4, no forwarding, unguarded handlers e.g. `server/routes.ts:454-473`)

**High:**
3. SLA metrics fabricated/hardcoded (`sla-management.ts:93-111`) — risk if surfaced to real enterprise customers
4. Voice clone has no moderation/approval gate — identity misuse risk
5. Mobile push notifications entirely absent — incoming calls fail to reach backgrounded/killed app
6. `requireCompanyAccess` cross-org protection middleware is dead code, never applied
7. Zero test coverage on `smart-router.ts` and `billing-engine.ts` — the two riskiest modules in the system

**Medium:**
8. Inbound PSTN calls don't acquire the concurrency lock — double-booking risk
9. No server-side reconnect/resume for LiveKit-based calls
10. Attended transfer and blind-transfer-to-PSTN are stubs
11. Enterprise call queue and IVR are fully unwired despite complete CRUD/admin surfaces
12. Supervisor whisper/barge modes unenforced (UI label only)
13. Conference calls have no enforced participant limit
14. QoS telemetry (jitter/packet loss) permanently reports 0 — dead instrumentation
15. Mobile wallet top-up and nearly all settings screens are no-op stub buttons
16. `Dashboard.tsx` (web) and `VoiceCloneSettings.tsx` nav path are dead/orphaned
17. Live-call captions/transcript not wired into the primary web call flow
18. Backups exist as scripts but have no confirmed scheduler
19. Stale `"admin"` role check in `server/routes.ts:454-535` locks out valid `company_admin` users

**Low:**
20. 7 files with dangling `setInterval`s never cleared/unref'd
21. Invoice generation is HTML-only, no PDF
22. `b2b-admin` routes don't write audit log entries for sensitive org-config changes
23. Mobile auth token stored in plaintext `SharedPreferences`, not secure storage

**Carried forward from the prior P0 Production Recovery pass this session (see `docs/P0_PRODUCTION_RECOVERY_REPORT.md`):** `/readyz` and `/metrics` are now fixed in code. Razorpay production secrets, `MSG91_WEBHOOK_SECRET`, Object Storage vars, and a live SIP test call remain unconfirmed/unset in production — all pure operator actions, not code defects.

---

## MISSING FEATURES (vs. requested product scope)
WhatsApp, Telegram, Zoom, Microsoft Teams, Google Meet, Slack, Salesforce, HubSpot, Zoho integrations; enterprise call queue; IVR (built but unwired); department-based routing; attended call transfer; blind transfer to PSTN; mobile push notifications; mobile voice clone; outbound webhook dispatch; live-call captions on web; DID/virtual-number live provisioning (pooling only).

---

## OPERATOR TASKS
- Set Razorpay live-mode secrets in DO dashboard (carried from prior pass)
- Confirm/set `MSG91_WEBHOOK_SECRET`, `PUBLIC_OBJECT_SEARCH_PATHS`, `PRIVATE_OBJECT_DIR` in production
- Set `METRICS_TOKEN` to close the `/metrics` exposure
- Place one live PSTN/SIP test call against production to confirm the trunk actually works, not just "configured"
- Schedule the existing backup scripts on a real cron (currently appear manually triggered)

## DEVELOPER TASKS (P0/P1 before GO)
- Add a Redis lock (or `SELECT ... FOR UPDATE`) around the initial wallet reservation in `startCallSession`
- Add `express-async-errors` (or wrap all bare async handlers) so a DB error can't crash the process; audit `server/routes.ts` for unguarded handlers beyond the confirmed example
- Replace fabricated SLA numbers in `sla-management.ts` with real computed values, or clearly label them as estimates until real computation exists
- Add a moderation/approval state to the voice-clone pipeline
- Wire `requireCompanyAccess` into `b2b-admin/routes.ts` (or delete it if the inline pattern is the intended design — but pick one, don't leave a lookalike unused guard)
- Add the missing concurrency lock on inbound PSTN call creation
- Write tests for `smart-router.ts` and `billing-engine.ts` before further changes to either

## BUSINESS TASKS
- Decide whether to disclose the current external-integration gap (WhatsApp/CRM/etc.) to any prospect who was told these exist
- Decide whether mobile push notifications are a pre-launch blocker or a fast-follow, given calls silently fail to reach backgrounded/killed devices today

---

## GO-LIVE CHECKLIST (must all be true)
- [ ] Wallet race condition fixed and verified
- [ ] Unhandled-rejection crash risk fixed and verified
- [ ] Razorpay production secrets set, one real transaction completed
- [ ] One real production PSTN call placed and confirmed end-to-end
- [ ] `METRICS_TOKEN` set
- [ ] SLA numbers are real or clearly marked as placeholder in any customer-facing surface
- [x] `/readyz` fixed (this session)
- [x] `/metrics` auth gate added (this session)

## ROLLBACK CHECKLIST
- Confirm previous deployed revision/image tag on DO before deploying this session's `/readyz` and `/metrics` changes
- Since neither change alters data shape or migrations, rollback is a plain revert-and-redeploy — no DB rollback needed for these two fixes specifically

## DISASTER RECOVERY CHECKLIST
- Confirm backup scripts (`scripts/backup.sh`, `scripts/db-backup.mjs`) are actually scheduled, not just present
- Confirm a restore has ever been tested from a produced backup artifact (not verified in this audit)
- Neon/Upstash platform-level DR posture not verified in this audit — external dependency

## 30-DAY ROADMAP
Fix both P0s (wallet race, unhandled-rejection crash) → close Razorpay/SIP/metrics-token operator gaps → add voice-clone moderation gate → wire `requireCompanyAccess` → test `smart-router.ts`/`billing-engine.ts`.

## 90-DAY ROADMAP
Real SLA computation, mobile push notifications + secure token storage, attended transfer, enterprise queue + IVR wiring, QoS telemetry wiring, at least one real external integration (likely WhatsApp given market demand) if still on the roadmap.

---

## FINAL GO / NO-GO

**NO-GO.** Two confirmed P0 code defects exist (wallet double-spend race condition; unhandled-rejection process-crash risk). Per audit rules, any P0 forces NO-GO independent of what else works. Once both are fixed and verified, and the carried-forward operator actions (Razorpay, SIP verification, metrics token) are closed, this becomes a **Conditional GO** for core 1:1 consumer/agent calling — full enterprise-tier claims (SLA, queue, IVR, attended transfer, external integrations) should not be sold as complete until their respective gaps above are closed.
