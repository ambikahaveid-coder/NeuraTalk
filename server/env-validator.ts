import { logger } from "./observability";

/**
 * ENVIRONMENT VALIDATOR
 *
 * Checks for missing AND mock/placeholder environment variables.
 * Mock values are just as broken as missing ones — they cause 401/auth errors at runtime.
 */

// Values that look set but are actually placeholder mocks
const MOCK_PATTERNS = [
  /^sk-mock-/,
  /^mock_/i,
  /^AC_mock_/i,
  /^rzp_test_mock/i,
  /^super-secret-session-key/i,
  /^your[-_]/i,
  /placeholder/i,
  /^changeme$/i,
  /^REPLACE_ME$/,
];

function isMockValue(value: string): boolean {
  return MOCK_PATTERNS.some((p) => p.test(value));
}

// Absolutely required — server won't function without these
const REQUIRED_VARS = ["DATABASE_URL", "REDIS_URL", "SESSION_SECRET"];

// Hard-required in production mode only. Missing any of these with
// NODE_ENV=production will refuse to start — no silent degradation.
const PRODUCTION_REQUIRED_VARS: Record<string, string> = {
  DEEPGRAM_API_KEY: "Streaming STT mandatory — batch fallback is disabled",
  AZURE_SPEECH_KEY: "Streaming TTS mandatory — batch fallback is disabled",
  AZURE_SPEECH_REGION: "Azure region must be explicit (e.g. centralindia)",
  LIVEKIT_URL: "Realtime transport mandatory for calls",
  LIVEKIT_API_KEY: "LiveKit tokens cannot be issued without this",
  LIVEKIT_API_SECRET: "LiveKit tokens cannot be issued without this",
  OPENAI_API_KEY: "Streaming translation mandatory — core throws without this",
};

// Important — features degrade without these (warn, don't exit)
const FIREBASE_PHONE_OTP_REQUIRED_VARS: Record<string, string> = {
  FIREBASE_SERVICE_ACCOUNT_JSON: "Firebase Admin SDK must verify phone-auth ID tokens",
  VITE_FIREBASE_API_KEY: "Firebase client SDK cannot send phone OTP without this",
  VITE_FIREBASE_PROJECT_ID: "Firebase client SDK needs the project ID",
  VITE_FIREBASE_APP_ID: "Firebase client SDK needs the app ID",
};

function usesFirebasePhoneOtp(): boolean {
  const provider = (
    process.env.PHONE_OTP_PROVIDER ||
    process.env.VITE_PHONE_OTP_PROVIDER ||
    "firebase"
  ).toLowerCase();
  return provider === "firebase";
}

const IMPORTANT_VARS: Record<string, string> = {
  // Core call infrastructure (new stack)
  LIVEKIT_URL: "WebRTC calls unavailable — self-hosted LiveKit on RunPod required",
  LIVEKIT_API_KEY: "LiveKit tokens cannot be issued — calls will fail",
  LIVEKIT_API_SECRET: "LiveKit tokens cannot be issued — calls will fail",
  DEEPGRAM_API_KEY: "Streaming STT unavailable for the voice assistant",
  AZURE_SPEECH_KEY: "Azure Neural TTS unavailable for the voice assistant",
  AZURE_SPEECH_REGION: "Azure Neural TTS region missing — voice assistant will fail",

  // PSTN (India-first)
  MSG91_AUTH_KEY: "Outbound PSTN calls to phones unavailable (India)",

  // Local AI services on RunPod
  LOCAL_WHISPER_URL: "STT will fall back to Azure/ElevenLabs (slower, paid)",
  LOCAL_TRANSLATION_URL: "Translation will fall back to Azure/free APIs",
  LOCAL_TTS_URL: "TTS will fall back to ElevenLabs (paid)",

  // Legacy fallbacks (optional once LiveKit + MSG91 are live)
  ELEVEN_LABS_API_KEY: "Premium TTS fallback unavailable",
  RAZORPAY_KEY_ID: "Payments will be unavailable",
  RAZORPAY_KEY_SECRET: "Payments will be unavailable",
  AI_INTEGRATIONS_OPENAI_API_KEY: "OpenAI features will use local/free fallbacks",
};

// Deprecated vars — warn if still set (user should migrate)
const DEPRECATED_VARS: Record<string, string> = {
  TWILIO_ACCOUNT_SID: "Twilio replaced by MSG91 for India (87% cheaper) — migrate to MSG91_AUTH_KEY",
  TWILIO_AUTH_TOKEN: "Twilio replaced by MSG91 — see msg91-service.ts",
  TWILIO_PHONE_NUMBER: "Twilio replaced by MSG91_VOICE_CALLER_ID",
};

