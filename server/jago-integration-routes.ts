import type { Express, Request, Response } from "express";
import { z } from "zod";
import { createApiKeyMiddleware } from "./api-key-auth";
import {
  activatePstnFallback,
  createCommunicationCallSession,
  endCommunicationCallSession,
  getCommunicationCallStatus,
} from "./communication-api-service";

const participantSchema = z.object({
  externalId: z.string().min(1),
  phoneNumber: z.string().min(3).optional().nullable(),
  displayName: z.string().min(1).optional().nullable(),
  language: z.string().min(2).max(16).optional().nullable(),
});

const jagoContactCallSchema = z.object({
  rideId: z.string().min(1).max(120),
  initiator: z.enum(["driver", "user"]),
  driver: participantSchema,
  user: participantSchema,
  callType: z.enum(["voice", "video"]).default("voice"),
  transportPreference: z.enum(["app_to_app", "auto", "pstn"]).optional().default("auto"),
  enableRecording: z.boolean().optional().default(false),
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
  if (code.startsWith("FRAUD_CHECK_BLOCKED")) return res.status(403).json({ error: "This call was blocked by automated fraud protection" });

  console.error("[JagoIntegration]", fallback, error);
  return res.status(500).json({ error: fallback });
}

export function registerJagoIntegrationRoutes(app: Express): void {
  app.post("/api/integrations/jago/contact-call", createApiKeyMiddleware("calls:create"), async (req: Request, res: Response) => {
    const parsed = jagoContactCallSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid request", details: parsed.error.flatten() });
    }

    const { rideId, initiator, driver, user, callType, transportPreference, enableRecording, metadata } = parsed.data;
    const caller = initiator === "driver" ? driver : user;
    const callee = initiator === "driver" ? user : driver;

    try {
      const result = await createCommunicationCallSession(req.apiKey!, {
        caller,
        callee,
        callType,
        transportPreference,
        enableRecording,
        metadata: {
          integration: "jago",
          purpose: "driver_user_contact",
          rideId,
          initiator,
          ...metadata,
        },
      });

      res.status(201).json({
        integration: "jago",
        purpose: "driver_user_contact",
        rideId,
        initiator,
        route: result.joinMethod,
        sessionId: result.sessionId,
        callId: result.sessionId,
        livekitUrl: result.livekit.url || null,
        livekit: result.livekit,
        livekitToken: result.livekit.callerToken,
        estimatedRateInrPerMin: Number(result.pricing.voiceRatePerSecondPaise || 0) * 60 / 100,
        pstnCallId: result.session?.pstnCallId || null,
        websocket: result.websocket,
        masking: result.masking,
        pricing: result.pricing,
        session: result.session,
      });
    } catch (error) {
      respondWithError(res, error, "Failed to create Jago contact call");
    }
  });

  app.get("/api/integrations/jago/contact-call/:sessionId", createApiKeyMiddleware("calls:read"), async (req: Request, res: Response) => {
    try {
      const result = await getCommunicationCallStatus(req.apiKey!, req.params.sessionId);
      res.json({
        integration: "jago",
        purpose: "driver_user_contact",
        ...result,
      });
    } catch (error) {
      respondWithError(res, error, "Failed to fetch Jago contact call status");
    }
  });

  app.post("/api/integrations/jago/contact-call/:sessionId/end", createApiKeyMiddleware("calls:end"), async (req: Request, res: Response) => {
    const reason = typeof req.body?.reason === "string" ? req.body.reason : "jago_api_end";

    try {
      const result = await endCommunicationCallSession(req.apiKey!, req.params.sessionId, reason);
      res.json({
        integration: "jago",
        purpose: "driver_user_contact",
        ...result,
      });
    } catch (error) {
      respondWithError(res, error, "Failed to end Jago contact call");
    }
  });

  app.post("/api/integrations/jago/contact-call/:sessionId/fallback", createApiKeyMiddleware("calls:create"), async (req: Request, res: Response) => {
    try {
      const result = await activatePstnFallback(req.apiKey!, req.params.sessionId);
      res.json({
        integration: "jago",
        purpose: "driver_user_contact",
        ...result,
      });
    } catch (error) {
      respondWithError(res, error, "Failed to activate Jago PSTN fallback");
    }
  });
}
