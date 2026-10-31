/**
 * Channels (like WhatsApp Channels): one-way updates from a person or a
 * business to followers. Followers are private (the owner only sees a
 * count); each follower reads every update in their own language; followers
 * can react with an emoji. Updates older than 30 days are not shown.
 */
import { Router, type Request, type Response } from "express";
import { and, desc, eq, ilike, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "./db";
import { channelFollowers, channels, channelUpdates, organizations, users } from "@shared/schema";
import { requireAuth, requireSuperAdmin } from "./role-middleware";
import { ObjectStorageService, ObjectNotFoundError } from "./ai_integrations/object_storage/objectStorage";
import { getObjectAclPolicy, setObjectAclPolicy } from "./ai_integrations/object_storage/objectAcl";
import { translateChatText } from "./translation/chat-translate";
import { sendPushNotification } from "./firebase-admin";
import { logger } from "./observability";

const router = Router();
const MAX_CHANNELS_PER_PERSON = 5;
const UPDATE_DAYS = 30;
const NOT_AN_EMOJI = new RegExp("[\\p{L}\\p{N}\\s<>]", "u");

export async function ensureChannelTables(): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "channels" (
      "id" serial PRIMARY KEY NOT NULL,
      "owner_user_id" integer NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
      "business_id" integer,
      "name" text NOT NULL,
      "description" text,
      "avatar_url" text,
      "language" text NOT NULL DEFAULT 'en',
      "is_active" boolean NOT NULL DEFAULT true,
      "created_at" timestamp DEFAULT now()
    )`);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "channel_followers" (
      "id" serial PRIMARY KEY NOT NULL,
      "channel_id" integer NOT NULL REFERENCES "channels"("id") ON DELETE CASCADE,
      "user_id" integer NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
      "muted" boolean NOT NULL DEFAULT false,
      "last_read_at" timestamp DEFAULT now(),
      "followed_at" timestamp DEFAULT now()
    )`);
  await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS "channel_followers_unique" ON "channel_followers" ("channel_id", "user_id")`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "channel_followers_user_idx" ON "channel_followers" ("user_id")`);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "channel_updates" (
      "id" serial PRIMARY KEY NOT NULL,
      "channel_id" integer NOT NULL REFERENCES "channels"("id") ON DELETE CASCADE,
      "author_user_id" integer NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
      "text_content" text,
      "media_url" text,
      "media_mime" text,
      "original_language" text NOT NULL DEFAULT 'en',
      "translations" jsonb DEFAULT '{}'::jsonb,
      "reactions" jsonb DEFAULT '{}'::jsonb,
      "created_at" timestamp DEFAULT now(),
      "deleted_at" timestamp
    )`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "channel_updates_channel_idx" ON "channel_updates" ("channel_id", "created_at")`);
}

const idOf = (v: unknown) => {
  const n = Number(v);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
};
const lang = (v: unknown) => String(v || "en").toLowerCase().split(/[-_]/)[0] || "en";

async function viewerLanguage(userId: number) {
  const [u] = await db.select({ l: users.preferredLanguage }).from(users).where(eq(users.id, userId));
  return lang(u?.l);
}

async function followerCount(channelIds: number[]) {
  if (!channelIds.length) return new Map<number, number>();
  const rows = await db.select({ id: channelFollowers.channelId, n: sql<number>`count(*)::int` })
    .from(channelFollowers).where(inArray(channelFollowers.channelId, channelIds)).groupBy(channelFollowers.channelId);
  return new Map(rows.map((r) => [r.id, r.n]));
}

/** Verified when the channel belongs to a verified business. */
async function verifiedBusinesses(ids: number[]) {
  const clean = ids.filter((x): x is number => Number.isSafeInteger(x));
  if (!clean.length) return new Set<number>();
  const rows = await db.select({ id: organizations.id, verifiedAt: organizations.verifiedAt }).from(organizations).where(inArray(organizations.id, clean));
  return new Set(rows.filter((r) => Boolean(r.verifiedAt)).map((r) => r.id));
}

