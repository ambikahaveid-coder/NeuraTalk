/**
 * MSG91 PSTN Provider
 *
 * India-first telephony: ₹0.45/min outbound, DLT-compliant, RBI data-local.
 *
 * Required env vars:
 *   MSG91_AUTH_KEY          — panel API key
 *   MSG91_VOICE_CALLER_ID   — verified E.164 outbound number
 *   MSG91_WEBHOOK_SECRET    — HMAC-SHA256 secret for webhook signatures
 *
 * Optional:
 *   MSG91_VOICE_URL         — override default webhook base
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import { logger } from "../observability";
import type {
  PSTNProvider,
  PSTNCallOptions,
  PSTNCallResult,
  PSTNStatusEvent,
  PSTNInboundEvent,
  PSTNTransferOptions,
  PSTNDtmfOptions,
  PSTNProviderHealth,
} from "./provider";

const BASE = "https://api.msg91.com/api";

async function fetchWithTimeout(url: string, init: RequestInit, ms = 15_000): Promise<Response> {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: ac.signal });
  } finally {
    clearTimeout(t);
  }
}

function authKey(): string {
  const k = process.env.MSG91_AUTH_KEY?.trim();
  if (!k) throw new Error("MSG91_AUTH_KEY is not configured. Add it to DO Dashboard encrypted secrets.");
  return k;
}

function normalizeE164(raw: string | undefined | null): string | null {
  const s = String(raw || "").trim();
  if (!s) return null;
  const digits = s.replace(/\D/g, "");
  if (digits.length < 8 || digits.length > 15) return null;
  return s.startsWith("+") ? `+${digits}` : `+${digits}`;
}

function resolveCallerId(to: string, from: string): string {
  const toNorm = normalizeE164(to) || "";
  const fromNorm = normalizeE164(from);
  const configured = normalizeE164(process.env.MSG91_VOICE_CALLER_ID);

  // Indian numbers require a pre-registered caller ID
  const isIndia = toNorm.replace(/\D/g, "").startsWith("91") || toNorm.replace(/\D/g, "").length === 10;
  if (isIndia) {
    const id = fromNorm || configured;
    if (!id) throw new Error("MSG91_VOICE_CALLER_ID must be set for India PSTN calls. Add it to DO Dashboard.");
    return id;
  }
  return fromNorm || configured || (() => { throw new Error("No outbound caller ID configured for MSG91"); })();
}

function mapStatus(raw: string): PSTNStatusEvent["status"] {
  const s = (raw || "").toLowerCase().trim();
  if (["queued", "initiated", "initiated-out"].includes(s)) return "ringing";
  if (["ringing", "in-progress"].includes(s)) return "ringing";
  if (["answered", "connected", "bridged"].includes(s)) return "answered";
  if (["active"].includes(s)) return "active";
  if (["completed", "ended", "disconnected"].includes(s)) return "ended";
  if (["busy"].includes(s)) return "busy";
  if (["no-answer", "no_answer", "missed"].includes(s)) return "no-answer";
  if (["failed", "error"].includes(s)) return "failed";
  if (["cancelled", "canceled", "rejected"].includes(s)) return "cancelled";
  return "failed";
}

export class MSG91Provider implements PSTNProvider {
  readonly name = "msg91";
  readonly preferredRegions = ["IN"];

  async initiateCall(opts: PSTNCallOptions): Promise<PSTNCallResult> {
    const to = normalizeE164(opts.to);
    if (!to) throw new Error(`Invalid destination number: ${opts.to}`);

    const from = resolveCallerId(to, opts.from);
    const payload: Record<string, unknown> = {
      to,
      from,
      callback_url: opts.callbackUrl,
      metadata: {
        internal_call_id: opts.internalCallId,
        ...(opts.metadata || {}),
      },
    };

    if (opts.sipUri) payload["sip_bridge"] = opts.sipUri;
    if (opts.welcomeMessage) payload["fallback_message"] = opts.welcomeMessage;
    if (opts.timeoutSeconds) payload["timeout"] = opts.timeoutSeconds;
    if (opts.record) payload["record"] = true;

    logger.info("MSG91", `Initiating outbound call to ${to} from ${from} [${opts.internalCallId}]`);

    const res = await fetchWithTimeout(`${BASE}/v5/voice/call/outbound`, {
      method: "POST",
      headers: { authkey: authKey(), "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`MSG91 call initiation failed: HTTP ${res.status} — ${body.slice(0, 200)}`);
    }

    const data = await res.json() as any;
    const providerCallId = String(data.call_id || data.id || data.request_id || "");
    if (!providerCallId) {
      throw new Error(`MSG91 returned no call ID. Response: ${JSON.stringify(data).slice(0, 200)}`);
    }

    logger.info("MSG91", `Call queued: providerCallId=${providerCallId} status=${data.status}`);
    return {
      providerCallId,
      status: "queued",
      provider: this.name,
      rawResponse: data,
    };
  }

  parseStatusWebhook(body: unknown, _headers: Record<string, string>): PSTNStatusEvent | null {
    const b = body as Record<string, any>;
    const providerCallId = String(b.call_id || b.uuid || b.id || "");
    const internalCallId = String(
      b.metadata?.internal_call_id || b.internal_call_id || b.call_sid || ""
    );

    if (!providerCallId && !internalCallId) {
      logger.warn("MSG91", "Webhook missing both call_id and internal_call_id", { body });
      return null;
    }

    const status = mapStatus(String(b.status || b.call_status || ""));
    return {
      internalCallId,
      providerCallId,
      status,
      durationSeconds: b.duration ? Number(b.duration) : undefined,
      answeredAt: b.answered_at || b.answer_time || undefined,
      endedAt: b.ended_at || b.end_time || undefined,
      disconnectReason: b.disconnect_reason || b.hangup_cause || undefined,
      direction: b.direction === "inbound" ? "inbound" : "outbound",
      raw: body,
    };
  }

  parseInboundWebhook(body: unknown, _headers: Record<string, string>): PSTNInboundEvent | null {
    const b = body as Record<string, any>;
    const callerNumber = normalizeE164(b.caller || b.from || b.ani || "");
    const calledNumber = normalizeE164(b.called || b.to || b.dnis || "");
    const providerCallId = String(b.call_id || b.uuid || b.id || "");

    if (!callerNumber || !providerCallId) {
      logger.warn("MSG91", "Inbound webhook missing caller or call_id", { body });
      return null;
    }

    return {
      providerCallId,
      callerNumber,
      calledNumber: calledNumber || "",
      provider: this.name,
      raw: body,
    };
  }

  buildInboundAcceptResponse(sipUri: string, opts?: { welcomeMessage?: string }): unknown {
    // MSG91 BXML: bridge inbound call to LiveKit SIP
    return {
      action: "bridge",
      sip_uri: sipUri,
      ...(opts?.welcomeMessage ? { speak: opts.welcomeMessage } : {}),
    };
  }

  async hangup(providerCallId: string): Promise<void> {
    const res = await fetchWithTimeout(`${BASE}/v5/voice/call/hangup`, {
      method: "POST",
      headers: { authkey: authKey(), "Content-Type": "application/json" },
      body: JSON.stringify({ call_id: providerCallId }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      logger.warn("MSG91", `Hangup failed for ${providerCallId}: ${res.status} ${body}`);
    }
  }

  async transfer(opts: PSTNTransferOptions): Promise<void> {
    const to = normalizeE164(opts.to);
    if (!to) throw new Error(`Invalid transfer target: ${opts.to}`);
    const res = await fetchWithTimeout(`${BASE}/v5/voice/call/transfer`, {
      method: "POST",
      headers: { authkey: authKey(), "Content-Type": "application/json" },
      body: JSON.stringify({ call_id: opts.providerCallId, to }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`MSG91 transfer failed: ${res.status} ${body.slice(0, 100)}`);
    }
  }

  async sendDtmf(opts: PSTNDtmfOptions): Promise<void> {
    const res = await fetchWithTimeout(`${BASE}/v5/voice/call/dtmf`, {
      method: "POST",
      headers: { authkey: authKey(), "Content-Type": "application/json" },
      body: JSON.stringify({ call_id: opts.providerCallId, digits: opts.digits }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      logger.warn("MSG91", `DTMF failed for ${opts.providerCallId}: ${res.status} ${body}`);
    }
  }

  verifyWebhookSignature(body: string, headers: Record<string, string>): boolean {
    const secret = process.env.MSG91_WEBHOOK_SECRET?.trim();
    if (!secret) {
      // No secret configured — warn but allow (degrade gracefully until secret is set)
      logger.warn("MSG91", "MSG91_WEBHOOK_SECRET not configured — webhook signature not verified");
      return true;
    }

    const providedSig = (
      headers["x-msg91-signature"] ||
      headers["X-Msg91-Signature"] ||
      headers["x-webhook-signature"] ||
      ""
    ).trim();

    if (!providedSig) {
      logger.warn("MSG91", "No signature header on webhook — rejecting");
      return false;
    }

    const expected = createHmac("sha256", secret).update(body).digest("hex");
    try {
      return timingSafeEqual(Buffer.from(providedSig, "hex"), Buffer.from(expected, "hex"));
    } catch {
      return false;
    }
  }

  async healthCheck(): Promise<PSTNProviderHealth> {
    if (!process.env.MSG91_AUTH_KEY) {
      return { healthy: false, message: "MSG91_AUTH_KEY not configured" };
    }
    const start = Date.now();
    try {
      const res = await fetchWithTimeout(`${BASE}/v5/account/balance`, {
        headers: { authkey: authKey() },
      }, 5_000);
      return {
        healthy: res.ok,
        latencyMs: Date.now() - start,
        message: res.ok ? "OK" : `HTTP ${res.status}`,
      };
    } catch (err) {
      return { healthy: false, latencyMs: Date.now() - start, message: String(err) };
    }
  }
}
