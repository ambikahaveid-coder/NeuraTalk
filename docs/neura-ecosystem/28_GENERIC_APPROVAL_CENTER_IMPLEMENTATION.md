# Generic Approval Center Implementation (Phase 3)

Implementation record. Builds on [23](23_NEURA_BUSINESS_MESSAGING_MASTER_BUILD_PLAN.md), [25](25_MESSAGE_SENDER_IDENTITY_ARCHITECTURE.md), [27](27_BUSINESS_TEMPLATE_ENGINE_IMPLEMENTATION.md), [19](19_ADMIN_FORMS_CRUD_GOVERNANCE_MASTER_AUDIT.md). Inspected first: doc 19 confirmed the only prior approval implementation is the one-off company-approval flow (`b2b-routes.ts`'s approve/reject on `organizations`), which stays as-is (not migrated onto this — see doc 19 §5's original scoping note, unchanged).

## 1. Generic approval architecture

**One table, no ApprovalPolicy/ApprovalStep/ApprovalActor tables.** `approvalRequests` is the sole persisted entity. Policy — who can submit, who can decide, whether self-approval is forbidden, how to verify/transition the underlying resource — is a small, typed, **code-level registry** (`server/modules/approvals/policy.ts`), not a database table. Rationale: exactly one domain (templates) registers a policy in this phase; a DB-backed policy table would encode rules for domains (refunds, white-label) that don't exist yet — pure speculation the brief explicitly warned against ("do not blindly create every entity... if current requirements can be satisfied with fewer"). Multi-step approval was evaluated and **not implemented** — Template approval only ever needs a single decision per request; the resourceType registry itself is what makes future domains (and a second table, if one of them genuinely needs multi-step) possible without rewriting this core.

## 2. Resource reference model

`approvalRequests.resourceType` (registry key, e.g. `"template_version"`) + `resourceId` (polymorphic integer, same documented tradeoff as `messagingParticipants.participantId` from Phase 0 — no DB-level FK is possible across arbitrary future resource types) + `businessId`. **`businessId` is never trusted from the client as proof of ownership** — every creation and decision call resolves the resource's *real* owning business via the policy's `resolveOwnership(resourceId)` callback and compares it against the caller's session-verified business context; a mismatch is treated identically to "resource doesn't exist" (deliberately — never confirm to a caller that a resource exists in a business they don't belong to).

## 3. Lifecycle

`PENDING → APPROVED`, `PENDING → REJECTED`, `PENDING → CANCELLED` — all three are the only transitions FROM `PENDING`; all three targets are terminal (no further transitions from any of them). Enforced by a single atomic `UPDATE ... WHERE status = 'pending'` (Section 10) rather than a separate legal-transition map — with only one non-terminal state, "is this transition legal" collapses to "is the current status still pending," which the same UPDATE that performs the transition also checks, for free, atomically.

## 4. Policy

`ApprovalPolicy` interface: `resourceType`, `submitPermission`, `decidePermission`, `selfApprovalForbidden`, `resolveOwnership`, `isSubmittable`, `onSubmit`, `onApproved`, `onRejected`. For Phase 3, exactly one policy is registered (`server/modules/templates/approval-policy.ts`, for `"template_version"`) with `submitPermission: TEMPLATES_MANAGE`, `decidePermission: TEMPLATES_APPROVE`, `selfApprovalForbidden: true`. No refund/white-label policy exists — `getApprovalPolicy("refund")` returns `undefined`, and every entry point checks for that and rejects with `UnknownResourceTypeError` before doing anything else.

## 5. RBAC

**Zero new generic permissions.** `APPROVAL_VIEW`/`APPROVAL_SUBMIT`/`APPROVAL_DECIDE` were evaluated and deliberately not added — submit/decide actions reuse whichever permission the registering domain's policy declares (`TEMPLATES_MANAGE`/`TEMPLATES_APPROVE`, both already existing from Phase 2). Checked **dynamically** in the controller (`hasPermission(req.user, policy.submitPermission)`) rather than via the static `requirePermission()` middleware, since which permission applies depends on `resourceType` — known only after parsing the request body (for submit) or looking up the existing request (for decide), not at route-registration time. List/get/cancel only require business membership (`requireCompanyAccess`) — viewing your own business's queue or cancelling your own pending submission isn't a privileged action beyond belonging to the business. A user does **not** gain template-editing privileges merely by holding `TEMPLATES_APPROVE` — that permission is checked only for the decide action, never consulted by any template-editing route.

