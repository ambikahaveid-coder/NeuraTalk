/**
 * MSG91 Service — India-first PSTN gateway.
 * Replaces Twilio for: outbound voice calls, OTP SMS, verified caller ID.
 *
 * Why MSG91 over Twilio:
 *   - ₹0.45/min vs Twilio's ₹3.82/min (87% cheaper for India)
 *   - Indian company (RBI data localization compliance)
 *   - Simpler India-focused OTP and PSTN flows
 *   - DLT registration helpdesk included
 *
 * Env vars required:
 *   MSG91_AUTH_KEY          — API auth key from panel
 *   MSG91_VOICE_CALLER_ID   — your verified caller ID number (E.164, e.g. +919876543210)
 *   MSG91_VOICE_URL         — callback for voice flow (XML/BXML)
 */

import { logger } from "./observability";

const MSG91_BASE = "https://api.msg91.com/api";

async function fetchWithTimeout(url: string, options: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
    logger.warn("MSG91", `Request timed out after ${timeoutMs}ms`);
  }, timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function authKey(): string {
  const key = process.env.MSG91_AUTH_KEY;
  if (!key) throw new Error("MSG91_AUTH_KEY not configured");
  return key;
}

function normalizePhoneNumber(value: string | undefined | null): string | null {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const normalized = raw.startsWith("+")
    ? `+${raw.slice(1).replace(/\D/g, "")}`
    : raw.replace(/\D/g, "");
  const digits = normalized.replace(/\D/g, "");
  if (digits.length < 8 || digits.length > 15) {
    return null;
  }
  return normalized.startsWith("+") ? normalized : `+${digits}`;
}

function isIndianNumber(value: string | null): boolean {
  if (!value) return false;
  const digits = value.replace(/\D/g, "");
  return digits.length === 10 || digits.startsWith("91");
}

function resolveCallerId(to: string, requestedFrom: string): string {
  const normalizedTo = normalizePhoneNumber(to);
  const normalizedRequestedFrom = normalizePhoneNumber(requestedFrom);
  const configuredCallerId = normalizePhoneNumber(process.env.MSG91_VOICE_CALLER_ID);

  if (isIndianNumber(normalizedTo)) {
    if (normalizedRequestedFrom) {
      return normalizedRequestedFrom;
    }
    if (configuredCallerId) {
      return configuredCallerId;
    }
    throw new Error("MSG91_VOICE_CALLER_ID must be configured for India PSTN calls");
  }

  if (normalizedRequestedFrom) {
    return normalizedRequestedFrom;
  }

  if (configuredCallerId) {
    return configuredCallerId;
  }

  throw new Error("No valid outbound caller ID is configured for MSG91");
}

export interface OutboundCallOptions {
  /** Destination number in E.164 format, e.g. +919876543210 */
  to: string;
  /** Caller ID to display to callee. Must be verified (see verifyCallerId). */
  from: string;
  /** URL that MSG91 will POST to with call events (ringing, answered, ended). */
  callbackUrl: string;
  /** Optional: message to play if no app-side pickup (IVR fallback). */
  fallbackMessage?: string;
  /** Optional: metadata correlating to our internal callId. */
  metadata?: Record<string, string>;
}

export interface MSG91CallResult {
  callId: string;          // MSG91's internal call ID
  status: "queued" | "initiated" | "failed";
  rawResponse: any;
}

/**
 * Initiate an outbound PSTN call.
 * The callee's phone rings with `from` as Caller ID.
 */
export async function initiateOutboundCall(opts: OutboundCallOptions): Promise<MSG91CallResult> {
  const to = normalizePhoneNumber(opts.to);
  if (!to) {
    throw new Error("MSG91 outbound call failed: invalid destination number");
  }
  const from = resolveCallerId(to, opts.from);

  const response = await fetchWithTimeout(`${MSG91_BASE}/v5/voice/call/outbound`, {
    method: "POST",
    headers: {
      "authkey": authKey(),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      to,
      from,
      callback_url: opts.callbackUrl,
      fallback_message: opts.fallbackMessage,
      metadata: opts.metadata,
    }),
  }, 15_000);

  if (!response.ok) {
    const errText = await response.text().catch(() => "");
    throw new Error(`MSG91 outbound call failed: ${response.status} ${errText}`);
  }

  const data = await response.json();
  return {
    callId: data.call_id || data.id || data.request_id,
    status: data.status || "initiated",
    rawResponse: data,
  };
}

