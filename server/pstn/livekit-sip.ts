/**
 * PSTN through LiveKit SIP (works with any SIP-trunk provider: Exotel, Plivo, Twilio, Airtel/Tata).
 *
 * Outbound: LiveKit dials the phone number through our outbound SIP trunk straight into the
 * call's LiveKit room, so the existing translated-call pipeline (bot, billing, CDR) is unchanged.
 * Status comes from LiveKit room webhooks (SIP participant joined/left), not from the provider.
 * Inbound calls arrive through a LiveKit inbound trunk + dispatch rule (see server/telephony.ts).
 *
 * providerCallId = "<roomName>|<participantIdentity>" so hangup/transfer can find the participant.
 */
import { RoomServiceClient, SipClient } from "livekit-server-sdk";
import { logger } from "../observability";
import type {
  PSTNCallOptions, PSTNCallResult, PSTNDtmfOptions, PSTNInboundEvent, PSTNProvider, PSTNProviderHealth,
  PSTNStatusEvent, PSTNTransferOptions,
} from "./provider";

let outboundTrunkId: string | null = process.env.LIVEKIT_SIP_OUTBOUND_TRUNK_ID?.trim() || null;

/** Set from the database at startup / when a super admin connects the trunk. */
export function setLiveKitOutboundTrunkId(id: string | null): void {
  outboundTrunkId = id?.trim() || null;
}
export function getLiveKitOutboundTrunkId(): string | null {
  return outboundTrunkId;
}

function liveKitHost(): string {
  const url = process.env.LIVEKIT_URL?.trim();
  if (!url || !process.env.LIVEKIT_API_KEY || !process.env.LIVEKIT_API_SECRET) throw new Error("LIVEKIT_NOT_CONFIGURED");
  return url.replace(/^wss?:/, "https:");
}
export function sipClient(): SipClient {
  return new SipClient(liveKitHost(), process.env.LIVEKIT_API_KEY!, process.env.LIVEKIT_API_SECRET!);
}
function roomClient(): RoomServiceClient {
  return new RoomServiceClient(liveKitHost(), process.env.LIVEKIT_API_KEY!, process.env.LIVEKIT_API_SECRET!);
}

export function pstnIdentity(phone: string): string {
  return `pstn:${phone}`;
}
function splitProviderId(id: string): { room: string; identity: string } {
  const at = id.lastIndexOf("|");
  return at > 0 ? { room: id.slice(0, at), identity: id.slice(at + 1) } : { room: id, identity: "" };
}

export class LiveKitSipProvider implements PSTNProvider {
  readonly name = "livekit_sip";
  readonly preferredRegions = ["IN", "GLOBAL"];

  async initiateCall(opts: PSTNCallOptions): Promise<PSTNCallResult> {
    const trunk = outboundTrunkId;
    if (!trunk) throw new Error("PSTN_NOT_CONFIGURED");
    const identity = pstnIdentity(opts.to);
    const info = await sipClient().createSipParticipant(trunk, opts.to, opts.internalCallId, {
      participantIdentity: identity,
      participantName: opts.metadata?.calleeName || opts.to,
      ...(opts.from ? { fromNumber: opts.from } : {}),
      playDialtone: true,
      krispEnabled: true,
      ringingTimeout: opts.timeoutSeconds ?? 30,
      participantAttributes: { "neuratalk.callId": opts.internalCallId },
    } as any);
    logger.info("LiveKitSIP", `dialing ${opts.to.replace(/\d(?=\d{4})/g, "•")} into ${opts.internalCallId} (sip call ${info.sipCallId})`);
    return { providerCallId: `${opts.internalCallId}|${identity}`, status: "initiated", provider: this.name, rawResponse: { sipCallId: info.sipCallId } };
  }

  // Status arrives through LiveKit room webhooks (participant_joined / participant_left).
  parseStatusWebhook(): PSTNStatusEvent | null { return null; }
  parseInboundWebhook(): PSTNInboundEvent | null { return null; }
  buildInboundAcceptResponse(): unknown { return {}; }

  async hangup(providerCallId: string): Promise<void> {
    const { room, identity } = splitProviderId(providerCallId);
    if (!identity) return;
    try {
      await roomClient().removeParticipant(room, identity);
    } catch (error) {
      logger.warn("LiveKitSIP", `hangup ${room}: ${String(error)}`);
    }
  }

  async transfer(opts: PSTNTransferOptions): Promise<void> {
    const { room, identity } = splitProviderId(opts.providerCallId);
    await sipClient().transferSipParticipant(room, identity, opts.to.startsWith("tel:") || opts.to.startsWith("sip:") ? opts.to : `tel:${opts.to}`);
  }

