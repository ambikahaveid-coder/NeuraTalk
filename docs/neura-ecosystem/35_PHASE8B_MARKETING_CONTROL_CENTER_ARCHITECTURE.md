# Phase 8B — Business Marketing Control Center: Read-Only Architecture + UI/Reporting Plan

**Status: READ-ONLY AUDIT + DESIGN ONLY. No code, schema, route, UI, or migration was written or modified to produce this document.**

Builds on [29](29_BUSINESS_CUSTOMERS_AUDIENCES_IMPLEMENTATION.md)–[34](34_PHASE8_MARKETING_HARDENING_IMPLEMENTATION.md). Backend claims below are re-verified against the actual committed code (session-authored, re-read this turn where cited); frontend claims are from a dedicated read-only audit performed this turn (file:line evidence throughout, not assumed from any prior doc).

---

## 1. Read-only repository audit

### Backend (re-verified against actual code)

| # | Item | Classification | Evidence |
|---|---|---|---|
| 1 | Phase 4 Customers | **REAL** | `server/modules/customers/service.ts` — CRUD, dedup, status lifecycle, tenant-scoped |
| 2 | Phase 4 Audiences | **REAL** | `server/modules/audiences/service.ts` — explicit membership junction, `listMembers` |
| 3 | Phase 2 Templates | **REAL** | `server/modules/templates/service.ts` — versioned, immutable-once-approved |
| 4 | Phase 3 Approval Center | **REAL** | `server/modules/approvals/{service,policy}.ts` — generic, `campaign` + `template_version` registered |
| 5 | Phase 5 Campaign Engine | **REAL** | `server/modules/campaigns/service.ts` — full lifecycle, atomic recipient processing |
| 6 | Phase 8 consent API | **REAL** | `POST/GET /api/business/:businessId/customers/:customerId/consent` (commit `0a0754e`) |
| 7 | Phase 8 frequency system | **REAL, backend-only, zero reporting exposure today** | `customer_marketing_frequency`/`business_marketing_throughput` tables + `campaigns/frequency.ts` gate the send path; **no route reads these counters** — a business cannot see its own frequency-cap state anywhere yet |
| 8 | Billing | **REAL, placeholder pricing** | `server/modules/billing/message-billing.ts`, shared by Campaigns/OTP/Utility |
| 9 | Audit logging | **REAL** | `server/audit.ts`, `audit_logs`, per-module thin wrappers |
| 10 | RBAC | **REAL** | `server/role-middleware.ts`, `PERMISSIONS` const |
| 11 | Tenant isolation | **REAL** | `requireCompanyAccess` + server-side `businessId` scoping, exhaustively tested every phase |

### Frontend (audited fresh this turn)

| # | Item | Classification | Evidence |
|---|---|---|---|
| 12 | Existing `CompanyDashboard.tsx` | **REAL, but zero marketing content** | 1810 lines, tabs `overview/agents/reports/api/settings`, every tab wired to real endpoints (billing, credits, audit, API keys, business profile). **No customers/audiences/templates/campaigns tab exists.** |
| 13 | Existing `SuperAdminDashboard.tsx` | **REAL** | 3687 lines + `AdminSections.tsx`, section-nav pattern (Companies, Tenants, Billing, Webhooks, Compliance, Audit, etc.) — the correct extension point for marketing governance |
| 14 | Navigation/layout | **PARTIAL** | No shared Layout/Shell — `AppNavigation.tsx` (desktop top nav, `md:flex`) + `MobileNav.tsx` (bottom tab bar, `md:hidden`, mounted globally in `App.tsx`). `CompanyDashboard.tsx` uses its own bespoke header, not `AppNavigation` |
| 15 | API client pattern | **PARTIAL** | `@tanstack/react-query` + `client/src/lib/queryClient.ts`'s `apiRequest`/`getQueryFn` exist and are well-built, but `CompanyDashboard.tsx` doesn't consistently use `getQueryFn` — it hand-rolls a near-identical fetch+auth-header block per query (7+ times in one file). A new dashboard should use `getQueryFn` directly, not repeat this duplication |
| 16 | Table/filter/pagination components | **MISSING** | shadcn's `ui/table.tsx` and `ui/pagination.tsx` exist on disk but are imported **nowhere** in the app. Every existing list (companies, agents, team members) is a hand-mapped `<div>` grid, not a table component. No sort/filter/paginate abstraction exists anywhere |
| 17 | Chart/reporting components | **PARTIAL** | `recharts` is a real dependency, used bespoke (not via the unused `ui/chart.tsx` wrapper) in exactly one file, `SuperAdminDashboard.tsx` (`AreaChart`, `PieChart`). `CompanyDashboard.tsx` has zero charts. No reusable chart component exists |
| 18 | Responsive/mobile patterns | **PARTIAL** | Standard Tailwind breakpoints (`md:hidden`/`md:flex`) used correctly for the two nav components; no `useMediaQuery` hook; no mobile-specific card pattern exists yet for list-heavy content (would need to be designed fresh for campaign/customer cards) |

