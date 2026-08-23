-- Migration: canonical messaging foundation (Phase 0, 2026-08-23)
-- See docs/neura-ecosystem/24_CANONICAL_MESSAGING_FOUNDATION.md
-- Run: psql $DATABASE_URL < this_file  OR via drizzle-kit push
--
-- Purely additive: 10 new tables. No ALTER TABLE, no rename, no delete,
-- no data migration against any existing table (conversations, messages,
-- personalChatThreads, personalChatMessages, groupChats, groupChatMembers,
-- groupChatMessages, voiceMemos are all untouched).
--
-- NOT APPLIED to any database as part of this commit -- Phase 0 approval
-- was implementation + local verification only, no production migration.

CREATE TABLE IF NOT EXISTS "messaging_conversations" (
  "id" serial PRIMARY KEY NOT NULL,
  "type" text NOT NULL,
  "organization_id" integer REFERENCES "organizations"("id") ON DELETE CASCADE,
  "metadata" jsonb DEFAULT '{}',
  "is_archived" boolean DEFAULT false,
  "created_at" timestamp DEFAULT now(),
  "updated_at" timestamp DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "messaging_conversations_org_idx" ON "messaging_conversations" ("organization_id");

CREATE TABLE IF NOT EXISTS "business_conversations" (
  "id" serial PRIMARY KEY NOT NULL,
  "conversation_id" integer NOT NULL UNIQUE REFERENCES "messaging_conversations"("id") ON DELETE CASCADE,
  "business_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "customer_id" integer, -- forward reference, no FK yet (Phase 4)
  "status" text NOT NULL DEFAULT 'open',
  "assigned_to_user_id" integer REFERENCES "users"("id"),
  "created_at" timestamp DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "business_conversations_business_idx" ON "business_conversations" ("business_id");
CREATE INDEX IF NOT EXISTS "business_conversations_customer_idx" ON "business_conversations" ("customer_id");

CREATE TABLE IF NOT EXISTS "messaging_participants" (
  "id" serial PRIMARY KEY NOT NULL,
  "conversation_id" integer NOT NULL REFERENCES "messaging_conversations"("id") ON DELETE CASCADE,
  "participant_type" text NOT NULL,
  "participant_id" integer NOT NULL, -- polymorphic, no DB FK (see doc 24 section 13)
  "role" text,
  "joined_at" timestamp DEFAULT now(),
  "left_at" timestamp
);
CREATE INDEX IF NOT EXISTS "messaging_participants_conversation_idx" ON "messaging_participants" ("conversation_id");
CREATE INDEX IF NOT EXISTS "messaging_participants_type_id_idx" ON "messaging_participants" ("participant_type", "participant_id");

CREATE TABLE IF NOT EXISTS "messaging_messages" (
  "id" serial PRIMARY KEY NOT NULL,
  "conversation_id" integer NOT NULL REFERENCES "messaging_conversations"("id") ON DELETE CASCADE,
  "sender_participant_id" integer NOT NULL REFERENCES "messaging_participants"("id"),
  "message_type" text NOT NULL DEFAULT 'text',
  "category" text NOT NULL DEFAULT 'conversational',
  "content" text NOT NULL,
  "template_id" integer, -- forward reference, no FK yet (Phase 2)
  "reply_to_message_id" integer,
  "created_at" timestamp DEFAULT now(),
  "edited_at" timestamp,
  "deleted_at" timestamp
);
CREATE INDEX IF NOT EXISTS "messaging_messages_conversation_created_idx" ON "messaging_messages" ("conversation_id", "created_at");
CREATE INDEX IF NOT EXISTS "messaging_messages_category_idx" ON "messaging_messages" ("category");

CREATE TABLE IF NOT EXISTS "messaging_deliveries" (
  "id" serial PRIMARY KEY NOT NULL,
  "message_id" integer NOT NULL REFERENCES "messaging_messages"("id") ON DELETE CASCADE,
  "participant_id" integer NOT NULL REFERENCES "messaging_participants"("id"),
  "status" text NOT NULL DEFAULT 'queued',
  "status_at" timestamp DEFAULT now(),
  "failure_reason" text,
  "provider_ref" text
);
CREATE INDEX IF NOT EXISTS "messaging_deliveries_message_idx" ON "messaging_deliveries" ("message_id");
CREATE INDEX IF NOT EXISTS "messaging_deliveries_participant_status_idx" ON "messaging_deliveries" ("participant_id", "status");

CREATE TABLE IF NOT EXISTS "messaging_attachments" (
  "id" serial PRIMARY KEY NOT NULL,
  "message_id" integer NOT NULL REFERENCES "messaging_messages"("id") ON DELETE CASCADE,
  "attachment_type" text NOT NULL,
  "url" text NOT NULL,
  "mime_type" text,
  "size_bytes" integer,
  "duration_seconds" integer
);
CREATE INDEX IF NOT EXISTS "messaging_attachments_message_idx" ON "messaging_attachments" ("message_id");

CREATE TABLE IF NOT EXISTS "messaging_translations" (
  "id" serial PRIMARY KEY NOT NULL,
  "message_id" integer NOT NULL REFERENCES "messaging_messages"("id") ON DELETE CASCADE,
  "language" text NOT NULL,
  "translated_content" text NOT NULL,
  "translated_at" timestamp DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "messaging_translations_message_idx" ON "messaging_translations" ("message_id");

CREATE TABLE IF NOT EXISTS "messaging_read_states" (
  "id" serial PRIMARY KEY NOT NULL,
  "conversation_id" integer NOT NULL REFERENCES "messaging_conversations"("id") ON DELETE CASCADE,
  "participant_id" integer NOT NULL REFERENCES "messaging_participants"("id"),
  "last_read_message_id" integer REFERENCES "messaging_messages"("id"),
  "last_read_at" timestamp
);
CREATE UNIQUE INDEX IF NOT EXISTS "messaging_read_states_conv_participant_idx" ON "messaging_read_states" ("conversation_id", "participant_id");

CREATE TABLE IF NOT EXISTS "messaging_reactions" (
  "id" serial PRIMARY KEY NOT NULL,
  "message_id" integer NOT NULL REFERENCES "messaging_messages"("id") ON DELETE CASCADE,
  "participant_id" integer NOT NULL REFERENCES "messaging_participants"("id"),
  "reaction" text NOT NULL,
  "created_at" timestamp DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "messaging_reactions_message_participant_idx" ON "messaging_reactions" ("message_id", "participant_id");

CREATE TABLE IF NOT EXISTS "messaging_events" (
  "id" serial PRIMARY KEY NOT NULL,
  "conversation_id" integer REFERENCES "messaging_conversations"("id") ON DELETE CASCADE,
  "message_id" integer REFERENCES "messaging_messages"("id") ON DELETE CASCADE,
  "event_type" text NOT NULL,
  "payload" jsonb DEFAULT '{}',
  "created_at" timestamp DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "messaging_events_conversation_created_idx" ON "messaging_events" ("conversation_id", "created_at");
CREATE INDEX IF NOT EXISTS "messaging_events_message_idx" ON "messaging_events" ("message_id");

-- Rollback (drop in reverse dependency order):
--
-- DROP TABLE IF EXISTS "messaging_events";
-- DROP TABLE IF EXISTS "messaging_reactions";
-- DROP TABLE IF EXISTS "messaging_read_states";
-- DROP TABLE IF EXISTS "messaging_translations";
-- DROP TABLE IF EXISTS "messaging_attachments";
-- DROP TABLE IF EXISTS "messaging_deliveries";
-- DROP TABLE IF EXISTS "messaging_messages";
-- DROP TABLE IF EXISTS "messaging_participants";
-- DROP TABLE IF EXISTS "business_conversations";
-- DROP TABLE IF EXISTS "messaging_conversations";
