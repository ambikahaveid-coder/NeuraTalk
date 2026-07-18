# NeuraTalk — Deployment Pipeline Diagnosis & Repair Attempt

Follow-up to `DEPLOYMENT_INFRASTRUCTURE_INVESTIGATION.md`, with new direct runtime evidence. **No source code modified. No commits created.**

---

## Hard limitation, unchanged

This environment still has no working DigitalOcean credentials:
```
doctl account get → 401 Unable to authenticate you
env | grep -i digitalocean → (nothing)
doctl auth list → "default (current)" — configured but not authenticated
```
No `.github/workflows/` directory exists, and no deploy-hook script/URL was found anywhere in the repo. **Result: Phase 1 (live App config inspection) and Phase 4 (repair — reconnect GitHub, toggle Autodeploy, trigger redeploy) cannot be executed from this environment.** Everything below is direct HTTP/GitHub evidence, not DO dashboard/API confirmation. I did not fabricate a "fix" I can't actually perform — seeing this through requires DO dashboard or a valid `DIGITALOCEAN_ACCESS_TOKEN`.

---

## New direct evidence this pass: two live instances, neither matching the push

Ten consecutive requests to `/api/health`, ~0.6s apart:

```
1181989.65   512706.29   1181991.05   1181991.68   1181992.46
512708.91    512709.51   1181994.32   1181994.98   512711.28
```

This is a **round-robin load balancer alternating between exactly two backend processes**:
- Instance A: uptime ≈ 1,182,000s ≈ **13.68 days** (last restarted ≈ 2026-06-30 — matches a `PushEvent` on that date)
- Instance B: uptime ≈ 512,700s ≈ **5.93 days** (last restarted ≈ 2026-07-08 — matches no push event in the repo's visible history)

**Neither instance has an uptime anywhere near the ~2.6 hours that would correspond to a redeploy triggered by the `80b9831` push at `2026-07-14T07:49:59Z`.** If the push had triggered a deployment, at least one instance would show uptime in the range of minutes-to-a-few-hours. This is direct, conclusive (not inferred) proof that **no deployment for `80b9831` has occurred**, superseding the "cannot confirm" caveats in the prior report — this is now confirmed, not suspected.

**Secondary finding, worth flagging to the operator separately:** `.do/app.yaml` declares `instance_count: 1`, but production is visibly serving traffic from **two** processes with different uptimes. Either the live App's instance count doesn't match the spec (more configuration drift, same root pattern as the deploy_on_push question), or these are two edge/App-Platform-internal replicas outside the app's own control. Cannot distinguish without dashboard access — but it's consistent with the broader "spec file ≠ live configuration" hypothesis.

Frontend bundle hash (`/assets/index-r4i4URlI.js`) was stable across 4 repeated homepage fetches — the frontend asset is not mid-rollout/flapping, just uniformly old. `/readyz` still returns an edge-level `504 via_upstream` in 3.7s (DO's own edge failed to get a timely response from the app — the exact class of bug RC1's `/readyz` fix addresses), and `/metrics` still returns `200` with no auth token (consistent with either pre-RC1 code, or RC1 code with `METRICS_TOKEN` unset in the live environment — inconclusive on its own, but consistent with everything else).

GitHub-side signals are unchanged from the prior investigation: `hooks` → `[]`, commit status/check-runs/deployments for `80b9831` → all empty, no bot/App activity anywhere in the event history, no `.github/workflows` deploy path as a fallback trigger.

---

## Root Cause

**Confirmed:** commit `80b9831` has not been deployed. Production is running two processes, both pre-dating the push by days.

**Most likely mechanism (still requires dashboard confirmation to finalize):** the live DO App's GitHub integration/Autodeploy is not actually wired to fire on pushes to `neuratalk-clean-release`, despite `.do/app.yaml` declaring `deploy_on_push: true` — a spec-vs-live-app configuration drift. Zero GitHub App/webhook activity of any kind, on any of this repo's last 5 events (going back to `2026-06-24`), is the supporting signal: if Autodeploy had ever been genuinely active, GitHub would show *something* — a check-run, a deployment record, or a webhook — even from earlier pushes, and it shows nothing across the entire visible history.

## Evidence
- `doctl` unauthenticated (401) — no direct DO API access.
- `gh api .../hooks` → `[]`; `.../commits/80b9831/status` → 0; `.../check-runs` → 0; `.../deployments` → `[]`.
- 10x `/api/health` polling shows two stable instance uptimes (~13.68d, ~5.93d), neither consistent with a ~2.6-hour-old deploy.
- `/readyz` still 504s at the edge (3.7s), reproducing the exact pre-fix symptom.
- No `.github/workflows/`, no deploy-hook script in the repo as an alternate trigger path.

## Configuration Changes
**None made.** No credentials to make any on the DO side; explicitly did not touch `.do/app.yaml`, git history, or any source file.

## Deployment History
Unknown/unavailable from this environment (requires `doctl apps list-deployments <app-id>` or the DO dashboard's Activity tab). App ID for lookup: `29804097-952f-4626-a869-840bf34a71b3`.

## Current Live Commit
Not directly queryable (no build/version endpoint exposed). Indirect but strong evidence it is **at or before `2b2dea6`** (the pre-push branch tip): `/readyz` reproduces the pre-fix bug, and neither live instance's uptime is compatible with a recent redeploy.

## Build Status
N/A — no build was ever triggered for `80b9831` as far as any observable signal shows.

## Health Status
`/api/health` → `200 ok` (this only checks process liveness, not app-level readiness). `/readyz` → `504` (edge-level, upstream forwarding failure). `/metrics` → `200`, unauthenticated.

## Deployment Pipeline Status
**Broken / not triggering.** Confirmed by direct runtime evidence this pass, not inference alone.

## Required Operator Actions (unchanged from prior report, now higher-confidence)
1. DO Dashboard → Apps → `29804097-952f-4626-a869-840bf34a71b3` → **Settings → Source**: confirm GitHub connection is live and points at `jagopro452-cloud/Neura-Talk` / `neuratalk-clean-release`, and that Autodeploy is ON.
2. **Activity/Deployments tab**: look for any deployment entry at all — even a failed one — around `2026-07-14T07:49:59Z`. Its absence would confirm the trigger never fired; its presence with a failure would point to a build/health-check block instead.
3. If disconnected/stale: reconnect GitHub. Re-run `gh api repos/jagopro452-cloud/Neura-Talk/hooks` afterward from here — it should stop returning `[]` once a real integration exists.
4. Regardless of #1–3's outcome, **trigger a manual deploy of `80b9831`** from the dashboard as the fastest path to actually get RC1 live — don't wait on diagnosing the Autodeploy trigger first.
5. Check whether **instance count** on the live app actually matches `instance_count: 1` in the spec — production is currently serving from 2 distinct processes, which may itself indicate the live spec has drifted further than just the deploy trigger.
6. For any future turn, provide `DIGITALOCEAN_ACCESS_TOKEN` (`doctl auth init --access-token <token>`) so Phases 1 and 4 can be done directly instead of inferred/blocked.

---

❌ Deployment pipeline still broken