**Design system** (not separately numbered above, folded into Phase M below): shadcn/ui on Radix, 44 installed primitives, CSS-variable-driven dark theme (`index.css`), a `ThemeToggle` component that exists but is **not wired into any nav** (orphaned). `Badge` primitive is reusable; status→color mapping is duplicated per-page as local functions, never a shared `StatusBadge`.

**Overall conclusion, stated honestly**: the backend for Phases 4–8 is solid and real. The frontend has a real, consistent design-system foundation (shadcn/Radix, react-query, wouter+`ProtectedRoute`) but **zero prior art for exactly the three things a Marketing Control Center needs most** — a real data table, a reusable status badge, and any chart wrapper actually in use. This phase is not "add a tab to an existing system," it is "build the first serious data-dense business console this app has ever had," using real primitives but no real precedent for the hard parts.

---

## 2. REAL / PARTIAL / MISSING matrix (consolidated)

| Capability | Status |
|---|---|
| Campaign CRUD + lifecycle | REAL |
| Campaign recipient snapshot + eligibility gating | REAL |
| Consent grant/revoke (HTTP) | REAL |
| Frequency/throughput caps (enforcement) | REAL |
| Frequency/throughput caps (visibility/reporting) | MISSING |
| Per-campaign report (`getCampaignReport`) | REAL |
| Cross-campaign / business-wide marketing rollup | MISSING |
| Suppression reason data (`skipReason`) | REAL (data exists), MISSING (no aggregation endpoint) |
| Delivery status beyond `QUEUED` | MISSING (no channel adapter exists anywhere, by design) |
| Billing cost per campaign (`chargedPaise` sum) | REAL (data exists), MISSING (no aggregation endpoint) |
| Audience eligible-recipient estimate (pre-flight) | MISSING (no endpoint computes this before scheduling) |
| Business-facing UI for any Phase 4–8 module | MISSING (confirmed, zero pages) |
| Reusable data table (sort/filter/paginate) | MISSING |
| Reusable status badge | MISSING (pattern exists, not shared) |
| Reusable chart wrapper actually adopted | MISSING (`ui/chart.tsx` exists, unused) |

---

## 3. Business Console information architecture

The brief's proposed IA is evaluated against actual backend capability and **adjusted, not blindly implemented**:

```
BUSINESS CONSOLE  (new route namespace, e.g. /company/marketing/*)
├── Overview                  (Phase C — real data only, see gaps below)
├── Customers                 (Phase 4 API — REAL)
│   └── Consent & Suppression tab per customer (Phase 8 API — REAL)
├── Audiences                 (Phase 4 API — REAL)
├── Templates                 (Phase 2/3 API — REAL)
├── Approvals                 (Phase 3 API — REAL; generic, not marketing-only)
├── Campaigns
│   ├── Drafts / Scheduled / Running / Completed / Failed  (all = CAMPAIGN_STATUS values — REAL, filterable client-side or via ?status=)
│   └── Campaign detail → Pre-flight, Monitor, Report (Phases D/E/I)
├── Consent & Suppression Center      (renamed from the brief's split "Marketing Consent" + "Suppression" — see ADR-2 below)
├── Reports                   (Phase I — scoped to what's REAL, see Phase O)
├── Billing & Credits         (EXTEND the existing `ReportsTab`/billing tab in CompanyDashboard.tsx, do not build a second billing screen)
├── API & Webhooks            (EXTEND the existing `ApiTab` — no marketing-specific API-key scope exists yet, see doc 33 P2-1, carried forward unresolved)
├── Team & Roles               (EXTEND existing agent/team management in CompanyDashboard.tsx's AgentsTab, do not rebuild)
└── Audit                      (REAL data via audit_logs; needs a new business-facing filtered view — today audit is only surfaced inside Overview's "Recent Organization Activity", not a dedicated screen)
```

**Deviations from the brief's proposed structure, justified**:
- "Business Settings" is dropped as a top-level nav item — it already exists as `CompanyDashboard.tsx`'s `SettingsTab`; Marketing doesn't need a duplicate.
- "Suppression" is merged into "Consent & Suppression Center," not a separate top-level item — per the backend audit, suppression today has no distinct concept beyond `BLOCKED` status + revoked consent + frequency-cap state (doc 34), so splitting it into two screens would visually imply a richer backend model than exists (ADR-2).
- Billing/API/Team are **extensions of existing screens**, not new ones — building parallel Marketing-specific versions of screens that already do this job for the business would be exactly the kind of duplication Phase 8's own audit (doc 33, ADR-1) warned against.

