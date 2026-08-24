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

# PHASE 4 HARDENING REVIEW (2026-08-24)

Read-only review performed before Campaigns becomes load-bearing on this foundation. Reference commit at review start: `1549c31`. No schema, migration, or production behavior was changed as a result of this review except one focused test addition (Section 5 below) closing a gap the review itself surfaced.

## H1. GDPR / linkedUserId

**First finding, load-bearing for everything below: no code path in this codebase executes an actual account deletion today.** `server/gdpr-routes.ts`'s `POST /api/gdpr/delete-request` and `server/production-routes.ts`'s equivalent both only insert a row into `dataSubjectRequests` with `status: "pending"` and a "completed within 30 days" message -- there is no cron job, admin action, or any other code in `server/` that reads a pending deletion request and actually deletes a `users` row, `customers` row, or anything else. Deletion is fulfilled by an offline/manual process outside this codebase. This means every scenario below describes what *would* happen if/when that process runs, not something observed executing.

Walking the seven scenarios:

- **A. Customer has no `linkedUserId`.** Purely a business record. Nothing to reconcile with global identity, ever.
- **B. Customer is linked to a NEURA user.** `customers.linkedUserId → users.id`, no `onDelete` clause in either `shared/schema.ts` or `migrations/0008` -- Postgres defaults this to `NO ACTION` (RESTRICT). Confirmed by direct comparison of both files (Section H6).
- **C. NEURA user requests GDPR export.** `GET /api/gdpr/export` (`server/gdpr-routes.ts:9`) exports rows scoped to `users.id` only -- conversations, voice profiles, subscriptions, invoices, devices, consents. It does **not** walk `customers.linkedUserId` to include any business's customer record about that user. A business's notes/status/consent about this person are business-owned data, not exported as "the user's data" -- consistent with Section H1's identity/relationship split, but worth stating explicitly since it wasn't decided anywhere before this review.
- **D. NEURA user requests deletion.** Only a `dataSubjectRequests` row is created (see the load-bearing finding above). No cascade to `customers` is triggered because no deletion executes at all yet.
- **E. The global user account is deleted** (hypothetical, since nothing does this today). If it were attempted via a plain `DELETE FROM users WHERE id = ...`, Postgres would **reject it** with a foreign-key violation for every `customers.linked_user_id`, `customers.created_by/archived_by`, `customer_consents.updated_by`, `audiences.created_by/archived_by`, and `audience_members.added_by` row still pointing at that user -- RESTRICT fails closed. This is actually the safe default: it is structurally impossible to silently lose or orphan a business's customer data by deleting a user account, because the database itself blocks it until the reference is explicitly resolved.
- **F. The business customer record remains after global deletion.** Given E, this is currently moot -- deletion cannot proceed while the reference exists. If a future deletion process is built, it would have to explicitly choose, for `linkedUserId` specifically, between (i) setting it to `NULL` (business keeps its own record, contact history, and notes; loses the "this is also a NEURA user" fact) or (ii) blocking the deletion until a business manually unlinks. Both are legitimate; this review does not choose one -- see H1's conclusion.
- **G. Customer consent exists independently of global user consent.** Confirmed structurally: `customerConsents` and `userConsents` are two separate tables with no FK between them and no code path that reads one to populate the other. A person's platform-level `MARKETING` consent in `userConsents` (`shared/schema.ts:1832`) has zero effect on any business's `customerConsents` row for that same person, and vice versa -- exactly the "consent is per-relationship, not per-identity" design the brief asked for.

**What belongs to global NEURA identity**: `users` row itself, platform-level consents (`userConsents`), call/voice history, anything under `GET /api/gdpr/export` today.

**What belongs to the Business Customer relationship**: the `customers` row's name/phone/email/notes/status/source (as *that business* recorded them), `customerConsents` (per-business, per-channel), `audienceMembers` (which of that business's lists this contact is on).

**What must be deleted/anonymized on a global user deletion**: not decided by this review -- explicitly a **policy decision required** (see below). Nothing is silently deleted or silently kept; the DB's RESTRICT default currently forces the question to be answered before deletion can even proceed, which is the safest possible starting state.

**What may remain as a business-owned customer record**: the business's own `name`/`phone`/`email`/`notes` as they entered them -- these were never "the user's data" in the export sense, they're the business's own record of a relationship, same as a paper contact book would be.

