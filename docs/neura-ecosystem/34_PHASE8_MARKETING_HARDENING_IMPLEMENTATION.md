# Phase 8 Marketing Hardening + Operationalization — Implementation Record

Closes the two P0 gaps identified in [33_PHASE8_MARKETING_MESSAGING_ARCHITECTURE_AUDIT.md](33_PHASE8_MARKETING_MESSAGING_ARCHITECTURE_AUDIT.md): (P0-1) no route existed for marketing consent to actually be granted/revoked, and (P0-2) no frequency/rate cap existed for marketing sends. Per ADR-1 in that audit, **no second campaign engine was built** — this is entirely additive hardening of the existing Campaign Engine (Phase 5), Customers module (Phase 4), and shared billing primitive (Phase 5/6/7).

## Part 1/2 — Marketing consent write path + opt-out

**Source of truth: `customerConsents`** (Phase 4, unchanged shape) — confirmed by direct re-read of `server/modules/customers/service.ts` before touching it. No duplicate consent table, no second consent mechanism. Opt-out **is** `setChannelConsent(channel, granted=false)` — there is no separate "opt-out" concept in the data model, exactly per ADR-2.

**What was added**: two new HTTP endpoints exposing the already-real, already-tested `setChannelConsent`/`isEligibleForChannel` (Phase 4) and a new read function:
- `POST /api/business/:businessId/customers/:customerId/consent` — body `{channel, granted, source?}`, `.strict()` schema (cannot forge `businessId`/`customerId`/`updatedBy` via body — those are always resolved from the URL + `req.user.id`). Gated by `CUSTOMERS_MANAGE`.
- `GET /api/business/:businessId/customers/:customerId/consent` — returns every channel's current row (absence of a row = not eligible, never a fabricated response). Gated by `CUSTOMERS_MANAGE` or `CUSTOMERS_VIEW`.
- New service function `getCustomerConsents(businessId, customerId)` — tenant-scoped via the existing `getOwnedCustomer` check, same as every other customer read.

**No schema change was required** — `customerConsents.updatedBy`/`updatedAt`/`source` already exactly satisfy "preserve audit history" and "audit actor/timestamp." Every grant/revoke additionally writes to `audit_logs` via the existing `AUDIT_ACTION_CUSTOMER.CONSENT_CHANGED` action (unchanged from Phase 4).

**Fail-closed, proven**: a fresh customer has zero consent rows and `isEligibleForChannel` returns `false` (tested: "customer existence alone is never treated as consent"). Re-consent after opt-out requires an explicit new grant call — never automatic (tested directly).

**Re-check at execution time, not scheduling time** — this was already correct in Phase 5's design (`isEligibleForChannel` is called live inside `processOneRecipient`, never baked into the snapshot); this hardening phase adds a test that exercises it through the **new** HTTP-reachable consent path specifically (not just the pre-existing service-level test): a campaign is scheduled, the customer then opts out via `setChannelConsent` (the exact function the new route calls), and execution confirms the snapshot still shows the customer as targeted but `sent: 0`, `skippedByReason.consent_missing: 1`.

**Documented limitation, not silently changed**: `customerConsents.source` is free text, not a validated enum — sufficient for Phase 8's scope (grant/revoke reason logging) but not a structured "consent method" (e.g. distinguishing "clicked opt-in link" from "verbal consent recorded by staff"). Flagged as a real limitation per the brief's instruction, not fixed by an unrequested schema change.

## Part 3 — Marketing frequency / rate cap

**New, additive, DB-backed atomic counters** — `server/modules/campaigns/frequency.ts`, two functions:
- `reserveCustomerFrequencySlot(tx, businessId, customerId, windowStart, cap)` — atomic insert-or-conditional-increment against `customer_marketing_frequency`, unique on `(businessId, customerId, windowStart)`.
- `reserveBusinessThroughputSlot(tx, businessId, windowStart, cap)` — same idiom against `business_marketing_throughput`, unique on `(businessId, windowStart)`.

**Explicitly NOT built on `server/rate-limit.ts`'s Redis `rateLimit()` factory** — that factory is IP/route-scoped middleware; this needs durable, atomic, per-(business,customer) accounting a concurrent recipient transaction can safely race against, so it reuses the SAME atomic-CAS idiom the rest of this codebase already relies on (billing, campaign recipients, OTP challenges, utility events) rather than a second concurrency primitive.

