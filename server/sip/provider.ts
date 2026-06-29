/**
 * SIP Provider Interface
 *
 * Abstracts direct SIP trunk connections (Jio, Airtel, Tata, etc.)
 * This is separate from PSTNProvider (which wraps CPaaS REST APIs like MSG91/Twilio).
 *
 * SIPProvider = direct carrier SIP trunk (preferred — cheaper, faster, more control)
 * PSTNProvider = CPaaS REST API wrapper (fallback — easier setup, higher cost)
 *
 * All SIP control happens via Kamailio. This interface represents the
 * configuration and management layer — Kamailio handles the actual SIP signaling.
 */

export interface SIPTrunkConfig {
  id: string;
  name: string;
  provider: "jio" | "airtel" | "tata" | "bsnl" | "generic" | "airnetra";
  host: string;
  port: number;
  transport: "UDP" | "TCP" | "TLS";
  username?: string;
  password?: string;
  authRealm?: string;
  fromDomain: string;
  fromUser?: string;
  callerIdMode: "passthrough" | "asserted" | "restricted" | "forced";
  forcedCallerId?: string;
  priority: number;
  weight: number;
  maxConcurrentCalls: number;
  supportedCodecs: SIPCodec[];
  supportedPrefixes: string[];
  region: string;
  traiCliVerified: boolean;
  dltPeId?: string;
}

export type SIPCodec = "PCMU" | "PCMA" | "G729" | "G722" | "opus" | "telephone-event";

export interface SIPCallParams {
  trunkId: string;
  to: string;
  from: string;
  callId: string;
  headers?: Record<string, string>;
  codecs?: SIPCodec[];
  record?: boolean;
}

export interface SIPCallResult {
  trunkId: string;
  provider: string;
  trunkCallId: string;
  status: "initiated" | "ringing" | "queued";
  latencyMs: number;
}

export interface TrunkStats {
  trunkId: string;
  activeCalls: number;
  callsInLast24h: number;
  successRate: number;
  avgSetupLatencyMs: number;
  lastOptionsPingMs: number;
  lastOptionsPingAt: string;
  healthy: boolean;
  failureReason?: string;
}

export interface SIPProviderHealth {
  healthy: boolean;
  latencyMs?: number;
  message?: string;
  lastCheckedAt: string;
}

export interface SIPProvider {
  readonly id: string;
  readonly name: string;
  readonly config: SIPTrunkConfig;

  /** Validate trunk config and test connectivity via SIP OPTIONS */
  optionsPing(): Promise<SIPProviderHealth>;

  /** Normalize a number for this trunk (E.164 → trunk-specific format) */
  normalizeOutbound(number: string): string;

  /** Reverse-normalize an inbound number from trunk format to E.164 */
  normalizeInbound(number: string): string;

  /** Get SIP URI string for use in Kamailio routing */
  getSIPUri(): string;

  /** SIP headers to add for this trunk (P-Asserted-Identity, etc.) */
  getOutboundHeaders(params: { from: string; to: string; callId: string }): Record<string, string>;

  /** Get current trunk statistics from Kamailio */
  getStats(): Promise<TrunkStats>;
}
