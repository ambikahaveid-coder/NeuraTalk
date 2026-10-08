/**
 * ADMIN USER MANAGEMENT ROUTES
 * 
 * Full CRUD operations for user management:
 * - List all users with filters
 * - Create new users
 * - Update user details and roles
 * - Delete/deactivate users
 * - Role assignment
 * - Audit logging
 */

import { Express, Request, Response } from "express";
import { z } from "zod";
import { db } from "./db";
import { users, organizations, subscriptions, billingPlans, callBillingRecords } from "@shared/schema";
import { eq, and, or, desc, asc, like, ilike, sql, count, inArray } from "drizzle-orm";
import { requireAuth, requireRole } from "./role-middleware";
import { logger } from "./observability";
import { AuditHelpers } from "./audit";
import { configService } from "./config-service";
import { normalizePhoneNumber } from "@shared/phone";
import { getRedisClient } from "./redis";
import { findFreeTrialPlan } from "./free-trial";

const grantMinutesSchema = z.object({
  minutes: z.number().int().min(1).max(10_000),
  reason: z.string().trim().min(3).max(200),
});

// Granted minutes stay usable for a year, like the free trial.
const GRANT_VALIDITY_MS = 365 * 24 * 60 * 60 * 1000;

const USER_ROLES = ["consumer", "agent", "company_admin", "investor", "super_admin"] as const;

const createUserSchema = z.object({
  email: z.string().email().optional(),
  phone: z.string().min(10).optional(),
  role: z.enum(USER_ROLES).default("consumer"),
  organizationId: z.number().optional(),
  username: z.string().optional(),
}).refine(data => data.email || data.phone, {
  message: "Either email or phone is required"
});

const updateUserSchema = z.object({
  email: z.string().email().optional(),
  phone: z.string().optional(),
  role: z.enum(USER_ROLES).optional(),
  organizationId: z.number().nullable().optional(),
  username: z.string().optional(),
  isActive: z.boolean().optional(),
});

type AdminCallFilter = {
  days?: number;
  status?: string;
  search?: string;
  userId?: number;
  page?: number;
  limit?: number;
};

/**
 * Calls as admins need to see them, joined from the persisted call row
 * (bridged_calls), its billing record and both people. A call counts as
 * answered when it connected, missed when it ended without connecting.
 */
