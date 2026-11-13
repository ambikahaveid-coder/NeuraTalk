/**
 * WhatsApp-parity extras for personal chats:
 *
 * 1. Broadcast lists: one message goes to many people, each as a normal
 *    1:1 message (replies come back to you privately). To stop spam, it only
 *    reaches people who have written to you before or saved you as a contact.
 * 2. Chat wallpapers: a default wallpaper plus one per chat, the same on
 *    every device you use.
 */
import { Router, type Request, type Response } from "express";
import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "./db";
import { personalChatMessages, personalChatThreads, userContacts, users } from "@shared/schema";
import { normalizePhoneNumber } from "@shared/phone";
import { requireAuth } from "./role-middleware";
import { isBlocked } from "./blocking";
import { openPersonalThread, sendPersonalMessage } from "./personal-chat-routes";

const router = Router();
export const MAX_LIST_MEMBERS = 256;
export const MAX_LISTS = 50;
export const MAX_BROADCASTS_PER_HOUR = 20;

export async function ensureChatParityTables(): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "broadcast_lists" (
      "id" serial PRIMARY KEY NOT NULL,
      "owner_id" integer NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
      "name" text NOT NULL,
      "created_at" timestamp NOT NULL DEFAULT now(),
      "updated_at" timestamp NOT NULL DEFAULT now()
    )`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "broadcast_lists_owner" ON "broadcast_lists" ("owner_id")`);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "broadcast_list_members" (
      "list_id" integer NOT NULL REFERENCES "broadcast_lists"("id") ON DELETE CASCADE,
      "user_id" integer NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
      "added_at" timestamp NOT NULL DEFAULT now(),
      PRIMARY KEY ("list_id", "user_id")
    )`);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "broadcast_sends" (
      "id" serial PRIMARY KEY NOT NULL,
      "list_id" integer REFERENCES "broadcast_lists"("id") ON DELETE CASCADE,
      "owner_id" integer NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
      "preview" text NOT NULL,
      "sent" integer NOT NULL DEFAULT 0,
      "skipped" jsonb NOT NULL DEFAULT '[]'::jsonb,
      "created_at" timestamp NOT NULL DEFAULT now()
    )`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "broadcast_sends_owner_time" ON "broadcast_sends" ("owner_id", "created_at")`);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "chat_wallpapers" (
      "user_id" integer NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
      "chat_key" text NOT NULL,
      "kind" text NOT NULL,
      "value" text NOT NULL,
      "dim" integer NOT NULL DEFAULT 0,
      "updated_at" timestamp NOT NULL DEFAULT now(),
      PRIMARY KEY ("user_id", "chat_key")
    )`);
}

const idOf = (v: unknown) => {
  const n = Number(v);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
};

// ---------------------------------------------------------------- broadcast lists

/** May `ownerId`'s broadcast reach `recipientId`? Only if the recipient has
 * written to them before, or saved them as a contact. */
export async function mayReceiveBroadcast(ownerId: number, recipientId: number): Promise<boolean> {
  const a = Math.min(ownerId, recipientId);
  const b = Math.max(ownerId, recipientId);
  const wrote = await db.select({ id: personalChatMessages.id }).from(personalChatMessages)
    .innerJoin(personalChatThreads, eq(personalChatThreads.id, personalChatMessages.threadId))
    .where(and(
      eq(personalChatThreads.participantAUserId, a), eq(personalChatThreads.participantBUserId, b),
      eq(personalChatMessages.senderUserId, recipientId),
    )).limit(1);
  if (wrote.length) return true;
  const [owner] = await db.select({ username: users.username, email: users.email, phone: users.phone }).from(users).where(eq(users.id, ownerId));
  if (!owner) return false;
  const phone = owner.phone ? normalizePhoneNumber(owner.phone) : "";
  const contacts = await db.select({ identifier: userContacts.identifier }).from(userContacts).where(eq(userContacts.userId, recipientId));
  return contacts.some((c) => {
    const id = String(c.identifier || "").trim();
    return (!!owner.username && id === owner.username) || (!!owner.email && id === owner.email) || (!!phone && normalizePhoneNumber(id) === phone);
  });
}