async function present(rows: Array<typeof channels.$inferSelect>, viewerId: number) {
  const counts = await followerCount(rows.map((r) => r.id));
  const verified = await verifiedBusinesses(rows.map((r) => r.businessId ?? NaN));
  const follows = rows.length
    ? await db.select().from(channelFollowers).where(and(eq(channelFollowers.userId, viewerId), inArray(channelFollowers.channelId, rows.map((r) => r.id))))
    : [];
  return rows.map((c) => {
    const f = follows.find((x) => x.channelId === c.id);
    return {
      id: c.id, name: c.name, description: c.description, avatarUrl: c.avatarUrl, language: c.language,
      followers: counts.get(c.id) ?? 0, verified: c.businessId != null && verified.has(c.businessId),
      isOwner: c.ownerUserId === viewerId, isFollowing: Boolean(f), muted: f?.muted ?? false,
      createdAt: c.createdAt,
    };
  });
}

/** Photos/videos in channels are public (anyone who can see the channel can see them). */
async function publishMedia(userId: number, path: string): Promise<string | null> {
  try {
    const file = await new ObjectStorageService().getObjectEntityFile(path);
    const existing = await getObjectAclPolicy(file);
    const { mayClaimUpload } = await import("./ai_integrations/object_storage/upload-owner");
    if ((existing && existing.owner !== String(userId)) || (!existing && !(await mayClaimUpload(path, userId)))) return "This file belongs to someone else.";
    await setObjectAclPolicy(file, { owner: String(userId), visibility: "public" });
    return null;
  } catch (err) {
    if (err instanceof ObjectNotFoundError) return "The file was not uploaded. Try again.";
    throw err;
  }
}

async function ownChannel(userId: number, channelId: number) {
  const [c] = await db.select().from(channels).where(and(eq(channels.id, channelId), eq(channels.isActive, true)));
  return c && c.ownerUserId === userId ? c : null;
}

// ---------------------------------------------------------------- channels
const channelSchema = z.object({
  name: z.string().trim().min(3).max(60),
  description: z.string().trim().max(500).optional(),
  avatarUrl: z.string().startsWith("/objects/").max(500).optional(),
  businessId: z.number().int().positive().optional(),
});

router.post("/api/channels", requireAuth, async (req: Request, res: Response) => {
  const parsed = channelSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Check the channel details." });
  const userId = req.user!.id;
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(channels).where(and(eq(channels.ownerUserId, userId), eq(channels.isActive, true)));
  if (n >= MAX_CHANNELS_PER_PERSON) return res.status(400).json({ error: `You can run up to ${MAX_CHANNELS_PER_PERSON} channels.` });
  if (parsed.data.businessId && req.user!.organizationId !== parsed.data.businessId) return res.status(403).json({ error: "You can only create a channel for your own business." });
  if (parsed.data.avatarUrl) {
    const problem = await publishMedia(userId, parsed.data.avatarUrl);
    if (problem) return res.status(400).json({ error: problem });
  }
  const [c] = await db.insert(channels).values({
    ownerUserId: userId, businessId: parsed.data.businessId ?? null, name: parsed.data.name,
    description: parsed.data.description ?? null, avatarUrl: parsed.data.avatarUrl ?? null, language: await viewerLanguage(userId),
  }).returning();
  res.status(201).json({ success: true, channel: (await present([c], userId))[0] });
});

router.patch("/api/channels/:id", requireAuth, async (req: Request, res: Response) => {
  const id = idOf(req.params.id);
  const parsed = channelSchema.partial().omit({ businessId: true }).safeParse(req.body ?? {});
  if (!id || !parsed.success) return res.status(400).json({ error: "Check the channel details." });
  const c = await ownChannel(req.user!.id, id);
  if (!c) return res.status(404).json({ error: "Channel not found." });
  if (parsed.data.avatarUrl) {
    const problem = await publishMedia(req.user!.id, parsed.data.avatarUrl);
    if (problem) return res.status(400).json({ error: problem });
  }
  const [updated] = await db.update(channels).set(parsed.data).where(eq(channels.id, id)).returning();
  res.json({ success: true, channel: (await present([updated], req.user!.id))[0] });
});

router.delete("/api/channels/:id", requireAuth, async (req: Request, res: Response) => {
  const id = idOf(req.params.id);
  if (!id) return res.status(400).json({ error: "Invalid channel." });
  const c = await ownChannel(req.user!.id, id);
  if (!c) return res.status(404).json({ error: "Channel not found." });
  await db.update(channels).set({ isActive: false }).where(eq(channels.id, id));
  res.json({ success: true });
});

