/**
 * Business OTP code generation/hashing -- Phase 6 (2026-08-24).
 * Deliberately mirrors server/otp-auth.ts's exact generation/hashing
 * pattern (crypto.randomInt, SHA-256) -- not imported from there since
 * those functions are module-private in that file (platform login OTP is
 * a separate table/system, doc 31 section 2), but the security-relevant
 * primitives are identical, not reinvented or weakened.
 */
import { createHash, randomInt } from "crypto";

const OTP_LENGTH = 6;

/** Cryptographically secure -- crypto.randomInt, never Math.random/timestamps/ids/counters. */
export function generateOtpCode(): string {
  const min = Math.pow(10, OTP_LENGTH - 1);
  const max = Math.pow(10, OTP_LENGTH) - 1;
  return randomInt(min, max + 1).toString();
}

/** The raw code is NEVER stored -- only this hash. */
export function hashOtpCode(code: string): string {
  return createHash("sha256").update(code).digest("hex");
}
