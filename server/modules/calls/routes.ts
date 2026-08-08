import type { Express } from "express";
import { loadUser, requireAnyPermission, requireAuth, requireSuperAdmin } from "../../role-middleware";
import { requireActiveSubscription, warnLowBalance } from "../../usage-enforcement";
import { PERMISSIONS } from "@shared/schema";
import * as ctrl from "./controller";
import { runTelecomValidationSimulation } from "./validation";

export function registerCallsRoutes(app: Express): void {
  const requireCallAccess = requireAnyPermission(
    PERMISSIONS.CALLS_INITIATE,
    PERMISSIONS.CALLS_RECEIVE,
    PERMISSIONS.CALLS_VIEW_HISTORY,
    PERMISSIONS.CALLS_VIEW_ALL,
  );
  const requireAiVoiceAccess = requireAnyPermission(
    PERMISSIONS.AI_VOICE,
    PERMISSIONS.AI_TRANSLATION,
    PERMISSIONS.CALLS_INITIATE,
  );

  app.get("/api/livekit/config", ctrl.livekitConfig);

  app.post(
    "/api/calls/create",
    loadUser,
    requireAuth,
    requireCallAccess,
    requireActiveSubscription,
    warnLowBalance,
    ctrl.initiate,
  );

  app.post(
    "/api/calls/conference",
    loadUser,
    requireAuth,
    requireCallAccess,
    requireActiveSubscription,
    ctrl.conference,
  );

  app.post(
    "/api/calls/:callId/connect",
    loadUser,
    requireAuth,
    requireCallAccess,
    requireActiveSubscription,
    ctrl.connect,
  );
  app.patch("/api/calls/:callId/status", loadUser, requireAuth, requireCallAccess, ctrl.statusUpdate);
  app.post("/api/calls/:callId/end", loadUser, requireAuth, requireCallAccess, ctrl.end);
  app.post("/api/calls/:callId/hold", loadUser, requireAuth, requireCallAccess, ctrl.holdCall);
  app.delete("/api/calls/:callId/hold", loadUser, requireAuth, requireCallAccess, ctrl.resumeCall);
  app.post("/api/calls/:callId/recording", loadUser, requireAuth, requireCallAccess, ctrl.startCallRecording);
  app.delete("/api/calls/:callId/recording", loadUser, requireAuth, requireCallAccess, ctrl.stopCallRecording);
  app.get("/api/calls/:callId/recording", loadUser, requireAuth, requireCallAccess, ctrl.getCallRecording);

  app.post("/api/calls/:id/reject", loadUser, requireAuth, requireCallAccess, ctrl.reject);
  app.post("/api/calls/:id/transfer", loadUser, requireAuth, requireCallAccess, ctrl.transferCall);
  app.get("/api/calls/incoming", loadUser, requireAuth, requireCallAccess, ctrl.incoming);
  app.get("/api/calls/incoming/stream", loadUser, requireAuth, requireCallAccess, ctrl.incomingStream);

  app.post("/api/calls/:id/msg91-webhook", ctrl.msg91Webhook);
  app.post("/api/msg91/voice", ctrl.msg91VoiceWebhook);
  app.post("/api/calls/livekit-webhook", ctrl.livekitWebhook);

  app.get("/api/calls/gateway-status", loadUser, requireAuth, requireCallAccess, ctrl.gatewayStatus);
  app.get("/api/calls/capabilities", loadUser, requireAuth, ctrl.capabilities);
  app.get("/api/calls/history", loadUser, requireAuth, requireCallAccess, ctrl.callHistory);
  app.get("/api/calls/active", loadUser, requireAuth, requireCallAccess, ctrl.activeCalls);
  app.get("/api/calls/user/:userId", loadUser, requireAuth, requireCallAccess, ctrl.userCalls);
  app.get("/api/calls/ice-servers", loadUser, requireAuth, requireCallAccess, ctrl.iceServers);
  app.get("/api/calls/signaling-info", loadUser, requireAuth, requireCallAccess, ctrl.signalingInfo);
  app.get("/api/calls/:callId/details", loadUser, requireAuth, requireCallAccess, ctrl.callDetails);
  app.get("/api/calls/:callId", loadUser, requireAuth, requireCallAccess, ctrl.callById);

  app.post("/api/calls/native-bridge", loadUser, requireAuth, requireCallAccess, ctrl.nativeBridge);
  app.post("/api/calls/disposition", loadUser, requireAuth, requireCallAccess, ctrl.disposition);

  app.post("/api/calls/:callId/participants", loadUser, requireAuth, requireCallAccess, ctrl.participantAdd);
  app.delete("/api/calls/:callId/participants/:participantId", loadUser, requireAuth, requireCallAccess, ctrl.participantRemove);
  app.patch("/api/calls/:callId/participants/:participantId/mute", loadUser, requireAuth, requireCallAccess, ctrl.participantMute);

  app.post("/api/devices/register", loadUser, requireAuth, requireCallAccess, ctrl.deviceRegister);
  app.get("/api/devices", loadUser, requireAuth, requireCallAccess, ctrl.deviceList);
  app.delete("/api/devices/:deviceId", loadUser, requireAuth, requireCallAccess, ctrl.deviceUnregister);
  app.patch("/api/devices/:deviceId/token", loadUser, requireAuth, requireCallAccess, ctrl.deviceUpdateToken);

  app.get("/api/call/consent", loadUser, requireAuth, requireCallAccess, ctrl.consentCheckMe);
  app.post("/api/call/consent", loadUser, requireAuth, requireCallAccess, ctrl.consentGrantMe);
  app.get("/api/calls/privacy/disclosures", ctrl.privacyDisclosures);
  app.get("/api/calls/consent/:userId", loadUser, requireAuth, requireCallAccess, ctrl.consentCheckByUser);
  app.post("/api/calls/consent/:userId", loadUser, requireAuth, requireCallAccess, ctrl.consentGrantByUser);
  app.patch("/api/calls/consent/:userId", loadUser, requireAuth, requireCallAccess, ctrl.consentUpdateByUser);
  app.delete("/api/calls/consent/:userId", loadUser, requireAuth, requireCallAccess, ctrl.consentRevokeByUser);
  app.get("/api/calls/consent/:userId/audio-policy", loadUser, requireAuth, requireCallAccess, ctrl.consentAudioPolicy);

  app.post("/api/calls/:callId/audio", loadUser, requireAuth, requireAiVoiceAccess, requireActiveSubscription, ctrl.audio);
  app.post(
    "/api/calls/:callId/stream",
    loadUser,
    requireAuth,
    requireAiVoiceAccess,
    requireActiveSubscription,
    ctrl.stream,
  );
  app.get("/api/calls/:callId/health", loadUser, requireAuth, requireCallAccess, ctrl.callHealth);
  app.post("/api/calls/:callId/interrupt", loadUser, requireAuth, requireAiVoiceAccess, ctrl.interrupt);
  app.post("/api/calls/:callId/resume", loadUser, requireAuth, requireAiVoiceAccess, ctrl.resume);

  app.post("/api/call/detect-voice", loadUser, requireAuth, requireAiVoiceAccess, requireActiveSubscription, ctrl.detectVoice);
  app.post("/api/call/translate", loadUser, requireAuth, requireAiVoiceAccess, requireActiveSubscription, ctrl.translate);
  app.get("/api/call/local-ai-status", loadUser, requireAuth, requireAiVoiceAccess, ctrl.localAiStatus);
  app.get("/api/call/ultra-low-latency-status", loadUser, requireAuth, requireAiVoiceAccess, ctrl.ultraLowLatencyStatus);
  app.get("/api/voice-cloning/status", loadUser, requireAuth, requireAiVoiceAccess, ctrl.voiceCloningStatus);
  app.post("/api/call/translate-natural", loadUser, requireAuth, requireAiVoiceAccess, requireActiveSubscription, ctrl.translateNatural);

  app.get("/api/admin/call-metrics", loadUser, requireAuth, requireSuperAdmin, ctrl.callMetrics);
  app.post("/api/admin/calls/telecom-validation", loadUser, requireAuth, requireSuperAdmin, async (_req, res) => {
    try {
      const result = await runTelecomValidationSimulation();
      res.json(result);
    } catch (error) {
      res.status(500).json({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });
}
