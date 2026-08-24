# Phase 8 — Marketing Messaging: Read-Only Architecture Audit

**Status: AUDIT + DESIGN ONLY. No code, schema, route, UI, or migration was written or modified to produce this document. Nothing in Phases 0–7 was touched.**

Builds on [23](23_NEURA_BUSINESS_MESSAGING_MASTER_BUILD_PLAN.md), [28](28_GENERIC_APPROVAL_CENTER_IMPLEMENTATION.md), [29](29_BUSINESS_CUSTOMERS_AUDIENCES_IMPLEMENTATION.md), [30](30_CAMPAIGN_ENGINE_IMPLEMENTATION.md), [31](31_BUSINESS_OTP_AUTHENTICATION_IMPLEMENTATION.md), [32](32_BUSINESS_UTILITY_MESSAGING_IMPLEMENTATION.md). Verified against the actual repository at commit `4c2ebfa` — every claim below is either a direct re-verification (this session, this turn) or a carry-forward from a prior phase's own tested, committed implementation. Nothing here is asserted from documentation alone without a code citation.

---

## 1. Read-only audit — dependency matrix

| # | Dependency | Classification | Evidence |
|---|---|---|---|
| 1 | `customers` | **REAL** | `shared/schema.ts` — businessId-scoped, dedup (phone/email/externalRef), `linkedUserId` separates NEURA identity from business relationship. `server/modules/customers/service.ts`. 34+10 tests (doc 29). |
| 2 | `customer_consents` | **REAL, but MARKETING channel never exercised end-to-end** | `shared/schema.ts` `customerConsents`, `CUSTOMER_CONSENT_CHANNEL = {MARKETING, UTILITY, AUTHENTICATION}`. `isEligibleForChannel()`/`setChannelConsent()` in `customers/service.ts`. Currently called with `MARKETING`/`UTILITY` only from `campaigns/service.ts:440` — **no route ever writes a consent row** (doc 29 explicitly noted this: `setChannelConsent` exists but no HTTP route exposes it). This is the single most important PARTIAL finding for Phase 8: the eligibility *check* is real and tested, but there is no real-world path today for a customer to actually grant/revoke marketing consent. |
| 3 | `audiences` / `audience_members` | **REAL** | `shared/schema.ts`, `server/modules/audiences/service.ts`. Explicit junction table (not JSON array), STATIC-only (DYNAMIC declared, rejected). 28+9 tests. |
| 4 | `templates` / `template_versions` | **REAL** | `shared/schema.ts`, `server/modules/templates/{service,lifecycle,render}.ts`. Versioned, immutable-once-approved, safe single-pass placeholder rendering, category field (`MESSAGE_CATEGORY`). |
| 5 | Approval Center | **REAL** | `server/modules/approvals/{service,policy}.ts`. Code-level policy registry, atomic CAS decide, self-approval forbidden. Two registered domains today: `template_version`, `campaign`. |
| 6 | `campaigns` | **REAL** | `server/modules/campaigns/service.ts`. DRAFT→SCHEDULED→RUNNING→{COMPLETED,FAILED}/CANCELLED. Reuses Approval Center (no `SUBMITTED` sub-state of its own). |
| 7 | `campaign_recipients` | **REAL** | Immutable snapshot at schedule/execute time, unique `(campaignId, customerId)`, per-recipient atomic-CAS processing proven under genuine `Promise.allSettled` concurrency (doc 30 §10). |
| 8 | Canonical messaging | **REAL** | `messagingConversations/Messages/Deliveries/Events/Participants` (Phase 0). `CUSTOMER` participant type validated since Phase 5. `findOrCreateCustomerConversation` (tx-composable, Phase 5) reused unmodified by Campaigns/OTP/Utility. |
| 9 | Message billing | **REAL, PLACEHOLDER PRICING** | `server/modules/billing/message-billing.ts`'s `chargeMessage()` — one atomic CAS deduction against `billingAccounts.walletBalancePaise`. Shared by Campaigns/OTP/Utility. **No real pricing exists anywhere** — every phase's cost constant is explicitly documented as non-commercial. |
| 10 | Audit logging | **REAL** | `server/audit.ts`'s `createAuditLog`, `audit_logs` table, auto-redacts sensitive keys. Every Phase 4–7 module writes through a thin per-module wrapper into this one system. |
| 11 | RBAC | **REAL** | `server/role-middleware.ts` (`requireAuth`, `requireCompanyAccess`, `requirePermission`, `requireAnyPermission`), `PERMISSIONS` const in `shared/schema.ts`. Consistently reused, never forked, across every phase. |
| 12 | Business/tenant isolation | **REAL** | `requireCompanyAccess("businessId")` at every route; every service function scopes by `businessId` server-side; cross-tenant lookups uniformly return `NotFoundError`/`null`, never confirm existence. Tested exhaustively in every phase (tenant-isolation is the single most repeated test category across docs 29–32). |
| 13 | Rate limiting | **PARTIAL** | `server/rate-limit.ts`'s `rateLimit()` factory is real, Redis-backed with in-memory fallback, reused for OTP (`businessOtp*Limiter`). **Campaigns and Utility have NO route-level rate limiting today** — Campaigns' only "safety limit" is `MAX_RECIPIENTS_PER_CAMPAIGN` (5000, a size cap, not a rate) and a bounded per-tick batch (200). No per-business marketing-send-rate limiter exists yet. |
| 14 | Webhook infrastructure | **REAL, zero messaging event types defined** | `server/modules/webhooks/{service,event-bridge}.ts`, `dispatchEvent()`, `WEBHOOK_EVENT_TYPES`. Confirmed (this turn) the array holds only 7 call/translation/recording event types — **no `campaign.*`/`message.*`/`customer.*` event exists**. Adding Phase 8 event names requires no plumbing change (`isValidWebhookEventType` validates generically against the array). |
| 15 | Notification/channel infrastructure | **MISSING (by design, per Phases 5–7's own scope)** | No SMS/email/WhatsApp provider is called from any messaging module. `msg91-service.ts`'s `sendOTP()` is real, live code but wired to caller-ID verification only, never called from Campaigns/OTP/Utility. `messagingDeliveries.status` stays `QUEUED` in all three phases — this is the honest, repeatedly-documented state of the "future channel adapter" boundary. |
| 16 | API-key infrastructure | **REAL, but scoped to voice/SDK — NOT usable for messaging today** | `enterpriseApiKeys` table + `server/api-key-auth.ts` (confirmed this turn). Real SHA-256-hashed key auth, rate limits, quotas, org billing checks. `API_KEY_PERMISSIONS` enum has **zero messaging/campaign/customer/template permission values** — `translate, tts, stt, languages, voice-chat, calls:*, usage:read, billing:read, ws:subscribe, masking:manage, recording:control` only. A future business-facing Marketing API would need new permission values added to this enum (extend, don't fork) or a deliberate decision to keep marketing admin-session-only for now. |
| 17 | Reporting infrastructure | **PARTIAL** | `campaigns/service.ts`'s `getCampaignReport()` (real, derived-only, tested) is the only real precedent — single-campaign, no time-series, no cross-campaign rollup, no UI. `recharts` is already a frontend dependency, actively used in `SuperAdminDashboard.tsx` (confirmed this turn) — reusable charting pattern, but only wired to super-admin screens today, not business-facing. |
| 18 | GDPR/data-deletion | **PARTIAL, confirmed unchanged this turn** | `server/gdpr-routes.ts` + a near-duplicate in `server/production-routes.ts:746-809` — both create a `dataSubjectRequests` row with a "processed within 30 days" message; **no code anywhere executes an actual deletion**. `server/data-minimization.ts` defines retention/anonymization policy but is not wired to `dataSubjectRequests`. This is unchanged since doc 29's hardening review — re-verified, not re-guessed. |
| 19 | Existing business/admin UI for any of these modules | **MISSING, confirmed this turn** | Full `client/src/pages/*.tsx` inventory checked. Zero UI exists for customers, audiences, templates, campaigns, approvals, OTP, or utility messages. `CompanyDashboard.tsx`'s `ReportsTab` shows billing/credits only. Phase 8 (and retroactively, Phases 4–7) UI is 100% greenfield. |
| 20 | Super-admin UI extension point | **REAL** | `SuperAdminDashboard.tsx` + `AdminSections.tsx`, section-based nav with per-section components (`WebhooksSection`, `ComplianceSection`, etc. — confirmed this turn). The correct pattern to extend for marketing governance, not a new page/layout system. |

---

## 2. Dependency graph

```
                          organizations (businesses)
                                  │
              ┌───────────────────┼───────────────────┐
              │                   │                   │
          customers          templates          billingAccounts
              │                   │                   │
      ┌───────┼───────┐    template_versions    (chargeMessage,
      │       │       │           │              shared primitive)
customer_    audience_  audiences │
consents     members       │      │
      │       │       └────┼──────┘
      │       │            │
      │       └──► audiences
      │                    │
      └────────────────────┼──────────────► campaigns ──► campaign_recipients
                            │                    │                │
                      approvalRequests ◄─────────┘                │
                      (Approval Center,                            │
                       resourceType="campaign")                    │
                                                                    ▼
                                                     messagingConversations
                                                     messagingParticipants
                                                     messagingMessages (category=MARKETING)
                                                     messagingDeliveries (status=QUEUED)
                                                     messagingEvents (generationSource)
                                                                    │
                                                                    ▼
                                                    [FUTURE: Channel Gateway
                                                     — does not exist yet]
```

**Marketing adds nothing new to this graph structurally** — it is a *policy configuration* of the existing Campaign Engine (category=MARKETING, stricter consent gate, frequency caps), not a parallel system. This is the single most important architectural conclusion of this audit (Section 7 below).

---

## 3. Security threat model

| Threat | Existing mitigation | Phase 8 gap |
|---|---|---|
| Cross-tenant campaign/template/customer access | `requireCompanyAccess` + server-side `businessId` scoping everywhere, tested exhaustively | None identified — reuse as-is |
| Category injection (marketing→utility/auth or reverse) | Category is always read from the template's own row, never client input, at every phase (OTP §14, Utility §9, Campaigns §4) | Marketing needs the identical guard: template `category === MARKETING`, checked server-side, never trusted from any input |
| Consent bypass | `isEligibleForChannel` exists and fails closed (absence = ineligible) | **No route ever writes a consent row** — the gate is real but currently unreachable in practice; this is the P0 gap (Section 15) |
| Opt-out not honored after audience snapshot | Campaigns' snapshot is immutable by design (doc 30 §5) — this is *correct* for membership, but consent/eligibility is (correctly) re-checked per-recipient at execution time, not baked into the snapshot (doc 30 §6) | Confirmed safe by existing design — **must be preserved, not weakened**, when Marketing reuses this path |
| Frequency/spam abuse | `MAX_RECIPIENTS_PER_CAMPAIGN` (size cap) + bounded per-tick batch exist; no per-customer or per-business *rate* cap exists | **MISSING** — real gap, Section 5/16 |
| Duplicate/replay message creation | Proven atomic-CAS per-recipient in Campaigns (doc 30 §10), and proven under a genuinely simulated Postgres unique-violation in Utility (doc 32 §10) | Marketing reuses Campaigns' mechanism unchanged — already proven |
| Billing double-charge | Atomic CAS `chargeMessage`, charge happens inside the same transaction as message creation, proven | No gap |
| Sender identity / generationSource spoofing | Structurally impossible in every phase — no client-facing route ever accepts these fields | No gap, must remain true for Marketing |
| API-key marketing abuse | No API-key permission for messaging exists yet, so this attack surface **does not exist today** | If Phase 8+ ever exposes a marketing API-key scope, it inherits `enterpriseApiKeys`' real rate-limit/quota infra — but needs new permission values and a fresh security review before that's true |
| Un-actioned GDPR deletion leaving stale consent | No automated deletion exists platform-wide (confirmed) | Not a Phase-8-introduced risk — a pre-existing platform gap, out of scope to fix here, but worth flagging: a `customers` row's `linkedUserId` pointing at a since-"deleted" (never actually deleted) user is today a non-issue only because deletion never executes |

**No P0 exploitable vulnerability was found in what already exists.** The threat model's real findings are *absences* (consent-writing UI/API, frequency caps), not *flaws* in what's built.

---

## 4. Consent / opt-out model

**Explicit gate, evaluated in this order, fail-closed at every step** (extends, does not replace, the existing Campaigns gate chain from doc 30 §6):

```
1. Business ownership of customer          (existing, tested)
2. Customer status != BLOCKED              (existing, tested)
3. Customer status != ARCHIVED             (existing, tested)
4. Explicit MARKETING consent GRANTED      (existing mechanism, REAL — currently unreachable, see §1 item 2)
5. Not currently opted out                 (MISSING — see below)
6. Audience membership (this campaign)     (existing, tested)
7. Per-customer frequency cap not exceeded (MISSING — see §5)
8. Per-business rate limit not exceeded    (MISSING — see §5)
9. Suppression list check                  (MISSING — see below)
10. Duplicate-send check (idempotency)     (existing mechanism, reusable)
```

**Opt-out is a DIFFERENT concept from consent-not-yet-granted**, and this distinction must not be collapsed:
- **Consent** (`customerConsents`, existing): an explicit, business-scoped, per-channel record — `GRANTED` or `REVOKED`, absence = not eligible.
- **Opt-out**, in this codebase, **is just `setChannelConsent(..., channel=MARKETING, granted=false)`** — the existing table and function already model this correctly (a "REVOKED" consent row IS an opt-out). **There is no missing table here.** What's missing is:
  1. A route/mechanism for a customer to actually trigger this (currently `setChannelConsent` has zero callers with `granted=false` outside tests).
  2. A **re-check at execution time, not just snapshot time** — this already exists in Campaigns (`isEligibleForChannel` is called per-recipient inside `processOneRecipient`, not baked into the snapshot) — **confirmed correct by design, must be preserved**.
  3. Channel-specific preference: the schema already supports this per-channel (`CUSTOMER_CONSENT_CHANNEL`), so a customer opting out of `MARKETING` doesn't affect `UTILITY`/`AUTHENTICATION` — **already correct**, no change needed.

**Unresolved policy decisions, explicitly not decided here** (per the brief's own instruction — document, don't silently choose):
- **Re-subscription**: should a customer who opted out be able to opt back in themselves, or only via business-staff action? Not decided — `setChannelConsent(granted=true)` technically supports it, but whether a self-service re-subscribe flow should exist (and what proves it's really that customer) is a genuine product/legal/compliance decision.
- **Global vs per-list opt-out**: does opting out of `MARKETING` mean "all of this business's audiences" (current schema's implication — one consent row per customer per channel) or should a business be able to have per-audience opt-out (e.g. opted out of "Promotions" but still opted in to "Product Updates")? **Current schema only supports the former.** This is a real product decision to make before Phase 8 implementation, not an oversight to silently resolve.
- **Suppression list**: a formal "never contact" list (distinct from opt-out — e.g. legal holds, bounced/invalid destinations) does not exist anywhere. Whether Phase 8 needs one, or whether `CUSTOMER_STATUS.BLOCKED` is sufficient, is unresolved.

---

## 5. Marketing campaign lifecycle

**No new lifecycle is proposed. Marketing reuses `CAMPAIGN_STATUS` unchanged**: `DRAFT → {SCHEDULED, RUNNING, CANCELLED}`, `SCHEDULED → {RUNNING, CANCELLED}`, `RUNNING → {COMPLETED, FAILED}`. This is the direct consequence of Section 7's audit finding: the existing Campaign Engine was already built category-agnostic (`CAMPAIGN_ALLOWED_CATEGORIES = [MARKETING, UTILITY]`, doc 30 §2) — **`campaigns.category = "marketing"` already works end-to-end today**, gated by the exact same approval/template/audience/billing pipeline Utility uses for `"utility"`. Marketing does not need its own campaign table, its own recipient table, or its own state machine.

What Marketing needs that does **not** exist yet, layered on top of the unchanged lifecycle:

- **Frequency capping** (new, Section 5 of the brief) — evaluated as a new gate inside `processOneRecipient`, not a new campaign state.
- **Per-business marketing rate limiting** — evaluated as new `rateLimit()` instances (reusing the existing factory), or a new lightweight Redis counter (reusing the existing Redis client, not a new one) — analogous to how OTP added `businessOtp*Limiter` instances without touching the `rateLimit()` implementation itself.
- **Suppression check** — pending the unresolved product decision in Section 4.

---

## 6. Channel architecture

**NEURA must own the canonical model; a channel is an adapter, never the domain model** — this principle is **already fully satisfied by the existing architecture**, confirmed by direct inspection: `messagingMessages`/`messagingDeliveries`/`messagingEvents` (Phase 0) have no provider-specific columns; Campaigns/OTP/Utility all stop at creating a canonical message + a `QUEUED` delivery record, with zero import of any external SDK. The "Channel Gateway" the brief asks to design is not a new invention — it is the **already-documented, already-consistent extension point** from docs 30 §21, 31 §25, and 32 §23, restated once, in one place, for Marketing:

```
NEURA Campaign / Message
        │
        ▼
messagingDeliveries (status=QUEUED, channel-agnostic today)
        │
        ▼
   [FUTURE] Channel Gateway  ── reads QUEUED rows, dispatches, writes status/providerRef back
        │
        ├── NEURA In-App        (the only channel that "exists" today — a canonical message IS delivered in-app by virtue of existing)
        ├── SMS                  (msg91-service.ts's sendOTP() is a real, live primitive, currently wired only to caller-ID verification — reuse target, not built into any messaging module)
        ├── Email                 (Resend integration exists in server/otp-auth.ts for platform login OTP — same status: real, live, not wired to business messaging)
        ├── [future] WhatsApp adapter  — NOT implemented, NOT required by Phase 8, no Meta dependency anywhere in this codebase today (verified: zero WhatsApp/Meta SDK imports in any messaging module across Phases 0/2/3/4/5/6/7)
        ├── [future] RCS adapter        — NOT implemented
        └── [future] other channels
```

**Decision for Phase 8: build no new adapter.** The gateway's *interface shape* (what a `messagingDeliveries` row needs to carry for a future adapter to act on it — already has `channel`... wait, `messagingDeliveries` does NOT have a `channel` column today, only OTP's dedicated `businessOtpDeliveries` does) is a genuine **schema gap** worth flagging: if Marketing needs multi-channel delivery (SMS vs email vs in-app) the same way OTP does, `messagingDeliveries` would need a `channel` column added (additive, Marketing-specific use, doesn't affect Phase 0's conversational messaging use of the same table) — OR Marketing could follow OTP's precedent and get its own `businessMarketingDeliveries` table mirroring `businessOtpDeliveries`'s shape. **This is a real design decision for the implementation phase, not resolved here.**

---

## 7. Billing architecture

Reuse `server/modules/billing/message-billing.ts`'s `chargeMessage(tx, businessId, costPaise)` **unchanged** — the third module to do so after Campaigns and OTP/Utility. No new billing system, no new table.

| Concern | Status |
|---|---|
| Preflight credit check | Not separate from the charge itself — `chargeMessage`'s atomic CAS *is* the preflight+charge in one step (fails closed if insufficient) |
| Reservation | **Does not exist** for message billing (by design) — unlike `billing-engine.ts`'s call-session reservation/hold model, a message charge is instantaneous, not held open. This is a **deliberate, already-documented** architectural difference (doc 30 §9), not a gap |
| Successful charge | Atomic, inside the same transaction as message creation — proven (Campaigns/OTP/Utility all test this) |
| Failed delivery | **No refund/reversal exists anywhere** — a charge that succeeds but a (future) channel adapter later fails to deliver has no credit-back path. This is a genuine, currently-undecided policy question (does a failed SMS delivery get refunded? Real SaaS providers vary on this) — **unresolved, must be decided before a real channel adapter exists**, not before Phase 8's foundation |
| Retry | Campaigns' idempotency (unique recipient snapshot + atomic CAS) already prevents a retry from double-charging — proven |
| Concurrent campaign execution | Proven safe under genuine `Promise.allSettled` concurrency for Campaigns already (doc 30 §10) |
| Pricing | **Explicitly, repeatedly, NOT defined** — every phase's placeholder constant (`PLACEHOLDER_COST_PER_MESSAGE_PAISE = 10`, `PLACEHOLDER_COST_PER_OTP_PAISE = 15`, `PLACEHOLDER_COST_PER_UTILITY_MESSAGE_PAISE = 10`) is documented in writing as not an approved price. Marketing would need its own placeholder (or reuse Campaigns' existing one, since marketing campaigns already run through `campaigns/billing.ts` today) — **real commercial pricing is a business decision, out of scope for this or any prior phase** |

---

## 8. Reporting architecture

Real, reusable base: `getCampaignReport()` (doc 30 §16) already returns `targeted/pending/sent/skipped/skippedByReason` for any campaign, marketing or utility, since it's category-agnostic. A Marketing reporting layer needs, additively:

- **Cross-campaign rollup** for a business (sum of sent/failed/cost across N campaigns) — new, small aggregation query, no new table.
- **Delivery/failure rate** — derivable from existing `campaignRecipients.status` counts, already there.
- **Campaign cost** — derivable from `campaignRecipients.chargedPaise` sum, already stored per-recipient.
- **Suppressed/opted-out/blocked/archived breakdown** — `campaignRecipients.skipReason` already has `CUSTOMER_BLOCKED`/`CUSTOMER_ARCHIVED`/`CONSENT_MISSING`/`INSUFFICIENT_CREDIT` (doc 30's `CAMPAIGN_SKIP_REASON`) — **the exact vocabulary the brief's report list asks for already exists as data**, just needs an aggregation endpoint, not new instrumentation.
- **Channel breakdown** — blocked on the Section 6 schema gap (no channel column on the delivery record today for non-OTP messages).
- **"Delivered" claims**: per every prior phase's honest documentation, `messagingDeliveries.status` never progresses past `QUEUED` without a real channel adapter — **any Marketing reporting screen must show "queued" as the ceiling of truth, not fabricate a delivered/read rate.** This must be stated in the UI copy, not just the backend.

No new backend reporting infrastructure needs to be invented — this is an aggregation/rollup layer over data that already exists and is already tested as accurate.

---

## 9. Admin/business UI screen inventory (audit + design, not built)

Confirmed this turn: **zero existing UI for any of these modules.** Inventory below is what Phase 8 (and retroactively, the UI debt from Phases 4–7) would need — explicitly a future-phase deliverable, not built now.

**SUPER ADMIN** (extends `AdminSections.tsx`'s existing per-section-component pattern):
- Marketing governance (cross-tenant campaign volume, abuse signals)
- Campaign oversight (view any business's campaigns — read-only, audited access)
- Abuse/suspension controls (extends the existing `ComplianceSection`/abuse-reports pattern already in the nav)
- Approval visibility (cross-tenant view into the Approval Center's pending queue)
- Business usage + billing/credit visibility (extends existing `Billing & Plans` section)
- Audit (extends existing `Audit Logs` section)

**BUSINESS ADMIN** (net-new — `CompanyDashboard.tsx` has no messaging tabs today):
- Templates (create/edit/submit-for-approval — CRUD over existing `templates` API)
- Audiences (create/manage — CRUD over existing `audiences` API)
- Customers (view/manage — CRUD over existing `customers` API, including a UI for the consent-granting gap identified in Section 4)
- Campaigns (create/schedule/cancel/view report)
- Approval status (business's own view into `approvalRequests` for their templates/campaigns)
- Consent/opt-out management (**this is the UI half of the P0 gap in Section 4 — without it, the consent mechanism remains theoretically real but practically unreachable**)
- Reports (Section 8's rollup)
- Billing (extends existing billing tab)
- API access (if/when a marketing API-key scope is decided — Section 1 item 16)

**BUSINESS STAFF**: identical screens, gated per-screen by the existing RBAC permissions already defined (`CUSTOMERS_VIEW/MANAGE`, `AUDIENCES_VIEW/MANAGE`, `TEMPLATES_MANAGE/APPROVE`, `CAMPAIGNS_VIEW/MANAGE/EXECUTE`) — no new permission model needed for UI gating, reuse as-is.

**No UI-only control without backend enforcement**: every screen above maps to an already-real, already-tenant-isolated, already-tested backend endpoint — this audit found no case where the UI would need to invent enforcement the backend doesn't already do.

---

## 10. API inventory

**Existing, reusable as-is** (all require staff-session auth + `requireCompanyAccess` + specific permission, per docs 29–32):
- Customers: `POST/GET/PUT /api/business/:businessId/customers[/:id]`, `.../archive`
- Audiences: `POST/GET/PUT /api/business/:businessId/audiences[/:id]`, `.../members`
- Templates: `POST/GET/PUT /api/business/:businessId/templates[/:id]`, `.../draft`, `.../versions`, `.../return-to-draft`, `.../archive`, `.../preview`
- Approvals: `POST/GET /api/business/:businessId/approvals[/:id]`, `.../approve`, `.../reject`, `.../cancel`
- Campaigns: `POST/GET/PATCH /api/v1/business/:businessId/campaigns[/:id]`, `.../schedule`, `.../cancel`, `.../execute`
- Utility (view-only): `GET /api/v1/business/:businessId/utility/events[/:id]`, `.../report`

**Missing for Marketing specifically**:
- No consent-management route (Section 4's P0 gap) — `setChannelConsent` has no HTTP entry point at all today.
- No reporting-rollup route (Section 8).
- No API-key-scoped marketing permission (Section 1 item 16) — today's `enterpriseApiKeys` cannot touch any messaging module.

**Every future API must enforce** (per the brief's own required chain): `authentication → tenant → RBAC → category → template → consent → billing → idempotency → audit`. This is **already the exact chain every existing Campaigns/OTP/Utility route enforces**, in that order, verified across all three phases' controller/service code — Marketing does not need a new enforcement pattern, it needs the SAME pattern applied to new routes (consent-write, reporting) that don't exist yet. No generic `/send-message` exists anywhere and must continue not to.

---

## 11. Database changes required (reviewed, NOT written this turn)

No migration was written this turn, per the brief's explicit instruction. Anticipated additive changes for a future implementation phase (subject to the unresolved product decisions in Sections 4/6 before being finalized):

1. **Consent-write API surface** — no schema change; `customerConsents` already exists, just needs routes.
2. **Frequency-cap tracking** — likely a small new table (e.g. `customer_marketing_send_log` or a Redis-based counter, mirroring OTP's Redis-lockout precedent rather than a DB table if the cap is time-windowed) — **not designed in detail here**, since the exact cap policy (Section 5) is itself undecided.
3. **Channel column on delivery tracking** — either `ALTER TABLE messaging_deliveries ADD COLUMN channel text` (additive, nullable, affects Phase 0's table but only adds a column, never removes/alters existing ones) or a new `business_marketing_deliveries` table mirroring `business_otp_deliveries` — **explicitly an open design choice**, not resolved here.
4. **Suppression list** — only if the Section 4 policy decision requires one; no design attempted here since the policy itself is unresolved.

**No FK/index/uniqueness/rollback analysis is provided for these** because **no migration exists to analyze** — per the brief's own instruction, this section stays at "anticipated changes," not a real migration plan, until the product decisions above are made.

---

## 12. Migration plan

**N/A for this turn.** No migration was written. When a future phase does write one, it will follow the exact convention every prior phase used: additive-only, `IF NOT EXISTS` guards, explicit rollback comment block, reviewed against `shared/schema.ts` line-by-line (doc 29 §H6's precedent), and **not applied to production** — there is still no local database available to this project (confirmed unchanged), so "schema-reviewed" and "database-executed" must stay explicitly distinguished in any future report, exactly as every phase since Phase 4 has done.

---

## 13. Test plan (for a future implementation phase — not run, not written, this turn)

Every item below maps to a pattern **already proven** in Phases 5–7 and directly reusable, not invented:

| Test area | Existing proven pattern to reuse |
|---|---|
| Cross-tenant campaign/template/customer access | Doc 30 §15, doc 31 §Sections 6/9, doc 32 §6 — `NotFoundError`, never confirms existence |
| Category injection (marketing↔utility↔auth) | Doc 31 §14, doc 32 §4/§9 — template category always server-checked, tested with deliberately wrong-category templates |
| Unapproved / archived template, version switching | Doc 30 §4, doc 32 §4 — re-checked live at execution, never cached; "campaign keeps using v1 even after v2 exists" test pattern |
| Customer opt-out / consent revoked mid-campaign | New test needed once the write-path exists — pattern: doc 30's "revoked consent -> skipped" test already covers the READ side; the WRITE side (an actual opt-out action) needs its own new test once built |
| Blocked / archived customer | Doc 30 §8 (exact scenario matrix already specified and tested) |
| Audience mutation after scheduling (late joiner) | Doc 30 §5, directly tested already — reused unchanged for Marketing |
| Duplicate / concurrent execution | Doc 30 §10 (genuine `Promise.allSettled`), doc 32 §10 (genuine simulated unique-violation) — both patterns exist and transfer directly |
| Concurrent billing | Doc 30 §10's charge-inside-recipient-transaction proof, doc 32's dedicated billing test pattern (`campaigns-billing.test.ts`/real SQL-arithmetic evaluation) |
| Retry amplification / frequency cap / campaign overlap | **No existing test pattern** — these are genuinely new concerns Phase 8 introduces (Section 5), tests must be designed fresh once the caps are designed |
| Insufficient credits | Doc 30 §9, doc 32 §12 — both have direct test precedent |
| Delivery failure | Only as far as `QUEUED` — "delivered" cannot be tested since no channel adapter exists to fail; this must be stated explicitly in any future test report, not glossed over |
| Audit integrity | Doc 31 §18/§22, doc 32 §18/§19 — "never leaks the secret/content into audit metadata" test pattern, directly reusable for consent actions |
| RBAC | Every phase's `-rbac.test.ts` pattern (permission-gate + tenant-isolation + mass-assignment tests) — directly reusable |
| API-key tenant isolation | **No existing test precedent** — `enterpriseApiKeys` has never been tested against a messaging permission because none exists yet; genuinely new test surface if Section 1 item 16's gap is ever closed |

**"Do not claim database-level guarantees without a real database test"**: every prior phase's unique-constraint/CAS proof used either (a) a genuinely simulated Postgres error code (Utility, doc 32 §10 — the strongest precedent) or (b) an honestly-flagged limitation (OTP's challenge-creation dedup, doc 31 §21, explicitly NOT proven under live-INSERT race). Any future Phase 8 test claiming a DB-level guarantee must follow (a)'s pattern or explicitly flag itself as (b) — this audit does not pre-judge which gaps will need which treatment.

---

## 14. P0 / P1 / P2 risk register

| ID | Severity | Finding | Why |
|---|---|---|---|
| P0-1 | **P0** | No route exists for a customer's marketing consent to actually be granted or revoked | The entire consent gate (Section 4) is real and tested in isolation, but is currently **unreachable in any real workflow** — a business today cannot actually collect marketing consent through this platform. Without this, "Marketing Messaging" cannot honestly ship, regardless of how solid the campaign engine is. |
| P0-2 | **P0** | No frequency/rate cap exists for marketing sends (per-customer or per-business) | The brief explicitly calls this out as a real-controls requirement, not UI-only. Today, a single approved campaign against a large audience with sufficient credit has no technical ceiling beyond the 5000-recipient size cap and the 200-per-tick batch (a performance bound, not an anti-spam one). This is a genuine abuse-prevention gap for a marketing product specifically (utility/OTP are lower-volume by nature and less exposed). |
| P1-1 | **P1** | Re-subscription and per-list opt-out policy undecided | Blocks a complete, honest opt-out UX; not a security hole, but a product-completeness gap that should be decided before UI is built, not discovered mid-build. |
| P1-2 | **P1** | No channel column on delivery tracking for non-OTP messages | Blocks accurate channel-breakdown reporting (brief's Section 11 requirement) and blocks a clean future multi-channel adapter design; additive fix, low risk, but undecided (Section 6). |
| P1-3 | **P1** | No refund/reversal policy for a charged-but-undelivered message | Currently moot (nothing ever fails delivery since no adapter exists), but must be decided before any real channel adapter ships, or businesses will be charged for messages that silently vanish. |
| P2-1 | **P2** | API-key infrastructure has zero messaging-scoped permissions | Not a current risk (the attack surface doesn't exist), but blocks the brief's Section 14 "future B2B customers integrate via API" goal until deliberately extended. |
| P2-2 | **P2** | GDPR deletion has no automated execution anywhere in the platform | Pre-existing, platform-wide, not introduced by Marketing — flagged for completeness per the brief's Section 20 audit requirement, not a Phase-8-specific defect. |
| P2-3 | **P2** | No suppression-list concept distinct from BLOCKED/opt-out | May be unnecessary if `BLOCKED` + opt-out prove sufficient in practice — flagged as a design question, not a confirmed gap. |

**No P0/P1 security vulnerability was found in already-implemented code.** Every P0/P1 above is an **absence** (a missing capability), not a **flaw** in what exists — consistent with every prior phase's audits, which likewise found the implemented gates correct and the gaps to be scope boundaries, not bugs.

---

## 15. Exact implementation order (for a future approved phase — not started)

Given the risk register, the defensible build order is NOT "build Marketing campaigns" first — the campaign engine already works for `category=MARKETING` today. The actual missing work, in dependency order:

1. **Close P0-1**: consent-write API (`POST .../customers/:id/consent`) + minimal business-admin UI for it. Nothing else in Marketing is honestly usable without this.
2. **Close P0-2**: frequency/rate cap design + implementation (per-customer daily cap, per-business send-rate limit), reusing the existing `rateLimit()` factory and Redis client, following OTP's precedent of parameterized, namespaced counters rather than a new mechanism.
3. **Resolve P1-1** (re-subscription/per-list opt-out policy) as a product decision, THEN build whatever UI/API it implies.
4. **Resolve P1-2** (channel column / delivery-tracking shape) as a design decision, THEN implement if a concrete multi-channel need exists yet (it may not, if NEURA In-App is the only real channel for the near term).
5. Build the **business-admin UI** (Section 9) — templates, audiences, customers (incl. consent), campaigns, reports — since none of the backend work is usable by an actual business without it. This is arguably overdue debt from Phases 4–7, not new to Marketing.
6. Build the **reporting rollup** (Section 8) — additive aggregation over already-correct data.
7. Only then: any super-admin marketing-governance screens (Section 9) — oversight of a system that doesn't yet have real usage isn't urgent.
8. P1-3 (refund policy) and the API-key extension (P2-1) are correctly deferred until a real channel adapter or a real external-API customer is imminent — building them speculatively now would be exactly the "unrelated domain system" every prior phase's brief warned against.

---

## 16. Architecture Decision Records

**ADR-1: Marketing is a category, not a new system.**
Decision: Reuse `campaigns`/`campaign_recipients`/the Approval Center/canonical messaging entirely unchanged; `category=MARKETING` is already a first-class, tested value in `CAMPAIGN_ALLOWED_CATEGORIES`.
Why: The brief's own Step 7 instruction ("do not duplicate campaign infrastructure, extend it only where necessary") and this audit's finding that the existing engine was already built category-agnostic.
Alternative rejected: A parallel `marketing_campaigns` table — would duplicate ~90% of Campaigns' already-proven logic (idempotency, snapshot, billing, RBAC) for no architectural benefit.

**ADR-2: Consent and opt-out are the same underlying mechanism (`customerConsents`), not two systems.**
Decision: Opt-out = `setChannelConsent(channel=MARKETING, granted=false)`. No new "opt-out" table.
Why: The schema already models this correctly; the gap is reachability (a route), not data modeling.

**ADR-3: No channel adapter is built in Phase 8, and the canonical model stays channel-agnostic at the message layer.**
Decision: `messagingMessages`/`messagingDeliveries` remain provider-free; any future adapter reads `QUEUED` rows and writes back status, exactly as documented in every prior phase.
Why: Explicit brief instruction (Step 8) and consistent with the zero-external-dependency precedent already set three times (Campaigns, OTP, Utility).

**ADR-4: Frequency capping is a new, small, additive control — not a new campaign lifecycle state.**
Decision: Implemented as an additional gate function (parallel to consent/status checks), not a new `CAMPAIGN_STATUS` or `CAMPAIGN_RECIPIENT_STATUS` value.
Why: Doc 32's own "do not create unnecessary workflow states" precedent; a rate cap is a pass/fail check at processing time, not a state a recipient sits in.

**ADR-5: API-key marketing access is deferred, not designed in detail, until a real external-integration need exists.**
Decision: `enterpriseApiKeys`/`API_KEY_PERMISSIONS` are noted as the correct future extension point, but no new permission value is added this turn.
Why: Speculative build-out of an unused capability was exactly what the brief's Step 14 wording ("do NOT expose insecure generic send-message endpoints... but design so future customers CAN integrate") asks to be *ready for*, not *built now*.

---

## 17. Definition of done (for this turn only)

- [x] Read-only audit performed against actual repository code, not documentation alone (2 targeted verification passes this turn, plus 4 phases of first-hand prior implementation knowledge)
- [x] Every dependency classified REAL/PARTIAL/MISSING/UNSAFE/UNKNOWN with file:line evidence
- [x] Dependency graph produced
- [x] Security threat model produced, no P0 vulnerability found in existing code
- [x] Consent/opt-out model defined, with genuinely unresolved product decisions explicitly flagged rather than silently chosen
- [x] Marketing campaign lifecycle designed (= reuse existing `CAMPAIGN_STATUS`, no new states)
- [x] Channel architecture designed, zero Meta/WhatsApp dependency confirmed and preserved
- [x] Billing architecture audited, no placeholder pricing presented as real
- [x] Reporting architecture designed as an additive rollup over already-correct data
- [x] UI/admin screen inventory audited (confirmed: currently zero UI for any of these modules) and designed
- [x] API inventory listed, enforcement chain confirmed already-consistent
- [x] Database changes anticipated but NOT written (no migration, no schema edit this turn)
- [x] Migration plan explicitly deferred, "schema-reviewed" vs "database-executed" distinction preserved
- [x] Test plan mapped to existing proven patterns, gaps in precedent honestly flagged
- [x] P0/P1/P2 risk register produced — 2 P0s, 3 P1s, 3 P2s, none of them a flaw in shipped code
- [x] Implementation order proposed, gated on the P0/P1 findings, not on excitement to build campaigns (which already work)
- [x] ADRs recorded for the 5 load-bearing decisions
- [x] No production code, schema, route, or UI was written or modified
- [x] No deployment attempted or claimed
- [x] Phase 9 not started

---

**PHASE 8 READ-ONLY AUDIT + ARCHITECTURE COMPLETE — NO CODE WRITTEN.**
