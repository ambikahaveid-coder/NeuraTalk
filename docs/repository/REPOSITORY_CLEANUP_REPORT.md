# Repository Cleanup — Final Report

Date: 2026-07-18
Related: `docs/repository/REPOSITORY_AUDIT.md`, `docs/repository/SECURITY_AUDIT.md`,
`docs/repository/DEAD_CODE_REPORT.md`

## Scope discipline

No business logic, API, or UI code was modified. No file was deleted without first being
confirmed untracked-and-regenerable, or (for the one ambiguous case, `neuratalk-release-key.jks`)
was left in place with a documented manual-action recommendation instead of being deleted
automatically. All markdown/doc moves used `git mv` (or `mv` + `git add` where the source was
already untracked) to preserve history wherever history existed. Nothing was committed — all
changes are sitting in the working tree for your review.

## Before → After

| | Before | After |
|---|---|---|
| Root-level `.md` files | 65 | 1 (`README.md`, in the allowed list) |
| Root-level log files (`.log`/`.err.log`/`.out.log`) | 20 | 0 |
| `flutter_app/` stray build logs (`.txt`/`.log`) | 11 | 0 |
| Root-level tracked screenshots | 2 | 0 (moved to `docs/archive/screenshots/`) |
| Unidentified root file (`sedCaY2xZ`) | 1 | 0 (archived with a note) |
| `docs/` structure | flat, 44 files + `docs/api/` | 10 topic subfolders + `docs/api/` + `docs/repository/`, 106 files total |
| Root directory entry count | ~100 | 37 (mix of allowed config files + legitimate product folders) |
| Tracked secrets found | 0 | 0 (verified, not changed — see `SECURITY_AUDIT.md`) |

## What moved

- **106 markdown/CSV files** → `docs/{api,architecture,audit,business,deployment,operations,
  release,roadmap,testing,archive}/` — see `REPOSITORY_AUDIT.md` §2 for the full breakdown
  and rationale per category.
- **2 tracked screenshots** → `docs/archive/screenshots/`.
- **1 tracked mystery file** (`sedCaY2xZ`, content identical to `.replit`) →
  `docs/archive/sedCaY2xZ.replit-config-duplicate.txt`.
- **10 near-duplicate/superseded docs** → `docs/archive/` rather than merged (merging is an
  editorial call — see `REPOSITORY_AUDIT.md` §4 for the list and why each was flagged).

## What was deleted (all confirmed untracked, 0 commits in `git log --all`)

- 20 root debug/dev-server logs, 11 `flutter_app/` build-log/crash-dump files.
- Contents of `coverage/`, `test-results/`, `tmp/`, `.tmp/` (all regenerable — `coverage/`
  and `test-results/` via `npm run test:coverage`/`npm run test:e2e`, `.tmp/smoke` via
  `npm run qa:smoke`).

## What was NOT touched (and why)

| Item | Reason |
|---|---|
| `attached_assets/`, `sdks/`, `examples/`, `infra/`, `mobile/`, `flutter_app/`, `script/`, `scripts/` | Legitimate product code/config, not clutter — moving them was explicitly declined per your answer during planning. Each is documented in `REPOSITORY_AUDIT.md` §5. |
| `server/legacy/sim-call-routes.ts` | Live code, imported by `server/routes.ts:44`. |
| Root `neuratalk-release-key.jks` | Untracked, unreferenced duplicate signing key — flagged for your manual review in `SECURITY_AUDIT.md` §4 rather than auto-deleted (irreversible if wrong). |
| `backups/` | Untracked, already outside git, not blocking anything. |
| 2 unused-looking client pages, 1 unused server file, `attached_assets/`'s unused `@assets` alias, 3 areas of overlapping implementation | Flagged only in `DEAD_CODE_REPORT.md` — no deletions, this needs your product judgment. |

## Validation performed

- `npm run check` (tsc) — **passed, zero errors**, same as baseline.
- `npm run build` — **succeeded** (client + server bundles built without error). The build
  was run purely to verify the doc/file moves didn't break anything; its output (`dist/`,
  which is itself git-tracked and deployed directly by DigitalOcean per `.do/app.yaml`) was
  then **reverted to its pre-verification committed state** via `git checkout -- dist &&
  git clean -f dist`, so this cleanup doesn't accidentally change what would ship on next
  deploy.
- Flutter analyze/test and a full repo lint pass were **not** run — no Flutter toolchain was
  confirmed available in this environment. Recommend running `flutter analyze` in
  `flutter_app/` locally before your next mobile release, as a final check independent of
  this cleanup.
- `git status` after all moves shows renames (`R`) for every file that was previously
  tracked, confirming history was preserved rather than delete+recreate.

## Scores (qualitative, rationale-based — not an automated tool output)

| Dimension | Before | After | Why |
|---|---|---|---|
| **Repository navigability** | Poor | Good | Root went from ~90 loose files to a 1-README + config + product-folder layout; all documentation is now categorized and discoverable under `docs/`. |
| **Maintainability** | Fair | Good | Duplicate-topic docs are now grouped in `docs/archive/` for a deliberate merge decision instead of being scattered at root; dead-code candidates are documented for follow-up instead of silently accumulating. |
| **Security** | Good (already) | Good (unchanged, now documented) | No secrets were ever committed — this cleanup added a paper trail (`SECURITY_AUDIT.md`) confirming that and flagging one physical-file cleanup task (orphaned `.jks`) for you. |
| **Architecture clarity** | Fair | Fair, better documented | No architecture changed (out of scope by design). `REPOSITORY_AUDIT.md` and `DEAD_CODE_REPORT.md` now give an accurate map of what's live vs. legacy vs. ambiguous (e.g. the two parallel calling stacks, multiple realtime pipelines) for a future consolidation decision. |

## Risk assessment

- **Low risk overall**: every move was a file relocation with no import-path changes needed
  (confirmed via the pre-move reference audit — no code imported any moved file by path), and
  `npm run check`/`npm run build` both passed clean afterward.
- **Residual risk**: the categorization of ~106 docs into topic folders was done by
  filename/keyword matching, not by reading full contents — a handful may be one folder off
  from ideal (e.g. a doc that's 60% "testing" and 40% "deployment"). None of this affects the
  app; it's a documentation-findability concern only, fixable with a follow-up `git mv` at any
  time.
- **Nothing was committed.** Review `git status`/`git diff` and commit when you're satisfied.

## Suggested next steps (not performed — your call)

1. Review `docs/archive/` and decide whether to merge/delete the 10 superseded docs.
2. Verify and clean up the orphaned root `neuratalk-release-key.jks` (see `SECURITY_AUDIT.md` §4).
3. Decide the fate of `mobile/` (React Native) vs. the actively-developed `flutter_app/` (Flutter).
4. Review `DEAD_CODE_REPORT.md` candidates (2 pages, 1 server file, the `attached_assets/`
   alias, and 3 areas of overlapping implementation) and decide what to retire.
5. Run `flutter analyze`/`flutter test` locally before your next mobile release.
