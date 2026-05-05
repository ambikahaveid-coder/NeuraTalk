/**
 * OTP AUTHENTICATION SERVICE
 * 
 * WHY THIS EXISTS:
 * OTP-based authentication is more user-friendly than passwords,
 * especially for B2C users and mobile-first experiences.
 * 
 * FEATURES:
 * - Email and mobile OTP support
 * - Dummy OTP mode for testing (configurable by Super Admin)
 * - Rate limiting and attempt tracking
 * - Secure hashing of OTP codes
 */

import { db } from "./db";
import { otpChallenges, users, platformSettings, billingPlans, subscriptions } from "@shared/schema";
import { eq, and, gt, lt } from "drizzle-orm";
import { createHash, randomInt } from "crypto";
import { logger } from "./observability";
import { sendOTP as sendMsg91Otp } from "./msg91-service";
import twilio from "twilio";
import { normalizePhoneNumber } from "@shared/phone";

const twilioClient = process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN 
  ? twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN)
  : null;


// ============================================================================
// CONFIGURATION
// ============================================================================

const OTP_LENGTH = 6;
const OTP_EXPIRY_MINUTES = 10;
const MAX_ATTEMPTS = 3;
const DUMMY_OTP = "123456"; // For testing mode

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

/**
 * Check if dummy OTP mode is enabled
 * PRODUCTION: Defaults to FALSE - must be explicitly enabled by Super Admin
 * Only allows dummy mode if explicitly enabled in database settings
 */
function isTwilioReal(): boolean {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!sid || !token) return false;
  if (sid.startsWith("AC_mock") || token.startsWith("mock_")) return false;
  if (!sid.startsWith("AC") || sid.length !== 34) return false;
  return true;
}

async function isDummyModeEnabled(): Promise<boolean> {
  // PRODUCTION SAFETY: Strictly disable dummy mode in production
  if (process.env.NODE_ENV === "production" || process.env.NODE_ENV === "staging") {
    return false;
  }

  // Explicit dev override: FORCE_DUMMY_OTP=true bypasses Twilio check for local testing
  if (process.env.FORCE_DUMMY_OTP === "true") return true;

  // Never dummy when real Twilio is configured — send real SMS
  if (isTwilioReal()) return false;

  // Explicit env var override
  if (process.env.SEND_REAL_OTP === "true") return false;

  // In development without Twilio, check database setting or default to true
  try {
    const setting = await db.query.platformSettings.findFirst({
      where: eq(platformSettings.key, "dummy_otp_enabled"),
    });
    // If no setting, default to true (dev mode)
    return setting ? setting.value === true : true;
  } catch {
    return true; // Safe default for local dev
  }
}

// ============================================================================
// OTP SERVICE
// ============================================================================

export interface OtpRequestResult {
  success: boolean;
  message: string;
  expiresAt?: Date;
  isDummy?: boolean;
}

export interface OtpVerifyResult {
  success: boolean;
  message: string;
  userId?: number;
  isNewUser?: boolean;
}

/**
 * Request OTP for login/registration
 */
export async function requestOtp(
  identifier: string,
  channel: "email" | "mobile"
): Promise<OtpRequestResult> {
  const finalIdentifier = channel === "mobile" ? normalizePhoneNumber(identifier) : identifier;

  try {
    const isDummy = await isDummyModeEnabled();
    const code = isDummy ? DUMMY_OTP : generateOtpCode();
    const codeHash = hashOtp(code);
    const expiresAt = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000);

    // Delete any existing challenges for this identifier
    await db.delete(otpChallenges).where(
      and(
        eq(otpChallenges.identifier, finalIdentifier),
        eq(otpChallenges.channel, channel)
      )
    );

    // Create new challenge
    await db.insert(otpChallenges).values({
      identifier: finalIdentifier,
      channel,
      codeHash,
      isDummy,
      expiresAt,
    });

    // In production, send OTP via email/SMS
    if (!isDummy) {
      await sendOtp(identifier, channel, code);
    }

    logger.info("OtpAuth", `OTP requested for ${channel}`, {
      identifier: maskIdentifier(finalIdentifier),
      isDummy,
    });

    return {
      success: true,
      message: isDummy
        ? `Test mode: Use code ${DUMMY_OTP}`
        : `OTP sent to your ${channel} (${finalIdentifier})`,
      expiresAt,
      isDummy,
    };
  } catch (error) {
    logger.error("OtpAuth", "Failed to request OTP", error as Error);
    return {
      success: false,
      message: "Failed to send OTP. Please try again.",
    };
  }
}

