/**
 * Private chats: end-to-end encrypted 1:1 messages (no translation).
 *
 * Each phone makes its own key pair (X25519); the private key never leaves
 * the phone. The server keeps only:
 *  - each person's PUBLIC key (one active phone at a time),
 *  - messages as ciphertext it cannot read: AES-256-GCM with a fresh key per
 *    message, and that key wrapped (sealed) once for the recipient's phone
 *    and once for the sender's own phone.
 * So NeuraTalk (or anyone with the database) can't read private messages.
 * Trade-offs, said plainly in the app: no translation, phone only (not on
 * the web), and a new phone can't read older private messages.
 */
import { Router, type Request, type Response } from "express";
import crypto from "crypto";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "./db";
import { personalChatThreads, users } from "@shared/schema";
import { requireAuth } from "./role-middleware";
import { isBlocked } from "./blocking";
import { sendPushNotification } from "./firebase-admin";
import { publishPersonalChatEvent } from "./modules/messaging/realtime";
import { publicName } from "./user-display";

const router = Router();
const B64 = /^[A-Za-z0-9+/]+={0,2}$/;

export async function ensurePrivateChatTables(): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "e2e_device_keys" (
      "id" serial PRIMARY KEY,
      "user_id" integer NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
      "public_key" text NOT NULL,
      "created_at" timestamp NOT NULL DEFAULT now(),
      "revoked_at" timestamp
    )`);
  await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS "e2e_device_keys_active" ON "e2e_device_keys" ("user_id") WHERE "revoked_at" IS NULL`);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "private_messages" (
      "id" serial PRIMARY KEY,
      "thread_id" integer NOT NULL REFERENCES "personal_chat_threads"("id") ON DELETE CASCADE,
      "sender_id" integer NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
      "recipient_id" integer NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
      "client_message_id" text,
      "ciphertext" text NOT NULL,
      "nonce" text NOT NULL,
      "keys" jsonb NOT NULL,
      "created_at" timestamp NOT NULL DEFAULT now(),
      "delivered_at" timestamp,
      "read_at" timestamp,
      "deleted_at" timestamp,
      "expires_at" timestamp
    )`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "private_messages_thread" ON "private_messages" ("thread_id", "id")`);
  await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS "private_messages_client" ON "private_messages" ("sender_id", "client_message_id") WHERE "client_message_id" IS NOT NULL`);
}

const rows = <T>(r: unknown): T[] => ((r as { rows?: T[] }).rows ?? []) as T[];
const idOf = (v: unknown) => { const n = Number(v); return Number.isSafeInteger(n) && n > 0 ? n : null; };

/** 32-byte X25519 public key, base64. */
const publicKeySchema = z.string().trim().refine((s) => B64.test(s) && Buffer.from(s, "base64").length === 32, "Invalid key");

type KeyRow = { id: number; user_id: number; public_key: string; created_at: Date };
async function activeKey(userId: number): Promise<KeyRow | null> {
  return rows<KeyRow>(await db.execute(sql`SELECT id, user_id, public_key, created_at FROM e2e_device_keys WHERE user_id = ${userId} AND revoked_at IS NULL`))[0] ?? null;
}

/** Short fingerprint people can compare out loud ("security code"). */
export function safetyNumber(a: string, b: string): string {
  const [x, y] = [a, b].sort();
  const digest = crypto.createHash("sha256").update(Buffer.concat([Buffer.from(x, "base64"), Buffer.from(y, "base64")])).digest();
  const groups: string[] = [];
  for (let i = 0; i < 12; i++) groups.push(String(digest.readUInt16BE(i * 2) % 100000).padStart(5, "0"));
  return groups.join(" ");
}

async function threadFor(threadId: number, userId: number) {
  const [t] = await db.select().from(personalChatThreads).where(eq(personalChatThreads.id, threadId));
  if (!t || (t.participantAUserId !== userId && t.participantBUserId !== userId)) return null;
  return { thread: t, peerId: t.participantAUserId === userId ? t.participantBUserId : t.participantAUserId };
}

// ---------------------------------------------------------------- keys
router.get("/api/e2e/my-key", requireAuth, async (req: Request, res: Response) => {
  const k = await activeKey(req.user!.id);
  res.json({ success: true, key: k ? { id: k.id, publicKey: k.public_key, createdAt: k.created_at } : null });
});

/** This phone's public key. A new key (new phone, reinstall) replaces the old one. */
router.put("/api/e2e/my-key", requireAuth, async (req: Request, res: Response) => {
  const parsed = z.object({ publicKey: publicKeySchema }).safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: "Invalid key." });
  const me = req.user!.id;
  const current = await activeKey(me);
  if (current?.public_key === parsed.data.publicKey) return res.json({ success: true, key: { id: current.id, publicKey: current.public_key } });
  const created = await db.transaction(async (tx) => {
    await tx.execute(sql`UPDATE e2e_device_keys SET revoked_at = now() WHERE user_id = ${me} AND revoked_at IS NULL`);
    return rows<KeyRow>(await tx.execute(sql`INSERT INTO e2e_device_keys (user_id, public_key) VALUES (${me}, ${parsed.data.publicKey}) RETURNING id, user_id, public_key, created_at`))[0];
  });
  res.status(201).json({ success: true, key: { id: created.id, publicKey: created.public_key }, replaced: !!current });
});

/** The other person's public key and the security code, for one chat. */
router.get("/api/personal-chats/:threadId/private/keys", requireAuth, async (req: Request, res: Response) => {
  const me = req.user!.id;
  const threadId = idOf(req.params.threadId);
  const t = threadId ? await threadFor(threadId, me) : null;
  if (!t) return res.status(404).json({ error: "Chat not found." });
  const [mine, theirs] = await Promise.all([activeKey(me), activeKey(t.peerId)]);
  res.json({
    success: true,
    mine: mine ? { id: mine.id, publicKey: mine.public_key } : null,
    peer: theirs ? { id: theirs.id, publicKey: theirs.public_key, createdAt: theirs.created_at } : null,
    safetyNumber: mine && theirs ? safetyNumber(mine.public_key, theirs.public_key) : null,
  });
});

// ---------------------------------------------------------------- messages
const wrappedKey = z.object({
  ephemeralPublicKey: publicKeySchema,
  nonce: z.string().regex(B64).max(40),
  wrapped: z.string().regex(B64).max(200),
});

const sendSchema = z.object({
  ciphertext: z.string().regex(B64).min(4).max(64_000),
  nonce: z.string().regex(B64).max(40),
  // Sealed message key for each phone that may read it: { "<keyId>": {...} }.
  keys: z.record(z.string().regex(/^\d+$/), wrappedKey),
  clientMessageId: z.string().trim().min(1).max(100).optional(),
  expiresInSeconds: z.number().int().min(60).max(7 * 24 * 3600).optional(),
});

router.post("/api/personal-chats/:threadId/private/messages", requireAuth, async (req: Request, res: Response) => {
  const me = req.user!.id;
  const threadId = idOf(req.params.threadId);
  const t = threadId ? await threadFor(threadId, me) : null;
  if (!t) return res.status(404).json({ error: "Chat not found." });
  const parsed = sendSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: "Invalid encrypted message." });
  if (await isBlocked(me, t.peerId)) return res.status(403).json({ error: "You can't message this person.", code: "BLOCKED" });
  const [mine, theirs] = await Promise.all([activeKey(me), activeKey(t.peerId)]);
  if (!mine) return res.status(409).json({ code: "NO_OWN_KEY", error: "Set up private chat on this phone first." });
  if (!theirs) return res.status(409).json({ code: "NO_PEER_KEY", error: "They haven't set up private chat yet." });
  // Must be sealed for exactly the current phones: a stale key means the other person changed phones.
  const ids = Object.keys(parsed.data.keys).map(Number).sort();
  const want = [mine.id, theirs.id].sort();
  if (ids.length !== 2 || ids[0] !== want[0] || ids[1] !== want[1]) {
    return res.status(409).json({ code: "KEYS_CHANGED", error: "Their security code changed. Check it, then send again.", peerKeyId: theirs.id });
  }
  const inserted = rows<{ id: number; created_at: Date }>(await db.execute(sql`
    INSERT INTO private_messages (thread_id, sender_id, recipient_id, client_message_id, ciphertext, nonce, keys, expires_at)
    VALUES (${t.thread.id}, ${me}, ${t.peerId}, ${parsed.data.clientMessageId ?? null}, ${parsed.data.ciphertext}, ${parsed.data.nonce},
            ${JSON.stringify(parsed.data.keys)}::jsonb, ${parsed.data.expiresInSeconds ? sql`now() + ${`${parsed.data.expiresInSeconds} seconds`}::interval` : null})
    ON CONFLICT (sender_id, client_message_id) WHERE client_message_id IS NOT NULL DO NOTHING
    RETURNING id, created_at`))[0];
  if (!inserted) {
    const existing = rows<{ id: number; created_at: Date }>(await db.execute(sql`SELECT id, created_at FROM private_messages WHERE sender_id = ${me} AND client_message_id = ${parsed.data.clientMessageId!}`))[0];
    return res.json({ success: true, message: { id: existing?.id, createdAt: existing?.created_at } });
  }
  publishPersonalChatEvent([me, t.peerId], { type: "private_message", threadId: t.thread.id, messageId: inserted.id, senderUserId: me });
  const [sender] = await db.select({ displayName: users.displayName, username: users.username }).from(users).where(eq(users.id, me));
  // The notification never contains the text (the server can't read it).
  sendPushNotification(t.peerId, {
    title: publicName(sender as any, "NeuraTalk"),
    body: "🔒 Private message",
    data: { type: "private_message", threadId: String(t.thread.id) },
  }).catch(() => {});
  res.status(201).json({ success: true, message: { id: inserted.id, createdAt: inserted.created_at } });
});

router.get("/api/personal-chats/:threadId/private/messages", requireAuth, async (req: Request, res: Response) => {
  const me = req.user!.id;
  const threadId = idOf(req.params.threadId);
  const t = threadId ? await threadFor(threadId, me) : null;
  if (!t) return res.status(404).json({ error: "Chat not found." });
  const after = idOf(req.query.after) ?? 0;
  const list = rows<any>(await db.execute(sql`
    SELECT id, sender_id AS "senderId", ciphertext, nonce, keys, created_at AS "createdAt", delivered_at AS "deliveredAt", read_at AS "readAt",
           deleted_at IS NOT NULL AS deleted, expires_at AS "expiresAt"
    FROM private_messages
    WHERE thread_id = ${t.thread.id} AND id > ${after} AND (expires_at IS NULL OR expires_at > now())
    ORDER BY id ASC LIMIT 500`));
  // Opening the chat on the phone = delivered.
  await db.execute(sql`UPDATE private_messages SET delivered_at = now() WHERE thread_id = ${t.thread.id} AND recipient_id = ${me} AND delivered_at IS NULL`);
  res.json({
    success: true,
    messages: list.map((m) => (m.deleted
      ? { id: m.id, senderId: m.senderId, deleted: true, createdAt: m.createdAt }
      : { ...m, isOwn: m.senderId === me })),
  });
});

router.post("/api/personal-chats/:threadId/private/read", requireAuth, async (req: Request, res: Response) => {
  const me = req.user!.id;
  const threadId = idOf(req.params.threadId);
  const t = threadId ? await threadFor(threadId, me) : null;
  if (!t) return res.status(404).json({ error: "Chat not found." });
  const r = await db.execute(sql`UPDATE private_messages SET read_at = now(), delivered_at = coalesce(delivered_at, now()) WHERE thread_id = ${t.thread.id} AND recipient_id = ${me} AND read_at IS NULL`);
  if (((r as any).rowCount ?? 0) > 0) publishPersonalChatEvent([t.peerId], { type: "private_read", threadId: t.thread.id });
  res.json({ success: true });
});

/** Delete for everyone: the ciphertext is wiped, not just hidden. */
router.delete("/api/personal-chats/:threadId/private/messages/:id", requireAuth, async (req: Request, res: Response) => {
  const me = req.user!.id;
  const id = idOf(req.params.id);
  const threadId = idOf(req.params.threadId);
  const r = rows(await db.execute(sql`
    UPDATE private_messages SET deleted_at = now(), ciphertext = '', nonce = '', keys = '{}'::jsonb
    WHERE id = ${id} AND thread_id = ${threadId} AND sender_id = ${me} AND deleted_at IS NULL RETURNING recipient_id`));
  if (!r.length) return res.status(404).json({ error: "Message not found." });
  res.json({ success: true });
});

/** Remove expired private messages for good (disappearing timer). */
export async function deleteExpiredPrivateMessages(): Promise<number> {
  const r = await db.execute(sql`DELETE FROM private_messages WHERE expires_at IS NOT NULL AND expires_at < now()`);
  return Number((r as any).rowCount ?? 0);
}

export default router;
