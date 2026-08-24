/**
 * Business Audiences -- Phase 4 API surface.
 * See docs/neura-ecosystem/29_BUSINESS_CUSTOMERS_AUDIENCES_IMPLEMENTATION.md.
 * No campaign-send route exists here -- out of scope, future phase.
 */
import type { Express } from "express";
import { requireAuth, requireCompanyAccess, requirePermission, requireAnyPermission } from "../../role-middleware";
import { PERMISSIONS } from "@shared/schema";
import * as ctrl from "./controller";

export function registerAudienceRoutes(app: Express): void {
  const manage = [requireAuth, requireCompanyAccess("businessId"), requirePermission(PERMISSIONS.AUDIENCES_MANAGE)];
  const view = [requireAuth, requireCompanyAccess("businessId"), requireAnyPermission(PERMISSIONS.AUDIENCES_MANAGE, PERMISSIONS.AUDIENCES_VIEW)];

  app.post("/api/business/:businessId/audiences", ...manage, ctrl.postAudience);
  app.get("/api/business/:businessId/audiences", ...view, ctrl.getAudiences);
  app.get("/api/business/:businessId/audiences/:audienceId", ...view, ctrl.getAudienceById);
  app.put("/api/business/:businessId/audiences/:audienceId", ...manage, ctrl.putAudience);
  app.post("/api/business/:businessId/audiences/:audienceId/archive", ...manage, ctrl.postArchiveAudience);

  app.post("/api/business/:businessId/audiences/:audienceId/members", ...manage, ctrl.postAddMember);
  app.get("/api/business/:businessId/audiences/:audienceId/members", ...view, ctrl.getMembers);
  app.delete("/api/business/:businessId/audiences/:audienceId/members/:customerId", ...manage, ctrl.deleteMember);
}
