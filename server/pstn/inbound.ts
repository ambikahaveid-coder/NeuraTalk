/**
 * PSTN Inbound Handler
 *
 * Handles the Mobile → NeuraTalk call path:
 *   Mobile Phone → PSTN Provider → Webhook → Backend → LiveKit Room → NeuraTalk User
 *
 * Flow:
 *   1. Provider calls POST /api/pstn/inbound (or provider-specific webhook)
 *   2. parseInboundWebhook() normalises the payload
 *   3. resolveTarget() finds the NeuraTalk user who owns that DID
 *   4. createCallRoom() creates a LiveKit room
 *   5. buildInboundAcceptResponse() tells the provider to bridge PSTN audio → SIP
 *   6. Push notification wakes the target user's app
 *   7. Status webhooks update call state via updateSmartCallStatus()
 */

import { randomUUID } from "node:crypto";
import { getPSTNProvider } from "./registry";
import { createCallRoom, issueAccessToken, issueBotToken } from "../livekit-service";
import { BillingEngine } from "../billing-engine";
import { initCallLanguageTracking } from "../universal-language-runtime";
import { storage } from "../storage";
import { getRedisClient } from "../redis";
import { logger } from "../observability";
import {
  storeInboundCall,
  getInboundCallByDID,
  type InboundCallRecord,
} from "./inbound-store";
import type { PSTNInboundEvent } from "./provider";

const APP_BASE_URL = () => (process.env.APP_BASE_URL || "").replace(/\/$/, "");
const LIVEKIT_SIP_DOMAIN = () => process.env.LIVEKIT_SIP_DOMAIN || "sip.livekit.local";

function buildSipUri(callId: string): string {
  return `sip:${callId}@${LIVEKIT_SIP_DOMAIN()}`;
}

async function findUserByDID(calledNumber: string): Promise<{
  userId: string;
  organizationId: number | null;
  preferredLanguage: string;
} | null> {
  if (!calledNumber) return null;
  try {
    const user = await storage.getUserByPhone(calledNumber);
    if (user) {
      return {
        userId: String(user.id),
        organizationId: (user as any).organizationId ?? null,
        preferredLanguage: (user as any).preferredLanguage || "auto",
      };
    }
  } catch (err) {
    logger.warn("PSTNInbound", `DID lookup failed for ${calledNumber}: ${String(err)}`);
  }
  return null;
}

async function sendInboundPush(userId: string, payload: {
  callId: string;
  callerNumber: string;
  callType: string;
}): Promise<void> {
  try {
    const mod: any = await import("../firebase-admin").catch(() => ({}));
    if (typeof mod.sendVoIPPush === "function") {
      await mod.sendVoIPPush(userId, {
        callId: payload.callId,
        callerId: payload.callerNumber,
        callType: payload.callType,
        callerName: payload.callerNumber,
      });
    }
  } catch (err) {
    logger.warn("PSTNInbound", `push failed for ${userId}: ${String(err)}`);
  }
}

async function releaseCalleeLock(callId: string, calleeUserId: string): Promise<void> {
  try {
    await getRedisClient().del(`user:active_call:${calleeUserId}`);
    await getRedisClient().del(`call_metadata:${callId}:callee`);
  } catch (err) {
    logger.warn("PSTNInbound", `Failed to release callee lock for ${calleeUserId}: ${String(err)}`);
  }
}

/**
 * Handle inbound PSTN webhook — provider signals that a call is arriving.
 * Returns the response body the provider expects to bridge the call to LiveKit SIP.
 */
