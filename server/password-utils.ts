/**
 * PASSWORD UTILITIES
 * 
 * WHY THIS EXISTS:
 * Secure password hashing and verification using SHA-256 with salt.
 * Used for any password-based authentication in the system.
 * 
 * SECURITY:
 * - Never store plaintext passwords
 * - Use cryptographically secure random salt
 * - SHA-256 for hash generation
 */

import { randomBytes, createHash } from "crypto";

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = createHash("sha256")
    .update(password + salt)
    .digest("hex");
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, storedHash: string): boolean {
  const [salt, hash] = storedHash.split(":");
  if (!salt || !hash) return false;
  const inputHash = createHash("sha256")
    .update(password + salt)
    .digest("hex");
  return inputHash === hash;
}