async function listAdminCalls(filter: AdminCallFilter) {
  const limit = filter.limit ?? 50;
  const offset = ((filter.page ?? 1) - 1) * limit;
  const where: ReturnType<typeof sql>[] = [];
  if (filter.days) where.push(sql`b.created_at >= NOW() - make_interval(days => ${filter.days})`);
  if (filter.userId) where.push(sql`(b.caller_user_id = ${filter.userId} OR b.receiver_user_id = ${filter.userId})`);
  if (filter.status === "answered") where.push(sql`(b.connected_at IS NOT NULL OR COALESCE(c.voice_seconds, 0) + COALESCE(c.video_seconds, 0) > 0)`);
  if (filter.status === "missed") where.push(sql`b.connected_at IS NULL AND COALESCE(c.voice_seconds, 0) + COALESCE(c.video_seconds, 0) = 0 AND b.ended_at IS NOT NULL AND b.status <> 'failed'`);
  if (filter.status === "failed") where.push(sql`b.status = 'failed'`);
  if (filter.status === "active") where.push(sql`b.ended_at IS NULL`);
  if (filter.search) {
    const term = `%${filter.search}%`;
    where.push(sql`(b.caller_number ILIKE ${term} OR b.receiver_number ILIKE ${term} OR b.call_sid ILIKE ${term}
      OR cu.phone ILIKE ${term} OR ru.phone ILIKE ${term} OR cu.display_name ILIKE ${term} OR ru.display_name ILIKE ${term})`);
  }
  const whereSql = where.length ? sql`WHERE ${sql.join(where, sql` AND `)}` : sql``;
  const from = sql`
    FROM bridged_calls b
    LEFT JOIN users cu ON cu.id = b.caller_user_id
    LEFT JOIN users ru ON ru.id = b.receiver_user_id
    LEFT JOIN call_billing_records c ON c.call_id = b.call_sid
    ${whereSql}`;

  const rows = (await db.execute(sql`
    SELECT b.call_sid AS "callId", b.created_at AS "createdAt", b.connected_at AS "connectedAt", b.ended_at AS "endedAt",
      b.status, COALESCE(b.metadata->>'callType', c.call_type, 'voice') AS "callType",
      COALESCE(b.metadata->>'joinMethod', c.join_method) AS "joinMethod",
      b.caller_user_id AS "callerId", COALESCE(NULLIF(cu.display_name, ''), cu.username) AS "callerName", COALESCE(cu.phone, b.caller_number) AS "callerPhone", b.caller_language AS "callerLanguage",
      b.receiver_user_id AS "receiverId", COALESCE(NULLIF(ru.display_name, ''), ru.username) AS "receiverName", COALESCE(ru.phone, b.receiver_number) AS "receiverPhone", b.receiver_language AS "receiverLanguage",
      GREATEST(COALESCE(c.voice_seconds, 0), COALESCE(c.video_seconds, 0),
        CASE WHEN b.connected_at IS NOT NULL AND b.ended_at IS NOT NULL
          THEN EXTRACT(EPOCH FROM (b.ended_at - b.connected_at))::int ELSE 0 END) AS "durationSeconds",
      COALESCE(c.translation_seconds, 0) AS "translationSeconds",
      COALESCE(c.included_free_seconds_used, 0) AS "freeSecondsUsed",
      COALESCE(c.total_cost_paise, 0) AS "costPaise",
      c.status AS "billingStatus"
    ${from}
    ORDER BY b.created_at DESC
    LIMIT ${limit} OFFSET ${offset}`) as any).rows;

  const [summary] = (await db.execute(sql`
    SELECT COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE (b.connected_at IS NOT NULL OR COALESCE(c.voice_seconds, 0) + COALESCE(c.video_seconds, 0) > 0))::int AS answered,
      COUNT(*) FILTER (WHERE b.connected_at IS NULL AND COALESCE(c.voice_seconds, 0) + COALESCE(c.video_seconds, 0) = 0 AND b.ended_at IS NOT NULL AND b.status <> 'failed')::int AS missed,
      COUNT(*) FILTER (WHERE b.status = 'failed')::int AS failed,
      COUNT(*) FILTER (WHERE b.ended_at IS NULL)::int AS active,
      COUNT(*) FILTER (WHERE COALESCE(c.translation_seconds, 0) > 0)::int AS translated,
      COALESCE(ROUND(AVG(GREATEST(COALESCE(c.voice_seconds, 0), COALESCE(c.video_seconds, 0),
          CASE WHEN b.connected_at IS NOT NULL AND b.ended_at IS NOT NULL THEN EXTRACT(EPOCH FROM (b.ended_at - b.connected_at)) ELSE 0 END))
        FILTER (WHERE b.connected_at IS NOT NULL OR COALESCE(c.voice_seconds, 0) + COALESCE(c.video_seconds, 0) > 0)), 0)::int AS "avgDurationSeconds",
      COALESCE(SUM(c.total_cost_paise), 0)::int AS "costPaise"
    ${from}`) as any).rows;

  return { rows, summary, total: summary?.total ?? 0 };
}

