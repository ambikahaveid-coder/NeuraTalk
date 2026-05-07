import type { Express, Request, Response } from "express";
import { z } from "zod";
import { loadUser, requireAuth, requireSuperAdmin } from "./role-middleware";
import { requireActiveSubscription, warnLowBalance } from "./usage-enforcement";

const createSessionSchema = z.object({
  language: z.string().min(2).max(8).default("en"),
  assistantName: z.string().min(1).max(60).optional(),
  systemPrompt: z.string().min(1).max(2_000).optional(),
});

async function loadVoiceAssistantService() {
  return import("./voice-assistant-service");
}

export function registerVoiceAssistantRoutes(app: Express): void {
  app.get("/api/voice-assistant/health", loadUser, requireAuth, async (_req: Request, res: Response) => {
    try {
      const { getVoiceAssistantHealth } = await loadVoiceAssistantService();
      res.json(getVoiceAssistantHealth());
    } catch (error) {
      const message = error instanceof Error ? error.message : "Voice assistant unavailable";
      res.status(503).json({
        configured: false,
        livekit: false,
        deepgram: false,
        openai: false,
        azure: false,
        targetLatencyMs: 0,
        model: {
          deepgram: "",
          openai: "",
          azureRegion: "",
        },
        message,
      });
    }
  });

  app.get(
    "/api/voice-assistant/sessions",
    loadUser,
    requireAuth,
    requireSuperAdmin,
    async (_req: Request, res: Response) => {
      try {
        const { listVoiceAssistantSessions } = await loadVoiceAssistantService();
        res.json({ sessions: listVoiceAssistantSessions() });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Voice assistant unavailable";
        res.status(503).json({ success: false, message });
      }
    },
  );

  app.post(
    "/api/voice-assistant/session",
    loadUser,
    requireAuth,
    requireActiveSubscription,
    warnLowBalance,
    async (req: Request, res: Response) => {
      const parsed = createSessionSchema.safeParse(req.body || {});
      if (!parsed.success) {
        return res.status(400).json({
          success: false,
          message: "Invalid voice assistant session request",
          errors: parsed.error.flatten(),
        });
      }

      try {
        const { createVoiceAssistantSession } = await loadVoiceAssistantService();
        const session = await createVoiceAssistantSession({
          userId: req.user!.id,
          displayName: req.user!.username || `user-${req.user!.id}`,
          language: parsed.data.language,
          assistantName: parsed.data.assistantName,
          systemPrompt: parsed.data.systemPrompt,
        });
        res.status(201).json(session);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to create voice assistant session";
        res.status(503).json({ success: false, message });
      }
    },
  );

  app.delete(
    "/api/voice-assistant/session/:sessionId",
    loadUser,
    requireAuth,
    async (req: Request, res: Response) => {
      let session;
      try {
        const { getVoiceAssistantSession } = await loadVoiceAssistantService();
        session = getVoiceAssistantSession(req.params.sessionId);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Voice assistant unavailable";
        return res.status(503).json({ success: false, message });
      }

      if (!session) {
        return res.status(404).json({ success: false, message: "Session not found" });
      }

      if (req.user!.role !== "super_admin" && session.userId !== req.user!.id) {
        return res.status(403).json({ success: false, message: "You cannot close this session" });
      }

      const { endVoiceAssistantSession } = await loadVoiceAssistantService();
      await endVoiceAssistantSession(req.params.sessionId);
      res.status(204).send();
    },
  );
}
