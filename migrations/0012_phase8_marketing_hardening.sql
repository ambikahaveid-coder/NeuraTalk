-- Migration: Phase 8 marketing hardening -- frequency/throughput caps
-- (2026-08-24)
-- See docs/neura-ecosystem/34_PHASE8_MARKETING_HARDENING_IMPLEMENTATION.md
-- Run: psql $DATABASE_URL < this_file  OR via drizzle-kit push
--
-- Additive: 2 new tables (customer_marketing_frequency,
-- business_marketing_throughput). No ALTER TABLE against customers,
-- customer_consents, templates, template_versions, campaigns,
-- campaign_recipients, canonical messaging, billing_accounts, or
-- audit_logs -- Part 1/2 (consent write path) required NO schema change
-- at all, since customerConsents already existed (Phase 4) with the
-- correct shape; only new HTTP routes were added on top of it.
--
-- NOT APPLIED to any database as part of this commit -- Phase 8 hardening
-- was implementation + local mock-based verification only, no production
-- migration, per the standing no-local-DB constraint carried from
-- Phases 0-7.

CREATE TABLE IF NOT EXISTS "customer_marketing_frequency" (
  "id" serial PRIMARY KEY NOT NULL,
  "business_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "customer_id" integer NOT NULL REFERENCES "customers"("id") ON DELETE CASCADE,
  "window_start" timestamp NOT NULL,
  "sent_count" integer NOT NULL DEFAULT 0,
  "updated_at" timestamp DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "customer_marketing_frequency_window_idx"
  ON "customer_marketing_frequency" ("business_id", "customer_id", "window_start");

CREATE TABLE IF NOT EXISTS "business_marketing_throughput" (
  "id" serial PRIMARY KEY NOT NULL,
  "business_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "window_start" timestamp NOT NULL,
  "sent_count" integer NOT NULL DEFAULT 0,
  "updated_at" timestamp DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "business_marketing_throughput_window_idx"
  ON "business_marketing_throughput" ("business_id", "window_start");

-- Rollback (safe -- no pre-existing code path references these tables):
--
-- DROP TABLE IF EXISTS "business_marketing_throughput";
-- DROP TABLE IF EXISTS "customer_marketing_frequency";
