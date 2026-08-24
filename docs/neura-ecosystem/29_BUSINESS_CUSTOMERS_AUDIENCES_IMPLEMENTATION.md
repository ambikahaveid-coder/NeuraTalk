# Business Customers + Audiences Implementation (Phase 4)

Implementation record. Builds on [23](23_NEURA_BUSINESS_MESSAGING_MASTER_BUILD_PLAN.md), [28](28_GENERIC_APPROVAL_CENTER_IMPLEMENTATION.md), [27](27_BUSINESS_TEMPLATE_ENGINE_IMPLEMENTATION.md), [26](26_BUSINESS_PROFILE_BRANDING_IMPLEMENTATION.md), [14](14_NEURA_BUSINESS_SAAS_SPECIFICATION.md). This is a recipient FOUNDATION for future Campaigns/OTP/Utility/Marketing -- not a CRM product, and no send/campaign logic exists anywhere in this phase.

## 1. Existing identity audit

| Existing entity | Purpose | Reuse / extend / new |
|---|---|---|
| `users` | Platform login identity (E.164 phone/email, partial-unique) | Reused only as an optional `linkedUserId` pointer -- never mutated, never required |
| `organizations` + `orgMembers` | Business entity + staff membership | Reused directly as `businessId` scope + `requireCompanyAccess` |
| `supportContacts` | Platform support info shown to end users | Unrelated, not touched |
| `userContacts` (Address Book) | A consumer's personal call/phone contact list | Unrelated (per-consumer, no business scoping, no consent) -- not reused, not touched |
| `businessConversations.customerId` | Forward-reference placeholder explicitly left for this phase (Phase 0 comment: "doesn't exist until Phase 4") | Wired to a real FK now (Section 3) |
| `messagingParticipants` + `MESSAGING_PARTICIPANT_TYPE.CUSTOMER` | Canonical messaging participant types, already anticipates external customers | Reused as-is -- no schema change |
| `blockedUsers` | User-to-user block pairs (`users.id` both sides) | NOT reusable directly (hardcoded to `users.id`); the existing `status` field on `customers` (Section 5) covers the business-blocks-customer case without a second table |
| `userConsents` + `CONSENT_TYPE` (incl. `MARKETING`) | User-scoped GDPR/feature consent | NOT reusable directly (keyed to `users.id`, and a business customer is often NOT a platform user); pattern mirrored in a new customer-scoped table (Section 10) |
| `dataSubjectRequests` | GDPR export/deletion request tracking, user-scoped | NOT extended in this phase (Section 11) -- documented as an open policy question, not invented |
| `server/bulk-import.ts`'s `parseCSV()` | Working CSV parse/validate/multer pipeline (currently used for user import) | NOT used in this phase -- CSV import was evaluated and deliberately deferred (Section 19) |
| `auditLogs` + `createAuditLog` | Central audit trail | Reused directly, `entityType: "customer"` / `"audience"` |
| `PERMISSIONS`, `requirePermission`/`requireAnyPermission` | RBAC | No `CUSTOMERS_*`/`AUDIENCES_*` existed -- 4 new permissions added (Section 12) |
| `shared/phone.ts`'s `normalizePhoneNumber` | E.164 phone normalization, platform-standard | Reused directly for all customer phone ingestion |

No duplicate identity table was created. No existing table was repurposed to mean something it didn't already mean.

## 2. Customer model

`customers` (businessId-scoped): `id, businessId, linkedUserId?, name?, phone?, normalizedPhone?, email?, normalizedEmail?, externalRef?, notes?, status, source, createdBy, createdAt, updatedAt, archivedBy?, archivedAt?`. At least one of name/phone/email is required at creation; every other field is optional -- a business customer may be phone-only, email-only, or a bare external reference with no contact info at all yet.

## 3. Business relationship model

`linkedUserId` (nullable, `→ users.id`) is the *only* connection between a `customers` row and the global NEURA identity system. Setting it never mutates the `users` row, and NEURA User #123 can simultaneously be `linkedUserId` on Business A's customer row and have no row at all in Business B -- the exact example given in the brief. `businessConversations.customerId`, left as a documented forward-reference in Phase 0 (migrations/0004), is now wired to a real `.references(() => customers.id)` FK in `shared/schema.ts` and `migrations/0008`'s `ALTER TABLE` -- the one and only change to a pre-existing canonical-messaging table in this phase, and it does exactly what the Phase 0 comment said would happen once Phase 4 existed.

## 4. Deduplication