/**
 * Verify a caller ID — MSG91 sends OTP to the number.
 * User must enter OTP to confirm ownership. Once verified, number can be used as `from`.
 *
 * This is how we satisfy user's requirement: "call vellallante na number nuncho vellali,
 * verchual numbers kaadu". The user's actual mobile becomes the outgoing caller ID.
 */
export async function requestCallerIdVerification(phoneNumber: string): Promise<{ verificationId: string }> {
  const response = await fetchWithTimeout(`${MSG91_BASE}/v5/voice/callerid/verify/request`, {
    method: "POST",
    headers: {
      "authkey": authKey(),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ phone: phoneNumber }),
  }, 15_000);

  if (!response.ok) {
    throw new Error(`Caller ID verify request failed: ${response.status}`);
  }

  const data = await response.json();
  return { verificationId: data.verification_id || data.id };
}

export async function confirmCallerIdVerification(
  verificationId: string,
  otp: string
): Promise<{ verified: boolean; phoneNumber?: string }> {
  const response = await fetchWithTimeout(`${MSG91_BASE}/v5/voice/callerid/verify/confirm`, {
    method: "POST",
    headers: {
      "authkey": authKey(),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ verification_id: verificationId, otp }),
  }, 15_000);

  if (!response.ok) return { verified: false };

  const data = await response.json();
  return { verified: data.status === "verified", phoneNumber: data.phone };
}

/**
 * Bridge an outbound PSTN call into a LiveKit room.
 * When callee answers, MSG91 connects the audio to our SIP endpoint,
 * which is bridged into the LiveKit room where the translator bot runs.
 *
 * Flow:
 *   App user (in LiveKit) ──┐
 *                           ├──> LiveKit room ──> AI pipeline
 *   PSTN callee (via MSG91) ┘
 */
export async function bridgeCallToLiveKitRoom(opts: {
  to: string;
  from: string;
  sipUri: string;              // LiveKit SIP ingress URI (e.g. sip:<roomName>@livekit-sip.yourdomain)
  callbackUrl: string;
  metadata?: Record<string, string>;
}): Promise<MSG91CallResult> {
  return initiateOutboundCall({
    to: opts.to,
    from: opts.from,
    callbackUrl: opts.callbackUrl,
    metadata: { ...opts.metadata, sip_bridge: opts.sipUri },
  });
}

/**
 * Send OTP via SMS (used for SIM-app binding, TRAI compliance).
 */
export async function sendOTP(phoneNumber: string, otp: string, templateId?: string): Promise<void> {
  const response = await fetchWithTimeout(`${MSG91_BASE}/v5/otp`, {
    method: "POST",
    headers: {
      "authkey": authKey(),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      mobile: phoneNumber,
      otp,
      template_id: templateId,
      otp_expiry: 10,
    }),
  }, 15_000);

  if (!response.ok) {
    throw new Error(`MSG91 OTP send failed: ${response.status}`);
  }
}

/**
 * Enable conditional call forwarding on user's SIM via USSD code.
 * This is user-action (dialed from their phone); we return the instructions.
 *
 * Why: when user's SIM number receives a call, it can auto-forward to our
 * NeuraTalk number so translation kicks in even if the app isn't open.
 */
export function getCallForwardingInstructions(neuraTalkInboundNumber: string): {
  android: string;
  iosInstructions: string;
  disableCode: string;
} {
  return {
    // Forward on no-answer (30s) — preserves direct calls for contacts
    android: `**61*${neuraTalkInboundNumber}*11*30#`,
    iosInstructions: `Settings > Phone > Call Forwarding > Enable > Enter: ${neuraTalkInboundNumber}`,
    disableCode: `##61#`,
  };
}

/**
 * Health check.
 */
export async function isMSG91Healthy(): Promise<boolean> {
  try {
    if (!process.env.MSG91_AUTH_KEY) return false;
    const response = await fetchWithTimeout(`${MSG91_BASE}/v5/account/balance`, {
      headers: { authkey: authKey() },
    }, 5_000);
    return response.ok;
  } catch {
    return false;
  }
}