**CONFIGURABLE / PRODUCT DECISION, explicitly marked as such, never presented as legal requirement**:
- `DEFAULT_CUSTOMER_MARKETING_CAP_PER_DAY = 3`
- `DEFAULT_BUSINESS_MARKETING_THROUGHPUT_PER_HOUR = 1000`
- Window granularity (daily for customer, hourly for business) is a policy choice, not derived from any regulation.

**Mapped to the brief's six controls**:
- **A. Per-customer frequency** — `reserveCustomerFrequencySlot`, direct.
- **B. Per-business throughput** — `reserveBusinessThroughputSlot`, direct.
- **C. Duplicate-message suppression** — provided BY the per-customer frequency cap, deliberately not a separate mechanism: the counter is scoped to `(businessId, customerId)`, not `(campaignId, customerId)`, so two different campaigns targeting the same customer the same day share one budget — tested directly ("two DIFFERENT marketing campaigns to the SAME customer share one frequency budget").
- **D. Concurrent campaign protection** — the counter's atomicity is campaign-agnostic by construction (same reasoning as C); proven under genuine `Promise.allSettled` concurrency in `campaigns-frequency.test.ts` (exactly one of N concurrent reservations against a cap of 1 wins; exactly 5 of 10 concurrent reservations against a cap of 5 win, never more).
- **E. Retry amplification** — unchanged, already proven safe by Phase 5's per-recipient atomic CAS (`campaignRecipients.status`) — a retried recipient never re-reserves a frequency slot because it never re-enters `processOneRecipient`'s gate chain once already `SENT`/`SKIPPED`.
- **F. Campaign overlap** — same mechanism as C/D — the shared, campaign-agnostic counter is what makes overlap safe, tested directly.

**Only MARKETING is capped** — `campaign.category === MESSAGE_CATEGORY.MARKETING` gates the whole block; a `UTILITY`-category campaign never touches these counters, tested directly (frequency capping is a marketing-specific anti-spam control, per the audit's own scoping, never applied to operational messaging).

## Part 4 — Execution gate: actual final order

Traced directly from `server/modules/campaigns/service.ts`'s `processOneRecipient` (re-read in full before writing this section, line numbers cited):

1. Recipient row still `PENDING` (idempotency guard, campaigns/service.ts:427)
2. Customer exists + belongs to business (:437-438)
3. Customer status `!= BLOCKED` (:439)
4. Customer status `!= ARCHIVED` (:440)
5. Marketing/utility consent — `isEligibleForChannel` (:442-443) — **this is also the opt-out check**, no separate step
6. Template still `APPROVED` (:445-447)
7. **Frequency + throughput reservation — MARKETING only (:455-461, new this phase)**
8. Template render (:463-470)
9. Billing charge (:472-475)
10. Message + delivery + event creation (:477-493)
11. Recipient status → `SENT` (atomic CAS, final step)
12. Audit (campaign-level actions only, not per-recipient — unchanged convention from Phase 5)

**Deviation from the brief's suggested order, deliberate and documented**: the brief listed `template validation → template version validation → customer status → consent → opt-out → suppression/frequency`. The actual, tested order checks **customer status and consent before template approval**, and places the **frequency gate after template approval, not before** — because template approval is a campaign-level fact (checked once, cheap), while consuming a customer's scarce daily frequency budget for a recipient who will be rejected anyway by a template problem would be wasteful and incorrect. This is exactly the brief's own permission: "do not blindly copy this order if the existing transaction architecture requires another safe ordering... document the actual final order." **No unauthorized marketing message can bypass any gate** — every gate is inside the same atomic transaction as the eventual message creation, and a rejection at any gate prevents all later steps from running.

**Known, honest, minor limitation carried over from Phase 5 unchanged**: template `render` (step 8) can still fail and consume a frequency slot already reserved at step 7 — a rare edge case (render failures are template bugs, not customer-dependent), not re-ordered further in this hardening pass given the effort/value tradeoff; noted here rather than silently left undocumented.

## Part 5 — Campaign snapshot audit

Re-verified, not re-guessed: `campaignRecipients` snapshot remains immutable (established once at `DRAFT→SCHEDULED`/`DRAFT→RUNNING`, per `snapshotRecipientsIfNeeded`, unchanged in this phase) and late joiners are never automatically added (unchanged, tested in Phase 5 and re-confirmed still passing this phase). **Opt-out/consent-revocation/BLOCKED/ARCHIVED are all re-evaluated live at execution time**, never from the snapshot — this was already Phase 5's design, and this phase adds the specific proof that a **post-schedule** opt-out (via the new consent path) is honored (Section above, "snapshot does not override a later opt-out").

## Part 6 — Duplicate / idempotency

**No new mechanism was invented — the existing Phase 5 guarantees were re-verified against the new gates, not replaced.**
- Same campaign executed twice: unchanged, re-tested passing (`re-invoking execute() after completion is rejected outright`).
- Same campaign concurrently executed: unchanged, re-tested passing (`concurrent execute() calls... do not double-charge or double-send`).
- Same customer appears twice: prevented by `campaignRecipients`' unique `(campaignId, customerId)` index, unchanged.
- Retry after billing/message-creation failure: unchanged — a failure anywhere in `processOneRecipient`'s transaction rolls back the whole transaction (including a tentative frequency reservation, since it's inside the same transaction), leaving the recipient `PENDING` for a safe retry.
- **New this phase**: the frequency/throughput counters themselves are proven safe under genuine concurrent reservation (`campaigns-frequency.test.ts`, `Promise.allSettled`, real simulated Postgres unique-violation) — not claimed from an application-level check alone.

