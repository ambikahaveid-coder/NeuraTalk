import { NextFunction, Request, Response } from "express";
import { eq } from "drizzle-orm";
import { organizations } from "@shared/schema";
import { db } from "./db";
import { getTenantIsolationState } from "./tenant-db-manager";
import { logger } from "./observability";

export interface TenantContext {
  organizationId: number | null;
  slug: string | null;
  scope: "platform" | "tenant";
  organizationStatus: string | null;
  databaseMode: "shared" | "dedicated";
  isolationGuardsEnabled: boolean;
  requireTenantHeader: boolean;
  enforceSessionTenantBinding: boolean;
  requireMfaForAdmins: boolean;
  region: string | null;
}

declare global {
  namespace Express {
    interface Request {
      tenant?: TenantContext;
    }
  }
}

function extractRequestedTenant(req: Request): { tenantId: number | null; tenantSlug: string | null } {
  const headerTenantId = req.headers["x-tenant-id"];
  const headerTenantSlug = req.headers["x-tenant-slug"];
  const queryTenantId = req.query.tenantId;
  const queryTenantSlug = req.query.tenantSlug;
  const bodyTenantId = req.body && typeof req.body === "object" ? (req.body as Record<string, unknown>).tenantId : undefined;
  const bodyTenantSlug = req.body && typeof req.body === "object" ? (req.body as Record<string, unknown>).tenantSlug : undefined;

  const tenantIdValue = typeof headerTenantId === "string"
    ? headerTenantId
    : typeof queryTenantId === "string"
      ? queryTenantId
      : typeof bodyTenantId === "number"
        ? String(bodyTenantId)
        : typeof bodyTenantId === "string"
          ? bodyTenantId
          : null;

  const tenantSlugValue = typeof headerTenantSlug === "string"
    ? headerTenantSlug
    : typeof queryTenantSlug === "string"
      ? queryTenantSlug
      : typeof bodyTenantSlug === "string"
        ? bodyTenantSlug
        : null;

  const tenantId = tenantIdValue ? Number.parseInt(tenantIdValue, 10) : null;

  return {
    tenantId: Number.isFinite(tenantId) ? tenantId : null,
    tenantSlug: tenantSlugValue?.trim().toLowerCase() || null,
  };
}

async function resolveOrganizationByTenant(tenantId: number | null, tenantSlug: string | null) {
  if (tenantId) {
    return db.query.organizations.findFirst({
      where: eq(organizations.id, tenantId),
    });
  }

  if (tenantSlug) {
    return db.query.organizations.findFirst({
      where: eq(organizations.slug, tenantSlug),
    });
  }

  return null;
}

export async function loadTenantContext(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    if (req.tenant) {
      next();
      return;
    }

    const requested = extractRequestedTenant(req);
    let organization = null;

    if (req.user?.role === "super_admin") {
      organization = await resolveOrganizationByTenant(requested.tenantId, requested.tenantSlug);
    } else if (req.user?.organizationId) {
      organization = req.user.organization || await db.query.organizations.findFirst({
        where: eq(organizations.id, req.user.organizationId),
      });

      if (requested.tenantId && requested.tenantId !== req.user.organizationId) {
        res.status(403).json({
          success: false,
          message: "Cross-tenant access is not allowed",
        });
        return;
      }

      const expectedSlug = req.user.tenantSlug || organization?.slug || null;
      if (requested.tenantSlug && expectedSlug && requested.tenantSlug !== expectedSlug) {
        res.status(403).json({
          success: false,
          message: "Tenant workspace mismatch detected",
        });
        return;
      }
    } else {
      organization = await resolveOrganizationByTenant(requested.tenantId, requested.tenantSlug);
    }

    if (!organization) {
      req.tenant = {
        organizationId: null,
        slug: null,
        scope: "platform",
        organizationStatus: null,
        databaseMode: "shared",
        isolationGuardsEnabled: false,
        requireTenantHeader: false,
        enforceSessionTenantBinding: false,
        requireMfaForAdmins: false,
        region: null,
      };
      next();
      return;
    }

    const { databaseConfig, securityPolicy } = await getTenantIsolationState(organization.id);

    req.tenant = {
      organizationId: organization.id,
      slug: organization.slug,
      scope: "tenant",
      organizationStatus: organization.status,
      databaseMode: databaseConfig.mode === "dedicated" ? "dedicated" : "shared",
      isolationGuardsEnabled: !!databaseConfig.enforceIsolationGuards,
      requireTenantHeader: !!securityPolicy.requireTenantHeader,
      enforceSessionTenantBinding: !!securityPolicy.enforceSessionTenantBinding,
      requireMfaForAdmins: !!securityPolicy.requireMfaForAdmins,
      region: databaseConfig.region || "ap-south-1",
    };

    next();
  } catch (error) {
    logger.error("TenantContext", "Failed to resolve tenant context", error as Error);
    next();
  }
}

export function requireTenantContext(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (!req.tenant || req.tenant.scope !== "tenant" || !req.tenant.organizationId) {
    res.status(400).json({
      success: false,
      message: "Tenant workspace context is required for this request",
    });
    return;
  }

  next();
}

export function ensureTenantAccess(
  req: Request,
  organizationId: number | null | undefined,
): boolean {
  if (!organizationId) {
    return false;
  }

  if (req.user?.role === "super_admin") {
    return true;
  }

  return req.user?.organizationId === organizationId && req.tenant?.organizationId === organizationId;
}
