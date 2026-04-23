import type { Express, Request, Response } from "express";
import { and, desc, eq, isNotNull, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "./db";
import {
  organizations,
  users,
  tenantDatabases,
  tenantSecurityPolicies,
  communicationSessions,
  subscriptions,
  auditLogs,
  PERMISSIONS,
} from "@shared/schema";
import { AuditHelpers } from "./audit";
import { loadUser, requireAuth, requirePermission, requireSuperAdmin } from "./role-middleware";
import { ensureTenantAccess, loadTenantContext, requireTenantContext } from "./tenant-context";
import { getTenantIsolationState, runTenantDatabaseHealthCheck } from "./tenant-db-manager";

const databaseConfigSchema = z.object({
  mode: z.enum(["shared", "dedicated"]),
  status: z.enum(["active", "provisioning", "suspended"]).default("active"),
  databaseUrl: z.string().trim().optional(),
  readReplicaUrl: z.string().trim().optional(),
  schemaName: z.string().trim().optional(),
  region: z.string().trim().default("ap-south-1"),
  poolMax: z.number().int().min(1).max(100).default(10),
  enforceIsolationGuards: z.boolean().default(true),
  metadata: z.record(z.any()).optional(),
});

const securityPolicySchema = z.object({
  requireTenantHeader: z.boolean().default(true),
  enforceSessionTenantBinding: z.boolean().default(true),
  allowMultipleSessions: z.boolean().default(true),
  sessionTimeoutMinutes: z.number().int().min(15).max(43200).default(1440),
  requireMfaForAdmins: z.boolean().default(false),
  allowedEmailDomains: z.array(z.string()).default([]),
  allowedIpRanges: z.array(z.string()).default([]),
  ssoEnabled: z.boolean().default(false),
  ssoProvider: z.string().optional(),
  ssoMetadata: z.record(z.any()).optional(),
  metadata: z.record(z.any()).optional(),
});

async function getOrganizationOr404(organizationId: number, res: Response) {
  const organization = (await db.select().from(organizations)
    .where(eq(organizations.id, organizationId))
    .limit(1))[0];

  if (!organization) {
    res.status(404).json({
      success: false,
      message: "Tenant company was not found",
    });
    return null;
  }

  return organization;
}

export function registerTenantAdminRoutes(app: Express): void {
  app.get(
    "/api/tenant/context",
    loadUser,
    loadTenantContext,
    requireAuth,
    requireTenantContext,
    async (req: Request, res: Response) => {
      const organizationId = req.tenant!.organizationId!;
      const { databaseConfig, securityPolicy } = await getTenantIsolationState(organizationId);

      res.json({
        tenant: req.tenant,
        user: {
          id: req.user!.id,
          role: req.user!.role,
          memberRole: req.user!.memberRole || null,
          permissions: req.user!.permissions || [],
          organizationId: req.user!.organizationId,
          tenantSlug: req.user!.tenantSlug || null,
        },
        database: {
          mode: databaseConfig.mode,
          status: databaseConfig.status,
          region: databaseConfig.region,
          schemaName: databaseConfig.schemaName,
          enforceIsolationGuards: databaseConfig.enforceIsolationGuards,
          lastHealthStatus: databaseConfig.lastHealthStatus,
          lastHealthCheckedAt: databaseConfig.lastHealthCheckedAt,
        },
        securityPolicy,
      });
    },
  );

  app.get(
    "/api/tenant/workspace/summary",
    loadUser,
    loadTenantContext,
    requireAuth,
    requireTenantContext,
    requirePermission(PERMISSIONS.ORG_VIEW_SETTINGS),
    async (req: Request, res: Response) => {
      const organizationId = req.tenant!.organizationId!;

      if (!ensureTenantAccess(req, organizationId)) {
        return res.status(403).json({
          success: false,
          message: "Cross-tenant access is not allowed",
        });
      }

      const [userCountResult, activeSessionCountResult, subscriptionCountResult, recentAuditCountResult] = await Promise.all([
        db.select({ count: sql<number>`count(*)` }).from(users).where(eq(users.organizationId, organizationId)),
        db.select({ count: sql<number>`count(*)` }).from(communicationSessions)
          .where(and(
            eq(communicationSessions.organizationId, organizationId),
            eq(communicationSessions.status, "active"),
          )),
        db.select({ count: sql<number>`count(*)` }).from(subscriptions)
          .where(eq(subscriptions.organizationId, organizationId)),
        db.select({ count: sql<number>`count(*)` }).from(auditLogs)
          .where(eq(auditLogs.organizationId, organizationId)),
      ]);

      res.json({
        organizationId,
        tenant: req.tenant,
        stats: {
          users: Number(userCountResult[0]?.count || 0),
          activeCommunicationSessions: Number(activeSessionCountResult[0]?.count || 0),
          subscriptions: Number(subscriptionCountResult[0]?.count || 0),
          auditEvents: Number(recentAuditCountResult[0]?.count || 0),
        },
      });
    },
  );

  app.get(
    "/api/admin/tenants",
    loadUser,
    requireAuth,
    requireSuperAdmin,
    async (_req: Request, res: Response) => {
      const organizationsList = await db.select().from(organizations).orderBy(desc(organizations.createdAt));
      const [databaseConfigs, securityPolicies, userCounts, sessionCounts] = await Promise.all([
        db.select().from(tenantDatabases),
        db.select().from(tenantSecurityPolicies),
        db.select({
          organizationId: users.organizationId,
          count: sql<number>`count(*)`,
        }).from(users).where(isNotNull(users.organizationId)).groupBy(users.organizationId),
        db.select({
          organizationId: communicationSessions.organizationId,
          count: sql<number>`count(*)`,
        }).from(communicationSessions).groupBy(communicationSessions.organizationId),
      ]);

      const databaseMap = new Map(databaseConfigs.map((row) => [row.organizationId, row]));
      const securityMap = new Map(securityPolicies.map((row) => [row.organizationId, row]));
      const userCountMap = new Map(userCounts.map((row) => [row.organizationId, Number(row.count || 0)]));
      const sessionCountMap = new Map(sessionCounts.map((row) => [row.organizationId, Number(row.count || 0)]));

      res.json({
        tenants: organizationsList.map((organization) => ({
          organization,
          database: databaseMap.get(organization.id) || null,
          securityPolicy: securityMap.get(organization.id) || null,
          stats: {
            users: userCountMap.get(organization.id) || 0,
            communicationSessions: sessionCountMap.get(organization.id) || 0,
          },
        })),
      });
    },
  );

  app.get(
    "/api/admin/tenants/:organizationId",
    loadUser,
    requireAuth,
    requireSuperAdmin,
    async (req: Request, res: Response) => {
      const organizationId = Number.parseInt(req.params.organizationId, 10);
      if (!Number.isFinite(organizationId)) {
        return res.status(400).json({ success: false, message: "Invalid organization ID" });
      }

      const organization = await getOrganizationOr404(organizationId, res);
      if (!organization) {
        return;
      }

      const [{ databaseConfig, securityPolicy }, health] = await Promise.all([
        getTenantIsolationState(organizationId),
        runTenantDatabaseHealthCheck(organizationId),
      ]);

      res.json({
        organization,
        databaseConfig,
        securityPolicy,
        health,
      });
    },
  );

  app.put(
    "/api/admin/tenants/:organizationId/database",
    loadUser,
    requireAuth,
    requireSuperAdmin,
    async (req: Request, res: Response) => {
      const organizationId = Number.parseInt(req.params.organizationId, 10);
      if (!Number.isFinite(organizationId)) {
        return res.status(400).json({ success: false, message: "Invalid organization ID" });
      }

      const organization = await getOrganizationOr404(organizationId, res);
      if (!organization) {
        return;
      }

      const parsed = databaseConfigSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          success: false,
          message: parsed.error.errors[0]?.message || "Invalid database config",
          errors: parsed.error.errors,
        });
      }

      const data = parsed.data;
      const existing = (await db.select().from(tenantDatabases)
        .where(eq(tenantDatabases.organizationId, organizationId))
        .limit(1))[0];

      const payload = {
        organizationId,
        mode: data.mode,
        status: data.status,
        databaseUrl: data.databaseUrl || null,
        readReplicaUrl: data.readReplicaUrl || null,
        schemaName: data.schemaName || null,
        region: data.region,
        poolMax: data.poolMax,
        enforceIsolationGuards: data.enforceIsolationGuards,
        metadata: data.metadata || {},
        updatedAt: new Date(),
      };

      const [saved] = existing
        ? await db.update(tenantDatabases)
          .set(payload)
          .where(eq(tenantDatabases.organizationId, organizationId))
          .returning()
        : await db.insert(tenantDatabases)
          .values(payload)
          .returning();

      await AuditHelpers.logUpdate(
        req.user!.id,
        "tenant_database",
        saved.id,
        existing || {},
        {
          organizationId,
          mode: saved.mode,
          status: saved.status,
          region: saved.region,
          enforceIsolationGuards: saved.enforceIsolationGuards,
        },
      );

      res.json({
        success: true,
        organizationId,
        databaseConfig: saved,
      });
    },
  );

  app.put(
    "/api/admin/tenants/:organizationId/security-policy",
    loadUser,
    requireAuth,
    requireSuperAdmin,
    async (req: Request, res: Response) => {
      const organizationId = Number.parseInt(req.params.organizationId, 10);
      if (!Number.isFinite(organizationId)) {
        return res.status(400).json({ success: false, message: "Invalid organization ID" });
      }

      const organization = await getOrganizationOr404(organizationId, res);
      if (!organization) {
        return;
      }

      const parsed = securityPolicySchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          success: false,
          message: parsed.error.errors[0]?.message || "Invalid security policy",
          errors: parsed.error.errors,
        });
      }

      const data = parsed.data;
      const existing = (await db.select().from(tenantSecurityPolicies)
        .where(eq(tenantSecurityPolicies.organizationId, organizationId))
        .limit(1))[0];

      const payload = {
        organizationId,
        requireTenantHeader: data.requireTenantHeader,
        enforceSessionTenantBinding: data.enforceSessionTenantBinding,
        allowMultipleSessions: data.allowMultipleSessions,
        sessionTimeoutMinutes: data.sessionTimeoutMinutes,
        requireMfaForAdmins: data.requireMfaForAdmins,
        allowedEmailDomains: data.allowedEmailDomains,
        allowedIpRanges: data.allowedIpRanges,
        ssoEnabled: data.ssoEnabled,
        ssoProvider: data.ssoProvider || null,
        ssoMetadata: data.ssoMetadata || {},
        metadata: data.metadata || {},
        updatedAt: new Date(),
      };

      const [saved] = existing
        ? await db.update(tenantSecurityPolicies)
          .set(payload)
          .where(eq(tenantSecurityPolicies.organizationId, organizationId))
          .returning()
        : await db.insert(tenantSecurityPolicies)
          .values(payload)
          .returning();

      await AuditHelpers.logUpdate(
        req.user!.id,
        "tenant_security_policy",
        saved.id,
        existing || {},
        {
          organizationId,
          requireTenantHeader: saved.requireTenantHeader,
          enforceSessionTenantBinding: saved.enforceSessionTenantBinding,
          allowMultipleSessions: saved.allowMultipleSessions,
          requireMfaForAdmins: saved.requireMfaForAdmins,
          ssoEnabled: saved.ssoEnabled,
        },
      );

      res.json({
        success: true,
        organizationId,
        securityPolicy: saved,
      });
    },
  );

  app.post(
    "/api/admin/tenants/:organizationId/health-check",
    loadUser,
    requireAuth,
    requireSuperAdmin,
    async (req: Request, res: Response) => {
      const organizationId = Number.parseInt(req.params.organizationId, 10);
      if (!Number.isFinite(organizationId)) {
        return res.status(400).json({ success: false, message: "Invalid organization ID" });
      }

      const organization = await getOrganizationOr404(organizationId, res);
      if (!organization) {
        return;
      }

      const result = await runTenantDatabaseHealthCheck(organizationId);
      res.status(result.success ? 200 : 503).json(result);
    },
  );
}
