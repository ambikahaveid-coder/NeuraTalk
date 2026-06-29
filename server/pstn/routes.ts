/**
 * PSTN Routes
 *
 * Registers all PSTN-related HTTP endpoints:
 *
 *   POST /api/pstn/inbound              — Provider webhook: inbound call arriving
 *   POST /api/pstn/status               — Provider webhook: outbound call status event
 *   POST /api/pstn/twilio/webhook       — Twilio-specific status webhook
 *   POST /api/pstn/twilio/twiml/:callId — Twilio TwiML fetch for SIP bridging
 *   GET  /api/pstn/health               — Provider health check (admin)
 *   GET  /api/pstn/metrics              — PSTN metrics (admin)
 *   GET  /api/pstn/calls/:callId/join   — Get LiveKit join info for an inbound call
 *   GET  /api/pstn/cdrs                 — CDR export (admin, org-scoped)
 */

import type { Express, Request, Response } from "express";
import { getPSTNProvider, isPSTNAvailable } from "./registry";
import { handleInboundCall, getInboundCallJoinInfo } from "./inbound";
import { getInboundCallByProviderCallId } from "./inbound-store";
import { getPSTNMetrics } from "./monitor";
import { listRecentCDRsForOrg, cdrsToCSV } from "./cdr";
import { updateSmartCallStatus } from "../modules/calls/smart-router";
import { loadUser, requireAuth, requireSuperAdmin } from "../role-middleware";
import { logger } from "../observability";
import type { PSTNStatusEvent } from "./provider";

async function processStatusEvent(event: PSTNStatusEvent): Promise<void> {
  const callId = event.internalCallId;
  if (!callId) {
    // Try to find by providerCallId (inbound calls)
    const inbound = await getInboundCallByProviderCallId(event.providerCallId);
    if (!inbound) {
      logger.warn("PSTNRoutes", `Status event for unknown providerCallId ${event.providerCallId}`);
      return;
    }
    const statusMap: Record<string, string> = {
      answered: "answered",
      active: "active",
      ended: "ended",
      failed: "failed",
      busy: "busy",
      "no-answer": "missed",
      cancelled: "cancelled",
    };
    const mappedStatus = statusMap[event.status] || "ended";
    await updateSmartCallStatus(inbound.callId, mappedStatus, {
      providerCallId: event.providerCallId,
      providerStatus: event.status,
      durationSeconds: event.durationSeconds,
      disconnectReason: event.disconnectReason,
    }).catch((err) => {
      logger.warn("PSTNRoutes", `Status update failed for inbound ${inbound.callId}: ${String(err)}`);
    });
    return;
  }

  const statusMap: Record<string, string> = {
    ringing: "ringing",
    answered: "answered",
    active: "active",
    ended: "ended",
    failed: "failed",
    busy: "busy",
    "no-answer": "missed",
    cancelled: "cancelled",
  };
  const mappedStatus = statusMap[event.status] || "ended";

  await updateSmartCallStatus(callId, mappedStatus, {
    providerCallId: event.providerCallId,
    providerStatus: event.status,
    durationSeconds: event.durationSeconds,
    disconnectReason: event.disconnectReason,
    answeredAt: event.answeredAt,
    endedAt: event.endedAt,
  }).catch((err) => {
    logger.warn("PSTNRoutes", `Status update failed for ${callId}: ${String(err)}`);
  });
}

function rawHeaders(req: Request): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(req.headers)) {
    if (typeof v === "string") out[k] = v;
    else if (Array.isArray(v)) out[k] = v[0] || "";
  }
  return out;
}

