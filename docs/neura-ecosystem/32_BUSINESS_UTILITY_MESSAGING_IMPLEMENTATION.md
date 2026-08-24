# Business Utility Messaging Implementation (Phase 7)

Implementation record. Builds on [23](23_NEURA_BUSINESS_MESSAGING_MASTER_BUILD_PLAN.md), [24](24_CANONICAL_MESSAGING_FOUNDATION.md), [27](27_BUSINESS_TEMPLATE_ENGINE_IMPLEMENTATION.md), [28](28_GENERIC_APPROVAL_CENTER_IMPLEMENTATION.md), [29](29_BUSINESS_CUSTOMERS_AUDIENCES_IMPLEMENTATION.md), [30](30_CAMPAIGN_ENGINE_IMPLEMENTATION.md), [31](31_BUSINESS_OTP_AUTHENTICATION_IMPLEMENTATION.md). Utility messaging is legitimate operational/service communication triggered by a real business event -- never marketing, never an auth code. No external SMS/email provider is called anywhere in this phase.

## 1. Existing event audit

A full audit was performed before any code was written (READ-ONLY, no fabricated producers). Finding, stated honestly per the brief's own instruction: **this codebase has no booking/appointment domain and no invoice/payment event that resolves an end-customer of a business.**

| Real existing event | Event source | Customer resolvable? | Business resolvable? | Utility message today |
|---|---|---|---|---|
| Call lifecycle (`call.initiated`/`call.connected`/`call.ended`/`call.failed`) | `smartCallEvents` (EventEmitter, `server/modules/calls/smart-router.ts`) → bridged to `dispatchEvent` in `server/modules/webhooks/event-bridge.ts` | **No** -- resolves only the calling `organizationId`, never a Phase 4 `customers` row. Matching the call's phone number against `customers.normalizedPhone` would make this resolvable, but no such matching exists anywhere today | Yes | Not wired -- documented extension point (Section 23), not built |
| `recording.ready` | `server/modules/calls/controller.ts` (LiveKit egress webhook) | No (same reason) | Yes | Not wired |
| Platform billing: `payment.captured`/`payment.failed`/`refund.processed` | `server/payment-service.ts` | No -- resolves the *paying org's own user*, not a business's own end-customer. This is NeuraTalk's billing of its tenants, not a tenant's billing of ITS customers | Yes (indirectly) | Not applicable -- wrong customer relationship entirely |
| Org lifecycle: grace-period/auto-suspend/auto-resume | `server/billing-scheduler.ts`, `server/modules/b2b-admin/org-lifecycle.ts` | No | Yes | Not applicable -- audit-log-only today, no event emission mechanism at all |
| Booking, order, appointment, delivery | **Does not exist anywhere in this codebase** | -- | -- | -- |

**Design consequence, per the brief's own explicit permission** ("If an event is missing, create only the utility-facing abstraction needed to receive it later. Do not build unrelated domain systems"): Phase 7 builds `triggerUtilityMessage` as a complete, fully-tested, internal server-side receiving abstraction -- callable by any future event producer exactly the way any module calls `createAuditLog` today -- **without** fabricating a fake producer and **without** wiring it to the call-lifecycle bridge, since doing the latter correctly (phone-number matching, ambiguous-match handling) would itself be new domain-modeling work outside this phase's scope, not "the abstraction needed to receive it later." This is a deliberate, reasoned scope decision, not an oversight -- documented explicitly rather than silently doing less than possible.

## 2. Utility domain

`businessUtilityEvents`: `id, businessId, customerId, eventType, eventReference, templateVersionId, status, failureReason, messageId, chargedPaise, createdBy, createdAt, processedAt`. `eventType` is one of 8 governed values (`UTILITY_EVENT_TYPE`) matching the brief's own examples: `booking_confirmation`, `booking_update`, `order_status_update`, `payment_receipt`, `service_reminder`, `appointment_reminder`, `account_notification`, `delivery_status_update`. Reuses `customers`, `templates`/`templateVersions`, `messagingMessages`/`messagingDeliveries`/`messagingEvents`, `audit_logs`, and the shared billing primitive unmodified -- zero duplication of any existing model.

## 3. Event → message architecture

`REAL BUSINESS EVENT → UTILITY POLICY → CUSTOMER/BUSINESS RESOLUTION → APPROVED UTILITY TEMPLATE → SAFETY/DUPLICATE CHECK → CANONICAL MESSAGE → FUTURE CHANNEL ADAPTER`, implemented exactly in that order inside `triggerUtilityMessage`. **"Utility policy" is not a separate table** -- it IS the template's own `category=UTILITY` + `APPROVED` state, governed entirely by the existing Phase 2/3 machinery; a second policy object would have been the exact duplication the brief warned against. **No `/send-message` route exists, and no HTTP route can reach `triggerUtilityMessage` at all** -- it is purely an internal function, reachable only from other server-side code, matching Section 4's explicit prohibition on arbitrary client-triggered utility sends.

