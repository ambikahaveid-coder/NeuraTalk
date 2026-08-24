-- Migration: business OTP / authentication messaging foundation
-- (Phase 6, 2026-08-24)
-- See docs/neura-ecosystem/31_BUSINESS_OTP_AUTHENTICATION_IMPLEMENTATION.md
-- Run: psql $DATABASE_URL < this_file  OR via drizzle-kit push
--
-- Additive: 2 new tables (business_otp_challenges, business_otp_deliveries).
-- Does NOT touch the platform's own login-OTP table (otp_challenges) or
-- any canonical-messaging/customer/template/approval/campaign table --
-- business_otp_challenges REFERENCES organizations/customers/users/
-- template_versions/messaging_messages, but no column is added, removed,
-- or altered on any of those.
--
-- NOT APPLIED to any database as part of this commit -- Phase 6 was
-- implementation + local mock-based verification only, no production
-- migration, per the standing no-local-DB constraint carried from
-- Phases 0-5.

CREATE TABLE IF NOT EXISTS "business_otp_challenges" (
  "id" serial PRIMARY KEY NOT NULL,
  "business_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "customer_id" integer NOT NULL REFERENCES "customers"("id") ON DELETE CASCADE,
  "destination" text NOT NULL,
  "channel" text NOT NULL,
  "purpose" text NOT NULL,
  "code_hash" text NOT NULL,
  "status" text NOT NULL DEFAULT 'pending',
  "attempts" integer NOT NULL DEFAULT 0,
  "max_attempts" integer NOT NULL DEFAULT 3,
  "resend_count" integer NOT NULL DEFAULT 0,
  "template_version_id" integer REFERENCES "template_versions"("id"),
  "message_id" integer REFERENCES "messaging_messages"("id"),
  "supersedes_challenge_id" integer, -- self-referential, no FK constraint (avoids a circular definition), app-layer validated only
  "metadata" jsonb DEFAULT '{}',
  "created_by" integer NOT NULL REFERENCES "users"("id"),
  "created_at" timestamp DEFAULT now(),
  "expires_at" timestamp NOT NULL,
  "verified_at" timestamp,
  "failed_at" timestamp,
  "superseded_at" timestamp
);
CREATE INDEX IF NOT EXISTS "business_otp_challenges_business_idx" ON "business_otp_challenges" ("business_id");
CREATE INDEX IF NOT EXISTS "business_otp_challenges_customer_idx" ON "business_otp_challenges" ("customer_id");
CREATE INDEX IF NOT EXISTS "business_otp_challenges_expires_idx" ON "business_otp_challenges" ("expires_at");
CREATE UNIQUE INDEX IF NOT EXISTS "business_otp_challenges_one_pending_idx"
  ON "business_otp_challenges" ("business_id", "customer_id", "purpose")
  WHERE "status" = 'pending';

CREATE TABLE IF NOT EXISTS "business_otp_deliveries" (
  "id" serial PRIMARY KEY NOT NULL,
  "challenge_id" integer NOT NULL REFERENCES "business_otp_challenges"("id") ON DELETE CASCADE UNIQUE,
  "channel" text NOT NULL,
  "destination" text NOT NULL,
  "status" text NOT NULL DEFAULT 'queued',
  "provider_ref" text,
  "failure_reason" text,
  "created_at" timestamp DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "business_otp_deliveries_challenge_idx" ON "business_otp_deliveries" ("challenge_id");

-- Rollback (safe -- no pre-existing code path references these tables):
--
-- DROP TABLE IF EXISTS "business_otp_deliveries";
-- DROP TABLE IF EXISTS "business_otp_challenges";