/** Channels I run and channels I follow, with the newest update and unread count. */
router.get("/api/channels/mine", requireAuth, async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const followed = await db.select({ channelId: channelFollowers.channelId, lastReadAt: channelFollowers.lastReadAt }).from(channelFollowers).where(eq(channelFollowers.userId, userId));
  const ids = followed.map((f) => f.channelId);
  const rows = await db.select().from(channels).where(and(eq(channels.isActive, true), or(eq(channels.ownerUserId, userId), ids.length ? inArray(channels.id, ids) : sql`false`)));
  const list = await present(rows, userId);
  const since = sql`now() - make_interval(days => ${UPDATE_DAYS})`;
  const out = [];
  for (const c of list) {
    const [last] = await db.select().from(channelUpdates)
      .where(and(eq(channelUpdates.channelId, c.id), isNull(channelUpdates.deletedAt), sql`${channelUpdates.createdAt} > ${since}`))
      .orderBy(desc(channelUpdates.createdAt)).limit(1);
    // Compared inside the database (its own clock), never through JS dates.
    const [{ unread }] = c.isFollowing
      ? await db.select({ unread: sql<number>`count(*)::int` }).from(channelUpdates)
          .where(and(eq(channelUpdates.channelId, c.id), isNull(channelUpdates.deletedAt),
            sql`${channelUpdates.createdAt} > (SELECT last_read_at FROM channel_followers WHERE channel_id = ${c.id} AND user_id = ${userId})`))
      : [{ unread: 0 }];
    out.push({ ...c, lastUpdate: last ? { text: last.textContent, hasMedia: Boolean(last.mediaUrl), createdAt: last.createdAt } : null, unread: c.isOwner ? 0 : unread });
  }
  out.sort((a, b) => new Date(String(b.lastUpdate?.createdAt ?? b.createdAt)).getTime() - new Date(String(a.lastUpdate?.createdAt ?? a.createdAt)).getTime());
  res.json({ success: true, channels: out });
});

/** Directory: search active channels, most followed first. */
router.get("/api/channels/discover", requireAuth, async (req: Request, res: Response) => {
  const q = String(req.query.q ?? "").trim().slice(0, 60);
  const pattern = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  const rows = await db.select().from(channels)
    .where(and(eq(channels.isActive, true), q ? or(ilike(channels.name, pattern), ilike(channels.description, pattern)) : sql`true`))
    .limit(200);
  const list = await present(rows, req.user!.id);
  list.sort((a, b) => b.followers - a.followers);
  res.json({ success: true, channels: list.slice(0, 50) });
});

router.get("/api/channels/:id", requireAuth, async (req: Request, res: Response) => {
  const id = idOf(req.params.id);
  if (!id) return res.status(400).json({ error: "Invalid channel." });
  const [c] = await db.select().from(channels).where(and(eq(channels.id, id), eq(channels.isActive, true)));
  if (!c) return res.status(404).json({ error: "Channel not found." });
  res.json({ success: true, channel: (await present([c], req.user!.id))[0] });
});

// ---------------------------------------------------------------- following
router.post("/api/channels/:id/follow", requireAuth, async (req: Request, res: Response) => {
  const id = idOf(req.params.id);
  if (!id) return res.status(400).json({ error: "Invalid channel." });
  const [c] = await db.select().from(channels).where(and(eq(channels.id, id), eq(channels.isActive, true)));
  if (!c) return res.status(404).json({ error: "Channel not found." });
  if (c.ownerUserId === req.user!.id) return res.status(400).json({ error: "You run this channel." });
  await db.insert(channelFollowers).values({ channelId: id, userId: req.user!.id }).onConflictDoNothing();
  res.json({ success: true, following: true });
});

router.delete("/api/channels/:id/follow", requireAuth, async (req: Request, res: Response) => {
  const id = idOf(req.params.id);
  if (!id) return res.status(400).json({ error: "Invalid channel." });
  await db.delete(channelFollowers).where(and(eq(channelFollowers.channelId, id), eq(channelFollowers.userId, req.user!.id)));
  res.json({ success: true, following: false });
});

