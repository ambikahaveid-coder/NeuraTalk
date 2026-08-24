/**
 * Business Campaign Engine -- Phase 5 API surface.
 * See docs/neura-ecosystem/30_CAMPAIGN_ENGINE_IMPLEMENTATION.md.
 *
 * No generic "/send-message" endpoint -- execution is campaign-specific
 * only (POST .../execute), and only operates on this campaign's own
 * pre-validated, pre-approved, pre-snapshotted recipient set. Submitting a
 * campaign for approval and deciding it (approve/reject) happen through
 * the Approval Center's generic routes (server/modules/approvals/routes.ts)
 * with resourceType "campaign" -- this module has no submit/approve/reject
 * route of its own, same pattern as Phase 3 established for templates.
 */
import type { Express } from "express";
import { requireAuth, requireCompanyAccess, requirePermission, requireAnyPermission } from "../../role-middleware";
import { PERMISSIONS } from "@shared/schema";
import * as ctrl from "./controller";

export function registerCampaignRoutes(app: Express): void {
  const manage = [requireAuth, requireCompanyAccess("businessId"), requirePermission(PERMISSIONS.CAMPAIGNS_MANAGE)];
  const execute = [requireAuth, requireCompanyAccess("businessId"), requirePermission(PERMISSIONS.CAMPAIGNS_EXECUTE)];
  const view = [requireAuth, requireCompanyAccess("businessId"), requireAnyPermission(PERMISSIONS.CAMPAIGNS_MANAGE, PERMISSIONS.CAMPAIGNS_EXECUTE, PERMISSIONS.CAMPAIGNS_VIEW)];

  app.post("/api/v1/business/:businessId/campaigns", ...manage, ctrl.postCampaign);
  app.get("/api/v1/business/:businessId/campaigns", ...view, ctrl.getCampaigns);
  app.get("/api/v1/business/:businessId/campaigns/:campaignId", ...view, ctrl.getCampaignById);
  app.patch("/api/v1/business/:businessId/campaigns/:campaignId", ...manage, ctrl.patchCampaign);
  // Read-only preview (Phase 8B-R0) -- reuses the `view` gate, same as
  // every other read on this resource; never mutates.
  app.get("/api/v1/business/:businessId/campaigns/:campaignId/preflight", ...view, ctrl.getPreflight);

  app.post("/api/v1/business/:businessId/campaigns/:campaignId/schedule", ...manage, ctrl.postSchedule);
  app.post("/api/v1/business/:businessId/campaigns/:campaignId/cancel", ...manage, ctrl.postCancel);
  // EXECUTE is gated by CAMPAIGNS_EXECUTE, not CAMPAIGNS_MANAGE -- editing a
  // draft campaign never implies the authority to run it.
  app.post("/api/v1/business/:businessId/campaigns/:campaignId/execute", ...execute, ctrl.postExecute);
}