export async function handleInboundCall(
  body: unknown,
  headers: Record<string, string>,
): Promise<{ status: number; body: unknown }> {
  const provider = getPSTNProvider();

  const event: PSTNInboundEvent | null = provider.parseInboundWebhook(body, headers);
  if (!event) {
    logger.warn("PSTNInbound", "Could not parse inbound webhook", { body });
    return { status: 400, body: { error: "unrecognised_payload" } };
  }

  logger.info("PSTNInbound", `Inbound call from ${event.callerNumber} → ${event.calledNumber} [${event.providerCallId}]`);

  const target = await findUserByDID(event.calledNumber);
  if (!target) {
    logger.warn("PSTNInbound", `No NeuraTalk user owns DID ${event.calledNumber} — rejecting`);
    return { status: 200, body: { action: "reject", reason: "busy" } };
  }

  const callId = `call_${randomUUID()}`;

  // Guard against double-booking the callee: two simultaneous inbound calls
  // to the same DID/user (or an inbound call arriving while the callee is
  // already on another call) would otherwise both proceed to billing and
  // room creation unchecked — outbound calls already get this exact
  // protection via the `user:active_call:{id}` SET-NX lock in
  // smart-router.ts's initiateCall/initiateConference. Reusing the identical
  // key scheme and TTL here so smart-router's own release logic in endCall()
  // (which reads `call_metadata:{callId}:callee`, mirroring the existing
  // `:caller` mapping) can release it when this call ends, regardless of
  // whether it was inbound or outbound.
  const calleeActiveCallKey = `user:active_call:${target.userId}`;
  const acquiredCalleeLock = await getRedisClient().set(calleeActiveCallKey, callId, "EX", 3600, "NX");
  if (!acquiredCalleeLock) {
    logger.warn("PSTNInbound", `Callee ${target.userId} already has an active call — rejecting inbound call`);
    return { status: 200, body: { action: "reject", reason: "busy" } };
  }

  try {
    await getRedisClient().set(`call_metadata:${callId}:callee`, target.userId, "EX", 7200);

    // Start billing session (inbound — billed to the org/user that owns the DID)
    try {
      const auth = await BillingEngine.startCallSession({
        sessionId: callId,
        userId: Number.isFinite(Number(target.userId)) ? Number(target.userId) : null,
        organizationId: target.organizationId,
        callType: "voice",
        translationEnabled: false,
        recordingEnabled: false,
        joinMethod: "app_to_pstn",
        activateOnAnswer: true,
      });
      if (!auth.allowed) {
        logger.warn("PSTNInbound", `Billing blocked inbound call for user ${target.userId}: ${auth.reason}`);
        await releaseCalleeLock(callId, target.userId);
        return { status: 200, body: { action: "reject", reason: "busy" } };
      }
    } catch (err) {
      logger.warn("PSTNInbound", `Billing check failed, allowing call anyway: ${String(err)}`);
    }

    // Create LiveKit room
    await createCallRoom({
      callId,
      maxParticipants: 4,
      emptyTimeoutSec: 120,
      metadata: {
        callerId: event.callerNumber,
        calleeIdentifier: target.userId,
        callType: "voice",
        inboundPstn: true,
        providerCallId: event.providerCallId,
      },
    });

    await initCallLanguageTracking(callId, [
      { speakerId: target.userId, preferredLanguage: target.preferredLanguage },
      { speakerId: `pstn:${event.callerNumber}`, preferredLanguage: "auto" },
    ]);

    // Issue token for the receiving user
    const userToken = await issueAccessToken(callId, {
      userId: target.userId,
      displayName: target.userId,
      language: target.preferredLanguage,
      role: "caller",
    });

    // Store inbound call record so status webhooks can correlate
    const record: InboundCallRecord = {
      callId,
      providerCallId: event.providerCallId,
      provider: provider.name,
      callerNumber: event.callerNumber,
      calledNumber: event.calledNumber,
      targetUserId: target.userId,
      targetOrganizationId: target.organizationId,
      livekitToken: userToken,
      livekitUrl: process.env.LIVEKIT_URL || "",
      sipUri: buildSipUri(callId),
      createdAt: new Date().toISOString(),
      status: "ringing",
    };
    await storeInboundCall(record);

    // Wake the receiving user's app
    await sendInboundPush(target.userId, {
      callId,
      callerNumber: event.callerNumber,
      callType: "voice",
    });

    // Optional translator bot
    try {
      const botToken = await issueBotToken(callId);
      const mod: any = await import("../translator-bot").catch(() => ({}));
      if (typeof mod.startBotWorker === "function") {
        void mod.startBotWorker(callId, botToken);
      }
    } catch (err) {
      logger.warn("PSTNInbound", `translator bot spawn failed: ${String(err)}`);
    }

    const welcomeMsg = process.env.PSTN_INBOUND_WELCOME_MESSAGE || "";
    const acceptResponse = provider.buildInboundAcceptResponse(buildSipUri(callId), {
      ...(welcomeMsg ? { welcomeMessage: welcomeMsg } : {}),
    });

    logger.info("PSTNInbound", `Bridging inbound ${event.providerCallId} → ${callId} for user ${target.userId}`);
    return { status: 200, body: acceptResponse };
  } catch (err) {
    // Any failure past this point (room creation, token issuance, etc.)
    // must release the callee lock — otherwise a single failed inbound
    // attempt would leave the callee unable to receive calls for up to an
    // hour despite never actually being connected to anything.
    logger.error("PSTNInbound", `Inbound call setup failed for ${target.userId}, releasing callee lock: ${String(err)}`);
    await releaseCalleeLock(callId, target.userId);
    return { status: 200, body: { action: "reject", reason: "busy" } };
  }
}

/**
 * Retrieve the LiveKit token and room URL for a received inbound call.
 * Called by the NeuraTalk app after receiving the incoming-call push notification.
 */
export async function getInboundCallJoinInfo(callId: string): Promise<{
  livekitUrl: string;
  livekitToken: string;
  callerNumber: string;
} | null> {
  const record = await getInboundCallByDID(callId);
  if (!record) return null;

  return {
    livekitUrl: record.livekitUrl,
    livekitToken: record.livekitToken,
    callerNumber: record.callerNumber,
  };
}