async function ownList(listId: number, ownerId: number) {
  const r = await db.execute(sql`SELECT * FROM broadcast_lists WHERE id = ${listId} AND owner_id = ${ownerId}`);
  return (r.rows[0] as any) ?? null;
}

async function membersOf(listIds: number[]) {
  if (!listIds.length) return [] as Array<{ listId: number; id: number; name: string; avatarUrl: string | null }>;
  const r = await db.execute(sql`
    SELECT m.list_id AS "listId", u.id, coalesce(nullif(trim(u.display_name), ''), u.username, u.phone) AS name, u.avatar_url AS "avatarUrl"
    FROM broadcast_list_members m JOIN users u ON u.id = m.user_id
    WHERE m.list_id IN (${sql.join(listIds.map((id) => sql`${id}`), sql`, `)})
    ORDER BY name`);
  return r.rows as Array<{ listId: number; id: number; name: string; avatarUrl: string | null }>;
}

const listInput = z.object({
  name: z.string().trim().min(1, "Give the list a name.").max(60),
  memberIds: z.array(z.number().int().positive()).min(2, "Pick at least 2 people.").max(MAX_LIST_MEMBERS, `A list can have up to ${MAX_LIST_MEMBERS} people.`),
});

async function cleanMembers(ownerId: number, ids: number[]): Promise<number[] | string> {
  const unique = Array.from(new Set(ids)).filter((id) => id !== ownerId);
  if (unique.length < 2) return "Pick at least 2 people.";
  const found = await db.select({ id: users.id }).from(users).where(inArray(users.id, unique));
  if (found.length !== unique.length) return "Some of these people aren't on NeuraTalk.";
  return unique;
}

async function setMembers(listId: number, memberIds: number[]) {
  await db.transaction(async (tx) => {
    await tx.execute(sql`DELETE FROM broadcast_list_members WHERE list_id = ${listId}`);
    await tx.execute(sql`
      INSERT INTO broadcast_list_members (list_id, user_id)
      SELECT ${listId}, x FROM unnest(${`{${memberIds.join(",")}}`}::int[]) AS x`);
    await tx.execute(sql`UPDATE broadcast_lists SET updated_at = now() WHERE id = ${listId}`);
  });
}

router.get("/api/broadcast-lists", requireAuth, async (req: Request, res: Response) => {
  const r = await db.execute(sql`SELECT id, name, created_at AS "createdAt", updated_at AS "updatedAt" FROM broadcast_lists WHERE owner_id = ${req.user!.id} ORDER BY updated_at DESC`);
  const lists = r.rows as Array<{ id: number; name: string }>;
  const members = await membersOf(lists.map((l) => l.id));
  res.json({
    success: true,
    lists: lists.map((l) => ({ ...l, members: members.filter((m) => m.listId === l.id).map(({ listId, ...m }) => m) })),
  });
});

router.post("/api/broadcast-lists", requireAuth, async (req: Request, res: Response) => {
  const parsed = listInput.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Check the details." });
  const ownerId = req.user!.id;
  const [{ n }] = (await db.execute(sql`SELECT count(*)::int AS n FROM broadcast_lists WHERE owner_id = ${ownerId}`)).rows as Array<{ n: number }>;
  if (n >= MAX_LISTS) return res.status(400).json({ error: `You can have up to ${MAX_LISTS} broadcast lists.` });
  const members = await cleanMembers(ownerId, parsed.data.memberIds);
  if (typeof members === "string") return res.status(400).json({ error: members });
  const created = await db.execute(sql`INSERT INTO broadcast_lists (owner_id, name) VALUES (${ownerId}, ${parsed.data.name}) RETURNING id, name`);
  const list = created.rows[0] as { id: number; name: string };
  await setMembers(list.id, members);
  res.status(201).json({ success: true, list: { ...list, members: (await membersOf([list.id])).map(({ listId, ...m }) => m) } });
});

