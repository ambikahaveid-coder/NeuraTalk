import crypto from "node:crypto";

const PREFIX = "enc:v1:";
const ALGORITHM = "aes-256-gcm";

function getKey(): Buffer {
  const secret = process.env.PLATFORM_SECRET_KEY || process.env.SESSION_SECRET;
  if (!secret) throw new Error("PLATFORM_SECRET_KEY or SESSION_SECRET is required to protect tenant integration credentials");
  return crypto.scryptSync(secret, "neuratalk-tenant-secrets-v1", 32);
}

export function encryptTenantSecret(value: string | null | undefined): string | null {
  if (value == null || value === "") return null;
  if (value.startsWith(PREFIX)) return value;

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, getKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${iv.toString("base64url")}:${tag.toString("base64url")}:${encrypted.toString("base64url")}`;
}

export function decryptTenantSecret(value: string | null | undefined): string | null {
  if (value == null || value === "") return null;
  // Legacy PBX records were written as plaintext; keep them readable during
  // gradual migration, while every new or changed value is encrypted.
  if (!value.startsWith(PREFIX)) return value;

  const [ivText, tagText, encryptedText] = value.slice(PREFIX.length).split(":");
  if (!ivText || !tagText || !encryptedText) throw new Error("Malformed tenant integration secret");
  const decipher = crypto.createDecipheriv(ALGORITHM, getKey(), Buffer.from(ivText, "base64url"));
  decipher.setAuthTag(Buffer.from(tagText, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(encryptedText, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}
