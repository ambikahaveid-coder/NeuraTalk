import { Request, Response, Router } from "express";
import { db } from "./db";
import { userSessions, users, organizations } from "@shared/schema";
import { eq, and, desc, lt, gt } from "drizzle-orm";
import { requireAuth, requireRole } from "./role-middleware";

const DEFAULT_MAX_SESSIONS = 5;
const ENTERPRISE_MAX_SESSIONS = 10;

async function getMaxSessions(organizationId: number | null): Promise<number> {
  if (!organizationId) {
    return DEFAULT_MAX_SESSIONS;
  }

  const [org] = await db.select().from(organizations).where(eq(organizations.id, organizationId));
  
  if (!org) {
    return DEFAULT_MAX_SESSIONS;
  }

  const settings = org.settings as any || {};
  
  if (settings.maxSessionsPerUser) {
    return settings.maxSessionsPerUser;
  }

  if (org.plan === "enterprise") {
    return ENTERPRISE_MAX_SESSIONS;
  }

  return DEFAULT_MAX_SESSIONS;
}

const revokedTokens = new Set<string>();
const TOKEN_REVOCATION_TTL = 24 * 60 * 60 * 1000;

export function isTokenRevoked(token: string): boolean {
  return revokedTokens.has(token);
}

function revokeToken(token: string): void {
  revokedTokens.add(token);
  setTimeout(() => revokedTokens.delete(token), TOKEN_REVOCATION_TTL);
}

export async function enforceConcurrentSessionLimit(userId: number, organizationId: number | null): Promise<void> {
  const maxSessions = await getMaxSessions(organizationId);

  const activeSessions = await db.select()
    .from(userSessions)
    .where(and(
      eq(userSessions.userId, userId),
      gt(userSessions.expiresAt, new Date())
    ))
    .orderBy(desc(userSessions.lastActivityAt));

  if (activeSessions.length >= maxSessions) {
    const sessionsToRemove = activeSessions.slice(maxSessions - 1);
    for (const session of sessionsToRemove) {
      revokeToken(session.token);
      await db.delete(userSessions).where(eq(userSessions.id, session.id));
    }
  }
}

export async function forceLogoutUser(userId: number, _reason?: string): Promise<number> {
  const sessions = await db.select()
    .from(userSessions)
    .where(eq(userSessions.userId, userId));
  
  for (const session of sessions) {
    revokeToken(session.token);
  }
  
  const result = await db.delete(userSessions)
    .where(eq(userSessions.userId, userId))
    .returning();

  return result.length;
}

export async function forceLogoutSession(sessionId: number): Promise<boolean> {
  const [session] = await db.select()
    .from(userSessions)
    .where(eq(userSessions.id, sessionId));
  
  if (session) {
    revokeToken(session.token);
  }
  
  const result = await db.delete(userSessions)
    .where(eq(userSessions.id, sessionId))
    .returning();

  return result.length > 0;
}

export async function forceLogoutAllExceptCurrent(userId: number, currentToken: string): Promise<number> {
  const allSessions = await db.select()
    .from(userSessions)
    .where(eq(userSessions.userId, userId));
  
  const sessionsToRevoke = allSessions.filter(s => s.token !== currentToken);
  
  for (const session of sessionsToRevoke) {
    revokeToken(session.token);
  }
  
  const result = await db.delete(userSessions)
    .where(and(
      eq(userSessions.userId, userId),
      lt(userSessions.token, currentToken)
    ))
    .returning();

  const result2 = await db.delete(userSessions)
    .where(and(
      eq(userSessions.userId, userId),
      gt(userSessions.token, currentToken)
    ))
    .returning();

  return result.length + result2.length;
}

const router = Router();

router.get("/api/sessions", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;

    const sessions = await db.select({
      id: userSessions.id,
      userAgent: userSessions.userAgent,
      ipAddress: userSessions.ipAddress,
      createdAt: userSessions.createdAt,
      lastActivityAt: userSessions.lastActivityAt,
      expiresAt: userSessions.expiresAt,
    })
      .from(userSessions)
      .where(and(
        eq(userSessions.userId, userId),
        gt(userSessions.expiresAt, new Date())
      ))
      .orderBy(desc(userSessions.lastActivityAt));

    const authHeader = req.headers.authorization;
    const currentToken = authHeader?.replace("Bearer ", "") || "";

    const sessionsWithCurrent = sessions.map(session => ({
      ...session,
      isCurrent: false
    }));

    const maxSessions = await getMaxSessions(req.user!.organizationId);

    res.json({
      sessions: sessionsWithCurrent,
      maxSessions,
      totalActive: sessions.length
    });
  } catch (error) {
    console.error("Error fetching sessions:", error);
    res.status(500).json({ error: "Failed to fetch sessions" });
  }
});

router.delete("/api/sessions/:id", requireAuth, async (req: Request, res: Response) => {
  try {
    const sessionId = parseInt(req.params.id);
    const userId = req.user!.id;

    const [session] = await db.select()
      .from(userSessions)
      .where(eq(userSessions.id, sessionId));

    if (!session) {
      return res.status(404).json({ error: "Session not found" });
    }

    if (session.userId !== userId && req.user!.role !== "super_admin" && req.user!.role !== "company_admin") {
      return res.status(403).json({ error: "Not authorized to delete this session" });
    }

    await forceLogoutSession(sessionId);

    res.json({ success: true, message: "Session terminated" });
  } catch (error) {
    console.error("Error terminating session:", error);
    res.status(500).json({ error: "Failed to terminate session" });
  }
});

