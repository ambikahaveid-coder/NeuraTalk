/**
 * Canonical business messaging -- Phase 0 API surface, extended in Phase 1
 * (P1-2, 2026-08-25) with one consumer-facing route.
 * See docs/neura-ecosystem/24_CANONICAL_MESSAGING_FOUNDATION.md section 12.
 * The original 4 business-side routes remain deliberately limited; do not
 * expand further without a new approved design.
 */
import type { Express } from "express";
import { requireAuth, requireCompanyAccess, requirePermission, requireRole } from "../../role-middleware";
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

  // P1-5: Business Inbox conversation list -- same RBAC stack as
  // getConversation/getMessages below, reused verbatim.
  app.get(
    "/api/business/:businessId/conversations",
    requireAuth,
    requireCompanyAccess("businessId"),
    requirePermission(PERMISSIONS.MESSAGING_VIEW),
    ctrl.listConversations,
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

  // P1-6: same RBAC stack as postMessage above -- claiming/releasing a
  // conversation is the same authority level as replying to one
  // (MESSAGING_SEND), not a new permission. Only self-claim (of an
  // unassigned conversation) and self-unassign (of the caller's own
  // assignment) -- no cross-agent reassignment endpoint exists yet, see
  // this phase's implementation report for why.
  app.post(
    "/api/business/:businessId/conversations/:id/claim",
    requireAuth,
    requireCompanyAccess("businessId"),
    requirePermission(PERMISSIONS.MESSAGING_SEND),
    ctrl.claimConversationHandler,
  );

  app.post(
    "/api/business/:businessId/conversations/:id/unassign",
    requireAuth,
    requireCompanyAccess("businessId"),
    requirePermission(PERMISSIONS.MESSAGING_SEND),
    ctrl.unassignConversationHandler,
  );

  // P1-7: company_admin/super_admin-only assign/reassign/unassign of ANY
  // conversation in this business. Deliberately requireRole, not
  // requirePermission -- MESSAGING_SEND is granted to agent and
  // company_admin identically by role-middleware.ts's default permission
  // sets, so it cannot distinguish "ordinary agent" from "business admin"
  // the way this operation needs. Mirrors the exact admin-role-gate pattern
  // server/business-rbac-routes.ts already established (requireCompanyAccess
  // + requireRole("company_admin", "super_admin")) rather than inventing a
  // new permission -- see this phase's implementation report for the full
  // comparison of alternatives.
  app.patch(
    "/api/business/:businessId/conversations/:id/assignment",
    requireAuth,
    requireCompanyAccess("businessId"),
    requireRole("company_admin", "super_admin"),
    ctrl.setConversationAssignmentHandler,
  );

  // P1-7: roster for the admin reassignment picker -- same role gate as the
  // assignment endpoint above, since that's its only consumer.
  app.get(
    "/api/business/:businessId/members",
    requireAuth,
    requireCompanyAccess("businessId"),
    requireRole("company_admin", "super_admin"),
    ctrl.listEligibleAssigneesHandler,
  );

  // P1-2: consumer-facing, deliberately NOT requireCompanyAccess/
  // requirePermission -- the caller is a normal NeuraTalk user, not a
  // member of the target business, so there is no business-membership or
  // Business-platform permission to check. requireAuth alone establishes
  // req.user (a real NeuraTalk account); tenant-correctness for the
  // business side is enforced inside sendUserInitiatedMessage itself
  // (validates businessId against organizations, scopes the customer
  // record to that exact business).
  app.post(
    "/api/messaging/business/:businessId/messages",
    requireAuth,
    ctrl.sendUserMessage,
  );

  // P1-3A: consumer-facing reads, same requireAuth-only reasoning as the
  // send route above -- no requireCompanyAccess, no requirePermission.
  // getPublicBusinessIdentity's explicit column projection and
  // listUserInitiatedMessages's (businessId, req.user.id)-scoped lookups
  // are the actual authorization boundaries (see controller.ts/service.ts).
  app.get(
    "/api/messaging/business/:businessId",
    requireAuth,
    ctrl.getBusinessIdentity,
  );

  app.get(
    "/api/messaging/business/:businessId/messages",
    requireAuth,
    ctrl.getUserMessages,
  );
}
