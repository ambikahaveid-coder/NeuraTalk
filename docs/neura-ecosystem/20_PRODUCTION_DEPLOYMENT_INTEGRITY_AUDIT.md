# Production Deployment Integrity Audit

Read-only audit. No code, schema, or deployment changes made in this pass. All findings below are evidence-based (file:line, commit SHA, or timestamped `doctl`/log output) — anywhere evidence is incomplete, it is marked **NOT VERIFIABLE** rather than inferred.

## 1. Current build pipeline

```
Source (server/, client/, shared/)
   │
   │  npm run build  (script/build.mjs: vite build client → dist/public/,
   │                   esbuild bundle server/index.ts → dist/index.cjs)
   │  ── manual step, run on a developer's machine, NOT run by DigitalOcean ──
   ▼
dist/  (committed to git)
   │
   │  git push
   ▼
GitHub (jagopro452-cloud/Neura-Talk & ambikahaveid-coder/NeuraTalk, branch neuratalk-clean-release)
   │
   │  DigitalOcean App Platform, deploy_on_push: true
   │  build_command: "npm ci --omit=dev"   ← installs dependencies ONLY
   │  run_command:   "node dist/index.cjs" ← runs whatever dist/ currently contains
   ▼
Runtime (neuratalk.in)
```

- **Build command** (`.do/app.yaml`): `npm ci --omit=dev` — installs production `node_modules`. Does **not** invoke `npm run build`, `vite build`, or `esbuild`.
- **Deployment command**: `node dist/index.cjs` — runs the committed artifact directly.
- **Does DigitalOcean run the build?** No. Confirmed both in `.do/app.yaml`'s explicit `build_command` and in the live build logs for every deployment inspected this session (e.g. deployment `ad0b94fc`, `2b206582`): the only build-phase output is `npm ci` dependency installation, buildpack layer caching, and image packaging — no `vite`/`esbuild` invocation appears anywhere in build-phase logs.
- **Is `dist/` committed?** Yes. `git ls-files | grep '^dist/'` returns `dist/index.cjs` and the full `dist/public/assets/*` bundle. `.gitignore` explicitly does **not** ignore it — the line `# dist` is commented out, with the adjacent comment: *"dist is pre-built and committed — DO uses it directly (no build step needed)."*
- **Is `dist/` generated during deploy?** No — see above.
- **Can source and dist diverge?** Yes, trivially: any commit that changes `server/`, `client/`, or `shared/` without a matching `npm run build && git add dist/` in the *same or a later* commit leaves the deployed artifact behind the source. There is no mechanism that enforces or even checks this.
- **Do package scripts guarantee a rebuild?** No. `"start": "node dist/index.cjs"` runs the existing artifact; nothing in `package.json` (no `prestart`, no `postinstall`) triggers `npm run build`.
- **Does CI validate generated artifacts?** No CI exists at all — `.github/workflows/` does not exist in this repository. There is no automated check anywhere that a given commit's `dist/` actually corresponds to that commit's source.

## 2. Source vs dist integrity

Confirmed structurally capable of divergence, and confirmed to have actually diverged (Section 3). Relevant locations:
- Server source: `server/**/*.ts`, `shared/schema.ts`
- Client source: `client/src/**/*.tsx`
- Build output: `dist/index.cjs` (server bundle), `dist/public/**` (client bundle)
- Build script: `script/build.mjs`
- Deployment config: `.do/app.yaml` (`build_command`, `run_command`)
- Package scripts: `package.json` (`build`, `start`)

## 3. Historical deployment audit

Every deployment DigitalOcean has run for this app in the last ~30 hours, cross-referenced against whether the corresponding commit touched `server/`, `client/`, or `shared/` (the only paths that affect `dist/`), and against exactly when `dist/index.cjs` was last actually rebuilt.

**`dist/index.cjs` rebuild history in this window** (`git log -- dist/index.cjs`): last rebuilt at commit **`06d4ce9`** (2026-08-22 21:58:25 IST / 16:28:25 UTC) — then **not rebuilt again until `eb69b44`** (2026-08-23 20:10:49 IST / 14:40:49 UTC), a **~22-hour gap**.

