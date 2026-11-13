/**
 * Group invite links (like WhatsApp "Invite via link").
 *
 * A group admin turns on a link: neuratalk.in/g/<code>. Anyone with a
 * NeuraTalk account who opens it sees the group's name and size, then joins.
 * The admin can make a new link (the old one stops working) or turn it off.
 * Someone an admin removed can't come back through the link; an admin can
 * still add them by hand. Only admins ever see the code.
 */
import { Router, type Request, type Response } from "express";
import crypto from "crypto";
import { and, eq, sql } from "drizzle-orm";
import { db } from "./db";
import { groupChatMembers, groupChats, users } from "@shared/schema";
import { requireAuth } from "./role-middleware";
import { isSenderBlockedInGroup } from "./group-chat-blocking";

const router = Router();
export const MAX_GROUP_MEMBERS = 1024;
const PUBLIC_BASE = "https://neuratalk.in";

export async function ensureGroupInviteTables(): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "group_invite_links" (
      "group_id" integer PRIMARY KEY REFERENCES "group_chats"("id") ON DELETE CASCADE,
      "code" text NOT NULL,
      "created_by" integer REFERENCES "users"("id") ON DELETE SET NULL,
      "join_count" integer NOT NULL DEFAULT 0,
      "created_at" timestamp NOT NULL DEFAULT now()
    )`);
  await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS "group_invite_links_code" ON "group_invite_links" ("code")`);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "group_removed_members" (
      "group_id" integer NOT NULL REFERENCES "group_chats"("id") ON DELETE CASCADE,
      "user_id" integer NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
      "removed_by" integer,
      "removed_at" timestamp NOT NULL DEFAULT now(),
      PRIMARY KEY ("group_id", "user_id")
    )`);
}

const newCode = () => crypto.randomBytes(12).toString("base64url");
export const inviteUrl = (code: string) => `${PUBLIC_BASE}/g/${code}`;

const idOf = (v: unknown) => {
  const n = Number(v);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
};

/** Accepts a bare code or any link that ends in /g/<code>. */
export function codeFromInput(input: string): string | null {
  const s = String(input ?? "").trim();
  const m = s.match(/\/g\/([A-Za-z0-9_-]{8,64})(?:[/?#].*)?$/) ?? s.match(/^([A-Za-z0-9_-]{8,64})$/);
  return m ? m[1] : null;
}

async function myRole(groupId: number, userId: number): Promise<string | null> {
  const [m] = await db.select({ role: groupChatMembers.role }).from(groupChatMembers)
    .where(and(eq(groupChatMembers.groupChatId, groupId), eq(groupChatMembers.userId, userId)));
  return m?.role ?? null;
}

async function activeGroup(groupId: number) {
  const [g] = await db.select().from(groupChats).where(and(eq(groupChats.id, groupId), eq(groupChats.isActive, true)));
  return g ?? null;
}

async function linkOf(groupId: number): Promise<{ code: string; join_count: number; created_at: string } | null> {
  const r = await db.execute(sql`SELECT code, join_count, created_at FROM group_invite_links WHERE group_id = ${groupId}`);
  return (r.rows[0] as any) ?? null;
}

async function memberCount(groupId: number): Promise<number> {
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(groupChatMembers).where(eq(groupChatMembers.groupChatId, groupId));
  return n;
}

/** Called when an admin removes someone, so the link can't bring them back. */
export async function recordGroupRemoval(groupId: number, userId: number, removedBy: number): Promise<void> {
  await db.execute(sql`
    INSERT INTO group_removed_members (group_id, user_id, removed_by) VALUES (${groupId}, ${userId}, ${removedBy})
    ON CONFLICT (group_id, user_id) DO UPDATE SET removed_by = EXCLUDED.removed_by, removed_at = now()`);
}

/** An admin added them back by hand: the removal no longer applies. */
export async function clearGroupRemoval(groupId: number, userId: number): Promise<void> {
  await db.execute(sql`DELETE FROM group_removed_members WHERE group_id = ${groupId} AND user_id = ${userId}`);
}

async function requireGroupAdmin(req: Request, res: Response): Promise<number | null> {
  const groupId = idOf(req.params.groupId);
  if (!groupId) { res.status(400).json({ error: "Invalid group." }); return null; }
  const g = await activeGroup(groupId);
  if (!g) { res.status(404).json({ error: "Group not found." }); return null; }
  if (g.communityId && g.id === (await announcementOf(g.communityId))) {
    res.status(400).json({ error: "Share the community's invite instead." });
    return null;
  }
  if ((await myRole(groupId, req.user!.id)) !== "admin") { res.status(403).json({ error: "Only group admins can manage the invite link." }); return null; }
  return groupId;
}

async function announcementOf(communityId: number): Promise<number | null> {
  const r = await db.execute(sql`SELECT announcement_group_id FROM communities WHERE id = ${communityId}`);
  return ((r.rows[0] as any)?.announcement_group_id as number) ?? null;
}

const linkJson = (l: { code: string; join_count: number; created_at: string } | null) =>
  l ? { enabled: true, code: l.code, url: inviteUrl(l.code), joins: Number(l.join_count), createdAt: l.created_at } : { enabled: false, code: null, url: null, joins: 0, createdAt: null };

/**
 * Android App Links: lets neuratalk.in/g/<code> open the NeuraTalk app
 * directly. ANDROID_APP_SHA256 = the Play app-signing certificate
 * fingerprint(s) (Play Console → App integrity), comma-separated.
 * Without it, links open the website, which offers "Open in the app".
 */
router.get("/.well-known/assetlinks.json", (_req, res) => {
  const fingerprints = String(process.env.ANDROID_APP_SHA256 ?? "").split(",").map((s) => s.trim().toUpperCase())
    .filter((s) => /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/.test(s));
  res.setHeader("Cache-Control", "public, max-age=3600");
  res.json(fingerprints.length ? ["com.Mindwhile.neuratalk", "com.Mindwhile.neuratalk.business"].map((pkg) => ({
    relation: ["delegate_permission/common.handle_all_urls"],
    target: { namespace: "android_app", package_name: pkg, sha256_cert_fingerprints: fingerprints },
  })) : []);
});

// ---------------------------------------------------------------- admin
router.get("/api/group-chats/:groupId/invite-link", requireAuth, async (req, res) => {
  const groupId = await requireGroupAdmin(req, res);
  if (!groupId) return;
  res.json({ success: true, link: linkJson(await linkOf(groupId)) });
});

/** Turn the link on, or make a new one (the old link stops working). */
router.post("/api/group-chats/:groupId/invite-link", requireAuth, async (req, res) => {
  const groupId = await requireGroupAdmin(req, res);
  if (!groupId) return;
  const code = newCode();
  await db.execute(sql`
    INSERT INTO group_invite_links (group_id, code, created_by) VALUES (${groupId}, ${code}, ${req.user!.id})
    ON CONFLICT (group_id) DO UPDATE SET code = EXCLUDED.code, created_by = EXCLUDED.created_by, join_count = 0, created_at = now()`);
  res.status(201).json({ success: true, link: linkJson(await linkOf(groupId)) });
});

router.delete("/api/group-chats/:groupId/invite-link", requireAuth, async (req, res) => {
  const groupId = await requireGroupAdmin(req, res);
  if (!groupId) return;
  await db.execute(sql`DELETE FROM group_invite_links WHERE group_id = ${groupId}`);
  res.json({ success: true, link: linkJson(null) });
});

// ---------------------------------------------------------------- anyone signed in
async function groupForCode(code: string) {
  const r = await db.execute(sql`
    SELECT l.group_id FROM group_invite_links l JOIN group_chats g ON g.id = l.group_id
    WHERE l.code = ${code} AND g.is_active = true`);
  const groupId = (r.rows[0] as any)?.group_id as number | undefined;
  return groupId ? activeGroup(groupId) : null;
}

/** What the person sees before joining. */
router.get("/api/group-invites/:code", requireAuth, async (req, res) => {
  const code = codeFromInput(req.params.code);
  const g = code ? await groupForCode(code) : null;
  if (!g) return res.status(404).json({ error: "This invite link isn't valid any more. Ask the group admin for a new one." });
  const [creator] = await db.select({ name: sql<string>`coalesce(nullif(trim(${users.displayName}), ''), ${users.username})` })
    .from(users).where(eq(users.id, g.createdById!));
  res.json({
    success: true,
    group: {
      id: g.id, name: g.name, description: g.description, members: await memberCount(g.id),
      createdBy: creator?.name ?? null, alreadyMember: !!(await myRole(g.id, req.user!.id)),
    },
  });
});

router.post("/api/group-invites/:code/join", requireAuth, async (req, res) => {
  const code = codeFromInput(req.params.code);
  const g = code ? await groupForCode(code) : null;
  if (!g) return res.status(404).json({ error: "This invite link isn't valid any more. Ask the group admin for a new one." });
  const userId = req.user!.id;
  if (await myRole(g.id, userId)) return res.json({ success: true, groupId: g.id, alreadyMember: true });
  const removed = await db.execute(sql`SELECT 1 FROM group_removed_members WHERE group_id = ${g.id} AND user_id = ${userId}`);
  if (removed.rows.length) return res.status(403).json({ error: "An admin removed you from this group. Ask an admin to add you back." });
  if (await isSenderBlockedInGroup(g.id, userId)) return res.status(403).json({ error: "You can't join this group." });
  if ((await memberCount(g.id)) >= MAX_GROUP_MEMBERS) return res.status(400).json({ error: `This group is full (${MAX_GROUP_MEMBERS} members).` });
  const [u] = await db.select({ l: users.preferredLanguage }).from(users).where(eq(users.id, userId));
  const inserted = await db.insert(groupChatMembers).values({ groupChatId: g.id, userId, preferredLanguage: u?.l || "en", role: "member" })
    .onConflictDoNothing().returning({ id: groupChatMembers.id });
  if (inserted.length) {
    await db.execute(sql`UPDATE group_invite_links SET join_count = join_count + 1 WHERE group_id = ${g.id}`);
    // A group inside a community: joining it makes you part of the community too.
    if (g.communityId) {
      await db.execute(sql`INSERT INTO community_members (community_id, user_id) VALUES (${g.communityId}, ${userId}) ON CONFLICT DO NOTHING`);
      const ann = await announcementOf(g.communityId);
      if (ann) await db.insert(groupChatMembers).values({ groupChatId: ann, userId, preferredLanguage: u?.l || "en", role: "member" }).onConflictDoNothing();
    }
  }
  res.status(201).json({ success: true, groupId: g.id, name: g.name });
});

export default router;
