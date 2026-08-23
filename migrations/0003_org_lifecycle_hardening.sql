-- Migration: organization lifecycle hardening (P1 foundation, 2026-08-23)
-- Run: psql $DATABASE_URL < this_file  OR via drizzle-kit push
--
-- Purely additive: 8 new nullable columns on the existing "organizations" table.
-- No renames, no drops, no type changes, no NOT NULL constraints added.
-- Existing rows are unaffected -- all new columns default to NULL, meaning
-- "no suspend/reactivate/deactivate has ever happened to this org", which is
-- correct for every row that predates this migration.
--
-- rejected_by fills a pre-existing gap: the reject endpoint has always recorded
-- rejectedAt/rejectionReason but never which admin performed the rejection.

ALTER TABLE "organizations"
  ADD COLUMN IF NOT EXISTS "rejected_by" integer,
  ADD COLUMN IF NOT EXISTS "suspended_at" timestamp,
  ADD COLUMN IF NOT EXISTS "suspended_by" integer,
  ADD COLUMN IF NOT EXISTS "suspension_reason" text,
  ADD COLUMN IF NOT EXISTS "reactivated_at" timestamp,
  ADD COLUMN IF NOT EXISTS "reactivated_by" integer,
  ADD COLUMN IF NOT EXISTS "deactivated_at" timestamp,
  ADD COLUMN IF NOT EXISTS "deactivated_by" integer,
  ADD COLUMN IF NOT EXISTS "deactivation_reason" text;

-- Rollback (if ever needed -- safe, these columns are not referenced by any
-- pre-existing code path, only by the new lifecycle routes added alongside
-- this migration):
--
-- ALTER TABLE "organizations"
--   DROP COLUMN IF EXISTS "rejected_by",
--   DROP COLUMN IF EXISTS "suspended_at",
--   DROP COLUMN IF EXISTS "suspended_by",
--   DROP COLUMN IF EXISTS "suspension_reason",
--   DROP COLUMN IF EXISTS "reactivated_at",
--   DROP COLUMN IF EXISTS "reactivated_by",
--   DROP COLUMN IF EXISTS "deactivated_at",
--   DROP COLUMN IF EXISTS "deactivated_by",
--   DROP COLUMN IF EXISTS "deactivation_reason";
