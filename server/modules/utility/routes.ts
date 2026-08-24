/**
 * Business Utility Messaging -- Phase 7 API surface. VIEW-ONLY.
 * See docs/neura-ecosystem/32_BUSINESS_UTILITY_MESSAGING_IMPLEMENTATION.md
 * section 4/18.
 *
 * Deliberately NO trigger/send route -- `triggerUtilityMessage` (server/
 * modules/utility/service.ts) is an internal, server-side-only function
 * meant to be called by a future real event producer, never reachable
 * from an HTTP request. UTILITY_VIEW is the only permission this module
 * introduces; there is no permission anywhere that means "can send any
 * utility message."
 */
import type { Express } from "express";
import { requireAuth, requireCompanyAccess, requirePermission } from "../../role-middleware";
import { PERMISSIONS } from "@shared/schema";
import * as ctrl from "./controller";

export function registerUtilityRoutes(app: Express): void {
  const view = [requireAuth, requireCompanyAccess("businessId"), requirePermission(PERMISSIONS.UTILITY_VIEW)];

  app.get("/api/v1/business/:businessId/utility/events", ...view, ctrl.getEvents);
  app.get("/api/v1/business/:businessId/utility/events/:eventId", ...view, ctrl.getEventById);
  app.get("/api/v1/business/:businessId/utility/report", ...view, ctrl.getReport);
}
