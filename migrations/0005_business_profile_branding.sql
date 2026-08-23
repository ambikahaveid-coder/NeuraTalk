-- Migration: business profile fields (Phase 1, 2026-08-23)
-- See docs/neura-ecosystem/26_BUSINESS_PROFILE_BRANDING_IMPLEMENTATION.md
-- Run: psql $DATABASE_URL < this_file  OR via drizzle-kit push
--
-- Purely additive: 6 new nullable columns on the existing "organizations"
-- table. No renames, no drops, no type changes, no NOT NULL constraints.
-- Branding (colors) requires NO migration at all -- it is stored under the
-- existing "settings" jsonb column (BRANDING_SETTINGS_KEY = "branding"
-- in shared/schema.ts), so there is nothing to add here for it.
--
-- NOT APPLIED to any database as part of this commit -- Phase 1 approval
-- was implementation + local verification only, no production migration.

ALTER TABLE "organizations"
  ADD COLUMN IF NOT EXISTS "legal_business_name" text,
  ADD COLUMN IF NOT EXISTS "description" text,
  ADD COLUMN IF NOT EXISTS "address_city" text,
  ADD COLUMN IF NOT EXISTS "address_state" text,
  ADD COLUMN IF NOT EXISTS "address_country" text,
  ADD COLUMN IF NOT EXISTS "address_postal_code" text;

-- Rollback (safe -- these columns are not referenced by any pre-existing
-- code path, only by the new Phase 1 business-profile routes):
--
-- ALTER TABLE "organizations"
--   DROP COLUMN IF EXISTS "legal_business_name",
--   DROP COLUMN IF EXISTS "description",
--   DROP COLUMN IF EXISTS "address_city",
--   DROP COLUMN IF EXISTS "address_state",
--   DROP COLUMN IF EXISTS "address_country",
--   DROP COLUMN IF EXISTS "address_postal_code";
