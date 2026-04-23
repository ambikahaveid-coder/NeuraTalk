import type { Express, Request, Response } from "express";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { createApiKeyMiddleware } from "./api-key-auth";
import { db } from "./db";
import { communicationApiKeyPricing, communicationSessions } from "@shared/schema";
import { loadUser, requireSuperAdmin } from "./role-middleware";
import {
  activatePstnFallback,
  createCommunicationCallSession,
  endCommunicationCallSession,
  getCommunicationBillingSummary,
  getCommunicationCallStatus,
  handleCommunicationLiveKitWebhook,
  handleCommunicationPstnWebhook,
  listCommunicationUsage,
  updateCommunicationSessionState,
} from "./communication-api-service";

const participantSchema = z.object({
  externalId: z.string().min(1),
  phoneNumber: z.string().min(3).optional().nullable(),
  displayName: z.string().min(1).optional().nullable(),
  language: z.string().min(2).max(16).optional().nullable(),
});

const createCallSessionSchema = z.object({
  caller: participantSchema,
  callee: participantSchema,
  callType: z.enum(["voice", "video"]).default("voice"),
  transportPreference: z.enum(["app_to_app", "auto", "pstn"]).optional(),
  enableRecording: z.boolean().optional(),
  enableAiAssistant: z.boolean().optional(),
  metadata: z.record(z.unknown()).optional(),
});

const updateStatusSchema = z.object({
  participantIdentity: z.string().min(1).optional(),
  state: z.enum(["ringing", "joined", "left", "failed"]),
  metadata: z.record(z.unknown()).optional(),
});

const pricingConfigSchema = z.object({
  billingModel: z.enum(["prepaid", "postpaid"]),
  prepaidBalancePaise: z.number().int().min(0).optional(),
  postpaidCreditLimitPaise: z.number().int().min(0).optional(),
  voiceRatePerSecondPaise: z.number().min(0).optional(),
  videoRatePerSecondPaise: z.number().min(0).optional(),
  pstnFallbackRatePerSecondPaise: z.number().min(0).optional(),
  connectionFeePaise: z.number().int().min(0).optional(),
  allowPstnFallback: z.boolean().optional(),
  allowRecording: z.boolean().optional(),
  maxConcurrentSessions: z.number().int().min(1).max(10000).optional(),
  region: z.string().min(2).max(32).optional(),
  metadata: z.record(z.unknown()).optional(),
});

function respondWithError(res: Response, error: unknown, fallback = "Request failed") {
  const code = error instanceof Error ? error.message : String(error);

  if (code === "SESSION_NOT_FOUND") return res.status(404).json({ error: "Session not found" });
  if (code === "SUBSCRIPTION_REQUIRED") return res.status(402).json({ error: "Active subscription required" });
  if (code === "INSUFFICIENT_PREPAID_BALANCE") return res.status(402).json({ error: "Insufficient prepaid balance" });
  if (code === "POSTPAID_CREDIT_LIMIT_REACHED") return res.status(402).json({ error: "Postpaid credit limit reached" });
  if (code === "CONCURRENT_SESSION_LIMIT_REACHED") return res.status(429).json({ error: "Concurrent session limit reached" });
  if (code === "CALLEE_PHONE_REQUIRED_FOR_PSTN") return res.status(400).json({ error: "Callee phone number is required for PSTN fallback" });
  if (code === "MASKED_NUMBER_REQUIRED") return res.status(500).json({ error: "No masked number available for PSTN fallback" });
  if (code === "PSTN_FALLBACK_DISABLED") return res.status(403).json({ error: "PSTN fallback is disabled for this API key" });

  console.error("[CommunicationAPI]", fallback, error);
  return res.status(500).json({ error: fallback });
}

