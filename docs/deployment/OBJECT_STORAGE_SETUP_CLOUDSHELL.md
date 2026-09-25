# Object storage (chat files, photos, voice notes) — one-time AWS setup

Run once in **AWS CloudShell** as the account owner (account 132597215158, region Mumbai / ap-south-1).
It creates a private, encrypted S3 bucket, a dedicated IAM user that can only touch that bucket, stores
that user's keys in Secrets Manager (the values are never printed), and lets the ECS task read them.
Afterwards run `scripts/enable-object-storage-prod.sh` with the two ARNs it prints.

```bash
set -e
REGION=ap-south-1
ACCOUNT=132597215158
BUCKET=neuratalk-uploads-$ACCOUNT
IAM_USER=neuratalk-object-storage

aws s3api create-bucket --bucket "$BUCKET" --region "$REGION" \
  --create-bucket-configuration LocationConstraint="$REGION"
aws s3api put-public-access-block --bucket "$BUCKET" --public-access-block-configuration \
  BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true
aws s3api put-bucket-encryption --bucket "$BUCKET" --server-side-encryption-configuration \
  '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"}}]}'
aws s3api put-bucket-cors --bucket "$BUCKET" --cors-configuration \
  '{"CORSRules":[{"AllowedOrigins":["https://neuratalk.in"],"AllowedMethods":["PUT","GET","HEAD"],"AllowedHeaders":["*"],"MaxAgeSeconds":3000}]}'

aws iam create-user --user-name "$IAM_USER" >/dev/null
aws iam put-user-policy --user-name "$IAM_USER" --policy-name uploads-bucket-only --policy-document "{
  \"Version\":\"2012-10-17\",
  \"Statement\":[
    {\"Effect\":\"Allow\",\"Action\":[\"s3:PutObject\",\"s3:GetObject\",\"s3:DeleteObject\"],\"Resource\":\"arn:aws:s3:::$BUCKET/*\"},
    {\"Effect\":\"Allow\",\"Action\":\"s3:ListBucket\",\"Resource\":\"arn:aws:s3:::$BUCKET\"}
  ]}"

read -r AK SK < <(aws iam create-access-key --user-name "$IAM_USER" \
  --query 'AccessKey.[AccessKeyId,SecretAccessKey]' --output text)
AK_ARN=$(aws secretsmanager create-secret --region "$REGION" \
  --name neuratalk/aws-test/OBJECT_STORAGE_S3_ACCESS_KEY --secret-string "$AK" --query ARN --output text)
SK_ARN=$(aws secretsmanager create-secret --region "$REGION" \
  --name neuratalk/aws-test/OBJECT_STORAGE_S3_SECRET --secret-string "$SK" --query ARN --output text)
unset AK SK

aws iam put-role-policy --role-name neuratalk-ecsTaskExecutionRole --policy-name read-object-storage-secrets \
  --policy-document "{\"Version\":\"2012-10-17\",\"Statement\":[{\"Effect\":\"Allow\",\"Action\":\"secretsmanager:GetSecretValue\",\"Resource\":[\"$AK_ARN\",\"$SK_ARN\"]}]}"

echo "DONE"
echo "AK_ARN=$AK_ARN"
echo "SK_ARN=$SK_ARN"
```

Undo: delete the two secrets, the IAM user (after deleting its access key and inline policy), the
`read-object-storage-secrets` inline policy on `neuratalk-ecsTaskExecutionRole`, and the bucket.
