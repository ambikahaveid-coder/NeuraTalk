/**
 * Business Message Template Engine -- Phase 2 API surface, updated Phase 3
 * (2026-08-24) to remove submit/approve/reject as directly-reachable routes.
 * See docs/neura-ecosystem/27_BUSINESS_TEMPLATE_ENGINE_IMPLEMENTATION.md and
 * docs/neura-ecosystem/28_GENERIC_APPROVAL_CENTER_IMPLEMENTATION.md.
 *
 * Submitting a draft for review and deciding it (approve/reject) now happen
 * exclusively through the Approval Center's generic routes
 * (server/modules/approvals/routes.ts) -- POST .../approvals with
 * resourceType "template_version" to submit, POST .../approvals/:id/approve
 * or /reject to decide. This module intentionally has no route for either
 * action anymore, so there is only one HTTP path into approval-state logic,
 * not two.
 *
 * No send/campaign routes exist here (out of scope, Phase 5). No route
 * accepts a sender identity of any kind, per doc 25.
 */
import type { Express } from "express";
import { requireAuth, requireCompanyAccess, requirePermission, requireAnyPermission } from "../../role-middleware";
import { PERMISSIONS } from "@shared/schema";
import * as ctrl from "./controller";

export function registerTemplateRoutes(app: Express): void {
  const manage = [requireAuth, requireCompanyAccess("businessId"), requirePermission(PERMISSIONS.TEMPLATES_MANAGE)];
  // Viewing/previewing is available to either role -- an approver must be
  // able to read what they're deciding on, an author must be able to see
  // their own drafts.
  const view = [requireAuth, requireCompanyAccess("businessId"), requireAnyPermission(PERMISSIONS.TEMPLATES_MANAGE, PERMISSIONS.TEMPLATES_APPROVE)];

  app.post("/api/business/:businessId/templates", ...manage, ctrl.postTemplate);
  app.get("/api/business/:businessId/templates", ...view, ctrl.getTemplates);
  app.get("/api/business/:businessId/templates/:templateId", ...view, ctrl.getTemplateById);

  app.put("/api/business/:businessId/templates/:templateId/draft", ...manage, ctrl.putDraftVersion);
  app.get("/api/business/:businessId/templates/:templateId/versions", ...view, ctrl.getVersions);

  app.post("/api/business/:businessId/templates/:templateId/versions/:versionId/return-to-draft", ...manage, ctrl.postReturnToDraft);
  app.post("/api/business/:businessId/templates/:templateId/versions/:versionId/archive", ...manage, ctrl.postArchiveVersion);

  app.post("/api/business/:businessId/templates/:templateId/versions/:versionId/preview", ...view, ctrl.postPreviewVersion);
}