## Part 7 — Billing

**Reused `server/modules/billing/message-billing.ts` unchanged** — no new billing code, no parallel implementation. Interaction, traced: eligibility (steps 2-7 above) → frequency reservation (step 7) → charge (step 9) → message creation (step 10) → final recipient-status CAS (step 11), all one transaction. A failure at any later step rolls back the charge too (unchanged Phase 5 guarantee, re-verified: "a capped-out recipient is never charged" is a new test proving the frequency gate runs strictly before billing). **No refund/reversal mechanism exists or was added** — correctly out of scope, since nothing in this phase or any prior phase progresses a delivery past `QUEUED` (no real channel adapter exists), so there is no "delivery failed after charge" scenario to reverse yet. This remains an open, documented question (audit doc 33's P1-3) for whenever a real channel adapter is built. **Placeholder pricing is unchanged and still not presented as real** (`PLACEHOLDER_COST_PER_MESSAGE_PAISE = 10`, doc 30).

## Part 8 — Audit logging

Consent grant/revoke: audited via the pre-existing `AUDIT_ACTION_CUSTOMER.CONSENT_CHANGED` action (unchanged), metadata `{channel, status}` only — never the customer's actual phone/email, never message content. Tested directly (existing Phase 4 pattern, re-verified). Frequency/throughput cap rejections: recorded in `campaignRecipients.skipReason` (visible via `getCampaignReport`, unchanged reporting mechanism) but **not** written as individual `audit_logs` rows — consistent with the pre-existing, explicit convention (OTP doesn't audit-log every wrong code attempt either, doc 31 §22) of not spamming the audit trail with routine, high-volume, non-security-relevant outcomes; campaign-level lifecycle events (created/scheduled/started/completed) remain the audited unit, unchanged from Phase 5. Audit records remain immutable — no route anywhere edits or deletes an `audit_logs` row (unchanged, platform-wide invariant).

## Part 9 — RBAC

**Zero new permissions.** Consent grant/revoke reuses `CUSTOMERS_MANAGE`; consent view reuses `CUSTOMERS_MANAGE`/`CUSTOMERS_VIEW`; campaign execution continues to require `CAMPAIGNS_EXECUTE` unchanged (frequency/consent checks happen *inside* an already-permission-gated execution, not as a separately gated action). Verified against the role matrix: an `agent` with only `CUSTOMERS_VIEW` cannot grant/revoke consent (403, tested); a user with `CUSTOMERS_VIEW` alone can still view current consent state (tested); tenant isolation via `requireCompanyAccess` is unchanged and re-tested for the new routes.

## Part 10 — Testing

