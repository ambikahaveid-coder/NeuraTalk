/**
 * Business-wide marketing reporting -- Phase 8B-R0 API surface. VIEW-ONLY.
 * See docs/neura-ecosystem/36_PHASE8B_R0_REPORTING_PREFLIGHT_IMPLEMENTATION.md.
 * Reuses CAMPAIGNS_VIEW -- this is a read-only view over campaign data,
 * not a new capability domain, so no new permission was created (doc 36
 * section "R0-I").
 */
import type { Express } from "express";
import { requireAuth, requireCompanyAccess, requireAnyPermission } from "../../role-middleware";
import { PERMISSIONS } from "@shared/schema";
import * as ctrl from "./controller";

export function registerMarketingRoutes(app: Express): void {
  const view = [requireAuth, requireCompanyAccess("businessId"), requireAnyPermission(PERMISSIONS.CAMPAIGNS_MANAGE, PERMISSIONS.CAMPAIGNS_EXECUTE, PERMISSIONS.CAMPAIGNS_VIEW)];

  app.get("/api/v1/business/:businessId/marketing/report", ...view, ctrl.getReport);
  app.get("/api/v1/business/:businessId/marketing/frequency", ...view, ctrl.getFrequency);
}
