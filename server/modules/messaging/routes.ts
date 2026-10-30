/**
 * Canonical business messaging -- Phase 0 API surface, extended in Phase 1
 * (P1-2, 2026-08-25) with one consumer-facing route.
 * See docs/neura-ecosystem/24_CANONICAL_MESSAGING_FOUNDATION.md section 12.
 * The original 4 business-side routes remain deliberately limited; do not
 * expand further without a new approved design.
 */
import type { Express } from "express";
import { requireAuth, requireCompanyAccess, requirePermission, requireRole } from "../../role-middleware";
import { getAccountHealth } from "./account-health";
import { registerBusinessChatReactionRoutes } from "./reactions";
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

  // Must be registered BEFORE /conversations/:id, which would otherwise
  // swallow "stream" as an id (400) and the inbox never got live updates.
  app.get(
    "/api/business/:businessId/conversations/stream",
    requireAuth,
    requireCompanyAccess("businessId"),
    requirePermission(PERMISSIONS.MESSAGING_VIEW),
    ctrl.streamBusinessConversations,
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

  // P2: Business Inbox real-time stream is registered at the top of this
  // function (route order) -- see server/modules/messaging/realtime.ts.

  // Find a business (search), open one by its link, see its public profile.
  app.get("/api/messaging/businesses", requireAuth, ctrl.searchBusinessesHandler);
  app.get("/api/messaging/business-link/:slug", requireAuth, ctrl.getBusinessProfileHandler);
  app.get("/api/messaging/business/:businessId/profile", requireAuth, ctrl.getBusinessProfileHandler);
  app.get("/api/messaging/business/:businessId/call-target", requireAuth, ctrl.getBusinessCallTargetHandler);
  // Business chat settings: agents read them (quick replies); admins change them.
  app.get(
    "/api/business/:businessId/messaging-settings",
    requireAuth,
    requireCompanyAccess("businessId"),
    requirePermission(PERMISSIONS.MESSAGING_VIEW),
    ctrl.getMessagingSettingsHandler,
  );
  registerBusinessChatReactionRoutes(app);
  // Account health: quality rating + daily messaging limit (account-health.ts).
  app.get(
    "/api/business/:businessId/messaging/health",
    requireAuth,
    requireCompanyAccess("businessId"),
    requirePermission(PERMISSIONS.MESSAGING_VIEW),
    async (req, res) => {
      const businessId = Number(req.params.businessId);
      if (!Number.isSafeInteger(businessId) || businessId <= 0) return res.status(400).json({ success: false, error: "Invalid business" });
      try {
        const health = await getAccountHealth(businessId);
        if (!health) return res.status(404).json({ success: false, error: "Business not found" });
        return res.json({ success: true, health });
      } catch {
        return res.status(500).json({ success: false, error: "Could not load account health" });
      }
    },
  );
  app.put(
    "/api/business/:businessId/messaging-settings",
    requireAuth,
    requireCompanyAccess("businessId"),
    requireRole("company_admin", "super_admin"),
    ctrl.updateMessagingSettingsHandler,
  );

  // Consumer "Business" inbox: all of this user's chats with businesses.
  app.get("/api/messaging/business-threads", requireAuth, ctrl.getUserBusinessThreads);
  // Consumer opened a business chat (read receipts).
  app.post("/api/messaging/business/:businessId/read", requireAuth, ctrl.markUserThreadRead);
  // Consumer's own promotional-messages switch for one business.
  app.get("/api/messaging/business/:businessId/preferences", requireAuth, ctrl.getUserBusinessPreferences);
  app.put("/api/messaging/business/:businessId/preferences", requireAuth, ctrl.setUserBusinessPreferences);

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

  // P2: consumer-facing real-time stream, same requireAuth-only reasoning
  // as sendUserMessage/getUserMessages above -- see this phase's
  // architecture report and server/modules/messaging/realtime.ts.
  app.get(
    "/api/messaging/business/:businessId/stream",
    requireAuth,
    ctrl.streamUserMessages,
  );
}
