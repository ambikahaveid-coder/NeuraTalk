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

import { randomBytes, createHash, scryptSync, timingSafeEqual } from "crypto";

const PASSWORD_HASH_VERSION = "scrypt";
const SCRYPT_COST = 16_384;
const SCRYPT_BLOCK_SIZE = 8;
const SCRYPT_PARALLELIZATION = 1;
const SCRYPT_KEY_LENGTH = 64;

function deriveScryptHash(password: string, salt: Buffer): Buffer {
  return scryptSync(password, salt, SCRYPT_KEY_LENGTH, {
    N: SCRYPT_COST,
    r: SCRYPT_BLOCK_SIZE,
    p: SCRYPT_PARALLELIZATION,
    maxmem: 64 * 1024 * 1024,
  });
}

export function isPasswordHashSupported(storedHash: string): boolean {
  return storedHash.startsWith(`${PASSWORD_HASH_VERSION}$`) || storedHash.includes(":");
}

export function needsPasswordRehash(storedHash: string): boolean {
  return !storedHash.startsWith(`${PASSWORD_HASH_VERSION}$`);
}

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = deriveScryptHash(password, salt);
  return [
    PASSWORD_HASH_VERSION,
    String(SCRYPT_COST),
    String(SCRYPT_BLOCK_SIZE),
    String(SCRYPT_PARALLELIZATION),
    salt.toString("hex"),
    hash.toString("hex"),
  ].join("$");
}

function verifyScryptPassword(password: string, storedHash: string): boolean {
  const [version, cost, blockSize, parallelization, saltHex, hashHex] = storedHash.split("$");
  if (
    version !== PASSWORD_HASH_VERSION ||
    !cost ||
    !blockSize ||
    !parallelization ||
    !saltHex ||
    !hashHex
  ) {
    return false;
  }

  const salt = Buffer.from(saltHex, "hex");
  const expectedHash = Buffer.from(hashHex, "hex");
  const computedHash = scryptSync(password, salt, expectedHash.length, {
    N: Number.parseInt(cost, 10) || SCRYPT_COST,
    r: Number.parseInt(blockSize, 10) || SCRYPT_BLOCK_SIZE,
    p: Number.parseInt(parallelization, 10) || SCRYPT_PARALLELIZATION,
    maxmem: 64 * 1024 * 1024,
  });

  return computedHash.length === expectedHash.length && timingSafeEqual(computedHash, expectedHash);
}

function verifyLegacySha256Password(password: string, storedHash: string): boolean {
  const [salt, hash] = storedHash.split(":");
  if (!salt || !hash) return false;
  const inputHash = createHash("sha256")
    .update(password + salt)
    .digest("hex");

  const expectedHash = Buffer.from(hash, "hex");
  const computedHash = Buffer.from(inputHash, "hex");
  return computedHash.length === expectedHash.length && timingSafeEqual(computedHash, expectedHash);
}

export function verifyPassword(password: string, storedHash: string): boolean {
  if (storedHash.startsWith(`${PASSWORD_HASH_VERSION}$`)) {
    return verifyScryptPassword(password, storedHash);
  }

  if (storedHash.includes(":")) {
    return verifyLegacySha256Password(password, storedHash);
  }

  return false;
}
