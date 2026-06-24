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

const BOOTSTRAP_REQUIRED_VARS = ["DATABASE_URL", "REDIS_URL", "SESSION_SECRET"];

const PRODUCTION_REQUIRED_VARS: Record<string, string> = {
  AZURE_SPEECH_KEY: "Streaming TTS is required for production voice paths",
  AZURE_SPEECH_REGION: "Azure speech region must be explicitly configured",
  LIVEKIT_URL: "Realtime media transport depends on LiveKit",
  LIVEKIT_API_KEY: "LiveKit token issuance depends on this key",
  LIVEKIT_API_SECRET: "LiveKit token issuance depends on this secret",
  OPENAI_API_KEY: "Core realtime translation paths depend on OpenAI",
  APP_BASE_URL: "External callbacks and provider webhooks require a stable public base URL",
  FIREBASE_SERVICE_ACCOUNT_JSON: "Firebase Phone Auth is the sole mobile OTP method — Admin SDK must be able to verify tokens",
};


const IMPORTANT_VARS: Record<string, string> = {
  VITE_FIREBASE_API_KEY: "Firebase client SDK cannot initialize without this (build-time var)",
  VITE_FIREBASE_PROJECT_ID: "Firebase client SDK needs the project ID (build-time var)",
  VITE_FIREBASE_APP_ID: "Firebase client SDK needs the app ID (build-time var)",
  STT_PROVIDER: "STT provider not set — defaulting to azure",
  MSG91_AUTH_KEY: "Outbound PSTN calls to phones remain unavailable",
  MSG91_VOICE_CALLER_ID: "Verified PSTN caller identity will be unavailable",
  MSG91_WEBHOOK_SECRET: "Inbound telephony webhooks will not be authenticated",
  LOCAL_WHISPER_URL: "Local STT acceleration is unavailable",
  LOCAL_TRANSLATION_URL: "Local translation acceleration is unavailable",
  LOCAL_TTS_URL: "Local TTS acceleration is unavailable",
  ELEVEN_LABS_API_KEY: "Premium TTS fallback is unavailable",
  RAZORPAY_KEY_ID: "Payments are unavailable",
  RAZORPAY_KEY_SECRET: "Payments are unavailable",
  RAZORPAY_WEBHOOK_SECRET: "Payment webhook authenticity cannot be verified",
  AI_INTEGRATIONS_OPENAI_API_KEY: "Some AI integration paths will fall back or fail",
  PLATFORM_SECRET_KEY: "Database-stored secrets will be encrypted with SESSION_SECRET instead",
  SENTRY_DSN: "Crash monitoring is disabled",
  POSTHOG_API_KEY: "Product analytics and QoS instrumentation are disabled",
};

const DEPRECATED_VARS: Record<string, string> = {
  TWILIO_ACCOUNT_SID: "Twilio is legacy here and should not be part of the primary production path",
  TWILIO_AUTH_TOKEN: "Twilio is legacy here and should not be part of the primary production path",
  TWILIO_PHONE_NUMBER: "Twilio is legacy here and should not be part of the primary production path",
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
    if (parsed.protocol !== "https:") {
      return false;
    }

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
  const frontendUrl = getEnvValue("FRONTEND_URL");
  const allowedOrigins = parseOrigins(getEnvValue("ALLOWED_ORIGINS"));

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

  const platformSecretKey = getEnvValue("PLATFORM_SECRET_KEY");
  if (platformSecretKey && platformSecretKey.length < 32) {
    warnings.push("PLATFORM_SECRET_KEY is too short; use at least 32 random characters");
  }

  if (stage === "bootstrap") {
    if (isProduction && appBaseUrl && !isSecurePublicUrl(appBaseUrl)) {
      errors.push("APP_BASE_URL must be a public https URL in production");
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

  if (isProduction) {
    if (usesInMemoryRedis) {
      errors.push("REDIS_URL uses the in-memory development shim; production requires a real Redis instance");
    }

    for (const [key, reason] of Object.entries(PRODUCTION_REQUIRED_VARS)) {
      const value = key === "OPENAI_API_KEY"
        ? (getEnvValue("OPENAI_API_KEY") || getEnvValue("AI_INTEGRATIONS_OPENAI_API_KEY"))
        : getEnvValue(key);

      if (!value) {
        errors.push(`${key} is missing - ${reason}`);
      } else if (isMockValue(value)) {
        errors.push(`${key} is using a placeholder value - ${reason}`);
      }
    }

    // If Razorpay is configured, webhook secret is required — without it any POST to the webhook
    // URL bypasses signature verification and can fraudulently provision subscriptions/wallet credits
    const razorpayKeyId = getEnvValue("RAZORPAY_KEY_ID");
    if (razorpayKeyId && !isMockValue(razorpayKeyId)) {
      const webhookSecret = getEnvValue("RAZORPAY_WEBHOOK_SECRET");
      if (!webhookSecret) {
        errors.push("RAZORPAY_WEBHOOK_SECRET is missing — required when RAZORPAY_KEY_ID is set to prevent unauthenticated payment webhooks");
      } else if (isMockValue(webhookSecret)) {
        errors.push("RAZORPAY_WEBHOOK_SECRET is using a placeholder value");
      }
    }

    if (appBaseUrl && !isSecurePublicUrl(appBaseUrl)) {
      errors.push("APP_BASE_URL must be a public https URL in production");
    }

    if (frontendUrl && !isSecurePublicUrl(frontendUrl)) {
      errors.push("FRONTEND_URL must be a public https URL in production");
    }

    const invalidOrigins = allowedOrigins.filter((origin) => !isSecurePublicUrl(origin));
    if (invalidOrigins.length > 0) {
      errors.push(`ALLOWED_ORIGINS contains non-production origins: ${invalidOrigins.join(", ")}`);
    }
  } else if (usesInMemoryRedis) {
    warnings.push("In-memory Redis shim is active; do not use this mode outside local development");
  }

  for (const [key, reason] of Object.entries(IMPORTANT_VARS)) {
    const value = getEnvValue(key);
    if (!value) {
      warnings.push(`${key} not set - ${reason}`);
    } else if (isMockValue(value)) {
      warnings.push(`${key} looks like a placeholder - ${reason}`);
    }
  }

  for (const [key, note] of Object.entries(DEPRECATED_VARS)) {
    if (getEnvValue(key)) {
      warnings.push(`${key} is deprecated - ${note}`);
    }
  }

  if (getEnvValue("ENABLE_LEGACY_TWILIO_BRIDGE").toLowerCase() === "true") {
    warnings.push("ENABLE_LEGACY_TWILIO_BRIDGE=true keeps a legacy call path enabled");
  }

  if (appBaseUrl && !/^https?:\/\//i.test(appBaseUrl)) {
    warnings.push("APP_BASE_URL should be an absolute URL");
  }

  if (warnings.length > 0) {
    logger.warn("EnvValidator", `Environment warnings:\n  - ${warnings.join("\n  - ")}`);
  }

  if (errors.length > 0) {
    const message = `Critical environment errors:\n  - ${errors.join("\n  - ")}`;
    logger.error("EnvValidator", message);
    throw new Error(message);
  }

  if (warnings.length === 0) {
    logger.info("EnvValidator", "All environment variables are configured correctly.");
  }

  return { errors, warnings };
}