/**
 * Verify OTP and authenticate user
 */
export async function verifyOtp(
  identifier: string,
  channel: "email" | "mobile",
  code: string
): Promise<OtpVerifyResult> {
  const finalIdentifier = channel === "mobile" ? normalizePhoneNumber(identifier) : identifier;

  try {
    // Find valid challenge
    const challenge = await db.query.otpChallenges.findFirst({
      where: and(
        eq(otpChallenges.identifier, finalIdentifier),
        eq(otpChallenges.channel, channel),
        gt(otpChallenges.expiresAt, new Date())
      ),
    });

    if (!challenge) {
      return {
        success: false,
        message: "OTP expired or not found. Please request a new one.",
      };
    }

    // Check attempts
    if (challenge.attempts && challenge.attempts >= MAX_ATTEMPTS) {
      return {
        success: false,
        message: "Too many attempts. Please request a new OTP.",
      };
    }

    // Verify code
    const codeHash = hashOtp(code);
    if (codeHash !== challenge.codeHash) {
      // Increment attempts
      await db
        .update(otpChallenges)
        .set({ attempts: (challenge.attempts || 0) + 1 })
        .where(eq(otpChallenges.id, challenge.id));

      return {
        success: false,
        message: "Invalid OTP. Please check and try again.",
      };
    }

    // Mark as verified
    await db
      .update(otpChallenges)
      .set({ verifiedAt: new Date() })
      .where(eq(otpChallenges.id, challenge.id));

    // ARCHITECT FIX: Programmatically verify the number as a valid Caller ID in Twilio
    // This allows the "Transparent Bridge" where the user's own number is displayed
    if (channel === "mobile" && twilioClient) {
      try {
        await twilioClient.validationRequests.create({
          friendlyName: `Verified_User_${finalIdentifier}`,
          phoneNumber: finalIdentifier,
        });
        logger.info("OtpAuth", "Twilio Caller ID verification requested", { identifier: finalIdentifier });
      } catch (err) {
        // If already verified, Twilio might throw error, we ignore it
        logger.debug("OtpAuth", "Twilio Caller ID auto-verification skipped or already done");
      }
    }

    // Find or create user
    const { userId, isNewUser } = await findOrCreateUser(finalIdentifier, channel);

    logger.info("OtpAuth", `OTP verified for ${channel}`, {
      identifier: maskIdentifier(finalIdentifier),
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
    return {
      success: false,
      message: "Verification failed. Please try again.",
    };
  }
}

// ============================================================================
// USER MANAGEMENT
// ============================================================================

async function findOrCreateUser(
  identifier: string,
  channel: "email" | "mobile"
): Promise<{ userId: number; isNewUser: boolean }> {
  // Check if user exists
  const whereClause = channel === "email"
    ? eq(users.email, identifier)
    : eq(users.phone, identifier);

  const existingUser = await db.query.users.findFirst({
    where: whereClause,
  });

  if (existingUser) {
    // Update last login and verification status
    await db
      .update(users)
      .set({
        lastLoginAt: new Date(),
        ...(channel === "email" ? { emailVerified: true } : { phoneVerified: true }),
      })
      .where(eq(users.id, existingUser.id));

    return { userId: existingUser.id, isNewUser: false };
  }

  // Create new user
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

  // Auto-assign free trial subscription for new OTP users
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
  } catch { /* non-fatal */ }

  return { userId: newUser.id, isNewUser: true };
}

function generateUsername(identifier: string): string {
  const prefix = identifier.includes("@")
    ? identifier.split("@")[0]
    : `user${identifier.slice(-4)}`;
  const suffix = Date.now().toString(36).slice(-4);
  return `${prefix}_${suffix}`;
}

// Initialize Twilio for production
const getTwilioClient = () => {
  if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN) {
    return twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
  }
  return null;
};

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

