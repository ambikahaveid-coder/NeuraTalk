/**
 * P0-5: Business-platform RBAC access path.
 *
 * Audit finding: none of the Business-platform permissions (customers,
 * audiences, templates/approvals, campaigns, OTP, utility, business
 * messaging) are granted to ANY role by default -- not even company_admin.
 * getDefaultPermissions() in role-middleware.ts never included them, so the
 * only way a user has ever had access is a hand-crafted API call setting
 * orgMembers.permissions directly. There was no purpose-built, safe path to
 * do that.
 *
 * A generic mechanism already exists (POST
 * /api/organization/users/:userId/assign-role in server/custom-roles.ts,
 * gated by USERS_ASSIGN_ROLES which company_admin already has by default)
 * and IS tenant-isolated correctly. It was deliberately NOT reused as-is
 * for two reasons:
 *   1. It accepts ANY value in PERMISSIONS, not just the Business-platform
 *      subset -- a much bigger blast radius than "let a company_admin turn
 *      on their own Business modules" (e.g. it would also let a caller
 *      grant USERS_ASSIGN_ROLES itself, or any other org member's own
 *      unrelated sensitive permission).
 *   2. On an existing membership it REPLACES orgMembers.permissions
 *      wholesale (`.set({ permissions: finalPermissions })`), which would
 *      silently revoke any permission the member already had that wasn't
 *      re-listed in that call.
 *
 * This endpoint is the narrow, additive alternative: same tenant-isolation
 * primitives (requireCompanyAccess), an explicit role gate restricted to
 * company_admin/super_admin (not just anyone holding USERS_ASSIGN_ROLES),
 * an allow-list capped to exactly the Business-platform permission surface,
 * and a merge (never overwrite) into the existing permissions array. It
 * does NOT change any default permission set -- no existing organization's
 * access changes unless a company_admin explicitly calls this.
 */
import type { Express, Request, Response } from "express";
import { z } from "zod";
import { db } from "./db";
import { orgMembers, users, PERMISSIONS, AUDIT_ACTION } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import { requireAuth, requireCompanyAccess, requireRole } from "./role-middleware";
import { createAuditLog } from "./audit";

const GRANTABLE_BUSINESS_PERMISSIONS: string[] = [
  PERMISSIONS.CUSTOMERS_VIEW,
  PERMISSIONS.CUSTOMERS_MANAGE,
  PERMISSIONS.AUDIENCES_VIEW,
  PERMISSIONS.AUDIENCES_MANAGE,
  PERMISSIONS.TEMPLATES_MANAGE,
  PERMISSIONS.TEMPLATES_APPROVE,
  PERMISSIONS.CAMPAIGNS_VIEW,
  PERMISSIONS.CAMPAIGNS_MANAGE,
  PERMISSIONS.CAMPAIGNS_EXECUTE,
  PERMISSIONS.OTP_VIEW,
  PERMISSIONS.OTP_MANAGE,
  PERMISSIONS.UTILITY_VIEW,
  PERMISSIONS.MESSAGING_VIEW,
  PERMISSIONS.MESSAGING_SEND,
];

const grantSchema = z.object({
  // Defaults to the caller (a company_admin granting themselves access) --
  // an org owner shouldn't need a second user to bootstrap their own
  // Business platform access.
  userId: z.number().int().positive().optional(),
  permissions: z.array(z.string()).min(1).max(GRANTABLE_BUSINESS_PERMISSIONS.length),
});

export function registerBusinessRbacRoutes(app: Express): void {
  app.get(
    "/api/business/:businessId/rbac/grantable-permissions",
    requireAuth,
    requireCompanyAccess("businessId"),
    requireRole("company_admin", "super_admin"),
    (_req: Request, res: Response) => {
      res.json({ permissions: GRANTABLE_BUSINESS_PERMISSIONS });
    },
  );

  app.post(
    "/api/business/:businessId/rbac/grant-business-access",
    requireAuth,
    requireCompanyAccess("businessId"),
    requireRole("company_admin", "super_admin"),
    async (req: Request, res: Response) => {
      try {
        const businessId = Number.parseInt(req.params.businessId, 10);
        const parsed = grantSchema.safeParse(req.body);
        if (!parsed.success) {
          return res.status(400).json({ error: "Invalid request", details: parsed.error.errors });
        }

        const { permissions } = parsed.data;
        const targetUserId = parsed.data.userId ?? req.user!.id;

        const invalidPermissions = permissions.filter((p) => !GRANTABLE_BUSINESS_PERMISSIONS.includes(p));
        if (invalidPermissions.length > 0) {
          return res.status(400).json({
            error: "One or more permissions are not grantable through this endpoint",
            invalidPermissions,
            grantablePermissions: GRANTABLE_BUSINESS_PERMISSIONS,
          });
        }

        // Tenant isolation for the TARGET, not just the caller:
        // requireCompanyAccess already confirmed the caller belongs to
        // businessId, but targetUserId is client-supplied and could name
        // any user id -- without this check a company_admin could grant
        // Business-platform permissions to a user in a different
        // organization by guessing their id.
        const [targetUser] = await db.select({ id: users.id, organizationId: users.organizationId })
          .from(users).where(eq(users.id, targetUserId));
        if (!targetUser || targetUser.organizationId !== businessId) {
          return res.status(403).json({ error: "Target user is not a member of this business" });
        }

        const [existingMembership] = await db.select().from(orgMembers)
          .where(and(eq(orgMembers.userId, targetUserId), eq(orgMembers.organizationId, businessId)));

        const mergedPermissions = Array.from(new Set([
          ...(((existingMembership?.permissions as string[] | undefined) ?? [])),
          ...permissions,
        ]));

        if (existingMembership) {
          await db.update(orgMembers)
            .set({ permissions: mergedPermissions })
            .where(eq(orgMembers.id, existingMembership.id));
        } else {
          await db.insert(orgMembers).values({
            userId: targetUserId,
            organizationId: businessId,
            memberRole: "member",
            permissions: mergedPermissions,
          });
        }

        await createAuditLog({
          userId: req.user!.id,
          organizationId: businessId,
          action: AUDIT_ACTION.ROLE_CHANGE,
          entityType: "org_member_business_permissions",
          entityId: targetUserId,
          newValue: { grantedPermissions: permissions, resultingPermissions: mergedPermissions },
        });

        res.json({ success: true, userId: targetUserId, permissions: mergedPermissions });
      } catch (error) {
        console.error("Error granting business RBAC access:", error);
        res.status(500).json({ error: "Failed to grant business access" });
      }
    },
  );
}

export { GRANTABLE_BUSINESS_PERMISSIONS };
