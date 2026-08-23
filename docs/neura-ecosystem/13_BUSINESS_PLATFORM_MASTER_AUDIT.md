# NEURA Business Platform Master Audit

**Status:** Audit + architecture only. No code changed, no UI built, no migrations run. This document supersedes nothing in `01-12` — it extends the Phase 0 audit with the specific business-communications-platform capabilities requested (multi-channel adapters, DLT/WhatsApp compliance, white-label tenancy, unified inbox, automation, event catalog). Where a finding duplicates Phase 0, it's cited, not re-derived.

**Evidence discipline, unchanged from Phase 0:** every REAL/PARTIAL/MISSING/BROKEN classification below is backed by a file:line or an explicit "verified absent" search — not inferred from a UI existing.

---

## 1. Current Business Capability

`organizations` table (`shared/schema.ts`) — an **enterprise call-center tenant** model (departments, IVR, DIDs, business hours as call-routing config), not a consumer-facing "business profile." Confirmed in Phase 0 (`01_CURRENT_STATE_ARCHITECTURE.md`). No product/catalog, no business messaging templates beyond an OTP passthrough, no campaigns. **PARTIAL** — real B2B tenant infrastructure exists, but shaped for call centers, not for the messaging-platform business model this request describes.

## 2. Current Messaging Capability

Three independently-built systems (AI chat, 1:1 personal chat, group chat) — no canonical message model, no `ChannelAdapter` abstraction of any kind. Confirmed real translation on the personal-chat path (`personal-chat-routes.ts:709-722`, verified this session). **REAL but fragmented** — see `03_MESSAGING_CONSOLIDATION_PLAN.md` for the existing consolidation plan this request must build on top of, not bypass.

## 3. Current Template Capability

**MISSING.** The only "template" hit anywhere in the codebase is `msg91-service.ts`'s `templateId` — a passthrough to MSG91's own OTP template ID, not a template management system. No draft/submit/approve lifecycle, no categories, no variables engine. Confirmed in Phase 0.

## 4. Current Campaign Capability

**MISSING.** Zero matches for "campaign" anywhere in `shared/schema.ts` or `server/`. Confirmed in Phase 0.

## 5. Current Automation Capability

**MISSING.** No trigger/condition/action flow builder, no workflow engine, anywhere in the codebase.

## 6. Current AI Capability

No AI model gateway (13+ files independently `new OpenAI(...)`), no agent runtime, no RAG, no risk-tiering. Confirmed in Phase 0 (`05_AI_MODEL_GATEWAY_ARCHITECTURE.md`, `06_AI_SECURITY_AND_PERMISSION_MODEL.md`, `07_RAG_AND_MEMORY_ARCHITECTURE.md`). The nearest-neighbor real feature is `server/enterprise/agent-assist.ts` — real-time coaching suggestions pushed to a *human* call-center agent, not a customer-facing AI agent. **MISSING** as requested (a business-configurable customer-facing AI agent with READ/SUGGEST/CONFIRM/EXECUTE/HIGH_RISK tiers).

## 7. Current Commerce Capability

**MISSING.** No product/order/cart/catalog tables anywhere. Confirmed in Phase 0.

## 8. Current Admin Capability

**REAL, and genuinely mature** — this is the strongest area of the whole platform. `client/src/pages/SuperAdminDashboard.tsx` (3544 lines) + `AdminSections.tsx` (1715 lines): companies, platform users, billing plans (B2C+B2B), enterprise API keys, third-party integrations, audit logs, GST/tax settings, employee roles, platform limits. Real RBAC (`role-middleware.ts`: role hierarchy, per-role permission sets, org-scoped overrides). Real audit logging (`audit.ts`/`audit-logging.ts`). Real moderation/abuse-report workflow. Confirmed in Phase 0.

**Gap against this request**: current admin architecture has exactly one tenant layer below Super Admin (`organizations`) — no Reseller/Partner layer, no white-label branding config anywhere in schema (verified absent — zero matches for `whiteLabel`, `reseller`, `tenantBranding`, `primaryColor` in `shared/schema.ts`).

## 9. Current White-label Capability

**MISSING, verified absent.** No reseller/partner concept, no per-tenant branding (logo, colors, domain, favicon) anywhere in the schema or codebase.