## 4. Template binding

Every trigger requires an exact `templateVersionId` (unlike OTP, which has a built-in default -- utility content is too varied by event type for one hardcoded fallback to make sense). Validated fresh on every call, never cached: same business, `category === UTILITY` (checked against the template's own stored row, never client input), `status === APPROVED`, and implicitly not `ARCHIVED` (archived is simply not `APPROVED`, so it's rejected by the same check -- no separate archived-check needed). All five failure modes (wrong category ×2 — marketing and authentication, tested separately as explicit category-injection guards — not approved, archived version, wrong business) are tested directly.

## 5. Variable safety

Declared template variables are validated by the existing Phase 2 `renderTemplateContent` -- an unsupplied required variable or an unsupported/undeclared supplied variable both fail closed (`RENDER_FAILED`), tested directly. **`name`, if declared, is always server-resolved from the customer's own record** -- a caller-supplied `name` value is silently ignored, tested directly (the one field this function can independently verify against ground truth it owns).

**Documented trust boundary, stated honestly rather than glossed over**: for event-specific fields (`bookingId`, `amount`, etc.), `triggerUtilityMessage` has no independent booking/order/payment system of record to verify a supplied value against (Section 1) -- it trusts its **caller** (internal server-side code, never an HTTP request body) to have already established that `eventReference`/`variables` genuinely belong to the given `customerId`, the same trust relationship every internal function in this codebase has with its callers (e.g. `createAuditLog` trusts its caller's metadata). What IS independently verified, and tested directly: `customerId` genuinely belongs to `businessId` (tenant scoping) -- a caller cannot make Business A message a customer who belongs to Business B, regardless of what `eventReference`/`variables` claim.

## 6. Tenant isolation

Every cross-business path is tested directly: `customerId` belonging to another business (`NotFoundError`), `templateVersionId` belonging to another business (`NotFoundError`), reading another business's utility event (`null`, never confirms existence), and — the deepest isolation test in this phase — the exact same `eventReference` used by two different businesses never collides (`(businessId, eventType, eventReference)` is the idempotency scope, not `(eventType, eventReference)` alone).

## 7. Customer-state rules

Explicit, not copied blindly from Campaigns as the brief warned against, but arriving at the **same technical conclusion for a different, honestly-stated reason**: **ACTIVE** → message created. **BLOCKED** → rejected (`customer_blocked`) — **policy assumption, not invented law**: a business that has blocked a customer relationship has signaled "no contact of any kind," and this phase extends that assumption to operational messages too rather than carving out an exception; a real product/legal decision might reasonably want blocked-but-still-owed-a-refund-receipt as an exception, and that is flagged here as an **explicit future policy decision**, not silently assumed away. **ARCHIVED** → rejected (`customer_archived`) — the relationship has ended, an operational message about it afterward would be confusing at best; tested directly that no message is created. **Unknown** customerId → `NotFoundError`, same generic shape as everywhere else.

## 8. Consent boundary

Utility does **not** call `isEligibleForChannel` at all — same reasoning as OTP (doc 31 section 11), extended here: `CUSTOMER_CONSENT_CHANNEL.UTILITY` exists in the schema but represents *marketing-adjacent* utility consent (e.g. a jurisdiction that requires opt-in even for transactional messages), which is a distinct, not-yet-decided policy question from "does this business relationship exist at all" (answered by `CUSTOMER_STATUS`, Section 7). This phase does not invent that policy either way — it is flagged as unresolved (Section 21) rather than silently assumed. The anti-bypass requirement ("utility must NOT become a marketing bypass") is satisfied technically, not by a consent check: Section 9 below.

## 9. Marketing-safety boundary

**The critical Phase 7 requirement, addressed honestly rather than with a fake solution.** This system cannot and does not attempt to distinguish "Your order #123 has shipped." from "Your order #123 has shipped. Buy one today with 20% off!" by reading the text — there is no NLP classifier in this codebase, and building an unreliable keyword-scanner (e.g. flagging "% off") would create false confidence while being trivially bypassed by anyone motivated to bypass it. **The actual technical boundary, exactly as the brief's Section 10 suggests when classification isn't reliably automatable**: (1) `category` is a governed, server-checked field on the template's own row, never client input, never inferable from message content; (2) a template can only be used for utility sending if it is `category=UTILITY` **and** `APPROVED` — the same human-review gate (Phase 3's Approval Center) that already exists for every template, meaning a human reviewer looking at "20% off" content in a template someone tried to mark `UTILITY` is the actual enforcement mechanism, not an algorithm; (3) there is no free-form utility content path at all — every utility message's content comes from an approved template, never arbitrary text supplied at trigger time. **This is a process/governance boundary, not a content-understanding one, and is documented as such rather than oversold.**

