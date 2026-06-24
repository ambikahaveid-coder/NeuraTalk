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
  language: z.string().min(2).max(16).optional().nullable().default("auto"),
  gender: z.enum(["male", "female", "other", "undisclosed"]).optional().nullable(),
});

const secPlusCallSchema = z.object({
  caseId: z.string().min(1).max(120),
  initiator: z.enum(["agent", "customer"]),
  agent: participantSchema,
  customer: participantSchema,
  callType: z.enum(["voice", "video"]).default("voice"),
  transportPreference: z.enum(["app_to_app", "auto", "pstn"]).optional().default("auto"),
  enableRecording: z.boolean().optional().default(true),
  metadata: z.record(z.unknown()).optional(),
});

const secPlusSafetyCallSchema = z.object({
  caseId: z.string().min(1).max(120),
  initiator: z.enum(["agent", "customer"]),
  agent: participantSchema,
  customer: participantSchema,
  transportPreference: z.enum(["app_to_app", "auto", "pstn"]).optional().default("auto"),
  protectedParticipantRole: z.enum(["agent", "customer", "auto"]).optional().default("auto"),
  forceSafetyRecording: z.boolean().optional().default(false),
  metadata: z.record(z.unknown()).optional(),
});

function resolveProtectedParticipantRole(
  requestedRole: "agent" | "customer" | "auto",
  agent: z.infer<typeof participantSchema>,
  customer: z.infer<typeof participantSchema>,
) {
  if (requestedRole !== "auto") {
    return requestedRole;
  }
  if (customer.gender === "female") {
    return "customer";
  }
  if (agent.gender === "female") {
    return "agent";
  }
  return "customer";
}

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

  console.error("[SecPlusIntegration]", fallback, error);
  return res.status(500).json({ error: fallback });
}

export function registerSecPlusIntegrationRoutes(app: Express): void {
  app.post("/api/integrations/secplus/contact-call", createApiKeyMiddleware("calls:create"), async (req: Request, res: Response) => {
    const parsed = secPlusCallSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid request", details: parsed.error.flatten() });
    }

    const { caseId, initiator, agent, customer, callType, transportPreference, enableRecording, metadata } = parsed.data;
    const caller = initiator === "agent" ? agent : customer;
    const callee = initiator === "agent" ? customer : agent;

    try {
      const result = await createCommunicationCallSession(req.apiKey!, {
        caller: {
          ...caller,
          language: caller.language || "auto",
        },
        callee: {
          ...callee,
          language: callee.language || "auto",
        },
        callType,
        transportPreference,
        enableRecording,
        metadata: {
          integration: "secplus",
          purpose: "agent_customer_contact",
          caseId,
          initiator,
          autoLanguageDetect: true,
          expectedRecording: enableRecording,
          ...metadata,
        },
      });

      res.status(201).json({
        integration: "secplus",
        purpose: "agent_customer_contact",
        caseId,
        initiator,
        route: result.joinMethod,
        sessionId: result.sessionId,
        callId: result.sessionId,
        livekitUrl: result.livekit.url || null,
        livekit: result.livekit,
        livekitToken: result.livekit.callerToken,
        pstnCallId: result.session?.pstnCallId || null,
        recordingRequested: enableRecording,
        recordingEnabled: enableRecording,
        autoLanguageDetect: true,
        websocket: result.websocket,
        masking: result.masking,
        pricing: result.pricing,
        session: result.session,
      });
    } catch (error) {
      respondWithError(res, error, "Failed to create SecPlus contact call");
    }
  });

  app.get("/api/integrations/secplus/contact-call/:sessionId", createApiKeyMiddleware("calls:read"), async (req: Request, res: Response) => {
    try {
      const result = await getCommunicationCallStatus(req.apiKey!, req.params.sessionId);
      res.json({
        integration: "secplus",
        purpose: "agent_customer_contact",
        autoLanguageDetect: true,
        ...result,
      });
    } catch (error) {
      respondWithError(res, error, "Failed to fetch SecPlus contact call status");
    }
  });

  app.post("/api/integrations/secplus/contact-call/:sessionId/end", createApiKeyMiddleware("calls:end"), async (req: Request, res: Response) => {
    const reason = typeof req.body?.reason === "string" ? req.body.reason : "secplus_api_end";

    try {
      const result = await endCommunicationCallSession(req.apiKey!, req.params.sessionId, reason);
      res.json({
        integration: "secplus",
        purpose: "agent_customer_contact",
        ...result,
      });
    } catch (error) {
      respondWithError(res, error, "Failed to end SecPlus contact call");
    }
  });

  app.post("/api/integrations/secplus/contact-call/:sessionId/fallback", createApiKeyMiddleware("calls:create"), async (req: Request, res: Response) => {
    try {
      const result = await activatePstnFallback(req.apiKey!, req.params.sessionId);
      res.json({
        integration: "secplus",
        purpose: "agent_customer_contact",
        ...result,
      });
    } catch (error) {
      respondWithError(res, error, "Failed to activate SecPlus PSTN fallback");
    }
  });

  app.post("/api/integrations/secplus/safety-contact-call", createApiKeyMiddleware("calls:create"), async (req: Request, res: Response) => {
    const parsed = secPlusSafetyCallSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid request", details: parsed.error.flatten() });
    }

    const { caseId, initiator, agent, customer, transportPreference, forceSafetyRecording, metadata } = parsed.data;
    const caller = initiator === "agent" ? agent : customer;
    const callee = initiator === "agent" ? customer : agent;
    const protectedParticipantRole = resolveProtectedParticipantRole(parsed.data.protectedParticipantRole, agent, customer);
    const protectedParticipant = protectedParticipantRole === "agent" ? agent : customer;
    const recordingRequired = forceSafetyRecording || protectedParticipant.gender === "female";

    try {
      const result = await createCommunicationCallSession(req.apiKey!, {
        caller: {
          ...caller,
          language: caller.language || "auto",
        },
        callee: {
          ...callee,
          language: callee.language || "auto",
        },
        callType: "voice",
        transportPreference,
        enableRecording: recordingRequired,
        metadata: {
          integration: "secplus",
          purpose: "protected_contact_call",
          caseId,
          initiator,
          autoLanguageDetect: true,
          protectedParticipantRole,
          protectedParticipantGender: protectedParticipant.gender || "undisclosed",
          safetyRecordingPolicy: recordingRequired ? "protected-participant-auto" : "manual-off",
          requireConsentAnnouncement: true,
          ...metadata,
        },
      });

      res.status(201).json({
        integration: "secplus",
        purpose: "protected_contact_call",
        caseId,
        initiator,
        route: result.joinMethod,
        sessionId: result.sessionId,
        callId: result.sessionId,
        livekitUrl: result.livekit.url || null,
        livekit: result.livekit,
        livekitToken: result.livekit.callerToken,
        pstnCallId: result.session?.pstnCallId || null,
        autoLanguageDetect: true,
        voiceOnly: true,
        protectedParticipantRole,
        recordingRequested: recordingRequired,
        recordingEnabled: recordingRequired,
        consentAnnouncementRequired: true,
        websocket: result.websocket,
        masking: result.masking,
        pricing: result.pricing,
        session: result.session,
      });
    } catch (error) {
      respondWithError(res, error, "Failed to create SecPlus safety contact call");
    }
  });
}
