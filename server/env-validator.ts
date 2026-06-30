import { logger } from "./observability";

const MOCK_PATTERNS = [
  /^sk-mock-/i,
  /^mock_/i,
  /^AC_mock_/i,
  /^rzp_test_mock/i,
  /^rzp_(?:test|live)_[x]+$/i,
  /^super-secret-session-key/i,
  /^your[-_]/i,
  /^example$/i,
  /^example[_-]/i,
  /placeholder/i,
  /^changeme$/i,
  /^REPLACE_ME$/,
  /^https?:\/\/(?:localhost|127\.0\.0\.1)/i,
];

// These are unrecoverable — server cannot function without them.
// SUPER_ADMIN_EMAIL and SUPER_ADMIN_SECRET must be set as encrypted secrets
// in the DO dashboard. No hardcoded fallback is permitted.
const BOOTSTRAP_REQUIRED_VARS = [
  "DATABASE_URL",
  "REDIS_URL",
  "SESSION_SECRET",
  "SUPER_ADMIN_EMAIL",
  "SUPER_ADMIN_SECRET",
];

// Everything else: warn but do NOT crash — individual features degrade gracefully
const SERVICE_VARS: Record<string, string> = {
  STT_PROVIDER: "STT provider not set — defaulting to azure",
  AZURE_SPEECH_KEY: "Voice transcription/TTS unavailable — set this to enable Azure Speech",
  AZURE_SPEECH_REGION: "Azure Speech region not set — defaulting to centralindia",
  LIVEKIT_URL: "Real-time calls unavailable — LiveKit URL not configured",
  LIVEKIT_API_KEY: "LiveKit token issuance unavailable",
  LIVEKIT_API_SECRET: "LiveKit token issuance unavailable",
  OPENAI_API_KEY: "AI translation unavailable — OpenAI key not set",
  APP_BASE_URL: "Webhook callbacks may fail — APP_BASE_URL not set",
  FIREBASE_SERVICE_ACCOUNT_JSON: "Phone OTP auth unavailable — Firebase Admin SDK not configured",
  VITE_FIREBASE_API_KEY: "Firebase client SDK (build-time var — ignore at runtime)",
  VITE_FIREBASE_PROJECT_ID: "Firebase client SDK (build-time var — ignore at runtime)",
  VITE_FIREBASE_APP_ID: "Firebase client SDK (build-time var — ignore at runtime)",
  MSG91_AUTH_KEY: "Outbound PSTN calls unavailable",
  MSG91_VOICE_CALLER_ID: "PSTN caller ID unavailable",
  // MSG91_WEBHOOK_SECRET intentionally omitted from SERVICE_VARS — treated as startup error when PSTN is active
  KAMAILIO_MI_URL: "Kamailio management interface not configured — SIP core control unavailable",
  FREESWITCH_ESL_HOST: "FreeSWITCH ESL not configured — media gateway unavailable",
  FREESWITCH_ESL_PASSWORD: "FreeSWITCH ESL password not configured",
  RTPENGINE_HOST: "RTPEngine not configured — RTP proxy/fork unavailable",
  LIVEKIT_SIP_DOMAIN: "LiveKit SIP domain not configured — PSTN bridge unavailable",
  LOCAL_WHISPER_URL: "Local STT acceleration unavailable",
  LOCAL_TRANSLATION_URL: "Local translation acceleration unavailable",
  LOCAL_TTS_URL: "Local TTS acceleration unavailable",
  ELEVEN_LABS_API_KEY: "ElevenLabs TTS unavailable",
  RAZORPAY_KEY_ID: "Payments unavailable",
  RAZORPAY_KEY_SECRET: "Payments unavailable",
  RAZORPAY_WEBHOOK_SECRET: "Payment webhook verification disabled",
  AI_INTEGRATIONS_OPENAI_API_KEY: "AI integrations may fall back",
  PLATFORM_SECRET_KEY: "Using SESSION_SECRET for encryption",
  SENTRY_DSN: "Crash monitoring disabled",
  POSTHOG_API_KEY: "Product analytics disabled",
};

const DEPRECATED_VARS: Record<string, string> = {
  TWILIO_ACCOUNT_SID: "Twilio is legacy — not part of primary production path",
  TWILIO_AUTH_TOKEN: "Twilio is legacy — not part of primary production path",
  TWILIO_PHONE_NUMBER: "Twilio is legacy — not part of primary production path",
};

