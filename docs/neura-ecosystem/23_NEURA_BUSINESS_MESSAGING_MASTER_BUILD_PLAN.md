# NEURA Business Messaging Platform — Master Build Plan

Architecture and dependency plan only. **No production code, no migrations, no deployment written in this pass.** Independent product — no WhatsApp API, no Meta dependency, no proprietary Meta implementation. Cross-references [13_BUSINESS_PLATFORM_MASTER_AUDIT.md](13_BUSINESS_PLATFORM_MASTER_AUDIT.md), [18](18_ADMIN_AND_BUSINESS_SAAS_IMPLEMENTATION_AUDIT.md), [19](19_ADMIN_FORMS_CRUD_GOVERNANCE_MASTER_AUDIT.md) rather than restating them.

## 1. Current state (evidence-based, re-verified this pass)

**Real and reusable as-is:**
- `organizations` + `orgMembers` + `customRoles` (business/tenant model) — real, has the 7-state lifecycle governance built this session (`server/modules/b2b-admin/org-lifecycle.ts`).
- `PERMISSIONS` catalog + `role-middleware.ts` (25 constants, 9 middleware functions) — real, backend-enforced, zero messaging-domain permissions exist yet.
- `billingLedgerEntries`, `billingPlans`, Razorpay payment lifecycle, per-call `BillingEngine` — real.
- `enterpriseApiKeys`, `webhookEndpoints`/`webhookDeliveries` (HMAC-signed, retry-tracked) — real, but `WEBHOOK_EVENT_TYPES` is currently a 7-value call/translation/recording-only enum with zero messaging events.
- `auditLogs` + `AUDIT_ACTION` — real, already has `APPROVE`/`REJECT`/`SUSPEND` primitives suitable for reuse.
- Calls + translation foundation — real (per this engagement's long history of physical-device verification work).

**Missing entirely (confirmed via direct schema/code search, not inferred):** templates, campaigns, audiences/segments, business-facing OTP/utility/marketing send APIs, automation flows, business-side inbox, white-label, generalized approval queue (only company-approval exists), resource-level RBAC.

**Messaging systems — the load-bearing finding for this whole plan:** three fully independent, non-consolidated systems currently exist:

| System | Tables | Sole consumer |
|---|---|---|
| AI chat | `conversations`, `messages` | `server/ai_integrations/chat/storage.ts` |
| Personal chat (1:1) | `personalChatThreads`, `personalChatMessages` | `server/personal-chat-routes.ts` |
| Group chat | `groupChats`, `groupChatMembers`, `groupChatMessages` | `server/group-chats.ts` |
| (adjacent) Voice memos | `voiceMemos` | `server/voice-memos.ts` |

`docs/neura-ecosystem/03_MESSAGING_CONSOLIDATION_PLAN.md` proposed a canonical `CONVERSATION`/`CONVERSATION_PARTICIPANT`/`MESSAGE`/`MESSAGE_DELIVERY_STATE` model in this same 2026-08-23 session. **It has not been implemented** — `git log --follow` on that doc shows exactly one commit (its own authoring); every messaging-touching commit since has added *more* divergence to the existing three systems, none has consolidated them. Per the explicit instruction in this build's brief: **this is marked a blocking dependency, not a nice-to-have** — see Section 3.

## 2. Target architecture (end state)

```
Business (organizations)
 ├─ Team (orgMembers) ── Roles (customRoles, expanded PERMISSIONS)
 ├─ Business Profile / Branding (business_settings, brand_settings)
 ├─ Customers (customers, contacts, tags, segments)
 ├─ Templates (templates, template_versions) ──approval──> Approval Center
 ├─ Campaigns (campaigns) ──uses──> Templates + Audiences ──sends via──> Canonical Messaging
 ├─ Authentication messaging (OTP engine, business-facing)
 ├─ Utility messaging (event-triggered, canonical event catalog)
 ├─ Automation (automation_flows, flow_runs)
 ├─ Inbox (reads Canonical Messaging, business-scoped)
 ├─ AI Agents (gated behind AI Gateway/permission model/RAG — docs 05/06/07)
 ├─ Reporting (derived from real delivery/campaign/usage events only)
 ├─ Billing/Credits (existing infra, extended with messaging usage types)
 └─ API/SDK (existing enterpriseApiKeys/webhookEndpoints, extended event catalog)

All messaging — AI chat, personal chat, group chat, AND business messaging —
flows through ONE canonical Conversation/Message model. Business messaging
is a new *type* on that model ("business"), not a fourth parallel system.
```

## 3. Messaging dependency analysis — BLOCKING

**Canonical entities** (adopting doc 03's proposal, since it was evidence-based and not superseded):
- `CANONICAL CONVERSATION`: `id`, `type` (`ai` | `direct` | `group` | `business`), `organizationId` (nullable — only set for `business` type), `createdAt`, `metadata` (jsonb, type-specific: e.g. `businessId`/`customerId` for business type).
- `CANONICAL PARTICIPANT`: `conversationId`, `participantType` (`user` | `ai_agent` | `business` | `customer`), `participantId`, `role`, `joinedAt`, `leftAt`.
- `CANONICAL MESSAGE`: `conversationId`, `senderParticipantId`, `messageType` (text/image/video/document/template/voice), `content`, `translations` (jsonb, reusing the existing per-message translation shape already proven in `personalChatMessages`/`groupChatMessages`), `templateId` (nullable, set for business messages sent from a template), `category` (nullable: `authentication`/`utility`/`marketing`, set only for business messages), `createdAt`.
- `CANONICAL MESSAGE_DELIVERY_STATE`: `messageId`, `participantId`, `status` (queued/sent/delivered/read/failed), `statusAt`, `failureReason`.
- `CANONICAL ATTACHMENT`: reuses existing attachment/media-URL patterns already in `groupChatMessages`/`personalChatMessages` (S3-backed), generalized to a join table keyed by `messageId`.
- `CANONICAL TRANSLATION`: the existing `translations` jsonb shape (language → translated text) already proven across 2 of the 3 systems — standardize on it, don't redesign it.
- `CANONICAL DELIVERY EVENT`: maps 1:1 onto `MESSAGE_DELIVERY_STATE` transitions, and is what feeds both the future Reporting module (Section 15) and the webhook event catalog extension (`message.sent`, `message.delivered`, `message.read`, `message.failed`).

**Why this blocks everything downstream**: Templates render into Messages. Campaigns send Messages. OTP/Utility/Marketing are Message *categories*. Inbox reads Messages. Reporting aggregates Message delivery events. If Business Messaging is built against a 4th parallel schema instead of the canonical one, this project repeats the exact mistake doc 03 already diagnosed — permanently, since by the time anyone notices, three more features will depend on the wrong table.

**Recommendation — do the minimum viable consolidation, not the full 6-step migration from doc 03, before Phase 1 starts:**
1. Create the 4 canonical tables (`conversations_v2`/`messages_v2`-style naming to avoid colliding with the existing AI-chat `conversations`/`messages` tables during transition, OR rename the existing AI-chat tables since they're the smallest and most self-contained of the three — **this exact naming decision needs explicit approval before Phase 0 starts, flagged here rather than assumed**).
2. Point **only new development** (Business Messaging) at the canonical tables from day one. Do **not** attempt to migrate personal-chat/group-chat consumer-facing traffic in this initiative — that's doc 03's full migration, a separate, larger, riskier project with its own dual-write/backfill/cutover plan already written. Trying to do both at once multiplies risk for no Business-Messaging benefit.
3. This means Business Messaging's canonical tables are net-new (Section 19), and the "consolidation" achieved by this plan is narrower than doc 03's original scope: it stops the count from becoming *four* parallel systems, without yet collapsing the existing three. That full collapse remains future work, tracked separately.

**Blocking gate**: Phase 1 (Section 26) cannot start until this naming/scoping decision is explicitly approved — it's a one-way door (schema names are painful to change after data exists).

## 4. Template architecture

**Entity**: `templates` — `id`, `businessId` (FK organizations), `name`, `category` (authentication/utility/marketing), `language`, `content` (structured: body text with `{{variable}}` placeholders, header, footer, buttons array), `mediaType`/`mediaUrl`, `status`, `currentVersionId`, `createdBy`, `updatedBy`, `createdAt`, `updatedAt`.

**Entity**: `template_versions` — `id`, `templateId`, `versionNumber`, `content` (full snapshot), `createdBy`, `createdAt`. Every edit creates a new version; `templates.currentVersionId` points at the live one. Rejected-and-resubmitted content is a new version, not an overwrite — preserves the rejection's exact content for audit.

**Lifecycle** (exactly as specified): `DRAFT → SUBMITTED → UNDER_REVIEW → APPROVED → PUBLISHED → PAUSED → ARCHIVED`, with `SUBMITTED → REJECTED → (edit, new version) → SUBMITTED` as the rework loop. Implemented via the same `assertLegalTransition`-style guard pattern already built for organization lifecycle (`server/modules/b2b-admin/org-lifecycle.ts`) — reuse the pattern, not the code (different entity, same discipline: a `LEGAL_TRANSITIONS` map + a guard function per entity).

Every transition writes to `auditLogs` with `entityType: "template"`, actor, timestamp, and (for reject) a mandatory reason — reusing `AUDIT_ACTION.APPROVE`/`REJECT` which already exist, no new audit-action enum values needed.

## 5. Approval architecture (generalized, per explicit instruction — do not hardcode to templates)

**Entity**: `approval_requests` — `id`, `entityType` (template/campaign/business_verification/refund/credit_adjustment/white_label/ai_high_risk_action/partner_onboarding), `entityId`, `requesterId`, `reviewerId` (nullable until claimed/decided), `status` (PENDING/APPROVED/REJECTED/CANCELLED), `reason`, `evidence` (jsonb — free-form supporting data per entity type), `createdAt`, `decidedAt`.

This is a **thin routing/queue layer**, not a business-logic engine: approving an `approval_requests` row does not itself mutate the underlying entity — it calls back into that entity's own state-transition function (e.g. approving a template's request calls the template lifecycle's `approve()`, same pattern org-approval already uses via `b2b-routes.ts`'s direct call, just now routed through a shared queue instead of a one-off route). This avoids the approval center becoming a second source of truth for entity state.

**RBAC**: who can approve a given `entityType` is determined by a permission-per-entity-type map (e.g. `TEMPLATES_APPROVE`, `CAMPAIGNS_APPROVE`, `CREDIT_ADJUSTMENTS_APPROVE`), checked via the existing `requirePermission()` middleware — no new authorization mechanism needed, only new `PERMISSIONS` constants (Section 16).

**Reuse note**: the existing company-approval flow (`b2b-routes.ts:684/718`) is **not** migrated onto this new table in this plan — that would be unrelated scope creep into already-working code. New approval types (starting with templates) use the new table; company approval stays as-is unless a future, explicitly-scoped pass decides to unify it.

## 6. Customer / audience architecture

**Entities**: `customers` (business-owned contact records — **not** platform `users`; a business's customer is identified by phone/email and may never sign up for a NEURA account) — `id`, `businessId`, `phone`, `email`, `name`, `attributes` (jsonb, arbitrary business-defined fields), `consentStatus`, `optedOutAt`, `createdAt`. `customer_tags` (many-to-many tag join). `segments` — `id`, `businessId`, `name`, `definition` (jsonb — a **structured, whitelisted** filter tree, not arbitrary code).

**Segment definition safety** (explicit instruction: "do not implement arbitrary query execution from user input"): the `definition` jsonb is a constrained AST of `{field, operator, value}` leaf nodes combined via `AND`/`OR`/`NOT` groups, where `field` must be one of a fixed whitelist (tag membership, attribute keys with typed comparators, last-campaign-response, purchase-date-range) and the backend compiles this AST into parameterized Drizzle query conditions server-side — the client never sends raw SQL or a query string, only the structured tree. This is the same discipline already used elsewhere in this codebase for parameterized queries; no new pattern invented, just applied to a new domain.

**Import/export**: reuses the existing bulk-import pattern already proven for location reference data (`AdminSections.tsx:1641-1709`, `/api/admin/locations/bulk-import`) — same JSON/CSV-paste mechanism, new endpoint, new target table.

## 7. Campaign architecture

**Entity**: `campaigns` — `id`, `businessId`, `name`, `templateId`, `segmentId` (or ad hoc audience list), `scheduledAt`, `timezone`, `frequencyCapPerCustomer`, `throttlePerMinute`, `status`, `createdBy`.

**Entity**: `campaign_events` — per-send record: `campaignId`, `customerId`, `messageId` (FK into canonical `MESSAGE`), `status`, `statusAt`. This is where Reporting (Section 15) reads real numbers from — never computed/estimated.

**Lifecycle** (as specified): `DRAFT → REVIEW → APPROVED → SCHEDULED → RUNNING → PAUSED → COMPLETED → FAILED → ARCHIVED`. `REVIEW → APPROVED` routes through the Approval Center (Section 5, `entityType: "campaign"`).

Sending uses the canonical Message-creation path exclusively — a campaign "send" is: resolve audience (segment → customer list) → for each customer, create a canonical `MESSAGE` (category: marketing, templateId set) addressed to a business↔customer `CONVERSATION` → dispatch through the same delivery pipeline authentication/utility messages use (Sections 8-9) → record a `campaign_events` row per send. No separate send mechanism.

## 8. OTP / authentication messaging engine

**Distinct from** the existing `otpChallenges`/`otp-auth.ts` system, which is NEURA's own **platform login** OTP — this is a **business-facing** capability: a business's own application requests NEURA send an OTP to *their* customer. New entity: `business_otp_requests` — `id`, `businessId`, `customerId`/`phone`, `codeHash`, `templateId` (must be category=authentication), `expiresAt`, `verifiedAt`, `attempts`, `maxAttempts`.

**Reuse, don't rebuild**: the actual delivery mechanics (MSG91 SMS/WhatsApp-style provider call, Resend email, hashed storage, rate-limit-and-lockout pattern) are already fully built and hardened in `server/otp-auth.ts` + `server/rate-limit.ts` (`otpRequestLimiter`, `otpVerifyLockoutCheck`) — this new engine wraps those same primitives with a business-scoped, credit-metered, template-driven interface rather than reimplementing OTP delivery from scratch. Never log OTP values (already the standing pattern — `sanitizeForAudit()` in `server/audit.ts` already redacts any key containing "otp").

Authentication category messages are **never** eligible for campaign/marketing sending — enforced at the canonical `MESSAGE.category` level: the campaign-send code path only accepts `category: marketing` templates, structurally, not by convention.

## 9. Utility messaging (event-triggered)

**Canonical event catalog**: extends the existing `WEBHOOK_EVENT_TYPES` array (`shared/schema.ts`, currently 7 call/translation/recording values) with business-domain events: `order.created`, `payment.completed`, `payment.failed`, `booking.created`, `booking.updated`. This is additive to a plain string array — low risk, matches how the array is already structured.

**Entity**: `utility_message_triggers` — `id`, `businessId`, `eventType` (from the extended catalog), `templateId` (must be category=utility), `isEnabled`. When a business's integration (via their API key, Section 20) posts one of these events, the trigger fires: resolve the template, render variables from the event payload, send via the canonical Message path (same as Section 8/7's send mechanism), record delivery.

No new event-catalog duplication (explicit instruction) — one array, extended, reused by webhooks AND utility triggers AND (later) automation flows (Section 11).

## 10. Marketing architecture

Covered structurally by Sections 6-7 (Customers/Audiences, Campaigns). This section defines the **safety layer** required before any marketing send is allowed to leave the system: consent check (customer `consentStatus` must permit marketing), opt-out check (`optedOutAt` must be null), frequency cap (per-customer, per-campaign, enforced via `campaign_events` lookback), credit-limit check (via existing `BillingEngine`/`billingLedgerEntries` — a campaign cannot start if the business's available balance can't cover the audience size × per-message rate), and abuse/rate protection (reusing `server/rate-limit.ts`'s existing factory pattern, scoped per-business rather than per-IP).

All five checks are enforced server-side in the campaign-send pipeline, not just at campaign-creation time — a business's credit balance or a customer's opt-out status can change between scheduling and send time.

## 11. Automation / flow architecture (deferred — see Section 26 phase ordering)

**Entities**: `automation_flows` (`id`, `businessId`, `name`, `definition` — jsonb graph of trigger→condition→action→delay nodes, same "structured, not arbitrary code" discipline as Section 6's segment definitions) and `flow_runs` (per-execution instance, `flowId`, `customerId`, `currentNodeId`, `status`, `startedAt`).

Triggers reuse the Section 9 event catalog. Actions include "send template" (reuses Sections 7-9's send path), "start AI agent" (gated — see Section 13), "wait"/"branch" (pure flow-control, no external effect). This is the highest-complexity, highest-risk component in the whole plan and is correctly sequenced last among the "core" phases (Section 26) — everything it needs (templates, triggers, canonical messaging) must already exist and be stable.

## 12. Inbox architecture

Business Inbox is a **read/action UI over the canonical Conversation/Message model**, filtered to `type: business` conversations where `organizationId` matches the logged-in business admin's org (tenant isolation enforced the same way `requireCompanyAccess` already enforces it elsewhere). No new message-storage entity — Inbox is a view, not a system. Actions (assign/reassign/tag/note/mute/block/close/reopen) are new small tables (`conversation_assignments`, `conversation_notes`) keyed off the canonical `conversationId`, each action audit-logged per the existing pattern.

## 13. AI integration — explicitly gated

Per the explicit instruction, Business AI Agents are **not** designed in detail here beyond noting the dependency: they must be built on top of the AI Model Gateway (doc 05), AI Security/Permission Model (doc 06), and RAG/Memory Architecture (doc 07) — none of which are confirmed implemented in this pass (out of this plan's research scope; the prior architecture docs describe them as *proposed*, not verified-built). **Flagged as a hard blocking dependency for Phase 11 (Section 26)** — do not start AI-agent work until those three docs' implementation status is separately verified.

## 14. Billing integration

No new billing system (explicit instruction). Messaging usage extends the existing `billingLedgerEntries` debit pattern with new usage-type discriminators (`message_authentication`, `message_utility`, `message_marketing`), each debit created at send-time through `BillingEngine`'s existing atomic-reservation machinery (the same Redis-lock pattern already proven for per-call billing, `server/billing-engine.ts`). Plan-level included quotas (e.g. "500 free marketing messages/month") extend `billingPlans`'s existing `limits` jsonb field rather than adding new plan-table columns.

## 15. Reporting integration

Every reported number must trace to a real row: message counts from `campaign_events`/canonical `MESSAGE_DELIVERY_STATE`, template usage from `templates`/`template_versions`, OTP stats from `business_otp_requests`, credit/billing from existing ledger tables. **No dashboard metric is built before its underlying event table exists and is being written to in production** — this is the explicit instruction and it rules out the common shortcut of shipping a reporting UI against placeholder/estimated data "to unblock frontend work."

## 16. RBAC

Extend `PERMISSIONS` (`shared/schema.ts:228-260`) with new constants, grouped exactly per the requested role examples, checked via the **existing** `requirePermission()`/`requireAnyPermission()` middleware (no new middleware needed):

`TEMPLATES_VIEW/CREATE/EDIT/SUBMIT/APPROVE/PUBLISH/ARCHIVE`, `CAMPAIGNS_VIEW/CREATE/EDIT/APPROVE/RUN/PAUSE`, `AUDIENCES_VIEW/CREATE/EDIT`, `CUSTOMERS_VIEW/CREATE/EDIT/EXPORT`, `INBOX_VIEW/VIEW_ASSIGNED/ASSIGN/CLOSE`, `AUTOMATION_VIEW/CREATE/EDIT/ACTIVATE`, `MARKETING_REPORTS_VIEW`.

`customRoles` (already real, org-scoped, jsonb permission list) is the mechanism for composing these into named roles like "Marketing Manager" or "Support" — **no new role-storage table needed**, this table already exists and already supports arbitrary named roles per org; it's simply unused for messaging permissions today because those permissions don't exist yet.

## 17. Security

- **Authentication**: existing `requireAuth`/session model, unchanged.
- **RBAC**: Section 16, backend-enforced only (matches this codebase's existing standard — confirmed no frontend-only-authorization pattern exists anywhere in the current admin surface).
- **Tenant isolation**: every new table carries `businessId` (→ `organizations.id`); every new route follows the existing `requireCompanyAccess`/`isOrgAdmin` pattern already proven correct for webhooks and org-scoped B2B routes (tested this session via `tests/unit/company-access-tenant-isolation.test.ts` and `tests/unit/webhook-idor.test.ts` — same pattern, same test style, to be replicated per new entity).
- **IDOR**: every entity fetch/mutate scopes its WHERE clause by both the record id AND `businessId`, not id alone — the exact discipline already enforced (and regression-tested) in the webhook module.
- **Rate limiting / abuse / consent / opt-out**: Section 10.
- **API/webhook security**: reuses existing HMAC-signed webhook infra and API-key middleware unchanged (Sections 20).
- **Audit logging**: every state-changing action on every new entity writes to the existing `auditLogs` table (Section 4/5's pattern), no new audit infrastructure.
- **Data export/deletion**: customer records must be included in any future GDPR export/deletion flow (`server/gdpr-routes.ts` already exists for platform users — business-owned customer PII needs the same treatment, flagged as a requirement for Phase 4, not designed in full here since it depends on Phase 4's exact customer schema).

## 18. Tenant isolation

Restated as a single hard rule threading through every section above: **Business A must never read, write, or infer the existence of Business B's data** — customers, templates, campaigns, conversations, credits, or approval requests. Enforced structurally (every table has `businessId`, every query scopes by it, every route gates via `requireCompanyAccess`-equivalent), not by convention, and every new entity gets an IDOR regression test before its phase is considered complete (Section 27).

## 19. Data model — full proposed entity list, mapped against current schema

| Proposed entity | New table? | Maps to / extends existing | Notes |
|---|---|---|---|
| Business | **No new table** | `organizations` | Reused as-is, per doc 19's finding |
| Business members/roles | **No new table** | `orgMembers`, `customRoles` | Reused as-is |
| Permissions | Extend existing | `PERMISSIONS` const (Section 16) | Additive constants only |
| Business settings/branding | New | none (currently a disabled UI stub only) | `business_settings`, `brand_settings` |
| Customers | New | none | `customers` — explicitly NOT `users` |
| Contacts/tags | New | none | `customer_tags` |
| Segments | New | none | `segments` |
| Templates | New | none | `templates` |
| Template versions | New | none | `template_versions` |
| Approval requests | New | reuses `auditLogs`/`AUDIT_ACTION` for the audit trail, new table for the queue itself | `approval_requests` |
| Campaigns | New | none | `campaigns` |
| Campaign events | New | none | `campaign_events` |
| Message usage (billing) | Extend existing | `billingLedgerEntries` | New usage-type discriminators, no new table |
| Automation flows | New | none | `automation_flows` |
| Flow runs | New | none | `flow_runs` |
| Business OTP requests | New | reuses `otp-auth.ts`/`rate-limit.ts` delivery mechanics | `business_otp_requests` |
| Utility message triggers | New | extends `WEBHOOK_EVENT_TYPES` array | `utility_message_triggers` |
| Canonical conversation | New (see Section 3's naming caveat) | supersedes-for-new-traffic-only the 3 existing systems | `conversations`(v2)/... — exact naming pending approval |
| Canonical message | New (same caveat) | same | — |
| Canonical participant | New (same caveat) | same | — |
| Canonical delivery state | New (same caveat) | same | — |
| Conversation assignment/notes | New | keyed off canonical conversation | Inbox-only (Section 12) |

No proposed table duplicates an existing one — every "New" row above was verified absent from `shared/schema.ts` by the research pass behind this document.

## 20. API map (representative, not exhaustive — full route list is an implementation-phase deliverable, not an architecture-phase one)

| Area | Routes (indicative) | Reuses |
|---|---|---|
| Templates | `POST/GET/PATCH /api/business/:businessId/templates`, `POST .../:id/submit`, `.../approve`, `.../reject`, `.../publish`, `.../archive` | `requireCompanyAccess`, new `TEMPLATES_*` permissions |
| Approval center | `GET /api/admin/approvals?entityType=`, `POST /api/admin/approvals/:id/decide` | `AUDIT_ACTION.APPROVE/REJECT`, entity-type→permission map |
| Customers/segments | `POST/GET/PATCH /api/business/:businessId/customers`, `.../segments`, `.../import`, `.../export` | Existing bulk-import pattern |
| Campaigns | `POST/GET/PATCH /api/business/:businessId/campaigns`, `.../schedule`, `.../pause` | Approval center, canonical send path |
| Business OTP | `POST /api/business/:businessId/otp/send`, `.../verify` | `otp-auth.ts` internals, `enterpriseApiKeys` auth |
| Utility triggers | `POST/GET /api/business/:businessId/utility-triggers` | Extended event catalog |
| Inbox | `GET /api/business/:businessId/inbox`, `.../conversations/:id/assign` | Canonical conversation model |
| API/SDK (existing, unchanged) | `/api/admin/api-keys/*`, `/api/admin/orgs/:orgId/webhooks/*` | Already real (this session's rotation work included) |

## 21. Admin (Super Admin) screens

New: Approvals (generalized queue UI, entityType filter tabs), Templates (cross-business moderation view), Campaigns (cross-business oversight), Customers (aggregate, privacy-gated), White-label (Phase 12). Extends existing: Businesses screen (already has suspend/reactivate/deactivate from this session), Plans/Credits/Payments (extend with messaging usage line items), Audit Logs (already generic, just gains new `entityType` values to filter by).

## 22. Business Admin screens

Per the explicit list: Dashboard, Business Profile (replaces the current disabled stub — real implementation, Phase 1), Branding, Team, Roles, Customers, Templates, Campaigns, Audiences, Automation, Inbox, AI (gated), Reports, Billing, Credits, API, Webhooks (both already real and reusable), Settings.

## 23. Implementation phases (dependency-ordered)

The requested phase list is accepted with one adjustment: **Phase 0 (messaging foundation) is confirmed blocking per Section 3** and Phase 1 is redefined as "Business Messaging domain foundation on top of the canonical model," not a parallel effort.

- **Phase 0 — Canonical messaging foundation.** Create the 4 canonical tables (naming decision required first, Section 3). No existing system migrated yet. Acceptance: a trivial business→customer message can be created, stored, and delivery-state-tracked end to end, with zero changes to AI/personal/group chat behavior.
- **Phase 1 — Business domain foundation.** `business_settings`/`brand_settings` (replacing the disabled stub), `customers`, extended `PERMISSIONS`. No templates/campaigns yet.
- **Phase 2 — Template engine.** Full lifecycle (Section 4), no send capability yet — templates can be created/approved but not used.
- **Phase 3 — Approval center.** Generalized queue (Section 5), retrofitted onto templates from Phase 2 (templates become the first real consumer).
- **Phase 4 — Customers/audiences.** Segments, tags, import/export, GDPR-export extension (Section 17).
- **Phase 5 — Campaign engine.** Requires Phases 0-4 complete. First real send capability, marketing category only initially.
- **Phase 6 — Authentication/OTP messaging.** Independent of campaigns (Section 8), can run in parallel with Phase 5 if resourced separately.
- **Phase 7 — Utility messaging/event catalog.** Requires Phase 0 (canonical send path) and extends the shared event catalog Phase 6 doesn't need but Phase 9/11 will.
- **Phase 8 — Marketing automation (campaign safety layer).** Section 10's five checks, hardening Phase 5 before wider rollout.
- **Phase 9 — Business Inbox.** Requires Phase 0 stable in production (reads real conversation data).
- **Phase 10 — Reporting.** Requires Phases 5-9's event tables to exist and be populated for at least one real cycle — do not build dashboards against empty tables.
- **Phase 11 — AI agents.** Blocked on doc 05/06/07 verification (Section 13) — separate go/no-go gate, not just a phase-ordering dependency.
- **Phase 12 — White-label.** Requires the org lifecycle (already done this session) plus a stable, tested Business Admin surface (Phases 1-10) — white-labeling an unstable product multiplies support cost.

## 24. P0 / P1 / P2 risks

**P0**: the Section 3 naming/scoping decision is a one-way door — get it wrong and every phase built on it inherits the mistake. Must be explicitly decided (not defaulted) before any Phase 0 code is written.

**P1**: automation (Phase 11... Section 11/Phase 8 area — flow engine) is the highest-complexity component with the least precedent in this codebase (no existing "graph of conditional actions" pattern to reuse, unlike everything else in this plan which extends something real). Recommend a design spike before full implementation, even after approval.

**P1**: AI-agent gating (Section 13) depends on three architecture docs whose *implementation* status (not just their existence as design docs) hasn't been independently re-verified in this pass — treat "doc exists" and "doc's design is actually built" as separate facts, the same distinction this entire engagement has insisted on elsewhere.

**P2**: segment/flow "structured definition" JSON schemas (Sections 6, 11) need careful validation-library selection during implementation — a sloppy implementation of "not arbitrary code execution" can still end up as an effective SQL-injection-equivalent if the AST-to-query compiler isn't itself carefully reviewed. Flagging now so it's not treated as a routine CRUD task during implementation.

**P2**: this plan does not migrate the existing three messaging systems (Section 3's scoping decision) — meaning end users of personal/group chat gain nothing from this initiative, and the codebase will have 4 messaging-adjacent schemas (3 legacy + 1 canonical-for-business) for an indefinite period until a separately-scoped full consolidation happens. Acceptable per explicit instruction to keep scope narrow, but worth the business owner knowing this tradeoff explicitly rather than discovering it later.

## 25. Acceptance criteria (per phase, applying the UI→API→auth→DB→logic→audit→tests→runtime chain from doc 19 §18)

Every phase in Section 23 is complete only when, for each entity it introduces:
- **UI**: real screen, not a stub (matches the standard already set — no repeat of the disabled branding panel).
- **API**: routes exist, validated (zod or equivalent, matching existing patterns), return real errors not silent failures.
- **RBAC**: gated by a real `PERMISSIONS` constant, backend-enforced, with a passing test proving a user without the permission is rejected.
- **Tenant isolation**: passing IDOR-style test proving Business A cannot reach Business B's instance of the entity (same style as `tests/unit/webhook-idor.test.ts`/`company-access-tenant-isolation.test.ts`).
- **Validation**: server-side, not just client-side.
- **Audit**: every state-changing action writes a real `auditLogs` row with actor/reason/timestamp.
- **Tests**: unit tests for the entity's own logic (lifecycle transitions, etc.) plus the isolation test above.
- **Runtime verification**: per the standing "Production Verified" rule (doc 20 §6/doc 21) — deployed, build-identity-confirmed, and behavior-probed before being called done, not just "deployment ACTIVE."
- **Rollback**: additive migration only (matches this session's established discipline — new nullable columns/tables, no destructive schema changes without an explicit down-migration).
- **Performance**: no requirement stated beyond "does not regress existing call/billing/auth latency" — no new SLA invented here; if one is wanted, it should be specified explicitly before Phase 5 (campaign send, the first bulk-operation phase) begins.

---

**Plan complete. No code, no migrations, no deployment. Stopping and waiting for explicit implementation approval — starting with the Section 3 naming/scoping decision, which blocks Phase 0.**