| Commit | Deployment ID | Deploy created (UTC) | Touches server/client/shared? | Dist rebuilt with this commit? | Classification |
|---|---|---|---|---|---|
| `06d4ce9` | `488c6ae7` (auto, **CANCELED**) then `2b48084e` (manual, went ACTIVE) | 16:28:36 / 16:28:48 | Yes | Yes (this commit *is* the rebuild) | **LIKELY LIVE** — the manual deploy's commit correlation isn't logged by name, so exact attribution is inferred from timing (dist committed 23s before the manual deploy started); not 100% provable from `doctl` output alone → **NOT VERIFIABLE** for certainty, but timing is consistent with LIKELY LIVE |
| `4d427f4` (mobile version bump) | `ec01f514` | 16:36:23 | No | n/a (no server change to miss) | **VERIFIED LIVE** (harmless regardless — nothing new for dist to contain) |
| `1ced094` (call state-transition fix) | `d840f4fd` | 06:04:12 (Aug 23) | No (flutter-only despite the description) | n/a | **VERIFIED LIVE** (harmless) |
| `6ab722d` (fix: media permissions, wrong-screen-pop, disconnect reasons) | `6f99c28a` | 07:14:44 | **Yes** — `server/modules/calls/controller.ts` | **No** | **STALE ARTIFACT — CONFIRMED NOT LIVE** at time of this deploy |
| `0921776` (null-safe DisconnectReason) | `2ddefdc3` | 07:23:33 | No | n/a | **VERIFIED LIVE** (harmless) |
| `0b875c0` (fix: real picker errors, prune dead push tokens) | `4566eabe` | 08:09:45 | **Yes** — `server/firebase-admin.ts` | **No** | **STALE ARTIFACT — CONFIRMED NOT LIVE** at time of this deploy |
| `5f34c4c` (docs: Phase 0 architecture) | `deb680b8` | 08:54:13 | No | n/a | n/a (docs only) |
| `3af36de` (**TranslatorBot startup timeout + diagnostic logging**) | `abb293e6` | 09:44:28 | **Yes** — `server/modules/calls/smart-router.ts`, `server/translator-bot.ts` | **No** | **STALE ARTIFACT — CONFIRMED NOT LIVE** at time of this deploy. The diagnostic instrumentation from this commit was never actually running when any TranslatorBot test occurred after this point, up until `eb69b44`. |
| `4148130` (**call-lifecycle stuck-screen fix**) | `88fe6df8` | 10:20:56 | No — this fix is entirely Flutter-side (`flutter_app/lib/screens/*.dart`), no server change | n/a | n/a for server dist (the fix ships in the APK, not the server) — **not affected by this bug at all** |
| `dc3d762` (**call-performance fix**: remove FCM from critical path) | `1da72819` | 11:52:39 | **Yes** — `server/modules/calls/controller.ts`, `server/modules/calls/smart-router.ts` | **No** | **STALE ARTIFACT — CONFIRMED NOT LIVE** at time of this deploy. The FCM-removal and stage-timing instrumentation reported as "deployed" in that session was not actually running. |
| `1b1cb72`, `ab5d5f7` (docs) | `43a3a713`, `57771657` | 12:18:46 / 12:39:48 | No | n/a | n/a (docs only) |
| `59b57cb` (**P0 security fix: auth + user-scoping on /api/conversations**) | `57771657` (same deploy as `ab5d5f7`, since both were pushed close together and only the latest commit's deploy matters) | 12:39:48 | **Yes** — `server/ai_integrations/chat/routes.ts`, `chat/storage.ts`, `audio/routes.ts`, `server/fastify-server.ts` | **No** | **STALE ARTIFACT — CONFIRMED NOT LIVE.** This is the most serious instance: an unauthenticated cross-user data-exposure fix was committed, pushed, showed "ACTIVE" with clean route-registration logs, and was reported to the user as deployed — but the actual running process was still the pre-fix, vulnerable code, for approximately **26 hours** (12:39 UTC Aug 23 until `eb69b44` at 14:40 UTC Aug 23 — wait, corrected: until this was caught and fixed later the same day at 14:40 UTC, so closer to **2 hours**, not 26 — see note below). |
| `0ec0b35`, `d5a3b5f` (docs) | `b182f5cc`, `8cac6418` | 13:10:18 / 13:45:27 | No | n/a | n/a (docs only) |
| `bfe8071` (gradle.properties memory fix) | included in `ad0b94fc`'s push batch | — | No (flutter_app only) | n/a | n/a for server |
| `430c34b` (**P1 org-lifecycle, credential rotation, rate-limit CRUD**) | `ad0b94fc` | 14:31:59 | **Yes** — `server/b2b-routes.ts`, `server/billing-engine.ts`, `server/call-privacy.ts`, `server/enterprise-api-routes.ts`, `server/modules/webhooks/*`, `server/modules/rate-limits/*`, `client/src/pages/SuperAdminDashboard.tsx` | **No** | **STALE ARTIFACT — CONFIRMED NOT LIVE.** Directly proven this session: `POST /api/admin/companies/:id/suspend` and `GET /api/admin/rate-limit-rules` both returned `404 {"error":"Not found"}` against the live ACTIVE deployment, when the correct behavior (route present, auth-gated) would be `401`. |
| `eb69b44` (**dist rebuild fix**) | `2b206582` | 14:41:04 | Yes — rebuilds dist from current HEAD | **Yes, this commit is the rebuild** | **VERIFIED LIVE.** Directly proven: the same two probes above now return `401 {"success":false,"message":"Please log in to continue"}` (auth gate reached, route exists), and `GET /api/conversations` unauthenticated now also returns `401` for the first time — confirming the `59b57cb` security fix is finally live too. |

**Correction on the `59b57cb` exposure window**: `59b57cb` was committed at 2026-08-23 18:39:57 IST (13:09:57 UTC), one commit before the `ab5d5f7`+`59b57cb` deploy batch that started at 12:39:48 UTC — timestamp ordering indicates the deploy that carried `59b57cb`'s cause label actually started **before** `59b57cb` was committed, meaning DigitalOcean's `deploy_on_push` triggered on `ab5d5f7` (13:09 IST / earlier push) and `59b57cb` landed in a **later** deploy not distinctly listed as its own row (github push batching). Given the complexity of exact attribution here without GitHub webhook-delivery logs, the precise *first* moment `59b57cb` was nominally "ACTIVE" (vs. genuinely running) is **NOT VERIFIABLE** to the minute from `doctl` deployment history alone. What **is** directly verified: `59b57cb`'s protection was **not actually enforced** at any point before `eb69b44` went live at 14:41 UTC on 2026-08-23, regardless of which specific "ACTIVE" deployment nominally included it.

## 4. Critical deployments — summary against the requested checklist

| Area | Commit | Runtime artifact contained the change? |
|---|---|---|
| Authentication / `/api/conversations` security fix | `59b57cb` | **No, until `eb69b44`** |
| Call lifecycle (stuck-screen fix) | `4148130` | N/A — Flutter-only, not subject to this bug |
| TranslatorBot diagnostic instrumentation | `3af36de` | **No, until `eb69b44`** — meaning any TranslatorBot test conducted between 09:44 UTC and 14:41 UTC on 2026-08-23 that was expected to produce `[translator-diag]` log lines would **not** have produced them |
| Call performance fix (FCM removal, stage timing) | `dc3d762` | **No, until `eb69b44`** — any latency measurement taken in that window reflects the pre-fix code path |
| B2B organization lifecycle (this session's P1 work) | `430c34b` | **No, until `eb69b44`** — directly proven via live 404 probes before the fix |
| Billing | (bundled in `430c34b`, one-line `billing-engine.ts` change) | Same as above |
| Webhook rotation | (bundled in `430c34b`) | Same as above |
| Rate-limit CRUD | (bundled in `430c34b`) | Same as above |

## 5. Detection method — recommendation only, NOT implemented

The safest mechanism is a runtime build-identity endpoint, e.g.:

```
GET /api/health/build
{
  "commitSha": "eb69b44...",
  "buildTimestamp": "2026-08-23T14:40:49Z",
  "builtBy": "esbuild <version>"
}
```

Populated at build time (esbuild `define`, injecting `process.env.GIT_COMMIT_SHA` and a build timestamp captured by `script/build.mjs` via `git rev-parse HEAD`), not at runtime — a runtime-computed value would be worthless, since the whole failure mode is "the process wasn't rebuilt." No secrets involved — a commit SHA and timestamp are already public in the GitHub repository. Cross-referencing this endpoint against `doctl apps list-deployments`' `cause` field (which already contains the commit SHA DigitalOcean *thinks* it deployed) would make this exact bug immediately, mechanically detectable — a mismatch is proof, not inference. **Recommended for future implementation; not built in this audit.**

## 6. Production certification rule (new standing rule, effective immediately)

A deployment is **PRODUCTION VERIFIED** only when **all five** hold:

1. The expected commit SHA is known (from `git log` / the intended push).
2. The running production artifact is confirmed to correspond to that commit — today, this requires manually diffing `dist/index.cjs`'s content against what a fresh local build of that commit produces (e.g. `grep` for a distinctive new string/route), since no build-identity endpoint exists yet (Section 5).
3. `doctl apps get-deployment` reports the deployment phase as `ACTIVE`.
4. A basic runtime endpoint (e.g. `/api/health`) responds.
5. **At least one behavior-specific probe proves the new code is executing** — e.g., hitting a genuinely new route and confirming it does NOT 404, or confirming a previously-open endpoint now correctly 401s. Route-registration log lines (`[Routes] ✓ ...`) are **insufficient on their own** — they prove a route *module* loaded, not that a specific recent edit inside that module is present, which is exactly what made this bug invisible for ~22 hours.

**"Deployment ACTIVE" alone is, going forward, explicitly insufficient to claim a fix is live.** Every future "fix deployed" claim in this project must include a step-5-style probe result, not just a phase check.

## 7. CI/CD recommendation

**Model A — DigitalOcean builds `dist` during deployment** (remove `dist/` from git, let `build_command` run `npm run build`):
- Reliability: high — impossible for source/dist to diverge, by construction.
- Rollback: DigitalOcean redeploys from a prior commit and rebuilds fresh; no separate artifact to manage.
- Reproducibility: build happens in DO's environment every time — consistent, but couples deploy time to build time (client Vite build + server esbuild bundle, currently ~1-2 minutes locally).
- Security: no material change — build inputs are the same source either way.
- Developer workflow: simpler — no `git add dist/` step to forget, which is the direct root cause of this incident.
- Deployment speed: slower per-deploy (build now happens on every push instead of being pre-baked), but this is the honest cost already being paid — it was just being paid invisibly (by whoever manually ran `npm run build` before committing) or, as this incident shows, not being paid at all.
- Risk: the only new risk is a build failure blocking deployment entirely (currently a build failure locally just means the developer doesn't commit `dist/` — with Model A it would show up as a failed DO deployment, which is arguably a **feature**, not a risk, since it surfaces the problem instead of silently serving stale code).

**Model B — build in CI, validate, deploy an immutable artifact**:
- Reliability: highest in principle (artifact is tested before deploy), but requires standing up CI infrastructure that doesn't exist in this repo at all today (`.github/workflows/` is empty).
- Rollback: cleanest — immutable, addressable artifacts (e.g. by commit SHA or build ID) can be redeployed exactly.
- Reproducibility: best — build happens in a controlled CI environment, decoupled from any developer's local machine (relevant given this session's separate finding that local builds are memory-constrained on the current dev machine).
- Security: marginally better — CI can run `npm audit`/dependency checks pre-deploy, and secrets never need to be present on a developer's machine for a production build.
- Developer workflow: more setup cost upfront (GitHub Actions workflow authoring), but removes the manual "did I remember to rebuild and commit dist" step entirely, same as Model A.
- Deployment speed: slower end-to-end (CI build + artifact push + DO pull), but each stage is independently cacheable/parallelizable if it matters later.
- Risk: introduces a new dependency (CI system) that itself needs to stay healthy; more moving parts than Model A.

**Recommendation: Model A.** For this project's current size and team (a solo non-technical founder plus an AI engineering collaborator, no dedicated CI/infra ownership), Model A directly eliminates the root cause — the committed-stale-artifact pattern — with the least new infrastructure to build and maintain. Model B's extra rigor (immutable artifacts, pre-deploy validation) is real but not yet worth its setup and ongoing-maintenance cost here; it becomes worth revisiting if the team grows or if build failures in Model A start causing enough deployment friction to justify decoupling build from deploy. **Not implemented in this audit, per the explicit read-only scope — this is a recommendation for a future, explicitly-approved change.**

## 8. Security implications

- The `59b57cb` exposure (unauthenticated cross-user AI-chat data access) was live in production for longer than necessary because the fix, once written, sat un-deployed for an unknown-but-nonzero window while believed to be deployed — the exact worst-case duration is **NOT VERIFIABLE** to the minute (Section 3), but the fix was NOT enforced at any point before 2026-08-23T14:41 UTC.
- More broadly: **any prior session's "security fix deployed" claim in this project's history that was verified only by checking deployment phase and route-registration logs (not a behavior-specific probe) should be treated as unconfirmed** until re-verified against the now-current, correctly-built `dist/`. This audit did not attempt to re-verify every historical claim beyond the window in Section 3 — that would require re-deriving which past commits touched server code and cross-referencing against `dist/index.cjs`'s full git history, which is a larger undertaking than this read-only pass covered.

## 9. Rollback protocol (for the fix already applied this session, for reference)

The stale-dist fix itself (`eb69b44`) is a rebuild, not a schema or logic change — rollback would simply mean reverting to the previous (stale) `dist/index.cjs`, which is never desirable. If a *future* `dist/` rebuild introduces a regression, standard rollback applies: `git revert` the rebuild commit (restoring the previous `dist/index.cjs` blob) and push, or redeploy a prior DigitalOcean deployment ID directly via `doctl apps create-deployment --deployment-id <prior-id>` if DO supports redeploying a specific historical build image without a new git push (**NOT VERIFIED** whether this project's DO app retains old container images long enough for this — would need to be checked before relying on it).

## 10. P0 / P1 / P2 risks

**P0 — Process risk, not a code vulnerability, but caused a real one to go unfixed silently:**
- The committed-`dist`-without-rebuild pattern is the single point of failure behind this entire incident. Any future commit to `server/`, `client/`, or `shared/` that isn't followed by a local `npm run build && git add dist/` before pushing will silently fail to deploy, while every existing verification method (deployment phase, route-registration logs) reports success. **Recommended fix: Model A (Section 7)** — removes the possibility structurally rather than relying on developer discipline.

**P1:**
- No build-identity endpoint exists (Section 5) — makes this class of bug expensive to detect (required manual route-probing this session) rather than a one-line comparison.
- No CI exists at all — nothing validates that a pushed commit's intended behavior actually matches what gets deployed, for either the dist-staleness failure mode or any other class of deploy-time defect.
- The "Production Verified" rule (Section 6) is now defined but not yet enforced by tooling — it currently depends on whoever is doing the deploy remembering to run a Step-5 probe, the same discipline-dependent pattern that caused this incident in the first place.

**P2:**
- Historical claims from before this session's window (Section 8) have not been re-audited and should be treated as unconfirmed if they matter operationally (e.g. if any past "verified" security or billing fix is being relied upon today, it's worth a targeted re-probe rather than assumed-correct).
- No documented rollback procedure existed before this audit (Section 9); the one given here is a first pass, not battle-tested.

---

**Audit complete. No code, schema, or deployment changes made. Stopping and waiting for approval before any implementation (Model A/B decision, build-identity endpoint, or CI setup).**
