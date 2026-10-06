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
      // verifyWsToken only accepts tokens bound to a live login session; a
      // token with just the user id was rejected (4401), so face-to-face could
      // never connect.
      const authHeader = req.headers.authorization;
      const sessionToken = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
      if (!sessionToken || !user.sessionId) {
        return res.status(401).json({ message: "Active session required" });
      }
      const token = issueWsToken({
        userId: user.id,
        sessionId: user.sessionId,
        sessionToken,
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
