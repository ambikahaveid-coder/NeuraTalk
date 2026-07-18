# Repository Audit — NeuraTalk

Date: 2026-07-18
Scope: Phase 1 of the repository cleanup (see `docs/repository/REPOSITORY_CLEANUP_REPORT.md` for the full before/after).

## 1. Before state (root directory)

The repo root contained **65 markdown files**, **2 tracked screenshots**, **1 unidentified
tracked file** (`sedCaY2xZ`), and **~20 untracked build/debug log files**, alongside
legitimate top-level product folders. `docs/` already existed with 44 files in a flat
structure plus a `docs/api/` subfolder.

## 2. Markdown files — moved

106 markdown/CSV files (65 from root + 41 from the pre-existing flat `docs/`) were
distributed into topic subfolders under `docs/`:

| Folder | Count | Purpose |
|---|---|---|
| `docs/api/` | 4 | OpenAPI spec, Postman collection, external API integration docs |
| `docs/architecture/` | 10 | System design, integration architecture (LiveKit, Agora, B2B/B2C/C2C) |
| `docs/audit/` | 12 | Readiness/audit reports across the project's history |
| `docs/business/` | 7 | Executive summaries, legal/compliance, CEO sign-off docs |
| `docs/deployment/` | 13 | Setup guides, deployment checklists, env/key configuration |
| `docs/operations/` | 17 | Runbooks, weekly ops summaries, incident reports |
| `docs/release/` | 11 | APK/Play Store release checklists, RC sign-off reports |
| `docs/roadmap/` | 7 | Implementation plans and roadmaps |
| `docs/testing/` | 21 | Test guides, QA/UAT checklists, telecom validation trackers |
| `docs/archive/` | 10 | Superseded/duplicate-topic docs (see §4) |

All moves used `git mv` (or `mv` + `git add` for files that were untracked on disk) to
preserve history where it existed. Zero files were deleted.

## 3. Non-markdown clutter — removed (all confirmed untracked, never committed)

- Root: 20 `*.log`/`*.err.log`/`*.out.log` files (dev/audit/tenant-startup debug output).
- `flutter_app/`: 11 build-log/analyze-output `.txt`/`.log` files, incl. `hs_err_pid31972.log`
  (a JVM crash dump from a Gradle build).
- `coverage/`, `test-results/` — regenerable via `npm run test:coverage` / `npm run test:e2e`.
- `tmp/`, `.tmp/` contents — regenerable scratch output (`.tmp/smoke` used by `qa:smoke`).

`.gitignore` was updated to add `flutter_app/*.txt`, `flutter_app/*_log*.txt`, `/coverage/`,
`/test-results/` so these don't reappear as clutter candidates in future.

## 4. Duplicate/near-duplicate documents (archived, not merged)

Content merging is an editorial judgment call and risks losing information, so these were
moved to `docs/archive/` rather than merged — review and consolidate manually if desired:

- `CONTACT_CALLING_COMPLETION.md`, `CONTACT_CALLING_INTEGRATION.md`, `CONTACT_CALLING_READY.md`,
  `FILE_MANIFEST_CONTACT_CALLING.md`, `QUICK_START_CONTACT_CALLS.md`,
  `IMMEDIATE_WORKAROUND_CONTACTS.md` — six documents covering the same "contact calling"
  feature rollout at different points in time.
- `PRODUCTION_DEPLOYMENT_GUIDE.md` — overlaps with `docs/deployment/PRODUCTION_DEPLOYMENT.md`
  and `docs/deployment/DEPLOYMENT_GUIDE.md`.
- `PRODUCTION_IMPLEMENTATION_SUMMARY.md` — overlaps with
  `docs/roadmap/COMPLETE_IMPLEMENTATION_SUMMARY.md`.
- `DOCUMENTATION_INDEX.md` — a manually maintained doc index that predates this reorg and is
  now stale (this audit + `docs/repository/REPOSITORY_CLEANUP_REPORT.md` supersede it).
