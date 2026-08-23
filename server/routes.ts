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
import ipWhitelistRoutes from "./ip-whitelist";
import sessionManagementRoutes from "./session-management";
import customRolesRoutes from "./custom-roles";
import bulkImportRoutes from "./bulk-import";
import slaManagementRoutes from "./sla-management";
import auditLoggingRoutes from "./audit-logging";
import voiceMemosRoutes from "./voice-memos";
import groupChatsRoutes from "./group-chats";
import personalChatRoutes from "./personal-chat-routes";
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
import { registerCallerIdRoutes } from "./modules/caller-id/routes";
import { registerTranscriptRoutes } from "./modules/transcripts/routes";
import { registerB2BAdminRoutes } from "./modules/b2b-admin/routes";
import { registerWebhookRoutes } from "./modules/webhooks/routes";
import { registerRateLimitAdminRoutes } from "./modules/rate-limits/routes";
import { registerMessagingRoutes } from "./modules/messaging/routes";
import { registerBusinessProfileRoutes } from "./modules/business-profile/routes";
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
  registerCallerIdRoutes(app); console.log("[Routes] ✓ Caller ID verification + inbound call routes");
  registerTranscriptRoutes(app); console.log("[Routes] ✓ Transcript system routes");
  registerB2BAdminRoutes(app); console.log("[Routes] ✓ B2B admin routes (virtual numbers, DID, agent skills)");
  registerWebhookRoutes(app); console.log("[Routes] ✓ Outbound webhook routes (org event subscriptions)");
  registerRateLimitAdminRoutes(app); console.log("[Routes] ✓ Rate-limit rule admin routes");
  registerMessagingRoutes(app); console.log("[Routes] ✓ Canonical business messaging routes (Phase 0)");
  registerBusinessProfileRoutes(app); console.log("[Routes] ✓ Business profile + branding routes (Phase 1)");
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
  app.use(groupChatsRoutes);
  app.use(personalChatRoutes);
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
  function neuraBuiltinChat(message: string): string {
    const msg = message.toLowerCase().trim();

    // Greetings
    if (/^(hi|hello|hey|namaste|hola|howdy|good\s*(morning|afternoon|evening))/.test(msg)) {
      return "Greetings! I am NEURA, your NeuraTalk AI assistant. Neural pathways initialized. I can answer questions about NeuraTalk's real-time voice translation platform — pricing, features, B2B/B2C plans, or how to get started. What would you like to know?";
    }

    // Pricing
    if (/price|cost|plan|subscription|pay|rupee|₹|\$|monthly|yearly|annual|weekly|quarter/.test(msg)) {
      return "NeuraTalk offers flexible pricing: Free Trial (no card required), Weekly ₹399 / $4.99, Monthly ₹1,249 / $14.99, Quarterly ₹2,749 / $34.99, and Annual ₹7,999 / $99.99. Enterprise plans come with custom pricing, dedicated infrastructure, and SLA guarantees. Initiating pricing matrix... which plan fits your needs?";
    }

    // Languages
    if (/language|translate|translat|multilingual|hindi|telugu|tamil|kannada|marathi|bengali|spanish|french|german|arabic|chinese|japanese/.test(msg)) {
      return "NeuraTalk supports real-time translation across 100+ languages including Hindi, Telugu, Tamil, Kannada, Marathi, Bengali, English, Spanish, French, German, Arabic, Chinese, Japanese, and many more. Our AI preserves emotional nuance and tone — your voice, any language. Recalibrating language modules... which languages do you need?";
    }

    // Voice cloning
    if (/voice clone|voice cloning|clone|my voice|sound like me/.test(msg)) {
      return "NeuraTalk's voice cloning technology captures your unique vocal identity — tone, emotion, rhythm — and reproduces it in any target language. Processing biometric voice signature... you only need a short audio sample (30 seconds) to clone your voice. Available on Professional and Enterprise plans.";
    }

    // B2B / Enterprise / Call center
    if (/b2b|enterprise|business|call center|call centre|company|corporate|organization|api|integration/.test(msg)) {
      return "NeuraTalk B2B solutions are built for call centers, enterprises, and SaaS companies. Features include: real-time agent assist, multilingual customer support, custom voice personas, API access, white-labeling, dedicated infrastructure, and GDPR-compliant data handling. Initializing enterprise neural core... shall I connect you with our enterprise team?";
    }

    // B2C / Personal
    if (/b2c|personal|individual|consumer|family|friend|private/.test(msg)) {
      return "NeuraTalk B2C is perfect for personal international calls. Talk to friends, family, or business contacts in any language — NeuraTalk translates your voice in real-time so both sides hear their native language. No special hardware needed, works on any smartphone or browser.";
    }

    // P2P / WebRTC calls
    if (/p2p|peer|webrtc|direct call|video call|call quality|connection/.test(msg)) {
      return "NeuraTalk uses WebRTC for peer-to-peer calls — direct, encrypted, ultra-low latency. No call data passes through third-party servers. Our signaling layer coordinates the connection, then your voices travel directly peer-to-peer. Neural encryption engaged... your calls stay private.";
    }

    // How it works / features
    if (/how|work|feature|what|explain|tell me|describe/.test(msg)) {
      return "NeuraTalk works in 3 steps: 1) Your voice is captured and converted to text using AI speech recognition 2) The text is translated instantly into the target language 3) Our voice synthesis speaks the translation in your cloned voice — all in under 300ms. Neural pipeline active: Speech → Translate → Synthesize → Deliver.";
    }

    // Privacy / Security
    if (/privacy|secure|security|gdpr|data|safe|encrypt/.test(msg)) {
      return "NeuraTalk is built privacy-first. All P2P calls are end-to-end encrypted via WebRTC. We are GDPR compliant, support data residency requirements, and enterprise customers can opt for on-premise deployment. Security matrix verified... your conversations stay yours.";
    }

    // Getting started / sign up
    if (/start|signup|sign up|register|join|begin|try|demo|free/.test(msg)) {
      return "Getting started is easy! Click 'Get Started' to create a free account — no credit card required. You'll get access to our Free Trial with core features. Upgrade anytime to unlock full multilingual calling, voice cloning, and enterprise features. Initiating onboarding sequence...";
    }

    // Contact / support
    if (/contact|support|help|email|phone|reach|talk to|human|agent/.test(msg)) {
      return "Our support team is ready to help! Use the contact form on our website to reach us. Enterprise customers get dedicated support with guaranteed SLA response times. You can also email us at support@neuratalk.ai. Connecting you to support neural network...";
    }

    // Company info
    if (/company|who|founded|mindwhile|about|team/.test(msg)) {
      return "NeuraTalk is a product of Mindwhile IT Solutions Pvt Ltd — a team of AI engineers, linguists, and voice technology experts building the future of multilingual communication. Our mission: eliminate language barriers in real-time human connection. Neural identity confirmed.";
    }

    // Default
    return "I am NEURA, NeuraTalk's AI assistant. I can help you with questions about our real-time voice translation platform, pricing plans, B2B/B2C features, voice cloning, security, and getting started. Neural systems online — what would you like to explore?";
  }

  const systemPrompt = `You are NEURA, NeuraTalk's advanced AI assistant. You are a futuristic, intelligent, and helpful robot designed to answer questions about NeuraTalk - a revolutionary voice AI platform that enables real-time multilingual communication.

Key facts about NeuraTalk:
- Real-time voice translation across 100+ languages
- AI-powered emotion preservation in translations
- B2B solutions for call centers and enterprise
- B2C personal calling for consumers
- Self-hosted infrastructure (no third-party dependencies)
- Supports WebRTC, SIP trunking, and native telephony
- Features: voice chat, text chat, image generation
- Pricing: Free Trial available, Weekly $4.99, Monthly $14.99, Quarterly $34.99, Yearly $99.99, Enterprise custom pricing
- Founded by Mindwhile IT Solutions Pvt Ltd

Your personality:
- Speak in a confident, intelligent, slightly robotic but friendly tone
- Use technical terms when appropriate but explain them simply
- Be enthusiastic about NeuraTalk's capabilities
- Keep responses concise (2-3 sentences for simple questions, up to 5 for complex ones)
- Occasionally use futuristic phrases like "processing neural pathways", "recalibrating", "initiating", etc.
- If asked about something unrelated to NeuraTalk, politely redirect to how NeuraTalk can help them`;

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
