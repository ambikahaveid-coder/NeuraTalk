import { Request, Response, Router, NextFunction } from "express";
import { and, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { db } from "./db";
import { auditLogs, users, PERMISSIONS } from "@shared/schema";
import { loadUser, requireAuth, requirePermission, requireSuperAdmin } from "./role-middleware";
import { loadTenantContext } from "./tenant-context";

export type AuditAction =
  | "login" | "logout" | "login_failed"
  | "user_created" | "user_updated" | "user_deleted"
  | "session_terminated" | "force_logout"
  | "ip_whitelist_added" | "ip_whitelist_removed" | "ip_whitelist_toggled"
  | "role_created" | "role_updated" | "role_deleted" | "role_assigned"
  | "data_export" | "data_deletion_requested"
  | "consent_updated" | "settings_updated"
  | "payment_processed" | "subscription_changed"
  | "api_key_created" | "api_key_revoked"
  | "admin_action";

export interface AuditLogEntry {
  action: AuditAction;
  userId?: number;
  targetUserId?: number;
  organizationId?: number;
  ipAddress?: string;
  userAgent?: string;
  details?: Record<string, any>;
  severity?: "info" | "warning" | "critical";
}

function getSeverity(metadata: unknown): string {
  if (!metadata || typeof metadata !== "object") {
    return "info";
  }

  const severity = (metadata as Record<string, unknown>).severity;
  return typeof severity === "string" ? severity : "info";
}

function getClientIp(req: Request): string {
  const forwardedFor = req.headers["x-forwarded-for"];
  if (forwardedFor) {
    const ips = Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor;
    return ips.split(",")[0].trim();
  }
  return req.socket.remoteAddress || "0.0.0.0";
}

function buildCsv(logs: Array<{
  id: number;
  organizationId: number | null;
  action: string;
  entityType: string;
  entityId: number | null;
  userId: number | null;
  metadata: unknown;
  ipAddress: string | null;
  createdAt: Date | null;
  user?: { username: string | null; email: string | null } | null;
}>): string {
  const escape = (value: unknown) => {
    const stringValue = value == null ? "" : String(value);
    return `"${stringValue.replace(/"/g, "\"\"")}"`;
  };

  const header = [
    "id",
    "organizationId",
    "action",
    "entityType",
    "entityId",
    "userId",
    "username",
    "email",
    "severity",
    "ipAddress",
    "createdAt",
  ].join(",");

  const rows = logs.map((log) => [
    escape(log.id),
    escape(log.organizationId),
    escape(log.action),
    escape(log.entityType),
    escape(log.entityId),
    escape(log.userId),
    escape(log.user?.username || ""),
    escape(log.user?.email || ""),
    escape(getSeverity(log.metadata)),
    escape(log.ipAddress),
    escape(log.createdAt?.toISOString?.() ?? log.createdAt),
  ].join(","));

  return [header, ...rows].join("\n");
}

function parseAuditFilters(req: Request) {
  const page = Number.parseInt(String(req.query.page || "1"), 10) || 1;
  const limit = Math.min(Number.parseInt(String(req.query.limit || "50"), 10) || 50, 200);
  const offset = (page - 1) * limit;
  const action = typeof req.query.action === "string" ? req.query.action : undefined;
  const userId = typeof req.query.userId === "string" ? Number.parseInt(req.query.userId, 10) : undefined;
  const startDate = typeof req.query.startDate === "string" ? new Date(req.query.startDate) : undefined;
  const endDate = typeof req.query.endDate === "string" ? new Date(req.query.endDate) : undefined;
  const severity = typeof req.query.severity === "string" ? req.query.severity : undefined;
  const organizationId = typeof req.query.organizationId === "string"
    ? Number.parseInt(req.query.organizationId, 10)
    : undefined;

  return {
    page,
    limit,
    offset,
    action,
    userId: Number.isFinite(userId) ? userId : undefined,
    startDate,
    endDate,
    severity,
    organizationId: Number.isFinite(organizationId) ? organizationId : undefined,
  };
}

async function queryAuditLogs(req: Request, options?: { exportAll?: boolean }) {
  const filters = parseAuditFilters(req);
  const isSuperAdmin = req.user?.role === "super_admin";
  const effectiveOrganizationId = isSuperAdmin
    ? filters.organizationId
    : req.user?.organizationId ?? req.tenant?.organizationId ?? undefined;

  const conditions = [];

  if (effectiveOrganizationId) {
    conditions.push(eq(auditLogs.organizationId, effectiveOrganizationId));
  }

  if (filters.action) {
    conditions.push(eq(auditLogs.action, filters.action));
  }

  if (filters.userId) {
    conditions.push(eq(auditLogs.userId, filters.userId));
  }

  if (filters.startDate && !Number.isNaN(filters.startDate.getTime())) {
    conditions.push(gte(auditLogs.createdAt, filters.startDate));
  }

  if (filters.endDate && !Number.isNaN(filters.endDate.getTime())) {
    conditions.push(lte(auditLogs.createdAt, filters.endDate));
  }

  if (filters.severity) {
    conditions.push(sql`coalesce(${auditLogs.metadata} ->> 'severity', 'info') = ${filters.severity}`);
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  let baseQuery = db.select({
    id: auditLogs.id,
    organizationId: auditLogs.organizationId,
    action: auditLogs.action,
    userId: auditLogs.userId,
    entityType: auditLogs.entityType,
    entityId: auditLogs.entityId,
    metadata: auditLogs.metadata,
    ipAddress: auditLogs.ipAddress,
    userAgent: auditLogs.userAgent,
    createdAt: auditLogs.createdAt,
  }).from(auditLogs);

  if (whereClause) {
    baseQuery = baseQuery.where(whereClause) as typeof baseQuery;
  }

  const logs = await baseQuery
    .orderBy(desc(auditLogs.createdAt))
    .limit(options?.exportAll ? 5000 : filters.limit)
    .offset(options?.exportAll ? 0 : filters.offset);

  const countQuery = db.select({ count: sql<number>`count(*)` }).from(auditLogs);
  const counted = whereClause ? await countQuery.where(whereClause) : await countQuery;
  const totalCount = Number(counted[0]?.count || 0);

  const userIds = Array.from(new Set(logs.map((log) => log.userId).filter((value): value is number => !!value)));
  const relatedUsers = userIds.length > 0
    ? await db.select({
      id: users.id,
      username: users.username,
      email: users.email,
    }).from(users).where(inArray(users.id, userIds))
    : [];

  const usersMap = new Map(relatedUsers.map((user) => [user.id, user]));
  const enrichedLogs = logs.map((log) => ({
    ...log,
    user: log.userId ? usersMap.get(log.userId) || null : null,
  }));

  return {
    filters,
    effectiveOrganizationId: effectiveOrganizationId ?? null,
    logs: enrichedLogs,
    totalCount,
  };
}

export async function logAuditEvent(entry: AuditLogEntry): Promise<void> {
  try {
    const severityMap: Record<AuditAction, "info" | "warning" | "critical"> = {
      login: "info",
      logout: "info",
      login_failed: "warning",
      user_created: "info",
      user_updated: "info",
      user_deleted: "critical",
      session_terminated: "info",
      force_logout: "warning",
      ip_whitelist_added: "info",
      ip_whitelist_removed: "warning",
      ip_whitelist_toggled: "info",
      role_created: "info",
      role_updated: "info",
      role_deleted: "warning",
      role_assigned: "info",
      data_export: "info",
      data_deletion_requested: "critical",
      consent_updated: "info",
      settings_updated: "info",
      payment_processed: "info",
      subscription_changed: "info",
      api_key_created: "info",
      api_key_revoked: "warning",
      admin_action: "info",
    };

    await db.insert(auditLogs).values({
      organizationId: entry.organizationId,
      action: entry.action,
      userId: entry.userId,
      entityType: "security",
      entityId: entry.targetUserId,
      metadata: {
        ...entry.details,
        severity: entry.severity || severityMap[entry.action] || "info",
      },
      ipAddress: entry.ipAddress,
      userAgent: entry.userAgent,
      createdAt: new Date(),
    });
  } catch (error) {
    console.error("Failed to log audit event:", error);
  }
}

export function auditMiddleware(action: AuditAction, options?: { includeBody?: boolean }) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const originalSend = res.send;

    res.send = function sendWithAudit(body: any) {
      const statusCode = res.statusCode;

      if (statusCode < 400) {
        void logAuditEvent({
          action,
          userId: req.user?.id,
          organizationId: req.user?.organizationId || req.tenant?.organizationId || undefined,
          ipAddress: getClientIp(req),
          userAgent: req.headers["user-agent"],
          details: {
            method: req.method,
            path: req.path,
            statusCode,
            ...(options?.includeBody ? { requestBody: req.body } : {}),
          },
        });
      }

      return originalSend.call(this, body);
    };

    next();
  };
}