P0, per the brief. Same `businessId` + same normalized phone, normalized email, or externalRef is a deterministic conflict (`DuplicateCustomerError`, carrying the existing row's id), never a silent merge -- checked at the application layer on both create and update, and backed by three partial unique indexes as DB-level defense-in-depth (`customers_business_phone_idx`, `customers_business_email_idx`, `customers_business_external_ref_idx`, each `WHERE ... IS NOT NULL AND ... != ''`). Two different businesses may freely have customers with the same phone/email -- every index is scoped by `businessId`, never global. Tested directly (customers.test.ts, "14. Duplicate customer detection").

## 5. Normalization

Phone: `shared/phone.ts`'s existing `normalizePhoneForIndia` (E.164, defaults to `+91`) -- the same normalizer already used platform-wide, not a new one. Email: a new minimal `shared/email.ts` (`normalizeEmail` = trim + lowercase only, no format validation -- that's zod's `.email()` at the controller boundary) was added since no email normalizer existed anywhere in the codebase (confirmed by the pre-implementation audit). Raw `phone`/`email` as entered are stored alongside the normalized dedup-key columns, so display never has to reverse-normalize.

## 6. Customer lifecycle

`ACTIVE ↔ BLOCKED` (via `updateCustomer`), and `{ACTIVE, BLOCKED} → ARCHIVED` (via the dedicated `archiveCustomer` action, not through the generic update route -- archiving is a one-way action, not a settable field, mirroring why Phase 2 gave `ARCHIVED` its own route rather than letting it ride through a generic PATCH). Archived customers cannot be edited (`ValidationError`) but remain individually retrievable -- never hard-deleted. `BLOCKED` is a business-relationship status only; it is never read by, and never implies anything about, `customerConsents` (Section 10) -- explicitly kept as three separate concepts per the brief's warning (status / consent / delivery status).

## 7. Audience model

`audiences` (businessId-scoped): `id, businessId, name, description?, type, status, createdBy, createdAt, updatedAt, archivedBy?, archivedAt?`. Unique `(businessId, name)`. Lifecycle: `ACTIVE → ARCHIVED` only (one-way, dedicated action). An archived audience keeps its members and remains readable; only new membership writes and edits are blocked.

## 8. Membership model

Explicit junction table `audienceMembers` (`id, audienceId, customerId, addedBy, addedAt`), **not** a JSON array on `audiences` -- the brief's explicit instruction. Unique `(audienceId, customerId)` prevents double-membership. A customer may belong to any number of audiences simultaneously (tested directly: "13. Multiple audiences per customer"). Adding a member cross-checks that the customer belongs to the *same* business as the audience and is not archived; the audience itself must not be archived. Removing a member remains allowed even on an archived audience (cleanup shouldn't be blocked by archival).

## 9. Static/dynamic decision

Only `STATIC` is implemented. `AUDIENCE_TYPE.DYNAMIC` exists as a named constant so the API/schema shape is already future-proof, but creating an audience with `type: "dynamic"` is rejected at the service layer with an explicit "not implemented yet" `ValidationError` -- never silently treated as static, never faked with a hardcoded filter. The extension point for a real implementation is exactly this one `if` branch in `server/modules/audiences/service.ts`'s `createAudience`; a rules/query engine would replace it without touching the membership model, which stays the same either way.

## 10. Consent boundary

**Not a Marketing Consent Engine** -- a minimal `customerConsents` table (`id, businessId, customerId, channel, status, source?, updatedBy?, createdAt, updatedAt`, unique `(customerId, channel)`) exists solely so the architecture cannot make the mistake the brief warned against: a customer existing is never read as eligibility. `isEligibleForChannel(businessId, customerId, channel)` returns `false` whenever no row exists for that (customer, channel) pair -- eligibility is opt-in by absence, not opt-out. Three channels are modeled now (`MARKETING`, `UTILITY`, `AUTHENTICATION`) mirroring `MESSAGE_CATEGORY`'s existing vocabulary. `setChannelConsent` is exported from the service but **no HTTP route exposes it in Phase 4** -- the brief's API section only asked for Customer and Audience CRUD, so this is a documented, tested (customers.test.ts, "30. Communication eligibility") extension point for the future Marketing phase to call into, not a UI feature shipped early. No fake consent rows are ever created to satisfy a test -- every test that asserts "eligible" first calls `setChannelConsent` explicitly.

## 11. GDPR interaction