**What must happen to `linkedUserId`**: **policy decision required.** This review recommends (as a non-binding suggestion, not an implemented change) that a future deletion process **set `linkedUserId` to NULL** rather than block indefinitely or cascade-delete the business's customer row -- it preserves the business's own relationship record (which is legitimately theirs) while fully severing the connection to the deleted identity. This is a recommendation for the eventual policy decision, not something this review is authorized to implement.

**Conclusion**: Correctly and honestly, the answer here is **"policy decision required."** No production behavior was changed. The one concrete, verified fact this review adds beyond doc 29's original Section 11 is that the RESTRICT default makes the current state fail-safe (blocks deletion rather than silently corrupting business data) -- this was true by construction since Phase 4's original implementation, just not previously confirmed against the actual GDPR route code.

## H2. Search / scale review

Inspected `server/modules/customers/service.ts`'s `listCustomers`. Exact predicate: `WHERE business_id = $1 [AND status = $2] [AND (name ILIKE '%term%' OR phone ILIKE '%term%' OR email ILIKE '%term%' OR external_ref ILIKE '%term%')] ORDER BY created_at DESC LIMIT $n OFFSET $m`.

**Current indexes usable by this query**: `customers_business_idx (business_id)` and `customers_business_status_idx (business_id, status)` are both usable for the mandatory `business_id` (and optional `status`) equality filter. No index is usable for the `ILIKE '%term%'` clauses -- a leading wildcard defeats a plain btree index by construction, in Postgres or any RDBMS.

**Exact lookups** (phone/email/externalRef, used by `findDuplicate` at create/update time, not by the list/search endpoint): these use plain `eq()`, not `ILIKE`, and each is directly covered by its own partial unique index (`customers_business_phone_idx`, `customers_business_email_idx`, `customers_business_external_ref_idx`) -- these will be fast index scans regardless of table size.

**Expected query plan** (no live database exists to run a real `EXPLAIN`, per the standing no-local-DB constraint -- this is a structural read of the query against Postgres semantics, stated as such, not claimed as an observed plan): the planner should use `customers_business_idx` (or `customers_business_status_idx` if a status filter is present) to restrict to the requesting business's rows first, then apply the `ILIKE` predicates as a filter over that already-narrowed row set -- **not** a scan of the entire `customers` table across all businesses. Cost scales with one business's customer count, not the platform's total.

**Is unindexed ILIKE acceptable for the current phase?** Yes. No campaign, no bulk send, and no external caller exists yet that depends on this endpoint's latency at scale; it backs an admin-facing customer list/search UI. Acceptable now; not indefinitely.

**What will Campaigns require?** Campaigns need `listMembers(businessId, audienceId)` (already indexed via `audience_members_audience_idx`) and `isEligibleForChannel` (indexed via the unique `(customer_id, channel)` index) -- **neither of Campaigns' actual read paths depends on the `ILIKE` search at all.** The free-text search endpoint is an admin-UI convenience for building/curating a business's customer list by hand, not something a running campaign send-loop calls. This is a meaningful finding: **the search index gap does not block Campaign readiness** the way it might first appear to.

**Recommended indexes, if this is ever revisited** (not created, not applied -- documentation only, per instruction):
- `CREATE INDEX customers_name_trgm_idx ON customers USING gin (name gin_trgm_ops);` (requires `CREATE EXTENSION pg_trgm`) if free-text name search needs to scale past what an in-row filter comfortably handles.
- No new index is recommended for phone/email/externalRef -- already covered by the existing unique indexes for exact match, and substring search on those fields was never a stated requirement.

**Conclusion**: current state is acceptable; no index migration is proposed or needed for Phase 5 readiness specifically.

## H3. Campaign readiness review

Traced the full intended chain: `Customer → Audience → Membership → Consent/Eligibility`.

