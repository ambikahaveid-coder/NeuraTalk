/**
 * Communities (like WhatsApp Communities): several groups under one roof,
 * with an announcement group where only admins post. People join with an
 * invite code, then join any group in the community.
 * Also: the "only admins can send messages" setting for any group.
 */
import { Router, type Request, type Response } from "express";
import crypto from "crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "./db";
import { communities, communityGroups, communityMembers, groupChatMembers, groupChats, users } from "@shared/schema";
import { requireAuth } from "./role-middleware";

const router = Router();
const MAX_GROUPS = 50;

export async function ensureCommunityTables(): Promise<void> {
  await db.execute(sql`ALTER TABLE "group_chats" ADD COLUMN IF NOT EXISTS "only_admins_send" boolean NOT NULL DEFAULT false`);
  await db.execute(sql`ALTER TABLE "group_chats" ADD COLUMN IF NOT EXISTS "community_id" integer`);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "communities" (
      "id" serial PRIMARY KEY NOT NULL,
      "name" text NOT NULL,
      "description" text,
      "created_by" integer NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
      "announcement_group_id" integer,
      "invite_code" text NOT NULL,
      "is_active" boolean NOT NULL DEFAULT true,
      "created_at" timestamp DEFAULT now()
    )`);
  await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS "communities_invite_code" ON "communities" ("invite_code")`);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "community_members" (
      "id" serial PRIMARY KEY NOT NULL,
      "community_id" integer NOT NULL REFERENCES "communities"("id") ON DELETE CASCADE,
      "user_id" integer NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
      "role" text NOT NULL DEFAULT 'member',
      "joined_at" timestamp DEFAULT now()
    )`);
  await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS "community_members_unique" ON "community_members" ("community_id", "user_id")`);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "community_groups" (
      "id" serial PRIMARY KEY NOT NULL,
      "community_id" integer NOT NULL REFERENCES "communities"("id") ON DELETE CASCADE,
      "group_id" integer NOT NULL REFERENCES "group_chats"("id") ON DELETE CASCADE,
      "added_at" timestamp DEFAULT now()
    )`);
  await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS "community_groups_unique" ON "community_groups" ("community_id", "group_id")`);
}

const idOf = (v: unknown) => {
  const n = Number(v);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
};
const inviteCode = () => crypto.randomBytes(9).toString("base64url");

async function memberRole(communityId: number, userId: number) {
  const [m] = await db.select().from(communityMembers).where(and(eq(communityMembers.communityId, communityId), eq(communityMembers.userId, userId)));
  return m?.role ?? null;
}

async function activeCommunity(id: number) {
  const [c] = await db.select().from(communities).where(and(eq(communities.id, id), eq(communities.isActive, true)));
  return c ?? null;
}

async function addToGroup(groupId: number, userId: number, role: "admin" | "member" = "member") {
  const [u] = await db.select({ l: users.preferredLanguage }).from(users).where(eq(users.id, userId));
  await db.insert(groupChatMembers).values({ groupChatId: groupId, userId, preferredLanguage: u?.l || "en", role }).onConflictDoNothing();
}

// ---------------------------------------------------------------- group setting
/** Group admins: only admins can send messages (announcement-style group). */
router.patch("/api/group-chats/:groupId/settings", requireAuth, async (req: Request, res: Response) => {
  const groupId = idOf(req.params.groupId);
  const parsed = z.object({ onlyAdminsSend: z.boolean() }).safeParse(req.body ?? {});
  if (!groupId || !parsed.success) return res.status(400).json({ error: "Invalid request." });
  const [me] = await db.select().from(groupChatMembers).where(and(eq(groupChatMembers.groupChatId, groupId), eq(groupChatMembers.userId, req.user!.id)));
  if (me?.role !== "admin") return res.status(403).json({ error: "Only group admins can change this." });
  await db.update(groupChats).set({ onlyAdminsSend: parsed.data.onlyAdminsSend, updatedAt: new Date() }).where(eq(groupChats.id, groupId));
  res.json({ success: true, onlyAdminsSend: parsed.data.onlyAdminsSend });
});

/** Used by the group send routes. */
export async function mayPostInGroup(groupId: number, userId: number): Promise<boolean> {
  const [g] = await db.select({ onlyAdminsSend: groupChats.onlyAdminsSend }).from(groupChats).where(eq(groupChats.id, groupId));
  if (!g?.onlyAdminsSend) return true;
  const [m] = await db.select({ role: groupChatMembers.role }).from(groupChatMembers).where(and(eq(groupChatMembers.groupChatId, groupId), eq(groupChatMembers.userId, userId)));
  return m?.role === "admin";
}

