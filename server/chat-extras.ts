/**
 * WhatsApp-style chat extras shared by 1:1 and group chats:
 *  - starred messages            (starred_messages table)
 *  - search inside a chat
 *  - polls                       (message metadata.poll + metadata.pollVotes)
 *  - contact cards               (message metadata.contact)
 *  - view-once photos/videos     (metadata.viewOnce; the file path never leaves the server)
 *  - privacy settings            (user_privacy_settings: last seen/online, read receipts)
 */
import { Router, type Request, type Response } from "express";
import { and, desc, eq, ilike, inArray, isNull, or, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "./db";
import {
  groupChatMembers, groupChatMessages, groupChats, personalChatMessages, personalChatThreads,
  starredMessages, userPrivacySettings, users,
} from "@shared/schema";
import { requireAuth } from "./role-middleware";
import { ObjectStorageService, ObjectNotFoundError } from "./ai_integrations/object_storage/objectStorage";
import { publicName } from "./user-display";
import { normalizePhoneNumber } from "@shared/phone";

const router = Router();

// ---------------------------------------------------------------- tables
export async function ensureChatExtrasTables(): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "starred_messages" (
      "id" serial PRIMARY KEY NOT NULL,
      "user_id" integer NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
      "chat_type" text NOT NULL,
      "chat_id" integer NOT NULL,
      "message_id" integer NOT NULL,
      "created_at" timestamp DEFAULT now()
    )`);
  await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS "starred_messages_unique" ON "starred_messages" ("user_id", "chat_type", "message_id")`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "starred_messages_user_idx" ON "starred_messages" ("user_id", "created_at")`);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "user_privacy_settings" (
      "user_id" integer PRIMARY KEY NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
      "last_seen" text NOT NULL DEFAULT 'everyone',
      "read_receipts" boolean NOT NULL DEFAULT true,
      "updated_at" timestamp DEFAULT now()
    )`);
}

// ---------------------------------------------------------------- privacy
export type PrivacySettings = { lastSeen: "everyone" | "nobody"; readReceipts: boolean };
const DEFAULT_PRIVACY: PrivacySettings = { lastSeen: "everyone", readReceipts: true };

export async function privacyOf(userIds: number[]): Promise<Map<number, PrivacySettings>> {
  const out = new Map<number, PrivacySettings>();
  const ids = Array.from(new Set(userIds.filter((id) => Number.isSafeInteger(id) && id > 0)));
  for (const id of ids) out.set(id, { ...DEFAULT_PRIVACY });
  if (!ids.length) return out;
  try {
    const rows = await db.select().from(userPrivacySettings).where(inArray(userPrivacySettings.userId, ids));
    for (const r of rows) out.set(r.userId, { lastSeen: r.lastSeen === "nobody" ? "nobody" : "everyone", readReceipts: r.readReceipts !== false });
  } catch {
    // Table not there yet (first boot): defaults.
  }
  return out;
}

/** WhatsApp rule: read receipts only show when BOTH people have them on. */
export async function readReceiptsShared(a: number, b: number): Promise<boolean> {
  const p = await privacyOf([a, b]);
  return (p.get(a)?.readReceipts ?? true) && (p.get(b)?.readReceipts ?? true);
}

/** Last seen/online show only when both people share theirs. */
export async function lastSeenShared(viewer: number, peer: number): Promise<boolean> {
  const p = await privacyOf([viewer, peer]);
  return p.get(viewer)?.lastSeen !== "nobody" && p.get(peer)?.lastSeen !== "nobody";
}

const privacySchema = z.object({
  lastSeen: z.enum(["everyone", "nobody"]).optional(),
  readReceipts: z.boolean().optional(),
}).strict();

router.get("/api/privacy/settings", requireAuth, async (req: Request, res: Response) => {
  const settings = (await privacyOf([req.user!.id])).get(req.user!.id) ?? DEFAULT_PRIVACY;
  res.json({ success: true, settings });
});

