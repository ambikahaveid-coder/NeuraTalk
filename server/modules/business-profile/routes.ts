/**
 * Business Profile + Branding -- Phase 1 API surface.
 * See docs/neura-ecosystem/26_BUSINESS_PROFILE_BRANDING_IMPLEMENTATION.md.
 *
 * Reuses existing middleware end to end -- requireCompanyAccess for tenant
 * isolation, ORG_VIEW_SETTINGS/ORG_EDIT_SETTINGS (already in the PERMISSIONS
 * catalog, already correctly excluded from AGENT_PERMISSIONS and correctly
 * view-only for MANAGER_PERMISSIONS) for RBAC. No new permission constants,
 * no new auth mechanism.
 */
import type { Express } from "express";
import { requireAuth, requireCompanyAccess, requirePermission } from "../../role-middleware";
import { PERMISSIONS } from "@shared/schema";
import * as ctrl from "./controller";

export function registerBusinessProfileRoutes(app: Express): void {
  const view = [requireAuth, requireCompanyAccess("businessId"), requirePermission(PERMISSIONS.ORG_VIEW_SETTINGS)];
  const edit = [requireAuth, requireCompanyAccess("businessId"), requirePermission(PERMISSIONS.ORG_EDIT_SETTINGS)];

  app.get("/api/business/:businessId/profile", ...view, ctrl.getProfile);
  app.patch("/api/business/:businessId/profile", ...edit, ctrl.patchProfile);

  app.get("/api/business/:businessId/branding", ...view, ctrl.getBrandingHandler);
  app.patch("/api/business/:businessId/branding", ...edit, ctrl.patchBranding);

  app.put("/api/business/:businessId/branding/logo", ...edit, ctrl.putLogo);
  app.delete("/api/business/:businessId/branding/logo", ...edit, ctrl.deleteLogo);
}