router.patch("/api/channels/:id/follow", requireAuth, async (req: Request, res: Response) => {
  const id = idOf(req.params.id);
  const parsed = z.object({ muted: z.boolean() }).safeParse(req.body ?? {});
  if (!id || !parsed.success) return res.status(400).json({ error: "Invalid request." });
  const updated = await db.update(channelFollowers).set({ muted: parsed.data.muted })
    .where(and(eq(channelFollowers.channelId, id), eq(channelFollowers.userId, req.user!.id))).returning({ id: channelFollowers.id });
  if (!updated.length) return res.status(404).json({ error: "You don't follow this channel." });
  res.json({ success: true, muted: parsed.data.muted });
});

// ---------------------------------------------------------------- updates
function reactionSummary(raw: unknown, viewerId: number) {
  const map = raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, string> : {};
  const counts: Record<string, number> = {};
  for (const e of Object.values(map)) if (typeof e === "string" && e) counts[e] = (counts[e] ?? 0) + 1;
  return { reactions: counts, myReaction: map[String(viewerId)] ?? null };
}

router.get("/api/channels/:id/updates", requireAuth, async (req: Request, res: Response) => {
  const id = idOf(req.params.id);
  if (!id) return res.status(400).json({ error: "Invalid channel." });
  const userId = req.user!.id;
  const [c] = await db.select().from(channels).where(and(eq(channels.id, id), eq(channels.isActive, true)));
  if (!c) return res.status(404).json({ error: "Channel not found." });
  const before = req.query.before ? new Date(String(req.query.before)) : null;
  const rows = await db.select().from(channelUpdates)
    .where(and(
      eq(channelUpdates.channelId, id), isNull(channelUpdates.deletedAt),
      sql`${channelUpdates.createdAt} > now() - make_interval(days => ${UPDATE_DAYS})`,
      ...(before && !Number.isNaN(before.getTime()) ? [lt(channelUpdates.createdAt, before)] : []),
    ))
    .orderBy(desc(channelUpdates.createdAt)).limit(30);
  const target = await viewerLanguage(userId);
  // Translate into the reader's language the first time someone needs it, then keep it.
  const out = await Promise.all(rows.map(async (u) => {
    const translations = (u.translations ?? {}) as Record<string, string>;
    let text = u.textContent;
    if (text && lang(u.originalLanguage) !== target) {
      if (!translations[target]) {
        try {
          translations[target] = await translateChatText(text, lang(u.originalLanguage), target);
          await db.update(channelUpdates).set({
            translations: sql`coalesce(${channelUpdates.translations}, '{}'::jsonb) || ${JSON.stringify({ [target]: translations[target] })}::jsonb`,
          }).where(eq(channelUpdates.id, u.id));
        } catch { /* show the original */ }
      }
      text = translations[target] ?? text;
    }
    return {
      id: u.id, text, originalText: u.textContent, originalLanguage: u.originalLanguage, translated: text !== u.textContent,
      mediaUrl: u.mediaUrl, mediaMime: u.mediaMime, createdAt: u.createdAt, ...reactionSummary(u.reactions, userId),
    };
  }));
  await db.update(channelFollowers).set({ lastReadAt: sql`now()` }).where(and(eq(channelFollowers.channelId, id), eq(channelFollowers.userId, userId)));
  res.json({ success: true, updates: out });
});

const updateSchema = z.object({
  text: z.string().trim().max(4000).optional(),
  mediaUrl: z.string().startsWith("/objects/").max(500).optional(),
  mediaMime: z.string().max(120).optional(),
}).refine((v) => (v.text && v.text.length) || v.mediaUrl, { message: "Write something or add a photo or video." });

