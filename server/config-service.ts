/**
 * Platform Configuration Service
 * 
 * Handles encrypted storage and retrieval of platform secrets like
 * Firebase credentials, TURN server configuration, etc.
 * 
 * Only super_admin users can manage these settings.
 */

import crypto from "crypto";
import { db } from "./db";
import { platformSecrets } from "@shared/schema";
import { eq } from "drizzle-orm";
import { logger } from "./observability";

const ALGORITHM = "aes-256-gcm";
const KEY_LENGTH = 32;
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;

const ELEVENLABS_KEYS = ["ELEVEN_LABS_API_KEY", "ELEVENLABS_API_KEY"] as const;

function syncLegacyAliases(key: string, value: string | undefined): void {
  if (!ELEVENLABS_KEYS.includes(key as typeof ELEVENLABS_KEYS[number])) {
    return;
  }

  for (const alias of ELEVENLABS_KEYS) {
    if (value) {
      process.env[alias] = value;
    } else {
      delete process.env[alias];
    }
  }
}

function readWithAliases(cache: Map<string, string>, key: string): string | undefined {
  if (ELEVENLABS_KEYS.includes(key as typeof ELEVENLABS_KEYS[number])) {
    return cache.get("ELEVEN_LABS_API_KEY")
      || cache.get("ELEVENLABS_API_KEY")
      || process.env.ELEVEN_LABS_API_KEY
      || process.env.ELEVENLABS_API_KEY;
  }

  return cache.get(key) || process.env[key];
}

function getEncryptionKey(): Buffer {
  const keyEnv = process.env.PLATFORM_SECRET_KEY || process.env.SESSION_SECRET;
  
  if (!keyEnv) {
    throw new Error("[ConfigService] PLATFORM_SECRET_KEY or SESSION_SECRET must be set for encrypted storage");
  }
  
  const salt = "neuratalk-platform-v1";
  return crypto.scryptSync(keyEnv, salt, KEY_LENGTH);
}

function encrypt(text: string): { encrypted: string; iv: string } {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  let encrypted = cipher.update(text, "utf8", "hex");
  encrypted += cipher.final("hex");
  
  const authTag = cipher.getAuthTag();
  
  return {
    encrypted: encrypted + authTag.toString("hex"),
    iv: iv.toString("hex"),
  };
}

function decrypt(encryptedWithTag: string, ivHex: string): string {
  const key = getEncryptionKey();
  const iv = Buffer.from(ivHex, "hex");
  
  const authTag = Buffer.from(encryptedWithTag.slice(-AUTH_TAG_LENGTH * 2), "hex");
  const encrypted = encryptedWithTag.slice(0, -AUTH_TAG_LENGTH * 2);
  
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  
  let decrypted = decipher.update(encrypted, "hex", "utf8");
  decrypted += decipher.final("utf8");
  
  return decrypted;
}

export type ConfigCategory =
  | "firebase"
  | "turn"
  | "openai"
  | "msg91"
  | "razorpay"
  | "azure"
  | "livekit"
  | "deepgram"
  | "agora"
  | "voice";

export interface ConfigKey {
  key: string;
  category: ConfigCategory;
  description: string;
  isClientSide?: boolean;
  requiredForStatus?: boolean;
}