The existing `userConsents`/`dataSubjectRequests` machinery (`server/gdpr-routes.ts`) is entirely `users.id`-keyed and was deliberately **not** extended to cover `customers` in this phase -- a business's external contact is very often not a NEURA user at all, so "delete my NEURA account" (a `users`-scoped GDPR request) has no defined effect on a `customers` row today. This is flagged, not resolved: **unresolved policy decision** -- when a `users` row with a `linkedUserId` back-reference from some business's `customers` row is deleted or GDPR-erased, should that business's customer record be anonymized, unlinked, or left untouched? No technical behavior was invented to answer this; `linkedUserId` simply becomes a dangling reference today (the FK has no `onDelete` cascade or set-null configured on `customers.linkedUserId` deliberately, so a user deletion would need its own explicit handling, not a silent cascade). This is Risk 1 in Section 17.

## 12. RBAC

Four new permissions -- `CUSTOMERS_VIEW`, `CUSTOMERS_MANAGE`, `AUDIENCES_VIEW`, `AUDIENCES_MANAGE` -- evaluated and added because, unlike Phase 3 (which could reuse Templates' existing permissions), no customer/audience-shaped permission existed anywhere to reuse. VIEW/MANAGE split per entity (not a single combined permission) so an agent can be given read access to customers without audience-management rights, or vice versa. `requireAnyPermission(MANAGE, VIEW)` gates reads; `requirePermission(MANAGE)` alone gates writes -- identical shape to Phase 2's `TEMPLATES_MANAGE`/`TEMPLATES_APPROVE` split. No new authorization framework, no per-row ACL.

## 13. Tenant isolation

P0. Every service function takes `businessId` as an explicit first parameter and every read/write query includes `eq(*.businessId, businessId)` (customers) or resolves the parent audience's `businessId` before touching membership (audiences/membership). A cross-business `customerId`/`audienceId` never returns "forbidden" -- it returns `NotFoundError`/`null`, identical to Phase 3's approval-center convention of never confirming a resource exists in a business the caller doesn't belong to. `addMember` additionally verifies the *customer* (not just the audience) belongs to the calling business -- tested directly (audiences.test.ts, "rejects adding a customer belonging to a DIFFERENT business"). Routes never trust `businessId` from anywhere but the URL, verified by `requireCompanyAccess` before any handler runs. Tested for URL manipulation (customer/audience id from another business), body manipulation (`businessId`/`status` smuggled into a `.strict()` body, rejected with 400), and query manipulation (invalid `status` filter value rejected with 400).

## 14. API contracts

| Route | Method | Auth |
|---|---|---|
| `/api/business/:businessId/customers` | POST | `requireCompanyAccess` + `CUSTOMERS_MANAGE` |
| `/api/business/:businessId/customers` | GET | `requireCompanyAccess` + (`CUSTOMERS_MANAGE` or `CUSTOMERS_VIEW`) |
| `/api/business/:businessId/customers/:customerId` | GET | same as list |
| `/api/business/:businessId/customers/:customerId` | PUT | `CUSTOMERS_MANAGE` |
| `/api/business/:businessId/customers/:customerId/archive` | POST | `CUSTOMERS_MANAGE` |
| `/api/business/:businessId/audiences` | POST | `AUDIENCES_MANAGE` |
| `/api/business/:businessId/audiences` | GET | `AUDIENCES_MANAGE` or `AUDIENCES_VIEW` |
| `/api/business/:businessId/audiences/:audienceId` | GET | same as list |
| `/api/business/:businessId/audiences/:audienceId` | PUT | `AUDIENCES_MANAGE` |
| `/api/business/:businessId/audiences/:audienceId/archive` | POST | `AUDIENCES_MANAGE` |
| `/api/business/:businessId/audiences/:audienceId/members` | POST | `AUDIENCES_MANAGE` |
| `/api/business/:businessId/audiences/:audienceId/members` | GET | view |
| `/api/business/:businessId/audiences/:audienceId/members/:customerId` | DELETE | `AUDIENCES_MANAGE` |

No `/campaigns/send`, `/otp/send`, `/marketing/send`, or any messaging-send endpoint exists anywhere in this phase.

## 15. Index strategy

`customers`: `(businessId)`, `(businessId, status)` (for the status-filtered list view), `(businessId, name)` (for name search/sort), plus the three partial unique dedup indexes (Section 4). `customerConsents`: `(businessId)`, unique `(customerId, channel)`. `audiences`: `(businessId)`, unique `(businessId, name)`. `audienceMembers`: `(audienceId)`, `(customerId)` (for "which audiences is this customer in" lookups), unique `(audienceId, customerId)`. Search (`ilike` on name/phone/email/externalRef) is not separately indexed -- it's a `LIKE '%term%'` scan, acceptable at current expected per-business customer volumes; a real trigram/full-text index is a documented future optimization if a business's customer count grows large enough to need it, not built speculatively now.

## 16. Audit model

Every mutation (`customer_created`, `customer_updated`, `customer_archived`, `audience_created`, `audience_updated`, `audience_archived`, `audience_member_added`, `audience_member_removed`, plus consent changes) writes to the real, persistent `audit_logs` table via thin wrappers (`server/modules/customers/audit.ts`, `server/modules/audiences/audit.ts`) over the existing `server/audit.ts`'s `createAuditLog` -- identical pattern to Phases 1-3. Two new `AUDIT_ACTION` values were added (`MEMBER_ADDED`, `MEMBER_REMOVED`); every other action reuses `CREATE`/`UPDATE`/`ARCHIVE`/`CONSENT_ACTION`, all of which already existed. No second audit system was created.

## 17. Security review

IDOR (closed -- every customer/audience/membership read+write scoped by verified `businessId`), tenant escape (tested, Section 13), customer enumeration across tenants (cross-business id lookups return 404/null, never 403 -- doesn't confirm existence), phone/email leakage (search/list is business-scoped, no cross-tenant search path exists), unauthorized audience access (same `requireCompanyAccess` + permission gates as customers), privilege escalation (no client-influenceable permission resolution -- unlike Phase 3's dynamic-by-resourceType permission, these routes use static `requirePermission`), mass assignment (`.strict()` zod schemas on every write route, tested), external reference manipulation (dedup + ownership checks prevent hijacking another business's `externalRef` namespace since it's businessId-scoped), duplicate customer abuse (P0 dedup, Section 4), unsafe import (CSV import was NOT built in this phase -- see Section 19, so there is no import attack surface to review yet), consent bypass (no route can set consent without going through `setChannelConsent`'s explicit channel validation; no route infers eligibility from anything else). **No P0/P1 found.**

One design note, not a finding: `addMember`'s customer-ownership check and the audience-ownership check are two separate reads (not a single transactional check) -- acceptable because both reads happen before the write and Phase 4 has no concurrent-membership-mutation requirement analogous to Phase 3's approval race (there's no "the same membership decided twice" hazard here; the unique index on `(audienceId, customerId)` is the actual concurrency guard against a genuine double-insert race, and is a DB-level constraint, not merely app-level).

## 18. Migration

`migrations/0008_business_customers_audiences.sql` -- 4 new tables (`customers`, `customer_consents`, `audiences`, `audience_members`), fully additive, plus exactly one `ALTER TABLE business_conversations ADD CONSTRAINT ... FOREIGN KEY (customer_id) REFERENCES customers(id)` -- the single, pre-documented (Phase 0 comment) exception to "don't modify canonical messaging tables." No AI chat, personal chat, or group chat table is touched. **Not applied to any database** -- same standing no-local-DB constraint as every prior phase; verified via the mock-based test suite (81 new tests) instead of real execution, which did not happen and is not claimed to have happened.

## 19. Tests

81 new tests across 4 files: `tests/unit/customers.test.ts` (34), `tests/unit/audiences.test.ts` (28, full integration using the real customers + audiences services against one shared fake DB, proving the actual cross-module wiring -- same pattern as Phase 3's `approvals.test.ts`), `tests/unit/customers-rbac.test.ts` (10), `tests/unit/audiences-rbac.test.ts` (9). All 30 numbered test areas from the brief are covered, with one explicit scope note: items 26-29 ("existing messaging/template/approval/business-profile regression") were verified by running the complete pre-existing suite unchanged rather than writing new tests that re-assert old behavior -- the pre-existing 382 tests all still pass, unmodified, which is the more genuine regression signal. Bulk CSV import (brief's "Import" section) was evaluated and **explicitly not implemented** in this phase -- `server/bulk-import.ts`'s CSV pipeline exists and was identified as the reuse target, but wiring it to `customers` (with its own validation/dedup-conflict-per-row semantics) is nontrivial enough that building it without dedicated test coverage would have meant exactly the "unnecessarily complex import pipeline" the brief warned against; documented here as deferred, not silently dropped.

## 20. Future Campaign integration

A future Campaigns/Marketing phase consumes this foundation exactly as designed: resolve a target audience via `listMembers(businessId, audienceId)`, then for each member call `isEligibleForChannel(businessId, customerId, "marketing")` before ever attempting to send -- eligibility is checked per-send, never assumed from membership. `messagingParticipants` rows with `participantType: "customer"` point at `customers.id` (Section 1) so a campaign-created conversation slots directly into the Phase 0 canonical messaging model without a new participant type. CSV bulk import (Section 19) and dynamic audiences (Section 9) are the two concretely deferred extension points a future phase would build on top of this schema, not around it.

---

**PHASE 4 CUSTOMERS + AUDIENCES IMPLEMENTED — NOT DEPLOYED.**