- **Audience membership**: `audienceMembers`, explicit junction, unique `(audienceId, customerId)` -- `listMembers()` is the one function a future Campaign engine needs to resolve a target list. No duplication of identity logic; it returns `customerId` + display fields, nothing more.
- **Customer status / archived / blocked**: `addMember` already refuses to add an `ARCHIVED` customer (`server/modules/audiences/service.ts`). It does **not** refuse a `BLOCKED` customer -- this is intentional (block is business-relationship state, not eligibility, per doc 29 Section 6) but creates an explicit **contract a future Campaign implementer must honor**, not a bug today: a `BLOCKED` customer can legally be a member of an audience, and *must* still be excluded at send time by checking `status !== BLOCKED` in addition to `isEligibleForChannel()` -- consent and status are two independent gates, and Campaigns must check both. This was implicit in doc 29's original design but not written down as an explicit requirement until this review; it now is.
- **Consent records**: `customerConsents`, cascades on customer delete, independently keyed per channel -- `isEligibleForChannel(businessId, customerId, channel)` is the single function Campaigns should call per recipient, per send. No duplicate consent-check logic exists anywhere else in the codebase to accidentally diverge from.
- **Tenant ownership**: every one of the four functions above takes `businessId` as an explicit parameter and enforces it server-side -- a Campaign engine built on top of these functions inherits tenant isolation for free, it cannot bypass it by construction (there's no "business-agnostic" variant of any of these functions).
- **messagingConversations / messagingMessages**: confirmed by direct inspection of `server/modules/messaging/service.ts`'s `createMessage` -- it hardcodes `category: MESSAGE_CATEGORY.CONVERSATIONAL` (line 238) and only ever resolves the sender from `authenticatedUserId` (a human `USER`-type participant already in the conversation). **There is currently no code path anywhere that can create a `MARKETING`-category message, or send to a `CUSTOMER`-type participant who wasn't already an explicit conversation member.** This is a strong, structural confirmation of the Marketing Safety Boundary (Section H4) -- not just "no route exists," but "the one function capable of writing a message row cannot express a campaign send even if called directly."
- **templates**: independent of customers entirely -- a template's content/approval lifecycle has no reference to any customer or audience. No contradiction; a future Campaign would read an approved `templateVersion` and a resolved audience member list as two unrelated inputs, exactly as designed.
- **approvalRequests**: same -- template approval and customer/audience data never intersect. No contradiction.

**No architectural contradiction was found.** The one thing this review adds that wasn't explicit before: the BLOCKED-status contract above, now documented so Phase 5 doesn't have to rediscover it.

## H4. Marketing safety boundary

Confirmed, not merely by design intent but by direct code inspection: `customer exists ≠ marketing eligible` holds structurally, because (1) `isEligibleForChannel` defaults to `false` on the *absence* of a row, never derives an answer from the `customers` table itself, and (2) as found in H3, there is currently no function in the codebase capable of sending a marketing message at all -- so there is no existing code for future code to "accidentally" bypass consent through. The risk surface for accidental bypass is entirely in a *future* Campaign engine's own implementation, not in anything Phase 4 exposes today. The Marketing Consent Engine remains unbuilt, as instructed.

## H5. Security review

Read-only re-verification of the seven items, plus the linkedUserId item specifically requested this round:

- **IDOR / tenant escape / cross-business enumeration**: re-confirmed via the existing tenant-isolation tests (customers.test.ts, audiences.test.ts, Section 13) -- all cross-business lookups return `NotFoundError`/`null`, never leak existence.
- **linkedUserId manipulation**: inspected both `createCustomerSchema` and `updateCustomerSchema` in `server/modules/customers/controller.ts` -- **neither includes `linkedUserId` in its `.strict()` allow-list.** The field exists on the service layer (for future internal/system use, e.g. auto-linking a verified phone match) but is **not reachable from any HTTP route today** -- confirmed by re-reading `routes.ts`, which registers no route that could reach it. This was true since the original implementation but had not been explicitly tested; **one focused test was added** (`customers-rbac.test.ts`, "postCustomer/putCustomer rejects a linkedUserId in the body") to convert this from "visually confirmed" into "test-verified" -- see Section 7.
- **Consent manipulation**: `setChannelConsent` is exported from the service but no route registers it anywhere (`server/modules/customers/routes.ts` has exactly 5 routes, none reach it) -- confirmed by re-reading the route file. No consent-manipulation vector exists via HTTP today.
- **Audience membership manipulation**: re-confirmed `addMember` cross-checks the customer's `businessId` against the audience's `businessId` independently (not merely trusting the audience's ownership check) -- tested directly, still passing.
- **Archived customer access**: intentional, not a defect -- archived customers remain individually readable (never hard-deleted) but reject all edits; re-confirmed via existing tests.
- **Mass assignment**: re-confirmed `.strict()` on every write schema in both `customers/controller.ts` and `audiences/controller.ts` -- unknown fields (including `businessId`, `status`, and now explicitly `linkedUserId`) are rejected with 400 before reaching the service layer.

**No P0/P1 issue was found.** Nothing required stopping this review.

## H6. Migration review

Direct line-by-line comparison of `migrations/0008_business_customers_audiences.sql` against the corresponding `shared/schema.ts` definitions (`customers`, `customerConsents`, `audiences`, `audienceMembers`, and the `business_conversations.customer_id` FK):

- **FK correctness**: every `REFERENCES` clause in the migration matches the corresponding `.references()` call in schema.ts, including `ON DELETE CASCADE` on `businessId`/`customerId`/`audienceId` foreign keys and the deliberate *absence* of `ON DELETE` (RESTRICT) on every `→ users.id` reference (`linkedUserId`, `createdBy`, `archivedBy`, `updatedBy`, `addedBy`) -- consistent with the rest of the schema's established convention for actor-reference columns (e.g. `approvalRequests.requestedBy` has the same RESTRICT default), not a new inconsistency introduced by Phase 4.
- **Indexes**: all 11 indexes across the four new tables match name-for-name and column-for-column between the migration and schema.ts.
- **Uniqueness**: the three partial-unique dedup indexes on `customers`, the unique `(customerId, channel)` on `customerConsents`, the unique `(businessId, name)` on `audiences`, and the unique `(audienceId, customerId)` on `audienceMembers` all match exactly, including the `WHERE` clauses on the partial indexes.
- **Nullable behavior**: matches -- `linkedUserId`, `name`, `phone`, `normalizedPhone`, `email`, `normalizedEmail`, `externalRef`, `notes`, `archivedBy`, `archivedAt` are nullable in both; `businessId`, `status`, `source`, `createdBy` (and the equivalent required columns on the other three tables) are `NOT NULL` in both.
- **Enum compatibility**: all enum-shaped columns (`status`, `source`, `channel`, `type`) are plain `text NOT NULL DEFAULT '...'` with no DB-level `CHECK` constraint in either the migration or schema.ts -- validation is application-layer only (`assertValidStatus` etc. in the service files). This matches the established pattern used by every prior phase's status/category columns (e.g. `approval_requests.status`, `template_versions.status`) -- not a Phase-4-specific gap.
- **Cascade behavior / tenant constraints**: `ON DELETE CASCADE` from `organizations` down through `customers`/`audiences`, and from `customers`/`audiences` down through `customerConsents`/`audienceMembers`, correctly means deleting a business cleans up all of its customer/audience/consent/membership data with no orphaned rows possible at the DB level.
- **New finding this round**: the `ALTER TABLE business_conversations ADD CONSTRAINT ... FOREIGN KEY (customer_id) REFERENCES customers(id)` at the end of the migration is safe to apply whenever it eventually runs -- confirmed via a direct grep of `server/modules/messaging/` that **no code anywhere currently writes to `businessConversations.customerId`**, so the column is always `NULL` in any real deployment today, meaning there is no possibility of an existing non-null value failing to match a `customers.id` and blocking the `ALTER TABLE`.

**Conclusion**: no discrepancy found between the migration and the schema. Migration was reviewed, not executed, per instruction.

## H7. Test review

Baseline before this review: 463/463 (Phase 4's original commit `1549c31`). One genuinely identified gap (linkedUserId mass-assignment, Section H5) was closed with **2 new focused tests** in `customers-rbac.test.ts` -- not a broad addition, exactly the one item this review surfaced. New baseline: **465/465, full suite, zero regressions.**

## H8. Unresolved decisions carried forward

1. **`linkedUserId` behavior on a future user-deletion process** (H1) -- recommend `SET NULL`, not implemented, requires an explicit policy decision before any deletion-execution code is ever built.
2. **Whether/when to build `pg_trgm` search indexing** (H2) -- not currently required; revisit if a business's customer list search becomes a measured pain point, not preemptively.
3. **The BLOCKED-status + consent dual-gate contract** (H3) -- now documented as a hard requirement for whoever builds Phase 5's send logic; not enforceable by this phase since no send logic exists yet to enforce it in.

## H9. Recommended next gate

Nothing found in this review blocks Phase 5 architecturally. The two originally-unresolved risks from doc 29 are now **formally documented, not silently resolved** -- GDPR/`linkedUserId` remains an explicit policy decision (H1), and search scalability is confirmed non-blocking for Campaigns' actual read paths (H2). Recommend proceeding to Phase 5 approval, with the BLOCKED-status dual-gate contract (H3/H8-3) treated as a hard requirement in that phase's own security review, not an optional nice-to-have.

---

**PHASE 4 HARDENED — READY FOR PHASE 5 APPROVAL.**