// ---------------------------------------------------------------- communities
router.post("/api/communities", requireAuth, async (req: Request, res: Response) => {
  const parsed = z.object({ name: z.string().trim().min(3).max(60), description: z.string().trim().max(500).optional() }).safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Check the details." });
  const userId = req.user!.id;
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(communities).where(and(eq(communities.createdBy, userId), eq(communities.isActive, true)));
  if (n >= 10) return res.status(400).json({ error: "You can create up to 10 communities." });
  const result = await db.transaction(async (tx) => {
    const [c] = await tx.insert(communities).values({ name: parsed.data.name, description: parsed.data.description ?? null, createdBy: userId, inviteCode: inviteCode() }).returning();
    const [announce] = await tx.insert(groupChats).values({
      name: `📢 ${parsed.data.name}`, description: "Announcements from the community admins", createdById: userId,
      isTranslationEnabled: true, isActive: true, onlyAdminsSend: true, communityId: c.id,
    }).returning();
    const [u] = await tx.select({ l: users.preferredLanguage }).from(users).where(eq(users.id, userId));
    await tx.insert(groupChatMembers).values({ groupChatId: announce.id, userId, preferredLanguage: u?.l || "en", role: "admin" });
    await tx.insert(communityMembers).values({ communityId: c.id, userId, role: "admin" });
    const [updated] = await tx.update(communities).set({ announcementGroupId: announce.id }).where(eq(communities.id, c.id)).returning();
    return updated;
  });
  res.status(201).json({ success: true, community: result });
});

router.get("/api/communities", requireAuth, async (req: Request, res: Response) => {
  const mine = await db.select({ communityId: communityMembers.communityId, role: communityMembers.role }).from(communityMembers).where(eq(communityMembers.userId, req.user!.id));
  if (!mine.length) return res.json({ success: true, communities: [] });
  const rows = await db.select().from(communities).where(and(inArray(communities.id, mine.map((m) => m.communityId)), eq(communities.isActive, true)));
  const counts = await db.select({ id: communityMembers.communityId, n: sql<number>`count(*)::int` }).from(communityMembers)
    .where(inArray(communityMembers.communityId, rows.map((r) => r.id).length ? rows.map((r) => r.id) : [0])).groupBy(communityMembers.communityId);
  res.json({
    success: true,
    communities: rows.map((c) => ({
      id: c.id, name: c.name, description: c.description, announcementGroupId: c.announcementGroupId,
      role: mine.find((m) => m.communityId === c.id)?.role, members: counts.find((x) => x.id === c.id)?.n ?? 0,
    })),
  });
});

router.get("/api/communities/:id", requireAuth, async (req: Request, res: Response) => {
  const id = idOf(req.params.id);
  if (!id) return res.status(400).json({ error: "Invalid community." });
  const c = await activeCommunity(id);
  const role = c ? await memberRole(id, req.user!.id) : null;
  if (!c || !role) return res.status(404).json({ error: "Community not found." });
  const links = await db.select({ groupId: communityGroups.groupId }).from(communityGroups).where(eq(communityGroups.communityId, id));
  const groupIds = links.map((l) => l.groupId);
  const groups = groupIds.length ? await db.select().from(groupChats).where(and(inArray(groupChats.id, groupIds), eq(groupChats.isActive, true))) : [];
  const myGroups = groupIds.length ? await db.select({ g: groupChatMembers.groupChatId }).from(groupChatMembers)
    .where(and(eq(groupChatMembers.userId, req.user!.id), inArray(groupChatMembers.groupChatId, groupIds))) : [];
  const memberCounts = groupIds.length ? await db.select({ g: groupChatMembers.groupChatId, n: sql<number>`count(*)::int` }).from(groupChatMembers)
    .where(inArray(groupChatMembers.groupChatId, groupIds)).groupBy(groupChatMembers.groupChatId) : [];
  const [{ members }] = await db.select({ members: sql<number>`count(*)::int` }).from(communityMembers).where(eq(communityMembers.communityId, id));
  res.json({
    success: true,
    community: {
      id: c.id, name: c.name, description: c.description, announcementGroupId: c.announcementGroupId, role, members,
      isCreator: c.createdBy === req.user!.id,
      // Only admins see and share the invite code.
      inviteCode: role === "admin" ? c.inviteCode : null,
    },
    groups: groups.map((g) => ({
      id: g.id, name: g.name, description: g.description,
      members: memberCounts.find((m) => m.g === g.id)?.n ?? 0, joined: myGroups.some((m) => m.g === g.id),
    })),
  });
});

