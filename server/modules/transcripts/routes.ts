import type { Express } from "express";
import { loadUser, requireAuth } from "../../role-middleware";
import * as ctrl from "./controller";

export function registerTranscriptRoutes(app: Express): void {
  app.get("/api/transcripts/search", loadUser, requireAuth, ctrl.search);
  app.get("/api/transcripts/:callId", loadUser, requireAuth, ctrl.getTranscript);
  app.get("/api/transcripts/:callId/export/:format", loadUser, requireAuth, ctrl.exportTranscript);
  app.delete("/api/transcripts/:callId", loadUser, requireAuth, ctrl.deleteTranscript);

  // Enterprise admin
  app.get("/api/admin/transcripts/search", loadUser, requireAuth, ctrl.adminSearch);
  app.get("/api/admin/transcripts/:callId/export/:format", loadUser, requireAuth, ctrl.adminExport);
  app.get("/api/admin/transcripts/retention", loadUser, requireAuth, ctrl.getRetentionSettings);
  app.patch("/api/admin/transcripts/retention", loadUser, requireAuth, ctrl.setOrgRetentionDefault);
  app.get("/api/admin/transcripts/audit-log", loadUser, requireAuth, ctrl.getTranscriptAuditLog);

  // Monitoring
  app.get("/api/admin/transcripts/metrics", loadUser, requireAuth, ctrl.getMetrics);
}