  async sendDtmf(opts: PSTNDtmfOptions): Promise<void> {
    // LiveKit SIP sends DTMF from the room as a "sip_dtmf" data packet; not used by NeuraTalk menus yet.
    throw new Error(`DTMF_NOT_SUPPORTED:${opts.digits.length}`);
  }

  // Webhooks come from LiveKit (verified by the LiveKit webhook receiver), never from the trunk provider.
  verifyWebhookSignature(): boolean { return false; }

  async healthCheck(): Promise<PSTNProviderHealth> {
    const t0 = Date.now();
    try {
      if (!outboundTrunkId) return { healthy: false, message: "No outbound SIP trunk connected" };
      const trunks = await sipClient().listSipOutboundTrunk();
      const ok = trunks.some((t) => t.sipTrunkId === outboundTrunkId);
      return { healthy: ok, latencyMs: Date.now() - t0, message: ok ? "Outbound trunk ready" : "Outbound trunk not found in LiveKit" };
    } catch (error) {
      return { healthy: false, latencyMs: Date.now() - t0, message: String(error).slice(0, 140) };
    }
  }
}

/** Rooms our inbound dispatch rule creates start with this ("call_" so they are smart calls). */
export const INBOUND_ROOM_PREFIX = "call_pstnin_";

/** A LiveKit participant that is a phone line (SIP), not an app or the translator. */
export function isSipParticipant(p: { kind?: unknown; attributes?: Record<string, string> } | null | undefined): boolean {
  if (!p) return false;
  return Boolean(p.attributes?.["sip.phoneNumber"]) || String(p.kind) === "3" || String(p.kind).toUpperCase() === "SIP";
}

/**
 * LiveKit room webhook → phone-call state. Returns what was done (for logs/tests).
 * - phone line joins an inbound room: route it like a provider inbound call (ring an agent).
 * - phone line joins an outbound call room: the customer answered.
 * - an app user joins an inbound room: the agent answered.
 * - phone line leaves: the call ended.
 */
export async function handleLiveKitSipEvent(event: {
  event?: string;
  room?: { name?: string } | null;
  participant?: { identity?: string; kind?: unknown; attributes?: Record<string, string> } | null;
}, deps: {
  handleInboundCall: (body: unknown, headers: Record<string, string>, alreadyInRoom: { event: any; callId: string }) => Promise<{ status: number; body: any }>;
  processStatusEvent: (e: PSTNStatusEvent) => Promise<void>;
  removeParticipant: (room: string, identity: string) => Promise<void>;
}): Promise<string> {
  const room = event.room?.name ?? "";
  const p = event.participant;
  if (!room || !p?.identity) return "ignored";
  const inbound = room.startsWith(INBOUND_ROOM_PREFIX);
  const sip = isSipParticipant(p);
  const providerCallId = `${room}|${p.identity}`;

  if (event.event === "participant_joined" && sip && inbound) {
    const callerNumber = p.attributes?.["sip.phoneNumber"] ?? "";
    const calledNumber = p.attributes?.["sip.trunkPhoneNumber"] ?? "";
    const r = await deps.handleInboundCall(null, {}, {
      callId: room,
      event: { providerCallId, callerNumber, calledNumber, provider: "livekit_sip", raw: { attributes: p.attributes } },
    });
    if (r.body?.action === "reject") {
      await deps.removeParticipant(room, p.identity);
      return "inbound_rejected";
    }
    return "inbound_ringing";
  }
  if (event.event === "participant_joined" && sip && !inbound) {
    await deps.processStatusEvent({ internalCallId: room, providerCallId, status: "answered", direction: "outbound", answeredAt: new Date().toISOString(), raw: { attributes: p.attributes } });
    return "outbound_answered";
  }
  if (event.event === "participant_joined" && !sip && inbound && !p.identity.startsWith("neuratalk-translator") && !p.identity.startsWith("bot")) {
    await deps.processStatusEvent({ internalCallId: room, providerCallId, status: "answered", direction: "inbound", answeredAt: new Date().toISOString(), raw: {} });
    return "inbound_answered";
  }
  if (event.event === "participant_left" && sip) {
    await deps.processStatusEvent({ internalCallId: room, providerCallId, status: "ended", direction: inbound ? "inbound" : "outbound", endedAt: new Date().toISOString(), disconnectReason: "phone_hung_up", raw: {} });
    return "ended";
  }
  return "ignored";
}
