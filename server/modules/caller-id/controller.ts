import type { Request, Response } from "express";
import { eq } from "drizzle-orm";
import { storage } from "../../storage";
import { logger } from "../../observability";
import { db } from "../../db";
import {
  requestCallerIdVerification,
  confirmCallerIdVerification,
  getCallForwardingInstructions,
} from "../../msg91-service";
import { getRedisClient } from "../../redis";
import * as callsSvc from "../calls/service";
import { routeToSkillAgent } from "../calls/smart-router";
import { orgDIDNumbers } from "@shared/schema";
import { getPSTNProvider } from "../../pstn/registry";

// In-memory fallback for verification IDs (Redis preferred when available)
const pendingVerifications = new Map<number, { verificationId: string; expiresAt: number }>();

function storeVerificationId(userId: number, verificationId: string): void {
  pendingVerifications.set(userId, {
    verificationId,
    expiresAt: Date.now() + 10 * 60 * 1000, // 10 minutes
  });

  getRedisClient()
    .set(`caller_id_verify:${userId}`, verificationId, "EX", 600)
    .catch(() => undefined);
}

async function getVerificationId(userId: number): Promise<string | null> {
  const val = await getRedisClient().get(`caller_id_verify:${userId}`).catch(() => null);
  if (val) return val;

  const entry = pendingVerifications.get(userId);
  if (!entry || entry.expiresAt < Date.now()) {
    pendingVerifications.delete(userId);
    return null;
  }
  return entry.verificationId;
}

function clearVerificationId(userId: number): void {
  pendingVerifications.delete(userId);
  getRedisClient().del(`caller_id_verify:${userId}`).catch(() => undefined);
}

export async function requestVerification(req: Request, res: Response) {
  const user = req.user!;
  const phone = (user as any).phone as string | undefined;

  if (!phone) {
    return res.status(400).json({
      error: "Profile lo phone number add cheyyi first (Settings → Profile)",
    });
  }

  if (!process.env.MSG91_AUTH_KEY) {
    return res.status(503).json({
      error: "MSG91 not configured — set MSG91_AUTH_KEY in server environment",
    });
  }

  try {
    const { verificationId } = await requestCallerIdVerification(phone);
    storeVerificationId(user.id, verificationId);
    logger.info("CallerID", `OTP requested for user ${user.id} → ${phone}`);
    res.json({ success: true, message: `OTP sent to ${phone}` });
  } catch (e: any) {
    logger.error("CallerID", `OTP request failed for user ${user.id}: ${e.message}`);
    res.status(500).json({ error: e.message || "Failed to send OTP" });
  }
}

export async function confirmVerification(req: Request, res: Response) {
  const { otp } = req.body as { otp?: string };
  if (!otp || otp.trim().length === 0) {
    return res.status(400).json({ error: "OTP required" });
  }

  const user = req.user!;
  const verificationId = await getVerificationId(user.id);
  if (!verificationId) {
    return res.status(400).json({
      error: "OTP expired or not requested — click 'Send OTP' again",
    });
  }

  try {
    const result = await confirmCallerIdVerification(verificationId, otp.trim());
    if (!result.verified) {
      return res.status(400).json({ error: "Incorrect OTP — try again" });
    }

    await storage.updateUser(user.id, {
      callerIdVerified: true,
      callerIdVerifiedAt: new Date(),
    });
    clearVerificationId(user.id);

    logger.info("CallerID", `Number verified for user ${user.id}`);
    res.json({
      success: true,
      message: "Number ownership verified. Caller identity eligibility is updated, but final PSTN number display remains provider/compliance dependent.",
    });
  } catch (e: any) {
    logger.error("CallerID", `OTP confirm failed for user ${user.id}: ${e.message}`);
    res.status(500).json({ error: e.message || "Verification failed" });
  }
}

export async function getStatus(req: Request, res: Response) {
  const user = req.user!;
  const phone = (user as any).phone as string | null | undefined;
  const phoneVerified = (user as any).phoneVerified as boolean | undefined;
  const callerIdVerified = (user as any).callerIdVerified as boolean | undefined;
  const callerIdVerifiedAt = (user as any).callerIdVerifiedAt as Date | string | null | undefined;
  const inboundNumber = process.env.NEURATALK_INBOUND_NUMBER || null;

  res.json({
    phone: phone || null,
    phoneVerified: !!phoneVerified,
    callerIdVerified: !!callerIdVerified,
    callerIdVerifiedAt: callerIdVerifiedAt || null,
    inboundNumber,
    forwardingInstructions: inboundNumber
      ? getCallForwardingInstructions(inboundNumber)
      : null,
    msg91Configured: !!process.env.MSG91_AUTH_KEY,
  });
}

/**
 * MSG91 inbound call webhook.
 * Handles two scenarios:
 *   1. B2C SIM forwarding: friend calls user's SIM → NeuraTalk inbound number
 *   2. B2B org DID: customer calls company's DID → skill-based routing + optional IVR
 *
 * MSG91 body: from, to (DID called), divertedFrom/forwarded_from, call_id/uuid
 */
