/**
 * Canonical business messaging -- Phase 0 API surface.
 * See docs/neura-ecosystem/24_CANONICAL_MESSAGING_FOUNDATION.md section 12.
 * Deliberately limited to the 4 approved routes -- do not expand without a
 * new approved design (Phase 1+).
 */
import type { Express } from "express";
import { requireAuth, requireCompanyAccess, requirePermission } from "../../role-middleware";
import { PERMISSIONS } from "@shared/schema";
import * as ctrl from "./controller";

export function registerMessagingRoutes(app: Express): void {
  app.post(
    "/api/business/:businessId/conversations",
    requireAuth,
    requireCompanyAccess("businessId"),
    requirePermission(PERMISSIONS.MESSAGING_SEND),
    ctrl.createConversation,
  );

  app.get(
    "/api/business/:businessId/conversations/:id",
    requireAuth,
    requireCompanyAccess("businessId"),
    requirePermission(PERMISSIONS.MESSAGING_VIEW),
    ctrl.getConversation,
  );

  app.post(
    "/api/business/:businessId/conversations/:id/messages",
    requireAuth,
    requireCompanyAccess("businessId"),
    requirePermission(PERMISSIONS.MESSAGING_SEND),
    ctrl.postMessage,
  );

  app.get(
    "/api/business/:businessId/conversations/:id/messages",
    requireAuth,
    requireCompanyAccess("businessId"),
    requirePermission(PERMISSIONS.MESSAGING_VIEW),
    ctrl.getMessages,
  );
}
