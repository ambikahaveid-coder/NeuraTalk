# Current State Architecture

Evidence-based, not aspirational. Every classification below is backed by file:line evidence gathered from six parallel repository audits. Status legend: **REAL** (wired, working) · **PARTIAL** (real but incomplete/unverified) · **MOCK** (scaffolding only) · **MISSING** (does not exist).

## Identity, Auth, Core

| Capability | Status | Evidence |
|---|---|---|
| Phone OTP + password auth | REAL | Live in production; exercised throughout this engagement |
| RBAC | REAL | `server/role-middleware.ts` — role hierarchy, per-role permission sets, org-scoped overrides, session-backed `requireRole`/`requirePermission`/`requireMinRole` |
| Audit logging | REAL | `server/audit.ts`, `auditLogs` table, field sanitization before storage, admin UI tab |
| Feature flags | REAL | `server/feature-flags.ts` — DB-backed, kill-switch, rollout %, per-user override; explicitly self-hosted (not LaunchDarkly) |
| Session/device revocation | MISSING | `registeredDevices` has register (`controller.ts:1616`) and list (`controller.ts:1631`) only — no revoke/logout-elsewhere endpoint |

## Messaging & Calls

| Capability | Status | Evidence |
|---|---|---|
| 1:1 + group chat | REAL, but duplicated | Three independent systems — see `03_MESSAGING_CONSOLIDATION_PLAN.md` |
| Message encryption at rest | PARTIAL | Only group voice-audio path AES-256-GCM encrypted (`group-chats.ts:18-44`, key derived from `SESSION_SECRET` — server holds the key). Message text: zero encrypt/decrypt calls in `personal-chat-routes.ts`. Not E2E anywhere — see `08_E2E_PRIVACY_ARCHITECTURE.md` |
| Voice/video calls (LiveKit) | REAL | Smart-call state machine, billing-integrated, Redis-backed ACD queue |
| Live call translation (STT→translate→TTS) | PARTIAL | Code real (`translator-bot.ts`), all backing services configured in production (Azure Speech/Translator, Deepgram, LiveKit). **Never exercised end-to-end** — every test account shared `preferred_language="en"` until a live cross-language test was initiated this session; result pending at time of writing |
| Chat translation | PARTIAL | Same language-mismatch gate (`shared/call-behavior.ts:resolveTranslationEnabled`), same untested status |
| Block / report user | REAL | `server/blocking.ts` (block/unblock/list), `abuseReports` table + admin review (`production-routes.ts:837,870`) |
| Mute a person | MISSING | Only in-call audio mute exists; no server-side "mute this contact" |

## Telecom & Voice Infrastructure

| Capability | Status | Evidence |
|---|---|---|
| PSTN outbound/inbound (MSG91/Twilio) | PARTIAL | Real API calls, HMAC webhook verification, fails closed if secret unset (`server/pstn/msg91.ts:222-241`) |
| SIP trunk → LiveKit | PARTIAL | Wired defensively but code comments admit provisioning is unverified live (`registry.ts:130-165`) |
| IVR / digit-menu routing | MISSING | `server/pstn/inbound.ts:44-55` explicitly documents IVR was never ported — inbound calls fall to a general skill queue regardless of configured menu |
| Skill-based ACD queue | REAL | `queue-service.ts`/`queue-controller.ts` — self-described as the one queue path that is "genuinely, verifiably complete end-to-end" |

## AI Architecture

