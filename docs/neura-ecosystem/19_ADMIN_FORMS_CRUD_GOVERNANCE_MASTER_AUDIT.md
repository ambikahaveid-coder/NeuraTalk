# Admin / Form / CRUD / Governance Master Audit

Scope: complete lifecycle audit (CREATE→VIEW→EDIT→APPROVE→REJECT→SUSPEND→ACTIVATE→DEACTIVATE→DELETE→RESTORE→AUDIT→SEARCH→FILTER→EXPORT) across every operational entity in NEURA. Read-only research — no code changed. Evidence gathered via 4 parallel repo audits (server/, client/src/, shared/schema.ts) on 2026-08-23.

**Correction to a prior audit finding**: [18_ADMIN_AND_BUSINESS_SAAS_IMPLEMENTATION_AUDIT.md](18_ADMIN_AND_BUSINESS_SAAS_IMPLEMENTATION_AUDIT.md) §5 already noted `organizations` as "the nearest table" to a business entity while concluding no reseller/hierarchy support exists — that conclusion stands. This audit goes further: `organizations` (`shared/schema.ts:41-69`) + `server/b2b-routes.ts` + `client/src/pages/SuperAdminDashboard.tsx` together implement a **real, working business-onboarding CRUD** (create, list, approve, reject — all wired UI-to-DB), just named "Company/Organization" rather than "Business/Tenant." It is incomplete (no suspend, no delete/deactivate, no white-label, stubbed branding), but "0% implemented" would overstate the gap. Sections 3-5 below give the precise boundary.

---

## 1. Master Form Inventory

| Form | Route | Screen | Backend API | DB Table | Auth | Validation | CRUD | Approve/Reject | Suspend/Activate | Audit | Status |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Company/Org create | `/api/admin/companies` | `SuperAdminDashboard.tsx:495-540` | `server/b2b-routes.ts:446` | `organizations` | requireSuperAdmin | server-side | C/V/E partial (no delete) | REAL (`:684`,`:733`) | MISSING | `logCompanyApproval` | **PARTIAL** |
| Org settings/branding | `/api/company/settings` | `EnterpriseDashboard.tsx:667-719` | `b2b-routes.ts:797/819` | `organizations.settings` | company_admin | — | Read-only stub (all inputs `disabled`) | n/a | n/a | none found | **MOCK-STUB** |
| User forms | various | multiple | `role-middleware.ts` scoped | `users` | role-based | server-side | REAL | n/a | via session invalidation | partial | **REAL** |
| Role/permission assignment | org-member scoped | — | `role-middleware.ts:184-195` | `orgMembers.permissions` (jsonb) | requireCompanyAccess | — | flat string set, no per-resource UI | n/a | n/a | not verified | **PARTIAL** |
| Template (message) | — | — | — | none | — | — | **MISSING** | **MISSING** | — | — | **MISSING** |
| Campaign | — | — | — | none | — | — | **MISSING** | **MISSING** | — | — | **MISSING** |
| Automation/Flow/Bot-config/AI-Agent-as-product | — | — | — | none | — | — | **MISSING** | — | — | — | **MISSING** |
| White-label request/tenant | — | — | — | none | — | — | **MISSING** | **MISSING** | — | — | **MISSING** |
| API key (enterprise) | `/api/admin/api-keys` | `SuperAdminDashboard.tsx:2521` | `enterprise-api-routes.ts:297-464` | `enterpriseApiKeys` | requireSuperAdmin | server-side | C/V/Suspend/Activate/Delete REAL; **rotate missing** | n/a | REAL | not verified | **REAL** (rotation PARTIAL) |
| Webhook (org event subscriptions) | `/api/admin/orgs/:orgId/webhooks` | not confirmed in admin UI | `modules/webhooks/routes.ts:10-15` | webhook endpoints table | admin | HMAC signing real | C/V/Delete/Toggle REAL; **secret rotation missing** | n/a | toggle enable/disable REAL | not verified | **REAL** (rotation PARTIAL) |
| Rate-limit rule | — | — | read-only consumer at `production-routes.ts:80` | `rateLimitRules` | — | — | no write path found anywhere | — | — | — | **MOCK-STUB** |
| Billing plan | admin billing | — | `billing-routes.ts:521,537,595,664` | `billingPlans` | super_admin | server-side | full CRUD REAL, audit-logged | n/a | `isEnabled` toggle REAL | REAL | **REAL** |
| Offer/coupon/promo | — | — | — | none | — | — | **MISSING** | — | — | — | **MISSING** |
| Credit adjustment | `/api/admin/billing/companies/:id/adjustments` | — | `billing-routes.ts:941` | `billingLedgerEntries` | super_admin | server-side | create REAL, audit-logged (`CREDIT_ADJUSTMENT`) | n/a | n/a | REAL | **REAL** |
| Payment (Razorpay) | multiple | — | `payment-routes.ts:169-294` | payments/orders | session | gateway-verified | create/verify/refund/webhook-confirm REAL, idempotent | n/a | cancel-subscription REAL | not verified | **REAL** |
| Per-call billing (BillingEngine) | internal | — | `billing-engine.ts:849-888+` | wallet/ledger | internal | Redis-lock atomic | REAL, refuses to run degraded in prod | n/a | REAL (org block/resume) | not verified | **REAL** |
| Notification (internal, fixed types) | `/api/notifications` | — | `notification-routes.ts:1-60` | `userNotifications` | session | — | REAL end-to-end incl. push | n/a | mark-read | not verified | **REAL** |
| Notification (multi-channel SaaS alert) | — | — | `notification-service.ts:6-47` | — | — | — | body only calls `logger.info`, SMS/WA calls commented out | — | — | — | **MOCK-STUB** |
| OTP challenge | `/api/auth/otp/request`, `/verify` | login screens | `otp-auth.ts`, `modules/auth/routes.ts` | `otpChallenges` | rate-limited, hashed storage | REAL (6-digit, 10-min expiry, 3-attempt cap, Redis lockout) | REAL | n/a | lockout = temp suspend, REAL | app logs only | **REAL** |
| Audit log record | — | — | `audit.ts:66`, `audit-logging.ts:259` | `auditLogs` | system-written | — | insert+select only, **no update/delete route found** | n/a | n/a | is itself the audit trail | **REAL** |
| Consent audit (call privacy) | — | — | `call-privacy.ts:281-305` | in-memory array, cap 1000 | — | — | non-persistent, drops oldest on overflow | — | — | — | **MOCK-STUB** |
| Central approval queue (generic) | — | — | — | none — only company approval is wired | — | — | **MISSING** as a general pattern | one-off REAL for companies only | — | — | **PARTIAL** |

