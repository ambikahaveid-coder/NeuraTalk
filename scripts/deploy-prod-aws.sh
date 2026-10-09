#!/usr/bin/env bash
# Build the current git HEAD in CodeBuild and roll it out to the ECS
# `neuratalk-prod` service. Run from the repo root in Git Bash:
#   bash scripts/deploy-prod-aws.sh
# Also turns on ENABLE_STARTUP_SEEDING so an empty database gets the default
# billing plans / languages (seed is idempotent — it never overwrites rows).
set -euo pipefail
export MSYS_NO_PATHCONV=1
if [[ -z "${AWS_ACCESS_KEY_ID:-}" && -z "${AWS_WEB_IDENTITY_TOKEN_FILE:-}" ]]; then
  export AWS_PROFILE="${AWS_PROFILE:-neuratalk-deploy}"
fi
export AWS_DEFAULT_REGION=ap-south-1

PROJECT=neuratalk-docker-build
BUCKET=neuratalk-codebuild-source-1788367344
CLUSTER=default
SERVICE=neuratalk-prod
FAMILY=neuratalk-prod
REPO_URI=132597215158.dkr.ecr.ap-south-1.amazonaws.com/neuratalk

SHA=$(git rev-parse HEAD)
SHORT=$(git rev-parse --short HEAD)
# MSYS_NO_PATHCONV stops Git Bash translating POSIX paths like /tmp for
# native Windows tools (git, aws), so use a Windows-style path when available.
ROOT=$(pwd -W 2>/dev/null || pwd)
mkdir -p .deploy-tmp
ZIP="$ROOT/.deploy-tmp/neuratalk-$SHORT.zip"
rm -f "$ZIP"
KEY="source/neuratalk-source-$SHORT.zip"

echo "==> Packaging $SHORT"
git archive --format=zip -o "$ZIP" HEAD
aws s3 cp "$ZIP" "s3://$BUCKET/$KEY" --only-show-errors

echo "==> Starting CodeBuild"
BUILD_ID=$(aws codebuild start-build --project-name "$PROJECT" \
  --source-type-override S3 --source-location-override "$BUCKET/$KEY" \
  --environment-variables-override "name=GIT_COMMIT_SHA,value=$SHA,type=PLAINTEXT" \
  --query build.id --output text)
echo "    $BUILD_ID"

while :; do
  STATUS=$(aws codebuild batch-get-builds --ids "$BUILD_ID" --query 'builds[0].buildStatus' --output text)
  [ "$STATUS" != "IN_PROGRESS" ] && break
  echo "    build: $STATUS"; sleep 20
done
[ "$STATUS" = "SUCCEEDED" ] || { echo "Build $STATUS — see CodeBuild console"; exit 1; }

TAG="build-${BUILD_ID#*:}"
DIGEST=$(aws ecr describe-images --repository-name neuratalk --image-ids imageTag="$TAG" \
  --query 'imageDetails[0].imageDigest' --output text)
IMAGE="$REPO_URI@$DIGEST"
echo "==> Image $IMAGE"

echo "==> Registering new task definition revision"
CUR=$(aws ecs describe-services --cluster "$CLUSTER" --services "$SERVICE" --query 'services[0].taskDefinition' --output text)
aws ecs describe-task-definition --task-definition "$CUR" --query taskDefinition --output json > td.json
node -e '
const fs=require("fs");const td=JSON.parse(fs.readFileSync("td.json","utf8"));
for (const k of ["taskDefinitionArn","revision","status","requiresAttributes","compatibilities","registeredAt","registeredBy","deregisteredAt"]) delete td[k];
const c=td.containerDefinitions[0]; c.image=process.argv[1];
c.environment=(c.environment||[]).filter(e=>!["ENABLE_STARTUP_SEEDING","APP_BASE_URL"].includes(e.name));
c.environment.push({name:"ENABLE_STARTUP_SEEDING",value:"true"},{name:"APP_BASE_URL",value:"https://neuratalk.in"});
fs.writeFileSync("td.json",JSON.stringify(td));' "$IMAGE"
NEW=$(aws ecs register-task-definition --cli-input-json file://td.json --query taskDefinition.taskDefinitionArn --output text)
rm -f td.json
echo "    $NEW  (previous: $CUR)"

echo "==> Rolling out"
aws ecs update-service --cluster "$CLUSTER" --service "$SERVICE" --task-definition "$NEW" --query service.serviceName --output text
aws ecs wait services-stable --cluster "$CLUSTER" --services "$SERVICE"
echo "==> Deployed $SHORT. Rollback: aws ecs update-service --cluster $CLUSTER --service $SERVICE --task-definition $CUR"
