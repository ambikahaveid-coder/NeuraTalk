/**
 * Status: text or photo updates that last 24 hours, shown to the people you
 * have a 1:1 chat with (never to anyone either of you has blocked). Text is
 * shown in each viewer's own language -- translated once per language and
 * cached on the post. The author sees who viewed each update.
 */
import type { Express, Request, Response } from "express";
import { z } from "zod";
import { and, desc, eq, gt, inArray, isNotNull, isNull, lt, or, sql } from "drizzle-orm";
import { db } from "./db";
import { blockedUsers, businessConversations, customers, organizations, personalChatThreads, statusPosts, statusViews, users, PERMISSIONS } from "@shared/schema";
import { requireAuth, requireCompanyAccess, requirePermission } from "./role-middleware";
import { translateChatText } from "./translation/chat-translate";
import { ObjectStorageService, ObjectNotFoundError } from "./ai_integrations/object_storage/objectStorage";
import { getObjectAclPolicy, setObjectAclPolicy, ObjectAccessGroupType, ObjectPermission } from "./ai_integrations/object_storage/objectAcl";

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_ACTIVE_PER_USER = 30;

function baseLanguage(language?: string | null): string {
  return String(language || "en").trim().toLowerCase().split(/[-_]/)[0] || "en";
}

/** People who see my status (and whose status I see): everyone I have a 1:1 chat with, minus blocks either way. */
export async function statusAudience(userId: number): Promise<number[]> {
  const threads = await db.select({ a: personalChatThreads.participantAUserId, b: personalChatThreads.participantBUserId })
    .from(personalChatThreads)
    .where(or(eq(personalChatThreads.participantAUserId, userId), eq(personalChatThreads.participantBUserId, userId)));
  const peers = new Set<number>(threads.map((t) => (t.a === userId ? t.b : t.a)).filter((id) => id !== userId));
  if (peers.size === 0) return [];
  const blocks = await db.select({ blocker: blockedUsers.blockerUserId, blocked: blockedUsers.blockedUserId })
    .from(blockedUsers)
    .where(or(eq(blockedUsers.blockerUserId, userId), eq(blockedUsers.blockedUserId, userId)));
  for (const b of blocks) {
    peers.delete(b.blocker === userId ? b.blocked : b.blocker);
  }
  return Array.from(peers);
}

/**
 * Businesses whose status I see: ones I have a chat with, that I haven't
 * blocked, and that are approved and active.
 */
export async function businessesFollowedBy(userId: number): Promise<number[]> {
  const found = await db.selectDistinct({ businessId: customers.businessId })
    .from(customers)
    .innerJoin(businessConversations, eq(businessConversations.customerId, customers.id))
    .innerJoin(organizations, eq(organizations.id, customers.businessId))
    .where(and(
      eq(customers.linkedUserId, userId),
      isNull(customers.blockedByCustomerAt),
      eq(organizations.status, "approved"),
      eq(organizations.isActive, true),
    ));
  return found.map((r) => r.businessId);
}

/** How many customers can see a business's status. */
async function businessAudienceSize(businessId: number): Promise<number> {
  const [row] = await db.select({ n: sql<number>`count(distinct ${customers.linkedUserId})::int` })
    .from(customers)
    .innerJoin(businessConversations, eq(businessConversations.customerId, customers.id))
    .where(and(eq(customers.businessId, businessId), isNotNull(customers.linkedUserId), isNull(customers.blockedByCustomerAt)));
  return row?.n ?? 0;
}

