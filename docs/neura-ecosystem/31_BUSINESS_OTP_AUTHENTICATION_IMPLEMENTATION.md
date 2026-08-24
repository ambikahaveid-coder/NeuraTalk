# Business OTP / Authentication Messaging Implementation (Phase 6)

Implementation record. Builds on [23](23_NEURA_BUSINESS_MESSAGING_MASTER_BUILD_PLAN.md), [24](24_CANONICAL_MESSAGING_FOUNDATION.md), [25](25_MESSAGE_SENDER_IDENTITY_ARCHITECTURE.md), [27](27_BUSINESS_TEMPLATE_ENGINE_IMPLEMENTATION.md), [28](28_GENERIC_APPROVAL_CENTER_IMPLEMENTATION.md), [29](29_BUSINESS_CUSTOMERS_AUDIENCES_IMPLEMENTATION.md), [30](30_CAMPAIGN_ENGINE_IMPLEMENTATION.md). A business OTP challenge is a security object with its own tenant-scoped, hash-based, attempt-limited lifecycle -- never a plaintext value, never merged into a generic "send message" API. No external SMS/email provider is called anywhere in this phase.

## 1. Existing OTP audit

Full audit performed before any code was written. Key findings: `server/otp-auth.ts` (platform login OTP, email channel only) uses `crypto.randomInt` generation and SHA-256 hashed storage in `otpChallenges` -- a genuinely solid reference implementation, not an insecure pattern to avoid. It is single-tenant (no `businessId`/`customerId`), deletes the prior challenge on every new request, and is hardwired to the platform's own `users` table -- **not reusable as a table**, but its **generation/hashing pattern is directly mirrored** (not imported, since those functions are module-private there). `server/rate-limit.ts` already had a real Redis-backed attempt-lockout mechanism (`otpVerifyLockoutCheck`/`recordOtpVerifyFailure`/`clearOtpVerifyFailures`, keyed by a hashed identifier) -- reused via parameterization, not duplicated (Section 13). `server/msg91-service.ts`'s `sendOTP()` is live, non-stub SMS-delivery code already wired for a different flow (caller-ID verification) -- **not called anywhere in this phase**, per the explicit "do not send real OTPs" instruction; it remains the natural future integration point (Section 25). `MESSAGE_CATEGORY.AUTHENTICATION` and `CUSTOMER_CONSENT_CHANNEL.AUTHENTICATION` already existed (from Phases 0 and 4) and were confirmed, by grep, to be completely unused anywhere in the codebase until this phase.

## 2. Reused infrastructure

| Existing entity | Reuse |
|---|---|
| `server/otp-auth.ts`'s generation/hashing pattern | Mirrored exactly (`crypto.randomInt`, SHA-256) in `otp/generate.ts` -- not imported (module-private), not weakened |
| `server/rate-limit.ts`'s Redis lockout functions | Parameterized with a `namespace` argument (default `""` = unchanged platform behavior) so business-OTP lockouts use a `biz-otp-*` key space, provably separate from the platform's own `otp-*` key space (Section 2 below, tested directly) |
| `server/rate-limit.ts`'s `rateLimit()` factory | Three new instances (`businessOtpChallengeLimiter`, `businessOtpBusinessDailyLimiter`, `businessOtpVerifyLimiter`) -- same factory every other limiter in this codebase uses, not a second implementation |
| `templates`/`templateVersions` (Phase 2) + Approval Center (Phase 3) | Reused unmodified for optional business-branded OTP content -- must be `APPROVED`, category `AUTHENTICATION`, same governance as every other template use |
| `customers`, `CUSTOMER_STATUS` (Phase 4) | Reused directly for eligibility (Section 10) |
| `messaging/service.ts`'s `findOrCreateCustomerConversation` + `CUSTOMER` participant validation (built in Phase 5) | Reused unmodified -- no further changes to the messaging module were needed in this phase |
| `server/modules/billing/message-billing.ts`'s `chargeMessage` (extracted in this phase from Phase 5's `campaigns/billing.ts`, which was already domain-agnostic) | Reused directly via a new `otp/billing.ts` wrapper -- see Section 14 |
| `MESSAGE_CATEGORY.AUTHENTICATION`, `CUSTOMER_CONSENT_CHANNEL.AUTHENTICATION` | First real usage of both, exactly as anticipated when they were added in Phases 0/4 |