router.put("/api/privacy/settings", requireAuth, async (req: Request, res: Response) => {
  const parsed = privacySchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: "Check the settings." });
  const current = (await privacyOf([req.user!.id])).get(req.user!.id) ?? DEFAULT_PRIVACY;
  const next = { ...current, ...parsed.data };
  await db.insert(userPrivacySettings)
    .values({ userId: req.user!.id, lastSeen: next.lastSeen, readReceipts: next.readReceipts, updatedAt: new Date() })
    .onConflictDoUpdate({ target: userPrivacySettings.userId, set: { lastSeen: next.lastSeen, readReceipts: next.readReceipts, updatedAt: new Date() } });
  res.json({ success: true, settings: next });
});

// ---------------------------------------------------------------- message extras
export const pollInputSchema = z.object({
  question: z.string().trim().min(1).max(255),
  options: z.array(z.string().trim().min(1).max(100)).min(2).max(12)
    .refine((o) => new Set(o.map((x) => x.toLowerCase())).size === o.length, "Each option must be different."),
  multiple: z.boolean().optional(),
});

export const contactInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
  phones: z.array(z.string().trim().min(3).max(30)).min(1).max(5),
});

/** Builds the stored metadata for a poll. */
export function pollMetadata(input: z.infer<typeof pollInputSchema>) {
  return {
    poll: {
      question: input.question,
      options: input.options.map((text, i) => ({ id: `o${i + 1}`, text })),
      multiple: input.multiple === true,
    },
    pollVotes: {},
  };
}

/** Builds the stored metadata for a contact card; links it to a NeuraTalk account when the number is on NeuraTalk. */
export async function contactMetadata(input: z.infer<typeof contactInputSchema>) {
  const phones = input.phones.map((p) => p.replace(/[^\d+]/g, "")).filter((p) => p.replace(/\D/g, "").length >= 6);
  let userId: number | null = null;
  for (const phone of phones) {
    const normalized = normalizePhoneNumber(phone);
    const digits = normalized.replace(/\D/g, "");
    const [u] = await db.select({ id: users.id }).from(users).where(or(
      eq(users.phone, normalized),
      sql`right(regexp_replace(coalesce(${users.phone}, ''), '[^0-9]', '', 'g'), 10) = ${digits.slice(-10)}`,
    )).limit(1);
    if (u) { userId = u.id; break; }
  }
  return { contact: { name: input.name, phones, userId } };
}

type Meta = Record<string, unknown>;

/**
 * What a viewer may see of a message's extras. Strips the view-once file
 * path (it is only ever served through the one-time open endpoint) and works
 * out poll counts and the viewer's own votes.
 */
export function extrasForViewer(metadata: unknown, viewerId: number, senderId: number) {
  const meta: Meta = metadata && typeof metadata === "object" && !Array.isArray(metadata) ? { ...(metadata as Meta) } : {};
  const viewOnce = meta.viewOnce === true;
  const openedBy = (meta.viewOnceOpenedBy && typeof meta.viewOnceOpenedBy === "object") ? meta.viewOnceOpenedBy as Record<string, string> : {};
  if (viewOnce) {
    delete meta.attachmentUrl;
    delete meta.viewOnceOpenedBy;
  }
  let poll: null | { question: string; options: Array<{ id: string; text: string; votes: number }>; multiple: boolean; totalVoters: number; myVotes: string[] } = null;
  const rawPoll = meta.poll as { question?: string; options?: Array<{ id: string; text: string }>; multiple?: boolean } | undefined;
  if (rawPoll && Array.isArray(rawPoll.options)) {
    const votes = (meta.pollVotes && typeof meta.pollVotes === "object") ? meta.pollVotes as Record<string, string[]> : {};
    const counts: Record<string, number> = {};
    for (const picks of Object.values(votes)) for (const id of Array.isArray(picks) ? picks : []) counts[id] = (counts[id] ?? 0) + 1;
    poll = {
      question: String(rawPoll.question ?? ""),
      options: rawPoll.options.map((o) => ({ id: o.id, text: o.text, votes: counts[o.id] ?? 0 })),
      multiple: rawPoll.multiple === true,
      totalVoters: Object.values(votes).filter((v) => Array.isArray(v) && v.length > 0).length,
      myVotes: Array.isArray(votes[String(viewerId)]) ? votes[String(viewerId)] : [],
    };
  }
  const contact = meta.contact && typeof meta.contact === "object" ? meta.contact as { name: string; phones: string[]; userId: number | null } : null;
  return {
    metadata: meta,
    viewOnce,
    // The sender sees whether it was opened; a reader sees whether they opened it.
    viewOnceOpened: viewOnce ? (viewerId === senderId ? Object.keys(openedBy).length > 0 : Boolean(openedBy[String(viewerId)])) : false,
    poll,
    contact,
  };
}

