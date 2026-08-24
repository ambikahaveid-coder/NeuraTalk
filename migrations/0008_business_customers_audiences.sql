-- Migration: business customers + audiences foundation (Phase 4, 2026-08-24)
-- See docs/neura-ecosystem/29_BUSINESS_CUSTOMERS_AUDIENCES_IMPLEMENTATION.md
-- Run: psql $DATABASE_URL < this_file  OR via drizzle-kit push
--
-- Additive: 4 new tables (customers, customer_consents, audiences,
-- audience_members) + one ALTER TABLE to wire an FK that was left as a
-- documented forward-reference in migrations/0004 (business_conversations.
-- customer_id), now that the `customers` table exists. No AI chat, personal
-- chat, group chat, or other canonical-messaging column is added/removed/
-- altered -- only this one FK constraint on an already-existing, already-
-- nullable column.
--
-- NOT APPLIED to any database as part of this commit -- Phase 4 was
-- implementation + local mock-based verification only, no production
-- migration, per the standing no-local-DB constraint carried from Phases 0-3.

CREATE TABLE IF NOT EXISTS "customers" (
  "id" serial PRIMARY KEY NOT NULL,
  "business_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "linked_user_id" integer REFERENCES "users"("id"),
  "name" text,
  "phone" text,
  "normalized_phone" text,
  "email" text,
  "normalized_email" text,
  "external_ref" text,
  "notes" text,
  "status" text NOT NULL DEFAULT 'active',
  "source" text NOT NULL DEFAULT 'manual',
  "created_by" integer NOT NULL REFERENCES "users"("id"),
  "created_at" timestamp DEFAULT now(),
  "updated_at" timestamp DEFAULT now(),
  "archived_by" integer REFERENCES "users"("id"),
  "archived_at" timestamp
);
CREATE INDEX IF NOT EXISTS "customers_business_idx" ON "customers" ("business_id");
CREATE INDEX IF NOT EXISTS "customers_business_status_idx" ON "customers" ("business_id", "status");
CREATE INDEX IF NOT EXISTS "customers_business_name_idx" ON "customers" ("business_id", "name");
CREATE UNIQUE INDEX IF NOT EXISTS "customers_business_phone_idx" ON "customers" ("business_id", "normalized_phone")
  WHERE "normalized_phone" IS NOT NULL AND "normalized_phone" != '';
CREATE UNIQUE INDEX IF NOT EXISTS "customers_business_email_idx" ON "customers" ("business_id", "normalized_email")
  WHERE "normalized_email" IS NOT NULL AND "normalized_email" != '';
CREATE UNIQUE INDEX IF NOT EXISTS "customers_business_external_ref_idx" ON "customers" ("business_id", "external_ref")
  WHERE "external_ref" IS NOT NULL AND "external_ref" != '';

CREATE TABLE IF NOT EXISTS "customer_consents" (
  "id" serial PRIMARY KEY NOT NULL,
  "business_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "customer_id" integer NOT NULL REFERENCES "customers"("id") ON DELETE CASCADE,
  "channel" text NOT NULL,
  "status" text NOT NULL,
  "source" text,
  "updated_by" integer REFERENCES "users"("id"),
  "created_at" timestamp DEFAULT now(),
  "updated_at" timestamp DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "customer_consents_business_idx" ON "customer_consents" ("business_id");
CREATE UNIQUE INDEX IF NOT EXISTS "customer_consents_customer_channel_idx" ON "customer_consents" ("customer_id", "channel");

CREATE TABLE IF NOT EXISTS "audiences" (
  "id" serial PRIMARY KEY NOT NULL,
  "business_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "description" text,
  "type" text NOT NULL DEFAULT 'static',
  "status" text NOT NULL DEFAULT 'active',
  "created_by" integer NOT NULL REFERENCES "users"("id"),
  "created_at" timestamp DEFAULT now(),
  "updated_at" timestamp DEFAULT now(),
  "archived_by" integer REFERENCES "users"("id"),
  "archived_at" timestamp
);
CREATE INDEX IF NOT EXISTS "audiences_business_idx" ON "audiences" ("business_id");
CREATE UNIQUE INDEX IF NOT EXISTS "audiences_business_name_idx" ON "audiences" ("business_id", "name");

CREATE TABLE IF NOT EXISTS "audience_members" (
  "id" serial PRIMARY KEY NOT NULL,
  "audience_id" integer NOT NULL REFERENCES "audiences"("id") ON DELETE CASCADE,
  "customer_id" integer NOT NULL REFERENCES "customers"("id") ON DELETE CASCADE,
  "added_by" integer NOT NULL REFERENCES "users"("id"),
  "added_at" timestamp DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "audience_members_audience_idx" ON "audience_members" ("audience_id");
CREATE INDEX IF NOT EXISTS "audience_members_customer_idx" ON "audience_members" ("customer_id");
CREATE UNIQUE INDEX IF NOT EXISTS "audience_members_pair_idx" ON "audience_members" ("audience_id", "customer_id");

-- Wire the Phase 0 forward-reference now that `customers` exists.
ALTER TABLE "business_conversations"
  ADD CONSTRAINT "business_conversations_customer_id_customers_id_fk"
  FOREIGN KEY ("customer_id") REFERENCES "customers"("id");

-- Rollback (safe -- no pre-existing code path references these tables; the
-- FK constraint above is the only change to a pre-existing table):
--
-- ALTER TABLE "business_conversations" DROP CONSTRAINT IF EXISTS "business_conversations_customer_id_customers_id_fk";
-- DROP TABLE IF EXISTS "audience_members";
-- DROP TABLE IF EXISTS "audiences";
-- DROP TABLE IF EXISTS "customer_consents";
-- DROP TABLE IF EXISTS "customers";