## 6. Separation of duties

**P0, enforced entirely in `server/modules/approvals/service.ts`'s `decide()`**, not in the Template domain (which no longer contains any self-approval logic at all — see Section 8). `policy.selfApprovalForbidden && !isSuperAdmin && request.requestedBy === actorUserId` → `SelfApprovalError` (403), checked before the atomic status transition. `super_admin` exempted, matching the existing project-wide convention. Tested directly: submitter-cannot-approve-own, different-user-can-approve, super_admin-bypasses.

## 7. Tenant isolation

Every entry point (`createApprovalRequest`, `getApprovalRequest`, `decide`, `cancelRequest`) either scopes its query by `businessId` directly (reads) or verifies `resolveOwnership(resourceId).businessId === businessId` (writes) — never trusting the client-supplied `:businessId` URL param alone (that param only proves the *caller* belongs to that business, via `requireCompanyAccess`; it says nothing about whether the *resource* does, which is why the ownership resolution is a separate, mandatory check). Tested for URL manipulation, resourceId spoofing at creation time, and resourceId spoofing at decision time (item 20).

## 8. Template integration

`submitVersion`/`approveVersion`/`rejectVersion` (Phase 2, `server/modules/templates/service.ts`) are **unchanged in their own transition logic** but refactored to accept an optional transaction handle (`tx: DbLike = db`), so the Approval Center can compose them inside its own `db.transaction()`. **The self-approval check that used to live inside `approveVersion` in Phase 2 was removed from there entirely** and now exists only in the Approval Center's `decide()` — this is the literal fix for "do not duplicate approval-state logic in two independent systems." The Phase 2 HTTP routes for submit/approve/reject (`.../versions/:versionId/submit|approve|reject`) were **removed** from `server/modules/templates/routes.ts` — there is now exactly one HTTP path to those actions (`POST .../approvals` and `.../approvals/:id/approve|reject`), not two. `return-to-draft`, `archive`, and `preview` remain Template-domain-owned routes (not approval-related).

## 9. Version binding

`resourceId` for `"template_version"` is the exact `template_versions.id` — not the parent `templates.id`. Phase 2 already guarantees a version's content is immutable once it leaves `DRAFT` (editing after `SUBMITTED`/`APPROVED` creates a *new* version row with a new id), so an approval request's `resourceId` can never silently start referring to different content — a resubmission of edited content is structurally a different `resourceId`, requiring its own new approval request. Tested directly (item 18): approving v1, then creating v2, leaves the v1 request's `resourceId` unchanged and v2 in `DRAFT` (not auto-approved).

## 10. Concurrency

The decision UPDATE is `UPDATE approval_requests SET status = $1, ... WHERE id = $2 AND status = 'pending'` — the same atomic compare-and-swap idiom already used in `server/billing-engine.ts`'s `reserveWalletAmount` (cited there as "re-evaluated WHERE clause fails closed"). If two decisions race, only the one whose UPDATE executes while `status` is still `'pending'` actually matches a row; the loser's `UPDATE` matches zero rows, `updated` comes back `undefined`, and `AlreadyDecidedError` is thrown — no double-approval, no approved+rejected contradiction is reachable. **Tested with genuine concurrent execution** (`Promise.allSettled([approveRequest(...), rejectRequest(...)])`, not a manually-staged sequential simulation) — confirmed deterministic across 5 repeated runs, and asserts the template version's final status agrees with whichever decision actually won.

## 11. Audit / history distinction