export function extrasPreview(messageType: string, metadata: Meta, content: string): string | null {
  if (messageType === "poll") return `📊 Poll: ${String((metadata.poll as { question?: string } | undefined)?.question ?? content).slice(0, 150)}`;
  if (messageType === "sticker") return "🎨 Sticker";
  if (messageType === "contact") return `👤 ${String((metadata.contact as { name?: string } | undefined)?.name ?? content).slice(0, 150)}`;
  if (metadata.viewOnce === true) return /video/.test(String(metadata.attachmentMime ?? "")) ? "🎥 View once video" : "📷 View once photo";
  return null;
}

// ---------------------------------------------------------------- membership helpers
type ChatType = "personal" | "group";

async function personalThreadFor(userId: number, threadId: number) {
  const [thread] = await db.select().from(personalChatThreads).where(eq(personalChatThreads.id, threadId));
  if (!thread || (thread.participantAUserId !== userId && thread.participantBUserId !== userId)) return null;
  return thread;
}

async function isGroupMember(userId: number, groupId: number) {
  const [m] = await db.select({ id: groupChatMembers.id }).from(groupChatMembers)
    .where(and(eq(groupChatMembers.groupChatId, groupId), eq(groupChatMembers.userId, userId)));
  return Boolean(m);
}

/** The message, if the user may see it (member of its chat, not cleared/expired/deleted). */
export async function visibleMessage(userId: number, chatType: ChatType, chatId: number, messageId: number) {
  if (chatType === "personal") {
    const thread = await personalThreadFor(userId, chatId);
    if (!thread) return null;
    const [m] = await db.select().from(personalChatMessages).where(and(eq(personalChatMessages.id, messageId), eq(personalChatMessages.threadId, chatId)));
    if (!m || m.isDeleted) return null;
    if (m.expiresAt && new Date(m.expiresAt).getTime() <= Date.now()) return null;
    const clearedAt = thread.participantAUserId === userId ? thread.participantAClearedAt : thread.participantBClearedAt;
    if (clearedAt && m.createdAt && new Date(m.createdAt) <= new Date(clearedAt)) return null;
    return { kind: "personal" as const, message: m, thread };
  }
  if (!(await isGroupMember(userId, chatId))) return null;
  const [m] = await db.select().from(groupChatMessages).where(and(eq(groupChatMessages.id, messageId), eq(groupChatMessages.groupChatId, chatId)));
  if (!m || m.isDeleted) return null;
  return { kind: "group" as const, message: m };
}

const idParam = (v: unknown) => {
  const n = Number(v);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
};

// ---------------------------------------------------------------- starred
const starSchema = z.object({
  chatType: z.enum(["personal", "group"]),
  chatId: z.number().int().positive(),
  messageId: z.number().int().positive(),
});

router.post("/api/starred", requireAuth, async (req: Request, res: Response) => {
  const parsed = starSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: "Invalid message." });
  const { chatType, chatId, messageId } = parsed.data;
  const found = await visibleMessage(req.user!.id, chatType, chatId, messageId);
  if (!found) return res.status(404).json({ error: "Message not found." });
  await db.insert(starredMessages).values({ userId: req.user!.id, chatType, chatId, messageId }).onConflictDoNothing();
  res.status(201).json({ success: true, starred: true });
});