export function registerCommunicationApiRoutes(app: Express): void {
  app.post("/api/communication/create-call-session", createApiKeyMiddleware("calls:create"), async (req: Request, res: Response) => {
    const parsed = createCallSessionSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid request", details: parsed.error.flatten() });
    }

    try {
      const result = await createCommunicationCallSession(req.apiKey!, parsed.data);
      res.status(201).json(result);
    } catch (error) {
      respondWithError(res, error, "Failed to create communication session");
    }
  });

  app.post("/api/communication/end-call", createApiKeyMiddleware("calls:end"), async (req: Request, res: Response) => {
    const sessionId = typeof req.body?.sessionId === "string" ? req.body.sessionId : "";
    const reason = typeof req.body?.reason === "string" ? req.body.reason : "api_end";

    if (!sessionId) {
      return res.status(400).json({ error: "sessionId is required" });
    }

    try {
      const result = await endCommunicationCallSession(req.apiKey!, sessionId, reason);
      res.json(result);
    } catch (error) {
      respondWithError(res, error, "Failed to end communication session");
    }
  });

  app.get("/api/communication/call-status/:sessionId", createApiKeyMiddleware("calls:read"), async (req: Request, res: Response) => {
    try {
      const result = await getCommunicationCallStatus(req.apiKey!, req.params.sessionId);
      res.json(result);
    } catch (error) {
      respondWithError(res, error, "Failed to fetch communication status");
    }
  });

  app.post("/api/communication/call-status/:sessionId", createApiKeyMiddleware("calls:create"), async (req: Request, res: Response) => {
    const parsed = updateStatusSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid request", details: parsed.error.flatten() });
    }

    try {
      await updateCommunicationSessionState(req.apiKey!, req.params.sessionId, parsed.data);
      const status = await getCommunicationCallStatus(req.apiKey!, req.params.sessionId);
      res.json(status);
    } catch (error) {
      respondWithError(res, error, "Failed to update communication status");
    }
  });

  app.post("/api/communication/sessions/:sessionId/fallback", createApiKeyMiddleware("calls:create"), async (req: Request, res: Response) => {
    try {
      const result = await activatePstnFallback(req.apiKey!, req.params.sessionId);
      res.json(result);
    } catch (error) {
      respondWithError(res, error, "Failed to activate PSTN fallback");
    }
  });

  app.get("/api/communication/usage", createApiKeyMiddleware("usage:read"), async (req: Request, res: Response) => {
    const from = typeof req.query.from === "string" ? new Date(req.query.from) : undefined;
    const to = typeof req.query.to === "string" ? new Date(req.query.to) : undefined;
    const limit = typeof req.query.limit === "string" ? Number(req.query.limit) : undefined;

    try {
      const result = await listCommunicationUsage(req.apiKey!, {
        from: from && !Number.isNaN(from.getTime()) ? from : undefined,
        to: to && !Number.isNaN(to.getTime()) ? to : undefined,
        limit: Number.isFinite(limit) ? limit : undefined,
      });
      res.json(result);
    } catch (error) {
      respondWithError(res, error, "Failed to fetch communication usage");
    }
  });

  app.get("/api/communication/billing", createApiKeyMiddleware("billing:read"), async (req: Request, res: Response) => {
    try {
      const result = await getCommunicationBillingSummary(req.apiKey!);
      res.json(result);
    } catch (error) {
      respondWithError(res, error, "Failed to fetch billing summary");
    }
  });

  app.post("/api/communication/livekit-webhook", async (req: Request, res: Response) => {
    try {
      const authHeader = req.headers.authorization || "";
      const raw = (req as Request & { rawBody?: unknown }).rawBody;
      const rawBody = Buffer.isBuffer(raw)
        ? raw.toString("utf8")
        : typeof raw === "string"
          ? raw
          : JSON.stringify(req.body ?? {});

      const result = await handleCommunicationLiveKitWebhook(rawBody, authHeader);
      res.json(result);
    } catch (error) {
      console.error("[CommunicationAPI] LiveKit webhook failed", error);
      res.status(400).json({ error: "Invalid LiveKit webhook" });
    }
  });

  app.post("/api/communication/pstn-webhook/:sessionId", async (req: Request, res: Response) => {
    try {
      const result = await handleCommunicationPstnWebhook(req.params.sessionId, req.body ?? {});
      res.json(result);
    } catch (error) {
      console.error("[CommunicationAPI] PSTN webhook failed", error);
      res.status(500).json({ error: "Failed to process PSTN webhook" });
    }
  });

  app.get("/api/admin/communication-api/overview", loadUser, requireSuperAdmin, async (_req: Request, res: Response) => {
    try {
      const recentSessions = await db.select()
        .from(communicationSessions)
        .orderBy(desc(communicationSessions.createdAt))
        .limit(20);

      const pricingConfigs = await db.select()
        .from(communicationApiKeyPricing)
        .orderBy(desc(communicationApiKeyPricing.updatedAt))
        .limit(50);

      res.json({
        recentSessions,
        pricingConfigs,
      });
    } catch (error) {
      console.error("[CommunicationAPI] Failed to load admin overview", error);
      res.status(500).json({ error: "Failed to load communication overview" });
    }
  });

  app.get("/api/admin/communication-api/pricing/:apiKeyId", loadUser, requireSuperAdmin, async (req: Request, res: Response) => {
    try {
      const apiKeyId = Number(req.params.apiKeyId);
      const [pricing] = await db.select()
        .from(communicationApiKeyPricing)
        .where(eq(communicationApiKeyPricing.apiKeyId, apiKeyId))
        .limit(1);

      res.json({ pricing: pricing ?? null });
    } catch (error) {
      console.error("[CommunicationAPI] Failed to fetch pricing config", error);
      res.status(500).json({ error: "Failed to fetch pricing config" });
    }
  });

  app.put("/api/admin/communication-api/pricing/:apiKeyId", loadUser, requireSuperAdmin, async (req: Request, res: Response) => {
    const parsed = pricingConfigSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid pricing config", details: parsed.error.flatten() });
    }

    try {
      const apiKeyId = Number(req.params.apiKeyId);
      const organizationId = Number(req.body.organizationId);
      if (!apiKeyId || !organizationId) {
        return res.status(400).json({ error: "apiKeyId and organizationId are required" });
      }

      const [existing] = await db.select()
        .from(communicationApiKeyPricing)
        .where(eq(communicationApiKeyPricing.apiKeyId, apiKeyId))
        .limit(1);

      if (existing) {
        const [updated] = await db.update(communicationApiKeyPricing)
          .set({
            ...parsed.data,
            updatedAt: new Date(),
          })
          .where(eq(communicationApiKeyPricing.id, existing.id))
          .returning();
        return res.json({ pricing: updated });
      }

      const [created] = await db.insert(communicationApiKeyPricing)
        .values({
          apiKeyId,
          organizationId,
          billingModel: parsed.data.billingModel,
          prepaidBalancePaise: parsed.data.prepaidBalancePaise ?? 0,
          postpaidCreditLimitPaise: parsed.data.postpaidCreditLimitPaise ?? 0,
          voiceRatePerSecondPaise: parsed.data.voiceRatePerSecondPaise,
          videoRatePerSecondPaise: parsed.data.videoRatePerSecondPaise,
          pstnFallbackRatePerSecondPaise: parsed.data.pstnFallbackRatePerSecondPaise ?? 0,
          connectionFeePaise: parsed.data.connectionFeePaise ?? 0,
          allowPstnFallback: parsed.data.allowPstnFallback ?? true,
          allowRecording: parsed.data.allowRecording ?? false,
          maxConcurrentSessions: parsed.data.maxConcurrentSessions ?? 100,
          region: parsed.data.region ?? "ap-south-1",
          metadata: parsed.data.metadata ?? {},
        })
        .returning();

      res.status(201).json({ pricing: created });
    } catch (error) {
      console.error("[CommunicationAPI] Failed to save pricing config", error);
      res.status(500).json({ error: "Failed to save pricing config" });
    }
  });
}
