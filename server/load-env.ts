import fs from "fs";
import path from "path";
import dotenv from "dotenv";

let loaded = false;

const CRITICAL_ENV_KEYS = [
  "DATABASE_URL",
  "REDIS_URL",
  "SESSION_SECRET",
  "LIVEKIT_API_KEY",
  "LIVEKIT_API_SECRET",
  "LIVEKIT_URL",
];
const RUNTIME_PRESERVE_KEYS = [
  "NODE_ENV",
  "PORT",
  "WS_PORT",
  "SIGNALING_PORT",
  "HOST",
];

function normalizeEnvValue(value: string | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function getEnvFilePath(): string {
  return path.resolve(process.cwd(), ".env");
}

function detectCriticalConflicts(parsedEnv: Record<string, string>): string[] {
  const conflicts: string[] = [];

  for (const key of CRITICAL_ENV_KEYS) {
    const processValue = normalizeEnvValue(process.env[key]);
    const fileValue = normalizeEnvValue(parsedEnv[key]);

    if (processValue && fileValue && processValue !== fileValue) {
      conflicts.push(key);
    }
  }

  return conflicts;
}

export function loadEnvironment(): void {
  if (loaded) {
    return;
  }

  const envFilePath = getEnvFilePath();
  const envFileExists = fs.existsSync(envFilePath);
  const explicitOverride = (process.env.DOTENV_OVERRIDE || "").toLowerCase() === "true";
  const explicitAllowConflicts = (process.env.ALLOW_ENV_CONFLICTS || "").toLowerCase() === "true";
  const isProduction = process.env.NODE_ENV === "production";
  const preservedRuntimeValues = new Map(
    RUNTIME_PRESERVE_KEYS
      .map((key) => [key, normalizeEnvValue(process.env[key])] as const)
      .filter(([, value]) => value !== null),
  );

  let parsedEnv: Record<string, string> = {};
  if (envFileExists) {
    parsedEnv = dotenv.parse(fs.readFileSync(envFilePath));
  }

  const conflictingKeys = detectCriticalConflicts(parsedEnv);
  if (conflictingKeys.length > 0 && !explicitOverride && !explicitAllowConflicts) {
    const conflictList = conflictingKeys.join(", ");
    throw new Error(
      `Critical environment conflict detected for ${conflictList}. ` +
      "Refusing to start because inherited process env does not match .env. " +
      "Set DOTENV_OVERRIDE=true to prefer .env or ALLOW_ENV_CONFLICTS=true if this is intentional.",
    );
  }

  dotenv.config({
    override: explicitOverride || (!isProduction && envFileExists),
  });

  for (const [key, value] of Array.from(preservedRuntimeValues.entries())) {
    if (value !== null) {
      process.env[key] = value;
    }
  }

  loaded = true;
}

loadEnvironment();