router.delete("/api/starred/:chatType/:messageId", requireAuth, async (req: Request, res: Response) => {
  const messageId = idParam(req.params.messageId);
  const chatType = req.params.chatType;
  if (!messageId || (chatType !== "personal" && chatType !== "group")) return res.status(400).json({ error: "Invalid message." });
  await db.delete(starredMessages).where(and(
    eq(starredMessages.userId, req.user!.id), eq(starredMessages.chatType, chatType), eq(starredMessages.messageId, messageId),
  ));
  res.json({ success: true, starred: false });
});

/** Ids I starred in one chat, so the chat screen can show the ★. */
router.get("/api/starred/ids", requireAuth, async (req: Request, res: Response) => {
  const chatType = String(req.query.chatType ?? "");
  const chatId = idParam(req.query.chatId);
  if (!chatId || (chatType !== "personal" && chatType !== "group")) return res.status(400).json({ error: "Invalid chat." });
  const rows = await db.select({ messageId: starredMessages.messageId }).from(starredMessages)
    .where(and(eq(starredMessages.userId, req.user!.id), eq(starredMessages.chatType, chatType), eq(starredMessages.chatId, chatId)));
  res.json({ success: true, ids: rows.map((r) => r.messageId) });
});

/** All my starred messages, newest star first, with chat name and sender. Gone/deleted ones drop out. */
router.get("/api/starred", requireAuth, async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const stars = await db.select().from(starredMessages).where(eq(starredMessages.userId, userId))
    .orderBy(desc(starredMessages.createdAt)).limit(500);
  const items: Array<Record<string, unknown>> = [];
  const nameCache = new Map<number, string>();
  const userName = async (id: number) => {
    if (!nameCache.has(id)) {
      const [u] = await db.select({ username: users.username, displayName: users.displayName }).from(users).where(eq(users.id, id));
      nameCache.set(id, publicName(u ?? null, "Someone"));
    }
    return nameCache.get(id)!;
  };
  const stale: number[] = [];
  for (const s of stars) {
    const found = await visibleMessage(userId, s.chatType as ChatType, s.chatId, s.messageId);
    if (!found) { stale.push(s.id); continue; }
    if (found.kind === "personal") {
      const m = found.message;
      const t = found.thread;
      const viewerLang = String(t.participantAUserId === userId ? t.participantALanguage : t.participantBLanguage).split(/[-_]/)[0];
      const translations = (m.translations ?? {}) as Record<string, string>;
      const isOwn = m.senderUserId === userId;
      const extras = extrasForViewer(m.metadata, userId, m.senderUserId);
      const peerId = t.participantAUserId === userId ? t.participantBUserId : t.participantAUserId;
      items.push({
        chatType: "personal", chatId: s.chatId, messageId: m.id, starredAt: s.createdAt,
        chatName: await userName(peerId),
        senderName: isOwn ? "You" : await userName(m.senderUserId),
        isOwn, messageType: m.messageType, createdAt: m.createdAt,
        text: !isOwn && translations[viewerLang] ? translations[viewerLang] : m.originalContent,
        attachmentUrl: extras.viewOnce ? null : (extras.metadata.attachmentUrl ?? null),
        attachmentTitle: extras.metadata.attachmentTitle ?? null,
        poll: extras.poll, contact: extras.contact, viewOnce: extras.viewOnce,
      });
    } else {
      const m = found.message;
      const [g] = await db.select({ name: groupChats.name }).from(groupChats).where(eq(groupChats.id, s.chatId));
      const [me] = await db.select({ language: users.preferredLanguage }).from(users).where(eq(users.id, userId));
      const translations = (m.translations ?? {}) as Record<string, string>;
      const lang = String(me?.language ?? "en");
      const isOwn = m.senderId === userId;
      const extras = extrasForViewer(m.metadata, userId, m.senderId);
      items.push({
        chatType: "group", chatId: s.chatId, messageId: m.id, starredAt: s.createdAt,
        chatName: g?.name ?? "Group",
        senderName: isOwn ? "You" : await userName(m.senderId),
        isOwn, messageType: m.messageType, createdAt: m.createdAt,
        text: !isOwn && m.originalLanguage !== lang && translations[lang] ? translations[lang] : m.originalContent,
        attachmentUrl: extras.viewOnce ? null : (extras.metadata.attachmentUrl ?? null),
        attachmentTitle: extras.metadata.attachmentTitle ?? null,
        poll: extras.poll, contact: extras.contact, viewOnce: extras.viewOnce,
      });
    }
  }
  if (stale.length) await db.delete(starredMessages).where(inArray(starredMessages.id, stale)).catch(() => undefined);
  res.json({ success: true, items });
});

