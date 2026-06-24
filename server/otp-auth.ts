/**
 * OTP AUTHENTICATION SERVICE
 *
 * Handles OTP for EMAIL channel only.
 * MOBILE (phone) authentication is handled exclusively by Firebase Phone Auth.
 * Any call to requestOtp / verifyOtp with channel="mobile" is rejected.
 */

import { db } from "./db";
import { otpChallenges, users, billingPlans, subscriptions } from "@shared/schema";
import { eq, and, gt, lt } from "drizzle-orm";
import { createHash, randomInt } from "crypto";
import { logger } from "./observability";
import { sendOTP as sendMsg91Otp } from "./msg91-service";
import { normalizePhoneNumber } from "@shared/phone";

// ============================================================================
// CONFIGURATION
// ============================================================================

const OTP_LENGTH = 6;
const OTP_EXPIRY_MINUTES = 10;
const MAX_ATTEMPTS = 3;

const FIREBASE_MOBILE_ERROR =
  "Phone authentication requires Firebase Phone Auth. " +
  "Use the client-side Firebase OTP flow and submit the resulting ID token to /api/auth/firebase-verify.";

// ============================================================================
// OTP GENERATION & VERIFICATION
// ============================================================================

function generateOtpCode(): string {
  const min = Math.pow(10, OTP_LENGTH - 1);
  const max = Math.pow(10, OTP_LENGTH) - 1;
  return randomInt(min, max + 1).toString();
}

function hashOtp(code: string): string {
  return createHash("sha256").update(code).digest("hex");
}

// ============================================================================
// OTP SERVICE
// ============================================================================

export interface OtpRequestResult {
  success: boolean;
  message: string;
  expiresAt?: Date;
}

export interface OtpVerifyResult {
  success: boolean;
  message: string;
  userId?: number;
  isNewUser?: boolean;
}

/**
 * Request OTP for login/registration.
 * EMAIL channel only — mobile channel is always rejected (use Firebase).
 */
export async function requestOtp(
  identifier: string,
  channel: "email" | "mobile",
): Promise<OtpRequestResult> {
  if (channel === "mobile") {
    logger.warn("OtpAuth", "requestOtp called for mobile channel — rejected. Use Firebase Phone Auth.", {
      identifier: maskIdentifier(identifier),
    });
    return { success: false, message: FIREBASE_MOBILE_ERROR };
  }

  try {
    const code = generateOtpCode();
    const codeHash = hashOtp(code);
    const expiresAt = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000);

    // Delete any existing challenges for this identifier
    await db.delete(otpChallenges).where(
      and(
        eq(otpChallenges.identifier, identifier),
        eq(otpChallenges.channel, channel),
      ),
    );

    // Create new challenge
    await db.insert(otpChallenges).values({
      identifier,
      channel,
      codeHash,
      isDummy: false,
      expiresAt,
    });

    await sendOtpEmail(identifier, code);

    logger.info("OtpAuth", "Email OTP requested", {
      identifier: maskIdentifier(identifier),
    });

    return {
      success: true,
      message: `OTP sent to your email (${maskIdentifier(identifier)})`,
      expiresAt,
    };
  } catch (error) {
    logger.error("OtpAuth", "Failed to request OTP", error as Error);
    return { success: false, message: "Failed to send OTP. Please try again." };
  }
}

/**
 * Verify OTP for login/registration.
 * EMAIL channel only — mobile channel is always rejected (use Firebase).
 */
export async function verifyOtp(
  identifier: string,
  channel: "email" | "mobile",
  code: string,
): Promise<OtpVerifyResult> {
  if (channel === "mobile") {
    logger.warn("OtpAuth", "verifyOtp called for mobile channel — rejected. Use Firebase Phone Auth.", {
      identifier: maskIdentifier(identifier),
    });
    return { success: false, message: FIREBASE_MOBILE_ERROR };
  }

  try {
    const challenge = await db.query.otpChallenges.findFirst({
      where: and(
        eq(otpChallenges.identifier, identifier),
        eq(otpChallenges.channel, channel),
        gt(otpChallenges.expiresAt, new Date()),
      ),
    });

    if (!challenge) {
      return { success: false, message: "OTP expired or not found. Please request a new one." };
    }

    if (challenge.attempts && challenge.attempts >= MAX_ATTEMPTS) {
      return { success: false, message: "Too many attempts. Please request a new OTP." };
    }

    const codeHash = hashOtp(code);
    if (codeHash !== challenge.codeHash) {
      await db
        .update(otpChallenges)
        .set({ attempts: (challenge.attempts || 0) + 1 })
        .where(eq(otpChallenges.id, challenge.id));

      return { success: false, message: "Invalid OTP. Please check and try again." };
    }

    await db
      .update(otpChallenges)
      .set({ verifiedAt: new Date() })
      .where(eq(otpChallenges.id, challenge.id));

    const { userId, isNewUser } = await findOrCreateUser(identifier, channel);

    logger.info("OtpAuth", "Email OTP verified", {
      identifier: maskIdentifier(identifier),
      userId,
      isNewUser,
    });

    return {
      success: true,
      message: isNewUser ? "Account created successfully" : "Login successful",
      userId,
      isNewUser,
    };
  } catch (error) {
    logger.error("OtpAuth", "Failed to verify OTP", error as Error);
    return { success: false, message: "Verification failed. Please try again." };
  }
}