router.patch("/api/communities/:id", requireAuth, async (req: Request, res: Response) => {
  const id = idOf(req.params.id);
  const parsed = z.object({ name: z.string().trim().min(3).max(60).optional(), description: z.string().trim().max(500).optional() }).safeParse(req.body ?? {});
  if (!id || !parsed.success) return res.status(400).json({ error: "Check the details." });
  if ((await memberRole(id, req.user!.id)) !== "admin") return res.status(403).json({ error: "Only community admins can do this." });
  await db.update(communities).set(parsed.data).where(eq(communities.id, id));
  res.json({ success: true });
});

router.delete("/api/communities/:id", requireAuth, async (req: Request, res: Response) => {
  const id = idOf(req.params.id);
  if (!id) return res.status(400).json({ error: "Invalid community." });
  const c = await activeCommunity(id);
  if (!c || c.createdBy !== req.user!.id) return res.status(403).json({ error: "Only the person who created the community can delete it." });
  // The groups stay as normal groups; the announcement group ends with the community.
  await db.update(communities).set({ isActive: false }).where(eq(communities.id, id));
  if (c.announcementGroupId) await db.update(groupChats).set({ isActive: false }).where(eq(groupChats.id, c.announcementGroupId));
  await db.update(groupChats).set({ communityId: null }).where(eq(groupChats.communityId, id));
  res.json({ success: true });
});

/** A new invite code; the old one stops working. */
router.post("/api/communities/:id/invite-code", requireAuth, async (req: Request, res: Response) => {
  const id = idOf(req.params.id);
  if (!id) return res.status(400).json({ error: "Invalid community." });
  if ((await memberRole(id, req.user!.id)) !== "admin") return res.status(403).json({ error: "Only community admins can do this." });
  const code = inviteCode();
  await db.update(communities).set({ inviteCode: code }).where(eq(communities.id, id));
  res.json({ success: true, inviteCode: code });
});

/** Join with an invite code: you join the community and its announcement group. */
router.post("/api/communities/join", requireAuth, async (req: Request, res: Response) => {
  const parsed = z.object({ code: z.string().trim().min(6).max(300) }).safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: "Enter the invite code." });
  let code = parsed.data.code;
  try { code = new URL(code).searchParams.get("code") ?? code; } catch { /* plain code */ }
  const [c] = await db.select().from(communities).where(and(eq(communities.inviteCode, code), eq(communities.isActive, true)));
  if (!c) return res.status(404).json({ error: "That invite isn't valid any more." });
  await db.insert(communityMembers).values({ communityId: c.id, userId: req.user!.id }).onConflictDoNothing();
  if (c.announcementGroupId) await addToGroup(c.announcementGroupId, req.user!.id);
  res.json({ success: true, community: { id: c.id, name: c.name } });
});

router.post("/api/communities/:id/leave", requireAuth, async (req: Request, res: Response) => {
  const id = idOf(req.params.id);
  if (!id) return res.status(400).json({ error: "Invalid community." });
  const c = await activeCommunity(id);
  if (!c) return res.status(404).json({ error: "Community not found." });
  if (c.createdBy === req.user!.id) return res.status(400).json({ error: "You created this community. Delete it instead, or make another admin first." });
  await db.delete(communityMembers).where(and(eq(communityMembers.communityId, id), eq(communityMembers.userId, req.user!.id)));
  // Leave the announcement group and every group of the community.
  const links = await db.select({ g: communityGroups.groupId }).from(communityGroups).where(eq(communityGroups.communityId, id));
  const ids = [...links.map((l) => l.g), ...(c.announcementGroupId ? [c.announcementGroupId] : [])];
  if (ids.length) await db.delete(groupChatMembers).where(and(eq(groupChatMembers.userId, req.user!.id), inArray(groupChatMembers.groupChatId, ids)));
  res.json({ success: true });
});

