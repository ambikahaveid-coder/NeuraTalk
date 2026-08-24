-- Migration: business utility messaging foundation (Phase 7, 2026-08-24)
-- See docs/neura-ecosystem/32_BUSINESS_UTILITY_MESSAGING_IMPLEMENTATION.md
-- Run: psql $DATABASE_URL < this_file  OR via drizzle-kit push
--
-- Additive: 1 new table (business_utility_events). Reuses customers,
-- templates, template_versions, messaging_messages, messaging_deliveries,
-- messaging_events, audit_logs, billing_accounts unmodified -- no ALTER
-- TABLE against any of them.
--
-- NOT APPLIED to any database as part of this commit -- Phase 7 was
-- implementation + local mock-based verification only, no production
-- migration, per the standing no-local-DB constraint carried from
-- Phases 0-6.

CREATE TABLE IF NOT EXISTS "business_utility_events" (
  "id" serial PRIMARY KEY NOT NULL,
  "business_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "customer_id" integer NOT NULL REFERENCES "customers"("id") ON DELETE CASCADE,
  "event_type" text NOT NULL,
  "event_reference" text NOT NULL,
  "template_version_id" integer NOT NULL REFERENCES "template_versions"("id"),
  "status" text NOT NULL DEFAULT 'failed',
  "failure_reason" text,
  "message_id" integer REFERENCES "messaging_messages"("id"),
  "charged_paise" integer,
  "created_by" integer REFERENCES "users"("id"),
  "created_at" timestamp DEFAULT now(),
  "processed_at" timestamp
);
CREATE INDEX IF NOT EXISTS "business_utility_events_business_idx" ON "business_utility_events" ("business_id");
CREATE INDEX IF NOT EXISTS "business_utility_events_customer_idx" ON "business_utility_events" ("customer_id");
CREATE INDEX IF NOT EXISTS "business_utility_events_business_status_idx" ON "business_utility_events" ("business_id", "status");
CREATE UNIQUE INDEX IF NOT EXISTS "business_utility_events_idempotency_idx"
  ON "business_utility_events" ("business_id", "event_type", "event_reference");

-- Rollback (safe -- no pre-existing code path references this table):
--
-- DROP TABLE IF EXISTS "business_utility_events";
