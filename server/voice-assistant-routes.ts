import type { Express, Request, Response } from "express";
import { z } from "zod";
import { loadUser, requireAuth, requireSuperAdmin } from "./role-middleware";
import { requireActiveSubscription, warnLowBalance } from "./usage-enforcement";
import {
  createVoiceAssistantSession,
  endVoiceAssistantSession,
  getVoiceAssistantHealth,
  getVoiceAssistantSession,
  listVoiceAssistantSessions,
} from "./voice-assistant-service";

const createSessionSchema = z.object({
  language: z.string().min(2).max(8).default("en"),
  assistantName: z.string().min(1).max(60).optional(),
  systemPrompt: z.string().min(1).max(2_000).optional(),
});

export function registerVoiceAssistantRoutes(app: Express): void {
  app.get("/api/voice-assistant/health", loadUser, requireAuth, (_req: Request, res: Response) => {
    res.json(getVoiceAssistantHealth());
  });

  app.get(
    "/api/voice-assistant/sessions",
    loadUser,
    requireAuth,
    requireSuperAdmin,
    (_req: Request, res: Response) => {
      res.json({ sessions: listVoiceAssistantSessions() });
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
      const session = getVoiceAssistantSession(req.params.sessionId);
      if (!session) {
        return res.status(404).json({ success: false, message: "Session not found" });
      }

      if (req.user!.role !== "super_admin" && session.userId !== req.user!.id) {
        return res.status(403).json({ success: false, message: "You cannot close this session" });
      }

      await endVoiceAssistantSession(req.params.sessionId);
      res.status(204).send();
    },
  );
}