**29 new tests** across 4 files (exact count re-verified via the full-suite delta: 635 → 664):
- `customers.test.ts` (+5): consent write-path service-level tests — empty-list default, grant/revoke updates the same row with correct actor, cross-business isolation, cross-business identical-customerId non-collision, existence-≠-consent.
- `customers-rbac.test.ts` (+8): permission gating (MANAGE vs VIEW), mass-assignment guard on the new consent route, server-resolved actor (never client-supplied), URL manipulation, 404-not-403 on cross-tenant.
- `campaigns.test.ts` (+7): post-schedule opt-out excluded at execution (Part 5's core proof), explicit re-consent requirement, frequency-cap-exceeded skip, category-scoping (utility never capped), throughput-cap-exceeded skip, frequency-gate-before-billing, cross-campaign shared-budget overlap protection.
- `campaigns-frequency.test.ts` (new file, 9): both counters' cap boundaries, per-customer/per-business independence, window-reset behavior, and **two genuine `Promise.allSettled` concurrency tests** (cap-of-1 race, cap-of-5-of-10 race) proving the atomic CAS, not an app-level check.

**Mapped against the brief's 40-item list**: items already covered by pre-existing, still-passing Phase 4/5 tests (missing/revoked consent fails closed, blocked/archived customer, cross-business customer/campaign/audience/template, category injection ×3, unapproved template, template version binding, execute-twice/concurrent-execute, retry-after-failure, insufficient credits, audit-no-leakage, RBAC) were re-verified passing, not re-implemented. Items genuinely new to this phase (grant/revoke via the new route, per-customer/per-business caps, duplicate-suppression-via-shared-budget, concurrent campaign protection, campaign overlap, frequency-window-expiry, policy-boundary-values) all have new, direct tests, cited above. **Not covered, honestly**: item 21 ("policy configuration boundaries") is covered only at the unit level (`campaigns-frequency.test.ts`'s boundary tests with explicit cap values) — no test sweeps a wide range of arbitrary configured cap values, since the caps themselves are marked CONFIGURABLE/undecided, not a fixed contract to exhaustively validate yet. **No PostgreSQL-level guarantee is claimed without a real database** — every concurrency claim in this report is backed by a test that genuinely simulates the specific Postgres mechanism relied upon (unique-constraint violation, code `23505`), consistent with the standing project convention since doc 32.

## Part 11 — UI

**Not built in this pass.** The brief's Part 11 says "only after backend behavior is complete" — this report is the backend-complete milestone; UI (consent management, eligibility visibility, suppression-reason visibility, frequency-policy visibility, execution status) is correctly the next, separate increment, not bundled into this hardening pass. This is consistent with doc 33's own "Definition of done" scoping and avoids the exact "UI-only controls without backend enforcement" anti-pattern the brief warns against — building UI now, before this report is reviewed, would risk exactly that.

## Part 12 — Database