export function registerAdminUserRoutes(app: Express) {
  
  /**
   * Get all users with pagination and filters
   */
  app.get("/api/admin/users", requireAuth, requireRole("super_admin"), async (req: Request, res: Response) => {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 50;
      const search = req.query.search as string;
      const role = req.query.role as string;
      const offset = (page - 1) * limit;

      // Everything support needs at a glance: who they are, their language,
      // what they have left to spend, and whether they actually use the app.
      let query = db.select({
        id: users.id,
        email: users.email,
        phone: users.phone,
        username: users.username,
        displayName: users.displayName,
        role: users.role,
        organizationId: users.organizationId,
        preferredLanguage: users.preferredLanguage,
        isActive: users.isActive,
        lastLoginAt: users.lastLoginAt,
        createdAt: users.createdAt,
        minutesRemaining: sql<number | null>`(
          SELECT s.minutes_remaining FROM subscriptions s
          WHERE s.user_id = "users"."id" AND s.status = 'active'
          ORDER BY s.end_date DESC LIMIT 1)`,
        planName: sql<string | null>`(
          SELECT p.name FROM subscriptions s JOIN billing_plans p ON p.id = s.plan_id
          WHERE s.user_id = "users"."id" AND s.status = 'active'
          ORDER BY s.end_date DESC LIMIT 1)`,
        callCount: sql<number>`(
          SELECT COUNT(*)::int FROM bridged_calls b
          WHERE b.caller_user_id = "users"."id" OR b.receiver_user_id = "users"."id")`,
        lastCallAt: sql<string | null>`(
          SELECT MAX(b.created_at) FROM bridged_calls b
          WHERE b.caller_user_id = "users"."id" OR b.receiver_user_id = "users"."id")`,
      }).from(users);

      const conditions = [];

      if (search) {
        // Phone numbers are stored as +91XXXXXXXXXX; let "8125557378" match.
        const term = `%${search.trim()}%`;
        conditions.push(or(
          ilike(users.email, term),
          like(users.phone, term),
          ilike(users.username, term),
          ilike(users.displayName, term),
        ));
      }
      
      if (role && USER_ROLES.includes(role as any)) {
        conditions.push(eq(users.role, role));
      }

      if (conditions.length > 0) {
        query = query.where(and(...conditions)) as any;
      }

      const allUsers = await query
        .orderBy(desc(users.createdAt))
        .limit(limit)
        .offset(offset);

      // Count with same filters for accurate pagination
      let countQuery = db.select({ total: count() }).from(users);
      if (conditions.length > 0) {
        countQuery = countQuery.where(and(...conditions)) as any;
      }
      const [{ total }] = await countQuery;

      res.json({
        success: true,
        data: allUsers,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      });
    } catch (err) {
      logger.error("AdminUsers", "Failed to fetch users", err as Error);
      res.status(500).json({ success: false, message: "Failed to fetch users" });
    }
  });

  /**
   * Get user by ID with details
   */
  app.get("/api/admin/users/:id", requireAuth, requireRole("super_admin"), async (req: Request, res: Response) => {
    try {
      const userId = parseInt(req.params.id);
      
      const [user] = await db.select().from(users).where(eq(users.id, userId));
      
      if (!user) {
        return res.status(404).json({ success: false, message: "User not found" });
      }

      let organization = null;
      if (user.organizationId) {
        const [org] = await db.select().from(organizations).where(eq(organizations.id, user.organizationId));
        organization = org;
      }

      const [subscription] = await db
        .select({
          subscription: subscriptions,
          plan: billingPlans,
        })
        .from(subscriptions)
        .leftJoin(billingPlans, eq(subscriptions.planId, billingPlans.id))
        .where(and(
          eq(subscriptions.userId, userId),
          eq(subscriptions.status, "active")
        ))
        .limit(1);

      res.json({
        success: true,
        data: {
          ...user,
          organization,
          subscription: subscription || null,
        },
      });
    } catch (err) {
      logger.error("AdminUsers", "Failed to fetch user", err as Error);
      res.status(500).json({ success: false, message: "Failed to fetch user" });
    }
  });

  /**
   * Create new user
   */
  app.post("/api/admin/users", requireAuth, requireRole("super_admin"), async (req: Request, res: Response) => {
    try {
      const validation = createUserSchema.safeParse(req.body);
      if (!validation.success) {
        return res.status(400).json({ success: false, message: "Invalid data", errors: validation.error.errors });
      }

      const data = validation.data;
      const normalizedPhone = data.phone ? normalizePhoneNumber(data.phone) : undefined;

      if (data.email) {
        const [existing] = await db.select().from(users).where(eq(users.email, data.email));
        if (existing) {
          return res.status(400).json({ success: false, message: "Email already exists" });
        }
      }

      if (normalizedPhone) {
        const [existing] = await db.select().from(users).where(eq(users.phone, normalizedPhone));
        if (existing) {
          return res.status(400).json({ success: false, message: "Phone already exists" });
        }
      }

      const [newUser] = await db.insert(users).values({
        email: data.email || null,
        phone: normalizedPhone,
        role: data.role,
        organizationId: data.organizationId,
        username: data.username || data.email?.split("@")[0] || `user_${Date.now()}`,
      }).returning();

      await AuditHelpers.logCreate(
        req.user!.id,
        "user",
        newUser.id,
        { role: data.role }
      );

      logger.info("AdminUsers", `User created: ${newUser.id} by admin ${req.user!.id}`);

      res.status(201).json({ success: true, data: newUser });
    } catch (err) {
      logger.error("AdminUsers", "Failed to create user", err as Error);
      res.status(500).json({ success: false, message: "Failed to create user" });
    }
  });

  /**
   * Update user
   */
  app.patch("/api/admin/users/:id", requireAuth, requireRole("super_admin"), async (req: Request, res: Response) => {
    try {
      const userId = parseInt(req.params.id);
      const validation = updateUserSchema.safeParse(req.body);
      
      if (!validation.success) {
        return res.status(400).json({ success: false, message: "Invalid data", errors: validation.error.errors });
      }

      const [existing] = await db.select().from(users).where(eq(users.id, userId));
      if (!existing) {
        return res.status(404).json({ success: false, message: "User not found" });
      }

      const updateData: any = {};
      const data = validation.data;
      const normalizedPhone = data.phone !== undefined ? normalizePhoneNumber(data.phone) : undefined;

      // Check for duplicate email (if changing)
      if (data.email !== undefined && data.email !== existing.email) {
        const [emailExists] = await db.select().from(users).where(
          and(eq(users.email, data.email), sql`${users.id} != ${userId}`)
        );
        if (emailExists) {
          return res.status(400).json({ success: false, message: "Email already exists" });
        }
        updateData.email = data.email;
      }

      // Check for duplicate phone (if changing)
      if (data.phone !== undefined && normalizedPhone !== existing.phone) {
        if (!normalizedPhone) {
          return res.status(400).json({ success: false, message: "Invalid phone number" });
        }
        const [phoneExists] = await db.select().from(users).where(
          and(eq(users.phone, normalizedPhone), sql`${users.id} != ${userId}`)
        );
        if (phoneExists) {
          return res.status(400).json({ success: false, message: "Phone already exists" });
        }
        updateData.phone = normalizedPhone;
      }

      if (data.role !== undefined) updateData.role = data.role;
      if (data.organizationId !== undefined) updateData.organizationId = data.organizationId;
      if (data.username !== undefined) updateData.username = data.username;

      const [updated] = await db.update(users)
        .set(updateData)
        .where(eq(users.id, userId))
        .returning();

      await AuditHelpers.logUpdate(
        req.user!.id,
        "user",
        userId,
        {},
        { changes: Object.keys(updateData) }
      );

      logger.info("AdminUsers", `User updated: ${userId} by admin ${req.user!.id}`);

      res.json({ success: true, data: updated });
    } catch (err) {
      logger.error("AdminUsers", "Failed to update user", err as Error);
      res.status(500).json({ success: false, message: "Failed to update user" });
    }
  });

  /**
   * Delete user (soft delete by removing critical data)
   */
  app.delete("/api/admin/users/:id", requireAuth, requireRole("super_admin"), async (req: Request, res: Response) => {
    try {
      const userId = parseInt(req.params.id);

      const [existing] = await db.select().from(users).where(eq(users.id, userId));
      if (!existing) {
        return res.status(404).json({ success: false, message: "User not found" });
      }

      if (existing.role === "super_admin") {
        return res.status(403).json({ success: false, message: "Cannot delete super admin accounts" });
      }

      await db.delete(users).where(eq(users.id, userId));

      await AuditHelpers.logDelete(
        req.user!.id,
        "user",
        userId,
        { deletedEmail: existing.email }
      );

      logger.info("AdminUsers", `User deleted: ${userId} by admin ${req.user!.id}`);

      res.json({ success: true, message: "User deleted" });
    } catch (err) {
      logger.error("AdminUsers", "Failed to delete user", err as Error);
      res.status(500).json({ success: false, message: "Failed to delete user" });
    }
  });

  /**
   * Get platform statistics for dashboard
   */
  app.get("/api/admin/stats", requireAuth, requireRole("super_admin"), async (req: Request, res: Response) => {
    try {
      const [userCount] = await db.select({ count: count() }).from(users);
      const [orgCount] = await db.select({ count: count() }).from(organizations);
      const [activeSubCount] = await db
        .select({ count: count() })
        .from(subscriptions)
        .where(eq(subscriptions.status, "active"));

      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      const [newUsersThisMonth] = await db
        .select({ count: count() })
        .from(users)
        .where(sql`${users.createdAt} >= ${thirtyDaysAgo}`);

      const [callStats] = await db
        .select({
          calls: count(),
          revenuePaise: sql<number>`COALESCE(SUM(${callBillingRecords.totalCostPaise}), 0)`,
        })
        .from(callBillingRecords);

      res.json({
        success: true,
        users: userCount.count,
        companies: orgCount.count,
        activeSubscriptions: activeSubCount.count,
        newUsersThisMonth: newUsersThisMonth.count,
        revenue: Math.round(Number(callStats?.revenuePaise ?? 0) / 100),
        // Counted like the Call Logs page (one row per call), not billing rows.
        calls: Number((await listAdminCalls({ limit: 1 })).summary?.total ?? callStats?.calls ?? 0),
      });
    } catch (err) {
      logger.error("AdminUsers", "Failed to fetch stats", err as Error);
      res.status(500).json({ success: false, message: "Failed to fetch stats" });
    }
  });

  /**
   * Get analytics data for charts
   */
  app.get("/api/admin/analytics", requireAuth, requireRole("super_admin"), async (req: Request, res: Response) => {
    try {
      const days = parseInt(req.query.days as string) || 30;
      
      const usersByRole = await db
        .select({
          role: users.role,
          count: count(),
        })
        .from(users)
        .groupBy(users.role);

      const orgsByStatus = await db
        .select({
          status: organizations.status,
          count: count(),
        })
        .from(organizations)
        .groupBy(organizations.status);

      const signupRows = await db.execute(
        sql`SELECT DATE(created_at) as date, COUNT(*) as signups FROM users WHERE created_at >= NOW() - CAST(${String(days) + ' days'} AS INTERVAL) GROUP BY DATE(created_at) ORDER BY date`
      );
      const signupMap = new Map<string, number>();
      (signupRows as any).rows.forEach((r: any) => {
        signupMap.set(new Date(r.date).toISOString().split('T')[0], Number(r.signups));
      });

      const callRows = await db.execute(
        sql`SELECT DATE(created_at) as date, COUNT(*) as calls FROM call_billing_records WHERE created_at >= NOW() - CAST(${String(days) + ' days'} AS INTERVAL) GROUP BY DATE(created_at) ORDER BY date`
      );
      const callMap = new Map<string, number>();
      (callRows as any).rows.forEach((r: any) => {
        callMap.set(new Date(r.date).toISOString().split('T')[0], Number(r.calls));
      });

      const dailySignups = [];
      for (let i = days - 1; i >= 0; i--) {
        const date = new Date();
        date.setDate(date.getDate() - i);
        const dateStr = date.toISOString().split('T')[0];
        dailySignups.push({
          date: dateStr,
          users: signupMap.get(dateStr) || 0,
          calls: callMap.get(dateStr) || 0,
        });
      }

      // Revenue is money actually received, not the list price of every
      // subscription ever created (free trials included).
      const revenueResult = await db.execute(
        sql`SELECT COALESCE(SUM(amount), 0) AS total FROM payment_transactions WHERE status IN ('completed', 'partially_refunded')`
      );
      const totalRevenueRaw = Number((revenueResult as any).rows[0]?.total || 0);

      // Same source as the Call Logs page, so the numbers agree.
      const { summary: callSummary } = await listAdminCalls({ days, limit: 1 });
      const totalCalls = Number(callSummary?.total ?? 0);
      const successRate = totalCalls > 0 ? Math.round((Number(callSummary.answered) / totalCalls) * 1000) / 10 : 0;

      res.json({
        success: true,
        data: {
          usersByRole,
          orgsByStatus,
          dailySignups,
          totalRevenue: Math.round(totalRevenueRaw / 100),
          avgCallDuration: Math.round(Number(callSummary?.avgDurationSeconds ?? 0)),
          totalCalls,
          successRate,
        },
      });
    } catch (err) {
      logger.error("AdminUsers", "Failed to fetch analytics", err as Error);
      res.status(500).json({ success: false, message: "Failed to fetch analytics" });
    }
  });

  // GET /api/admin/audit-logs lives in admin-settings-routes.ts (uses real getAuditLogs).

  /**
   * Get third-party integration status
   */
  app.get("/api/admin/integrations", requireAuth, requireRole("super_admin"), async (req: Request, res: Response) => {
    try {
      const configStatus = await configService.getConfigStatus();
      const configMap = new Map(configStatus.map((config) => [config.key, config.isSet]));

      const integrationDefinitions: Array<{
        id: string;
        name: string;
        description: string;
        icon: string;
        keys: string[];
        requiredKeys: string[];
        alternativeGroups?: string[][];
      }> = [
        {
          id: "openai",
          name: "OpenAI",
          description: "AI chat, translation, speech-to-text, and text-to-speech",
          icon: "sparkles",
          keys: ["OPENAI_API_KEY", "AI_INTEGRATIONS_OPENAI_API_KEY", "AI_INTEGRATIONS_OPENAI_BASE_URL"],
          requiredKeys: ["AI_INTEGRATIONS_OPENAI_API_KEY"],
          alternativeGroups: [["OPENAI_API_KEY", "AI_INTEGRATIONS_OPENAI_API_KEY"]],
        },
        {
          id: "msg91",
          name: "MSG91",
          description: "India-first OTP, SMS, and PSTN calling",
          icon: "phone",
          keys: [
            "MSG91_AUTH_KEY",
            "APP_BASE_URL",
            "MSG91_OTP_TEMPLATE_ID",
            "MSG91_VOICE_CALLER_ID",
            "MSG91_VOICE_URL",
            "MSG91_WEBHOOK_SECRET",
          ],
          requiredKeys: ["MSG91_AUTH_KEY", "APP_BASE_URL"],
        },
        {
          id: "razorpay",
          name: "Razorpay",
          description: "Payment processing and webhooks",
          icon: "credit-card",
          keys: ["RAZORPAY_KEY_ID", "RAZORPAY_KEY_SECRET", "RAZORPAY_WEBHOOK_SECRET"],
          requiredKeys: ["RAZORPAY_KEY_ID", "RAZORPAY_KEY_SECRET"],
        },
        {
          id: "azure",
          name: "Azure",
          description: "Speech and translation fallback services",
          icon: "languages",
          keys: ["AZURE_SPEECH_KEY", "AZURE_SPEECH_REGION", "AZURE_TRANSLATOR_KEY", "AZURE_TRANSLATOR_REGION"],
          requiredKeys: ["AZURE_SPEECH_KEY", "AZURE_SPEECH_REGION"],
          alternativeGroups: [
            ["AZURE_SPEECH_KEY", "AZURE_TRANSLATOR_KEY"],
            ["AZURE_SPEECH_REGION", "AZURE_TRANSLATOR_REGION"],
          ],
        },
        {
          id: "livekit",
          name: "LiveKit",
          description: "Realtime rooms, tokens, and SIP bridge",
          icon: "monitor-check",
          keys: ["LIVEKIT_URL", "LIVEKIT_API_KEY", "LIVEKIT_API_SECRET", "LIVEKIT_SIP_DOMAIN"],
          requiredKeys: ["LIVEKIT_URL", "LIVEKIT_API_KEY", "LIVEKIT_API_SECRET"],
        },
        {
          id: "deepgram",
          name: "Deepgram",
          description: "Optional speech recognition provider",
          icon: "headphones",
          keys: ["DEEPGRAM_API_KEY"],
          requiredKeys: [],
        },
        {
          id: "agora",
          name: "Agora",
          description: "Optional real-time calling and recording provider",
          icon: "video",
          keys: ["AGORA_APP_ID", "AGORA_APP_CERTIFICATE", "AGORA_CLOUD_RECORDING_ENABLED"],
          requiredKeys: ["AGORA_APP_ID", "AGORA_APP_CERTIFICATE"],
        },
        {
          id: "firebase",
          name: "Firebase",
          description: "Phone OTP authentication and admin credentials",
          icon: "shield",
          keys: ["FIREBASE_SERVICE_ACCOUNT_JSON", "VITE_FIREBASE_API_KEY", "VITE_FIREBASE_PROJECT_ID", "VITE_FIREBASE_APP_ID"],
          requiredKeys: ["FIREBASE_SERVICE_ACCOUNT_JSON", "VITE_FIREBASE_API_KEY", "VITE_FIREBASE_PROJECT_ID", "VITE_FIREBASE_APP_ID"],
        },
        {
          id: "turn",
          name: "TURN Server",
          description: "WebRTC relay for restrictive networks",
          icon: "radio",
          keys: ["TURN_SERVER_URL", "TURN_SERVER_USERNAME", "TURN_SERVER_CREDENTIAL"],
          requiredKeys: ["TURN_SERVER_URL", "TURN_SERVER_USERNAME", "TURN_SERVER_CREDENTIAL"],
        },
        {
          id: "voice",
          name: "ElevenLabs",
          description: "Premium voice synthesis fallback",
          icon: "headphones",
          keys: ["ELEVEN_LABS_API_KEY"],
          requiredKeys: ["ELEVEN_LABS_API_KEY"],
        },
        {
          id: "database",
          name: "PostgreSQL",
          description: "Primary application database",
          icon: "database",
          keys: ["DATABASE_URL"],
          requiredKeys: ["DATABASE_URL"],
        },
      ];

      const integrations = integrationDefinitions.map((integration) => {
        const configuredKeys = integration.keys.filter((key) => {
          if (key === "DATABASE_URL") {
            return !!process.env.DATABASE_URL;
          }
          return configMap.get(key) === true;
        });

        const missingKeys = integration.keys.filter((key) => !configuredKeys.includes(key));
        const missingRequiredKeys = integration.requiredKeys.filter((key) => !configuredKeys.includes(key));
        const alternativeGroups = integration.alternativeGroups || [];
        const alternativeSatisfied = alternativeGroups.every((group) => group.some((key) => configuredKeys.includes(key)));
        const requiredConfigured = missingRequiredKeys.length === 0 && alternativeSatisfied;
        const status = requiredConfigured
          ? configuredKeys.length === integration.keys.length
            ? "configured"
            : "partial"
          : configuredKeys.length > 0
            ? "partial"
            : "not_configured";

        return {
          id: integration.id,
          name: integration.name,
          description: integration.description,
          status,
          icon: integration.icon,
          configuredKeys,
          missingKeys,
          missingRequiredKeys,
          configuredCount: configuredKeys.length,
          totalKeys: integration.keys.length,
          requiredCount: integration.requiredKeys.length,
        };
      });

      res.json({ success: true, data: integrations });
    } catch (err) {
      logger.error("AdminUsers", "Failed to fetch integrations", err as Error);
      res.status(500).json({ success: false, message: "Failed to fetch integrations" });
    }
  });

  /**
   * Give a user call minutes (support refunds, testing, goodwill). Adds to
   * the user's latest subscription, reactivating it if it ran out or
   * expired, or starts one on the free plan. Every grant is audit-logged.
   */
  app.post("/api/admin/users/:id/minutes", requireAuth, requireRole("super_admin"), async (req: Request, res: Response) => {
    try {
      const userId = parseInt(req.params.id);
      const validation = grantMinutesSchema.safeParse(req.body);
      if (!Number.isFinite(userId) || !validation.success) {
        return res.status(400).json({ success: false, message: "Give 1–10000 minutes and a reason" });
      }
      const { minutes, reason } = validation.data;

      const [user] = await db.select({ id: users.id }).from(users).where(eq(users.id, userId));
      if (!user) {
        return res.status(404).json({ success: false, message: "User not found" });
      }

      const now = new Date();
      const [latest] = await db.select().from(subscriptions)
        .where(eq(subscriptions.userId, userId))
        .orderBy(desc(subscriptions.endDate))
        .limit(1);

      let subscriptionId: number;
      let minutesBefore = 0;
      if (latest) {
        minutesBefore = latest.minutesRemaining ?? 0;
        const endDate = latest.endDate && new Date(latest.endDate) > now
          ? new Date(latest.endDate)
          : new Date(now.getTime() + GRANT_VALIDITY_MS);
        await db.update(subscriptions)
          .set({
            status: "active",
            endDate,
            minutesRemaining: sql`COALESCE(${subscriptions.minutesRemaining}, 0) + ${minutes}`,
            updatedAt: now,
          })
          .where(eq(subscriptions.id, latest.id));
        subscriptionId = latest.id;
      } else {
        const plan = await findFreeTrialPlan();
        if (!plan) {
          return res.status(409).json({ success: false, message: "No free plan exists to attach the minutes to" });
        }
        const [created] = await db.insert(subscriptions).values({
          userId,
          planId: plan.id,
          status: "active",
          billingModel: "prepaid",
          startDate: now,
          endDate: new Date(now.getTime() + GRANT_VALIDITY_MS),
          minutesUsed: 0,
          minutesRemaining: minutes,
          autoRenew: false,
        }).returning({ id: subscriptions.id });
        subscriptionId = created.id;
      }

      const [after] = await db.select({ minutesRemaining: subscriptions.minutesRemaining })
        .from(subscriptions).where(eq(subscriptions.id, subscriptionId));

      await AuditHelpers.logSettingsChange(req.user!.id, "user_minutes_granted", { minutesRemaining: minutesBefore }, {
        targetUserId: userId,
        subscriptionId,
        minutesGranted: minutes,
        minutesRemaining: after?.minutesRemaining ?? null,
        reason,
      });
      logger.info("AdminUsers", `Granted ${minutes} minutes to user ${userId} by admin ${req.user!.id}`);

      res.json({ success: true, data: { userId, subscriptionId, minutesGranted: minutes, minutesRemaining: after?.minutesRemaining ?? null } });
    } catch (err) {
      logger.error("AdminUsers", "Failed to grant minutes", err as Error);
      res.status(500).json({ success: false, message: "Failed to grant minutes" });
    }
  });

  /**
   * One user's full picture for support: profile, every subscription,
   * recent calls (with the other person, languages, duration, charge) and
   * the minutes admins have granted them.
   */
  app.get("/api/admin/users/:id/overview", requireAuth, requireRole("super_admin"), async (req: Request, res: Response) => {
    try {
      const userId = parseInt(req.params.id);
      if (!Number.isFinite(userId)) return res.status(400).json({ success: false, message: "Invalid user id" });

      const [user] = await db.select({
        id: users.id, username: users.username, displayName: users.displayName, email: users.email,
        phone: users.phone, role: users.role, isActive: users.isActive, preferredLanguage: users.preferredLanguage,
        translationEnabled: users.translationEnabled, organizationId: users.organizationId,
        lastLoginAt: users.lastLoginAt, createdAt: users.createdAt,
      }).from(users).where(eq(users.id, userId));
      if (!user) return res.status(404).json({ success: false, message: "User not found" });

      const subs = await db.select({
        id: subscriptions.id, status: subscriptions.status, planName: billingPlans.name,
        minutesRemaining: subscriptions.minutesRemaining, minutesUsed: subscriptions.minutesUsed,
        startDate: subscriptions.startDate, endDate: subscriptions.endDate,
      }).from(subscriptions)
        .leftJoin(billingPlans, eq(billingPlans.id, subscriptions.planId))
        .where(eq(subscriptions.userId, userId))
        .orderBy(desc(subscriptions.endDate));

      const calls = await listAdminCalls({ userId, limit: 20 });

      const grants = (await db.execute(sql`
        SELECT a.created_at, a.user_id AS admin_id, u.phone AS admin_phone, u.email AS admin_email,
               a.new_value->'value'->>'minutesGranted' AS minutes,
               a.new_value->'value'->>'reason' AS reason
        FROM audit_logs a LEFT JOIN users u ON u.id = a.user_id
        WHERE a.metadata->>'key' = 'user_minutes_granted'
          AND a.new_value->'value'->>'targetUserId' = ${String(userId)}
        ORDER BY a.created_at DESC LIMIT 20`) as any).rows;

      res.json({ success: true, data: { user, subscriptions: subs, calls: calls.rows, grants } });
    } catch (err) {
      logger.error("AdminUsers", "Failed to load user overview", err as Error);
      res.status(500).json({ success: false, message: "Failed to load user" });
    }
  });

  /**
   * Every call on the platform, newest first: who called whom, in which
   * languages, whether it was answered, how long it lasted and what it cost.
   */
  app.get("/api/admin/calls", requireAuth, requireRole("super_admin"), async (req: Request, res: Response) => {
    try {
      const days = Math.min(Math.max(parseInt(req.query.days as string) || 7, 1), 365);
      const status = String(req.query.status || "all");
      const search = String(req.query.search || "").trim();
      const page = Math.max(parseInt(req.query.page as string) || 1, 1);
      const limit = Math.min(Math.max(parseInt(req.query.limit as string) || 50, 1), 200);
      const result = await listAdminCalls({ days, status, search, page, limit });
      res.json({ success: true, data: result.rows, summary: result.summary, pagination: { page, limit, total: result.total } });
    } catch (err) {
      logger.error("AdminUsers", "Failed to list calls", err as Error);
      res.status(500).json({ success: false, message: "Failed to list calls" });
    }
  });

  /**
   * Clear stale active-call Redis lock for a user.
   * Use when a server crash leaves user:active_call:{id} orphaned.
   */
  app.delete("/api/admin/users/:id/active-call", requireAuth, requireRole("super_admin"), async (req: Request, res: Response) => {
    try {
      const userId = req.params.id;
      const redis = getRedisClient();
      const key = `user:active_call:${userId}`;
      const existing = await redis.get(key);
      await redis.del(key);
      await redis.del(`call_metadata:${existing || ""}:caller`);
      logger.info("AdminUsers", `Cleared stale active-call lock for user ${userId}`, { key, existing });
      await AuditHelpers.logSettingsChange(req.user!.id, "active_call_lock_cleared", null, { targetUserId: userId, hadValue: existing });
      res.json({ success: true, cleared: key, hadValue: existing });
    } catch (err) {
      logger.error("AdminUsers", "Failed to clear active-call lock", err as Error);
      res.status(500).json({ success: false, message: "Failed to clear active-call lock" });
    }
  });

  logger.info("AdminUsers", "Admin user routes registered");
}