router.get("/api/broadcast-lists/:id", requireAuth, async (req: Request, res: Response) => {
  const id = idOf(req.params.id);
  const list = id ? await ownList(id, req.user!.id) : null;
  if (!list) return res.status(404).json({ error: "Broadcast list not found." });
  const sends = await db.execute(sql`SELECT id, preview, sent, skipped, created_at AS "createdAt" FROM broadcast_sends WHERE list_id = ${list.id} ORDER BY created_at DESC LIMIT 20`);
  res.json({
    success: true,
    list: { id: list.id, name: list.name, members: (await membersOf([list.id])).map(({ listId, ...m }) => m) },
    sends: sends.rows,
  });
});

router.put("/api/broadcast-lists/:id", requireAuth, async (req: Request, res: Response) => {
  const id = idOf(req.params.id);
  const list = id ? await ownList(id, req.user!.id) : null;
  if (!list) return res.status(404).json({ error: "Broadcast list not found." });
  const parsed = listInput.partial().safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Check the details." });
  if (parsed.data.memberIds) {
    const members = await cleanMembers(req.user!.id, parsed.data.memberIds);
    if (typeof members === "string") return res.status(400).json({ error: members });
    await setMembers(list.id, members);
  }
  if (parsed.data.name) await db.execute(sql`UPDATE broadcast_lists SET name = ${parsed.data.name}, updated_at = now() WHERE id = ${list.id}`);
  res.json({ success: true });
});

router.delete("/api/broadcast-lists/:id", requireAuth, async (req: Request, res: Response) => {
  const id = idOf(req.params.id);
  const list = id ? await ownList(id, req.user!.id) : null;
  if (!list) return res.status(404).json({ error: "Broadcast list not found." });
  await db.execute(sql`DELETE FROM broadcast_lists WHERE id = ${list.id}`);
  res.json({ success: true });
});

const sendInput = z.object({
  content: z.string().trim().min(1).max(4000),
  messageType: z.enum(["text", "attachment", "file", "location", "voice_note"]).optional(),
  attachmentUrl: z.string().trim().min(1).max(2000).optional(),
  attachmentTitle: z.string().trim().min(1).max(240).optional(),
  attachmentSize: z.number().int().positive().optional(),
  attachmentMime: z.string().trim().min(3).max(120).optional(),
  clientMessageId: z.string().trim().min(1).max(100).optional(),
});

/** Send one message to everyone on the list, each in their own 1:1 chat. */
router.post("/api/broadcast-lists/:id/send", requireAuth, async (req: Request, res: Response) => {
  const ownerId = req.user!.id;
  const id = idOf(req.params.id);
  const list = id ? await ownList(id, ownerId) : null;
  if (!list) return res.status(404).json({ error: "Broadcast list not found." });
  const parsed = sendInput.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Type a message." });
  const [{ n }] = (await db.execute(sql`SELECT count(*)::int AS n FROM broadcast_sends WHERE owner_id = ${ownerId} AND created_at > now() - interval '1 hour'`)).rows as Array<{ n: number }>;
  if (n >= MAX_BROADCASTS_PER_HOUR) return res.status(429).json({ error: `You can send up to ${MAX_BROADCASTS_PER_HOUR} broadcasts an hour. Try again later.` });

  const members = await membersOf([list.id]);
  const skipped: Array<{ userId: number; name: string; reason: string }> = [];
  let sent = 0;
  const { clientMessageId, ...body } = parsed.data;
  for (const m of members) {
    if (await isBlocked(ownerId, m.id)) { skipped.push({ userId: m.id, name: m.name, reason: "blocked" }); continue; }
    if (!(await mayReceiveBroadcast(ownerId, m.id))) { skipped.push({ userId: m.id, name: m.name, reason: "hasnt_messaged_you" }); continue; }
    const thread = await openPersonalThread(req.user as any, m.id);
    const threadId = thread.body?.thread?.id as number | undefined;
    if (!threadId) { skipped.push({ userId: m.id, name: m.name, reason: "failed" }); continue; }
    const out = await sendPersonalMessage(req.user as any, threadId, {
      ...body,
      // The same send retried keeps one message per person.
      ...(clientMessageId ? { clientMessageId: `${clientMessageId}:${m.id}`.slice(0, 120) } : {}),
    }, { broadcast: true, broadcastListId: list.id });
    if (out.status >= 200 && out.status < 300) sent++;
    else skipped.push({ userId: m.id, name: m.name, reason: out.status === 403 ? "blocked" : "failed" });
  }
  const preview = body.messageType && body.messageType !== "text" ? `[${body.messageType}] ${body.content}` : body.content;
  await db.execute(sql`
    INSERT INTO broadcast_sends (list_id, owner_id, preview, sent, skipped)
    VALUES (${list.id}, ${ownerId}, ${preview.slice(0, 200)}, ${sent}, ${JSON.stringify(skipped)}::jsonb)`);
  res.json({ success: true, sent, skipped, total: members.length });
});