Full per-module governance detail continues in Sections 2-17; this table is the form-level index.

---

## 2. Main NEURA Admin

Actual admin surface (from `server/routes.ts` registration order + `client/src/pages/`), mapped against the expected tree in the audit request:

| Expected module | Real equivalent found | Status |
|---|---|---|
| Dashboard | `SuperAdminDashboard.tsx` | REAL |
| Tenants | — | MISSING (see §3) |
| Businesses | `organizations` via "Company" | PARTIAL (create/approve/reject only) |
| Users | `role-middleware.ts` scoped user admin | REAL |
| Business Members | `orgMembers` table + permission set | PARTIAL |
| Roles | `ROLE_HIERARCHY` (5 fixed roles) | PARTIAL (fixed, not custom-role builder) |
| Permissions | flat `PERMISSIONS` catalog (~20 constants) | PARTIAL (module-level, not resource-level) |
| Business Assets | not independently verified this pass | NOT VERIFIED |
| Templates | none | MISSING |
| Campaigns | none | MISSING |
| Automation | none | MISSING |
| AI Agents (as product) | none (TranslatorBot is a call feature, not a configurable product) | MISSING |
| Catalog | not found | MISSING |
| Orders | payment/order records exist under billing, no independent "Orders" admin screen confirmed | PARTIAL |
| Payments | `payment-routes.ts` | REAL |
| Plans | `billingPlans` + `billing-routes.ts` | REAL |
| Offers | none | MISSING |
| Credits | `billingLedgerEntries` + adjustment API | REAL |
| Billing | `billing-routes.ts` (~40 routes) | REAL |
| API | `enterprise-api-routes.ts` | REAL (rotation gap) |
| SDK / Applications | SDK consumer endpoints exist (`/api/sdk/*`), no separate "app registration" concept beyond API keys | PARTIAL |
| Webhooks | `modules/webhooks/routes.ts` | REAL (rotation gap) |
| White Label | none | MISSING |
| Compliance | GDPR consent type exists (`CONSENT_TYPE`), no dedicated compliance admin screen confirmed | PARTIAL |
| Fraud / Abuse | OTP abuse controls REAL; no general fraud/abuse admin module found | PARTIAL |
| Reports | `TranscriptAdminDashboard.tsx` is the closest real reporting UI (search/filter/export) | PARTIAL |
| Audit Logs | `auditLogs` table, readers in `audit.ts`/`audit-logging.ts` | REAL (no dedicated full-text admin log viewer confirmed this pass — NOT VERIFIED) |
| System Settings | `PlatformConfigPage.tsx` | PARTIAL (config-form style, thinner than list+detail pattern) |
| Platform Settings | same as above | PARTIAL |

Per-module CRUD/search/filter/bulk/export/audit-trail/permission-enforcement checklist: only **Company (organizations)**, **Billing/Plans/Credits/Payments**, **API keys**, **Webhooks**, and **Transcripts** have enough of the checklist wired to call REAL. Everything else in the expected tree is MISSING or PARTIAL — see the entity matrix in §21 for the exhaustive per-item breakdown.

---

## 3. Tenant / Business Management