// ============================================================================
// USER MANAGEMENT
// ============================================================================

async function findOrCreateUser(
  identifier: string,
  channel: "email" | "mobile",
): Promise<{ userId: number; isNewUser: boolean }> {
  const whereClause = channel === "email"
    ? eq(users.email, identifier)
    : eq(users.phone, identifier);

  const existingUser = await db.query.users.findFirst({ where: whereClause });

  if (existingUser) {
    await db
      .update(users)
      .set({
        lastLoginAt: new Date(),
        ...(channel === "email" ? { emailVerified: true } : { phoneVerified: true }),
      })
      .where(eq(users.id, existingUser.id));

    return { userId: existingUser.id, isNewUser: false };
  }

  const username = generateUsername(identifier);
  const [newUser] = await db
    .insert(users)
    .values({
      username,
      email: channel === "email" ? identifier : null,
      phone: channel === "mobile" ? identifier : null,
      role: "consumer",
      emailVerified: channel === "email",
      phoneVerified: channel === "mobile",
      lastLoginAt: new Date(),
    })
    .returning();

  try {
    const [freePlan] = await db.select().from(billingPlans).where(eq(billingPlans.priceInPaise, 0)).limit(1);
    if (freePlan) {
      const now = new Date();
      const trialEnd = new Date(now.getTime() + (freePlan.durationDays || 7) * 24 * 60 * 60 * 1000);
      await db.insert(subscriptions).values({
        userId: newUser.id,
        planId: freePlan.id,
        status: "active",
        billingModel: "prepaid",
        startDate: now,
        endDate: trialEnd,
        minutesUsed: 0,
        minutesRemaining: freePlan.includedMinutes || 30,
        autoRenew: false,
      });
    }
  } catch (err) {
    logger.warn("OtpAuth", "Failed to assign free trial to new user", { userId: newUser.id });
  }

  return { userId: newUser.id, isNewUser: true };
}

function generateUsername(identifier: string): string {
  const prefix = identifier.includes("@")
    ? identifier.split("@")[0]
    : `user${identifier.slice(-4)}`;
  const suffix = Date.now().toString(36).slice(-4);
  return `${prefix}_${suffix}`;
}

function isMsg91Configured(): boolean {
  return typeof process.env.MSG91_AUTH_KEY === "string" && process.env.MSG91_AUTH_KEY.trim().length > 0;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// ============================================================================
// OTP DELIVERY — EMAIL ONLY
// ============================================================================

async function sendOtpEmail(identifier: string, code: string): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.OTP_EMAIL_FROM || process.env.RESEND_FROM_EMAIL;
  if (!apiKey || !from) {
    logger.error("OtpAuth", "Email delivery failed: RESEND_API_KEY/OTP_EMAIL_FROM not configured");
    throw new Error("Email delivery failed: email provider not configured");
  }

  const message = `Your NeuraTalk verification code is: ${code}. Valid for ${OTP_EXPIRY_MINUTES} minutes.`;

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [identifier],
      subject: "NeuraTalk verification code",
      text: message,
      html: `
        <div style="font-family:Arial,sans-serif;line-height:1.5;color:#111827">
          <h2 style="margin:0 0 12px">NeuraTalk verification code</h2>
          <p style="margin:0 0 12px">${escapeHtml(message)}</p>
          <p style="margin:0 0 12px">Code: <strong>${escapeHtml(code)}</strong></p>
          <p style="margin:0">If you did not request this code, ignore this email.</p>
        </div>
      `,
    }),
  });

  if (!response.ok) {
    const responseText = await response.text().catch(() => "");
    logger.error("OtpAuth", `Resend email delivery failed: ${response.status} ${responseText}`);
    throw new Error(`Email delivery failed: ${response.status}`);
  }

  logger.info("OtpAuth", "Email OTP delivered via Resend", {
    identifier: maskIdentifier(identifier),
  });
}

// ============================================================================
// HELPERS
// ============================================================================

function maskIdentifier(identifier: string): string {
  if (identifier.includes("@")) {
    const [local, domain] = identifier.split("@");
    return `${local.slice(0, 2)}***@${domain}`;
  }
  return `***${identifier.slice(-4)}`;
}

/**
 * Clean up expired OTP challenges (called by scheduled cleanup job)
 */
export async function cleanupExpiredChallenges(): Promise<number> {
  await db.delete(otpChallenges).where(lt(otpChallenges.expiresAt, new Date()));
  return 0;
}
