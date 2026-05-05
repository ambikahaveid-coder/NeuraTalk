-- Migration: agent_skills + org_did_numbers tables
-- Run: npx drizzle-kit push  OR  psql $DATABASE_URL < this_file

CREATE TABLE IF NOT EXISTS "agent_skills" (
  "id" serial PRIMARY KEY NOT NULL,
  "user_id" integer NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "skills" jsonb NOT NULL DEFAULT '[]',
  "max_concurrent_calls" integer NOT NULL DEFAULT 3,
  "is_available" boolean NOT NULL DEFAULT true,
  "priority" integer NOT NULL DEFAULT 1,
  "created_at" timestamp DEFAULT now(),
  "updated_at" timestamp DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "agent_skills_org_idx" ON "agent_skills" ("organization_id");
CREATE INDEX IF NOT EXISTS "agent_skills_user_idx" ON "agent_skills" ("user_id");
CREATE INDEX IF NOT EXISTS "agent_skills_available_idx" ON "agent_skills" ("is_available");

CREATE TABLE IF NOT EXISTS "org_did_numbers" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "phone_number" text NOT NULL,
  "label" text,
  "type" text NOT NULL DEFAULT 'inbound',
  "provider" text NOT NULL DEFAULT 'msg91',
  "is_active" boolean NOT NULL DEFAULT true,
  "ivr_enabled" boolean NOT NULL DEFAULT false,
  "ivr_config" jsonb DEFAULT '{}',
  "created_at" timestamp DEFAULT now(),
  "updated_at" timestamp DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "org_did_numbers_org_idx" ON "org_did_numbers" ("organization_id");
CREATE INDEX IF NOT EXISTS "org_did_numbers_phone_idx" ON "org_did_numbers" ("phone_number");
