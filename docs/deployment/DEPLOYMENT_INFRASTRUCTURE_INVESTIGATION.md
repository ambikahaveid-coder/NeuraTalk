# NeuraTalk — Deployment Infrastructure Investigation

Read-only investigation. No source code touched, no commits created, no rebuild, no smoke tests run. This report covers only the deployment pipeline itself.

**Hard limitation up front:** this environment has no working DigitalOcean API credentials (`doctl account get` → `401 Unable to authenticate you`; no `DIGITALOCEAN_ACCESS_TOKEN` or `doctl` config found anywhere on the machine). Every finding below is therefore inferred from GitHub-side signals and live HTTP behavior, not DO's own dashboard/API/logs — which is the *only* place several of your 12 questions can be answered with certainty. I'm flagging exactly which ones those are rather than guessing.

---

## New evidence found this pass

**The production app's HTTP response headers include a real DigitalOcean App Platform identifier:**
```
x-do-app-origin: 29804097-952f-4626-a869-840bf34a71b3
```
This confirms `neuratalk.in` is genuinely served by a live DO App Platform app (not a DNS misconfiguration or a different host entirely) — App ID `29804097-952f-4626-a869-840bf34a71b3`. **Give this ID to whoever checks the DO dashboard** — it's the fastest way to jump directly to the right app.

**Zero GitHub-side deployment signal of any kind:**
- `gh api repos/jagopro452-cloud/Neura-Talk/hooks` → `[]` — **zero webhooks configured on this repository.**
- `gh api repos/jagopro452-cloud/Neura-Talk/commits/80b9831/status` → `total_count: 0`
- `.../commits/80b9831/check-runs` → `total_count: 0`
- `.../deployments` → `[]`
- `gh api repos/jagopro452-cloud/Neura-Talk/events` → the most recent event is **my own push** (`PushEvent`, `80b9831`, `2026-07-14T07:49:59Z`). Scanning back through prior events (`2b2dea6`, `0bca1f5`, `722ebe6`, ...), every single event on this repo's entire visible history was authored by the human account `jagopro452-cloud` — **no bot, app, or service account has ever appeared in this repo's event feed.**
- `gh api repos/jagopro452-cloud/Neura-Talk/collaborators` → only `jagopro452-cloud` (role: admin). No DigitalOcean service account/bot listed.

**Caveat on all of the above:** DigitalOcean App Platform's GitHub integration is a GitHub *App* installation, not a classic repo webhook — GitHub Apps don't necessarily appear in `/hooks`, in the events feed, or as a "collaborator." I attempted to check GitHub App installations directly (`repos/.../installation`, `user/installations`) and both failed with 403/401 — my token isn't scoped/authenticated the right way to query that specific endpoint. **So the absence of a classic webhook is suggestive, not conclusive, on its own.** Combined with everything else below, though, it's the strongest single piece of evidence I have.

---

## Answering your 12 questions