// ---------------------------------------------------------------- search in a chat
function escapeLike(q: string) {
  return q.replace(/[\\%_]/g, (c) => `\\${c}`);
}

router.get("/api/personal-chats/:threadId/search", requireAuth, async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const threadId = idParam(req.params.threadId);
  const q = String(req.query.q ?? "").trim();
  if (!threadId) return res.status(400).json({ error: "Invalid chat." });
  if (q.length < 2) return res.json({ success: true, results: [] });
  const thread = await personalThreadFor(userId, threadId);
  if (!thread) return res.status(403).json({ error: "Access denied." });
  const clearedAt = thread.participantAUserId === userId ? thread.participantAClearedAt : thread.participantBClearedAt;
  const pattern = `%${escapeLike(q)}%`;
  const rows = await db.select().from(personalChatMessages).where(and(
    eq(personalChatMessages.threadId, threadId),
    eq(personalChatMessages.isDeleted, false),
    or(ilike(personalChatMessages.originalContent, pattern), sql`${personalChatMessages.translations}::text ilike ${pattern}`),
    ...(clearedAt ? [sql`${personalChatMessages.createdAt} > ${clearedAt}`] : []),
    or(isNull(personalChatMessages.expiresAt), sql`${personalChatMessages.expiresAt} > now()`),
  )).orderBy(desc(personalChatMessages.createdAt)).limit(100);
  const viewerLang = String(thread.participantAUserId === userId ? thread.participantALanguage : thread.participantBLanguage).split(/[-_]/)[0];
  res.json({
    success: true,
    results: rows
      .filter((m) => (m.metadata as Meta | null)?.viewOnce !== true)
      .map((m) => {
        const translations = (m.translations ?? {}) as Record<string, string>;
        const isOwn = m.senderUserId === userId;
        return { messageId: m.id, isOwn, createdAt: m.createdAt, messageType: m.messageType, text: !isOwn && translations[viewerLang] ? translations[viewerLang] : m.originalContent };
      }),
  });
});

router.get("/api/group-chats/:groupId/search", requireAuth, async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const groupId = idParam(req.params.groupId);
  const q = String(req.query.q ?? "").trim();
  if (!groupId) return res.status(400).json({ error: "Invalid group." });
  if (q.length < 2) return res.json({ success: true, results: [] });
  if (!(await isGroupMember(userId, groupId))) return res.status(403).json({ error: "Not a member of this group" });
  const pattern = `%${escapeLike(q)}%`;
  const rows = await db.select().from(groupChatMessages).where(and(
    eq(groupChatMessages.groupChatId, groupId),
    eq(groupChatMessages.isDeleted, false),
    or(ilike(groupChatMessages.originalContent, pattern), sql`${groupChatMessages.translations}::text ilike ${pattern}`),
  )).orderBy(desc(groupChatMessages.createdAt)).limit(100);
  const [me] = await db.select({ language: users.preferredLanguage }).from(users).where(eq(users.id, userId));
  const lang = String(me?.language ?? "en");
  const senderIds = Array.from(new Set(rows.map((r) => r.senderId)));
  const senders = senderIds.length
    ? await db.select({ id: users.id, username: users.username, displayName: users.displayName }).from(users).where(inArray(users.id, senderIds))
    : [];
  res.json({
    success: true,
    results: rows
      .filter((m) => (m.metadata as Meta | null)?.viewOnce !== true)
      .map((m) => {
        const translations = (m.translations ?? {}) as Record<string, string>;
        const isOwn = m.senderId === userId;
        const s = senders.find((x) => x.id === m.senderId);
        return {
          messageId: m.id, isOwn, createdAt: m.createdAt, messageType: m.messageType,
          senderName: isOwn ? "You" : publicName(s ?? null, "Someone"),
          text: !isOwn && m.originalLanguage !== lang && translations[lang] ? translations[lang] : m.originalContent,
        };
      }),
  });
});