const router = Router();

router.use(loadUser);
router.use(loadTenantContext);

router.get(
  "/api/admin/audit-logs",
  requireAuth,
  requirePermission(PERMISSIONS.SECURITY_VIEW_AUDIT),
  async (req: Request, res: Response) => {
    try {
      const result = await queryAuditLogs(req);

      res.json({
        logs: result.logs,
        organizationId: result.effectiveOrganizationId,
        pagination: {
          page: result.filters.page,
          limit: result.filters.limit,
          totalCount: result.totalCount,
          totalPages: Math.ceil(result.totalCount / result.filters.limit),
        },
      });
    } catch (error) {
      console.error("Error fetching audit logs:", error);
      res.status(500).json({ error: "Failed to fetch audit logs" });
    }
  },
);

router.get(
  "/api/admin/audit-logs/export",
  requireAuth,
  requirePermission(PERMISSIONS.SECURITY_VIEW_AUDIT),
  async (req: Request, res: Response) => {
    try {
      const format = typeof req.query.format === "string" ? req.query.format.toLowerCase() : "json";
      const result = await queryAuditLogs(req, { exportAll: true });

      void logAuditEvent({
        action: "data_export",
        userId: req.user?.id,
        organizationId: result.effectiveOrganizationId ?? req.user?.organizationId ?? undefined,
        ipAddress: getClientIp(req),
        userAgent: req.headers["user-agent"],
        details: {
          format,
          recordsExported: result.logs.length,
        },
      });

      if (format === "csv") {
        res.setHeader("Content-Type", "text/csv; charset=utf-8");
        res.setHeader("Content-Disposition", "attachment; filename=\"audit-logs.csv\"");
        return res.send(buildCsv(result.logs));
      }

      res.json({
        organizationId: result.effectiveOrganizationId,
        exportedAt: new Date().toISOString(),
        count: result.logs.length,
        logs: result.logs,
      });
    } catch (error) {
      console.error("Error exporting audit logs:", error);
      res.status(500).json({ error: "Failed to export audit logs" });
    }
  },
);

