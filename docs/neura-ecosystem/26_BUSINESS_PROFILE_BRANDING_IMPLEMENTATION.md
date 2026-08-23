# Business Profile + Branding Implementation (Phase 1)

Implementation record. See [23](23_NEURA_BUSINESS_MESSAGING_MASTER_BUILD_PLAN.md), [19](19_ADMIN_FORMS_CRUD_GOVERNANCE_MASTER_AUDIT.md) for the prior audits this builds on.

## 1. Existing model audit

`organizations` (`shared/schema.ts:41`, pre-existing) is the real business/tenant entity (confirmed by doc 19 — no second Business table exists or was created here). Fields that already existed before this phase: `id`, `name`, `slug`, `logoUrl`, `plan`, `settings` (jsonb), `isActive`, `dataRetentionDays`, `status`, `email`, `phone`, `industry`, `website`, `address`, approval/suspension/reactivation/deactivation audit columns (from this session's earlier org-lifecycle work), `primaryLanguage`, `supportedLanguages`, `createdAt`.

## 2. Field mapping

| Requested field | Reuse / New | Existing field reused |
|---|---|---|
| Display/business name | Reuse | `name` |
| Legal business name | **New** | `legalBusinessName` |
| Company description | **New** | `description` |
| Business category | Reuse | `industry` |
| Website | Reuse | `website` |
| Support email | Reuse | `email` (already documented as "Company contact email") |
| Support phone | Reuse | `phone` |
| Primary contact | Reuse | `email`/`phone` (no separate "contact person name" field added — out of scope, no clear distinct product need beyond the contact channels themselves) |
| Business address (street) | Reuse | `address` |
| City / State / Country / Postal code | **New** | `addressCity`, `addressState`, `addressCountry`, `addressPostalCode` |
| GSTIN / tax identifier | **Not added** | No existing field; per the explicit instruction ("where already supported by the existing model") and "do not invent regulatory fields unnecessarily," this is deliberately deferred — GSTIN carries real compliance/validation weight (state-specific formats) not justified for a profile/branding phase |
| Business registration info | **Not added** | Same reasoning as GSTIN |
| Business logo | Reuse | `logoUrl` |
| Business status | Reuse (read-only here) | `status` — already fully governed by this session's earlier org-lifecycle work; Phase 1 only displays it, never lets Profile/Branding routes change it |
| Primary/secondary/accent brand color | **New, but not a column** | `settings.branding.{primaryColor,secondaryColor,accentColor}` (existing jsonb field, new key) |

**No duplicate fields created.** Every field with a clear existing equivalent was reused as-is (Section 3's "First — audit existing model" requirement).

## 3. API design

Reused the exact `/api/business/:businessId/...` convention already established by the Phase 0 canonical-messaging routes (`server/modules/messaging/routes.ts`), not a new convention:

| Route | Method | Permission |
|---|---|---|
| `/api/business/:businessId/profile` | GET | `ORG_VIEW_SETTINGS` |
| `/api/business/:businessId/profile` | PATCH | `ORG_EDIT_SETTINGS` |
| `/api/business/:businessId/branding` | GET | `ORG_VIEW_SETTINGS` |
| `/api/business/:businessId/branding` | PATCH | `ORG_EDIT_SETTINGS` |
| `/api/business/:businessId/branding/logo` | PUT | `ORG_EDIT_SETTINGS` |
| `/api/business/:businessId/branding/logo` | DELETE | `ORG_EDIT_SETTINGS` |

Logo upload reuses the existing, unmodified `POST /api/uploads/request-url` presigned-URL flow (`server/ai_integrations/object_storage/routes.ts`) for the actual file transfer — the new `PUT .../branding/logo` route only *finalizes* an already-uploaded object (sets ACL, validates real content-type/size, records the URL). No new upload mechanism was built.

## 4. RBAC design

**Zero new permission constants.** `ORG_VIEW_SETTINGS` and `ORG_EDIT_SETTINGS` already existed in the `PERMISSIONS` catalog (`shared/schema.ts:245-246`) and were already correctly distributed: `company_admin` has both, `manager` has view-only, `agent` has neither. This already satisfied the explicit requirement ("manager/agent permissions must NOT automatically gain branding-management access") before this phase touched anything — confirmed by a dedicated test (`business-profile-rbac.test.ts`), not assumed.

## 5. Tenant isolation

Identical mechanism to Phase 0: `requireCompanyAccess("businessId")` (existing middleware, unchanged) confirms `req.user.organizationId === :businessId` before any handler runs, and every service function additionally scopes its own DB query by the `businessId` parameter directly (defense in depth, matching the Phase 0/webhook pattern). No route trusts a client-supplied business identifier without this check.

## 6. Branding architecture

Stored entirely inside the pre-existing `organizations.settings` jsonb column, under a new `branding` key (`BRANDING_SETTINGS_KEY` constant, `shared/schema.ts`). **Zero new columns for branding.** Validated server-side via a `.strict()` Zod schema (`businessBrandingSchema`) that only accepts `primaryColor`/`secondaryColor`/`accentColor` as 6-digit hex strings — any other field in the request body is rejected outright (closes a mass-assignment path into the shared `settings` object, which also holds unrelated org config). Explicitly scoped to *branding*, not white-label: no custom domain, no favicon, no email-sender identity — those remain a later phase per the brief's own three-way distinction (Profile / Branding / White-label).

## 7. Asset storage architecture

Reuses the existing S3-compatible object storage service (`ObjectStorageService`, `server/ai_integrations/object_storage/`) end to end — same presigned-upload flow already used for chat attachments and voice memos, same ACL mechanism (`setObjectAclPolicy`, public visibility, matching the existing chat-attachment pattern). No new storage integration was built. **Security hardening beyond the minimum**: the finalize step (`setLogo`) does not trust the object path's string shape (extension, prefix) as proof of what the file actually is — it re-reads the object's *real* stored `contentType` and `size` via `getMetadata()` and rejects anything that isn't one of the 4 accepted image MIME types or exceeds a 5MB logo-specific cap (well below the general 100MB chat-attachment cap). This was tightened during implementation after the security review (Section 10) found the original path-heuristic approach had a real gap for extensionless object paths — see Section 15 for the corrected/original diff.

## 8. Admin UI

`client/src/pages/CompanyDashboard.tsx`'s `SettingsTab` — previously entirely read-only (name/status/role/access-scope display only) — replaced with three real cards: **Business Profile** (name, legal name, description, category, website, contact email/phone, address + city/state/country/postal, save/cancel), **Branding** (logo upload/replace/remove with client-side type/size pre-checks backed by the real server-side validation in Section 7, three color pickers, save/cancel), **Access** (the original read-only role/scope display, preserved for non-admin viewers). Loading, error (via the existing `QueryErrorState` component), save-success/failure (via the existing toast system), and permission-denied (the whole edit UI is hidden behind `canManageCompany`, matching the existing gate already used elsewhere in this same file) states are all real, not decorative.

## 9. Audit model

Every mutation (profile update, branding update, logo set, logo remove) calls the existing `AuditHelpers.logSettingsChange(actorUserId, settingKey, oldValue, newValue)` — writing to the platform's real, persistent `audit_logs` table, **not** `messagingEvents` (per the explicit instruction to keep these separate, consistent with doc 24/25's own framing of that boundary). `settingKey` is namespaced per resource (`business_profile:<id>`, `business_branding:<id>`, `business_logo:<id>`) so a future audit-log viewer can filter by exactly which kind of change occurred.

## 10. Security review

Reviewed against every category in the brief:
- **IDOR / tenant escape**: closed by `requireCompanyAccess` + per-query `businessId` scoping (Section 5), tested.
- **Unauthorized branding modification**: closed by `ORG_EDIT_SETTINGS` gating (Section 4), tested.
- **Arbitrary file upload / malicious MIME / oversized upload**: **a real gap was found and fixed during implementation** (not after — caught before commit). The first draft validated the uploaded object only by its path string (extension check, with an "extensionless paths pass" fallback for UUID-style object-storage paths). Since the shared upload-request endpoint accepts many content types for general chat attachments (video, zip, office docs) and object-storage paths are often extensionless, this fallback meant a client could request a presigned URL for a large non-image file with an extensionless path and successfully set it as a business logo. Fixed by validating the object's *real* stored `contentType`/`size` via `getMetadata()` instead of the path string — see Section 7/15.
- **Path traversal**: `objectPath` is rejected unless it starts with `/objects/` and contains no `..` segment.
- **Asset access leakage**: logos are intentionally `public` visibility (matching the existing, already-shipped chat-attachment ACL pattern) — a business logo is meant to be publicly visible wherever it's displayed, the same as any brand logo; this is a deliberate design choice, not an oversight, and is stated explicitly here rather than silently assumed.
- **Mass assignment**: profile updates use an explicit allow-list (`WRITABLE_PROFILE_FIELDS`) both in the service layer and independently in the controller's `.strict()` Zod schema — a `status`/`isActive`/`logoUrl` field in a PATCH body is structurally ignored, not filtered by convention; tested by directly attempting to smuggle `status`/`isActive` past the runtime boundary.
- **Privilege escalation**: no code path in this phase lets a caller change their own or another user's role/permissions — profile/branding mutations only ever touch the `organizations` row's Profile/Branding-scoped fields.

No P0/P1 issue remained unresolved at commit time — the one found (file-validation gap) was fixed within this same implementation pass, not deferred.

## 11. Test strategy

Two files, 33 tests total: `tests/unit/business-profile.test.ts` (service-layer, in-memory fake DB with real filter/update semantics — profile read/update, branding read/update including `.strict()`/hex-format rejection, logo set/replace/remove including the real-metadata validation and its two originally-vulnerable-now-fixed scenarios, tenant isolation, persistence-after-reload, mass-assignment guard) and `tests/unit/business-profile-rbac.test.ts` (middleware-level — `ORG_VIEW_SETTINGS`/`ORG_EDIT_SETTINGS` gating per role, `requireCompanyAccess` reuse, controller payload validation, actor-derived-from-`req.user.id`-not-body). All 16 numbered test areas from the brief are covered; none are placeholder "no exception thrown" assertions — each asserts a specific persisted value, status code, or thrown error type.

## 12. Migration strategy

`migrations/0005_business_profile_branding.sql` — additive only, 6 new nullable `ADD COLUMN IF NOT EXISTS` on `organizations`. **Not applied to any database** in this phase (production migration remains prohibited per the explicit scope). Branding required no migration at all (Section 6).

## 13. Rollback

Code: `git revert` the implementation commit(s). Schema: the migration file's own commented rollback block (`DROP COLUMN IF EXISTS` for all 6 columns) — safe, since no pre-existing code path reads or writes them.

## 14. Future integration points

- **Templates/Campaigns (Phase 2+)**: will read `organizations.name`/`logoUrl`/`settings.branding` to render the "from" identity customers see, per doc 25's `business` participant model.
- **White-label (later phase)**: extends this same `settings` jsonb (a `whiteLabel` key, parallel to `branding`) rather than replacing it — Profile/Branding stays the foundation, White-label adds custom domain/favicon/full UI reskinning on top.
- **Reporting**: business display name/logo already available for any future dashboard header without new plumbing.

## 15. Remaining risks

- **GSTIN/tax/registration fields deliberately deferred** (Section 2) — will need real design (format validation, country-specific rules) whenever a future phase actually requires them; not a silent gap, a named one.
- **No image resizing/optimization** on logo upload — a business could upload a technically-valid 5MB image that's poorly suited for UI display (e.g., an oversized but under-cap PNG); acceptable for Phase 1, flagged for a future polish pass if it matters in practice.
- **`getMetadata()`'s `contentType`/`size` are the object storage provider's own recorded values** (set at upload time from the client's declared `Content-Type` header) — not a deep content-sniffing/magic-byte check. A determined attacker who controls the upload's `Content-Type` header could still declare `image/png` for a non-image byte stream. This is a real, lower-severity residual risk (already present in the pre-existing chat-attachment upload path this reuses, not introduced by this phase) — full content-sniffing was not implemented here as it would be a change to the shared upload infrastructure, out of this phase's scope; flagged rather than silently accepted.

---

**PHASE 1 BUSINESS PROFILE + BRANDING IMPLEMENTED — NOT DEPLOYED.**
