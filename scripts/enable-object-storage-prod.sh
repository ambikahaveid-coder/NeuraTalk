#!/usr/bin/env bash
# Adds S3 object-storage settings to the running neuratalk-prod service
# without rebuilding: registers a new task-definition revision from the
# current one (same image) with OBJECT_STORAGE_S3_* set, then rolls out.
#
#   AK_ARN=<secret arn> SK_ARN=<secret arn> bash scripts/enable-object-storage-prod.sh
#
# The two ARNs are printed by the CloudShell setup in
# docs/deployment/OBJECT_STORAGE_SETUP_CLOUDSHELL.md (values are never shown).
set -euo pipefail
export MSYS_NO_PATHCONV=1
export AWS_PROFILE="${AWS_PROFILE:-neuratalk-deploy}"
export AWS_DEFAULT_REGION=ap-south-1

: "${AK_ARN:?set AK_ARN}"
: "${SK_ARN:?set SK_ARN}"
BUCKET_NAME="${BUCKET_NAME:-neuratalk-uploads-132597215158}"
CLUSTER=default
SERVICE=neuratalk-prod

CUR=$(aws ecs describe-services --cluster "$CLUSTER" --services "$SERVICE" --query 'services[0].taskDefinition' --output text)
aws ecs describe-task-definition --task-definition "$CUR" --query taskDefinition --output json > td-storage.json
node -e '
const fs=require("fs");const td=JSON.parse(fs.readFileSync("td-storage.json","utf8"));
for (const k of ["taskDefinitionArn","revision","status","requiresAttributes","compatibilities","registeredAt","registeredBy","deregisteredAt"]) delete td[k];
const c=td.containerDefinitions[0];
const [bucket, akArn, skArn] = process.argv.slice(1);
const env=(c.environment||[]).filter(e=>!e.name.startsWith("OBJECT_STORAGE_S3_"));
env.push({name:"OBJECT_STORAGE_S3_BUCKET",value:bucket},{name:"OBJECT_STORAGE_S3_REGION",value:"ap-south-1"});
c.environment=env;
const sec=(c.secrets||[]).filter(s=>!s.name.startsWith("OBJECT_STORAGE_S3_"));
sec.push({name:"OBJECT_STORAGE_S3_ACCESS_KEY",valueFrom:akArn},{name:"OBJECT_STORAGE_S3_SECRET",valueFrom:skArn});
c.secrets=sec;
fs.writeFileSync("td-storage.json",JSON.stringify(td));' "$BUCKET_NAME" "$AK_ARN" "$SK_ARN"
NEW=$(aws ecs register-task-definition --cli-input-json file://td-storage.json --query taskDefinition.taskDefinitionArn --output text)
rm -f td-storage.json
echo "==> $NEW (previous: $CUR)"
aws ecs update-service --cluster "$CLUSTER" --service "$SERVICE" --task-definition "$NEW" --query service.serviceName --output text
aws ecs wait services-stable --cluster "$CLUSTER" --services "$SERVICE"
echo "==> Object storage enabled. Rollback: aws ecs update-service --cluster $CLUSTER --service $SERVICE --task-definition $CUR"