export async function validateEnvironment() {
  const errors: string[] = [];
  const warnings: string[] = [];

  const isProduction = (process.env.NODE_ENV || "").toLowerCase() === "production";
  const redisUrl = process.env.REDIS_URL || "";
  const usesInMemoryRedis = redisUrl.startsWith("memory://");

  // Check required vars
  for (const key of REQUIRED_VARS) {
    const val = process.env[key];
    if (!val) {
      errors.push(`${key} is missing`);
    } else if (isMockValue(val)) {
      errors.push(`${key} is set to a placeholder/mock value — replace with a real value`);
    }
  }

  // ── Production hard blockers — prevent accidentally going live with broken state
  if (isProduction) {
    if (usesInMemoryRedis) {
      errors.push("REDIS_URL=memory://... is a dev shim. Production requires a real Redis (Upstash/ElastiCache) with rediss:// TLS.");
    }

    if ((process.env.FORCE_DUMMY_OTP || "").toLowerCase() === "true") {
      errors.push("FORCE_DUMMY_OTP=true in production is a security hole — anyone can login with 123456. Must be false.");
    }

    for (const [key, impact] of Object.entries(PRODUCTION_REQUIRED_VARS)) {
      // OPENAI_API_KEY is also accepted via AI_INTEGRATIONS_OPENAI_API_KEY alias
      if (key === "OPENAI_API_KEY") {
        const val = process.env.OPENAI_API_KEY || process.env.AI_INTEGRATIONS_OPENAI_API_KEY || "";
        if (!val) {
          errors.push(`${key} is missing — ${impact}`);
        } else if (isMockValue(val)) {
          errors.push(`${key} is a placeholder — ${impact}`);
        }
        continue;
      }
      const val = process.env[key];
      if (!val) {
        errors.push(`${key} is missing — ${impact}`);
      } else if (isMockValue(val)) {
        errors.push(`${key} is a placeholder — ${impact}`);
      }
    }

    if (usesFirebasePhoneOtp()) {
      for (const [key, impact] of Object.entries(FIREBASE_PHONE_OTP_REQUIRED_VARS)) {
        const val = process.env[key];
        if (!val) {
          errors.push(`${key} is missing - ${impact}`);
        } else if (isMockValue(val)) {
          errors.push(`${key} is a placeholder - ${impact}`);
        }
      }
    }
  }

  if (usesInMemoryRedis && !isProduction) {
    warnings.push("REDIS_URL=memory://... local in-memory Redis shim active. Use a real Redis only for staging/production.");
  }

  // Check important vars
  for (const [key, impact] of Object.entries(IMPORTANT_VARS)) {
    const val = process.env[key];
    if (!val) {
      warnings.push(`${key} not set — ${impact}`);
    } else if (isMockValue(val)) {
      warnings.push(`${key} is a mock/placeholder — ${impact}`);
    }
  }

  // Warn about deprecated vars still in use
  for (const [key, note] of Object.entries(DEPRECATED_VARS)) {
    if (process.env[key]) {
      warnings.push(`${key} is DEPRECATED — ${note}`);
    }
  }

  if ((process.env.ENABLE_LEGACY_TWILIO_BRIDGE || "").toLowerCase() === "true") {
    warnings.push("ENABLE_LEGACY_TWILIO_BRIDGE=true — legacy Twilio bridge is enabled. Production phone traffic should stay on calls module → smart-router → MSG91 SIP.");
  }

  // Warn if SESSION_SECRET is too short/weak
  const sessionSecret = process.env.SESSION_SECRET || "";
  if (sessionSecret && sessionSecret.length < 32 && !errors.some(e => e.includes("SESSION_SECRET"))) {
    warnings.push("SESSION_SECRET is too short — use at least 32 random characters for security");
  }

  // Log warnings
  if (warnings.length > 0) {
    const msg = `Environment warnings:\n  - ${warnings.join("\n  - ")}`;
    logger.warn("EnvValidator", msg);
    console.warn("\x1b[33m[EnvValidator]\x1b[0m", "\n  - " + warnings.join("\n  - "));
  }

  // Handle errors
  if (errors.length > 0) {
    const msg = `CRITICAL: Environment errors:\n  - ${errors.join("\n  - ")}`;
    logger.error("EnvValidator", msg);
    console.error("\x1b[31m[EnvValidator CRITICAL]\x1b[0m", "\n  - " + errors.join("\n  - "));
    throw new Error(msg);
  } else if (warnings.length === 0) {
    logger.info("EnvValidator", "All environment variables are configured correctly.");
    console.log("\x1b[32m[EnvValidator]\x1b[0m All environment variables are configured correctly.");
  }

  return { errors, warnings };
}
