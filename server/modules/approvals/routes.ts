/**
 * Generic Approval Center -- Phase 3 API surface.
 * See docs/neura-ecosystem/28_GENERIC_APPROVAL_CENTER_IMPLEMENTATION.md
 * section 12.
 *
 * No generic APPROVAL_VIEW/SUBMIT/DECIDE permissions were added -- submit
 * and decide actions reuse whichever permission the registering domain's
 * policy declares (TEMPLATES_MANAGE / TEMPLATES_APPROVE for
 * "template_version" in this phase), checked dynamically in the controller
 * since the required permission depends on resourceType, known only after
 * parsing the request. List/get/cancel only need business membership
 * (requireCompanyAccess) -- viewing your own business's approval queue, or
 * cancelling your own pending submission, isn't a privileged action beyond
 * "you belong to this business."
 */
import type { Express } from "express";
import { requireAuth, requireCompanyAccess } from "../../role-middleware";
import * as ctrl from "./controller";

export function registerApprovalRoutes(app: Express): void {
  const scoped = [requireAuth, requireCompanyAccess("businessId")];

  app.post("/api/business/:businessId/approvals", ...scoped, ctrl.postCreateRequest);
  app.get("/api/business/:businessId/approvals", ...scoped, ctrl.getRequests);
  app.get("/api/business/:businessId/approvals/:requestId", ...scoped, ctrl.getRequestById);

  app.post("/api/business/:businessId/approvals/:requestId/approve", ...scoped, ctrl.postApprove);
  app.post("/api/business/:businessId/approvals/:requestId/reject", ...scoped, ctrl.postReject);
  app.post("/api/business/:businessId/approvals/:requestId/cancel", ...scoped, ctrl.postCancel);
}