/** A status photo is private: readable by the author's current audience only. */
async function shareStatusPhoto(authorId: number, objectPath: string, audience: number[]): Promise<string | null> {
  if (!objectPath.startsWith("/objects/")) return "Invalid photo.";
  try {
    const file = await new ObjectStorageService().getObjectEntityFile(objectPath);
    const existing = await getObjectAclPolicy(file);
    if (existing && existing.owner !== String(authorId)) return "This photo belongs to someone else.";
    await setObjectAclPolicy(file, {
      owner: String(authorId),
      visibility: "private",
      aclRules: [{ group: { type: ObjectAccessGroupType.USER_LIST, id: JSON.stringify(audience.map(String)) }, permission: ObjectPermission.READ }],
    });
    return null;
  } catch (err) {
    if (err instanceof ObjectNotFoundError) return "The photo was not uploaded. Please try again.";
    throw err;
  }
}

const postSchema = z.object({
  kind: z.enum(["text", "photo"]),
  text: z.string().trim().max(700).optional(),
  mediaUrl: z.string().trim().max(2000).optional(),
  background: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
}).refine((v) => (v.kind === "text" ? Boolean(v.text) : Boolean(v.mediaUrl)), { message: "Write something or pick a photo." });

async function textFor(post: typeof statusPosts.$inferSelect, language: string): Promise<{ text: string | null; translated: boolean }> {
  const original = post.textContent;
  if (!original) return { text: null, translated: false };
  const from = baseLanguage(post.originalLanguage);
  if (from === language) return { text: original, translated: false };
  const cache = (post.translations as Record<string, string> | null) ?? {};
  if (cache[language]) return { text: cache[language], translated: true };
  try {
    const translated = await translateChatText(original, from, language);
    if (translated && translated !== original) {
      await db.update(statusPosts)
        .set({ translations: sql`coalesce(${statusPosts.translations}, '{}'::jsonb) || jsonb_build_object(${language}::text, ${translated}::text)` })
        .where(eq(statusPosts.id, post.id));
      return { text: translated, translated: true };
    }
  } catch { /* show the original */ }
  return { text: original, translated: false };
}

export async function deleteExpiredStatuses(): Promise<number> {
  const removed = await db.delete(statusPosts).where(lt(statusPosts.expiresAt, new Date())).returning({ id: statusPosts.id });
  return removed.length;
}