## 10. Current B2C Capability

REAL: discover contacts, chat, call, video call, translate (verified this session with real device tests), block/report (Phase 0), notification controls. **MISSING**: browse business catalogs, place orders (no commerce exists at all, per §7).

## 11. Current B2B Capability

Manage customers/agents via the enterprise call-center path (real: departments, agent skills, queue routing — confirmed in earlier Phase 0 audit and this session's PSTN/queue investigation). **MISSING**: campaigns, templates, catalog, automation, customer-facing AI agents — all zero, per §4-7.

## 12. Current Channel Capability

| Channel | Status | Evidence |
|---|---|---|
| NEURA-native (app-to-app chat/calls) | REAL | Extensively verified this session |
| PSTN voice | PARTIAL | Real MSG91/Twilio calls; IVR routing explicitly never ported (`pstn/inbound.ts:44-55`, Phase 0 finding) |
| SMS | PARTIAL | Real MSG91 OTP delivery only — no general-purpose SMS sending, no DLT template workflow (see §13) |
| WhatsApp | **MISSING, verified absent** | Only hit anywhere is an aspirational code comment in `notification-service.ts:41` ("3. WhatsApp (MSG91)") next to a log line claiming delivery "via Push\SMS\WA" — the function above it does not actually send WhatsApp messages. No WhatsApp Business API integration exists. |
| Email | **MISSING, verified absent** | Zero matches for `sendEmail`, `nodemailer`, `sendgrid`, or any SES call anywhere in `server/` |
| Push | REAL | Firebase, verified and fixed this session (dead-token pruning) |

## 13. Current Compliance Capability

**DLT (India SMS regulatory compliance): MISSING, verified absent.** The only DLT-adjacent text in the codebase is a doc comment in `msg91-service.ts:9` describing that *MSG91 the provider* offers a "DLT registration helpdesk" — this describes the vendor's external offering, not a workflow NEURA has built (no Principal Entity/Header/Consent Template/Consent Record tables or routes exist anywhere).

**GDPR/DPDP**: REAL — export and 30-day-SLA delete request workflow confirmed in Phase 0 (`server/gdpr-routes.ts`).

**Consent management**: REAL for calls specifically (`call-privacy.ts`, confirmed genuinely enforced in Phase 0), general consent scopes also real via GDPR routes.

## 14. Missing Capabilities (consolidated)

Business messaging templates, campaigns, automation/flow builder, customer-facing AI agents, commerce/catalog, WhatsApp channel, Email channel, general-purpose SMS, DLT compliance workflow, white-label/reseller tenancy, unified multi-channel inbox, canonical event catalog (only 2 event types currently dispatched — see §22), developer self-serve API console (Phase 0: admin-issued keys only, no self-serve).

## 15. Broken Capabilities

None newly found in this pass beyond what Phase 0 and this session's live investigations already surfaced (`BILLING_SESSION_NOT_FOUND` runtime-sweep bug — real, tracked, untouched).

## 16. Duplicate Architectures

Same finding as Phase 0, directly relevant here: **three parallel messaging systems** (`03_MESSAGING_CONSOLIDATION_PLAN.md`) are exactly the kind of fragmentation this request's "canonical message model" (§2 of the request) would make worse if a fourth (multi-channel) system were bolted on before consolidation. **This is the single most important sequencing constraint in this whole audit.**

## 17. Target Architecture

The request's own layering (Identity → Tenant → Contact → Conversation → Message → Template → Channel Adapter → Campaign → Automation → AI Agent → Commerce → Analytics) is sound and consistent with Phase 0's target architecture (`02_TARGET_NEURA_ARCHITECTURE.md`). The `ChannelAdapter` interface is new relative to Phase 0 and is the correct abstraction — but it must be built **on top of** the canonical `CONVERSATION`/`PARTICIPANT`/`MESSAGE` model from `03_MESSAGING_CONSOLIDATION_PLAN.md`, not parallel to it. A `WhatsAppAdapter`/`SMSAdapter`/`EmailAdapter` should each produce/consume the same canonical `MESSAGE` shape that the existing 1:1 and group chat get consolidated onto.

## 18. Canonical Data Model

Extends `03_MESSAGING_CONSOLIDATION_PLAN.md`'s `CONVERSATION`/`PARTICIPANT`/`MESSAGE` with:

```
CHANNEL              id, type: 'neura'|'whatsapp'|'sms'|'email'|'voice'|'push', config (per-tenant credentials)
CONVERSATION.channelId → CHANNEL          (which channel this conversation is happening on)
TEMPLATE              id, businessId, category, type, status, variables, channelId (a template is channel-specific for approval purposes, per §4's requirement not to fake Meta/DLT approval)
TEMPLATE_APPROVAL      templateId, channel, providerStatus, rejectionReason, submittedAt, resolvedAt   -- mirrors the REAL external provider's status, never fabricates one
CAMPAIGN               id, businessId, templateId, audienceId, channel, status, schedule
AUTOMATION_FLOW        id, businessId, trigger, nodes (condition/action/wait/branch/AI/handoff graph)
TENANT                 id, parentTenantId (nullable, for reseller hierarchy), type: 'platform'|'reseller'|'enterprise'|'business', branding
```

`TEMPLATE_APPROVAL` is deliberately separate from `TEMPLATE` — per the request's own explicit rule (§4), NEURA must never pretend to control Meta's or DLT's approval; this table exists to *mirror* the real provider's status, sourced from real webhook/polling integration with that provider, not to simulate approval.

## 19. Tenant Model

The request's hierarchy (Super Admin → Platform Admin → Reseller/Partner → Enterprise/Organization → Business → Team → Agent → Viewer) requires a genuinely new `TENANT` concept — the current `organizations` table has no `parentTenantId` and no branding fields at all (verified absent, §9). This is additive schema work, not a rewrite of `organizations` — `organizations` becomes one node type in the tenant tree (the "Enterprise/Organization" level), with `Business` (already scoped as a new entity in `09_BUSINESS_PLATFORM_ARCHITECTURE.md`, ADR-003) as a child, and a new `Reseller`/`Partner` level above it.

## 20. RBAC Model

Existing `role-middleware.ts` RBAC (real, confirmed in Phase 0) already supports fine-grained `PERMISSIONS` constants and org-scoped overrides — the exact permission strings requested (`messages.send`, `templates.approve`, `campaigns.launch`, etc.) are a **vocabulary extension** of the existing system, not a new RBAC engine. Building a second permission system here would be the same duplication mistake flagged in §16.

## 21. Approval Model

Six independent approval centers requested (WhatsApp Template, SMS/DLT, Business Verification, Campaign, AI Agent, High-Risk Action). The AI Agent and High-Risk Action approval flows should reuse the READ/SUGGEST/CONFIRM/EXECUTE/HIGH_RISK framework already designed in `06_AI_SECURITY_AND_PERMISSION_MODEL.md` — not a seventh parallel permission concept. WhatsApp Template and SMS/DLT approval centers are genuinely new (§18's `TEMPLATE_APPROVAL` table) since they mirror external regulatory/platform state NEURA doesn't control.

## 22. Event Model

**PARTIAL, real infrastructure, thin catalog.** Outbound webhook delivery is real and production-grade (HMAC-signed, SSRF-defended at registration and delivery — confirmed in Phase 0, `server/modules/webhooks/`). But only **two** event types are actually dispatched anywhere in the codebase today: `translation.started` (`event-bridge.ts:49`) and `recording.ready` (`controller.ts:1098`). The rich canonical catalog requested (`message.created`, `conversation.assigned`, `template.approved`, `campaign.started`, `order.created`, etc.) does not exist yet — but the delivery mechanism it would ride on already does. This is a low-risk extension (more event types through an existing, working pipe), not new infrastructure.

## 23. API Model

Real foundation: `enterpriseApiKeys` table + admin-issuance UI (Phase 0). **Gap**: no self-serve external-developer console, no OAuth, no sandbox, no published API docs. This matches Phase 0's Phase 14 (Developer Platform) — unchanged finding, cited not re-derived.

## 24. UI Information Architecture

Not designed in this pass (audit + architecture only, per your explicit instruction). The Business Console sections requested (Dashboard/Inbox/Contacts/Segments/Messaging/Templates/Campaigns/Automation/AI/Commerce/Catalog/Reports/Channels/API/Webhooks/Developers/Billing/Security/Compliance/Settings) map cleanly onto the canonical model in §18 — each section is a view over one or more of those entities, not a separate subsystem.

## 25. Security Model

Existing real primitives to build on, not replace: RBAC (`role-middleware.ts`), audit logging (`audit.ts`), rate limiting (real, Redis-backed, confirmed Phase 0), webhook HMAC signing + SSRF defense (confirmed Phase 0), GDPR export/delete (real). **Explicit correction for this request**: do not claim E2E encryption — confirmed in Phase 0 (`08_E2E_PRIVACY_ARCHITECTURE.md`) that current encryption is server-side only, on one narrow field. Any business-platform messaging built on the canonical model inherits that same honest status until the four-privacy-mode design in that document is actually implemented.

## 26. Compliance Model

DLT (§13) and WhatsApp Business verification are the two genuinely new compliance workflows this request requires — both must integrate with real external state (DLT registry, Meta's own approval), never simulate it, per the request's own explicit rule.

## 27. Migration Plan

No migration needed yet — this is additive schema (TENANT, CHANNEL, TEMPLATE, TEMPLATE_APPROVAL, CAMPAIGN, AUTOMATION_FLOW) layered on top of the canonical messaging model that itself is still mid-migration per `03_MESSAGING_CONSOLIDATION_PLAN.md`. **Sequencing dependency, not optional**: the channel adapters in §2/§18 need the canonical `MESSAGE` shape to exist first, or they become a fourth parallel messaging system — exactly the duplication this document's §16 and the request's own §22 explicitly warn against.

## 28. Phase-by-Phase Roadmap

Extends `10_MASTER_MIGRATION_ROADMAP.md` (Phases 0-14) rather than replacing it:

| New Phase | Scope | Depends on existing roadmap phase |
|---|---|---|
| 7a | Tenant hierarchy + white-label branding | Phase 7 (Business identity) |
| 8a | Template engine + TEMPLATE_APPROVAL (WhatsApp/DLT mirroring) | Phase 8 (Business messaging + templates) |
| 9a | ChannelAdapter interface + WhatsApp/SMS/Email adapters | Phase 2 (Messaging consolidation) — **hard dependency**, and Phase 4 (AI Gateway, for AI-assisted channel routing) |
| 9b | Business AI agent permission tiers reusing §21 | Phase 9 (Business AI agents), Phase 5 (RAG+Memory+Permission framework) |
| 10a | Automation/flow builder | Phase 9a (channels must exist for actions to send through) |
| 10b | Campaign engine + A/B testing | Phase 8a (templates), Phase 10 (Marketing) |
| 14a | Self-serve developer console + OAuth + webhooks docs | Phase 14 (Developer platform) — event catalog (§22) extension happens here |

## 29. P0/P1/P2 Risks

- **P0**: Building channel adapters before messaging consolidation (Phase 2) completes would create a fourth parallel messaging system — the exact anti-pattern this document and the original request both explicitly forbid.
- **P0**: A fabricated or implied WhatsApp/DLT "approval" status (rather than mirroring the real provider's) would be a regulatory and trust liability — the request itself flags this correctly.
- **P1**: No white-label/tenant-branding schema exists at all — building the Reseller/Partner layer is greenfield work, not an extension.
- **P1**: Building AI-agent approval and high-risk-action approval as separate systems from the already-designed `06_AI_SECURITY_AND_PERMISSION_MODEL.md` tiers would duplicate that work.
- **P2**: Event catalog is thin (2 types) relative to what campaigns/automation/commerce will need — low-risk to extend given the delivery pipe already works.

## 30. Exact First Implementation Phase

**Not this.** Per the roadmap dependencies in §28, the correct first phase remains what `10_MASTER_MIGRATION_ROADMAP.md` and the current session's active work already establish: finish Phase 1 (translation certification — in progress) and Phase 2 (messaging consolidation — not yet started). Everything in this document (channels, templates, campaigns, white-label) is additive on top of that foundation. Starting any business-platform phase before Phase 2 completes would mean building the `ChannelAdapter` layer against three different, soon-to-be-consolidated message shapes — real, avoidable rework.

**No code changes made in this pass**, per your instruction.