---

## 4. Screen inventory

| Screen | New/Extend | Backend readiness |
|---|---|---|
| Marketing Overview dashboard | New | PARTIAL (Section 6 gaps) |
| Customer list + detail (incl. consent tab) | New | REAL |
| Audience list + detail + member management | New | REAL |
| Template list + editor + submit/approve workflow | New | REAL |
| Approval queue (generic, campaign + template) | New | REAL |
| Campaign list (filtered by status) | New | REAL |
| Campaign builder (create → audience → template → preview → pre-flight → schedule/execute) | New | PARTIAL — pre-flight recipient/cost estimation has no backend endpoint yet (Section 6) |
| Campaign detail / monitor | New | REAL (`getCampaignReport`) |
| Campaign report | New | REAL for single-campaign; MISSING for rollup |
| Consent & Suppression Center (per-customer and business-wide) | New | PARTIAL — per-customer REAL; business-wide suppression list view has no aggregation endpoint |
| Reports hub (7 views per Phase I) | New | PARTIAL — see Phase O matrix, Section 9 |
| Billing tab | Extend `CompanyDashboard.tsx`'s existing billing content | REAL, needs marketing-cost line item added |
| API & Webhooks tab | Extend `ApiTab` | PARTIAL — no marketing API-key scope (doc 33 P2-1) |
| Team & Roles tab | Extend `AgentsTab` | REAL |
| Audit view | New (dedicated, filtered) | REAL |
| Super Admin: Marketing Governance section | New (extends `AdminSections.tsx`) | PARTIAL — cross-tenant rollup has no endpoint yet |

---

## 5. API mapping (UI action → API → status → RBAC → tenant check → audit)

| UI action | API | Status | RBAC | Tenant check | Audit |
|---|---|---|---|---|---|
| List customers | `GET /api/business/:id/customers` | REAL | `CUSTOMERS_VIEW`/`MANAGE` | `requireCompanyAccess` | n/a (read) |
| Create/edit customer | `POST/PUT .../customers[/:id]` | REAL | `CUSTOMERS_MANAGE` | yes | `CREATE`/`UPDATE` |
| Grant/revoke consent | `POST .../customers/:id/consent` | REAL (Phase 8) | `CUSTOMERS_MANAGE` | yes | `CONSENT_ACTION` |
| View consent | `GET .../customers/:id/consent` | REAL (Phase 8) | `CUSTOMERS_VIEW`/`MANAGE` | yes | n/a |
| List/create audiences | `GET/POST /api/business/:id/audiences` | REAL | `AUDIENCES_VIEW`/`MANAGE` | yes | `CREATE` |
| Add/remove audience member | `POST/DELETE .../audiences/:id/members[/:customerId]` | REAL | `AUDIENCES_MANAGE` | yes | `MEMBER_ADDED`/`REMOVED` |
| List/create templates | `GET/POST /api/business/:id/templates` | REAL | `TEMPLATES_MANAGE` | yes | `CREATE` |
| Submit/approve/reject template | Approval Center generic routes (`.../approvals`) | REAL | `TEMPLATES_MANAGE`/`APPROVE` (dynamic) | yes | `SUBMIT`/`APPROVE`/`REJECT` |
| Create/edit campaign | `POST/PATCH /api/v1/business/:id/campaigns[/:id]` | REAL | `CAMPAIGNS_MANAGE` | yes | `CREATE`/`UPDATE` |
| Submit/approve campaign | Approval Center generic routes | REAL | `CAMPAIGNS_MANAGE`/`EXECUTE` (dynamic) | yes | `SUBMIT`/`APPROVE`/`REJECT` |
| Schedule/cancel campaign | `.../campaigns/:id/schedule`/`.../cancel` | REAL | `CAMPAIGNS_MANAGE` | yes | `SCHEDULE`/`CANCEL` |
| Execute campaign | `.../campaigns/:id/execute` | REAL | `CAMPAIGNS_EXECUTE` | yes | `START`/`COMPLETE`/`FAIL` |
| **Campaign pre-flight estimate** (audience size, eligible count, projected cost, projected suppression breakdown, BEFORE scheduling) | **none** | **MISSING — BACKEND GAP** | — | — | — |
| Single-campaign report | `GET .../campaigns/:id` (includes `report`) | REAL | view | yes | n/a |
| **Cross-campaign / business marketing rollup report** | **none** | **MISSING — BACKEND GAP** | — | — | — |
| **Frequency/throughput cap current state** (how many of today's/this hour's budget has this customer/business used) | **none** | **MISSING — BACKEND GAP** | — | — | — |
| **Suppression list view** (which customers are currently BLOCKED/opted-out/frequency-capped, business-wide) | **none** | **MISSING — BACKEND GAP** | — | — | — |
| View utility events (unrelated to marketing, but same console family) | `GET /api/v1/business/:id/utility/events[/report]` | REAL | `UTILITY_VIEW` | yes | n/a |

