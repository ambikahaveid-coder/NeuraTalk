# Production Deployment Runbook

Canonical procedure for deploying and verifying NEURA's server to production. Supersedes any prior deployment instructions in `docs/deployment/` where they conflict — those documented the old committed-`dist/` model; see [20_PRODUCTION_DEPLOYMENT_INTEGRITY_AUDIT.md](20_PRODUCTION_DEPLOYMENT_INTEGRITY_AUDIT.md) for why that model was replaced.

## The model: source is truth, dist is generated

```
Developer commits server/, client/, shared/ source
   → git push to neuratalk-clean-release
   → DigitalOcean (deploy_on_push: true) pulls the exact commit
   → build_command: npm ci --omit=dev && npm run build
       - npm run build = vite build (client) + esbuild bundle (server)
       - embeds commitSha/buildTimestamp/version into the server bundle
   → run_command: node dist/index.cjs
```

`dist/` is `.gitignore`d. **Never run `git add dist/`.** If you find yourself doing that, stop — it means you're trying to work around the build pipeline instead of using it, and it's exactly the mistake that caused the incident this runbook exists to prevent.

## Local developer workflow

| Task | Command |
|---|---|
| Local dev server (hot reload, no build) | `npm run dev` |
| Typecheck | `npm run check` |
| Unit/integration tests | `npm test` |
| Production build (client + server) — for local verification only, DO does this on deploy | `npm run build` |
| Run the built artifact locally | `npm start` (after `npm run build`) |

You never need to build or commit `dist/` to ship a change. Push source; DigitalOcean builds it.

## Deploying a change

1. Make your change in `server/`, `client/`, or `shared/`.
2. `npm run check` — must be clean.
3. `npm test` — must pass (`npx vitest run`).
4. Commit and push to `neuratalk-clean-release`. Do **not** touch `dist/` — it's ignored.
5. `deploy_on_push` triggers automatically. Do not consider the deploy done yet — proceed to verification below.

## Production verification protocol (mandatory — see rule in doc 20 §6)

**"Deployment ACTIVE" is not sufficient.** Run all of the following before calling a deployment verified:

1. **Health probe**: `curl https://neuratalk.in/api/health` → expect `{"status":"ok",...}`.
2. **Build identity probe**: `curl https://neuratalk.in/api/health/build` → expect `commitSha` to equal `git rev-parse HEAD` of the commit you just pushed. If it doesn't match, the deployment is running old code regardless of what DigitalOcean's dashboard says — do not proceed.
3. **Behavior-specific probe**: exercise something your change actually altered. If you added a route, confirm it doesn't 404. If you fixed an auth gate, confirm the unauthenticated response changed (e.g. 200→401), not just that the endpoint returns *something*.
4. **Authentication/security probe**: if your change touches an authenticated or tenant-scoped route, explicitly test the unauthenticated and cross-tenant cases, not just the happy path.
5. **Database/runtime checks where relevant**: if your change involved a migration, confirm the columns/tables exist (`information_schema.columns` or equivalent) and that a real read/write against them succeeds.

Example (this session, verifying the P1 org-lifecycle work post-fix):
```
curl -s -o /dev/null -w "%{http_code}\n" -X POST https://neuratalk.in/api/admin/companies/999999999/suspend
# 401 (route exists, auth-gated) -- NOT 404 (route missing / stale artifact)
```

Only after all applicable checks pass may you report a change as **PRODUCTION VERIFIED**. "I pushed it and DigitalOcean shows ACTIVE" is not a verification — it's a deployment attempt.

## Build failure behavior

If `npm run build` fails during the DigitalOcean build phase, the build step fails and the deployment does not proceed — the platform's buildpack behavior fails the whole build on a non-zero exit from any build command in the chain (`npm ci --omit=dev && npm run build`, joined with `&&`, so a build failure short-circuits before `run_command` is ever reached). The previously-running container keeps serving traffic; there is no fallback to a stale generated artifact because no artifact is generated on failure. **Do not add a fallback that would restart the old process with cached/committed output** — a failed build should surface as a failed deployment, not a silent no-op.

## Rollback

1. Identify the last known-good commit SHA (cross-check via `GET /api/health/build` from before the bad deploy, or `git log`).
2. `git revert` the bad commit(s) — do **not** try to restore an old `dist/` artifact; there isn't one to restore, by design.
3. Push the revert. This triggers a fresh build from the reverted source — same guarantee as any other deploy: the running artifact is built from the exact commit that's live.
4. **Database compatibility**: if the bad deploy included a migration, check whether the revert needs a corresponding down-migration before or after the code rollback. Additive migrations (new nullable columns, as used for the P1 org-lifecycle work) are safe to leave in place even after a code revert — old code simply ignores unused columns. Destructive migrations (column drops, renames, non-null constraints) are not currently used in this project's migration history; if one is ever introduced, its down-migration must be applied as part of rollback, not left implicit.
5. Re-run the full verification protocol above against the rolled-back deployment before calling it done.

## What NOT to do

- Do not commit `dist/` "just this once" to work around a build issue — fix the build.
- Do not treat a clean `[Routes] ✓ ...` boot log as proof a specific recent change is present — it only proves a route *module* loaded (see doc 20 for exactly how this went wrong).
- Do not skip the build-identity probe because the deployment "looks" active — this exact assumption is what let a P0 security fix sit un-enforced for hours.
