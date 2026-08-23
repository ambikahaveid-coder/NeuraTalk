-- Migration: business message template engine (Phase 2, 2026-08-24)
-- See docs/neura-ecosystem/27_BUSINESS_TEMPLATE_ENGINE_IMPLEMENTATION.md
-- Run: psql $DATABASE_URL < this_file  OR via drizzle-kit push
--
-- Purely additive: 2 new tables. No ALTER TABLE against any existing table
-- (organizations, canonical messaging tables, AI/personal/group chat, etc.)
--
-- NOT APPLIED to any database as part of this commit -- Phase 2 approval
-- was implementation + local verification only, no production migration.

CREATE TABLE IF NOT EXISTS "templates" (
  "id" serial PRIMARY KEY NOT NULL,
  "business_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "category" text NOT NULL,
  "created_by" integer NOT NULL REFERENCES "users"("id"),
  "created_at" timestamp DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "templates_business_name_idx" ON "templates" ("business_id", "name");
CREATE INDEX IF NOT EXISTS "templates_business_idx" ON "templates" ("business_id");

CREATE TABLE IF NOT EXISTS "template_versions" (
  "id" serial PRIMARY KEY NOT NULL,
  "template_id" integer NOT NULL REFERENCES "templates"("id") ON DELETE CASCADE,
  "language" text NOT NULL DEFAULT 'en',
  "version_number" integer NOT NULL,
  "status" text NOT NULL DEFAULT 'draft',
  "title" text,
  "content" text NOT NULL,
  "variables" jsonb DEFAULT '[]',
  "media_type" text,
  "media_url" text,
  "metadata" jsonb DEFAULT '{}',
  "created_by" integer NOT NULL REFERENCES "users"("id"),
  "created_at" timestamp DEFAULT now(),
  "submitted_by" integer REFERENCES "users"("id"),
  "submitted_at" timestamp,
  "decided_by" integer REFERENCES "users"("id"),
  "decided_at" timestamp,
  "rejection_reason" text,
  "archived_by" integer REFERENCES "users"("id"),
  "archived_at" timestamp
);
CREATE UNIQUE INDEX IF NOT EXISTS "template_versions_template_lang_version_idx" ON "template_versions" ("template_id", "language", "version_number");
CREATE INDEX IF NOT EXISTS "template_versions_template_lang_idx" ON "template_versions" ("template_id", "language");
CREATE INDEX IF NOT EXISTS "template_versions_status_idx" ON "template_versions" ("status");

-- Rollback (safe -- no pre-existing code path references these tables):
--
-- DROP TABLE IF EXISTS "template_versions";
-- DROP TABLE IF EXISTS "templates";