**No UI action maps to a client-facing generic `/send-message`** — confirmed none exists to map, consistent with every prior phase's explicit prohibition.

---

## 6. Reporting capability matrix (Phase O — the critical audit)

| Report | Backend data exists? | Aggregation endpoint exists? | Verdict |
|---|---|---|---|
| Campaign performance (single campaign) | Yes (`campaignRecipients`) | Yes (`getCampaignReport`) | **REAL** |
| Campaign performance (all campaigns, business-wide, time-ranged) | Yes (same table, needs a `businessId`-scoped query without a `campaignId` filter) | **No** | **MISSING** — small, additive query, no new table needed |
| Recipient funnel (audience→snapshot→eligible→suppressed→queued→sent) | Partially — snapshot/eligible/suppressed/sent are derivable from `campaignRecipients.status`+`skipReason`; **queued/accepted/delivered do not exist** (no channel adapter) | Partial | **PARTIAL** — the funnel must visibly stop at "sent," with `accepted/delivered` explicitly labeled "not measured yet," never fabricated |
| Suppression analysis (breakdown by `skipReason`) | Yes (`campaignRecipients.skipReason`, including the new `customer_frequency_cap_exceeded`/`business_throughput_cap_exceeded` values) | Partially (per-campaign only, via existing `skippedByReason`) | **PARTIAL** — needs a business-wide rollup, same gap as above |
| Failure analysis | Yes (same `skipReason` data) | Partial, same gap | **PARTIAL** |
| Billing/cost (per campaign) | Yes (`campaignRecipients.chargedPaise`) | **No dedicated endpoint** — `getCampaignReport` doesn't currently sum/return cost | **PARTIAL** — small addition to the existing report function, no new table |
| Audience performance (which audiences produce the best eligible-rate) | Yes, derivable by joining `audienceMembers`↔campaign history | **No** | **MISSING** |
| Template performance (which templates are used in how many campaigns, with what outcomes) | Yes, derivable | **No** | **MISSING** |

**Never fabricate delivery statistics — restated as a hard UI constraint**: no screen in this plan may show a "delivered" or "delivery rate" number. The funnel's honest ceiling is `SENT` (a canonical `messagingMessages` row was created) — `ACCEPTED`/`DELIVERED` stages must render as a visibly disabled/greyed stage labeled "Not available — no delivery channel connected yet," never a fake 0% or omitted silently (omitting it would let a viewer assume 100%, which is worse than showing the honest gap).

---

## 7. RBAC matrix

Reuses existing permissions exclusively — **no new permission is proposed** in this design pass (any would need its own justification before implementation, per the brief).

| Role | Customers | Audiences | Templates | Approvals | Campaigns | Consent | Reports | Billing |
|---|---|---|---|---|---|---|---|---|
| Owner/Admin (`company_admin`) | full (`CUSTOMERS_MANAGE`) | full | full + approve (`TEMPLATES_APPROVE`) | decide | full incl. execute (`CAMPAIGNS_EXECUTE`) | grant/revoke | view all | view/manage |
| Manager (if a distinct role exists — **UNKNOWN**, see below) | per assigned permissions | per assigned permissions | manage, not necessarily approve | submit only, if lacking decide permission | manage, execute only if granted | per `CUSTOMERS_MANAGE` | view | view only, likely |
| Agent | view-only by default (`CUSTOMERS_VIEW`) unless granted MANAGE | view-only by default | view-only unless granted | none by default | view-only (`CAMPAIGNS_VIEW`) unless granted | view-only, cannot grant/revoke without `CUSTOMERS_MANAGE` | view own scope | none |
| Super Admin | cross-tenant view (governance only, see Section "Super Admin" below) | same | same | cross-tenant visibility | cross-tenant oversight, no execute-on-behalf | **should not** modify tenant consent directly | cross-tenant rollup | cross-tenant |

**UNKNOWN, flagged honestly**: whether a distinct "Manager" role (between `company_admin` and `agent`) exists as a real, separate role value in this codebase's role model, or whether "manager" is simply an `agent` with a specific permission bundle assigned via `customRoles`/`orgMembers.permissions` (both of which exist per earlier phase audits). This was not re-verified this turn — **do not assume a "Manager" role literally exists** without checking `server/role-middleware.ts`'s role enum and `orgMembers`/`customRoles` before implementation.