export function registerStatusRoutes(app: Express): void {
  // Post a status.
  app.post("/api/status", requireAuth, async (req: Request, res: Response) => {
    const userId = req.user!.id;
    const parsed = postSchema.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid status." });
    try {
      const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(statusPosts)
        .where(and(eq(statusPosts.userId, userId), isNull(statusPosts.businessId), gt(statusPosts.expiresAt, new Date())));
      if (n >= MAX_ACTIVE_PER_USER) return res.status(429).json({ error: `You can have up to ${MAX_ACTIVE_PER_USER} updates at a time.` });

      if (parsed.data.kind === "photo") {
        const problem = await shareStatusPhoto(userId, parsed.data.mediaUrl!, await statusAudience(userId));
        if (problem) return res.status(problem.startsWith("This photo") ? 403 : 400).json({ error: problem });
      }
      const [me] = await db.select({ language: users.preferredLanguage }).from(users).where(eq(users.id, userId));
      const [post] = await db.insert(statusPosts).values({
        userId,
        kind: parsed.data.kind,
        textContent: parsed.data.text || null,
        mediaUrl: parsed.data.kind === "photo" ? parsed.data.mediaUrl! : null,
        background: parsed.data.kind === "text" ? (parsed.data.background ?? "#1E66F5") : null,
        originalLanguage: baseLanguage(me?.language),
        expiresAt: new Date(Date.now() + DAY_MS),
      }).returning();
      return res.status(201).json({ status: post });
    } catch (error) {
      console.error("[Status] post failed:", error);
      return res.status(500).json({ error: "Could not post your status." });
    }
  });

  // My updates (with view counts) and the people I chat with who posted.
  app.get("/api/status/feed", requireAuth, async (req: Request, res: Response) => {
    const userId = req.user!.id;
    try {
      const now = new Date();
      const [me] = await db.select({ language: users.preferredLanguage }).from(users).where(eq(users.id, userId));
      const language = baseLanguage(me?.language);

      const mine = await db.select().from(statusPosts)
        .where(and(eq(statusPosts.userId, userId), isNull(statusPosts.businessId), gt(statusPosts.expiresAt, now)))
        .orderBy(statusPosts.createdAt);
      const myCounts = mine.length
        ? await db.select({ statusId: statusViews.statusId, n: sql<number>`count(*)::int` }).from(statusViews)
            .where(inArray(statusViews.statusId, mine.map((p) => p.id))).groupBy(statusViews.statusId)
        : [];
      const countById = new Map(myCounts.map((c) => [c.statusId, c.n]));

      const audience = await statusAudience(userId);
      const others = audience.length
        ? await db.select().from(statusPosts)
            .where(and(inArray(statusPosts.userId, audience), isNull(statusPosts.businessId), gt(statusPosts.expiresAt, now)))
            .orderBy(statusPosts.createdAt)
        : [];
      const followed = await businessesFollowedBy(userId);
      const businessPosts = followed.length
        ? await db.select().from(statusPosts)
            .where(and(inArray(statusPosts.businessId, followed), gt(statusPosts.expiresAt, now)))
            .orderBy(statusPosts.createdAt)
        : [];
      const allSeenIds = [...others, ...businessPosts].map((p) => p.id);
      const seen = allSeenIds.length
        ? new Set((await db.select({ statusId: statusViews.statusId }).from(statusViews)
            .where(and(eq(statusViews.viewerId, userId), inArray(statusViews.statusId, allSeenIds)))).map((r) => r.statusId))
        : new Set<number>();
      const authorIds = Array.from(new Set(others.map((p) => p.userId)));
      const authors = authorIds.length
        ? await db.select({
            id: users.id,
            name: sql<string>`coalesce(nullif(trim(${users.displayName}), ''), ${users.username})`,
            phone: users.phone,
            avatarUrl: users.avatarUrl,
          }).from(users).where(inArray(users.id, authorIds))
        : [];

      const shape = async (p: typeof statusPosts.$inferSelect, own: boolean) => {
        const t = own ? { text: p.textContent, translated: false } : await textFor(p, language);
        return {
          id: p.id,
          kind: p.kind,
          text: t.text,
          originalText: t.translated ? p.textContent : null,
          originalLanguage: p.originalLanguage,
          mediaUrl: p.mediaUrl,
          background: p.background,
          createdAt: p.createdAt,
          expiresAt: p.expiresAt,
          ...(own ? { viewCount: countById.get(p.id) ?? 0 } : { seen: seen.has(p.id) }),
        };
      };

      const people = [];
      for (const author of authors) {
        const posts = others.filter((p) => p.userId === author.id);
        const updates = [];
        for (const p of posts) updates.push(await shape(p, false));
        people.push({
          user: author,
          updates,
          allSeen: updates.every((u) => (u as { seen?: boolean }).seen),
          lastAt: posts[posts.length - 1]?.createdAt ?? null,
        });
      }
      people.sort((a, b) => Number(a.allSeen) - Number(b.allSeen) || new Date(b.lastAt ?? 0).getTime() - new Date(a.lastAt ?? 0).getTime());

      // Businesses I chat with -- their offers and news, in my language.
      const bizIds = Array.from(new Set(businessPosts.map((p) => p.businessId!)));
      const orgs = bizIds.length
        ? await db.select({ id: organizations.id, name: organizations.name, logoUrl: organizations.logoUrl, verifiedAt: organizations.verifiedAt })
            .from(organizations).where(inArray(organizations.id, bizIds))
        : [];
      const businesses = [];
      for (const org of orgs) {
        const posts = businessPosts.filter((p) => p.businessId === org.id);
        const updates = [];
        for (const p of posts) updates.push(await shape(p, false));
        businesses.push({
          business: { id: org.id, name: org.name, logoUrl: org.logoUrl, verified: Boolean(org.verifiedAt) },
          updates,
          allSeen: updates.every((u) => (u as { seen?: boolean }).seen),
          lastAt: posts[posts.length - 1]?.createdAt ?? null,
        });
      }
      businesses.sort((a, b) => Number(a.allSeen) - Number(b.allSeen) || new Date(b.lastAt ?? 0).getTime() - new Date(a.lastAt ?? 0).getTime());

      const myUpdates = [];
      for (const p of mine) myUpdates.push(await shape(p, true));
      return res.json({ mine: myUpdates, people, businesses, audienceSize: audience.length });
    } catch (error) {
      console.error("[Status] feed failed:", error);
      return res.status(500).json({ error: "Could not load updates." });
    }
  });

  // I viewed someone's update.
  app.post("/api/status/:id/view", requireAuth, async (req: Request, res: Response) => {
    const userId = req.user!.id;
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id)) return res.status(400).json({ error: "Invalid status." });
    try {
      const [post] = await db.select().from(statusPosts).where(eq(statusPosts.id, id));
      if (!post || post.expiresAt < new Date()) return res.status(404).json({ error: "This update has ended." });
      if (post.businessId != null) {
        if (!(await businessesFollowedBy(userId)).includes(post.businessId)) return res.status(403).json({ error: "Not available." });
      } else {
        if (post.userId === userId) return res.json({ success: true });
        if (!(await statusAudience(post.userId)).includes(userId)) return res.status(403).json({ error: "Not available." });
      }
      await db.insert(statusViews).values({ statusId: id, viewerId: userId }).onConflictDoNothing();
      return res.json({ success: true });
    } catch (error) {
      console.error("[Status] view failed:", error);
      return res.status(500).json({ error: "Could not record the view." });
    }
  });

  // Who saw my update.
  app.get("/api/status/:id/viewers", requireAuth, async (req: Request, res: Response) => {
    const userId = req.user!.id;
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || id <= 0) return res.status(400).json({ error: "Invalid status." });
    const [post] = await db.select().from(statusPosts).where(eq(statusPosts.id, id));
    if (!post || post.userId !== userId || post.businessId != null) return res.status(404).json({ error: "Not found." });
    const viewers = await db.select({
      id: users.id,
      name: sql<string>`coalesce(nullif(trim(${users.displayName}), ''), ${users.username})`,
      phone: users.phone,
      avatarUrl: users.avatarUrl,
      viewedAt: statusViews.viewedAt,
    }).from(statusViews).innerJoin(users, eq(users.id, statusViews.viewerId))
      .where(eq(statusViews.statusId, id)).orderBy(desc(statusViews.viewedAt));
    return res.json({ viewers });
  });

  // Delete my update.
  app.delete("/api/status/:id", requireAuth, async (req: Request, res: Response) => {
    const userId = req.user!.id;
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || id <= 0) return res.status(400).json({ error: "Invalid status." });
    const deleted = await db.delete(statusPosts).where(and(eq(statusPosts.id, id), eq(statusPosts.userId, userId), isNull(statusPosts.businessId))).returning({ id: statusPosts.id });
    if (deleted.length === 0) return res.status(404).json({ error: "Not found." });
    return res.json({ success: true });
  });

  // ---------- Business status (Business app: offers, news) ----------
  const team = [requireAuth, requireCompanyAccess("businessId"), requirePermission(PERMISSIONS.MESSAGING_SEND)];
  const businessIdOf = (req: Request) => {
    const id = Number(req.params.businessId);
    return Number.isSafeInteger(id) && id > 0 ? id : null;
  };

  app.post("/api/business/:businessId/status", ...team, async (req: Request, res: Response) => {
    const businessId = businessIdOf(req);
    if (!businessId) return res.status(400).json({ error: "Invalid business." });
    const parsed = postSchema.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid status." });
    try {
      const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(statusPosts)
        .where(and(eq(statusPosts.businessId, businessId), gt(statusPosts.expiresAt, new Date())));
      if (n >= MAX_ACTIVE_PER_USER) return res.status(429).json({ error: `A business can have up to ${MAX_ACTIVE_PER_USER} updates at a time.` });
      if (parsed.data.kind === "photo") {
        // Offers are meant to be seen by every customer, like catalog photos.
        const path = parsed.data.mediaUrl!;
        if (!path.startsWith("/objects/")) return res.status(400).json({ error: "Invalid photo." });
        try {
          const file = await new ObjectStorageService().getObjectEntityFile(path);
          const existing = await getObjectAclPolicy(file);
          if (existing && existing.owner !== String(req.user!.id)) return res.status(403).json({ error: "This photo belongs to someone else." });
          await setObjectAclPolicy(file, { owner: String(req.user!.id), visibility: "public" });
        } catch (err) {
          if (err instanceof ObjectNotFoundError) return res.status(400).json({ error: "The photo was not uploaded. Please try again." });
          throw err;
        }
      }
      const [org] = await db.select({ settings: organizations.settings }).from(organizations).where(eq(organizations.id, businessId));
      const [me] = await db.select({ language: users.preferredLanguage }).from(users).where(eq(users.id, req.user!.id));
      const language = (org?.settings as { language?: string } | null)?.language ?? me?.language;
      const [post] = await db.insert(statusPosts).values({
        userId: req.user!.id,
        businessId,
        kind: parsed.data.kind,
        textContent: parsed.data.text || null,
        mediaUrl: parsed.data.kind === "photo" ? parsed.data.mediaUrl! : null,
        background: parsed.data.kind === "text" ? (parsed.data.background ?? "#1E66F5") : null,
        originalLanguage: baseLanguage(language),
        expiresAt: new Date(Date.now() + DAY_MS),
      }).returning();
      return res.status(201).json({ status: post, audienceSize: await businessAudienceSize(businessId) });
    } catch (error) {
      console.error("[Status] business post failed:", error);
      return res.status(500).json({ error: "Could not post the update." });
    }
  });

  // The business's live updates, with how many customers viewed each.
  app.get("/api/business/:businessId/status", ...team, async (req: Request, res: Response) => {
    const businessId = businessIdOf(req);
    if (!businessId) return res.status(400).json({ error: "Invalid business." });
    const posts = await db.select().from(statusPosts)
      .where(and(eq(statusPosts.businessId, businessId), gt(statusPosts.expiresAt, new Date())))
      .orderBy(statusPosts.createdAt);
    const counts = posts.length
      ? await db.select({ statusId: statusViews.statusId, n: sql<number>`count(*)::int` }).from(statusViews)
          .where(inArray(statusViews.statusId, posts.map((p) => p.id))).groupBy(statusViews.statusId)
      : [];
    const byId = new Map(counts.map((c) => [c.statusId, c.n]));
    return res.json({
      updates: posts.map((p) => ({
        id: p.id, kind: p.kind, text: p.textContent, mediaUrl: p.mediaUrl, background: p.background,
        createdAt: p.createdAt, expiresAt: p.expiresAt, viewCount: byId.get(p.id) ?? 0,
      })),
      audienceSize: await businessAudienceSize(businessId),
    });
  });

  app.delete("/api/business/:businessId/status/:id", ...team, async (req: Request, res: Response) => {
    const businessId = businessIdOf(req);
    const id = Number(req.params.id);
    if (!businessId || !Number.isSafeInteger(id) || id <= 0) return res.status(400).json({ error: "Invalid status." });
    const deleted = await db.delete(statusPosts).where(and(eq(statusPosts.id, id), eq(statusPosts.businessId, businessId))).returning({ id: statusPosts.id });
    if (deleted.length === 0) return res.status(404).json({ error: "Not found." });
    return res.json({ success: true });
  });

  // Updates really disappear after 24 hours.
  const timer = setInterval(() => { deleteExpiredStatuses().catch(() => undefined); }, 15 * 60 * 1000);
  timer.unref?.();
}