export async function inboundCallWebhook(req: Request, res: Response) {
  const rawBody = req.rawBody instanceof Buffer ? req.rawBody.toString("utf8") : JSON.stringify(req.body ?? {});
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(req.headers)) {
    if (typeof v === "string") headers[k] = v;
    else if (Array.isArray(v)) headers[k] = v[0] || "";
  }
  if (!getPSTNProvider().verifyWebhookSignature(rawBody, headers)) {
    logger.warn("InboundCall", "Webhook signature verification failed — rejecting");
    return res.status(403).json({ status: "error", error: "invalid_signature" });
  }

  const body = req.body as Record<string, any>;

  const from = String(
    body.from || body.caller || body.callerNumber || body.caller_number || "",
  ).trim();

  const toDID = String(
    body.to || body.callee || body.called || body.destination || "",
  ).trim();

  const divertedFrom = String(
    body.divertedFrom ||
    body.diverted_from ||
    body.forwardedFrom ||
    body.forwarded_from ||
    body.originalNumber ||
    body.original_number ||
    "",
  ).trim();

  const providerCallId = String(body.call_id || body.callId || body.uuid || "").trim();
  const digit = String(body.digit || body.dtmf || "").trim(); // IVR key press

  logger.info("InboundCall", `webhook from=${from} to=${toDID} divertedFrom=${divertedFrom} callId=${providerCallId} digit=${digit}`);

  if (!from) {
    return res.status(400).json({ status: "error", error: "Missing caller number" });
  }

  // ── B2B org DID lookup ──────────────────────────────────────────────────────
  if (toDID) {
    const [did] = await db.select().from(orgDIDNumbers)
      .where(eq(orgDIDNumbers.phoneNumber, toDID))
      .limit(1)
      .catch(() => []);

    if (did && did.isActive && (did.type === "inbound" || did.type === "both")) {
      const orgId = did.organizationId;
      const ivrCfg = (did.ivrConfig as Record<string, any>) ?? {};

      // IVR: if enabled and no digit yet, return IVR menu prompt
      if (did.ivrEnabled && !digit) {
        const greeting = ivrCfg.greeting || "Welcome. Press 1 for Sales, 2 for Support.";
        logger.info("InboundCall", `IVR menu shown for org ${orgId}, DID ${toDID}`);
        return res.json({
          status: "ivr",
          ivr: { greeting, collectDigit: true, timeoutSeconds: 10 },
        });
      }

      // IVR digit received — map to required skill
      let requiredSkills: string[] = [];
      if (did.ivrEnabled && digit && Array.isArray(ivrCfg.menuOptions)) {
        const match = (ivrCfg.menuOptions as Array<{ digit: string; targetSkill?: string }>)
          .find((o) => o.digit === digit);
        if (match?.targetSkill) requiredSkills = [match.targetSkill];
      }

      // Skill-based routing: find best available agent
      const agentUserId = await routeToSkillAgent(orgId, requiredSkills).catch(() => null);

      if (!agentUserId) {
        logger.warn("InboundCall", `No available agent for org ${orgId}, skills=${JSON.stringify(requiredSkills)}`);
        return res.json({ status: "no_agent_available" });
      }

      try {
        const result = await callsSvc.initiateCall({
          callerId: `pstn:${from}`,
          callerNumber: from,
          callerDisplayName: from,
          calleeIdentifier: agentUserId,
          callType: "voice",
          transportPreference: "app_to_app",
          sessionIdOverride: providerCallId ? `call_inb_${providerCallId}` : undefined,
          organizationIdOverride: orgId,
        });

        logger.info("InboundCall", `B2B call routed to agent ${agentUserId} for org ${orgId}, callId=${result.callId}`);
        return res.json({ status: "routed", callId: result.callId, agentUserId });
      } catch (e: any) {
        logger.error("InboundCall", `B2B routing failed org=${orgId} agent=${agentUserId}: ${e.message}`);
        return res.json({ status: "error", error: e.message });
      }
    }
  }

  // ── B2C SIM forwarding: find user by their original SIM number ──────────────
  let targetUser: any = null;
  if (divertedFrom) {
    targetUser = await storage.getUserByPhone(divertedFrom).catch(() => null);
  }
  if (!targetUser && body.metadata?.userId) {
    targetUser = await storage.getUser(Number(body.metadata.userId)).catch(() => null);
  }

  if (!targetUser) {
    logger.warn("InboundCall", `No user found for divertedFrom=${divertedFrom} toDID=${toDID} — call from ${from} dropped`);
    return res.json({ status: "no_user_found" });
  }

  try {
    const result = await callsSvc.initiateCall({
      callerId: `pstn:${from}`,
      callerNumber: from,
      callerDisplayName: from,
      calleeIdentifier: String(targetUser.id),
      callType: "voice",
      transportPreference: "app_to_app",
      sessionIdOverride: providerCallId ? `call_inb_${providerCallId}` : undefined,
    });

    logger.info("InboundCall", `B2C queued for user ${targetUser.id}, callId=${result.callId}`);
    res.json({ status: "queued", callId: result.callId });
  } catch (e: any) {
    logger.error("InboundCall", `B2C queue failed for user ${targetUser.id}: ${e.message}`);
    res.json({ status: "error", error: e.message });
  }
}