router.post("/api/sessions/logout-all", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const { keepCurrent } = req.body;

    let terminated = 0;

    if (keepCurrent) {
      const authHeader = req.headers.authorization;
      const currentToken = authHeader?.replace("Bearer ", "") || "";
      terminated = await forceLogoutAllExceptCurrent(userId, currentToken);
    } else {
      terminated = await forceLogoutUser(userId);
    }

    res.json({ 
      success: true, 
      message: `Terminated ${terminated} session(s)`,
      terminatedCount: terminated
    });
  } catch (error) {
    console.error("Error logging out all sessions:", error);
    res.status(500).json({ error: "Failed to logout all sessions" });
  }
});

router.post("/api/admin/users/:id/force-logout", requireRole("super_admin", "company_admin"), async (req: Request, res: Response) => {
  try {
    const targetUserId = parseInt(req.params.id);

    const [targetUser] = await db.select().from(users).where(eq(users.id, targetUserId));

    if (!targetUser) {
      return res.status(404).json({ error: "User not found" });
    }

    if (req.user!.role === "company_admin") {
      if (targetUser.organizationId !== req.user!.organizationId) {
        return res.status(403).json({ error: "Cannot force logout users from other organizations" });
      }
    }

    if (targetUser.role === "super_admin" && req.user!.role !== "super_admin") {
      return res.status(403).json({ error: "Cannot force logout a super admin" });
    }

    const terminated = await forceLogoutUser(targetUserId, req.body.reason);

    res.json({ 
      success: true, 
      message: `Terminated ${terminated} session(s) for user ${targetUser.username}`,
      terminatedCount: terminated
    });
  } catch (error) {
    console.error("Error force logging out user:", error);
    res.status(500).json({ error: "Failed to force logout user" });
  }
});

router.get("/api/admin/users/:id/sessions", requireRole("super_admin", "company_admin"), async (req: Request, res: Response) => {
  try {
    const targetUserId = parseInt(req.params.id);

    const [targetUser] = await db.select().from(users).where(eq(users.id, targetUserId));

    if (!targetUser) {
      return res.status(404).json({ error: "User not found" });
    }

    if (req.user!.role === "company_admin") {
      if (targetUser.organizationId !== req.user!.organizationId) {
        return res.status(403).json({ error: "Cannot view sessions for users from other organizations" });
      }
    }

    const sessions = await db.select({
      id: userSessions.id,
      userAgent: userSessions.userAgent,
      ipAddress: userSessions.ipAddress,
      createdAt: userSessions.createdAt,
      lastActivityAt: userSessions.lastActivityAt,
      expiresAt: userSessions.expiresAt,
    })
      .from(userSessions)
      .where(and(
        eq(userSessions.userId, targetUserId),
        gt(userSessions.expiresAt, new Date())
      ))
      .orderBy(desc(userSessions.lastActivityAt));

    res.json({
      userId: targetUserId,
      username: targetUser.username,
      sessions,
      totalActive: sessions.length
    });
  } catch (error) {
    console.error("Error fetching user sessions:", error);
    res.status(500).json({ error: "Failed to fetch user sessions" });
  }
});

router.post("/api/organization/session-settings", requireRole("company_admin", "super_admin"), async (req: Request, res: Response) => {
  try {
    const organizationId = req.user!.organizationId;
    
    if (!organizationId && req.user!.role !== "super_admin") {
      return res.status(400).json({ error: "No organization associated with user" });
    }

    const { maxSessionsPerUser } = req.body;
    const orgId = organizationId || req.body.organizationId;

    if (!orgId) {
      return res.status(400).json({ error: "Organization ID required" });
    }

    if (maxSessionsPerUser !== undefined && (maxSessionsPerUser < 1 || maxSessionsPerUser > 20)) {
      return res.status(400).json({ error: "Max sessions must be between 1 and 20" });
    }

    const [org] = await db.select().from(organizations).where(eq(organizations.id, orgId));
    
    if (!org) {
      return res.status(404).json({ error: "Organization not found" });
    }

    const currentSettings = (org.settings as any) || {};
    const newSettings = { 
      ...currentSettings, 
      maxSessionsPerUser: maxSessionsPerUser || DEFAULT_MAX_SESSIONS 
    };

    await db.update(organizations)
      .set({ settings: newSettings })
      .where(eq(organizations.id, orgId));

    res.json({ 
      success: true, 
      maxSessionsPerUser: newSettings.maxSessionsPerUser,
      message: `Max sessions per user set to ${newSettings.maxSessionsPerUser}`
    });
  } catch (error) {
    console.error("Error updating session settings:", error);
    res.status(500).json({ error: "Failed to update session settings" });
  }
});

router.get("/api/organization/session-settings", requireRole("company_admin", "super_admin"), async (req: Request, res: Response) => {
  try {
    const organizationId = req.user!.organizationId;
    
    if (!organizationId && req.user!.role !== "super_admin") {
      return res.status(400).json({ error: "No organization associated with user" });
    }

    const orgId = organizationId || parseInt(req.query.organizationId as string);

    if (!orgId) {
      return res.status(400).json({ error: "Organization ID required" });
    }

    const maxSessions = await getMaxSessions(orgId);

    res.json({ 
      maxSessionsPerUser: maxSessions,
      default: DEFAULT_MAX_SESSIONS,
      enterpriseDefault: ENTERPRISE_MAX_SESSIONS
    });
  } catch (error) {
    console.error("Error fetching session settings:", error);
    res.status(500).json({ error: "Failed to fetch session settings" });
  }
});

export default router;
