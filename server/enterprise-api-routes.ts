import type { Express, Request, Response } from "express";
import crypto from "crypto";
import OpenAI from "openai";
import { db } from "./db";
import { getOpenAIKey } from "./openai-config";
import { enterpriseApiKeys, organizations } from "@shared/schema";
import { desc, eq } from "drizzle-orm";
import { loadUser, requireSuperAdmin } from "./role-middleware";
import { logAuditEvent } from "./audit-logging";
import {
  API_KEY_PERMISSIONS,
  createApiKeyMiddleware,
  isValidApiKeyPermission,
  normalizePermissions,
  parseExpiryDateInput,
} from "./api-key-auth";

const openai = new OpenAI({
  apiKey: getOpenAIKey() || "",
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});

const SUPPORTED_LANGUAGES = [
  { code: "en", name: "English" },
  { code: "es", name: "Spanish" },
  { code: "fr", name: "French" },
  { code: "de", name: "German" },
  { code: "it", name: "Italian" },
  { code: "pt", name: "Portuguese" },
  { code: "ru", name: "Russian" },
  { code: "zh", name: "Chinese" },
  { code: "ja", name: "Japanese" },
  { code: "ko", name: "Korean" },
  { code: "ar", name: "Arabic" },
  { code: "hi", name: "Hindi" },
  { code: "bn", name: "Bengali" },
  { code: "ta", name: "Tamil" },
  { code: "te", name: "Telugu" },
  { code: "mr", name: "Marathi" },
  { code: "gu", name: "Gujarati" },
  { code: "kn", name: "Kannada" },
  { code: "ml", name: "Malayalam" },
  { code: "pa", name: "Punjabi" },
  { code: "ur", name: "Urdu" },
  { code: "th", name: "Thai" },
  { code: "vi", name: "Vietnamese" },
  { code: "id", name: "Indonesian" },
  { code: "ms", name: "Malay" },
  { code: "tr", name: "Turkish" },
  { code: "pl", name: "Polish" },
  { code: "nl", name: "Dutch" },
  { code: "sv", name: "Swedish" },
  { code: "da", name: "Danish" },
  { code: "no", name: "Norwegian" },
  { code: "fi", name: "Finnish" },
  { code: "el", name: "Greek" },
  { code: "he", name: "Hebrew" },
  { code: "cs", name: "Czech" },
  { code: "ro", name: "Romanian" },
  { code: "hu", name: "Hungarian" },
  { code: "uk", name: "Ukrainian" },
  { code: "sw", name: "Swahili" },
  { code: "fil", name: "Filipino" },
];