| Capability | Status | Evidence |
|---|---|---|
| Unified AI model gateway | MISSING | 13+ files independently `new OpenAI(...)`; Azure/Deepgram/Sarvam/ElevenLabs each called ad hoc from their own service file — see `05_AI_MODEL_GATEWAY_ARCHITECTURE.md` |
| STT provider registry | REAL | `server/providers/stt-provider-registry.ts` — real registry pattern, scoped only to STT |
| Generic AI agent runtime (tools/permissions) | MISSING | Zero tool-registry or agent-permission patterns anywhere in `server/` |
| AI-assists-human-agent (call coaching) | REAL | `server/enterprise/agent-assist.ts` — real-time Redis/WebSocket suggestions to a human call-center agent. Not a customer-facing agent |
| RAG / knowledge retrieval | MISSING | No vector DB, embeddings, or retrieval code anywhere |
| AI action risk-tiering | MISSING | No READ/SUGGEST/CONFIRM/EXECUTE/HIGH-RISK concept exists — see `06_AI_SECURITY_AND_PERMISSION_MODEL.md` |

## Business Platform

| Capability | Status | Evidence |
|---|---|---|
| Business/organization model | PARTIAL | `organizations` table is an enterprise call-center tenant model (departments, IVR, DIDs) — not a consumer storefront. No category taxonomy, no verification badge, no Flutter business-page UI |
| Product/service catalog | MISSING | No table, route, or screen |
| Business messaging templates | MISSING | Only hit is an MSG91 OTP template-ID passthrough, not a template management system |
| Marketing campaigns | MISSING | Zero matches for "campaign" anywhere in schema or server code |
| Business-configurable AI agents | MISSING | Nearest neighbor is human-agent-assist above — a different feature |
| Advertising | MISSING | No ad/sponsor tables or routes |
| Commerce (catalog→cart→checkout→order) | MISSING | No product/order/cart/delivery tables |
| Bookings/appointments | MISSING | No scheduling system |

## Payments & Billing

| Capability | Status | Evidence |
|---|---|---|
| Razorpay gateway | REAL | `server/payment-service.ts` (1294 lines) — order creation, signature verification, refunds, webhook + audit logging |
| Subscriptions & billing plans | REAL | Full lifecycle, 1712-line `billing-engine.ts`, admin plan CRUD, grace/resume/block |
| Prepaid wallet | PARTIAL | Real reservation/deduction server-side; mobile checkout deep-links to web Razorpay flow rather than native SDK (self-documented gap in `wallet_screen.dart`) |
| Invoices (GST) & refunds | REAL | Real generation, real gateway refund calls, idempotency-keyed |

## Trust, Safety & Compliance

| Capability | Status | Evidence |
|---|---|---|
| Fraud detection | PARTIAL | Real Redis velocity limiting + premium-rate-prefix blocking; explicitly no ML/anomaly detection; fails open on Redis outage |
| Rate limiting | REAL | Redis sliding-window + in-memory fallback, applied to auth/OTP/payments/queue |
| GDPR/DPDP export & delete | REAL | Real export endpoint; delete is a 30-day SLA request workflow, not instant |
| Call consent management | REAL | `call-privacy.ts` — genuinely enforced, blocks calls needing re-consent |
| Outbound webhooks | REAL | HMAC-signed, SSRF-defended at registration and delivery (DNS-rebinding aware) — unusually mature for this codebase |
| Self-serve developer API keys | PARTIAL | Schema + admin-issuance UI exist; no external self-serve console |

## Domain model summary

100 tables total. Full detail in `03_MESSAGING_CONSOLIDATION_PLAN.md` and `04_CALL_ARCHITECTURE_CONSOLIDATION_PLAN.md`. Headline debt:

- Three parallel messaging systems (`conversations/messages`, `personalChatThreads`, `groupChats`) with no shared abstraction.
- Two to three overlapping call-session models (`bridgedCalls` legacy vs `communicationSessions` vs `signalingSessions`), with weak/missing foreign-key constraints specifically on call tables.
- Four overlapping phone-number tables (`orgDIDNumbers`, `enterpriseNumbers`, `communicationVirtualNumbers`, `communicationMaskedNumberMappings`).
- Six overlapping settings/config tables.
- Several tables with only single-file usage, suggesting earlier half-finished initiatives (`callParticipants`, `holidayCalendar`, `environmentConfigs`, `dataResidencyPolicies`, `billingAnomalies`, `exotelStreamConfigs`, `costCenters`).
