import type { Express } from "express";
import type { Server } from "http";
import { storage } from "./storage";
import { api } from "@shared/routes";
import { supportContacts } from "@shared/schema";
import { db } from "./db";
import { z } from "zod";
import OpenAI from "openai";
import { registerChatRoutes } from "./ai_integrations/chat";
import { registerAudioRoutes } from "./ai_integrations/audio";
import { registerImageRoutes } from "./ai_integrations/image";
import { registerObjectStorageRoutes } from "./ai_integrations/object_storage";
import { registerVoiceTrainingRoutes } from "./voice-training";
import { registerB2BRoutes } from "./b2b-routes";
import { registerLocationRoutes } from "./location-routes";
import { registerAdminSettingsRoutes } from "./admin-settings-routes";
import { registerPaymentRoutes } from "./payment-routes";
import { registerBillingRoutes } from "./billing-routes";
import { registerNotificationRoutes } from "./notification-routes";
import { registerTranslationRoutes } from "./translations";
import { registerInvestorRoutes } from "./investor-routes";
import { registerProductionRoutes } from "./production-routes";
import { registerProductionMetrics } from "./production-metrics";
import { registerEnterpriseRoutes, registerEnterpriseCallControlRoutes } from "./enterprise-routes";
import { initializeFirebaseAdmin } from "./firebase-admin";
import { getICEServersConfig, getICEServersConfigAsync, isTurnConfigured, getTurnStatus, isTwilioConfigured } from "./turn-config";
import { registerAdminConfigRoutes } from "./admin-config-routes";
import { registerAdminUserRoutes } from "./admin-user-routes";
import { configService } from "./config-service";
import advancedFeaturesRoutes from "./advanced-features-routes";
import gdprRoutes from "./gdpr-routes";
import { registerAccountDeletionRoutes } from "./account-deletion";
import ipWhitelistRoutes from "./ip-whitelist";
import sessionManagementRoutes from "./session-management";
import customRolesRoutes from "./custom-roles";
import bulkImportRoutes from "./bulk-import";
import slaManagementRoutes from "./sla-management";
import auditLoggingRoutes from "./audit-logging";
import voiceMemosRoutes from "./voice-memos";
import groupChatsRoutes from "./group-chats";
import personalChatRoutes from "./personal-chat-routes";
import chatExtrasRoutes from "./chat-extras";
import twoStepRoutes from "./two-step";
import stickerRoutes from "./stickers";
import linkedDeviceRoutes from "./linked-devices";
import channelRoutes from "./channels";
import communityRoutes from "./communities";
import { registerLinkPreviewRoutes } from "./link-preview";
import { registerStatusRoutes } from "./status-routes";
import { registerBroadcastRoutes } from "./modules/campaigns/broadcast";
import blockingRoutes from "./blocking";
import { registerLipSyncRoutes } from "./lip-sync";
import { registerOpenApiRoutes } from "./openapi";
import { registerRoomRoutes } from "./room-routes";
import { registerSimCallRoutes } from "./legacy/sim-call-routes";
import { registerMeetingLinkRoutes } from "./meeting-links";
import { registerEnterpriseApiRoutes } from "./enterprise-api-routes";
import { registerVoiceAssistantRoutes } from "./voice-assistant-routes";
import { registerCommunicationApiRoutes } from "./communication-api-routes";
import { registerJagoIntegrationRoutes } from "./jago-integration-routes";
import { registerSecPlusIntegrationRoutes } from "./secplus-integration-routes";
import { registerTenantAdminRoutes } from "./tenant-admin-routes";
import { registerFaceToFaceRoutes } from "./face-to-face-routes";
import complianceRoutes from "./compliance-routes";
import { registerAuthRoutes } from "./modules/auth/routes";
import { registerCallsRoutes } from "./modules/calls/routes";
import { registerQueueRoutes } from "./modules/calls/queue-routes";
import { registerPSTNRoutes } from "./pstn/routes";
import { registerTelephonyAdminRoutes } from "./telephony-admin";
import { registerCallerIdRoutes } from "./modules/caller-id/routes";
import { registerTranscriptRoutes } from "./modules/transcripts/routes";
import { registerB2BAdminRoutes } from "./modules/b2b-admin/routes";
import { registerWebhookRoutes } from "./modules/webhooks/routes";
import { registerRateLimitAdminRoutes } from "./modules/rate-limits/routes";
import { registerMessagingRoutes } from "./modules/messaging/routes";
import { registerBusinessRbacRoutes } from "./business-rbac-routes";
import { registerBusinessProfileRoutes } from "./modules/business-profile/routes";
import { registerBusinessAppRoutes } from "./modules/business-app/routes";
import { registerTemplateRoutes } from "./modules/templates/routes";
import "./modules/templates/approval-policy"; // side-effect: registers "template_version" with the Approval Center
import { registerApprovalRoutes } from "./modules/approvals/routes";
import { registerTemplateReviewRoutes } from "./modules/approvals/admin-review";
import { registerCustomerRoutes } from "./modules/customers/routes";
import { registerAudienceRoutes } from "./modules/audiences/routes";
import "./modules/campaigns/approval-policy"; // side-effect: registers "campaign" with the Approval Center
import { registerCampaignRoutes } from "./modules/campaigns/routes";
import { registerOtpRoutes } from "./modules/otp/routes";
import { registerUtilityRoutes } from "./modules/utility/routes";
import { registerBusinessMessagingApiRoutes } from "./modules/messaging/api-routes";
import { registerCatalogRoutes } from "./modules/messaging/catalog";
import { registerOrderRoutes } from "./modules/messaging/orders";
import { registerFormRoutes } from "./modules/messaging/forms";
import { registerTemplateSendRoutes } from "./modules/messaging/template-routes";
import { registerBusinessVerificationRoutes } from "./modules/business-verification/routes";
import { registerMarketingRoutes } from "./modules/marketing/routes";
import { registerEnterpriseHubRoutes } from "./modules/enterprise-hub/routes";
import { registerEnterpriseAIOverlayRoutes } from "./enterprise/routes";
import { registerEnterpriseAdminRoutes } from "./modules/enterprise-admin/routes";
import { loadUser, requireAuth } from "./role-middleware";
import { loadTenantContext } from "./tenant-context";
import { rateLimit } from "./rate-limit";
import { isLegacyTwilioBridgeEnabled } from "./call-platform-config";
import { getOpenAIKey, hasWorkingOpenAIKey } from "./openai-config";

