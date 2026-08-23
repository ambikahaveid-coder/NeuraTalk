# Business Message Template Engine Implementation (Phase 2)

Implementation record. Builds on [23](23_NEURA_BUSINESS_MESSAGING_MASTER_BUILD_PLAN.md), [24](24_CANONICAL_MESSAGING_FOUNDATION.md), [25](25_MESSAGE_SENDER_IDENTITY_ARCHITECTURE.md), [26](26_BUSINESS_PROFILE_BRANDING_IMPLEMENTATION.md).

## 1. Existing schema audit

Confirmed before writing any new table: no `templates`/`template_versions`-equivalent exists anywhere in `shared/schema.ts` (doc 13/19's prior finding, re-verified). `organizations` (business entity), `users`, and `MESSAGE_CATEGORY` (Phase 0's category enum) all already exist and are reused directly — no duplicate business table, no duplicate category enum, no duplicate audit system.

## 2. Template data model

Two tables, matching the approved conceptual split (Template = stable identity, TemplateVersion = the actual versioned content):

**`templates`**: `id`, `businessId` (FK → organizations), `name` (unique per business), `category` (a `MESSAGE_CATEGORY` value), `createdBy`, `createdAt`.

**`template_versions`**: `id`, `templateId` (FK → templates), `language`, `versionNumber`, `status`, `title`, `content`, `variables` (jsonb array of `TemplateVariableDeclaration`), `mediaType`/`mediaUrl` (forward-reference only, no upload flow — see doc 24's precedent for `messagingMessages.templateId`), `metadata`, `createdBy`/`createdAt`, `submittedBy`/`submittedAt`, `decidedBy`/`decidedAt`, `rejectionReason`, `archivedBy`/`archivedAt`.

`TemplateCategory` and `TemplateStatus` are not separate tables — categories reuse the existing `MESSAGE_CATEGORY` const, statuses are the `TEMPLATE_VERSION_STATUS` const (Section 7). `TemplateApprovalState` is not a distinct entity either — it's fully represented by `template_versions.status` plus the `submittedBy`/`decidedBy`/`rejectionReason` columns already on the same row; a separate approval-state table would duplicate what these columns already capture for a single-decision-per-version model (Section 12's Approval Center scoping explains why the generalized queue from doc 23 §5 isn't built here).

## 3. Versioning

One version row per (template, language, versionNumber). Editing behavior (Section 7's `createOrEditDraftVersion`): if the latest version for a given language is still `DRAFT`, edits happen **in place** on that same row (no version-number churn for iterative drafting before submission). If the latest version is anything else (`SUBMITTED`/`APPROVED`/`REJECTED`/`ARCHIVED`), editing creates a **new** row with `versionNumber + 1`, starting at `DRAFT` — the prior version's content is never touched. This is the literal mechanism behind "editing a template must create a new version" while still allowing convenient in-place drafting, and it's the reason `APPROVED` version content is provably immutable (tested directly, Section 14).

## 4. Category model

`category` is a `MESSAGE_CATEGORY` value (`authentication | utility | marketing | conversational | system | ai`) — the exact same enum Phase 0 already defined, not a parallel one. Enforced via `z.enum(Object.values(MESSAGE_CATEGORY))` at the controller and re-validated in the service layer — a client-supplied string like `"marketing_approved"` or `"otp_verified"` is rejected outright (tested), since the enum only accepts the 6 real values.

## 5. Variable model

`TemplateVariableDeclaration { name, type, required }`, `type ∈ {text, number, date}`. Declared per-version (not per-template — different language versions could in principle need different variables, though in practice most templates keep variables consistent across languages). Validated at **both** save time (every `{{token}}` used in `content` must be declared; malformed placeholders rejected; content/variable-count/length caps enforced — `server/modules/templates/render.ts`'s `validateTemplateContent`) and render time (required variables present, types match, no undeclared keys accepted — `renderTemplateContent`). No code execution anywhere: substitution is a single-pass `String.replace` over the literal token pattern, not a template-expression engine, so a malicious variable *value* containing `{{...}}` is never re-interpreted (tested directly, Section 10/14).

## 6. Language model

`template_versions.language` (default `"en"`) makes version history independently scoped per language — `appointment_confirmation` can have its own `en`/`te`/`hi`/`kn` version chains, each with its own draft/submit/approve/reject/archive lifecycle, verified not to cross-contaminate (tested: approving one language's version leaves another language's draft untouched). **No automatic translation** is implemented or attempted — this phase only creates the data shape a future translation-integration phase would populate, per the explicit instruction.

## 7. Approval lifecycle

`DRAFT → SUBMITTED → APPROVED`, `SUBMITTED → REJECTED`, `REJECTED → DRAFT` (resubmission path, same row), `DRAFT|APPROVED|REJECTED → ARCHIVED` (terminal). This **reconciles** doc 23 §5's originally-sketched longer lifecycle (`DRAFT → SUBMITTED → UNDER_REVIEW → APPROVED → PUBLISHED → PAUSED → ARCHIVED`) down to the 5 states this phase's approval explicitly specified — documented here per the explicit instruction to preserve-or-document any deviation:
- **`UNDER_REVIEW` folded into `SUBMITTED`**: a submitted version *is* under review until a reviewer decides; a separate state added no information a `SUBMITTED` status plus `submittedAt` timestamp didn't already carry.
- **`PUBLISHED`/`PAUSED` deferred**: these describe whether an approved template is *actively in use* by a campaign/automation — a concept that doesn't exist until Phase 5 (Campaigns). This phase only needs `APPROVED` as the terminal "usable" state; "is it currently being used by something" is a question the (not-yet-built) consumer of approved templates will answer, not the template engine itself.

No dependency on Meta/WhatsApp/DLT/MSG91 approval anywhere — NEURA's own `templates`/`template_versions` rows are the sole source of truth for whether a template may be used.

## 8. RBAC

**Two permissions, not six.** `TEMPLATES_MANAGE` (create/view/edit-draft/submit/archive — the author side) and `TEMPLATES_APPROVE` (approve/reject — the reviewer side), added to the existing `PERMISSIONS` catalog. Default distribution: `company_admin` gets both (a solo small-business owner realistically needs to both author and approve their own content — restricting this by default would just be friction, not real security), `manager` gets `TEMPLATES_MANAGE` only, `agent` gets neither.

**Separation of duties — the real mechanism, and why it's not just "give approval to a different role"**: the existing RBAC model has no per-resource concept (permissions are role-based, not tied to a specific submission), so "a company_admin holding `TEMPLATES_APPROVE` shouldn't approve *their own* submission" cannot be expressed by the permission catalog alone. This is enforced at the **service layer** instead: `approveVersion` compares `version.submittedBy` against the acting user's own id and throws `SelfApprovalError` (mapped to 403) on a match — regardless of what permissions that user holds. `super_admin` is exempted, matching the existing project-wide convention (super_admin already bypasses every other permission check in this codebase). This gives real separation of duties for businesses that assign a distinct reviewer (a custom role via the existing `customRoles` mechanism, holding only `TEMPLATES_APPROVE`), while not blocking the common small-business case where one person legitimately does both roles for different submissions — they just can't rubber-stamp their own.

## 9. Tenant isolation

Identical mechanism to Phases 0/1: `requireCompanyAccess("businessId")` at the route layer, plus every service function re-scoping its own query by `businessId` (`getOwnedTemplate`) and then by `templateId` (`getOwnedVersion`) — a two-level ownership chain, so a version id that's technically valid but belongs to a different template (even within the same business) is still rejected, not just cross-business access. Tested directly for both the URL-manipulation case (route-level) and the ID-reuse case (service-level, Section 14 item 20).

## 10. Rendering security

Covered in depth in Section 5. Summary of the specific attack shapes closed, each with a corresponding test: template-variable injection (single-pass literal substitution, no expression evaluation, no second-order re-scanning of substituted values), unknown/undeclared variables in render input (rejected, not ignored), type mismatches (number/date validated, not coerced), oversized content/variable counts (capped), malformed placeholders (rejected at save time, before they could ever reach render time), and unsafe control characters in content (rejected). Rendering never touches SQL, HTML/JS execution, server commands, authorization, routing, or sender identity — there is no code path in `render.ts` that reads or writes any of those.

## 11. Audit model

Every lifecycle mutation (`created`, `version_created`, `version_edited`, `submitted`, `approved`, `rejected`, `returned_to_draft`, `archived`) writes to the existing, real, persistent `audit_logs` table via `server/modules/templates/audit.ts`, a thin wrapper over `server/audit.ts`'s `createAuditLog` — **not** `messagingEvents`, kept separate per the explicit instruction (restated identically in doc 26 §9 and this phase's brief). Three new `AUDIT_ACTION` string values were added (`submit`, `archive`, `return_to_draft`) — additive to the existing free-text column, no migration required for that part; `create`/`update`/`approve`/`reject` were already sufficient for the remaining actions and are reused as-is.

## 12. API contracts

| Route | Method | Permission |
|---|---|---|
| `/api/business/:businessId/templates` | POST | `TEMPLATES_MANAGE` |
| `/api/business/:businessId/templates` | GET | `TEMPLATES_MANAGE` or `TEMPLATES_APPROVE` |
| `/api/business/:businessId/templates/:templateId` | GET | `TEMPLATES_MANAGE` or `TEMPLATES_APPROVE` |
| `.../templates/:templateId/draft` | PUT | `TEMPLATES_MANAGE` |
| `.../templates/:templateId/versions` | GET | `TEMPLATES_MANAGE` or `TEMPLATES_APPROVE` |
| `.../versions/:versionId/submit` | POST | `TEMPLATES_MANAGE` |
| `.../versions/:versionId/approve` | POST | `TEMPLATES_APPROVE` |
| `.../versions/:versionId/reject` | POST | `TEMPLATES_APPROVE` |
| `.../versions/:versionId/return-to-draft` | POST | `TEMPLATES_MANAGE` |
| `.../versions/:versionId/archive` | POST | `TEMPLATES_MANAGE` |
| `.../versions/:versionId/preview` | POST | `TEMPLATES_MANAGE` or `TEMPLATES_APPROVE` |

No campaign routes, no send routes, no route that accepts `senderParticipantId` or `generationSource` in any form — confirmed structurally (the zod schemas simply have no such fields, `.strict()` rejects them if a client attempts to smuggle them in) and by direct test.

## 13. Migration

`migrations/0006_business_template_engine.sql` — additive only, 2 new `CREATE TABLE IF NOT EXISTS` statements, zero `ALTER TABLE` against any existing table (organizations, canonical messaging, AI/personal/group chat all untouched). **Not applied to any database** — same constraint as Phases 0/1 (no local database exists separate from the shared production instance); verified via full mock-based test suite instead, exactly as those phases were.

## 14. Tests

94 new tests across `tests/unit/templates.test.ts` (service layer, in-memory fake DB with real filter/insert/update semantics) and `tests/unit/templates-rbac.test.ts` (RBAC/controller). All 23 numbered test areas from the brief are covered, including the two hardest-to-fake ones done as direct, specific assertions rather than "no exception thrown": **published-version immutability** (item 21 — captures the approved version's exact content before and after an edit attempt, asserts byte-for-byte equality) and **safe rendering under injection** (item 17 — feeds a variable value containing a literal `{{malicious_injection}}` string and asserts the output contains it verbatim, unprocessed, proving no second-order substitution occurred).

## 15. Risks

- **`media_type`/`media_url` are schema-only** (Section 2) — no upload flow, no validation, no delivery. Real risk only when a future phase actually wires an upload path to these columns; flagged now so that phase inherits the same "validate real stored metadata, not client-supplied claims" discipline doc 26 §7/§10 already established for logos, rather than reinventing a weaker check.
- **No version diffing/comparison UI or API** — a reviewer sees the full content of a submitted version but not a highlighted diff against the previously-approved version for that language. Not required by this phase's scope; worth having before Phase 2's UI (not built in this pass — see Section 16) ships to real users, since reviewing an undiffed wall of text is a real usability gap for a genuine approval workflow.
- **No admin UI was built in this phase** — the brief's deliverable list and API contract did not request one (unlike Phase 1, which explicitly required replacing a stub screen); this phase is API + service layer only, consistent with the explicit scope ("Implement only the minimum APIs required").

## 16. Future Campaign/OTP/Utility integration boundary

A future Phase 5 (Campaigns) or Phase 6/7 (OTP/Utility) send path will: read an `APPROVED` `template_versions` row for a given `(templateId, language)`, call `renderTemplateContent` (exported, reusable as-is) with caller-supplied variable values, and pass the rendered string into the canonical messaging `createMessage`-equivalent send function (doc 24/25) — setting `messagingMessages.templateId` to the version's owning template id (the forward-reference column already sitting ready on that table since Phase 0) and `category` to whatever that send path's own hardcoded category is (never read from the template's category field blindly, since a template's own category is a content-governance label, not a delivery-time authorization — though in practice they should always agree, per doc 25 §11's structural governance rule that each send path hardcodes its own category). This phase deliberately builds nothing beyond exposing `renderTemplateContent` in an importable, already-tested state for that future consumer.

---

**PHASE 2 TEMPLATE ENGINE IMPLEMENTED — NOT DEPLOYED.**