/** Admin: add one of your groups (you must be its admin). */
router.post("/api/communities/:id/groups", requireAuth, async (req: Request, res: Response) => {
  const id = idOf(req.params.id);
  const parsed = z.object({ groupId: z.number().int().positive() }).safeParse(req.body ?? {});
  if (!id || !parsed.success) return res.status(400).json({ error: "Pick a group." });
  if ((await memberRole(id, req.user!.id)) !== "admin") return res.status(403).json({ error: "Only community admins can add groups." });
  const [g] = await db.select().from(groupChats).where(and(eq(groupChats.id, parsed.data.groupId), eq(groupChats.isActive, true)));
  const [me] = g ? await db.select().from(groupChatMembers).where(and(eq(groupChatMembers.groupChatId, g.id), eq(groupChatMembers.userId, req.user!.id))) : [];
  if (!g || me?.role !== "admin") return res.status(403).json({ error: "You can only add groups where you are an admin." });
  if (g.communityId && g.communityId !== id) return res.status(400).json({ error: "That group is already in another community." });
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(communityGroups).where(eq(communityGroups.communityId, id));
  if (n >= MAX_GROUPS) return res.status(400).json({ error: `A community can have up to ${MAX_GROUPS} groups.` });
  await db.insert(communityGroups).values({ communityId: id, groupId: g.id }).onConflictDoNothing();
  await db.update(groupChats).set({ communityId: id }).where(eq(groupChats.id, g.id));
  // Everyone already in the group becomes part of the community.
  const members = await db.select({ userId: groupChatMembers.userId }).from(groupChatMembers).where(eq(groupChatMembers.groupChatId, g.id));
  const c = await activeCommunity(id);
  for (const m of members) {
    await db.insert(communityMembers).values({ communityId: id, userId: m.userId }).onConflictDoNothing();
    if (c?.announcementGroupId) await addToGroup(c.announcementGroupId, m.userId);
  }
  res.status(201).json({ success: true });
});

router.delete("/api/communities/:id/groups/:groupId", requireAuth, async (req: Request, res: Response) => {
  const id = idOf(req.params.id);
  const groupId = idOf(req.params.groupId);
  if (!id || !groupId) return res.status(400).json({ error: "Invalid request." });
  if ((await memberRole(id, req.user!.id)) !== "admin") return res.status(403).json({ error: "Only community admins can remove groups." });
  await db.delete(communityGroups).where(and(eq(communityGroups.communityId, id), eq(communityGroups.groupId, groupId)));
  await db.update(groupChats).set({ communityId: null }).where(and(eq(groupChats.id, groupId), eq(groupChats.communityId, id)));
  res.json({ success: true });
});

/** Member: join a group inside the community. */
router.post("/api/communities/:id/groups/:groupId/join", requireAuth, async (req: Request, res: Response) => {
  const id = idOf(req.params.id);
  const groupId = idOf(req.params.groupId);
  if (!id || !groupId) return res.status(400).json({ error: "Invalid request." });
  if (!(await memberRole(id, req.user!.id))) return res.status(403).json({ error: "Join the community first." });
  const [link] = await db.select().from(communityGroups).where(and(eq(communityGroups.communityId, id), eq(communityGroups.groupId, groupId)));
  if (!link) return res.status(404).json({ error: "That group isn't in this community." });
  const { isSenderBlockedInGroup } = await import("./group-chat-blocking");
  if (await isSenderBlockedInGroup(groupId, req.user!.id)) return res.status(403).json({ error: "You can't join this group." });
  await addToGroup(groupId, req.user!.id);
  res.json({ success: true });
});

/** Admin: remove someone from the community (and its groups). */
router.delete("/api/communities/:id/members/:userId", requireAuth, async (req: Request, res: Response) => {
  const id = idOf(req.params.id);
  const userId = idOf(req.params.userId);
  if (!id || !userId) return res.status(400).json({ error: "Invalid request." });
  if ((await memberRole(id, req.user!.id)) !== "admin") return res.status(403).json({ error: "Only community admins can remove people." });
  const c = await activeCommunity(id);
  if (!c || c.createdBy === userId) return res.status(400).json({ error: "The community's creator can't be removed." });
  await db.delete(communityMembers).where(and(eq(communityMembers.communityId, id), eq(communityMembers.userId, userId)));
  const links = await db.select({ g: communityGroups.groupId }).from(communityGroups).where(eq(communityGroups.communityId, id));
  const ids = [...links.map((l) => l.g), ...(c.announcementGroupId ? [c.announcementGroupId] : [])];
  if (ids.length) await db.delete(groupChatMembers).where(and(eq(groupChatMembers.userId, userId), inArray(groupChatMembers.groupChatId, ids)));
  res.json({ success: true });
});

export default router;