Every create/approve/reject/cancel writes to the existing, real, persistent `audit_logs` table via `server/audit.ts`'s `createAuditLog` — **not** `messagingEvents`, kept separate per doc 26/27's identical rule, restated once more here since it's this phase's own explicit instruction too. "Approval history" (what decision happened, on which resource, by whom, when) is answered by the `approvalRequests` row itself once decided — immutable by construction (no route or function updates a non-`pending` request's content; the only "second decide" outcome is `AlreadyDecidedError`, never a silent overwrite). No admin API exists that can edit or delete a decided request.

## 12. API contracts

| Route | Method | Auth |
|---|---|---|
| `/api/business/:businessId/approvals` | POST | `requireCompanyAccess` + dynamic `policy.submitPermission` |
| `/api/business/:businessId/approvals` | GET | `requireCompanyAccess` (optional `?status=` filter) |
| `/api/business/:businessId/approvals/:requestId` | GET | `requireCompanyAccess` |
| `.../approvals/:requestId/approve` | POST | `requireCompanyAccess` + dynamic `policy.decidePermission` |
| `.../approvals/:requestId/reject` | POST | `requireCompanyAccess` + dynamic `policy.decidePermission` (body: `reason`) |
| `.../approvals/:requestId/cancel` | POST | `requireCompanyAccess` + must be the original requester (or super_admin) |

No "approve any resource" endpoint exists — `resourceType` must match a registered policy or the request is rejected with 400 before any resource lookup happens.

## 13. UI

**Not built in this phase.** The brief's deliverable/API-contract sections did not request one (unlike Phase 1, which explicitly required replacing a stub screen) — this phase is service + API layer only, matching Phase 2's identical scoping. A future UI would call the routes in Section 12 directly.

## 14. Security review

Reviewed against every category the brief named: IDOR (closed — every read/write scoped by verified `businessId`), cross-tenant approval (tested, item 20), self-approval (tested, Section 6), privilege escalation (dynamic permission resolution has no client-influenceable input), arbitrary resource approval (unregistered `resourceType` rejected before any lookup), resource-type spoofing (registry-gated), resource-ID spoofing (`resolveOwnership` comparison, tested), state-transition bypass (atomic CAS, tested), duplicate approval/rejection (tested), replay of an old request (terminal states never re-transition — same CAS mechanism), approval after resource archived/changed (tested, items 13/19 — structurally prevented since Phase 2's `ARCHIVED` is unreachable from `SUBMITTED`), mass assignment (`.strict()` schemas, tested), audit tampering (no edit/delete route exists on either `approval_requests` post-decision or `audit_logs`). No new P0/P1 found — the design incorporated every one of these constraints from the first draft rather than being retrofitted after a finding, the same pattern Phase 2 established.

## 15. Migration

`migrations/0007_generic_approval_center.sql` — additive only, 1 new table, zero `ALTER TABLE` against `templates`/`template_versions`/anything else. Includes a partial unique index (`one pending request per resource`) as DB-level defense-in-depth alongside the application-level guarantee (Phase 2's own `DRAFT→SUBMITTED` guard already prevents re-submitting a version that's already submitted). **Not applied to any database** — same no-local-DB constraint as every prior phase; verified via the full mock-based test suite (36 new tests) instead, distinguished explicitly here from real database execution, which did not happen.

## 16. Future extensibility

Adding a second domain (e.g. refunds) requires: (1) a new file registering an `ApprovalPolicy` for `resourceType: "refund"` with its own `submitPermission`/`decidePermission`/callbacks (mirroring `templates/approval-policy.ts` exactly), and (2) nothing else — the Approval Center's routes, controller, and service require zero changes, since `resourceType` was never hardcoded anywhere in that layer. This is the concrete proof the "domain-neutral, not Template Approval in disguise" requirement was actually met, not just claimed.

## 17. Risks

- **No admin UI** (Section 13) — real risk only once a business actually needs to use this; flagged as the natural next increment when the client side of Phase 2's template workflow is eventually built (not scoped to this phase).
- **Concurrency test relies on the fake DB's genuine (not simulated) microtask interleaving** (Section 10) — confirmed deterministic across repeated runs in this test environment, but a real-Postgres integration test (not available, per the standing no-local-DB constraint) would be the fully conclusive verification; flagged rather than overclaimed.
- **`resourceId` has no DB-level FK** (Section 2, same tradeoff as Phase 0's `messagingParticipants.participantId`) — mitigated by `resolveOwnership` being mandatory and checked on every write path, but a policy implementation bug (e.g. a future domain's `resolveOwnership` returning a wrong business) would not be caught by the database itself. Worth a code-review checklist item for future policy registrations, not a schema fix.

---

**PHASE 3 GENERIC APPROVAL CENTER IMPLEMENTED — NOT DEPLOYED.**