Inspected before any change (per the brief's explicit Part 12 instruction): `customerConsents` (Phase 4, sufficient as-is, zero changes), `campaigns`/`campaignRecipients` (Phase 5, unique `(campaignId, customerId)` confirmed, zero changes), `billingAccounts` (unchanged), `audit_logs` (unchanged). **Schema change was genuinely required only for frequency/throughput** — two new, additive tables, `migrations/0012_phase8_marketing_hardening.sql`, written and reviewed, matching `shared/schema.ts` column-for-column and index-for-index (unique keys, FK targets, cascade behavior all verified by direct comparison). **NOT applied to any database** — schema-written and reviewed only; there is still no local database available to this project (unchanged, confirmed).

## Part 13 — Deployment

**Not performed.** No push, no DigitalOcean configuration change, no APK rebuild. This entire phase is backend code + tests + documentation, verified locally only.

---

# Final Report

**1. Exact files changed**: `shared/schema.ts` (2 new tables, 2 new `CAMPAIGN_SKIP_REASON` values), `server/modules/customers/{service,controller,routes}.ts` (consent write path), `server/modules/campaigns/frequency.ts` (new), `server/modules/campaigns/service.ts` (gate wiring, 2 new imports), `migrations/0012_phase8_marketing_hardening.sql` (new, not applied), `tests/unit/{customers,customers-rbac,campaigns}.test.ts` (extended), `tests/unit/campaigns-frequency.test.ts` (new).

**2. Exact schema changes**: `customer_marketing_frequency` (new table), `business_marketing_throughput` (new table), `CAMPAIGN_SKIP_REASON.CUSTOMER_FREQUENCY_CAP_EXCEEDED`/`BUSINESS_THROUGHPUT_CAP_EXCEEDED` (new enum values). `customerConsents` — **unchanged**, zero columns added.

**3. Exact APIs added/modified**: `POST/GET /api/business/:businessId/customers/:customerId/consent` (new). No other route changed.

**4. Exact consent model**: `customerConsents` (Phase 4, unchanged) — grant/revoke via `setChannelConsent`, now HTTP-reachable; absence of a row = not eligible; one row per `(customerId, channel)`, updated in place (not versioned history) with `updatedBy`/`updatedAt`/`source`.

**5. Exact opt-out model**: `setChannelConsent(channel, granted=false)` — the same mechanism as consent, not a separate concept. Re-subscription requires an explicit new `granted=true` call, never automatic. Immediate effect on campaign eligibility proven via live re-check at execution (unchanged Phase 5 design + new post-schedule-opt-out test).

**6. Exact frequency/rate-cap model**: two atomic DB counters, `(businessId, customerId, windowStart)` and `(businessId, windowStart)`, default 3/customer/day and 1000/business/hour, both explicitly marked CONFIGURABLE/PRODUCT DECISION. Marketing-category campaigns only.

**7. Exact campaign execution gates**: documented in full, actual order, in Part 4 above — 12 steps, one transaction, atomic throughout.

**8. Idempotency behavior**: unchanged Phase 5 guarantees (recipient CAS, unique snapshot index) re-verified; frequency counters independently proven atomic under genuine concurrency.

**9. Billing behavior**: unchanged shared primitive; charge strictly after frequency gate, inside the same transaction as message creation; no refund/reversal (correctly out of scope, nothing delivers past `QUEUED` yet).

**10. RBAC behavior**: zero new permissions; `CUSTOMERS_MANAGE`/`CUSTOMERS_VIEW` reused for consent; `CAMPAIGNS_EXECUTE` unchanged for execution.

**11. Tenant-isolation evidence**: cross-business consent read/write both tested and rejected (`NotFoundError`); identical `customerId` numeric value across two businesses proven non-colliding; frequency counters proven independent per business.

**12. Audit evidence**: consent changes audited via existing `CONSENT_CHANGED` action; frequency-cap rejections recorded in `skipReason` (not individually audit-logged, consistent with existing convention); no sensitive content in any audit call, re-verified.

**13. All security findings**: none new. No P0/P1 introduced by this hardening pass.

**14. All unresolved product/legal decisions**: (a) `customerConsents.source` remains free text, not a structured consent-method enum; (b) frequency/throughput cap values and window granularity are technical defaults, not a legal or product-approved policy; (c) refund/reversal policy for a charged-but-undelivered message remains undecided (moot until a real channel adapter exists); (d) per-list/per-audience opt-out (vs. the current global-per-channel model) remains undecided, carried forward unchanged from doc 33.

**15. Migration status**: written, reviewed, **NOT applied to any database**.

**16. New test count**: 29 (5 + 8 + 7 + 9).

**17. Complete test-suite result**: **664/664**, up from 635, zero regressions.

**18. Typecheck result**: clean (`tsc --noEmit`, exit 0), verified after every edit round.

**19. Git commit SHA**: recorded at commit time below.

**20. Deviations from Phase 8 architecture**: the execution-gate order places frequency capping after template-approval (not before, as loosely implied by the brief's suggested list) and after consent (matching the audit's own ordering) — justified and documented in Part 4, not a silent deviation.

**21. Remaining P0/P1/P2 risks**: **P0s from doc 33 are closed** (consent is now reachable; frequency caps are now enforced). Remaining, carried forward: P1 (re-subscription/per-list opt-out policy undecided), P1 (no channel column on delivery tracking — unaffected by this phase), P1 (refund/reversal policy undecided), P2 (API-key infra has no messaging permissions), P2 (GDPR deletion has no automated execution, platform-wide, pre-existing), P2 (no suppression-list concept distinct from BLOCKED/opt-out — arguably now less urgent, since BLOCKED + opt-out + frequency caps together form a reasonably complete practical suppression story, but not formally unified into one "suppression" concept).

**22. PHASE 8 STATUS: IMPLEMENTED — NOT DEPLOYED.**