export const PLATFORM_CONFIG_KEYS: ConfigKey[] = [
  { key: "FIREBASE_SERVICE_ACCOUNT_JSON", category: "firebase", description: "Firebase service account JSON (server-side)", requiredForStatus: true },
  { key: "VITE_FIREBASE_API_KEY", category: "firebase", description: "Firebase Web API Key", isClientSide: true, requiredForStatus: true },
  { key: "VITE_FIREBASE_PROJECT_ID", category: "firebase", description: "Firebase Project ID", isClientSide: true, requiredForStatus: true },
  { key: "VITE_FIREBASE_APP_ID", category: "firebase", description: "Firebase App ID", isClientSide: true, requiredForStatus: true },

  { key: "TURN_SERVER_URL", category: "turn", description: "TURN Server URL (e.g. turn:server.com:3478)", requiredForStatus: true },
  { key: "TURN_SERVER_USERNAME", category: "turn", description: "TURN Server username", requiredForStatus: true },
  { key: "TURN_SERVER_CREDENTIAL", category: "turn", description: "TURN Server password", requiredForStatus: true },

  { key: "OPENAI_API_KEY", category: "openai", description: "Primary OpenAI API key" },
  { key: "AI_INTEGRATIONS_OPENAI_API_KEY", category: "openai", description: "OpenAI key used by AI integrations", requiredForStatus: true },
  { key: "AI_INTEGRATIONS_OPENAI_BASE_URL", category: "openai", description: "Optional OpenAI-compatible base URL" },

  { key: "MSG91_AUTH_KEY", category: "msg91", description: "MSG91 auth key for OTP and PSTN", requiredForStatus: true },
  { key: "APP_BASE_URL", category: "msg91", description: "Public base URL used to build MSG91 callback URLs", requiredForStatus: true },
  { key: "MSG91_OTP_TEMPLATE_ID", category: "msg91", description: "MSG91 OTP template ID for SMS verification" },
  { key: "MSG91_VOICE_CALLER_ID", category: "msg91", description: "Verified MSG91 caller ID" },
  { key: "MSG91_VOICE_URL", category: "msg91", description: "Optional legacy MSG91 voice callback URL alias" },
  { key: "MSG91_WEBHOOK_SECRET", category: "msg91", description: "Optional MSG91 webhook signing secret" },

  { key: "RAZORPAY_KEY_ID", category: "razorpay", description: "Razorpay key ID", requiredForStatus: true },
  { key: "RAZORPAY_KEY_SECRET", category: "razorpay", description: "Razorpay key secret", requiredForStatus: true },
  { key: "RAZORPAY_WEBHOOK_SECRET", category: "razorpay", description: "Razorpay webhook signing secret" },

  { key: "AZURE_SPEECH_KEY", category: "azure", description: "Azure Speech resource key", requiredForStatus: true },
  { key: "AZURE_SPEECH_REGION", category: "azure", description: "Azure Speech region", requiredForStatus: true },
  { key: "AZURE_TRANSLATOR_KEY", category: "azure", description: "Azure Translator resource key" },
  { key: "AZURE_TRANSLATOR_REGION", category: "azure", description: "Azure Translator region" },

  { key: "LIVEKIT_URL", category: "livekit", description: "LiveKit WebSocket URL", requiredForStatus: true },
  { key: "LIVEKIT_API_KEY", category: "livekit", description: "LiveKit server API key", requiredForStatus: true },
  { key: "LIVEKIT_API_SECRET", category: "livekit", description: "LiveKit server API secret", requiredForStatus: true },
  { key: "LIVEKIT_SIP_DOMAIN", category: "livekit", description: "LiveKit SIP domain" },

  { key: "STT_PROVIDER", category: "azure", description: "Primary STT provider selector", requiredForStatus: true },
  { key: "DEEPGRAM_API_KEY", category: "deepgram", description: "Deepgram API key for fallback STT only" },

  { key: "AGORA_APP_ID", category: "agora", description: "Agora App ID", requiredForStatus: true },
  { key: "AGORA_APP_CERTIFICATE", category: "agora", description: "Agora App certificate", requiredForStatus: true },
  { key: "AGORA_CLOUD_RECORDING_ENABLED", category: "agora", description: "Enable Agora cloud recording" },

  { key: "ELEVEN_LABS_API_KEY", category: "voice", description: "ElevenLabs API key for premium TTS", requiredForStatus: true },
];

export class ConfigService {
  private cache: Map<string, string> = new Map();
  private initialized = false;

  async initialize(): Promise<void> {
    if (this.initialized) return;

    const isProduction = process.env.NODE_ENV === "production";
    // Neon serverless cold-starts can take 5–10s; allow 15s before giving up
    const TIMEOUT_MS = isProduction ? 15_000 : 5_000;
    const MAX_ATTEMPTS = 2;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        const loadPromise = this.loadSecretsFromDb();
        const timeoutPromise = new Promise<number>((resolve) => {
          setTimeout(() => resolve(0), TIMEOUT_MS);
        });

        const count = await Promise.race([loadPromise, timeoutPromise]);

        if (count > 0) {
          this.initialized = true;
          return;
        }

        if (attempt < MAX_ATTEMPTS) {
          logger.warn("ConfigService", `Attempt ${attempt}/${MAX_ATTEMPTS}: timed out loading secrets — retrying`, {
            timeoutMs: TIMEOUT_MS,
          });
          await new Promise((resolve) => setTimeout(resolve, 1000));
        } else {
          const meta = { timeoutMs: TIMEOUT_MS, nodeEnv: process.env.NODE_ENV };
          if (isProduction) {
            logger.error("ConfigService", `All ${MAX_ATTEMPTS} attempts timed out loading platform secrets — running with env-only config`, undefined, meta);
          } else {
            logger.warn("ConfigService", `All ${MAX_ATTEMPTS} attempts timed out loading platform secrets — running with env-only config`, meta);
          }
        }
      } catch (err) {
        logger.error("ConfigService", `Attempt ${attempt}/${MAX_ATTEMPTS}: error loading secrets`, err as Error);
        if (attempt < MAX_ATTEMPTS) {
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
      }
    }

