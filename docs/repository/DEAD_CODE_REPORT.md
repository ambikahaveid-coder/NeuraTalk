# Dead Code Report (Best-Effort Static Analysis)

Generated: 2026-07-18

## Caveats (read before acting on this report)
- This is a grep/import-graph based pass, **not** full AST/tree-shaking analysis.
  Dynamic imports (`await import(...)`), string-based route registration, and
  reflection-based usage can produce **false positives** — files that look
  unused but aren't. Every item below is a **candidate for human review**, not
  a confirmed-dead file.
- No files were deleted or modified as part of this investigation.
- `server/legacy/sim-call-routes.ts` was excluded — already confirmed actively used
  (see `docs/repository/REPOSITORY_AUDIT.md` §5).

---

## 1. Unused client pages

Checked by grepping `client/src/App.tsx` (the wouter router) for each file under
`client/src/pages/**/*.tsx`, then re-grepping all of `client/src` for the component
name to rule out non-router usage (e.g. imported as a sub-component).

| File | Evidence |
|---|---|
| `client/src/pages/Dashboard.tsx` | No import/lazy-load reference anywhere in `client/src`. Distinct from `ConsumerDashboard.tsx`/`CompanyDashboard.tsx`, which *are* wired up. |
| `client/src/pages/enterprise/PBXIntegration.tsx` | Not referenced in `App.tsx`; repo-wide grep for `PBXIntegration` only matches its own `export default function`. |

Confirmed **not** dead (checked to avoid false positives):
- `client/src/pages/AdminSections.tsx` has no route but is imported as a sub-component by `SuperAdminDashboard.tsx`.
- All `client/src/pages/website/*.tsx` files have a matching route/lazy import in `App.tsx`.
- `VideoCall.tsx` / `JoinCall.tsx` are routed but feature-flagged (`VITE_ENABLE_LEGACY_MEETING_TRANSPORT`) — live, just off by default.

## 2. Unused server route/service files

Checked by extracting every import target across `server/**/*.ts` and cross-referencing
against all top-level `server/*.ts` and `server/modules/**/*.ts` files, including
`await import(...)` dynamic references.

| File | Evidence |
|---|---|
| `server/data-minimization.ts` | Zero references anywhere in the repo besides its own content. Not imported by `routes.ts`, `index.ts`, or any module. Strongest server-side dead-code candidate. |

Lower-confidence note: `server/seed-locations.ts` isn't imported by any module, but its
header comment (`Run with: npx tsx server/seed-locations.ts`) indicates it's an
intentional standalone CLI script, not dead code — just outside the static import graph.

## 3. Unused assets

Checked by grepping `client/src` for the `@assets` alias (`vite.config.ts:16` maps
`@assets` → `attached_assets/`) and for direct filenames.

| Path | Evidence |
|---|---|
| `attached_assets/` (25 files: ~13 `Pasted-*` prompt-dump text files + ~12 `image_*.png` screenshots) | **Correction to this cleanup's earlier audit note**: `vite.config.ts:16` defines the `@assets` alias, but a direct grep of `client/src` for `@assets` returns **zero matches** — the alias is currently unused. `attached_assets/` was left in place during this cleanup out of caution (an alias pointing at it does exist, suggesting intended or historical use), but functionally nothing in `client/src` references it today. Recommend a human decision: either wire it up if features still need it, or remove both the folder and the unused alias in a follow-up change. |

`client/public/**` (icons, manifest, service worker, audio worklets) — **all in use**: icons
referenced from `manifest.json`/`index.html`, worklets loaded by the AudioWorklet API at
runtime by path string (expected pattern, not a static import).

## 4. Unused shared exports (spot-check of 9 exports)

| Export | File | Evidence |
|---|---|---|
| `simulateChargeForDuration` | `shared/billing-math.ts` | Only referenced in `tests/smoke/run.ts` — no production caller in `server/`. Test-only. |
| `calculateBillableSecondsForBudget` | `shared/billing-math.ts` | Used in `server/billing-engine.ts` — live. |
| `calculateChargeIncrement` | `shared/billing-math.ts` | Used in `server/billing-engine.ts` — live. |
| `resolveEffectiveCallMode` | `shared/call-behavior.ts` | Used in `server/modules/calls/smart-router.ts` — live. |
| `resolveTranslationEnabled` | `shared/call-behavior.ts` | Used in `server/modules/calls/smart-router.ts` — live. |
| `resolveRequestedJoinMethod` | `shared/call-routing.ts` | Used in `server/modules/calls/smart-router.ts` — live. |
| `resolveCallerIdentityMode` | `shared/call-routing.ts` | Used in `server/modules/calls/smart-router.ts` — live. |
| `normalizeTenantSlug` | `shared/auth-runtime.ts` | Used in `server/modules/auth/service.ts` — live. |
| all of `shared/sdk-types.ts` | `shared/sdk-types.ts` | Only imported by `server/openapi.ts` (generates the public OpenAPI/SDK schema) — narrow but intentional use, not dead. |

## 5. Duplicate/near-duplicate implementations (flagged only, not judged)

- **Two parallel calling stacks**: `client/src/hooks/use-webrtc.ts`, `use-signaling.ts`,
  and `use-livekit-call.ts` are only consumed by the feature-flagged legacy pages
  (`VideoCall.tsx`, `JoinCall.tsx`), while the primary flow (`C2CCallPage.tsx`) has its
  own calling logic. Worth a human decision on whether the legacy stack should be retired.
- **Multiple overlapping realtime/translation pipelines**: `server/realtime-core.ts`,
  `server/realtime-translation-core.ts`, `server/ultra-pipeline.ts`,
  `server/translator-bot.ts`, `server/token-streaming-translation.ts`, and
  `server/modules/calls/streaming.ts` all import overlapping dependencies
  (`emotion-engine`, `universal-language-runtime`, `providers/stt-provider-registry`,
  `conversation-engine`). All are reachable from live code paths (not dead), but the
  responsibility overlap is worth a design-level review for consolidation.
- **Two DB seed scripts**: `server/seed.ts` (dynamically imported from `server/index.ts`
  on startup) vs. `server/seed-locations.ts` (manual CLI script) — similar pattern, not
  true duplicates.

## Summary of candidate counts

- Unused pages: **2** (`Dashboard.tsx`, `enterprise/PBXIntegration.tsx`)
- Unused server files: **1** confirmed (`data-minimization.ts`), 1 low-confidence note (`seed-locations.ts` — likely intentional)
- Unused assets: **1 directory** (`attached_assets/`, ~25 files) — alias defined but zero call sites
- Unused shared exports: **1 of 9** spot-checked (`simulateChargeForDuration`, test-only)
- Duplicate/overlapping implementations flagged: **3** (legacy calling hooks, multiple realtime pipelines, two seed scripts)

None of the above were deleted or modified — this report is for your review and follow-up decisions.