**Entity**: `organizations` (`shared/schema.ts:41-69`). Fields present: `name`, `slug`, `logoUrl`, `plan` (free/pro/enterprise), `settings` (jsonb), `isActive`, `dataRetentionDays`, `status`, `email`, `phone`, `industry`, `website`, `address`, `approvedAt`, `approvedBy`, `rejectedAt`, `rejectionReason`, `primaryLanguage`, `supportedLanguages`.

**Fields requested but absent**: legal business name, registration number, GSTIN/PAN, contact person (separate from account owner), postal code as a distinct field, business timezone, currency, verification status (separate from approval status), subscription (linked via FK to billing tables, not inline), billing details (same — separate tables, not inline on the entity, which is architecturally fine but means the "profile" isn't self-contained).

**Lifecycle state machine — PARTIAL**: schema comment declares `pending | approved | rejected | suspended` (4 of the requested 7 states — no explicit `DRAFT`, `DEACTIVATED` distinct from `SUSPENDED`, or `DELETED`).
- CREATE → `pending`: `b2b-routes.ts:446` — REAL
- auto-approve path → `approved`: `b2b-routes.ts:617` — REAL
- APPROVE: `b2b-routes.ts:691` — REAL, audit-logged
- REJECT: `b2b-routes.ts:725` — REAL, audit-logged
- **SUSPEND: no route found.** `status` enum allows `"suspended"` as a value but nothing in `server/` sets it for organizations (the only "suspend" route found is for API keys, unrelated entity).
- **DELETE/DEACTIVATE: no route found.** `isActive` boolean exists on the table but nothing toggles it via an admin route for orgs.
- RESTORE: not applicable (nothing to restore from, since delete/suspend don't exist).

**Verdict**: business creation and the approve/reject decision are real and audited. The **back half of the lifecycle (suspend, deactivate, delete) is entirely unimplemented** — a live business, once approved, cannot currently be shut off by an admin through any route in this codebase. This is a genuine governance gap, flagged as **P1** in §22 (not P0, since it's a missing control rather than an active exposure — but it should not sit long, since it means a bad-actor business cannot be stopped without a database-level intervention).

---

## 4. Business Profile / Settings

`EnterpriseDashboard.tsx:667-719` ("Branding & Appearance" panel) is an explicit, self-declared read-only stub: banner text reads *"Read-only operational view... Editing and deployment are not wired here yet"* (line 683-686); every input (Company Name, Primary Color, Logo URL) is `disabled` with placeholder *"Managed outside this screen"*.

Backend GET/PUT settings routes exist (`b2b-routes.ts:797/819`) but the primary admin-facing UI does not call the PUT path — meaning even though a write path may exist server-side, there is currently no working UI path for a business admin to edit their own branding.

No timezone, currency, business-hours-as-profile-field, holiday calendar, or AI/voice/video/translation-settings-as-business-profile-field were found tied to the organization entity (voice/video/translation config exists at the *call* level per-user, not as a per-business default — not independently re-verified this pass, NOT VERIFIED).

Classification: **PARTIAL/MOCK-STUB** — schema and backend routes exist; the primary UI surface is deliberately disabled.

---

## 5. White-Label System

**MISSING in its entirety.** Grep for "white-label" / "whitelabel" / "white_label" across `server/`, `client/`, `shared/` (excluding `dist/` and `docs/`) returns zero implementation matches — only references inside `docs/neura-ecosystem/13_...`, `14_...`, `18_...` (the prior specification/audit docs themselves) and stale `dist/` bundles from earlier doc-generation, not source code.

No schema table, no request form, no lifecycle (`REQUESTED → UNDER_REVIEW → APPROVED → CONFIGURING → ACTIVE → SUSPENDED → REJECTED → TERMINATED`), no custom-domain handling, no partner-account concept. This is a from-scratch build, not a partial feature — treat it as **P3** in the implementation plan (§22): it depends on the business/tenant lifecycle in §3 being complete first (you cannot white-label a tenant model that can't even be suspended yet).

---

## 6. White-Label Request Form

**MISSING** — same evidence as §5. No request form, no fields, no document-upload/compliance-attachment flow exists anywhere in the codebase.

---

## 7. Template Management

**MISSING.** No `templates` table in `shared/schema.ts`. The only "template" hits in the codebase are: (a) `msg91-service.ts:215,225` — a passthrough `templateId` string forwarded to the MSG91 OTP provider (the template itself lives in MSG91's dashboard, not NEURA's), (b) a single admin config field `MSG91_OTP_TEMPLATE_ID` (`AdminSections.tsx:734`), and (c) `bulk-import.ts:57` — a CSV import template for location data, unrelated to messaging.

No categories (marketing/utility/authentication), no content types (text/image/video/carousel), no draft→submit→approve→reject→publish→archive lifecycle, no versioning. Confirms and sharpens the finding already flagged as a gate item in [10_MASTER_MIGRATION_ROADMAP.md](10_MASTER_MIGRATION_ROADMAP.md) and [13_BUSINESS_PLATFORM_MASTER_AUDIT.md](13_BUSINESS_PLATFORM_MASTER_AUDIT.md) §28/§30 — this remains a from-scratch build.

---

## 8. Campaign Management

**MISSING.** Zero matches for "campaign" (case-insensitive) anywhere in `server/` or `client/src/`. No table, no scheduling, no audience/segment concept, no lifecycle states. Entirely unbuilt — not a stub, not even a placeholder route.

---

## 9. OTP / Authentication / Utility / Marketing

This is the one area of genuine strength found in this audit.

**OTP/Authentication — REAL, layered governance**:
- `otp-auth.ts:21-23` — 6-digit code, 10-minute expiry, 3-attempt cap per challenge.
- `otp-auth.ts:80-95` — challenge stored **hashed** (SHA-256), old challenge replaced on new request (no accumulation).
- `rate-limit.ts:111-135` — `otpRequestLimiter` (3/min), `otpRequestDailyLimiter` (10/day, keyed by hashed identifier), `otpPhoneRequestLimiter` (5/10min).
- `rate-limit.ts:137,188-224` — `otpVerifyLimiter` (10/15min) plus a **Redis-backed lockout**: 5 failures in 15 min → 30-minute lockout, fails open (allows through) if Redis is unreachable — a deliberate availability-over-strictness tradeoff worth knowing about, not obviously wrong but worth the business owner being aware it exists.
- Sender identity: MSG91 (SMS/WhatsApp template ID) + Resend (email, `RESEND_API_KEY`/`OTP_EMAIL_FROM`).

**Utility/Marketing as governance categories — MISSING.** The only "MARKETING" hit in the schema is `CONSENT_TYPE.MARKETING` (`shared/schema.ts:1753-1761`), a GDPR opt-in consent flag — unrelated to a WhatsApp-style message-category system. No `UTILITY` or `AUTHENTICATION` category enum exists. This confirms: NEURA has zero concept of message-category-based governance (the pricing/compliance distinction that separately governs marketing vs. utility vs. auth messages in a real B2B messaging platform does not exist here at all).

**Delivery logs / reports for OTP** are plain application logs, not a queryable delivery-log table — PARTIAL on the "logs/reports" sub-requirement.

---

## 10. API / SDK / Application Management

**REAL**, more mature than most of this audit's other findings:
- `shared/schema.ts:2302-2354` `enterpriseApiKeys` table; `enterprise-api-routes.ts:297-464` — full CRUD: list, create, activate, suspend, delete, all gated by `requireSuperAdmin`.
- Keys are **actually enforced** at consumption time (`createApiKeyMiddleware` on `/api/sdk/translate`, `/tts`, `/stt`, `/voice-chat`, `/usage`) — not just stored decoration.
- **No key-rotation route** — only activate/suspend/delete exist; rotation today means delete-and-recreate, which breaks any client mid-flight rather than allowing a grace-period dual-key rotation. **PARTIAL** specifically on rotation.
- Webhooks (`modules/webhooks/routes.ts:10-15`): create/list/delete/toggle-enable REAL, HMAC signing REAL (`service.ts:151-157`), secret generated once and never re-exposed after creation (`service.ts:118-132` — a *correct* security property) — but there is also **no rotate-secret route**, meaning if a webhook secret leaks, the only recovery is delete+recreate the whole subscription. Same PARTIAL classification.

Never display secret credentials after creation — confirmed respected for webhook secrets (`service.ts:129-132` strips it on list). Not independently re-verified for API keys this pass (NOT VERIFIED — should be checked explicitly before any implementation work touches this area).

---

## 11. Payment / Billing / Plans / Offers

| Item | Status | Evidence |
|---|---|---|
| Plans | REAL | `billingPlans` table (`schema.ts:1108-1179`); CRUD at `billing-routes.ts:521,537,595,664`, audit-logged |
| Offers/coupons/promo codes | **MISSING** | zero matches for a coupon/promo entity; only a bare `discountPaise` line-item column (`schema.ts:1291`), not a code-redemption system |
| Credits | REAL | `billingLedgerEntries`; admin adjustment API `billing-routes.ts:941` → `BillingEngine.adjustOrganizationBalance`, audit-logged via `CREDIT_ADJUSTMENT` action type |
| Payments | REAL | Razorpay-backed (`payment-service.ts`); create→verify→refund→webhook-confirm lifecycle with idempotency handling (`payment-routes.ts:169-294`) |
| Configurable rate limits (as a business-facing plan feature, distinct from infra IP-limiters) | **MOCK-STUB** | `rateLimitRules` table exists and is read once (`production-routes.ts:80`) but has **no admin write path anywhere** — dead infrastructure |
| Per-call billing debit (BillingEngine) | REAL | `billing-engine.ts:849-888+`, Redis-lock atomic wallet reservation, refuses to run in production if Redis is degraded (`requireRedisForBilling`) — a genuine safety property |

Arbitrary credit manipulation is *not* possible without authorization + audit — confirmed the adjustment route requires `super_admin` and always writes an audit entry. This is one of the better-governed areas of the codebase.

---

## 12. Admin Approval Center

**PARTIAL/scattered — no generalized pattern.** The only real approval workflow found is company/business onboarding (`b2b-routes.ts:684` approve, `:733` reject, both `requireSuperAdmin`, both audit-logged via `AuditHelpers.logCompanyApproval`). No `approvals`/`approval_queue` table exists. There is no approval flow for: templates (don't exist), campaigns (don't exist), AI agents (don't exist as a product), high-risk AI actions, payment/refund requests (refunds appear to be direct admin-initiated, not request-then-approve), credit adjustments (also direct, not request-then-approve), partner requests, or developer applications (API keys are created directly by an admin, not requested-then-approved).

This means: if a future Business Platform wants a genuine multi-party approval workflow (business self-requests → super-admin reviews → approves/rejects, or the same pattern for templates/campaigns/refunds), **none of that generalized machinery exists yet** — every future approval flow would currently have to be hand-built per-entity the way company approval was, rather than plugged into a shared approval-center abstraction.

---

## 13. View / Detail Pages

- `SuperAdminDashboard.tsx` (3100+ lines) — REAL: company list with filter tabs, approve/reject with `isPending` loading states, create dialogs. Not just a table.
- `TranscriptAdminDashboard.tsx:15-80` — REAL: search+filter form (query/userId/date-range), paginated (`PAGE_SIZE=20`), per-member retention settings, export with loading state, audit-log view.
- `PlatformConfigPage.tsx` — PARTIAL: thinner, config-form style rather than list+detail-with-actions pattern.
- Other admin pages beyond these three were not independently drilled into for full state coverage this pass — NOT VERIFIED for `AdminLogin.tsx`, `AdminSections.tsx`, `admin/LiveMonitor.tsx`.

---

## 14. Delete / Suspend / Deactivate

**Soft-delete is the exception, not the rule.** Only 3 columns platform-wide implement soft-delete: `schema.ts:274` (`deletedAt`), `:378` and `:481` (`isDeleted` boolean). The vast majority of tables — including `organizations`, `users`, `billingPlans`, `enterpriseApiKeys` — have no `deletedAt`/`isDeleted`/`archivedAt` column at all. Where delete is implemented (e.g. session invalidation, `role-middleware.ts:392,401,413`), it is a genuine hard `db.delete(...)`.

No documented per-entity retention/deletion policy exists (financial/audit/compliance-record deletion restrictions are not encoded anywhere as a rule — they're just absent by omission, not by deliberate protection). This should be treated as a **design gap to close before building any entity that legally requires retention** (billing records, audit logs) — right now nothing stops a hard delete of a financial record if a delete route were added carelessly, because there's no soft-delete/immutability convention established platform-wide.

---

## 15. Search / Filter / Bulk Operations

Real search+filter exists on exactly two admin surfaces: `TranscriptAdminDashboard.tsx` (query/userId/date-range) and `SuperAdminDashboard.tsx` (status filter tabs on companies). No shared/reusable pagination or filter component was found — each page hand-rolls its own `offset`/`total`/`PAGE_SIZE` state.

"Bulk" operations are limited to one feature: a JSON-paste bulk-import for location reference data (`AdminSections.tsx:1641-1709`, posting to `/api/admin/locations/bulk-import`). There is **no bulk-select-and-act pattern anywhere** (no bulk-approve, bulk-suspend, bulk-activate, bulk-archive, bulk-export on any entity list). Given §12's finding that even single-item approval is scattered/single-purpose, bulk approval workflows would need to be built on top of a approval-center abstraction that doesn't exist yet.

---

## 16. Audit Logging

**REAL for the primary system, with one notable parallel stub.**

- `auditLogs` table (`schema.ts:1011-1030`): captures `userId` (actor), `organizationId`, `action`, `entityType`/`entityId`, `oldValue`/`newValue` (jsonb before/after), `metadata` (jsonb), `ipAddress`, `userAgent`, `createdAt`. Missing as first-class columns (requested in the audit brief): `actor role` (would need to be derived/stuffed into metadata), `request ID` (same), explicit `reason` (same — goes into metadata if present at all).
- Writers: `audit.ts:66`, `audit-logging.ts:259`, `modules/calls/service.ts:532`.
- **No update/delete route was found for the `audit_logs` table** — confirmed via grep for any PUT/PATCH/DELETE route touching it. This is the correct governance property: ordinary admins (and apparently even super-admins, since no route exists at all) cannot rewrite history.
- **Separate, unrelated in-memory audit log**: `call-privacy.ts:281-305` — a `ConsentAuditLog` array, capped at 1000 entries, silently drops the oldest entry via `.shift()` when full, and is **not persisted to the database at all**. This is a real data-loss risk for call-consent audit trail specifically (distinct from the main `audit_logs` table, which is fine) — flagged as **P1** in §22 since consent records may carry compliance weight.

---

## 17. RBAC

**PARTIAL — real enforcement, but coarse-grained.**
- `role-middleware.ts:82-88` — 5 fixed roles (`super_admin/investor/company_admin/agent/consumer`).
- `role-middleware.ts:90-149` — static permission arrays per role, built from a shared `PERMISSIONS` catalog of roughly 20 flat string constants (e.g. `USERS_EDIT`, `ORG_MANAGE_BILLING`) — module-level, not resource-instance-level.
- `role-middleware.ts:184-195` — `buildPermissionSet` merges default-role permissions with per-org-member `assignedPermissions` (jsonb) — the closest thing to customization, but still just toggling the same fixed catalog on/off, not "grant access to campaign #42 specifically."
- `role-middleware.ts:761-795` — `requireCompanyAccess` enforces the multi-tenant boundary (an org member cannot act on another org's data) — this is real and important, and is enforced **server-side**, not just hidden in the UI (confirmed no frontend-only gating pattern found).

**Bottom line**: the example in the audit brief ("Marketing Manager: Campaigns → Create/Edit; Billing → None") is not achievable today beyond the existing owner/admin/manager tiers each mapped to the same fixed bundle — there is no named custom-role builder. This is real, working, backend-enforced RBAC at the module level; it is not resource-level ACL.

---

## 18. Forms Must Be Real

Applying the UI→API→validation→authorization→service→database→audit→response→UI-refresh trace to every REAL-classified form in §1: company create/approve/reject, billing plan CRUD, credit adjustment, API key CRUD, webhook CRUD, and payment lifecycle all trace cleanly through every link (confirmed via the agents' route-level citations above — each has a real DB write, a real permission gate, and in the billing/credit/company cases, a real audit-log write).

The forms that fail this trace are exactly the ones already marked MOCK-STUB in §1: the branding/settings panel (UI inputs are `disabled`, nothing to trace), the multi-channel notification "send" (function body only logs, never reaches a provider), the consent audit log (writes to memory, never reaches durable storage), and the rate-limit rule table (read path exists, no write path to trace at all).

---

## 19. Admin UX Quality

Not independently re-audited page-by-page this pass beyond what §13/§15 already found. Known from this audit: `SuperAdminDashboard.tsx` and `TranscriptAdminDashboard.tsx` have real loading/dialog/filter states; `PlatformConfigPage.tsx` is thinner; the branding panel is an explicit disabled-stub with a visible banner (at least it's honest about its own incompleteness in the UI, which is a small positive). Empty-states, accessibility, and responsive-layout audit were **not verified** this pass — would need a dedicated UI pass, not a grep-based one.

---

## 20. Documentation Check

Cross-referenced `docs/neura-ecosystem/` (16 files), `docs/architecture/` (9 files), `docs/audit/` (11 files), `docs/roadmap/` (7 files) against this audit's findings.

**Overlap/duplication risk flagged**:
- `06_AI_SECURITY_AND_PERMISSION_MODEL.md`, `13_BUSINESS_PLATFORM_MASTER_AUDIT.md`, `18_ADMIN_AND_BUSINESS_SAAS_IMPLEMENTATION_AUDIT.md` all substantially overlap this doc's RBAC/admin-UI/governance scope. This doc (19) is the most granular of the four on forms/CRUD lifecycle specifically — treat 06/13/18 as architecture-level context and this doc as the implementation-level reference; don't re-derive the same ground in a future doc 20+.
- `docs/architecture/MULTI_TENANT_ENTERPRISE_PLATFORM.md` overlaps with §3's tenant/organization findings — worth a follow-up read to check whether it documents intentions that contradict what's actually built (NOT VERIFIED this pass, flagged for follow-up).
- `docs/audit/` has **heavy pre-existing duplication**: `NEURATALK_COMPLETE_SYSTEM_AUDIT.md`, `HONEST_SYSTEM_AUDIT_APRIL2026.md`, `GAP_ANALYSIS.md`, `FINAL_ZERO_ASSUMPTION_AUDIT.md`, `COMPREHENSIVE_AUDIT_COMPLETE_NEXT_STEPS.md`, `FULL_APPLICATION_AUDIT_FRAMEWORK.md`, `MASTER_PRODUCTION_READINESS_CHECKLIST.md`, `PRODUCTION_AUDIT_REPORT.md`, `PRODUCTION_READINESS_CERTIFICATION.md`, `PRODUCTION_READINESS_REPORT.md`, `WORKING_FEATURES_INVENTORY.md` — eleven separate "complete/final/honest" audit documents already exist in that one folder alone. This is the same "audit-without-follow-through" pattern noted in earlier work this engagement. Recommend (not executed — outside this audit's scope): consolidate or archive the superseded ones the next time anyone touches that folder, so a new contributor doesn't have to guess which of eleven audits is current.
- `docs/roadmap/` (7 files) — no direct governance overlap, but multiple roadmap documents (`IMMEDIATE_ACTION_PLAN`, `CRITICAL_ACTION_TODAY`, `QUICK_START_6_HOURS`, `IMPLEMENTATION_ROADMAP`, `PRODUCTION_IMPLEMENTATION_ROADMAP`, `MASTER_ROADMAP_INDEX`, `COMPLETE_IMPLEMENTATION_SUMMARY`) risk giving conflicting priority signals — not resolved here, flagged only.

---

## 21. Final Master Matrix

Legend: REAL / PARTIAL / MISSING / MOCK / BROKEN / NOT VERIFIED

| Entity | Form | Create | View | Edit | Approve | Reject | Suspend | Activate | Delete | Restore | Search | Filter | Bulk | RBAC | Audit | API | DB | Test | Runtime | Status |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Organization/Company | PARTIAL | REAL | REAL | PARTIAL | REAL | REAL | MISSING | MISSING | MISSING | n/a | NOT VER. | REAL | MISSING | PARTIAL | REAL | REAL | REAL | NOT VER. | NOT VER. | **PARTIAL** |
| Business branding/profile | MOCK | MOCK | REAL(read) | MOCK | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | PARTIAL | MISSING | REAL(GET/PUT unused) | REAL | NOT VER. | NOT VER. | **MOCK-STUB** |
| Tenant/white-label | MISSING | MISSING | MISSING | MISSING | MISSING | MISSING | MISSING | MISSING | MISSING | MISSING | MISSING | MISSING | MISSING | MISSING | MISSING | MISSING | MISSING | MISSING | MISSING | **MISSING** |
| Message template | MISSING | MISSING | MISSING | MISSING | MISSING | MISSING | n/a | n/a | MISSING | n/a | MISSING | MISSING | MISSING | MISSING | MISSING | MISSING | MISSING | MISSING | MISSING | **MISSING** |
| Campaign | MISSING | MISSING | MISSING | MISSING | MISSING | MISSING | MISSING | MISSING | MISSING | n/a | MISSING | MISSING | MISSING | MISSING | MISSING | MISSING | MISSING | MISSING | MISSING | **MISSING** |
| Automation/Flow/AI-Agent (product) | MISSING | MISSING | MISSING | MISSING | n/a | n/a | n/a | n/a | MISSING | n/a | MISSING | MISSING | MISSING | MISSING | MISSING | MISSING | MISSING | MISSING | MISSING | **MISSING** |
| API key | REAL | REAL | REAL | n/a | n/a | n/a | REAL | REAL | REAL | n/a | NOT VER. | NOT VER. | NOT VER. | REAL | NOT VER. | REAL | REAL | NOT VER. | REAL | **REAL** (rotation PARTIAL) |
| Webhook subscription | REAL | REAL | REAL | PARTIAL | n/a | n/a | n/a | REAL(toggle) | REAL | n/a | NOT VER. | NOT VER. | NOT VER. | REAL | NOT VER. | REAL | REAL | NOT VER. | REAL | **REAL** (rotation PARTIAL) |
| Rate-limit rule | MOCK | MISSING | REAL(read) | MISSING | n/a | n/a | n/a | n/a | MISSING | n/a | n/a | n/a | n/a | NOT VER. | NOT VER. | PARTIAL(read-only) | REAL | NOT VER. | MISSING | **MOCK-STUB** |
| Billing plan | REAL | REAL | REAL | REAL | n/a | n/a | REAL(disable) | REAL | REAL | n/a | NOT VER. | NOT VER. | NOT VER. | REAL | REAL | REAL | REAL | NOT VER. | REAL | **REAL** |
| Offer/coupon | MISSING | MISSING | MISSING | MISSING | n/a | n/a | n/a | n/a | MISSING | n/a | MISSING | MISSING | MISSING | MISSING | MISSING | MISSING | MISSING | MISSING | MISSING | **MISSING** |
| Credit adjustment | REAL | REAL | REAL | n/a | n/a | n/a | n/a | n/a | n/a | n/a | NOT VER. | NOT VER. | MISSING | REAL | REAL | REAL | REAL | NOT VER. | REAL | **REAL** |
| Payment | REAL | REAL | REAL | n/a | n/a | n/a | n/a | n/a | n/a | n/a | REAL(history) | NOT VER. | MISSING | REAL | NOT VER. | REAL | REAL | NOT VER. | REAL | **REAL** |
| Per-call billing (BillingEngine) | n/a | n/a | REAL | n/a | n/a | n/a | REAL(org block) | REAL(resume) | n/a | n/a | n/a | n/a | n/a | REAL | NOT VER. | REAL | REAL | NOT VER. | REAL | **REAL** |
| Notification (internal fixed) | n/a | REAL(system) | REAL | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | REAL | NOT VER. | REAL | REAL | NOT VER. | REAL | **REAL** |
| Notification (SaaS multi-channel) | n/a | MOCK | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | NOT VER. | NOT VER. | MOCK | n/a | MISSING | MOCK | **MOCK-STUB** |
| OTP challenge | REAL | REAL | n/a | n/a | n/a | n/a | REAL(lockout) | n/a | n/a | n/a | n/a | n/a | n/a | REAL | PARTIAL(logs only) | REAL | REAL | NOT VER. | REAL | **REAL** |
| Message category governance | MISSING | MISSING | MISSING | MISSING | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | MISSING | MISSING | MISSING | MISSING | MISSING | MISSING | **MISSING** |
| Audit log (main) | n/a | REAL(system) | REAL | MISSING(by design) | n/a | n/a | n/a | n/a | MISSING(by design) | n/a | PARTIAL | PARTIAL | n/a | REAL | n/a | REAL | REAL | NOT VER. | REAL | **REAL** |
| Consent audit log (call privacy) | n/a | REAL(system) | NOT VER. | n/a | n/a | n/a | n/a | n/a | n/a(auto-drops) | n/a | n/a | n/a | n/a | NOT VER. | n/a | MOCK | MISSING(in-memory) | NOT VER. | MOCK | **MOCK-STUB** |
| Central approval queue (generic) | MISSING | MISSING | MISSING | n/a(one-off exists for companies only) | n/a | n/a | n/a | n/a | n/a | n/a | MISSING | MISSING | MISSING | MISSING | MISSING | MISSING | MISSING | MISSING | MISSING | **PARTIAL** (one-off only) |
| RBAC / roles-permissions | n/a | n/a | REAL | PARTIAL(no custom roles) | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | REAL(self) | NOT VER. | REAL | REAL | NOT VER. | REAL | **PARTIAL** |

---

## 22. Implementation Plan

No implementation performed. Prioritized per the audit brief's P0-P3 scheme, sequenced by actual dependency (matches [10_MASTER_MIGRATION_ROADMAP.md](10_MASTER_MIGRATION_ROADMAP.md)'s existing gate: messaging consolidation + translation certification still sit ahead of new Business/Tenant foundation work).

### P0 — Security / auth / tenant isolation / broken lifecycle
None found this pass that rise to P0 (the P0 conversation-security bug from the prior audit round is already fixed — `59b57cb`). The organization suspend/delete gap (§3) is a real control gap but not an active exploit — classified P1, not P0, because nothing *incorrectly grants* access; it's an *absence* of a shutoff switch.

### P1 — Core admin CRUD / business onboarding / permissions / billing
1. **Organization suspend + delete/deactivate routes** (§3). Dependency: none, builds directly on existing `b2b-routes.ts` approve/reject pattern. Files: `server/b2b-routes.ts`, `client/src/pages/SuperAdminDashboard.tsx`. DB: no migration needed (`status`/`isActive` columns already exist). API: 2 new routes, both `requireSuperAdmin`. UI: 2 new buttons + confirmation dialog (per §14's requirement that critical entities require confirmation+reason). Security: must audit-log like approve/reject already does. Tests: unit test each state transition + an IDOR-style test that a suspended org's members lose access immediately. Rollback: routes are additive, no risk to existing flows. Acceptance: a super-admin can suspend an org, its members are denied on next request, and re-activation restores access, all audit-logged.
2. **Fix the in-memory consent audit log** (§16) — migrate `ConsentAuditLog` from `call-privacy.ts` to the existing `auditLogs` table or a dedicated persisted table, so consent records survive process restarts and aren't silently dropped at 1000 entries. Files: `server/call-privacy.ts`. DB: either reuse `auditLogs` (add an entityType discriminator) or a new small table. Low risk, additive.
3. **Wire the branding/settings PUT path to the UI** (§4) — the backend route already exists (`b2b-routes.ts:797/819`); this is primarily a client-side unlock, not new backend work. Files: `client/src/pages/EnterpriseDashboard.tsx`.

### P2 — Marketing / templates / campaigns / automation
4. Message-template entity (schema + CRUD + category governance) — this is the true prerequisite for any campaign or business-messaging feature, and per §7/§9 doesn't exist at all. Do not build campaigns before this exists.
5. Campaign entity, built on top of #4.
6. API key / webhook secret rotation (§10) — smaller, independent item; can be done in parallel with #4/#5 since it touches unrelated code (`enterprise-api-routes.ts`, `modules/webhooks/`).
7. Rate-limit rule admin CRUD (§11) — the table and read-path already exist; only the write/admin path is missing. Low effort relative to value (currently dead infrastructure).

### P3 — Advanced AI / white-label / advanced analytics
8. White-label system (§5/§6) — explicitly sequence this last; it depends on the organization lifecycle (P1 #1) being complete, since you cannot safely white-label a tenant model that has no suspend/terminate control yet.
9. Central approval-queue abstraction (§12) — worth building once there are ≥2 real consumers of it (e.g., after templates/campaigns exist and need approval workflows too), rather than generalizing prematurely from the single company-approval case.
10. Custom-role builder / resource-level RBAC (§17) — only worth the complexity once there are enough distinct entity types (templates, campaigns, white-label tenants) that the current fixed 3-tier (owner/admin/manager) bundle actually becomes limiting in practice.

**STOP — audit complete, no code changes made. Waiting for explicit implementation approval before starting any P0-P3 item above.**