// ---------------------------------------------------------------- poll votes
const voteSchema = z.object({ optionIds: z.array(z.string().trim().min(1).max(8)).max(12) });

async function applyVote(req: Request, res: Response, chatType: ChatType) {
  const userId = req.user!.id;
  const chatId = idParam(chatType === "personal" ? req.params.threadId : req.params.groupId);
  const messageId = idParam(req.params.messageId);
  const parsed = voteSchema.safeParse(req.body ?? {});
  if (!chatId || !messageId || !parsed.success) return res.status(400).json({ error: "Invalid vote." });
  const found = await visibleMessage(userId, chatType, chatId, messageId);
  if (!found) return res.status(404).json({ error: "Poll not found." });
  const meta = (found.message.metadata ?? {}) as Meta;
  const poll = meta.poll as { options?: Array<{ id: string }>; multiple?: boolean } | undefined;
  if (found.message.messageType !== "poll" || !poll?.options) return res.status(400).json({ error: "This message is not a poll." });
  const valid = new Set(poll.options.map((o) => o.id));
  const picks = Array.from(new Set(parsed.data.optionIds));
  if (picks.some((id) => !valid.has(id))) return res.status(400).json({ error: "Pick one of the poll options." });
  if (!poll.multiple && picks.length > 1) return res.status(400).json({ error: "This poll allows one answer." });
  // Atomic per-voter update, so two people voting at once never lose a vote.
  const patch = JSON.stringify({ [String(userId)]: picks });
  if (chatType === "personal") {
    await db.update(personalChatMessages).set({
      metadata: sql`jsonb_set(coalesce(${personalChatMessages.metadata}, '{}'::jsonb), '{pollVotes}', coalesce(${personalChatMessages.metadata}->'pollVotes', '{}'::jsonb) || ${patch}::jsonb)`,
      updatedAt: new Date(),
    }).where(eq(personalChatMessages.id, messageId));
    const [updated] = await db.select().from(personalChatMessages).where(eq(personalChatMessages.id, messageId));
    const t = (found as { thread: typeof personalChatThreads.$inferSelect }).thread;
    const { publishPersonalChatEvent } = await import("./modules/messaging/realtime");
    publishPersonalChatEvent([t.participantAUserId, t.participantBUserId], { type: "message_created", update: true, threadId: chatId, messageId });
    return res.json({ success: true, poll: extrasForViewer(updated?.metadata, userId, updated?.senderUserId ?? 0).poll });
  }
  await db.update(groupChatMessages).set({
    metadata: sql`jsonb_set(coalesce(${groupChatMessages.metadata}, '{}'::jsonb), '{pollVotes}', coalesce(${groupChatMessages.metadata}->'pollVotes', '{}'::jsonb) || ${patch}::jsonb)`,
    updatedAt: new Date(),
  }).where(eq(groupChatMessages.id, messageId));
  const [updated] = await db.select().from(groupChatMessages).where(eq(groupChatMessages.id, messageId));
  return res.json({ success: true, poll: extrasForViewer(updated?.metadata, userId, updated?.senderId ?? 0).poll });
}

router.post("/api/personal-chats/:threadId/messages/:messageId/vote", requireAuth, (req, res) => applyVote(req, res, "personal"));
router.post("/api/group-chats/:groupId/messages/:messageId/vote", requireAuth, (req, res) => applyVote(req, res, "group"));