router.post("/api/channels/:id/updates", requireAuth, async (req: Request, res: Response) => {
  const id = idOf(req.params.id);
  const parsed = updateSchema.safeParse(req.body ?? {});
  if (!id || !parsed.success) return res.status(400).json({ error: parsed.success ? "Invalid channel." : parsed.error.issues[0]?.message });
  const userId = req.user!.id;
  const c = await ownChannel(userId, id);
  if (!c) return res.status(403).json({ error: "Only the channel's owner can post." });
  if (parsed.data.mediaUrl) {
    if (parsed.data.mediaMime && !/^(image|video)\//.test(parsed.data.mediaMime)) return res.status(400).json({ error: "Channels take photos and videos." });
    const problem = await publishMedia(userId, parsed.data.mediaUrl);
    if (problem) return res.status(400).json({ error: problem });
  }
  const [u] = await db.insert(channelUpdates).values({
    channelId: id, authorUserId: userId, textContent: parsed.data.text || null,
    mediaUrl: parsed.data.mediaUrl ?? null, mediaMime: parsed.data.mediaMime ?? null, originalLanguage: await viewerLanguage(userId),
  }).returning();
  res.status(201).json({ success: true, update: { id: u.id, text: u.textContent, mediaUrl: u.mediaUrl, mediaMime: u.mediaMime, createdAt: u.createdAt, reactions: {}, myReaction: null } });
  // Tell followers who haven't muted it (best effort, after answering).
  void (async () => {
    try {
      const followers = await db.select({ userId: channelFollowers.userId }).from(channelFollowers)
        .where(and(eq(channelFollowers.channelId, id), eq(channelFollowers.muted, false))).limit(5000);
      const body = (parsed.data.text || (parsed.data.mediaMime?.startsWith("video") ? "🎥 Video" : "📷 Photo")).slice(0, 140);
      for (const f of followers) {
        sendPushNotification(f.userId, { title: c.name, body, data: { type: "channel_update", channelId: String(id) } }).catch(() => undefined);
      }
    } catch (err) {
      logger.warn("Channels", `push to followers failed: ${String(err)}`);
    }
  })();
});

router.delete("/api/channels/:id/updates/:updateId", requireAuth, async (req: Request, res: Response) => {
  const id = idOf(req.params.id);
  const updateId = idOf(req.params.updateId);
  if (!id || !updateId) return res.status(400).json({ error: "Invalid update." });
  if (!(await ownChannel(req.user!.id, id))) return res.status(403).json({ error: "Only the channel's owner can delete updates." });
  await db.update(channelUpdates).set({ deletedAt: new Date(), textContent: null, mediaUrl: null, translations: {} })
    .where(and(eq(channelUpdates.id, updateId), eq(channelUpdates.channelId, id)));
  res.json({ success: true });
});

router.post("/api/channels/:id/updates/:updateId/reaction", requireAuth, async (req: Request, res: Response) => {
  const id = idOf(req.params.id);
  const updateId = idOf(req.params.updateId);
  const emoji = req.body?.emoji;
  if (!id || !updateId) return res.status(400).json({ error: "Invalid update." });
  if (emoji !== null && (typeof emoji !== "string" || !emoji.trim() || emoji.length > 16 || NOT_AN_EMOJI.test(emoji))) {
    return res.status(400).json({ error: "Pick an emoji." });
  }
  const [f] = await db.select().from(channelFollowers).where(and(eq(channelFollowers.channelId, id), eq(channelFollowers.userId, req.user!.id)));
  if (!f) return res.status(403).json({ error: "Follow the channel to react." });
  const key = String(req.user!.id);
  const updated = await db.update(channelUpdates).set({
    reactions: emoji === null
      ? sql`coalesce(${channelUpdates.reactions}, '{}'::jsonb) - ${key}`
      : sql`coalesce(${channelUpdates.reactions}, '{}'::jsonb) || ${JSON.stringify({ [key]: emoji })}::jsonb`,
  }).where(and(eq(channelUpdates.id, updateId), eq(channelUpdates.channelId, id), isNull(channelUpdates.deletedAt))).returning({ reactions: channelUpdates.reactions });
  if (!updated.length) return res.status(404).json({ error: "Update not found." });
  res.json({ success: true, ...reactionSummary(updated[0].reactions, req.user!.id) });
});

// ---------------------------------------------------------------- admin
router.get("/api/admin/channels", requireAuth, requireSuperAdmin, async (_req: Request, res: Response) => {
  const rows = await db.select().from(channels).orderBy(desc(channels.createdAt)).limit(500);
  const counts = await followerCount(rows.map((r) => r.id));
  res.json({ success: true, channels: rows.map((c) => ({ ...c, followers: counts.get(c.id) ?? 0 })) });
});

router.patch("/api/admin/channels/:id", requireAuth, requireSuperAdmin, async (req: Request, res: Response) => {
  const id = idOf(req.params.id);
  const parsed = z.object({ isActive: z.boolean() }).safeParse(req.body ?? {});
  if (!id || !parsed.success) return res.status(400).json({ error: "Invalid request." });
  await db.update(channels).set({ isActive: parsed.data.isActive }).where(eq(channels.id, id));
  logger.info("Channels", `channel ${id} ${parsed.data.isActive ? "restored" : "taken down"} by admin ${req.user!.id}`);
  res.json({ success: true });
});

export default router;