export function registerEnterpriseApiRoutes(app: Express): void {
  app.post("/api/sdk/translate", createApiKeyMiddleware("translate"), async (req: Request, res: Response) => {
    try {
      const { text, sourceLang, targetLang } = req.body;
      if (!text || !sourceLang || !targetLang) {
        return res.status(400).json({ error: "text, sourceLang, and targetLang are required" });
      }

      let translatedText = "";
      // Try Azure Translator first (2M chars/month FREE)
      try {
        const { isAzureTranslatorAvailable, azureTranslate } = await import("./azure-service");
        if (isAzureTranslatorAvailable()) {
          const result = await azureTranslate(text, sourceLang, targetLang);
          if (result && result !== text) translatedText = result;
        }
      } catch {
        // Azure not available
      }

      if (!translatedText) {
      try {
        const completion = await openai.chat.completions.create({
          model: "gpt-4o-mini",
          messages: [
            {
              role: "system",
              content: `You are a professional translator. Translate the following text from ${sourceLang} to ${targetLang}. Return ONLY the translated text, nothing else.`,
            },
            { role: "user", content: text },
          ],
          max_tokens: 2000,
          temperature: 0.3,
        });
        translatedText = completion.choices[0]?.message?.content || "";
      } catch {
        // OpenAI failed — use free translation fallback
        const { translateText } = await import("./elevenlabs-service");
        translatedText = await translateText(text, sourceLang, targetLang);
      }
      }

      res.json({
        translatedText,
        sourceLang,
        targetLang,
        originalText: text,
      });
    } catch (error) {
      console.error("SDK translate error:", error);
      res.status(500).json({ error: "Translation failed" });
    }
  });

  app.post("/api/sdk/tts", createApiKeyMiddleware("tts"), async (req: Request, res: Response) => {
    try {
      const { text, voice = "nova", lang } = req.body;
      if (!text || typeof text !== "string") {
        return res.status(400).json({ error: "text is required" });
      }

      // Try Azure TTS first (500K chars/month FREE), then ElevenLabs, then OpenAI
      let audioData = "";
      try {
        const { isAzureSpeechAvailable, azureTTS } = await import("./azure-service");
        if (isAzureSpeechAvailable()) {
          const audioBuffer = await azureTTS(text, lang || "en");
          audioData = audioBuffer.toString("base64");
        }
      } catch {
        // Azure not available
      }

      if (!audioData) {
      try {
        const { elevenLabsTTS, ELEVENLABS_VOICES } = await import("./elevenlabs-service");
        const voiceId = ELEVENLABS_VOICES.rachel;
        const audioBuffer = await elevenLabsTTS(text, voiceId);
        audioData = audioBuffer.toString("base64");
      } catch {
        // ElevenLabs failed, try OpenAI
        try {
          const response = await openai.chat.completions.create({
            model: "gpt-audio-mini",
            modalities: ["text", "audio"],
            audio: { voice: voice as any, format: "mp3" },
            messages: [
              { role: "system", content: "You are an assistant that performs text-to-speech." },
              { role: "user", content: `Repeat the following text verbatim: ${text}` },
            ],
          });
          audioData = (response.choices[0]?.message as any)?.audio?.data ?? "";
        } catch {
          return res.status(500).json({ error: "Text-to-speech failed — all providers unavailable" });
        }
      }
      } // end if (!audioData)

      res.json({
        audio: audioData,
        format: "mp3",
        voice,
        lang: lang || "en",
      });
    } catch (error) {
      console.error("SDK TTS error:", error);
      res.status(500).json({ error: "Text-to-speech failed" });
    }
  });

  app.post("/api/sdk/stt", createApiKeyMiddleware("stt"), async (req: Request, res: Response) => {
    try {
      const multer = (await import("multer")).default;
      const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

      upload.single("audio")(req, res, async (err) => {
        if (err) {
          return res.status(400).json({ error: "File upload failed" });
        }

        const file = (req as any).file;
        if (!file) {
          return res.status(400).json({ error: "Audio file is required" });
        }

        try {
          // Try Azure STT first (5 hrs/month FREE)
          try {
            const { isAzureSpeechAvailable, azureSTT } = await import("./azure-service");
            if (isAzureSpeechAvailable()) {
              const text = await azureSTT(file.buffer, "en", file.mimetype?.includes("mp3") ? "mp3" : "wav");
              if (text) {
                return res.json({ text, language: "auto", provider: "azure" });
              }
            }
          } catch {
            // Azure not available
          }

          // Try ElevenLabs STT
          const { elevenLabsSTT } = await import("./elevenlabs-service");
          const text = await elevenLabsSTT(file.buffer, file.mimetype?.includes("mp3") ? "mp3" : "wav");
          if (text) {
            return res.json({ text, language: "auto" });
          }
          throw new Error("ElevenLabs returned empty");
        } catch {
          // Fallback to OpenAI
          try {
            const audioFile = new File([file.buffer], file.originalname || "audio.webm", {
              type: file.mimetype || "audio/webm",
            });

            const transcription = await openai.audio.transcriptions.create({
              model: "gpt-4o-mini-transcribe",
              file: audioFile,
            });

            res.json({
              text: transcription.text,
              language: (transcription as any).language || "unknown",
            });
          } catch (innerError) {
            console.error("SDK STT all providers failed:", innerError);
            res.status(500).json({ error: "Speech-to-text failed — all providers unavailable" });
          }
        }
      });
    } catch (error) {
      console.error("SDK STT error:", error);
      res.status(500).json({ error: "Speech-to-text failed" });
    }
  });

  app.get("/api/sdk/languages", createApiKeyMiddleware("languages"), async (_req: Request, res: Response) => {
    res.json({ languages: SUPPORTED_LANGUAGES, total: SUPPORTED_LANGUAGES.length });
  });

  app.get("/api/sdk/usage", createApiKeyMiddleware(), async (req: Request, res: Response) => {
    const key = req.apiKey;
    if (!key) {
      return res.status(500).json({ error: "API key context missing" });
    }
    res.json({
      keyName: key.name,
      keyPrefix: key.keyPrefix,
      status: key.status,
      usageCount: key.usageCount ?? 0,
      usageToday: key.usageToday ?? 0,
      dailyQuota: key.dailyQuota,
      rateLimitPerMinute: key.rateLimitPerMinute,
      lastUsedAt: key.lastUsedAt,
      expiresAt: key.expiresAt,
    });
  });

  app.post("/api/sdk/voice-chat", createApiKeyMiddleware("voice-chat"), async (req: Request, res: Response) => {
    try {
      const { message, history = [] } = req.body;
      if (!message || typeof message !== "string") {
        return res.status(400).json({ error: "message is required" });
      }

      const messages: { role: "system" | "user" | "assistant"; content: string }[] = [
        {
          role: "system",
          content: "You are a helpful multilingual voice assistant powered by NeuraTalk. Respond concisely and naturally, as your responses will be converted to speech. Keep responses under 3 sentences unless asked for more detail.",
        },
        ...history.slice(-10).map((m: { role: string; content: string }) => ({
          role: m.role as "user" | "assistant",
          content: m.content,
        })),
        { role: "user", content: message },
      ];

      const completion = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages,
        max_tokens: 500,
        temperature: 0.7,
      });

      const reply = completion.choices[0]?.message?.content || "I'm sorry, I couldn't process that. Please try again.";

      res.json({ message: reply });
    } catch (error) {
      console.error("SDK voice-chat error:", error);
      res.status(500).json({ error: "Voice chat failed" });
    }
  });

  app.get("/api/admin/api-keys", loadUser, requireSuperAdmin, async (_req: Request, res: Response) => {
    try {
      const keys = await db.query.enterpriseApiKeys.findMany({
        orderBy: [desc(enterpriseApiKeys.createdAt)],
        with: { organization: true },
      });

      const result = keys.map((k) => ({
        id: k.id,
        name: k.name,
        keyPrefix: k.keyPrefix,
        status: k.status,
        organizationId: k.organizationId,
        organizationName: (k as any).organization?.name || "Unknown",
        permissions: (() => {
          const permissions = normalizePermissions(k.permissions);
          return permissions.length > 0 ? permissions : [...API_KEY_PERMISSIONS];
        })(),
        rateLimitPerMinute: k.rateLimitPerMinute,
        dailyQuota: k.dailyQuota,
        usageCount: k.usageCount,
        usageToday: k.usageToday,
        lastUsedAt: k.lastUsedAt,
        activatedAt: k.activatedAt,
        suspendedAt: k.suspendedAt,
        suspendedReason: k.suspendedReason,
        expiresAt: k.expiresAt,
        createdAt: k.createdAt,
      }));

      res.json({ success: true, keys: result });
    } catch (error) {
      console.error("Failed to list API keys:", error);
      res.status(500).json({ success: false, error: "Failed to list API keys" });
    }
  });

  app.post("/api/admin/api-keys", loadUser, requireSuperAdmin, async (req: Request, res: Response) => {
    try {
      const { organizationId, name, dailyQuota, rateLimitPerMinute, permissions, expiresAt } = req.body;
      const normalizedOrganizationId = Number(organizationId);
      const normalizedDailyQuota = Math.max(1, Number(dailyQuota) || 1000);
      const normalizedRateLimitPerMinute = Math.max(1, Number(rateLimitPerMinute) || 60);

      if (!normalizedOrganizationId || !name) {
        return res.status(400).json({ success: false, error: "organizationId and name are required" });
      }

      const normalizedPermissions = normalizePermissions(permissions);
      const invalidPermissions = normalizedPermissions.filter((permission) => !isValidApiKeyPermission(permission));
      if (invalidPermissions.length > 0) {
        return res.status(400).json({
          success: false,
          error: "Invalid API key permissions",
          invalidPermissions,
        });
      }

      let parsedExpiresAt: Date | null = null;
      try {
        parsedExpiresAt = parseExpiryDateInput(expiresAt);
      } catch (error) {
        return res.status(400).json({ success: false, error: "Invalid expiry date" });
      }

      if (parsedExpiresAt && parsedExpiresAt <= new Date()) {
        return res.status(400).json({ success: false, error: "Expiry date must be in the future" });
      }

      const org = await db.query.organizations.findFirst({
        where: eq(organizations.id, normalizedOrganizationId),
      });

      if (!org) {
        return res.status(404).json({ success: false, error: "Organization not found" });
      }

      const rawKey = "ntk_ent_" + crypto.randomBytes(20).toString("hex");
      const keyHash = crypto.createHash("sha256").update(rawKey).digest("hex");
      const keyPrefix = rawKey.substring(0, 16);

      const [newKey] = await db.insert(enterpriseApiKeys).values({
        organizationId: normalizedOrganizationId,
        keyHash,
        keyPrefix,
        name,
        status: "pending",
        permissions: normalizedPermissions.length > 0 ? normalizedPermissions : [...API_KEY_PERMISSIONS],
        dailyQuota: normalizedDailyQuota,
        rateLimitPerMinute: normalizedRateLimitPerMinute,
        usageCount: 0,
        usageToday: 0,
        expiresAt: parsedExpiresAt,
      }).returning();

      await logAuditEvent({
        action: "api_key_created",
        userId: req.user?.id,
        organizationId: normalizedOrganizationId,
        details: { keyId: newKey.id, keyName: name, keyPrefix },
      });

      res.status(201).json({
        success: true,
        key: rawKey,
        keyId: newKey.id,
        keyPrefix,
        name,
        status: "pending",
        expiresAt: newKey.expiresAt,
        message: "API key created. Save the key now - it will not be shown again.",
      });
    } catch (error) {
      console.error("Failed to create API key:", error);
      res.status(500).json({ success: false, error: "Failed to create API key" });
    }
  });

  app.patch("/api/admin/api-keys/:id/activate", loadUser, requireSuperAdmin, async (req: Request, res: Response) => {
    try {
      const keyId = parseInt(req.params.id);

      const [updated] = await db.update(enterpriseApiKeys)
        .set({
          status: "active",
          activatedBy: req.user!.id,
          activatedAt: new Date(),
        })
        .where(eq(enterpriseApiKeys.id, keyId))
        .returning();

      if (!updated) {
        return res.status(404).json({ success: false, error: "API key not found" });
      }

      res.json({ success: true, message: "API key activated", key: { id: updated.id, status: updated.status } });
    } catch (error) {
      console.error("Failed to activate API key:", error);
      res.status(500).json({ success: false, error: "Failed to activate API key" });
    }
  });

  app.patch("/api/admin/api-keys/:id/suspend", loadUser, requireSuperAdmin, async (req: Request, res: Response) => {
    try {
      const keyId = parseInt(req.params.id);
      const { reason } = req.body;

      const [updated] = await db.update(enterpriseApiKeys)
        .set({
          status: "suspended",
          suspendedAt: new Date(),
          suspendedReason: reason || "Suspended by admin",
        })
        .where(eq(enterpriseApiKeys.id, keyId))
        .returning();

      if (!updated) {
        return res.status(404).json({ success: false, error: "API key not found" });
      }

      res.json({ success: true, message: "API key suspended", key: { id: updated.id, status: updated.status } });
    } catch (error) {
      console.error("Failed to suspend API key:", error);
      res.status(500).json({ success: false, error: "Failed to suspend API key" });
    }
  });

  app.delete("/api/admin/api-keys/:id", loadUser, requireSuperAdmin, async (req: Request, res: Response) => {
    try {
      const keyId = parseInt(req.params.id);

      const [updated] = await db.update(enterpriseApiKeys)
        .set({ status: "revoked" })
        .where(eq(enterpriseApiKeys.id, keyId))
        .returning();

      if (!updated) {
        return res.status(404).json({ success: false, error: "API key not found" });
      }

      await logAuditEvent({
        action: "api_key_revoked",
        userId: req.user?.id,
        details: { keyId: updated.id, keyName: updated.name },
      });

      res.json({ success: true, message: "API key revoked", key: { id: updated.id, status: updated.status } });
    } catch (error) {
      console.error("Failed to revoke API key:", error);
      res.status(500).json({ success: false, error: "Failed to revoke API key" });
    }
  });

  /**
   * Rotate an API key's secret in place (P1 foundation hardening, 2026-08-23).
   * Preserves the row id, organization link, permissions, and quotas -- only
   * the hash/prefix change. This means integrations keep their same key ID for
   * reference/audit purposes; only the secret value itself needs to be swapped
   * by the client, avoiding a delete+recreate that would orphan configuration.
   * The old key stops authenticating immediately (hash is overwritten) -- there
   * is no overlap/grace window in this pass.
   */
  app.post("/api/admin/api-keys/:id/rotate", loadUser, requireSuperAdmin, async (req: Request, res: Response) => {
    try {
      const keyId = parseInt(req.params.id);

      const existing = await db.query.enterpriseApiKeys.findFirst({
        where: eq(enterpriseApiKeys.id, keyId),
      });
      if (!existing) {
        return res.status(404).json({ success: false, error: "API key not found" });
      }
      if (existing.status === "revoked") {
        return res.status(409).json({ success: false, error: "Cannot rotate a revoked API key" });
      }

      const rawKey = "ntk_ent_" + crypto.randomBytes(20).toString("hex");
      const keyHash = crypto.createHash("sha256").update(rawKey).digest("hex");
      const keyPrefix = rawKey.substring(0, 16);

      const [updated] = await db.update(enterpriseApiKeys)
        .set({ keyHash, keyPrefix })
        .where(eq(enterpriseApiKeys.id, keyId))
        .returning();

      await logAuditEvent({
        action: "api_key_rotated",
        userId: req.user?.id,
        organizationId: existing.organizationId,
        details: { keyId: updated.id, keyName: updated.name, previousPrefix: existing.keyPrefix, newPrefix: keyPrefix },
      });

      res.json({
        success: true,
        key: rawKey,
        keyId: updated.id,
        keyPrefix,
        message: "API key rotated. Save the new key now - it will not be shown again. The previous key stopped working immediately.",
      });
    } catch (error) {
      console.error("Failed to rotate API key:", error);
      res.status(500).json({ success: false, error: "Failed to rotate API key" });
    }
  });
}