- `sedCaY2xZ` → `docs/archive/sedCaY2xZ.replit-config-duplicate.txt` — content is byte-for-byte
  identical to `.replit`; the filename pattern (`sedXXXXXXXX`) is consistent with a leftover
  `mktemp` artifact from a `sed`-based edit that never got cleaned up. Kept (not deleted) since
  its origin couldn't be fully confirmed.

**Not flagged as duplicates** (many similarly-named files are legitimately distinct):
the `WEEKn_*` operational reports (each covers a different week), the `FINAL_*` release-sign-off
cluster in `docs/release/` (each is a distinct milestone report), and the various
`*_CHECKLIST.md` files (each scoped to a different phase — APK release vs. manual testing vs.
production launch).

## 5. Folders investigated, left in place (see `SECURITY_AUDIT.md` for the security angle)

| Folder | Finding | Recommendation |
|---|---|---|
| `mobile/` | A separate React Native app (own `node_modules`, `App.tsx`, Metro/Babel config), 59 tracked files, content last touched 2026-06-06. | Not actively built by any root script/CI. Appears superseded by `flutter_app/` (which has much more recent build activity — APK build logs from 2026-07-13/14, now removed per §3). **Recommend**: confirm with team whether `mobile/` is still a target platform; if not, archive it in a follow-up (not done here — "never delete automatically"). |
| `flutter_app/` | The actively developed mobile app — recent APK/Gradle build logs found and removed as noise (§3), `pubspec.yaml`/gradle configs current. | Active — no action. |
| `script/` (singular) | Contains `build.mjs`/`build.ts`, the production build entrypoint (`package.json` → `"build"`). | Active — do not rename/merge with `scripts/`. |
| `scripts/` (plural) | Ops/db tooling (`env-audit.mjs`, `db-backup.mjs`, `security-audit.js`, etc.), referenced by `"env:audit"` and used directly by developers. | Active — do not rename/merge with `script/`. Confusingly similar name to `script/` but serves a distinct purpose; a future rename (e.g. `scripts/` → `ops/`) would reduce confusion but is out of scope for this cleanup (touches `package.json` + potentially dev muscle memory). |
| `server/legacy/` | `sim-call-routes.ts` is actively imported by `server/routes.ts:44`, gated behind `isLegacyTwilioBridgeEnabled()`. | **Not dead code** — left untouched. |
| `sdks/`, `examples/`, `infra/` | Legitimate top-level product code: client SDK packages (Python/Kotlin/Swift/TypeScript/Flutter) for `sdks/`, integration sample apps for `examples/`, self-hosted media-stack configs (Kamailio/RTPengine/FreeSWITCH/Grafana) for `infra/`. No code/build/CI references any of them by path. | Left in place per your decision — these are products, not clutter. |
| `attached_assets/` | `vite.config.ts:16` defines an `@assets` alias pointing here, but `docs/repository/DEAD_CODE_REPORT.md` §3 found **zero actual `@assets` usages** in `client/src` — the alias is currently unused. | Left untouched out of caution (an intentional-looking alias exists) rather than confirmed necessity — see dead-code report for the follow-up recommendation. |
| `backups/` | 3MB of untracked manual DB/code snapshots (Feb/Apr 2026), already gitignored. | Left as-is; not part of git history, not blocking anything. |

## 6. Orphan/unused-looking files

- Root `neuratalk-release-key.jks` — see `SECURITY_AUDIT.md` §2.
- `docs/DOCUMENTATION_INDEX.md` (now archived) — superseded by this audit.

## 7. Duplicate folders explicitly ruled out

Despite similar names, none of `mobile/` vs `flutter_app/`, `script/` vs `scripts/` are true
duplicates — each pair serves a distinct, currently-referenced purpose (confirmed via
`package.json` scripts, `scripts/env-audit.mjs:8` scan roots, and import graphs). No merge
was performed.
