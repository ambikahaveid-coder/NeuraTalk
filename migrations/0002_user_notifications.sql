-- Migration: user_notifications table
-- Run: psql $DATABASE_URL < this_file  OR via drizzle-kit push

CREATE TABLE IF NOT EXISTS "user_notifications" (
  "id" serial PRIMARY KEY NOT NULL,
  "user_id" integer NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "type" text NOT NULL,
  "title" text NOT NULL,
  "body" text NOT NULL,
  "data" jsonb DEFAULT '{}',
  "is_read" boolean NOT NULL DEFAULT false,
  "read_at" timestamp,
  "delivered_via_push" boolean DEFAULT false,
  "created_at" timestamp DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "user_notifications_user_idx" ON "user_notifications" ("user_id");
CREATE INDEX IF NOT EXISTS "user_notifications_type_idx" ON "user_notifications" ("type");
CREATE INDEX IF NOT EXISTS "user_notifications_read_idx" ON "user_notifications" ("user_id", "is_read");
CREATE INDEX IF NOT EXISTS "user_notifications_created_idx" ON "user_notifications" ("created_at");