export function registerPSTNRoutes(app: Express): void {
  // ── Inbound PSTN webhook (provider calls this when a call arrives) ──────────
  app.post("/api/pstn/inbound", async (req: Request, res: Response) => {
    if (!isPSTNAvailable()) {
      return res.status(503).json({ error: "pstn_not_configured" });
    }
    try {
      const provider = getPSTNProvider();
      const headers = rawHeaders(req);
      const rawBody = typeof req.body === "string" ? req.body : JSON.stringify(req.body);
      if (!provider.verifyWebhookSignature(rawBody, headers)) {
        logger.warn("PSTNRoutes", "Inbound webhook signature verification failed");
        return res.status(403).json({ error: "invalid_signature" });
      }
      const { status, body } = await handleInboundCall(req.body, headers);
      return res.status(status).json(body);
    } catch (err) {
      logger.error("PSTNRoutes", `Inbound webhook handler failed: ${String(err)}`);
      return res.status(500).json({ error: "internal_error" });
    }
  });

  // ── Outbound PSTN status webhook (provider sends call state updates) ─────────
  app.post("/api/pstn/status", async (req: Request, res: Response) => {
    if (!isPSTNAvailable()) {
      return res.status(200).json({ ok: false });
    }
    try {
      const provider = getPSTNProvider();
      const headers = rawHeaders(req);
      const event = provider.parseStatusWebhook(req.body, headers);
      if (event) {
        await processStatusEvent(event);
      }
      return res.status(200).json({ ok: true });
    } catch (err) {
      logger.warn("PSTNRoutes", `Status webhook error: ${String(err)}`);
      return res.status(200).json({ ok: false });
    }
  });

  // ── Twilio-specific status webhook ──────────────────────────────────────────
  app.post("/api/pstn/twilio/webhook", async (req: Request, res: Response) => {
    try {
      const { TwilioProvider } = await import("./twilio");
      const provider = new TwilioProvider();
      const headers = rawHeaders(req);
      const rawBody = typeof req.body === "string" ? req.body : new URLSearchParams(req.body).toString();

      if (!provider.verifyWebhookSignature(rawBody, headers)) {
        logger.warn("PSTNRoutes", "Twilio webhook signature verification failed");
        return res.status(403).send("Forbidden");
      }

      const event = provider.parseStatusWebhook(req.body, headers);
      if (event) {
        await processStatusEvent(event);
      }
      return res.status(200).send("<Response/>");
    } catch (err) {
      logger.warn("PSTNRoutes", `Twilio webhook error: ${String(err)}`);
      return res.status(200).send("<Response/>");
    }
  });

  // ── Twilio TwiML endpoint (Twilio fetches this on call answer) ───────────────
  app.post("/api/pstn/twilio/twiml/:callId", async (req: Request, res: Response) => {
    const { callId } = req.params;
    const sipDomain = process.env.LIVEKIT_SIP_DOMAIN || "sip.livekit.local";
    const sipUri = `sip:${callId}@${sipDomain}`;
    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Dial timeout="30">
    <Sip>${sipUri}</Sip>
  </Dial>
</Response>`;
    res.set("Content-Type", "text/xml");
    return res.status(200).send(twiml);
  });

  // ── Get join info for an inbound call (called by the receiving app) ──────────
  app.get("/api/pstn/calls/:callId/join", loadUser, requireAuth, async (req: Request, res: Response) => {
    try {
      const info = await getInboundCallJoinInfo(req.params.callId);
      if (!info) {
        return res.status(404).json({ error: "call_not_found" });
      }
      return res.json(info);
    } catch (err) {
      logger.warn("PSTNRoutes", `Join info fetch failed: ${String(err)}`);
      return res.status(500).json({ error: "internal_error" });
    }
  });

  // ── PSTN health check (admin only) ──────────────────────────────────────────
  app.get("/api/pstn/health", loadUser, requireAuth, requireSuperAdmin, async (_req: Request, res: Response) => {
    try {
      const metrics = await getPSTNMetrics();
      return res.json(metrics);
    } catch (err) {
      return res.status(500).json({ error: String(err) });
    }
  });

  // ── PSTN metrics (alias, same as health for now) ─────────────────────────────
  app.get("/api/pstn/metrics", loadUser, requireAuth, requireSuperAdmin, async (_req: Request, res: Response) => {
    try {
      const metrics = await getPSTNMetrics();
      return res.json(metrics);
    } catch (err) {
      return res.status(500).json({ error: String(err) });
    }
  });

  // ── CDR export (admin, org-scoped) ──────────────────────────────────────────
  app.get("/api/pstn/cdrs", loadUser, requireAuth, requireSuperAdmin, async (req: Request, res: Response) => {
    try {
      const orgId = req.query.orgId ? parseInt(String(req.query.orgId), 10) : null;
      const format = String(req.query.format || "json").toLowerCase();
      const limit = Math.min(500, parseInt(String(req.query.limit || "100"), 10) || 100);

      if (!orgId || !Number.isFinite(orgId)) {
        return res.status(400).json({ error: "orgId required" });
      }

      const cdrs = await listRecentCDRsForOrg(orgId, limit);

      if (format === "csv") {
        res.set("Content-Type", "text/csv");
        res.set("Content-Disposition", `attachment; filename="cdrs-org-${orgId}.csv"`);
        return res.send(cdrsToCSV(cdrs));
      }

      return res.json({ cdrs, count: cdrs.length });
    } catch (err) {
      return res.status(500).json({ error: String(err) });
    }
  });

  logger.info("PSTNRoutes", "PSTN routes registered");
}