// ---------------------------------------------------------------- wallpapers

export const WALLPAPER_PRESETS = ["doodle", "sky", "mint", "sand", "rose", "night", "lavender", "leaf"] as const;

const wallpaperInput = z.object({
  kind: z.enum(["preset", "color", "none"]),
  value: z.string().trim().max(40).default(""),
  dim: z.number().int().min(0).max(80).default(0),
}).superRefine((v, ctx) => {
  if (v.kind === "preset" && !(WALLPAPER_PRESETS as readonly string[]).includes(v.value)) ctx.addIssue({ code: "custom", message: "Pick one of the wallpapers." });
  if (v.kind === "color" && !/^#[0-9a-fA-F]{6}$/.test(v.value)) ctx.addIssue({ code: "custom", message: "Pick a colour." });
});

/** "default", "personal:<threadId>" or "group:<groupId>", and only chats you're in. */
async function validChatKey(userId: number, key: string): Promise<boolean> {
  if (key === "default") return true;
  const m = key.match(/^(personal|group):(\d{1,10})$/);
  if (!m) return false;
  const id = Number(m[2]);
  if (m[1] === "personal") {
    const r = await db.execute(sql`SELECT 1 FROM personal_chat_threads WHERE id = ${id} AND (participant_a_user_id = ${userId} OR participant_b_user_id = ${userId})`);
    return r.rows.length > 0;
  }
  const r = await db.execute(sql`SELECT 1 FROM group_chat_members WHERE group_chat_id = ${id} AND user_id = ${userId}`);
  return r.rows.length > 0;
}

router.get("/api/chat-wallpapers", requireAuth, async (req: Request, res: Response) => {
  const r = await db.execute(sql`SELECT chat_key AS "chatKey", kind, value, dim FROM chat_wallpapers WHERE user_id = ${req.user!.id}`);
  res.json({ success: true, presets: WALLPAPER_PRESETS, wallpapers: r.rows });
});

router.put("/api/chat-wallpapers/:chatKey", requireAuth, async (req: Request, res: Response) => {
  const key = String(req.params.chatKey);
  if (!(await validChatKey(req.user!.id, key))) return res.status(404).json({ error: "Chat not found." });
  const parsed = wallpaperInput.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Pick a wallpaper." });
  const w = parsed.data;
  await db.execute(sql`
    INSERT INTO chat_wallpapers (user_id, chat_key, kind, value, dim) VALUES (${req.user!.id}, ${key}, ${w.kind}, ${w.value}, ${w.dim})
    ON CONFLICT (user_id, chat_key) DO UPDATE SET kind = EXCLUDED.kind, value = EXCLUDED.value, dim = EXCLUDED.dim, updated_at = now()`);
  res.json({ success: true, wallpaper: { chatKey: key, ...w } });
});

/** Back to the default (for one chat) or to no wallpaper (for "default"). */
router.delete("/api/chat-wallpapers/:chatKey", requireAuth, async (req: Request, res: Response) => {
  await db.execute(sql`DELETE FROM chat_wallpapers WHERE user_id = ${req.user!.id} AND chat_key = ${String(req.params.chatKey)}`);
  res.json({ success: true });
});

export default router;