**Not reused, deliberately**: `otpChallenges` (the platform login-OTP table itself), `msg91-service.ts`'s `sendOTP` (not called), `CUSTOMER_CONSENT_CHANNEL.AUTHENTICATION` as a blocking gate (Section 11 explains why).

## 3. OTP domain

`business_otp_challenges`: `id, businessId, customerId, destination, channel, purpose, codeHash, status, attempts, maxAttempts, resendCount, templateVersionId?, messageId?, supersedesChallengeId?, metadata, createdBy, createdAt, expiresAt, verifiedAt?, failedAt?, supersededAt?`. **No plaintext code column exists anywhere in the schema** -- `codeHash` is the only representation of the secret, and `toSafeChallenge()` strips even the hash before any row is returned from the service layer (defense in depth: the hash itself is a low-value secret since it can't be reversed to the code, but it is still never exposed).

## 4. Challenge lifecycle

`PENDING -> {VERIFIED, EXPIRED, FAILED, SUPERSEDED}`, all four terminal. Enforced by `otp/lifecycle.ts`'s `LEGAL_TRANSITIONS` map (same pattern as `templates/lifecycle.ts` and `campaigns/lifecycle.ts`) plus an atomic `UPDATE ... WHERE status = 'pending'` for every real transition. `VERIFIED` is a true dead end -- there is no path, anywhere in this codebase, that transitions a `VERIFIED` challenge back to any other state; a second verify attempt against it is rejected as `AlreadyResolvedError`, never silently re-accepted (Section 6, tested directly).

## 5. Generation

`otp/generate.ts`'s `generateOtpCode()` uses `crypto.randomInt` (never `Math.random`, timestamps, user/database ids, or a predictable counter) to produce a fixed 6-digit code; `hashOtpCode()` is SHA-256. Both mirror `server/otp-auth.ts`'s exact primitives. The raw code exists only as a local variable inside `issueChallenge()` for the instant it takes to hash it -- it is never assigned to any object that gets returned, logged, or persisted (verified directly: `toSafeChallenge` strips the hash too, and a dedicated test asserts the returned challenge JSON never matches a 6-digit sequence).

## 6. Verification

Challenge-bound (`challengeId` in the URL, resolved server-side, tenant-scoped), purpose-bound and destination-bound (optional `expectedPurpose`/`expectedDestination` consistency checks in the request body -- same "client may supply it only as a check, never as a trusted override" pattern as Phase 0's P1 sender-identity fix), one-time (atomic `PENDING -> VERIFIED` CAS; a second attempt against a `VERIFIED` row is rejected), expiry-bound (checked live, never assumed). All nine scenarios from the brief are tested directly and pass: correct OTP, wrong OTP (increments attempts, stays `PENDING`), expired OTP (lazily transitions to `EXPIRED` on the actual verify attempt), already-used OTP (replay rejected), wrong challenge (`NotFoundError`), wrong purpose (`ValidationError` via the consistency check), wrong destination (same), cross-business challenge (`NotFoundError`, identical to every other tenant-isolation boundary in this codebase -- never confirms existence to another tenant), replayed request (rejected).

## 7. Expiry

10 minutes (`OTP_EXPIRY_MINUTES`), matching the platform's own existing OTP default -- not a new arbitrary value. **Lazily evaluated, not cron-driven**: `deriveEffectiveStatus()` reports `EXPIRED` accurately on every read (`getChallenge`/`listChallenges`) without mutating the stored row, and the row's own `status` column only flips to `EXPIRED` for real inside `verifyChallenge` when an actual verify attempt is made against an expired challenge. This avoids building a scheduler for a concern that only matters at the moment someone tries to use the code -- consistent with the brief's instruction not to build unnecessary infrastructure.

## 8. Attempt limits

Two independent, layered limits, matching the existing platform's own two-layer design (Section 1): (1) a **per-challenge** DB counter (`attempts`/`maxAttempts`, default 3 -- same default as `server/otp-auth.ts`), incremented via an atomic `sql`-arithmetic `UPDATE` (never read-then-write in JS, closing the same race a naive implementation would have), transitioning the challenge to `FAILED` once exhausted; (2) a **per-destination, cross-challenge** Redis lockout (`isOtpVerifyLockedOut`/`recordOtpVerifyFailure`, 5 failures / 15-minute window -> 30-minute lockout -- identical thresholds to the existing platform mechanism), reused via the `namespace` parameter added to `server/rate-limit.ts` in this phase. **Critical separation, tested directly**: the two lockouts use different Redis key prefixes (`biz-otp-fail:`/`biz-otp-lockout:` vs the platform's own `otp-fail:`/`otp-lockout:`), so a person who is simultaneously a NEURA platform user and a business's customer can never have a failed business-OTP attempt lock them out of their own platform login, or vice versa -- proven in a dedicated test file (`otp-lockout-namespace.test.ts`), not merely asserted in a comment.

## 9. Resend policy

**SUPERSEDE, not multi-valid-OTP** -- the explicit, documented choice per the brief's instruction to pick one and state it. A resend atomically transitions the prior `PENDING` challenge to `SUPERSEDED` (CAS) and issues a brand-new challenge (new code, new hash, new expiry, `resendCount` incremented, `supersedesChallengeId` pointing back) inside the SAME transaction. At no instant can two challenges for the same `(business, customer, purpose)` both be independently verifiable -- proven directly: after a resend, the original challenge's own code no longer verifies (`AlreadyResolvedError`, since it's no longer `PENDING`). Capped at `MAX_RESENDS = 3`; beyond that, the caller must wait for expiry or start a fresh `POST .../challenges`, preventing unlimited resend/SMS-cost-abuse. Each resend re-validates the bound template and customer status fresh (not cached from the original challenge) -- if the template was archived or the customer blocked between the original request and the resend, the resend fails closed with the same errors a fresh creation would produce.

## 10. Customer-state rules

Explicit, not inferred: **ACTIVE** -> allowed. **BLOCKED** -> rejected (`ValidationError`) -- a business that has blocked a customer relationship cannot OTP-challenge them either, consistent with Campaigns' identical rule (doc 30 section 8); this is NOT a legal/consent policy, it is "the business itself said no contact." **ARCHIVED** -> rejected -- the relationship has ended. **Unknown** customerId -> `NotFoundError`, the same generic not-found shape used everywhere else in this codebase to avoid confirming cross-tenant existence. No legal policy was invented -- these are technical consequences of the existing `CUSTOMER_STATUS` model (Phase 4), applied consistently.

## 11. Consent boundary

**Authentication messages are NOT marketing, and this phase does not gate OTP sending on `customerConsents`.** `CUSTOMER_CONSENT_CHANNEL.AUTHENTICATION` exists in the schema (Phase 4) with its own doc comment noting most jurisdictions treat OTP as consent-exempt -- this phase honors that by never calling `isEligibleForChannel` with the `AUTHENTICATION` channel at all. This is a deliberate, documented choice, not an oversight. The corresponding anti-abuse concern ("do not create a bypass where an OTP endpoint can be abused as a marketing channel") is addressed technically, not by content-scanning (which would be overbuilding and unreliable): purpose is a tightly governed 5-value enum (`OTP_PURPOSE`), content is either the fixed system default or an `AUTHENTICATION`-category-locked, `APPROVED`-only template whose declared variables are restricted to `{code, name}` (Section 15) -- there is no way to smuggle a marketing message through this pipeline's content path even though its consent gate is bypassed. This is an honest boundary, not a legal determination: no policy was invented, and the schema comment's own caveat ("most jurisdictions") is preserved as the open question it already was.

## 12. Rate limiting

Layered, all via reused primitives (Section 2), no new limiter implementation:
- **Per-IP/per-user** (`businessOtpChallengeLimiter`, 5/min; `businessOtpVerifyLimiter`, 20/15min) -- via the existing `rateLimit()` factory.
- **Per-business** (`businessOtpBusinessDailyLimiter`, 500/day, keyed by `businessId`) -- a documented, adjustable placeholder, not a full per-business-configurable policy engine (avoiding the "business-level configuration where required" instruction from becoming a speculative build-out).
- **Per-destination, cross-challenge** (Redis lockout, Section 8) -- enforced inside `verifyChallenge` itself (checked before the code comparison even happens), not at the route layer, since the destination isn't known until the challenge row is looked up.
- **Per-challenge** (DB `attempts` counter, Section 8).

Not built: per-IP-origin geolocation/velocity analysis (no existing infrastructure for it, would be a new build, out of scope).

## 13. Billing boundary

`otp/billing.ts` composes on the SAME extracted primitive `campaigns/billing.ts` now uses (`server/modules/billing/message-billing.ts`'s `chargeMessage`) -- **not a duplicated billing architecture**. `PLACEHOLDER_COST_PER_OTP_PAISE = 15` is explicitly, in writing, **not an approved price** -- identical reasoning to Phase 5's placeholder. **Accounting boundary, matching Campaigns' precedent exactly**: a business is charged only at the moment a challenge's Authentication Message + Delivery Intent are actually created, inside the SAME transaction as that creation -- never merely because a `business_otp_challenges` row exists in isolation. Unlike Campaigns (which skips one recipient out of many on insufficient credit and keeps going), a single OTP request either succeeds completely or fails completely on a billing failure (`BillingError`, entire transaction rolled back, no challenge row left behind) -- tested directly, since a partially-created, unbillable OTP challenge would be a confusing, unusable state for a real-time auth flow.

## 14. Authentication category

`messagingMessages.category` is hardcoded to `MESSAGE_CATEGORY.AUTHENTICATION` inside `issueChallenge()` -- there is **no request parameter, no field in `CreateChallengeInput`, no code path anywhere** by which a client can set or influence it, even more locked down than Campaigns (which at least lets a client choose between `MARKETING`/`UTILITY` from a governed list). Tested directly.

## 15. Template rule

Reuses Phase 2's template engine and Phase 3's approval workflow entirely -- no second template engine. If `templateVersionId` is supplied: (1) must belong to the same business, (2) must have `category === AUTHENTICATION` (server-checked against the template's own row, never client-supplied), (3) must be `APPROVED`, (4) declared variables must be a subset of `{code, name}` **and must include a required `code` variable** (`assertOtpTemplateShape`, `otp/render.ts`) -- a business-branded OTP template that forgot to include `{{code}}` is rejected at bind time, not discovered broken at send time. All five failure modes tested directly (wrong category, not approved, wrong business, missing required `code`, unsupported extra variable). If no template is bound, a built-in default (`DEFAULT_OTP_CONTENT`) is used.

**The rendering split is the core security design of this phase**: `renderRedactedForRecord()` is the ONLY rendering path anything gets persisted with -- it doesn't even accept the real code as a parameter, so it is structurally impossible for the stored `messagingMessages.content` to contain the digits. `{{code}}` always renders as the literal marker `"[code sent separately]"`. Tested directly: the persisted content never matches a 6-digit sequence.

## 16. Messaging integration

Reuses the canonical messaging foundation (Phase 0) exactly as Campaigns does (Phase 5): `findOrCreateCustomerConversation` resolves/creates a `businessConversations` row, the sender is resolved server-side as the conversation's `BUSINESS`-type participant (never a human `authenticatedUserId`, never a client-supplied `senderParticipantId` -- there is no verify/create-challenge route that even accepts one), and `generationSource: { type: "otp_challenge", id: challenge.id }` is written into `messagingEvents.payload` exclusively by this server-side code. All tested directly, identical assertions to Campaigns' own tests.

## 17. Delivery abstraction

`OTP (business_otp_challenges) -> Authentication Message (messagingMessages, category=AUTHENTICATION, content REDACTED) -> Delivery Job/Intent (business_otp_deliveries) -> [future Channel Adapter, not built]`. `business_otp_deliveries` is a **new, OTP-specific** table -- deliberately not forced into `messagingDeliveries`' shape, since that table has no `channel`/`destination` concept and OTP delivery isn't a conversational-participant delivery. It reuses `MESSAGE_DELIVERY_STATUS`'s existing vocabulary (`QUEUED`/`FAILED` are the only values ever set in this phase; `SENT`/`DELIVERED`/`READ` are reserved for when a real channel adapter exists) rather than inventing a parallel enum. `providerRef` exists as an unused forward-reference column for that future adapter.

## 18. Security / privacy

OTP values never appear in: logs (confirmed -- no `logger.*` call in `otp/*.ts` ever receives the code or hash), audit payloads (tested directly -- no SHA-256-shaped string appears in any `createAuditLog` call's metadata), API responses (`toSafeChallenge` strips `codeHash` before any return; tested that the controller doesn't add it back), database plaintext fields (none exist -- only `codeHash`), or error messages (every OTP-domain error class carries a fixed, generic message, never interpolating the code or hash). Audit records exactly the six action types the brief asked for (`challenge_created`, `challenge_verified`, `challenge_failed`, `challenge_expired`, `challenge_locked` [via the existing Redis lockout's own `otp_abuse_lockout` critical audit event, unchanged from the platform mechanism], `resend_requested`) via reused `AUDIT_ACTION` values (two new: `VERIFY`, `RESEND`).

## 19. API design

| Route | Method | Auth |
|---|---|---|
| `/api/v1/business/:businessId/otp/challenges` | POST | `OTP_MANAGE` + `businessOtpChallengeLimiter` + `businessOtpBusinessDailyLimiter` |
| `/api/v1/business/:businessId/otp/challenges` | GET | `OTP_MANAGE` or `OTP_VIEW` |
| `/api/v1/business/:businessId/otp/challenges/:challengeId` | GET | same as list -- never returns a code or hash |
| `.../challenges/:challengeId/verify` | POST | `OTP_MANAGE` or `OTP_VIEW` + `businessOtpVerifyLimiter` |
| `.../challenges/:challengeId/resend` | POST | `OTP_MANAGE` + `businessOtpChallengeLimiter` |

No `/send-message` or arbitrary-channel endpoint exists (tested directly, mirroring Campaigns' identical test). **Documented scope limitation**: every route here requires an authenticated business-staff session (`requireAuth` + `requireCompanyAccess`), consistent with every prior phase's auth model -- there is no server-to-server API-key mechanism in this codebase for a business's own backend to call `verify` on behalf of its actual end customer without a staff session. Building that is explicitly out of scope (inventing new auth infrastructure was prohibited); it is the natural next integration point once a business-facing API-key system exists.

## 20. RBAC

Two permissions, not three: `OTP_VIEW`, `OTP_MANAGE`. `OTP_EXECUTE` was evaluated and deliberately not added -- unlike a Campaign (which needs separation between "can draft" and "can pull the trigger on a mass send"), a single OTP challenge is a routine, low-blast-radius, per-customer action with no separate later "go live" step to gate; `OTP_MANAGE`'s "execute" IS the creation. "Authentication execution must not become a permission that allows arbitrary message sending" is satisfied structurally, not just by permission naming: `OTP_MANAGE` can only ever produce a template-locked, category-locked-to-`AUTHENTICATION`, rate-limited OTP send -- there is no code path it unlocks that resembles a generic send.

## 21. Idempotency

**Verification and resend** use a true atomic CAS (`UPDATE ... WHERE status = 'pending'`) exactly like Campaigns' recipient processing, and are **proven under genuine `Promise.allSettled` concurrent execution** -- concurrent verify calls against the same challenge: exactly one succeeds; concurrent resend calls: exactly one supersede wins, never two live challenges. **Challenge creation** duplicate-prevention uses an app-level pre-check (SELECT for an existing `PENDING` row before insert) backed by a DB-level partial unique index (`business_otp_challenges_one_pending_idx` on `(businessId, customerId, purpose) WHERE status='pending'`) as defense-in-depth -- the same precedent Phase 4 established for customer deduplication. **Honestly flagged, not overclaimed**: this specific path is not proven under a genuine concurrent-INSERT race in this test suite, since simulating a real Postgres unique-constraint-violation exception would require a live database this project doesn't have; the two paths that use atomic UPDATE-based CAS (verify, resend) don't have this limitation and ARE proven.

## 22. Audit

Reuses `audit_logs` exclusively via `otp/audit.ts` (same thin-wrapper pattern as every prior phase). Two new `AUDIT_ACTION` values added (`VERIFY`, `RESEND`); `challenge_expired`/`challenge_locked` reuse the existing `FAIL` action with a distinguishing metadata reason rather than adding two more enum values for what are, from an audit-taxonomy perspective, both "this challenge did not succeed" outcomes. No second audit system was created. Wrong-code attempts that don't trigger the final lockout are deliberately NOT individually audit-logged (matching the existing platform's own convention in `rate-limit.ts`, which only logs at the lockout threshold, not every failure) -- avoiding audit-log spam from ordinary typos.

## 23. Migration

`migrations/0010_business_otp_authentication.sql` -- 2 new tables (`business_otp_challenges`, `business_otp_deliveries`), fully additive. Does not touch the platform's own `otp_challenges` table, any canonical-messaging table, or any customer/template/approval/campaign table -- `business_otp_challenges` REFERENCES several of them but adds no column to any. **Not applied to any database** -- same standing no-local-DB constraint as every prior phase; verified via the mock-based test suite (69 new tests) instead of real execution.

## 24. Tests

69 new tests across 4 files: `otp.test.ts` (46, full integration using the REAL customers/templates/messaging/otp services together against one shared fake DB, same pattern as `approvals.test.ts`/`campaigns.test.ts`), `otp-rbac.test.ts` (18), `otp-lockout-namespace.test.ts` (5, dedicated proof of the Redis key-namespace separation described in Section 8). All 24 numbered abuse-case areas from the brief are covered: brute force (attempt-limit test), resend flooding (`MAX_RESENDS` test), destination/customer enumeration (generic `NotFoundError` shape, never confirms existence), cross-business challenge access, replay, expired OTP, wrong OTP, challenge swapping (wrong-challengeId test), purpose swapping, destination swapping, category injection (always hardcoded, tested), template injection (five template-validation tests), sender-identity injection (structurally impossible, tested), `generationSource` injection (same), duplicate challenge creation, concurrent verification (genuine `Promise.allSettled`), concurrent resend (same), blocked/archived customer behavior. Complete-suite result: **596/596**, up from 527, zero regressions to Phases 0-5.

## 25. Future external-provider boundary

The core never imports or references Meta, WhatsApp, MSG91, Twilio, SendGrid, Azure Communication Services, or any other provider. The concrete extension point: `business_otp_deliveries.providerRef` (unused placeholder column) and `status` (currently only `QUEUED`/`FAILED`) are exactly where a future channel adapter would plug in -- it would read `QUEUED` delivery-intent rows, call the actual provider (e.g. `msg91-service.ts`'s already-live `sendOTP()`, identified in Section 1 as the natural reuse target), and update `status`/`providerRef` on success or failure. Nothing built in this phase would need to change for that adapter to be added -- the same non-invasive extension shape Campaigns established in doc 30 section 21.

---

**PHASE 6 OTP/AUTHENTICATION FOUNDATION IMPLEMENTED — NOT DEPLOYED.**
