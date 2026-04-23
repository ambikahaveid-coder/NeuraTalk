import type { Express, Request, Response } from "express";
import { PERMISSIONS } from "@shared/schema";
import { loadUser, requireAnyPermission, requireAuth } from "./role-middleware";
import { requireActiveSubscription, warnLowBalance } from "./usage-enforcement";
import { issueWsToken } from "./signaling-server";

export function registerFaceToFaceRoutes(app: Express): void {
  const requireAiVoiceAccess = requireAnyPermission(
    PERMISSIONS.AI_VOICE,
    PERMISSIONS.AI_TRANSLATION,
    PERMISSIONS.CALLS_INITIATE,
  );

  app.post(
    "/api/face-to-face/session",
    loadUser,
    requireAuth,
    requireAiVoiceAccess,
    requireActiveSubscription,
    warnLowBalance,
    (req: Request, res: Response) => {
      const user = req.user!;
      const token = issueWsToken({
        userId: user.id,
        phoneNumber: user.phone ?? undefined,
      }, 60 * 60);

      res.json({
        token,
        transport: "websocket-pcm",
        wsPath: "/ws/face-to-face",
        sessionTtlSeconds: 60 * 60,
        sampleRate: 16_000,
        frameDurationMs: 20,
        targetLatencyMs: 900,
      });
    },
  );
}