async function sendOtpEmail(identifier: string, message: string, code: string): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.OTP_EMAIL_FROM || process.env.RESEND_FROM_EMAIL;
  if (!apiKey || !from) {
    logger.error("OtpAuth", "Email delivery failed: RESEND_API_KEY/OTP_EMAIL_FROM not configured");
    throw new Error("Email delivery failed: email provider not configured");
  }

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
          <p style="margin:0">If you did not request this code, you can ignore this email.</p>
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
// OTP DELIVERY SYSTEM (PRODUCTION GRADE)
// ============================================================================

async function sendOtp(
  identifier: string,
  channel: "email" | "mobile",
  code: string
): Promise<void> {
  const message = `Your NeuraTalk verification code is: ${code}. Valid for ${OTP_EXPIRY_MINUTES} minutes.`;

  if (channel === "mobile") {
    const normalizedNumber = normalizePhoneNumber(identifier);

    if (isMsg91Configured()) {
      try {
        await sendMsg91Otp(
          normalizedNumber.replace(/^\+/, ""),
          code,
          process.env.MSG91_OTP_TEMPLATE_ID,
        );
        logger.info("OtpAuth", "SMS OTP delivered via MSG91", {
          identifier: maskIdentifier(normalizedNumber),
        });
        return;
      } catch (err: any) {
        logger.error("OtpAuth", "MSG91 SMS delivery failed", err as Error);
        throw new Error(`Failed to send SMS: ${err?.message || "MSG91 delivery failed"}`);
      }
    }

    const client = getTwilioClient();
    if (!client || !process.env.TWILIO_PHONE_NUMBER) {
      logger.error("OtpAuth", "SMS delivery failed: MSG91/Twilio not configured");
      throw new Error("SMS delivery failed: SMS provider not configured");
    }

    const toNumber = normalizedNumber;
    try {
      await client.messages.create({
        body: message,
        from: process.env.TWILIO_PHONE_NUMBER,
        to: normalizedNumber,
      });
      logger.info("OtpAuth", "SMS OTP delivered via Twilio", { identifier: maskIdentifier(normalizedNumber) });
    } catch (err: any) {
      // Twilio trial accounts can only send to verified numbers
      // Error 21219 = unverified number on trial account
      if (err?.code === 21219 || err?.code === 21608) {
        logger.warn("OtpAuth", `Twilio trial restriction: ${toNumber} is not a verified number. Verify it at console.twilio.com/phone-numbers/verified`);
        throw new Error(`Cannot send SMS to ${toNumber} — Twilio trial accounts can only send to verified numbers. Please verify this number at console.twilio.com or upgrade your Twilio account.`);
      }
      logger.error("OtpAuth", "Twilio SMS delivery failed", err as Error);
      throw new Error(`Failed to send SMS: ${err?.message || "Unknown error"}`);
    }
  } else {
    await sendOtpEmail(identifier, message, code);
    return;

    // Implement Email delivery (e.g., using Nodemailer or SendGrid)
    logger.info("OtpAuth", "Email OTP delivery requested (Log only in current version)", { identifier: maskIdentifier(identifier) });
    
    // PRODUCTION TEMPLATE:
    // await sendEmail({
    //   to: identifier,
    //   subject: "NeuraTalk Verification Code",
    //   text: message,
    //   html: `<b>${message}</b>`
    // });
  }
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

// ============================================================================
// SUPER ADMIN CONTROLS
// ============================================================================

/**
 * Enable or disable dummy OTP mode (Super Admin only)
 */
export async function setDummyOtpMode(
  enabled: boolean,
  updatedBy: number
): Promise<void> {
  await db
    .insert(platformSettings)
    .values({
      key: "dummy_otp_enabled",
      value: enabled,
      description: "Enable dummy OTP (123456) for testing",
      updatedBy,
    })
    .onConflictDoUpdate({
      target: platformSettings.key,
      set: {
        value: enabled,
        updatedBy,
        updatedAt: new Date(),
      },
    });

  logger.info("OtpAuth", `Dummy OTP mode ${enabled ? "enabled" : "disabled"}`, {
    updatedBy,
  });
}

/**
 * Clean up expired OTP challenges
 */
export async function cleanupExpiredChallenges(): Promise<number> {
  await db
    .delete(otpChallenges)
    .where(lt(otpChallenges.expiresAt, new Date()));
  
  return 0; // Drizzle doesn't return count for delete
}
