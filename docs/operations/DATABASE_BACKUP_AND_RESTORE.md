# Database backup and restore

Production database: **AWS RDS PostgreSQL 18, `neuratalk-prod-db`, Mumbai (ap-south-1)**. It is encrypted at rest, has deletion protection on, and only the app's security group can reach it.

## What is backed up

| Layer | What | Kept |
|---|---|---|
| RDS automatic backups | Daily backup plus transaction logs, so you can restore to any second | 14 days |
| Nightly snapshot (`.github/workflows/db-backup.yml`, 03:00 IST) | Full encrypted snapshot `neuratalk-nightly-YYYY-MM-DD-HHMM` | 35 days |
| Monthly snapshot (taken on the 1st) | `neuratalk-monthly-…` | 90 days |

Everything stays in Mumbai. You can also run the workflow by hand: Actions → "Database backup" → Run workflow. If a run fails, GitHub emails the repo owner.

The migration from Neon (Singapore) was on 2026-11-01. The last Neon dump is in S3 `neuratalk-db-backups-132597215158/daily/`.

## Restore (only after a decision: this changes what users see)

1. **Always restore into a NEW instance**, never over production:
   - To a point in time: `aws rds restore-db-instance-to-point-in-time --source-db-instance-identifier neuratalk-prod-db --target-db-instance-identifier neuratalk-restore-<date> --restore-time <UTC time> --db-subnet-group-name neuratalk-prod-db-subnets --vpc-security-group-ids <db sg>`
   - From a snapshot: `aws rds restore-db-instance-from-db-snapshot --db-snapshot-identifier <snapshot> --db-instance-identifier neuratalk-restore-<date> --db-subnet-group-name neuratalk-prod-db-subnets --vpc-security-group-ids <db sg>`
2. Compare the row counts of users, organizations, messages and subscriptions with production.
3. Only then point `DATABASE_URL` (Secrets Manager `neuratalk/aws-test/DATABASE_URL`) at the restored instance and force a new ECS deployment.
