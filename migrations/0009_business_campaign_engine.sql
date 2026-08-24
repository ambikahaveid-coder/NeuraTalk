-- Migration: business campaign engine (Phase 5, 2026-08-24)
-- See docs/neura-ecosystem/30_CAMPAIGN_ENGINE_IMPLEMENTATION.md
-- Run: psql $DATABASE_URL < this_file  OR via drizzle-kit push
--
-- Additive: 2 new tables (campaigns, campaign_recipients). No ALTER TABLE
-- against templates/template_versions/approval_requests/customers/
-- audiences/audience_members/messaging_* -- campaigns REFERENCES those
-- tables (template_version_id, audience_id, customer_id) but no column is
-- added, removed, or altered on any of them.
--
-- NOT APPLIED to any database as part of this commit -- Phase 5 was
-- implementation + local mock-based verification only, no production
-- migration, per the standing no-local-DB constraint carried from Phases 0-4.

CREATE TABLE IF NOT EXISTS "campaigns" (
  "id" serial PRIMARY KEY NOT NULL,
  "business_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "description" text,
  "category" text NOT NULL,
  "status" text NOT NULL DEFAULT 'draft',
  "template_version_id" integer REFERENCES "template_versions"("id"),
  "audience_id" integer REFERENCES "audiences"("id"),
  "created_by" integer NOT NULL REFERENCES "users"("id"),
  "approved_by" integer REFERENCES "users"("id"),
  "approved_at" timestamp,
  "scheduled_at" timestamp,
  "started_at" timestamp,
  "completed_at" timestamp,
  "cancelled_at" timestamp,
  "cancelled_by" integer REFERENCES "users"("id"),
  "failure_reason" text,
  "created_at" timestamp DEFAULT now(),
  "updated_at" timestamp DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "campaigns_business_idx" ON "campaigns" ("business_id");
CREATE INDEX IF NOT EXISTS "campaigns_business_status_idx" ON "campaigns" ("business_id", "status");

CREATE TABLE IF NOT EXISTS "campaign_recipients" (
  "id" serial PRIMARY KEY NOT NULL,
  "campaign_id" integer NOT NULL REFERENCES "campaigns"("id") ON DELETE CASCADE,
  "customer_id" integer NOT NULL REFERENCES "customers"("id") ON DELETE CASCADE,
  "status" text NOT NULL DEFAULT 'pending',
  "skip_reason" text,
  "message_id" integer REFERENCES "messaging_messages"("id"),
  "charged_paise" integer,
  "processed_at" timestamp,
  "created_at" timestamp DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "campaign_recipients_campaign_status_idx" ON "campaign_recipients" ("campaign_id", "status");
CREATE INDEX IF NOT EXISTS "campaign_recipients_customer_idx" ON "campaign_recipients" ("customer_id");
CREATE UNIQUE INDEX IF NOT EXISTS "campaign_recipients_campaign_customer_idx" ON "campaign_recipients" ("campaign_id", "customer_id");

-- Rollback (safe -- no pre-existing code path references these tables):
--
-- DROP TABLE IF EXISTS "campaign_recipients";
-- DROP TABLE IF EXISTS "campaigns";