| # | Question | Answer |
|---|---|---|
| 1 | Is the DO App still connected to `jagopro452-cloud/Neura-Talk`? | **Cannot confirm directly.** `.do/app.yaml` *in the repo* declares this repo correctly (verified at commit `80b9831`). Whether the **live** App resource's actual GitHub connection still matches this spec cannot be checked without DO dashboard/API access — the spec file changing doesn't retroactively update a live app unless someone applied it. |
| 2 | Is Auto Deploy enabled? | **Cannot confirm directly**, same reasoning — `deploy_on_push: true` is declared in the spec file, not verifiable as the live setting from here. This is my leading suspect given the total absence of any GitHub-side trigger signal. |
| 3 | Is `80b9831` visible in deployment history? | **Cannot check** — requires DO dashboard/API (`doctl apps list-deployments`), which I don't have access to. |
| 4 | Did a deployment start? | **No evidence it did.** Zero check-runs, zero deployment records, zero bot activity on GitHub; production `uptime` has grown continuously with no restart across 45+ minutes of monitoring; `/readyz` still returns the pre-fix 504. All available signals point the same direction. |
| 5 | Did the deployment fail? | **Cannot distinguish "never triggered" from "triggered and failed silently"** without DO logs. Given zero trace of any attempt anywhere (not even a failed check-run), "never triggered" is the more consistent explanation, but I can't prove it over "failed before posting any status." |
| 6 | Is a deployment currently queued? | **Cannot check.** 45+ minutes is atypically long for a queued state on a `build_command: npm ci --omit=dev`-only app (no real build step), which weighs against this, but isn't conclusive from here. |
| 7 | Blocked by build errors? | **Unlikely, but unverifiable.** A build-error block presupposes a deployment actually started; I found no evidence one did. |
| 8 | Blocked by health checks? | **Unlikely, but unverifiable**, same reasoning as #7 — a health-check-based rollback would still mean a deployment *started*. |
| 9 | Blocked by missing environment variables? | **Unlikely, but unverifiable**, same reasoning. |
| 10 | Is the App pointing to the correct branch? | Spec file says `neuratalk-clean-release` — matches what I pushed to. Live setting unverifiable from here. |
| 11 | Is `deploy_on_push` actually enabled on the *active* App? | **This is the real open question and my leading hypothesis for the root cause** — the repo-file spec and the live app's actual configuration are two different things, and nothing here can confirm they match. |
| 12 | Compare deployed commit vs `80b9831` | **Cannot fetch the live deployed commit hash directly** (no version/build endpoint exposed, no DO access). Strong indirect evidence the live commit predates `fb55c8d`: `/readyz` still 504s (that's the exact bug the RC1 commit fixed) and process uptime shows no restart. So: **the live commit is almost certainly still at or before `2b2dea6`** (the commit GitHub showed as the branch tip before my push), not `80b9831`. |

---

## Deployment Status
**No deployment observed.** Push to the correct repository/branch is confirmed successful and independently verified via GitHub's API. Nothing downstream of that push shows any sign of DigitalOcean having acted on it.

## Deployment Logs
**Unavailable from this environment.** Requires DO dashboard (App → Activity/Deployments tab) or `doctl apps list-deployments <app-id>` / `doctl apps logs <app-id>` with a valid, authenticated token — App ID `29804097-952f-4626-a869-840bf34a71b3` (recovered from the `x-do-app-origin` response header this pass).

## Failure Reason
**Most likely:** the live DO App's GitHub integration (or its Auto Deploy toggle specifically) is not actually active, despite `.do/app.yaml` in the repository declaring it should be. This is a *configuration drift* pattern — the spec file and the live app's real settings can diverge if the spec was edited in the repo but never re-applied to the running app via `doctl apps update` or the DO dashboard's "match spec" action.
**Cannot rule out:** a silently failed/stuck deployment that produced no GitHub-visible trace, or a DO-side incident. Only DO's own dashboard/logs can distinguish these from the leading hypothesis.

## Required Operator Actions
1. Open the DO dashboard → Apps → app ID `29804097-952f-4626-a869-840bf34a71b3` → **Settings → App-Level → Source**. Confirm the connected GitHub repo/branch match `jagopro452-cloud/Neura-Talk` / `neuratalk-clean-release`, and that **Autodeploy** is toggled on for that branch.
2. Check the **Activity/Deployments tab** for any entry at all corresponding to `80b9831` or a timestamp around `2026-07-14T07:49:59Z` — confirms or refutes #4 directly.
3. If the GitHub connection looks disconnected or stale, reconnect it (DO's UI usually offers "reconnect" or re-authorize when this happens) and confirm a fresh webhook/App installation gets created — then re-check `gh api repos/jagopro452-cloud/Neura-Talk/hooks` from this environment; it should no longer return `[]`.
4. If the connection looks fine and Autodeploy is on, but there's still no deployment for `80b9831`, trigger a **manual deploy** from the dashboard targeting that commit as a fallback, then check its logs directly for the real failure reason.
5. Consider providing a `DIGITALOCEAN_ACCESS_TOKEN` (`doctl auth init`) in this environment for any future turn — it would make steps 1–4 directly verifiable instead of inferred.

---

Stopping here as instructed. No smoke tests run, no code changed, no commits created, no rebuild performed.