    this.initialized = true;
  }

  private async loadSecretsFromDb(): Promise<number> {
    const secrets = await db.select().from(platformSecrets).where(eq(platformSecrets.isSet, true));

    for (const secret of secrets) {
      try {
        const value = decrypt(secret.encryptedValue, secret.iv);
        this.cache.set(secret.key, value);
        process.env[secret.key] = value;
        syncLegacyAliases(secret.key, value);
      } catch (err) {
        logger.error("ConfigService", `Failed to decrypt ${secret.key}`, err as Error);
      }
    }

    logger.info("ConfigService", `Loaded ${secrets.length} platform secrets from database`);
    return secrets.length;
  }

  async setSecret(key: string, value: string, userId: number): Promise<void> {
    const configKey = PLATFORM_CONFIG_KEYS.find(k => k.key === key);
    if (!configKey) {
      throw new Error(`Unknown config key: ${key}`);
    }

    const { encrypted, iv } = encrypt(value);

    await db
      .insert(platformSecrets)
      .values({
        key,
        encryptedValue: encrypted,
        iv,
        category: configKey.category,
        description: configKey.description,
        isSet: true,
        updatedBy: userId,
      })
      .onConflictDoUpdate({
        target: platformSecrets.key,
        set: {
          encryptedValue: encrypted,
          iv,
          category: configKey.category,
          description: configKey.description,
          isSet: true,
          updatedBy: userId,
          updatedAt: new Date(),
        },
      });

    this.cache.set(key, value);
    process.env[key] = value;
    syncLegacyAliases(key, value);

    logger.info("ConfigService", `Secret ${key} updated`, { userId });
  }

  async deleteSecret(key: string, userId: number): Promise<void> {
    // Completely delete the secret from DB (don't leave encrypted data behind)
    await db
      .delete(platformSecrets)
      .where(eq(platformSecrets.key, key));

    this.cache.delete(key);
    delete process.env[key];
    syncLegacyAliases(key, undefined);

    logger.info("ConfigService", `Secret ${key} permanently deleted`, { userId });
  }

  getSecret(key: string): string | undefined {
    return readWithAliases(this.cache, key);
  }

  async getConfigStatus(): Promise<Array<{ key: string; category: string; description: string; isSet: boolean; isClientSide: boolean; requiredForStatus: boolean }>> {
    const secrets = await db.select().from(platformSecrets);
    const secretMap = new Map(secrets.map(s => [s.key, s.isSet]));

    return PLATFORM_CONFIG_KEYS.map(config => ({
      key: config.key,
      category: config.category,
      description: config.description,
      isSet: secretMap.get(config.key) === true || !!process.env[config.key],
      isClientSide: config.isClientSide || false,
      requiredForStatus: config.requiredForStatus || false,
    }));
  }

  isFirebaseConfigured(): boolean {
    return !!(
      this.getSecret("FIREBASE_SERVICE_ACCOUNT_JSON") &&
      this.getSecret("VITE_FIREBASE_API_KEY") &&
      this.getSecret("VITE_FIREBASE_PROJECT_ID") &&
      this.getSecret("VITE_FIREBASE_APP_ID")
    );
  }

  isTurnConfigured(): boolean {
    return !!(
      this.getSecret("TURN_SERVER_URL") &&
      this.getSecret("TURN_SERVER_USERNAME") &&
      this.getSecret("TURN_SERVER_CREDENTIAL")
    );
  }

  getConfigSummary(): Record<string, { configured: boolean; keys: string[]; requiredKeys: string[]; setKeys: string[]; missingKeys: string[] }> {
    const categories = Array.from(new Set(PLATFORM_CONFIG_KEYS.map((config) => config.category)));

    return categories.reduce((summary, category) => {
      const keys = PLATFORM_CONFIG_KEYS.filter((config) => config.category === category);
      const requiredKeys = keys.filter((config) => config.requiredForStatus).map((config) => config.key);
      const setKeys = keys
        .filter((config) => !!this.getSecret(config.key) || !!process.env[config.key])
        .map((config) => config.key);
      const missingKeys = keys.filter((config) => !setKeys.includes(config.key)).map((config) => config.key);

      summary[category] = {
        configured: requiredKeys.length > 0
          ? requiredKeys.every((key) => setKeys.includes(key))
          : setKeys.length > 0,
        keys: keys.map((config) => config.key),
        requiredKeys,
        setKeys,
        missingKeys,
      };

      return summary;
    }, {} as Record<string, { configured: boolean; keys: string[]; requiredKeys: string[]; setKeys: string[]; missingKeys: string[] }>);
  }
}

export const configService = new ConfigService();
