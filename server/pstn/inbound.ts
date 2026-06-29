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
