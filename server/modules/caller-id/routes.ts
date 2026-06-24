import type { Express } from "express";
import { loadUser, requireAuth } from "../../role-middleware";
import * as ctrl from "./controller";

export function registerCallerIdRoutes(app: Express): void {
  // Caller ID verification updates eligibility only.
  // Final PSTN number display still depends on provider acceptance and telecom rules.
  app.get("/api/caller-id/status", loadUser, requireAuth, ctrl.getStatus);
  app.post("/api/caller-id/verify/request", loadUser, requireAuth, ctrl.requestVerification);
  app.post("/api/caller-id/verify/confirm", loadUser, requireAuth, ctrl.confirmVerification);

  // MSG91 inbound call webhook (public — MSG91 posts here, no auth token)
  app.post("/api/calls/inbound", ctrl.inboundCallWebhook);
}
