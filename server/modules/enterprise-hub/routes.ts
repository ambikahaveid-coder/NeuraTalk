import type { Express } from "express";
import { requireAuth } from "../../role-middleware";
import * as ctrl from "./controller";

function isOrgAdminOrAbove(req: any, res: any, next: any) {
  const user = req.user;
  if (!user) return res.status(401).json({ success: false, error: "Unauthorized" });
  const role = user.role as string;
  if (role === "super_admin" || role === "company_admin" || role === "org_admin") return next();
  return res.status(403).json({ success: false, error: "Forbidden — company admin or above required" });
}

const guard = [requireAuth, isOrgAdminOrAbove];

export function registerEnterpriseHubRoutes(app: Express) {
  // Overview
  app.get("/api/enterprise-hub/overview", ...guard, ctrl.getOverview);

  // Numbers
  app.get("/api/enterprise-hub/numbers", ...guard, ctrl.listNumbers);
  app.post("/api/enterprise-hub/numbers", ...guard, ctrl.registerNumber);
  app.patch("/api/enterprise-hub/numbers/:id", ...guard, ctrl.updateNumber);
  app.delete("/api/enterprise-hub/numbers/:id", ...guard, ctrl.deleteNumber);

  // Verification
  app.post("/api/enterprise-hub/numbers/:id/verify", ...guard, ctrl.initiateVerification);
  app.post("/api/enterprise-hub/numbers/verify/confirm", ...guard, ctrl.confirmVerification);

  // SIP integrations
  app.get("/api/enterprise-hub/sip", ...guard, ctrl.listSip);
  app.post("/api/enterprise-hub/sip", ...guard, ctrl.createSip);
  app.patch("/api/enterprise-hub/sip/:id", ...guard, ctrl.updateSip);
  app.delete("/api/enterprise-hub/sip/:id", ...guard, ctrl.deleteSip);

  // Language rules
  app.get("/api/enterprise-hub/language-rules", ...guard, ctrl.listLanguageRules);
  app.post("/api/enterprise-hub/language-rules", ...guard, ctrl.createLanguageRule);
  app.delete("/api/enterprise-hub/language-rules/:id", ...guard, ctrl.deleteLanguageRule);

  // AI configurations
  app.get("/api/enterprise-hub/ai-config/:numberId", ...guard, ctrl.getAiConfig);
  app.post("/api/enterprise-hub/ai-config", ...guard, ctrl.upsertAiConfig);

  // Exotel bidirectional voice streaming (middleware translation layer)
  app.get("/api/enterprise-hub/exotel", ...guard, ctrl.listExotel);
  app.post("/api/enterprise-hub/exotel", ...guard, ctrl.createExotel);
  app.patch("/api/enterprise-hub/exotel/:id", ...guard, ctrl.updateExotel);
  app.delete("/api/enterprise-hub/exotel/:id", ...guard, ctrl.deleteExotel);
  app.get("/api/enterprise-hub/exotel/sessions/live", ...guard, ctrl.getExotelLiveSessions);

  // Audit logs
  app.get("/api/enterprise-hub/audit-logs", ...guard, ctrl.getAuditLogs);
}
