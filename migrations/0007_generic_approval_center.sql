-- Migration: generic approval center (Phase 3, 2026-08-24)
-- See docs/neura-ecosystem/28_GENERIC_APPROVAL_CENTER_IMPLEMENTATION.md
-- Run: psql $DATABASE_URL < this_file  OR via drizzle-kit push
--
-- Purely additive: 1 new table. No ALTER TABLE against templates/
-- template_versions or anything else -- template_versions.status remains
-- the resource's own state, unchanged in shape (the Phase 2 direct
-- submit/approve/reject ROUTES are removed at the application layer in
-- this phase, but no column was added, removed, or altered on that table).
--
-- NOT APPLIED to any database as part of this commit -- Phase 3 approval
-- was implementation + local verification only, no production migration.

CREATE TABLE IF NOT EXISTS "approval_requests" (
  "id" serial PRIMARY KEY NOT NULL,
  "business_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "resource_type" text NOT NULL,
  "resource_id" integer NOT NULL,
  "requested_by" integer NOT NULL REFERENCES "users"("id"),
  "status" text NOT NULL DEFAULT 'pending',
  "decided_by" integer REFERENCES "users"("id"),
  "decided_at" timestamp,
  "reason" text,
  "created_at" timestamp DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "approval_requests_business_idx" ON "approval_requests" ("business_id");
CREATE INDEX IF NOT EXISTS "approval_requests_resource_idx" ON "approval_requests" ("resource_type", "resource_id");
CREATE INDEX IF NOT EXISTS "approval_requests_status_idx" ON "approval_requests" ("status");
CREATE UNIQUE INDEX IF NOT EXISTS "approval_requests_one_pending_per_resource_idx"
  ON "approval_requests" ("resource_type", "resource_id")
  WHERE "status" = 'pending';

-- Rollback (safe -- no pre-existing code path references this table):
--
-- DROP TABLE IF EXISTS "approval_requests";
