/**
 * Outbound Webhooks — org-scoped event subscriptions.
 * All endpoints require org-admin or super-admin role (enforced per-handler
 * via isOrgAdmin, same convention as server/modules/b2b-admin/routes.ts).
 */
import type { Express } from "express";
import { requireAuth } from "../../role-middleware";
import * as ctrl from "./controller";

export function registerWebhookRoutes(app: Express): void {
  app.post("/api/admin/orgs/:orgId/webhooks", requireAuth, ctrl.createWebhook);
  app.get("/api/admin/orgs/:orgId/webhooks", requireAuth, ctrl.listWebhooks);
  app.delete("/api/admin/orgs/:orgId/webhooks/:webhookId", requireAuth, ctrl.deleteWebhook);
  app.patch("/api/admin/orgs/:orgId/webhooks/:webhookId", requireAuth, ctrl.toggleWebhook);
}