// Simple slug generator
function generateSlug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  // Initialize config service (loads encrypted secrets from database)
  await configService.initialize();

  // Initialize Firebase Admin SDK after configService has loaded env/database secrets.
  initializeFirebaseAdmin();
  
  // Compliance & Regional Routing (Founder's Roadmap)
  app.use(complianceRoutes);
  app.use(loadUser);
  app.use(loadTenantContext);

  // Health check endpoint
  app.get("/api/health", (req, res) => {
    res.json({
      status: "ok",
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
    });
  });

  // Build identity — proves the running process was actually built from a
  // given commit, not just that a deployment is nominally "ACTIVE". Values
  // are inlined at build time (script/build.mjs, esbuild `define`) from the
  // exact commit being built, so they cannot drift from what's running.
  // Safe by construction: no secrets, no env dump, just 3 public identifiers.
  app.get("/api/health/build", (req, res) => {
    res.json({
      commitSha: process.env.BUILD_COMMIT_SHA || "unknown",
      buildTimestamp: process.env.BUILD_TIMESTAMP || "unknown",
      version: process.env.BUILD_VERSION || "unknown",
    });
  });

  // Keys status — shows which services are configured (true/false, never exposes actual keys)
  app.get("/api/health/keys", (req, res) => {
    const e = process.env;
    const has = (k: string) => !!(e[k] && e[k]!.trim().length > 0);
    res.json({
      database:       has("DATABASE_URL"),
      redis:          has("REDIS_URL"),
      livekit:        has("LIVEKIT_API_KEY") && has("LIVEKIT_API_SECRET"),
      openai:         has("OPENAI_API_KEY") || has("AI_INTEGRATIONS_OPENAI_API_KEY"),
      azure_stt:      has("AZURE_SPEECH_KEY"),
      azure_translate:has("AZURE_TRANSLATOR_KEY"),
      msg91:          has("MSG91_AUTH_KEY"),
      razorpay:       has("RAZORPAY_KEY_ID") && has("RAZORPAY_KEY_SECRET"),
      firebase_admin: has("FIREBASE_SERVICE_ACCOUNT_JSON"),
      session:        has("SESSION_SECRET"),
      super_admin:    has("SUPER_ADMIN_EMAIL") && has("SUPER_ADMIN_SECRET"),
    });
  });

  const demoTTSCache = new Map<string, Buffer>();
  const demoTtsLimiter = rateLimit({ windowMs: 60_000, max: 10, message: "Too many demo TTS requests." });

  app.post("/api/demo/tts", requireAuth, demoTtsLimiter, async (req, res) => {
    try {
      const { text, voice = "nova", language = "en" } = req.body;
      if (!text || typeof text !== "string" || text.length > 200) {
        return res.status(400).json({ error: "Valid text required (max 200 chars)" });
      }

      const cacheKey = `${voice}:${language}:${text}`;
      let audioBuffer = demoTTSCache.get(cacheKey);

      if (!audioBuffer) {
        const { textToSpeech } = await import("./ai_integrations/audio/client");
        audioBuffer = await textToSpeech(text, voice as any, "mp3", language);
        if (demoTTSCache.size > 100) {
          const firstKey = demoTTSCache.keys().next().value;
          if (firstKey) demoTTSCache.delete(firstKey);
        }
        demoTTSCache.set(cacheKey, audioBuffer);
      }

      res.json({
        audio: audioBuffer.toString("base64"),
        format: "mp3",
      });
    } catch (error) {
      console.error("Demo TTS error:", error);
      res.status(500).json({ error: "TTS failed" });
    }
  });
  
  // === REGISTER INTEGRATION ROUTES ===
  console.log("[Routes] Starting route registration...");
  registerChatRoutes(app); console.log("[Routes] ✓ Chat routes");
  registerAudioRoutes(app); console.log("[Routes] ✓ Audio routes");
  registerImageRoutes(app); console.log("[Routes] ✓ Image routes");
  registerObjectStorageRoutes(app); console.log("[Routes] ✓ Object storage routes");
  registerVoiceTrainingRoutes(app); console.log("[Routes] ✓ Voice training routes");
  registerCallsRoutes(app); console.log("[Routes] ✓ Calls module (LiveKit) routes");
  registerQueueRoutes(app); console.log("[Routes] ✓ ACD queue routes (join/status/abandon)");
  registerPSTNRoutes(app); console.log("[Routes] ✓ PSTN routes (inbound/outbound webhooks, CDR, health)");
  registerTelephonyAdminRoutes(app); console.log("[Routes] ✓ Business phone lines (LiveKit SIP)");
  registerCallerIdRoutes(app); console.log("[Routes] ✓ Caller ID verification + inbound call routes");
  registerTranscriptRoutes(app); console.log("[Routes] ✓ Transcript system routes");
  registerB2BAdminRoutes(app); console.log("[Routes] ✓ B2B admin routes (virtual numbers, DID, agent skills)");
  registerWebhookRoutes(app); console.log("[Routes] ✓ Outbound webhook routes (org event subscriptions)");
  registerRateLimitAdminRoutes(app); console.log("[Routes] ✓ Rate-limit rule admin routes");
  registerMessagingRoutes(app); console.log("[Routes] ✓ Canonical business messaging routes (Phase 0)");
  registerBusinessRbacRoutes(app); console.log("[Routes] ✓ Business-platform RBAC grant routes (P0-5 fix)");
  registerBusinessProfileRoutes(app); console.log("[Routes] ✓ Business profile + branding routes (Phase 1)");
  registerBusinessAppRoutes(app); console.log("[Routes] ✓ NeuraTalk Business app routes");
  registerTemplateRoutes(app); console.log("[Routes] ✓ Business message template engine routes (Phase 2)");
  registerApprovalRoutes(app); console.log("[Routes] ✓ Generic approval center routes (Phase 3)");
  registerTemplateReviewRoutes(app); console.log("[Routes] ✓ NeuraTalk template review (super admin)");
  registerCustomerRoutes(app); console.log("[Routes] ✓ Business customers routes (Phase 4)");
  registerAudienceRoutes(app); console.log("[Routes] ✓ Business audiences routes (Phase 4)");
  registerCampaignRoutes(app); console.log("[Routes] ✓ Business campaign engine routes (Phase 5)");
  registerBroadcastRoutes(app);
  registerOtpRoutes(app); console.log("[Routes] ✓ Business OTP/authentication routes (Phase 6)");
  registerUtilityRoutes(app); console.log("[Routes] ✓ Business utility messaging routes (Phase 7)");
  registerBusinessMessagingApiRoutes(app); console.log("[Routes] ✓ Business messaging API (X-API-Key: utility events, OTP)");
  registerCatalogRoutes(app); console.log("[Routes] ✓ Business catalog routes");
  registerOrderRoutes(app); console.log("[Routes] ✓ Business order routes");
  registerFormRoutes(app); console.log("[Routes] ✓ Business form routes");
  registerTemplateSendRoutes(app); console.log("[Routes] ✓ Business template send + 24h window routes");
  registerBusinessVerificationRoutes(app); console.log("[Routes] ✓ Business verification (blue tick) routes");
  registerMarketingRoutes(app); console.log("[Routes] ✓ Business marketing reporting routes (Phase 8B-R0)");
  registerEnterpriseHubRoutes(app); console.log("[Routes] ✓ Enterprise Hub routes (existing number integration)");
  registerEnterpriseAIOverlayRoutes(app); console.log("[Routes] ✓ Enterprise AI Overlay routes (sessions, SIP health, agent assist)");
  registerEnterpriseAdminRoutes(app); console.log("[Routes] ✓ Enterprise Admin routes (departments/branches/teams/IVR/queues/PBX/presence)");
  registerB2BRoutes(app); console.log("[Routes] ✓ B2B routes");
  registerLocationRoutes(app); console.log("[Routes] ✓ Location routes");
  registerAdminSettingsRoutes(app); console.log("[Routes] ✓ Admin settings routes");
  registerPaymentRoutes(app); console.log("[Routes] ✓ Payment routes");
  registerBillingRoutes(app); console.log("[Routes] ✓ Billing routes");
  registerNotificationRoutes(app); console.log("[Routes] ✓ Notification routes");
  registerTranslationRoutes(app); console.log("[Routes] ✓ Translation routes");
  registerInvestorRoutes(app); console.log("[Routes] ✓ Investor routes");
  registerProductionRoutes(app); console.log("[Routes] ✓ Production routes");
  registerProductionMetrics(app); console.log("[Routes] ✓ Production metrics (/metrics, /healthz, /readyz)");
  registerEnterpriseRoutes(app); console.log("[Routes] ✓ Enterprise routes");
  registerEnterpriseCallControlRoutes(app); console.log("[Routes] ✓ Enterprise call control routes");
  registerAdminConfigRoutes(app); console.log("[Routes] ✓ Admin config routes");
  registerAdminUserRoutes(app); console.log("[Routes] ✓ Admin user routes");
  registerRoomRoutes(app); console.log("[Routes] ✓ Room routes");
  if (isLegacyTwilioBridgeEnabled()) {
    registerSimCallRoutes(app); console.log("[Routes] ✓ Legacy SIM call routes");
  } else {
    console.log("[Routes] ✓ Legacy SIM call routes disabled");
  }
  registerMeetingLinkRoutes(app); console.log("[Routes] ✓ Meeting link routes");
  registerEnterpriseApiRoutes(app); console.log("[Routes] ✓ Enterprise API routes");
  registerVoiceAssistantRoutes(app); console.log("[Routes] ✓ Voice assistant routes");
  registerCommunicationApiRoutes(app); console.log("[Routes] ✓ Communication API routes");
  registerJagoIntegrationRoutes(app); console.log("[Routes] ✓ Jago integration routes");
  registerSecPlusIntegrationRoutes(app); console.log("[Routes] ✓ SecPlus integration routes");
  registerFaceToFaceRoutes(app); console.log("[Routes] ✓ Face-to-face realtime routes");
  registerTenantAdminRoutes(app); console.log("[Routes] âœ“ Tenant admin routes");

  // Advanced features: Call History, Video Calls, AI Personas, Analytics
  console.log("[Routes] Adding advanced features routes...");
  app.use("/api/features", advancedFeaturesRoutes);
  console.log("[Routes] ✓ Advanced features");
  
  // GDPR/DPDP compliance routes
  app.use(gdprRoutes);
  registerAccountDeletionRoutes(app);
  console.log("[Routes] ✓ GDPR routes");
  
  // IP Whitelist management routes (enterprise security)
  app.use(ipWhitelistRoutes);
  console.log("[Routes] ✓ IP whitelist routes");
  
  // Session management routes (concurrent limits, force logout)
  app.use(sessionManagementRoutes);
  console.log("[Routes] ✓ Session management routes");
  
  // Custom roles and permissions (enterprise RBAC)
  app.use(customRolesRoutes);
  console.log("[Routes] ✓ Custom roles routes");
  
  // Bulk user import (enterprise onboarding)
  app.use(bulkImportRoutes);
  console.log("[Routes] ✓ Bulk import routes");
  
  // SLA management and status page
  app.use(slaManagementRoutes);
  console.log("[Routes] ✓ SLA management routes");
  
  // Enhanced audit logging
  app.use(auditLoggingRoutes);
  console.log("[Routes] ✓ Audit logging routes");
  
  // Voice Memos with translation
  app.use(voiceMemosRoutes);
  console.log("[Routes] ✓ Voice memos routes");
  
  // Multi-language Group Chats
  // Starred, search, polls, view once, privacy (before the chat routers).
  app.use(chatExtrasRoutes);
  app.use(twoStepRoutes);
  app.use(stickerRoutes);
  app.use(linkedDeviceRoutes);
  app.use(channelRoutes);
  app.use(communityRoutes);
  app.use(groupChatsRoutes);
  app.use(personalChatRoutes);
  registerLinkPreviewRoutes(app);
  registerStatusRoutes(app);
  app.use(blockingRoutes);
  console.log("[Routes] ✓ Group chats routes");
  
  // Lip-sync video translation (self-hosted GPU architecture)
  registerLipSyncRoutes(app);
  console.log("[Routes] ✓ Lip-sync routes");
  
  // OpenAPI documentation and Swagger UI
  registerOpenApiRoutes(app);
  console.log("[Routes] ✓ OpenAPI routes");

  // === ICE SERVERS CONFIGURATION (for WebRTC) ===
  app.get("/api/rtc/ice-servers", requireAuth, async (_req, res) => {
    try {
      // Use async version to fetch fresh Twilio tokens if configured
      const config = isTwilioConfigured() 
        ? await getICEServersConfigAsync() 
        : getICEServersConfig();
      const turnStatus = getTurnStatus();
      
      res.json({
        ...config,
        turnConfigured: turnStatus.configured,
        provider: turnStatus.provider,
        message: turnStatus.configured 
          ? `TURN server configured via ${turnStatus.provider} for cross-network calls` 
          : "Only STUN configured. Calls may fail on restrictive networks. Configure TWILIO_ACCOUNT_SID/TWILIO_AUTH_TOKEN or TURN_SERVER_* for full support.",
      });
    } catch (error) {
      console.error("Failed to get ICE servers:", error);
      res.status(500).json({ error: "Failed to get ICE configuration" });
    }
  });

  // === RTC STATUS (for diagnostics) ===
  app.get("/api/rtc/status", requireAuth, (_req, res) => {
    const turnStatus = getTurnStatus();
    res.json({
      signaling: {
        configured: true,
        path: "/ws/signaling",
        legacy: true,
        note: "Legacy meeting signaling transport. Primary production calling uses LiveKit-based routes.",
      },
      turn: {
        ...turnStatus,
        twilioConfigured: isTwilioConfigured(),
      },
      stun: {
        configured: true,
        servers: ["stun.l.google.com", "stun.services.mozilla.com", "global.stun.twilio.com"],
      },
    });
  });

  // === WEBSITE CHATBOT ===
  const websiteOpenai = new OpenAI({
    apiKey: getOpenAIKey() || "",
    baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
  });

  // Built-in NEURA rule-based chatbot — works without any API key
  // Mirrors client/src/pages/website/site-facts.ts and the public pages.
  const LANGUAGE_LINE = "23 languages: English; Hindi, Telugu, Tamil, Kannada, Malayalam, Marathi, Bengali, Gujarati, Punjabi, Odia and Urdu; and Spanish, French, German, Arabic, Japanese, Korean, Chinese, Portuguese, Russian, Italian and Dutch";

  function neuraBuiltinChat(message: string): string {
    const msg = message.toLowerCase().trim();

    // Greetings
    if (/^(hi|hello|hey|namaste|hola|howdy|good\s*(morning|afternoon|evening))/.test(msg)) {
      return "Hi! I can answer questions about NeuraTalk — calls, chats and business messages translated into your language, in your own voice. Ask me how it works, about languages, your voice, privacy, pricing or NeuraTalk Business.";
    }

    // Business (before pricing: "business price" is about business)
    if (/b2b|enterprise|business|shop|store|company|corporate|organization|otp|template|catalog|verified|tick|campaign|api|integration/.test(msg)) {
      return "NeuraTalk Business is a separate app for businesses: a profile with your logo, a team inbox, catalog, automatic replies, translated calls with customers, and order updates, login codes and offers under clear rules. NeuraTalk reviews every message template, and the blue tick appears only after we check the business. See /business or write to support@mindwhile.com.";
    }

    // Pricing
    if (/price|cost|plan|subscription|pay|rupee|₹|\$|monthly|yearly|annual|weekly|quarter|refund/.test(msg)) {
      return "Every new account gets 15 free translated call minutes, no card needed. Plans are prepaid in rupees and never renew on their own — current plans are on /pricing. Refunds are explained at /refund-policy.";
    }

    // Voice cloning (before languages: "my voice in telugu" is about the voice)
    if (/voice clone|voice cloning|clone|my voice|own voice|sound like me|robot/.test(msg)) {
      return "In the app, go to More → Your voice and read three short passages (about two minutes), or let NeuraTalk learn your voice from your first half-minute in a call. After that, people hear your translated words in your own voice. Until then they hear your original voice with translated captions — never a robot voice. You can delete your voice any time.";
    }

    // Languages
    if (/language|translate|translat|multilingual|hindi|telugu|tamil|kannada|malayalam|marathi|bengali|gujarati|punjabi|odia|urdu|spanish|french|german|arabic|chinese|japanese|korean|italian|dutch/.test(msg)) {
      return `NeuraTalk works in ${LANGUAGE_LINE} — any pair, either direction. Each speaker's language is detected from their voice, and if you both speak the same one nothing is translated.`;
    }

    // Phone numbers / does the other person need the app
    if (/phone number|sim|landline|normal call|other person|need the app|install|sms/.test(msg)) {
      return "Both people need NeuraTalk. Translated calls to ordinary phone numbers and SMS aren't available.";
    }

    // Chat / groups
    if (/chat|message|group|photo|file|document/.test(msg)) {
      return "Chats are translated too: write in your language and the other person reads it in theirs. Groups, photos, videos, documents, voice messages and location all work, and you can tap any message to see the original.";
    }

    // Video / quality / noise / delay
    if (/video|call quality|connection|noise|noisy|delay|latency|fast|slow|caption|subtitle/.test(msg)) {
      return "Video and group calls are translated the same way as voice calls. Background noise is reduced on your device, and the translation usually reaches the other person within about a second, depending on the languages and the connection.";
    }

    // Privacy / Security / deletion
    if (/privacy|secure|security|data|safe|encrypt|record|delete|account/.test(msg)) {
      return "Call audio is never recorded; the translated text of a call stays in your history for 30 days. Calls and messages are encrypted in transit. You can download your data or delete your account in the app (More → Privacy). Details: /privacy and /trust.";
    }

    // How it works / features
    if (/how|work|feature|what|explain|tell me|describe/.test(msg)) {
      return "You call or chat like normal and each of you uses your own language. NeuraTalk recognises the language, translates it, and the other person hears it in your own voice or reads it in theirs. If you both speak the same language, nothing is translated.";
    }

    // Getting started / sign up
    if (/start|signup|sign up|register|join|begin|try|demo|free/.test(msg)) {
      return "Install NeuraTalk and sign up with your phone number — no credit card needed. Then set up your voice in More → Your voice and call someone who speaks another language.";
    }

    // Contact / support
    if (/contact|support|help|email|reach|talk to|human|agent/.test(msg)) {
      return "Write to support@mindwhile.com or use the contact page (/contact) and a person from our team will reply. Answers to common questions are at /help.";
    }

    // Company info
    if (/who|founded|mindwhile|about|team/.test(msg)) {
      return "NeuraTalk is made by Mindwhile IT Solutions Pvt Ltd in Mangalagiri, Andhra Pradesh, India. We want conversations between people who speak different languages to feel like any other conversation.";
    }

    // Default
    return "I can help with calls, chats, languages, your own voice, privacy, pricing, NeuraTalk Business and getting started. What would you like to know?";
  }

  const systemPrompt = `You answer visitors' questions on the NeuraTalk website. Be warm, plain and brief, like a helpful person — not a robot. Never invent features, numbers, certifications or prices. If you don't know, say so and point to support@mindwhile.com.

Facts about NeuraTalk (only these):
- Apps (Android and web) for voice, video and group calls, chats and business messages between people who speak different languages.
- While you talk, your words are translated and the other person hears them in your own cloned voice. Until your voice is ready, they hear your original voice with translated captions — never a robot voice.
- Your voice: record three short passages in the app (More → Your voice, about two minutes), or allow NeuraTalk to learn it from your first half-minute in a call. Only used for your own words; delete it any time.
- Each speaker's language is detected from their voice. Same language means nothing is translated.
- Translation usually reaches the other person within about a second, depending on languages and connection.
- Languages: ${LANGUAGE_LINE}.
- Chats are translated, including groups, photos, videos, documents, voice messages and location. There is also an in-person mode and an AI assistant.
- Both people need NeuraTalk; calls to ordinary phone numbers and SMS are not available.
- NeuraTalk Business (/business): a separate app with business profile, verified tick only after NeuraTalk checks the business, team inbox, catalog, greeting/away messages, quick replies, labels, chat link and QR, translated calls, and utility updates, login codes and offers. NeuraTalk reviews every message template; offers need the customer's opt-in; customers can block a business. Rules: /business-messaging-policy.
- Privacy: call audio is never recorded; translated call text is kept 30 days; chats until deleted; encrypted in transit (not end-to-end). Speech is processed by Microsoft Azure, OpenAI and ElevenLabs. Users can download their data and delete their account in the app (More → Privacy).
- Pricing: 15 free translated minutes for new accounts; prepaid plans in rupees that never renew automatically; current plans on /pricing. Do not quote prices.
- Made by Mindwhile IT Solutions Pvt Ltd, Mangalagiri, Andhra Pradesh, India. Support: support@mindwhile.com.

Keep answers to 2-4 sentences. If asked about something unrelated to NeuraTalk, say briefly that you can only help with NeuraTalk.`;

  app.post("/api/website/chat", async (req, res) => {
    try {
      const { message, history = [] } = req.body;

      if (!message || typeof message !== "string") {
        return res.status(400).json({ error: "Message is required" });
      }

      const isMockKey = !hasWorkingOpenAIKey();

      if (!isMockKey) {
        // Try OpenAI first
        try {
          const messages: { role: "system" | "user" | "assistant"; content: string }[] = [
            { role: "system", content: systemPrompt },
            ...history.slice(-6).map((m: { role: string; content: string }) => ({
              role: m.role as "user" | "assistant",
              content: m.content,
            })),
            { role: "user", content: message },
          ];

          const completion = await websiteOpenai.chat.completions.create({
            model: "gpt-4o-mini",
            messages,
            max_tokens: 300,
            temperature: 0.7,
          });

          const reply = completion.choices[0]?.message?.content || neuraBuiltinChat(message);
          return res.json({ message: reply });
        } catch {
          // Fall through to built-in chatbot
        }
      }

      // Built-in NEURA chatbot (works without any API key)
      const reply = neuraBuiltinChat(message);
      res.json({ message: reply });
    } catch (error) {
      console.error("Website chat error:", error);
      res.json({ message: neuraBuiltinChat((req.body as any)?.message || "") });
    }
  });

  app.post("/api/website/contact", async (req, res) => {
    try {
      const { name, email, phone, inquiry, company, message } = req.body;
      if (!name || !email || !message) {
        return res.status(400).json({ error: "Name, email, and message are required" });
      }
      await db.insert(supportContacts).values({
        type: inquiry || "general",
        label: name,
        value: JSON.stringify({ email, phone, company, message, inquiry }),
        isEnabled: true,
      });
      res.json({ success: true, message: "Your message has been received. We'll get back to you within 24 hours." });
    } catch (error) {
      console.error("Contact form error:", error);
      res.status(500).json({ error: "Failed to submit contact form" });
    }
  });

  // === AUTH ROUTES (modularized — see server/modules/auth) ===
  registerAuthRoutes(app);


  // === ORGANIZATION ROUTES (B2B) ===

  // List all organizations (admin only)
  app.get(api.organizations.list.path, requireAuth, async (req, res) => {
    if (!req.user || !["admin", "super_admin"].includes(req.user.role)) {
      return res.status(403).json({ message: "Forbidden" });
    }
    const orgs = await storage.getAllOrganizations();
    res.json(orgs);
  });

  // Get single organization — members of that org or admins
  app.get(api.organizations.get.path, requireAuth, async (req, res) => {
    const orgId = Number(req.params.id);
    if (!req.user || (!["admin", "super_admin"].includes(req.user.role) && req.user.organizationId !== orgId)) {
      return res.status(403).json({ message: "Forbidden" });
    }
    const org = await storage.getOrganization(orgId);
    if (!org) {
      return res.status(404).json({ message: "Organization not found" });
    }
    res.json(org);
  });

  // Create organization (admin only)
  app.post(api.organizations.create.path, requireAuth, async (req, res) => {
    if (!req.user || !["admin", "super_admin"].includes(req.user.role)) {
      return res.status(403).json({ message: "Forbidden" });
    }
    try {
      const input = api.organizations.create.input.parse(req.body);
      const slug = generateSlug(input.name);

      const existing = await storage.getOrganizationBySlug(slug);
      if (existing) {
        return res.status(400).json({ message: "Organization slug already exists" });
      }

      const org = await storage.createOrganization({ ...input, slug });
      res.status(201).json(org);
    } catch (err) {
      res.status(400).json({ message: "Invalid input" });
    }
  });

  // Update organization (admin only)
  app.put(api.organizations.update.path, requireAuth, async (req, res) => {
    if (!req.user || !["admin", "super_admin"].includes(req.user.role)) {
      return res.status(403).json({ message: "Forbidden" });
    }
    try {
      const input = api.organizations.update.input.parse(req.body);
      const org = await storage.updateOrganization(Number(req.params.id), input);
      if (!org) {
        return res.status(404).json({ message: "Organization not found" });
      }
      res.json(org);
    } catch (err) {
      res.status(400).json({ message: "Invalid input" });
    }
  });

  // Get org members (admin or org member)
  app.get(api.organizations.members.path, requireAuth, async (req, res) => {
    const orgId = Number(req.params.id);
    if (!req.user || (!["admin", "super_admin"].includes(req.user.role) && req.user.organizationId !== orgId)) {
      return res.status(403).json({ message: "Forbidden" });
    }
    const users = await storage.getUsersByOrg(orgId);
    res.json(users);
  });

  // Add member to org (admin only)
  app.post(api.organizations.addMember.path, requireAuth, async (req, res) => {
    if (!req.user || !["admin", "super_admin"].includes(req.user.role)) {
      return res.status(403).json({ message: "Forbidden" });
    }
    try {
      const { userId, memberRole } = req.body;
      const orgId = Number(req.params.id);

      await storage.addOrgMember({
        organizationId: orgId,
        userId,
        memberRole: memberRole || "member",
      });

      // Update user's organizationId
      await storage.updateUser(userId, { organizationId: orgId });

      res.status(201).json({ success: true });
    } catch (err) {
      res.status(400).json({ message: "Failed to add member" });
    }
  });

  // === USER MANAGEMENT (Admin) ===

  // List all users (admin only)
  app.get(api.users.list.path, requireAuth, async (req, res) => {
    if (!req.user || !["admin", "super_admin"].includes(req.user.role)) {
      return res.status(403).json({ message: "Forbidden" });
    }
    const users = await storage.getAllUsers();
    res.json(users);
  });

  // Update user role (admin only)
  app.patch(api.users.updateRole.path, requireAuth, async (req, res) => {
    if (!req.user || !["admin", "super_admin"].includes(req.user.role)) {
      return res.status(403).json({ message: "Forbidden" });
    }
    try {
      const { role } = req.body;
      const user = await storage.updateUser(Number(req.params.id), { role });
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }
      res.json(user);
    } catch (err) {
      res.status(400).json({ message: "Invalid input" });
    }
  });

  // === VOICE PROFILES ===

  app.get(api.voiceProfiles.list.path, async (req, res) => {
    try {
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return res.status(401).json({ message: "Not authenticated" });
      }
      const token = authHeader.slice(7);
      const { validateSession } = await import("./role-middleware");
      const userId = await validateSession(token);
      if (!userId) {
        return res.status(401).json({ message: "Invalid or expired session" });
      }
      const profiles = await storage.getVoiceProfiles(userId);
      res.json(profiles);
    } catch (err) {
      console.error("Voice profiles list error:", err);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.post(api.voiceProfiles.create.path, requireAuth, async (req, res) => {
    try {
      const input = api.voiceProfiles.create.input.parse(req.body);
      const profile = await storage.createVoiceProfile(input);
      res.status(201).json(profile);
    } catch (err) {
      res.status(400).json({ message: "Invalid input" });
    }
  });

  // ── Contact Address Book Routes ──
  const { registerContactRoutes } = await import("./contact-routes");
  registerContactRoutes(app);

  console.log("[Routes] ✅ ALL ROUTES REGISTERED SUCCESSFULLY");
  return httpServer;
}