## 10. Idempotency

**P0, proven under genuine concurrency** — the one place in this phase (and the first place across Phases 5-7) where duplicate-creation is proven under a true simulated Postgres unique-constraint violation (`code: '23505'`) rather than deferred as an app-level-only pre-check. `businessUtilityEvents`'s unique `(businessId, eventType, eventReference)` index is claimed by the insert itself — the insert IS the atomic claim. A concurrent/duplicate trigger for the same key catches the violation and returns the **existing** row (`wasDuplicate: true`) instead of creating a second message or charge — tested directly with genuine `Promise.allSettled` concurrent triggering: exactly one of two simultaneous calls creates the message and charges, the other reports `wasDuplicate: true`, and exactly one `messagingMessages` row and one charge exist afterward.

## 11. Replay policy

**Replay is allowed and is always idempotent — explicitly the "same reference → same cached result" idiom**, not a re-execution. Retrying the exact same `(businessId, eventType, eventReference)` after a `FAILED` outcome returns the **original** failure, not a fresh attempt — even if the underlying condition that caused the failure (e.g. a blocked customer) has since been resolved. Tested directly. This is a deliberate, documented choice: a calling system that wants a genuinely fresh attempt after fixing the underlying issue is expected to mint a new `eventReference` (e.g. append an attempt suffix) — the idempotency key's entire purpose is "this exact event was already handled," and silently re-executing on retry would undermine that guarantee.

## 12. Billing boundary

`utility/billing.ts` composes on the same extracted primitive Campaigns and OTP use (`server/modules/billing/message-billing.ts`) — no third billing implementation. `PLACEHOLDER_COST_PER_UTILITY_MESSAGE_PAISE = 10` is explicitly, in writing, **not an approved price**. **Accounting boundary**: a charge only happens inside the same transaction as the canonical message's actual creation — a `FAILED` event (customer blocked, template rejected, billing itself failing) never charges anything, tested directly (`insufficient credit` test confirms zero messages AND the event recorded as `failed`, not a phantom charge with no message).

## 13. Delivery abstraction

`Business Event → Utility Message Intent (businessUtilityEvents) → Canonical Messaging (messagingMessages, category=UTILITY) → Delivery abstraction (messagingDeliveries, status=QUEUED) → [future SMS/Email/WhatsApp/NEURA channel adapter, not built]`. No Meta/WhatsApp/MSG91/Twilio/SendGrid/Azure import exists anywhere in `utility/`. Unlike OTP (which needed its own dedicated delivery table for channel/destination tracking), utility messages reuse `messagingDeliveries` directly — there's no OTP-style "redact the secret" concern here, so no parallel table was needed.

## 14. Message identity

Identical discipline to Campaigns/OTP: sender is always resolved server-side as the conversation's `BUSINESS`-type participant (`findOrCreateCustomerConversation`, reused unmodified from Phase 5) — never a client-supplied `senderParticipantId`, since no client-facing route reaches this function at all. `generationSource: { type: "utility_event", id: event.id }` is written into `messagingEvents.payload` exclusively by this server-side code. `category` is hardcoded to `UTILITY` inside the trigger function — no parameter, no code path, by which any caller (trusted or not) can set it to anything else. All tested directly.

## 15. Retry / failure

Two terminal states only (`CREATED`, `FAILED`) — no `PENDING`/`PROCESSING` value, since the entire pipeline resolves synchronously within one transaction with no long-running worker step (unlike Campaigns, which processes a bounded batch per tick). The row is inserted with `status=FAILED` as its safe provisional default (the insert is what atomically claims the idempotency key, Section 10) and is only promoted to `CREATED` after the canonical message actually, successfully commits in the same transaction — so a crash mid-processing is correctly indistinguishable from a genuine failure from the outside, never silently reported as success. Retries are idempotent by construction (Section 10/11) — a retry can never create a second canonical message.

## 16. Scheduling

