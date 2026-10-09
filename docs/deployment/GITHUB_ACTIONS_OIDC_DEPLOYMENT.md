# GitHub Actions AWS production deployment

Pushes to `neuratalk-clean-release` run the production checks (`npm run check`,
`npm test`, and `npm run build`) before deploying. The deploy job uses GitHub
OIDC to assume `NeuraTalkGitHubProdDeploy`; no long-lived AWS keys are stored
in GitHub.

The role trust is restricted to this repository and branch in
[`infra/aws/github-actions-prod-trust-policy.json`](../../infra/aws/github-actions-prod-trust-policy.json).
Its attached permissions are defined in
[`infra/aws/github-actions-prod-deploy-policy.json`](../../infra/aws/github-actions-prod-deploy-policy.json)
and limit service updates to `neuratalk-prod`. The deploy script packages the
checked-out commit, builds an immutable ECR image through CodeBuild, and rolls
that image out to ECS.

After rollout, the workflow checks `/api/health`, the database/auth-schema/Redis
readiness checks, and `/api/health/build` against the triggering commit SHA.
Optional integration gaps are reported as `degraded` and do not remove a
healthy core API from service. A real `LIVEKIT_SIP_DOMAIN` is still required
for PSTN bridging; this value must come from the provisioned LiveKit SIP
configuration and must not be guessed.

Use `workflow_dispatch` from `neuratalk-clean-release` for a manual run; the
AWS trust policy intentionally rejects tokens issued for other branches.
