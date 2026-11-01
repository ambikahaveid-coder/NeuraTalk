# Database backup and restore

## What is backed up

| Layer | What | Kept |
|---|---|---|
| Nightly dump | Full `pg_dump` of production (all 150+ tables), checked before upload | Daily copies 35 days; 1st-of-month copies ~13 months |
| Where | S3 `neuratalk-db-backups-132597215158` (Mumbai, private, encrypted, versioned) | |
| Neon history | Neon's own point-in-time restore | Depends on the Neon plan. Check it in the Neon console under Settings → Storage → History retention. |

Workflow: `.github/workflows/db-backup.yml`. It runs at 03:00 IST, and you can also run it by hand from the Actions tab ("Database backup" → Run workflow). A failed run emails the repo owner.

## Restore (only after a decision: this replaces data)

1. Pick a dump: `aws s3 ls s3://neuratalk-db-backups-132597215158/daily/`
2. Download it: `aws s3 cp s3://neuratalk-db-backups-132597215158/daily/<file> .`
3. **Restore into a NEW, empty Neon branch or database first**, never straight over production:
   `pg_restore --no-owner --no-privileges --dbname="<new-database-url>" <file>`
4. Check the row counts of users, organizations, messages and subscriptions against production.
5. Only then point `DATABASE_URL` (Secrets Manager `neuratalk/aws-test/DATABASE_URL`) at the restored database and redeploy.

Use PostgreSQL 18 client tools, the same major version as production.