export type EnvironmentValidationStage = "bootstrap" | "runtime";

interface ValidationOptions {
  stage?: EnvironmentValidationStage;
}

function isMockValue(value: string): boolean {
  return MOCK_PATTERNS.some((pattern) => pattern.test(value));
}

function getEnvValue(key: string): string {
  return String(process.env[key] || "").trim();
}

function parseOrigins(rawValue: string): string[] {
  return rawValue
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

function isSecurePublicUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "https:") return false;
    const host = parsed.hostname.toLowerCase();
    return !["localhost", "127.0.0.1", "::1"].includes(host);
  } catch {
    return false;
  }
}

export async function validateEnvironment(options: ValidationOptions = {}) {
  const stage = options.stage ?? "runtime";
  const errors: string[] = [];
  const warnings: string[] = [];

  const isProduction = getEnvValue("NODE_ENV").toLowerCase() === "production";
  const redisUrl = getEnvValue("REDIS_URL");
  const usesInMemoryRedis = redisUrl.startsWith("memory://");
  const appBaseUrl = getEnvValue("APP_BASE_URL");

  // Hard failures — only DB + Redis + Session are unrecoverable
  for (const key of BOOTSTRAP_REQUIRED_VARS) {
    const value = getEnvValue(key);
    if (!value) {
      errors.push(`${key} is missing`);
    } else if (isMockValue(value)) {
      errors.push(`${key} is set to a placeholder/mock value and must be replaced`);
    }
  }

  const sessionSecret = getEnvValue("SESSION_SECRET");
  if (sessionSecret && sessionSecret.length < 32) {
    warnings.push("SESSION_SECRET is too short; use at least 32 random characters");
  }

  if (stage === "bootstrap") {
    if (isProduction && appBaseUrl && !isSecurePublicUrl(appBaseUrl)) {
      warnings.push("APP_BASE_URL should be a public https URL in production");
    }

    if (warnings.length > 0) {
      logger.warn("EnvValidator", `Bootstrap environment warnings:\n  - ${warnings.join("\n  - ")}`);
    }

    if (errors.length > 0) {
      const message = `Critical bootstrap environment errors:\n  - ${errors.join("\n  - ")}`;
      logger.error("EnvValidator", message);
      throw new Error(message);
    }

    logger.info("EnvValidator", "Bootstrap environment validation passed.");
    return { errors, warnings };
  }

  // Production checks — all warnings, never errors (features degrade, server stays up)
  if (isProduction && usesInMemoryRedis) {
    errors.push("REDIS_URL uses the in-memory development shim; production requires a real Redis instance");
  }

  for (const [key, reason] of Object.entries(SERVICE_VARS)) {
    // Skip build-time VITE_ vars entirely at runtime
    if (key.startsWith("VITE_")) continue;

    const value = key === "OPENAI_API_KEY"
      ? (getEnvValue("OPENAI_API_KEY") || getEnvValue("AI_INTEGRATIONS_OPENAI_API_KEY"))
      : getEnvValue(key);

    if (!value) {
      warnings.push(`${key} not set — ${reason}`);
    } else if (isMockValue(value)) {
      warnings.push(`${key} looks like a placeholder — ${reason}`);
    }
  }

  // Razorpay: if key is set, webhook secret must also be set (security invariant)
  const razorpayKeyId = getEnvValue("RAZORPAY_KEY_ID");
  if (razorpayKeyId && !isMockValue(razorpayKeyId)) {
    const webhookSecret = getEnvValue("RAZORPAY_WEBHOOK_SECRET");
    if (!webhookSecret) {
      warnings.push("RAZORPAY_WEBHOOK_SECRET not set — payment webhooks will not be verified");
    }
  }

  for (const [key, note] of Object.entries(DEPRECATED_VARS)) {
    if (getEnvValue(key)) {
      warnings.push(`${key} is deprecated — ${note}`);
    }
  }

  if (warnings.length > 0) {
    logger.warn("EnvValidator", `Environment warnings (${warnings.length} service(s) degraded):\n  - ${warnings.join("\n  - ")}`);
  } else {
    logger.info("EnvValidator", "All environment variables are configured correctly.");
  }

  if (errors.length > 0) {
    const message = `Critical environment errors:\n  - ${errors.join("\n  - ")}`;
    logger.error("EnvValidator", message);
    throw new Error(message);
  }

  return { errors, warnings };
}
