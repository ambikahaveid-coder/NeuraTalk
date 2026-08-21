import { Router, type Request, type Response } from "express";
import { and, eq, inArray, or } from "drizzle-orm";
import { z } from "zod";
import { db } from "./db";
import { blockedUsers, users } from "@shared/schema";
import { requireAuth } from "./role-middleware";

const router = Router();

/** True if either user has blocked the other -- callers should treat this
 * as "these two people cannot message or call each other" regardless of
 * which direction the block was made in. */
export async function isBlocked(userAId: number, userBId: number): Promise<boolean> {
  const [row] = await db.select({ id: blockedUsers.id }).from(blockedUsers).where(or(
    and(eq(blockedUsers.blockerUserId, userAId), eq(blockedUsers.blockedUserId, userBId)),
    and(eq(blockedUsers.blockerUserId, userBId), eq(blockedUsers.blockedUserId, userAId)),
  ));
  return Boolean(row);
}

router.post("/api/users/:userId/block", requireAuth, async (req: Request, res: Response) => {
  try {
    const blockerUserId = req.user!.id;
    const blockedUserId = Number(req.params.userId);
    if (!Number.isFinite(blockedUserId) || blockedUserId === blockerUserId) {
      return res.status(400).json({ error: "Invalid user." });
    }
    const [target] = await db.select({ id: users.id }).from(users).where(eq(users.id, blockedUserId));
    if (!target) return res.status(404).json({ error: "User not found." });

    await db.insert(blockedUsers)
      .values({ blockerUserId, blockedUserId })
      .onConflictDoNothing();

    res.json({ success: true });
  } catch (error) {
    console.error("[Blocking] block failed:", error);
    res.status(500).json({ error: "Failed to block user." });
  }
});

router.delete("/api/users/:userId/block", requireAuth, async (req: Request, res: Response) => {
  try {
    const blockerUserId = req.user!.id;
    const blockedUserId = Number(req.params.userId);
    if (!Number.isFinite(blockedUserId)) return res.status(400).json({ error: "Invalid user." });

    await db.delete(blockedUsers).where(and(
      eq(blockedUsers.blockerUserId, blockerUserId),
      eq(blockedUsers.blockedUserId, blockedUserId),
    ));

    res.json({ success: true });
  } catch (error) {
    console.error("[Blocking] unblock failed:", error);
    res.status(500).json({ error: "Failed to unblock user." });
  }
});

router.get("/api/users/blocked", requireAuth, async (req: Request, res: Response) => {
  try {
    const blockerUserId = req.user!.id;
    const rows = await db.select({ blockedUserId: blockedUsers.blockedUserId, createdAt: blockedUsers.createdAt })
      .from(blockedUsers)
      .where(eq(blockedUsers.blockerUserId, blockerUserId));

    const userIds = rows.map((r) => r.blockedUserId);
    const blockedUserRows = userIds.length > 0
      ? await db.select({ id: users.id, username: users.username, avatarUrl: users.avatarUrl }).from(users).where(inArray(users.id, userIds))
      : [];

    res.json({
      blocked: rows.map((r) => ({
        ...blockedUserRows.find((u) => u.id === r.blockedUserId),
        blockedAt: r.createdAt,
      })),
    });
  } catch (error) {
    console.error("[Blocking] list failed:", error);
    res.status(500).json({ error: "Failed to list blocked users." });
  }
});

router.get("/api/users/:userId/blocked-status", requireAuth, async (req: Request, res: Response) => {
  try {
    const viewerId = req.user!.id;
    const otherUserId = Number(req.params.userId);
    if (!Number.isFinite(otherUserId)) return res.status(400).json({ error: "Invalid user." });

    const [iBlockedThem] = await db.select({ id: blockedUsers.id }).from(blockedUsers).where(and(
      eq(blockedUsers.blockerUserId, viewerId), eq(blockedUsers.blockedUserId, otherUserId),
    ));
    const [theyBlockedMe] = await db.select({ id: blockedUsers.id }).from(blockedUsers).where(and(
      eq(blockedUsers.blockerUserId, otherUserId), eq(blockedUsers.blockedUserId, viewerId),
    ));

    res.json({ blockedByMe: Boolean(iBlockedThem), blockedByThem: Boolean(theyBlockedMe) });
  } catch (error) {
    console.error("[Blocking] status check failed:", error);
    res.status(500).json({ error: "Failed to check block status." });
  }
});

export default router;
