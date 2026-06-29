/**
 * Twilio PSTN Provider
 *
 * Global coverage, higher cost (~$0.013/min outbound US, ₹3.82/min India).
 * Use as fallback when MSG91 is unavailable or for international calls.
 *
 * Required env vars:
 *   TWILIO_ACCOUNT_SID    — Account SID (starts with AC)
 *   TWILIO_AUTH_TOKEN     — Auth token
 *   TWILIO_PHONE_NUMBER   — Your Twilio DID in E.164
 *   TWILIO_WEBHOOK_SECRET — Optional HMAC validation (same as TWILIO_AUTH_TOKEN usually)
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

const TWILIO_BASE = "https://api.twilio.com/2010-04-01";

function accountSid(): string {
  const s = process.env.TWILIO_ACCOUNT_SID?.trim();
  if (!s) throw new Error("TWILIO_ACCOUNT_SID is not configured");
  return s;
}

function authToken(): string {
  const t = process.env.TWILIO_AUTH_TOKEN?.trim();
  if (!t) throw new Error("TWILIO_AUTH_TOKEN is not configured");
  return t;
}

function twilioNumber(): string {
  const n = process.env.TWILIO_PHONE_NUMBER?.trim();
  if (!n) throw new Error("TWILIO_PHONE_NUMBER is not configured");
  return n;
}

function basicAuth(): string {
  return "Basic " + Buffer.from(`${accountSid()}:${authToken()}`).toString("base64");
}

async function twilioPost(path: string, params: Record<string, string>): Promise<any> {
  const body = new URLSearchParams(params).toString();
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), 15_000);
  try {
    const res = await fetch(`${TWILIO_BASE}${path}`, {
      method: "POST",
      headers: {
        Authorization: basicAuth(),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
      signal: ac.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Twilio API error: HTTP ${res.status} — ${text.slice(0, 200)}`);
    }
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

function mapTwilioStatus(raw: string): PSTNStatusEvent["status"] {
  switch ((raw || "").toLowerCase()) {
    case "queued":
    case "initiated":
    case "ringing":
      return "ringing";
    case "in-progress":
      return "active";
    case "answered":
      return "answered";
    case "completed":
      return "ended";
    case "busy":
      return "busy";
    case "no-answer":
      return "no-answer";
    case "canceled":
    case "cancelled":
      return "cancelled";
    case "failed":
    default:
      return "failed";
  }
}

function buildTwiml(sipUri: string, opts?: { welcomeMessage?: string; timeout?: number }): string {
  const timeout = opts?.timeout ?? 30;
  const speak = opts?.welcomeMessage
    ? `<Say voice="Polly.Aditi">${opts.welcomeMessage}</Say>`
    : "";
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  ${speak}
  <Dial timeout="${timeout}">
    <Sip>${sipUri}</Sip>
  </Dial>
</Response>`;
}

export class TwilioProvider implements PSTNProvider {
  readonly name = "twilio";
  readonly preferredRegions = ["US", "GB", "AU", "CA", "EU"];

  async initiateCall(opts: PSTNCallOptions): Promise<PSTNCallResult> {
    const to = opts.to.startsWith("+") ? opts.to : `+${opts.to.replace(/\D/g, "")}`;
    const from = (() => {
      const f = opts.from.startsWith("+") ? opts.from : `+${opts.from.replace(/\D/g, "")}`;
      return f.replace(/\D/g, "").length >= 8 ? f : twilioNumber();
    })();

    // TwiML URL — Twilio fetches this on call answer to know what to do
    const twimlUrl = opts.sipUri
      ? `${process.env.APP_BASE_URL}/api/pstn/twilio/twiml/${opts.internalCallId}`
      : opts.callbackUrl;

    logger.info("Twilio", `Initiating call to ${to} from ${from} [${opts.internalCallId}]`);

    const data = await twilioPost(`/Accounts/${accountSid()}/Calls.json`, {
      To: to,
      From: from,
      Url: twimlUrl,
      StatusCallback: opts.callbackUrl,
      StatusCallbackEvent: "initiated ringing answered completed",
      StatusCallbackMethod: "POST",
      Timeout: String(opts.timeoutSeconds ?? 30),
      ...(opts.record ? { Record: "true" } : {}),
    });

    logger.info("Twilio", `Call created: SID=${data.sid} status=${data.status}`);
    return {
      providerCallId: data.sid,
      status: "queued",
      provider: this.name,
      rawResponse: data,
    };
  }

  parseStatusWebhook(body: unknown, _headers: Record<string, string>): PSTNStatusEvent | null {
    const b = body as Record<string, string>;
    const providerCallId = b.CallSid || "";
    const internalCallId = b.StatusCallbackParam || b.internal_call_id || "";

    if (!providerCallId) return null;

    return {
      internalCallId,
      providerCallId,
      status: mapTwilioStatus(b.CallStatus || ""),
      durationSeconds: b.CallDuration ? Number(b.CallDuration) : undefined,
      answeredAt: undefined,
      endedAt: undefined,
      disconnectReason: b.SipResponseCode || undefined,
      direction: b.Direction === "inbound" ? "inbound" : "outbound",
      raw: body,
    };
  }

  parseInboundWebhook(body: unknown, _headers: Record<string, string>): PSTNInboundEvent | null {
    const b = body as Record<string, string>;
    const callerNumber = b.From || "";
    const calledNumber = b.To || "";
    const providerCallId = b.CallSid || "";

    if (!callerNumber || !providerCallId) return null;

    return {
      providerCallId,
      callerNumber,
      calledNumber,
      provider: this.name,
      raw: body,
    };
  }

  buildInboundAcceptResponse(sipUri: string, opts?: { welcomeMessage?: string }): unknown {
    return buildTwiml(sipUri, opts);
  }

  async hangup(providerCallId: string): Promise<void> {
    await twilioPost(`/Accounts/${accountSid()}/Calls/${providerCallId}.json`, {
      Status: "completed",
    });
  }

  async transfer(opts: PSTNTransferOptions): Promise<void> {
    const to = opts.to.startsWith("+") ? opts.to : `+${opts.to.replace(/\D/g, "")}`;
    const twiml = `<?xml version="1.0"?><Response><Dial>${to}</Dial></Response>`;
    await twilioPost(`/Accounts/${accountSid()}/Calls/${opts.providerCallId}.json`, {
      Twiml: twiml,
    });
  }

  async sendDtmf(opts: PSTNDtmfOptions): Promise<void> {
    await twilioPost(`/Accounts/${accountSid()}/Calls/${opts.providerCallId}.json`, {
      Twiml: `<?xml version="1.0"?><Response><Play digits="${opts.digits}"/></Response>`,
    });
  }

  verifyWebhookSignature(body: string, headers: Record<string, string>): boolean {
    const token = process.env.TWILIO_AUTH_TOKEN?.trim();
    if (!token) {
      logger.warn("Twilio", "TWILIO_AUTH_TOKEN not set — cannot verify webhook signature");
      return true;
    }

    const sig = headers["x-twilio-signature"] || headers["X-Twilio-Signature"] || "";
    if (!sig) {
      logger.warn("Twilio", "No X-Twilio-Signature header — rejecting webhook");
      return false;
    }

    const url = `${process.env.APP_BASE_URL}/api/pstn/twilio/webhook`;
    // Twilio signature: HMAC-SHA1 of URL + sorted POST params
    const params = Object.fromEntries(new URLSearchParams(body));
    const sorted = Object.keys(params).sort().map(k => `${k}${params[k]}`).join("");
    const expected = createHmac("sha1", token).update(url + sorted).digest("base64");

    try {
      const expectedBuf = Buffer.from(expected);
      const sigBuf = Buffer.from(sig);
      // Constant-length comparison to prevent timing oracle on buffer length mismatch
      if (sigBuf.length !== expectedBuf.length) {
        timingSafeEqual(expectedBuf, expectedBuf); // burn time
        return false;
      }
      return timingSafeEqual(sigBuf, expectedBuf);
    } catch {
      return false;
    }
  }

  async healthCheck(): Promise<PSTNProviderHealth> {
    if (!process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN) {
      return { healthy: false, message: "Twilio credentials not configured" };
    }
    const start = Date.now();
    try {
      const ac = new AbortController();
      const t = setTimeout(() => ac.abort(), 5_000);
      const res = await fetch(`${TWILIO_BASE}/Accounts/${accountSid()}.json`, {
        headers: { Authorization: basicAuth() },
        signal: ac.signal,
      }).finally(() => clearTimeout(t));
      return { healthy: res.ok, latencyMs: Date.now() - start, message: res.ok ? "OK" : `HTTP ${res.status}` };
    } catch (err) {
      return { healthy: false, latencyMs: Date.now() - start, message: String(err) };
    }
  }
}