router.get(
  "/api/admin/audit-logs/summary",
  requireAuth,
  requireSuperAdmin,
  async (req: Request, res: Response) => {
    try {
      const days = Number.parseInt(String(req.query.days || "7"), 10) || 7;
      const organizationId = typeof req.query.organizationId === "string"
        ? Number.parseInt(req.query.organizationId, 10)
        : undefined;

      const since = new Date();
      since.setDate(since.getDate() - days);

      const conditions = [gte(auditLogs.createdAt, since)];
      if (Number.isFinite(organizationId)) {
        conditions.push(eq(auditLogs.organizationId, organizationId!));
      }

      const logs = await db.select()
        .from(auditLogs)
        .where(and(...conditions));

      const actionCounts: Record<string, number> = {};
      const severityCounts: Record<string, number> = { info: 0, warning: 0, critical: 0 };

      logs.forEach((log) => {
        actionCounts[log.action] = (actionCounts[log.action] || 0) + 1;
        const severity = getSeverity(log.metadata);
        severityCounts[severity] = (severityCounts[severity] || 0) + 1;
      });

      res.json({
        period: { days, since, until: new Date() },
        organizationId: Number.isFinite(organizationId) ? organizationId : null,
        totalEvents: logs.length,
        byAction: actionCounts,
        bySeverity: severityCounts,
      });
    } catch (error) {
      console.error("Error fetching audit summary:", error);
      res.status(500).json({ error: "Failed to fetch audit summary" });
    }
  },
);

router.get(
  "/api/admin/audit-logs/actions",
  requireAuth,
  requirePermission(PERMISSIONS.SECURITY_VIEW_AUDIT),
  async (_req: Request, res: Response) => {
    const actions: { action: AuditAction; description: string; severity: string }[] = [
      { action: "login", description: "User logged in", severity: "info" },
      { action: "logout", description: "User logged out", severity: "info" },
      { action: "login_failed", description: "Failed login attempt", severity: "warning" },
      { action: "user_created", description: "New user created", severity: "info" },
      { action: "user_updated", description: "User profile updated", severity: "info" },
      { action: "user_deleted", description: "User account deleted", severity: "critical" },
      { action: "session_terminated", description: "Session terminated", severity: "info" },
      { action: "force_logout", description: "User forcefully logged out", severity: "warning" },
      { action: "ip_whitelist_added", description: "IP added to whitelist", severity: "info" },
      { action: "ip_whitelist_removed", description: "IP removed from whitelist", severity: "warning" },
      { action: "ip_whitelist_toggled", description: "IP whitelist toggled", severity: "info" },
      { action: "role_created", description: "Custom role created", severity: "info" },
      { action: "role_updated", description: "Custom role updated", severity: "info" },
      { action: "role_deleted", description: "Custom role deleted", severity: "warning" },
      { action: "role_assigned", description: "Role assigned to user", severity: "info" },
      { action: "data_export", description: "User data exported", severity: "info" },
      { action: "data_deletion_requested", description: "Data deletion requested", severity: "critical" },
      { action: "consent_updated", description: "User consent updated", severity: "info" },
      { action: "settings_updated", description: "Settings updated", severity: "info" },
      { action: "payment_processed", description: "Payment processed", severity: "info" },
      { action: "subscription_changed", description: "Subscription changed", severity: "info" },
      { action: "api_key_created", description: "API key created", severity: "info" },
      { action: "api_key_revoked", description: "API key revoked", severity: "warning" },
      { action: "admin_action", description: "Admin action performed", severity: "info" },
    ];

    res.json({ actions });
  },
);

export default router;