**RBAC-to-UI mapping principle**: every screen/action in this plan maps to an existing permission check already enforced server-side (Section 5's table) — the UI's job is to hide/disable controls a user lacks permission for, purely as UX politeness; the actual enforcement is unchanged, server-side, and already real. No UI-only control is proposed anywhere in this plan without a backend check behind it.

---

## 8. Tenant-isolation assessment

**Structurally sound, by construction, across every backend module this UI would call** — every service function takes `businessId` as an explicit parameter, every query scopes by it, and cross-tenant lookups uniformly return `NotFoundError`/`null` rather than confirming existence (verified true in every phase's own test suite, re-confirmed by re-reading the actual service code this session). The UI's own job is limited to: (1) always deriving `businessId` from the authenticated session/route context, never from user-editable UI state, and (2) never constructing a request URL from client-supplied IDs without that ID having been returned by a same-business API response first (i.e., never let a user type an arbitrary campaign/customer/template ID into a URL bar and have the UI blindly render whatever comes back — though even if they did, the backend's own `NotFoundError` behavior protects the actual data). **No architectural gap found.**

---

## 9. Security threat model (all UI/API paths, tied to actual code)

| Threat | Backend defense (cited) | UI-layer consideration |
|---|---|---|
| IDOR (guessing another business's customer/campaign/template/audience ID) | `requireCompanyAccess("businessId")` + service-layer `businessId` scoping on every query, uniform `NotFoundError` | UI must never expose or allow editing the numeric `businessId` in any form field — always derived from the authenticated session |
| Tenant escape via URL manipulation | Same as above, tested exhaustively across docs 29-34 | Route params (`:businessId`) must be sourced from the authenticated user's own org context, not a client-editable field |
| RBAC bypass | `requirePermission`/`requireAnyPermission` middleware on every route | UI-side hide/disable is cosmetic only — confirmed the real enforcement is server-side, so a determined user bypassing the UI still hits a real 403, not a real bypass |
| Campaign manipulation (executing/scheduling someone else's campaign) | `campaignId` always re-verified against `businessId` server-side | No UI gap possible if `businessId` is correctly sourced |
| Template substitution (marketing campaign silently switching template mid-flight) | `templateVersionId` is a fixed, immutable-once-bound FK; re-checked live at execution (doc 30 §4); a client cannot supply a different version at execute time — `execute` takes no template parameter at all | None — structurally closed |
| Audience substitution | Same pattern — `audienceId` bound at DRAFT time, snapshot frozen at schedule time, `execute` takes no audience parameter | None |
| Consent manipulation | `setChannelConsent` always resolves `customerId` ownership via `getOwnedCustomer(businessId, customerId)` before writing; actor is always `req.user.id`, never client-supplied (tested, doc 34) | UI must never let a business staff member "grant consent on behalf of" a customer without this being an explicit, logged staff action — this is already true (the API only supports staff-initiated grant/revoke, there is no separate "customer self-service" endpoint) |
| Billing manipulation | Atomic CAS charge, no client-supplied cost value accepted anywhere | A pre-flight cost *estimate* (Section 6's gap) must be clearly labeled as an estimate, never presented as a locked/guaranteed final price, to avoid the UI implying a contract the backend doesn't enforce |
| Report data leakage (another tenant's numbers visible) | Every existing report function (`getCampaignReport`, `listUtilityEvents`) is `businessId`-scoped | Any new rollup endpoint (Section 6's gaps) must inherit this exact scoping — flagged as a requirement for whoever builds it, not yet built to audit |
| Business-ID URL tampering | Covered above (IDOR/tenant escape) | — |
| Cross-business customer/campaign IDs | Covered above | — |

**No P0/P1 was found in what exists.** Every finding in this threat model that matters is, again, an absence (the not-yet-built rollup endpoints), not a flaw — consistent with every prior phase's audit conclusion.

---

## 10. Performance / scalability assessment

Evaluated at 10k / 100k / 1M customers, honestly, without prematurely optimizing:

| Concern | 10k customers | 100k | 1M | Verdict |
|---|---|---|---|---|
| Customer list pagination | Fine — `listCustomers` already supports `limit`/`offset` (doc 29) | Fine | Needs cursor-based pagination instead of offset (offset pagination degrades at this scale) — **not yet a problem, flagged as a future concern, not fixed speculatively now** |
| Customer search (`ilike`) | Fine, `businessId` index bounds the scan | Acceptable | Would benefit from a trigram index (already flagged as a future option in doc 29 §15, unchanged) — **still not needed at today's real usage** |
| Audience membership queries | Fine, indexed on `audienceId`/`customerId` | Fine | Fine — audience size itself is capped at `MAX_RECIPIENTS_PER_CAMPAIGN` (5000) by campaign design, so this table's per-audience row count has a natural ceiling already |
| Campaign recipient snapshot creation | Bounded by the 5000-recipient cap (doc 30 §9) | Same cap applies | Same cap applies | **No risk** — the existing cap already prevents this from ever needing to scale past 5000 rows per campaign, regardless of total customer count |
| Campaign execution batching | Bounded per-tick (200/call, doc 30 §11) | Same | Same | **No risk**, by design |
| Reporting queries (the NEW rollup endpoints from Section 6) | Fine as a full-table scan with a `businessId` filter | Needs `businessId`+`createdAt` composite index if the query is time-ranged (recommend adding this INDEX when the endpoint is built, not now) | Needs the same, plus likely a materialized/cached rollup if run frequently | **Design note for the implementer**, not a current problem since the endpoints don't exist yet |
| Frequency counter table (`customer_marketing_frequency`) | One row per customer per day — trivial | One row per customer per day — still trivial (100k rows/day is nothing for Postgres) | 1M rows/day — still fine, well-indexed by its own unique constraint, and old rows are never queried once their window passes (a future retention/cleanup job is a reasonable idea, not required now) | **No risk identified** |
| Tenant filtering (N+1 risk) | `listAudiences`'s per-audience member-count loop (doc 29, one query per audience) is a real, existing N+1 pattern | Becomes a real cost once a business has dozens of audiences | Same | **Real, pre-existing, minor risk** — worth a single `GROUP BY` rewrite whenever that endpoint is next touched, not urgent, not new to this phase |

**No architectural change is recommended before implementation** — the existing size caps (5000/campaign, 200/batch) already bound the parts of the system that would otherwise be a genuine 1M-customer risk. The only real, evidence-based recommendation is: **when the new rollup/reporting endpoints are built (Section 6), add a `(businessId, createdAt)` index on `campaignRecipients` if time-ranged queries are needed** — a concrete, specific, deferred recommendation, not a vague "watch performance."

---

## 11. Database / index requirements (for future implementation, NOT written this turn)

No schema change is required to build the REAL parts of this UI (Customers/Audiences/Templates/Approvals/Campaign CRUD screens) — they call existing, complete APIs. Schema/index needs are entirely scoped to the MISSING reporting endpoints from Section 6, anticipated (not designed in migration form here):
- A `(businessId, createdAt)` index on `campaignRecipients` if the business-wide rollup report is time-windowed (likely).
- No new table is anticipated for reporting — the rollups are aggregation queries over `campaignRecipients`, `campaigns`, and (for suppression) the same table's `skipReason` column; all already exist.
- No schema change is anticipated for the frequency-visibility gap (Section 6) — `customer_marketing_frequency`/`business_marketing_throughput` already have everything a read-only "current usage" endpoint needs.

---

## 12. Implementation dependency graph

```
R0 Backend reporting gaps (rollup report, cost aggregation, frequency-visibility read endpoint, pre-flight estimate)
        │
        ├──► R1 Business navigation/shell (route namespace, nav entry, page shell)
        │         │
        │         ├──► R2 Customers UI ──► (needs Consent UI, same screen family)
        │         ├──► R3 Audiences UI
        │         ├──► R4 Templates UI ──► R5 Approval UI (shared generic component, reused for both templates AND campaigns)
        │         └──► R6 Campaign builder ──► needs R2/R3/R4 complete (pickers for audience/template) AND R0's pre-flight endpoint
        │                     │
        │                     └──► R7 Consent/Suppression UI (depends on R2's customer detail screen existing first)
        │                     └──► R8 Campaign monitoring (depends on R6 existing, reuses R0's rollup for the list view)
        │                              │
        │                              └──► R9 Reports (depends on R0 fully, and R8 for campaign-level drill-down)
        │
        ├──► R10 Billing integration (extends existing CompanyDashboard billing tab — can happen in parallel with R2-R9, low coupling)
        │
        └──► R11 Super Admin governance (depends on R0's rollup existing in a cross-tenant-safe form)
                     │
                     └──► R12 Final integration testing (depends on everything above)
```

**This differs from the brief's example order in one load-bearing way**: R0 (backend reporting gaps) must come first, or R6/R8/R9/R11 would either be built against fake data or would silently stall — the brief's own Phase O audit requirement is exactly why this reordering is evidence-based, not arbitrary.

## 13. Exact implementation order

1. **R0** — Backend: business-wide campaign rollup, cost aggregation on `getCampaignReport`, frequency/throughput current-usage read endpoint, campaign pre-flight estimate endpoint (audience size → eligible-count projection, without executing).
2. **R1** — Business navigation shell: new route namespace, nav entry point, shared page-shell pattern (there isn't one today — worth establishing here rather than copying `CompanyDashboard.tsx`'s bespoke-header-per-page pattern again).
3. **R2** — Customers UI (list, detail, consent tab).
4. **R3** — Audiences UI.
5. **R4** — Templates UI.
6. **R5** — Approval UI (generic component, used by both templates and campaigns — build once).
7. **R6** — Campaign builder (create → audience → template → preview → pre-flight → schedule/execute).
8. **R7** — Consent/Suppression Center (business-wide view, building on R2's per-customer consent tab).
9. **R8** — Campaign monitoring (list + detail, live status).
10. **R9** — Reports hub (7 views, scoped exactly per Section 6's REAL/PARTIAL/MISSING matrix — no fabricated view).
11. **R10** — Billing integration (extend existing tab; can run in parallel with R2-R9).
12. **R11** — Super Admin marketing governance.
13. **R12** — Final integration/regression testing across the whole console.

---

## 14. UI/UX acceptance criteria

- No screen renders a number the backend cannot produce (Section 6's matrix is the literal checklist).
- No status pill invents a state the data model doesn't have (`DELIVERED` never appears as an achievable state anywhere until a real channel adapter exists).
- Every mutating action (grant consent, create campaign, schedule, execute, approve) shows the ACTUAL backend response, not an optimistic fake success before the request resolves.
- Every list (customers, campaigns, audiences) is genuinely paginated against the backend's real `limit`/`offset` support, not client-side-only pagination of an unbounded fetch.
- Every screen that shows another entity's data (campaign→template, campaign→audience) resolves that data through the SAME `businessId`-scoped API calls a direct navigation to that entity would use — never a second, less-scoped code path.
- Consent/BLOCKED/ARCHIVED/frequency-suppressed are always visually and textually distinct (Phase F's explicit requirement) — never collapsed into one generic "inactive" badge.
- Audience size vs. eligible-recipient count are always shown as two distinct numbers with a visible reason for the gap (Phase E's differentiator) — never just one final number.
- Mobile: campaign/customer/audience lists use a card pattern (to be designed, since none exists today), not a horizontally-scrolled shrunk table.
- Every screen respects the existing dark-theme CSS variables — no hardcoded colors that would break in light mode (note: `ThemeToggle` exists but is currently unwired into any nav — fixing that wiring is a reasonable, low-risk inclusion in R1, not required, flagged as an opportunity).

---

## 15. Test plan

Mapped to already-proven backend patterns (Phases 5-8) plus new frontend-specific test needs:

**Reused, already-proven backend patterns** (no new technique needed, just applied to any new endpoint from R0): tenant isolation (`NotFoundError`, never confirms existence), RBAC gating, mass-assignment guards, atomic-CAS concurrency where relevant.

**New for R0's endpoints specifically**:
- Business A's rollup report never includes Business B's campaign data (tenant isolation, new test once the endpoint exists).
- Manager/agent cannot access an owner-only report (RBAC, new test).
- Blocked customer cannot be marketed (already proven at the campaign-execution layer, doc 30 §8 — a UI test would confirm the pre-flight estimate correctly EXCLUDES them from the eligible count, not just that execution skips them).
- Opted-out customer cannot be marketed (same — proven at execution layer doc 34, UI/pre-flight test would confirm the estimate reflects it).
- Frequency cap cannot be bypassed via the UI (proven at the service layer already under genuine concurrency, doc 34 — a UI-level test would only need to confirm the UI displays the resulting skip reason correctly, not re-prove the atomicity).
- Campaign report cannot expose another tenant's data (tenant isolation, new test for the rollup endpoint).
- Template version cannot change silently (already proven, doc 30 §4 — UI test confirms the campaign detail screen always shows the exact bound version, never "latest").
- Campaign cannot execute with insufficient credits (already proven, doc 30 §9 — UI test confirms the pre-flight estimate surfaces available-credit vs. required-credit before the user attempts to schedule, reducing surprise failures without changing the backend's own authoritative check).

**Frontend-specific, genuinely new**:
- Responsive rendering at desktop/tablet/mobile breakpoints for the new card patterns.
- RBAC-driven UI hide/disable matches the actual permission set for each of the (at minimum) three role fixtures — owner, agent, and whatever "manager" resolves to once verified (Section 7's UNKNOWN).
- Loading/error states use the existing `QueryErrorState` component consistently (a code-review-level test, not a runtime one).

**"Do not claim database-level guarantees without a real database"**: unchanged standing constraint — any new R0 endpoint's concurrency-sensitive behavior (if any) must follow the same simulated-Postgres-constraint testing technique established in doc 32/34, not an app-level-only claim.

---

## 16. P0 / P1 / P2 risk register

| ID | Severity | Finding |
|---|---|---|
| P0 | none | No P0 found — every gap identified is a missing feature, not a security or data-integrity flaw in what exists |
| P1-1 | P1 | No reporting rollup/pre-flight-estimate backend exists — R6 (campaign builder) and R9 (reports) cannot be honestly built without R0 first; building UI against fabricated numbers would violate the brief's own explicit "never fabricate analytics" instruction |
| P1-2 | P1 | No reusable data table exists in the frontend at all — every list-heavy screen in this plan needs one built from scratch; this is real, non-trivial frontend engineering effort, not a quick reuse |
| P1-3 | P1 | Frequency/throughput cap state has zero visibility today — a business cannot see how close it is to its own cap, which is a real UX gap for a control center whose whole point is operational visibility |
| P2-1 | P2 | "Manager" role's real shape is UNKNOWN — must be verified before R2-R9's RBAC-driven UI can be correctly built, or the UI will show/hide the wrong controls for that role |
| P2-2 | P2 | No shared page Layout/Shell exists — building the console's own bespoke shell (R1) is reasonable, but risks diverging further from `CompanyDashboard.tsx`'s pattern rather than unifying it; worth a deliberate decision, not default duplication |
| P2-3 | P2 | `ThemeToggle` component exists but is unwired — cosmetic, low priority, flagged as an opportunity not a blocker |

---

## 17. Architecture Decision Records

**ADR-1 (carried forward from doc 33, reaffirmed)**: Marketing UI is built on the existing Campaign/Customer/Audience/Template/Approval APIs unchanged — no parallel API surface.

**ADR-2**: Consent and Suppression are presented as ONE Control Center screen family, not two, because the backend has no distinct "suppression" concept beyond consent-revoked + BLOCKED + frequency-capped — a two-screen IA would visually promise a richer model than exists.

**ADR-3**: R0 (backend reporting gaps) is sequenced before all UI work that depends on real numbers — direct consequence of the brief's Phase O audit requirement and the "never fabricate analytics" instruction; building R6/R9 first against placeholder data was considered and rejected.

**ADR-4**: No new RBAC permission is proposed in this design pass — every mapped UI action reuses an existing permission (Section 5/7); if implementation later discovers a genuine gap, it must be justified in writing before creation, per the brief's own instruction.

**ADR-5**: Billing, API-keys, and Team management are EXTENDED on the existing `CompanyDashboard.tsx` tabs, not rebuilt as Marketing-specific screens — avoids exactly the duplication ADR-1 warns against, one level down (UI, not just backend).

**ADR-6**: The delivery funnel UI has a hard, enforced ceiling at `SENT` — `ACCEPTED`/`DELIVERED` render as explicitly disabled/labeled stages, never omitted and never fabricated, because omitting them would let a viewer assume 100% delivery, which is a worse failure mode than an honest gap.

---

## 18. Definition of Done (for this turn only)

- [x] Read-only audit performed against actual repository code (backend re-verified, frontend audited fresh this turn), not documentation alone
- [x] REAL/PARTIAL/MISSING/UNKNOWN classification applied throughout, with UNKNOWN used honestly where verification didn't happen (the "Manager" role shape)
- [x] Business Console IA designed, compared against and deliberately deviating from the brief's proposed structure where evidence required it
- [x] Screen inventory produced, backend-readiness tagged per screen
- [x] API mapping produced, BACKEND GAP explicitly marked rather than any control being faked
- [x] Reporting capability matrix produced — the specific, required Phase O deliverable — with an explicit, enforced rule against fabricating delivery statistics
- [x] RBAC matrix produced, zero new permissions proposed, one honest UNKNOWN flagged
- [x] Tenant-isolation assessment produced, tied to actual code, no gap found
- [x] Security threat model produced, tied to actual code, no P0/P1 found in existing code
- [x] Performance/scalability assessment at 10k/100k/1M, no premature optimization proposed, one concrete deferred recommendation given
- [x] Database/index requirements anticipated, not designed as a migration, not written
- [x] Implementation dependency graph produced, reordered from the brief's example with justification (R0 first)
- [x] Exact implementation order produced
- [x] UI/UX acceptance criteria produced
- [x] Test plan produced, mapped to already-proven backend techniques plus genuinely new frontend needs
- [x] P0/P1/P2 risk register produced — zero P0s, 3 P1s, 3 P2s
- [x] 6 ADRs recorded
- [x] No production code, schema, route, or UI was written or modified
- [x] No migration created
- [x] No deployment attempted or claimed
- [x] No commit pushed
- [x] Phase 9 not started; AI Agents, White-label, WhatsApp/Meta integration not started

---

**PHASE 8B READ-ONLY AUDIT + ARCHITECTURE COMPLETE — NO CODE WRITTEN.**