**Not built.** No delayed-reminder scheduler was added in this phase — the brief explicitly instructed not to build a general scheduler and to document the extension point instead if none exists. Precedent exists (`campaigns/scheduler.ts`'s `setInterval`-based convention) for a future phase that needs, say, `SERVICE_REMINDER`/`APPOINTMENT_REMINDER` events fired X hours before a scheduled time — that future work would follow the identical convention, not invent a new one, and would itself need a real booking/appointment domain to schedule against (Section 1), which doesn't exist yet either.

## 17. RBAC

**One new permission: `UTILITY_VIEW`.** No `UTILITY_MANAGE`/`UTILITY_EXECUTE`/anything resembling "can send any utility message" was added — tested directly (a dedicated test asserts no such permission exists in `PERMISSIONS` at all). Template authoring/approval for `category=UTILITY` templates reuses `TEMPLATES_MANAGE`/`TEMPLATES_APPROVE` unchanged — there is no separate "utility template management" permission, since the underlying object (a template) and its governance are identical to every other category.

## 18. Audit

Reuses `audit_logs` exclusively via `utility/audit.ts` (same thin-wrapper pattern as every prior phase). Records business, customer, event type, template version id (via metadata), message id (implicitly, via the row's own `entityId`/`messageId`), outcome, and failure reason — **never** the rendered message content or any caller-supplied variable value. Tested directly: a dedicated test confirms a known, distinctive variable value used in the rendered content never appears in any audit call's metadata.

## 19. Reporting foundation

`getUtilityReport(businessId)` returns real, derived-only counts (`received`, `created`, `failed`, `failedByReason`) — never a fabricated "delivered" claim, since no channel adapter exists to produce delivery evidence in this phase (`messagingDeliveries.status` stays `QUEUED`, honestly, exactly as OTP and Campaigns leave it). Tested directly, including the reason breakdown.

## 20. Security review

1. **Tenant isolation** — closed, Section 6, tested. 2. **Event ownership** (implicit in claim being scoped to businessId) — tested via the cross-business-eventReference-independence test. 3. **Customer ownership** — tested. 4. **Template ownership** — tested. 5. **Template approval** — tested. 6. **UTILITY category enforcement** — tested. 7. **MARKETING category injection** — tested directly (a `category=marketing` template is rejected with `template_not_utility_category`, not silently used). 8. **AUTHENTICATION category injection** — tested directly (same rejection for `category=authentication`). 9. **Variable injection** — tested (unsupported/missing variables rejected; `name` cannot be spoofed). 10. **Cross-business reference manipulation** — tested (Section 6). 11. **Duplicate event** — tested. 12. **Concurrent duplicate event** — tested with genuine `Promise.allSettled`. 13. **Replay** — tested, documented policy (Section 11). 14. **Retry** — tested, idempotent by construction. 15. **Blocked customer** — tested. 16. **Archived customer** — tested. 17. **Consent boundary** — documented, deliberately not gated (Section 8), flagged as an open policy question rather than silently resolved either way. 18. **Sender identity injection** — structurally impossible, tested. 19. **generationSource injection** — same, tested. 20. **Billing failure** — tested, fails closed, no orphaned charge. 21. **Audit integrity** — tested, no content/secret leakage. 22. **Unauthorized direct utility send** — structurally impossible (no HTTP route reaches the trigger function at all; the view routes are read-only and RBAC-gated). **No P0/P1 was found.**

## 21. Migration

`migrations/0011_business_utility_messaging.sql` — 1 new table (`business_utility_events`), fully additive. REFERENCES `organizations`, `customers`, `template_versions`, `messaging_messages`, `users` — no `ALTER TABLE` against any of them. **Not applied to any database** — same standing no-local-DB constraint as every prior phase; verified via the mock-based test suite (39 new tests) instead of real execution.

## 22. Tests

39 new tests across 2 files: `utility.test.ts` (29, full integration using the REAL customers/templates/messaging/utility services together against one shared fake DB, same pattern as `otp.test.ts`/`campaigns.test.ts` — with a constraint-aware fake `InsertChain` specifically simulating a real Postgres unique-violation for this phase's genuine-concurrency idempotency requirement), `utility-rbac.test.ts` (10). All 22 numbered security-review areas from the brief are covered. Complete-suite result: **635/635**, up from 596, zero regressions to Phases 0-6.

## 23. Future external-channel architecture

Identical extension shape to Campaigns (doc 30 section 21) and OTP (doc 31 section 25): `messagingDeliveries` rows stay `QUEUED` until a future channel adapter reads them and calls a real provider, updating status/failure on the way back — nothing built in this phase needs to change for that adapter to exist. The other concrete extension point, specific to this phase, is Section 1's documented gap: wiring the existing, real call-lifecycle event bridge (`smartCallEvents` → `event-bridge.ts`) to `triggerUtilityMessage` by adding phone-number-to-customer matching would be the natural next real event producer, once a future phase decides to build that matching logic deliberately rather than as a rushed side effect of this one.

---

**PHASE 7 UTILITY MESSAGING IMPLEMENTED — NOT DEPLOYED.**
