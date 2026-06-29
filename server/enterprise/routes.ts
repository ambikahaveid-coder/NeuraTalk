/**
 * Enterprise AI Overlay Routes
 *
 * REST API for the Enterprise Number Integration Hub:
 *   POST /api/enterprise-hub/numbers          — register an existing business number
 *   GET  /api/enterprise-hub/numbers          — list org's registered numbers
 *   GET  /api/enterprise-hub/numbers/:id      — get number config
 *   PATCH /api/enterprise-hub/numbers/:id     — update AI config for a number
 *   DELETE /api/enterprise-hub/numbers/:id    — remove a number
 *   GET  /api/enterprise-hub/sessions         — active AI overlay call sessions
 *   GET  /api/enterprise-hub/sessions/:callId — session detail + live transcript
 *   GET  /api/enterprise-hub/health           — media gateway + AI pipeline health
 *   POST /api/enterprise-hub/assist/feedback  — thumbs up/down on agent suggestion
 *
 * WebSocket: /api/enterprise-hub/ws/assist/:agentId — agent assist push stream
 */

import type { Express, Request, Response } from "express";
import { loadUser, requireCompanyAdminOrAbove } from "../role-middleware";
import { getActiveSessionsForOrg, getEnterpriseSession } from "./session-store";
import { getMediaGateway } from "../media/gateway";
import { getAIPipeline } from "../ai-pipeline/pipeline";
import { getSIPTrunkRegistry } from "../sip/trunk-registry";
import { getKamailioClient } from "../sip/kamailio-rpc";
import { logger } from "../observability";
import type { AuthenticatedUser } from "../role-middleware";

function orgId(req: Request): number {
  return (req.user as AuthenticatedUser)?.organizationId ?? 0;
}

export function registerEnterpriseAIOverlayRoutes(app: Express): void {
  // ── List active AI overlay call sessions ─────────────────────────────────
  app.get(
    "/api/enterprise-hub/sessions",
    loadUser,
    requireCompanyAdminOrAbove,
    async (req: Request, res: Response) => {
      try {
        const ids = await getActiveSessionsForOrg(String(orgId(req)));
        const sessions = await Promise.all(
          ids.map((id) => getEnterpriseSession(id)),
        );
        res.json({
          sessions: sessions.filter(Boolean).map((s) => ({
            callId: s!.callId,
            customerNumber: s!.customerNumber,
            direction: s!.direction,
            startedAt: s!.startedAt,
            aiFeatures: s!.aiFeatures,
            utteranceCount: s!.transcript.length,
          })),
        });
      } catch (err) {
        logger.error("EnterpriseHub", `List sessions error: ${err}`);
        res.status(500).json({ message: "Failed to fetch sessions" });
      }
    },
  );

  // ── Get session detail + transcript ──────────────────────────────────────
  app.get(
    "/api/enterprise-hub/sessions/:callId",
    loadUser,
    requireCompanyAdminOrAbove,
    async (req: Request, res: Response) => {
      try {
        const session = await getEnterpriseSession(req.params.callId);
        if (!session || String(session.organizationId) !== String(orgId(req))) {
          return res.status(404).json({ message: "Session not found" });
        }
        res.json({ session });
      } catch (err) {
        logger.error("EnterpriseHub", `Get session error: ${err}`);
        res.status(500).json({ message: "Failed to fetch session" });
      }
    },
  );

  // ── Infrastructure health ────────────────────────────────────────────────
  app.get(
    "/api/enterprise-hub/health",
    loadUser,
    requireCompanyAdminOrAbove,
    async (_req: Request, res: Response) => {
      try {
        const [mediaHealth, aiHealth, sipHealth, kamHealth] = await Promise.allSettled([
          getMediaGateway().getHealth(),
          getAIPipeline().healthCheck(),
          Promise.resolve(getSIPTrunkRegistry().getAllHealth()),
          getKamailioClient().ping(),
        ]);

        res.json({
          media: mediaHealth.status === "fulfilled" ? mediaHealth.value : { error: "unavailable" },
          ai: aiHealth.status === "fulfilled" ? aiHealth.value : { error: "unavailable" },
          sipTrunks: sipHealth.status === "fulfilled" ? sipHealth.value : {},
          kamailio: kamHealth.status === "fulfilled" ? kamHealth.value : { healthy: false },
          timestamp: new Date().toISOString(),
        });
      } catch (err) {
        logger.error("EnterpriseHub", `Health check error: ${err}`);
        res.status(500).json({ message: "Health check failed" });
      }
    },
  );

  // ── SIP trunk status ─────────────────────────────────────────────────────
  app.get(
    "/api/enterprise-hub/sip/trunks",
    loadUser,
    requireCompanyAdminOrAbove,
    async (_req: Request, res: Response) => {
      try {
        const registry = getSIPTrunkRegistry();
        const trunks = registry.getTrunks().map((t) => ({
          id: t.id,
          name: t.name,
          provider: t.config.provider,
          host: t.config.host,
          port: t.config.port,
          transport: t.config.transport,
          priority: t.config.priority,
          weight: t.config.weight,
          supportedPrefixes: t.config.supportedPrefixes,
          region: t.config.region,
          health: registry.getHealth(t.id),
        }));
        res.json({ trunks });
      } catch (err) {
        res.status(500).json({ message: "Failed to list SIP trunks" });
      }
    },
  );

  // ── Force Kamailio dispatcher reload ────────────────────────────────────
  app.post(
    "/api/enterprise-hub/sip/reload",
    loadUser,
    requireCompanyAdminOrAbove,
    async (_req: Request, res: Response) => {
      try {
        const kam = getKamailioClient();
        if (!kam.isConfigured()) {
          return res.status(503).json({ message: "Kamailio MI not configured (KAMAILIO_MI_URL not set)" });
        }
        const ok = await kam.dispatcherReload();
        res.json({ success: ok, message: ok ? "Dispatcher table reloaded" : "Reload failed" });
      } catch (err) {
        res.status(500).json({ message: String(err) });
      }
    },
  );

  // ── AI pipeline test (translate a sample phrase) ─────────────────────────
  app.post(
    "/api/enterprise-hub/ai/test-translate",
    loadUser,
    requireCompanyAdminOrAbove,
    async (req: Request, res: Response) => {
      try {
        const { text, fromLanguage, toLanguage } = req.body as {
          text?: string;
          fromLanguage?: string;
          toLanguage?: string;
        };
        if (!text || !toLanguage) {
          return res.status(400).json({ message: "text and toLanguage are required" });
        }
        const result = await getAIPipeline().translate({
          text,
          fromLanguage: (fromLanguage as any) || "auto",
          toLanguage: toLanguage as any,
        });
        res.json({ result });
      } catch (err) {
        res.status(500).json({ message: String(err) });
      }
    },
  );

  // ── Agent assist feedback ────────────────────────────────────────────────
  app.post(
    "/api/enterprise-hub/assist/feedback",
    loadUser,
    async (req: Request, res: Response) => {
      const { suggestionId, callId, rating } = req.body as {
        suggestionId?: string;
        callId?: string;
        rating?: "up" | "down";
      };
      if (!suggestionId || !callId || !rating) {
        return res.status(400).json({ message: "suggestionId, callId, rating required" });
      }
      // Persist to Redis for model improvement pipeline (async, non-blocking)
      const redis = await import("../redis").then((m) => m.getRedisClient());
      redis
        .lpush(
          "agent_assist:feedback",
          JSON.stringify({ suggestionId, callId, rating, agentId: (req.user as AuthenticatedUser)?.id, ts: Date.now() }),
        )
        .catch(() => {});
      res.json({ success: true });
    },
  );
}