// ---------------------------------------------------------------- view once
/**
 * Streams a view-once photo/video to a recipient exactly once. The sender
 * can't reopen it (like WhatsApp). In a 1:1 chat the file is deleted from
 * storage after it is opened.
 */
async function openViewOnce(req: Request, res: Response, chatType: ChatType) {
  const userId = req.user!.id;
  const chatId = idParam(chatType === "personal" ? req.params.threadId : req.params.groupId);
  const messageId = idParam(req.params.messageId);
  if (!chatId || !messageId) return res.status(400).json({ error: "Invalid message." });
  const found = await visibleMessage(userId, chatType, chatId, messageId);
  if (!found) return res.status(404).json({ error: "Message not found." });
  const meta = (found.message.metadata ?? {}) as Meta;
  const senderId = found.kind === "personal" ? found.message.senderUserId : found.message.senderId;
  if (meta.viewOnce !== true) return res.status(400).json({ error: "Not a view once message." });
  if (senderId === userId) return res.status(403).json({ error: "View once messages can only be opened by the person who gets them." });
  const path = typeof meta.attachmentUrl === "string" ? meta.attachmentUrl : null;
  if (!path) return res.status(410).json({ error: "This photo or video was already opened.", code: "VIEW_ONCE_OPENED" });
  // Claim the single view atomically: only the first request wins.
  const stamp = JSON.stringify({ [String(userId)]: new Date().toISOString() });
  const table = chatType === "personal" ? personalChatMessages : groupChatMessages;
  const claimed = await db.update(table).set({
    metadata: sql`jsonb_set(coalesce(${table.metadata}, '{}'::jsonb), '{viewOnceOpenedBy}', coalesce(${table.metadata}->'viewOnceOpenedBy', '{}'::jsonb) || ${stamp}::jsonb)`,
    updatedAt: new Date(),
  }).where(and(eq(table.id, messageId), sql`not (coalesce(${table.metadata}->'viewOnceOpenedBy', '{}'::jsonb) ? ${String(userId)})`)).returning({ id: table.id });
  if (!claimed.length) return res.status(410).json({ error: "This photo or video was already opened.", code: "VIEW_ONCE_OPENED" });
  try {
    const file = await new ObjectStorageService().getObjectEntityFile(path);
    const [info] = await file.getMetadata();
    res.setHeader("Content-Type", info.contentType || String(meta.attachmentMime || "application/octet-stream"));
    if (info.size) res.setHeader("Content-Length", String(info.size));
    res.setHeader("Cache-Control", "no-store, private");
    const stream = file.createReadStream();
    stream.on("error", () => { if (!res.headersSent) res.status(500).end(); else res.end(); });
    stream.on("end", () => {
      if (chatType !== "personal") return;
      // 1:1: nobody else can open it, so the file and its path are removed.
      void file.delete().catch(() => undefined);
      void db.update(personalChatMessages).set({
        metadata: sql`(coalesce(${personalChatMessages.metadata}, '{}'::jsonb) - 'attachmentUrl')`,
      }).where(eq(personalChatMessages.id, messageId)).catch(() => undefined);
    });
    stream.pipe(res);
    if (chatType === "personal") {
      const t = (found as { thread: typeof personalChatThreads.$inferSelect }).thread;
      const { publishPersonalChatEvent } = await import("./modules/messaging/realtime");
      publishPersonalChatEvent([t.participantAUserId, t.participantBUserId], { type: "message_created", update: true, threadId: chatId, messageId });
    }
  } catch (err) {
    if (err instanceof ObjectNotFoundError) return res.status(410).json({ error: "This photo or video is no longer available.", code: "VIEW_ONCE_OPENED" });
    console.error("[ChatExtras] view once open failed:", err);
    if (!res.headersSent) res.status(500).json({ error: "Could not open. Try again." });
  }
}

router.get("/api/personal-chats/:threadId/messages/:messageId/view-once", requireAuth, (req, res) => openViewOnce(req, res, "personal"));
router.get("/api/group-chats/:groupId/messages/:messageId/view-once", requireAuth, (req, res) => openViewOnce(req, res, "group"));

export default router;
