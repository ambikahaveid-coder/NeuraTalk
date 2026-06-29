/**
 * PSTN Provider Interface
 *
 * All PSTN providers must implement this interface.
 * Changing providers requires only ENV var changes — no application code changes.
 *
 * Supported implementations:
 *   - MSG91     (India-first, ₹0.45/min, DLT-compliant)
 *   - Twilio    (Global, higher cost, battle-tested)
 *   - Exotel    (India + SE Asia)
 *   - Plivo     (Global)
 *   - SIP Trunk (BYO SIP carrier)
 */

export interface PSTNCallOptions {
  /** Destination number E.164 */
  to: string;
  /** Caller ID to display E.164 */
  from: string;
  /** Provider webhook URL for call status events */
  callbackUrl: string;
  /** Our internal call ID — passed as metadata so webhooks can correlate */
  internalCallId: string;
  /** SIP URI to bridge audio into LiveKit room */
  sipUri?: string;
  /** Optional IVR message to play on answer */
  welcomeMessage?: string;
  /** Record the call (if provider supports it) */
  record?: boolean;
  /** Call timeout in seconds before treating as no-answer */
  timeoutSeconds?: number;
  /** Extra provider-specific metadata */
  metadata?: Record<string, string>;
}

export interface PSTNCallResult {
  /** Provider's call identifier */
  providerCallId: string;
  /** Initial call status */
  status: "queued" | "initiated" | "ringing" | "failed";
  /** Provider name for audit */
  provider: string;
  /** Raw provider response — stored in CDR */
  rawResponse?: unknown;
}

export interface PSTNStatusEvent {
  /** Our internal call ID from metadata */
  internalCallId: string;
  /** Provider's call ID */
  providerCallId: string;
  /** Provider-normalised status */
  status: "ringing" | "answered" | "active" | "ended" | "failed" | "busy" | "no-answer" | "cancelled";
  /** Duration in seconds (populated on end events) */
  durationSeconds?: number;
  /** Timestamp the call was answered */
  answeredAt?: string;
  /** Timestamp the call ended */
  endedAt?: string;
  /** Reason for disconnect */
  disconnectReason?: string;
  /** Direction: inbound | outbound */
  direction?: "inbound" | "outbound";
  /** Raw provider payload — stored for audit */
  raw: unknown;
}

export interface PSTNInboundEvent {
  /** Provider's call ID for this inbound call */
  providerCallId: string;
  /** Caller's E.164 number */
  callerNumber: string;
  /** DID number that was called */
  calledNumber: string;
  /** Provider name */
  provider: string;
  /** Raw provider payload */
  raw: unknown;
}

export interface PSTNTransferOptions {
  providerCallId: string;
  to: string;
}

export interface PSTNDtmfOptions {
  providerCallId: string;
  digits: string;
}

export interface PSTNProviderHealth {
  healthy: boolean;
  latencyMs?: number;
  message?: string;
}

/**
 * Core PSTN provider interface.
 * Every provider must implement all methods; unsupported ones throw descriptive errors.
 */
export interface PSTNProvider {
  /** Unique name for this provider — used in CDR and logs */
  readonly name: string;

  /** Countries/regions this provider supports well (ISO 3166-1 alpha-2) */
  readonly preferredRegions: string[];

  /**
   * Initiate an outbound PSTN call.
   * Returns immediately — actual connection is async via statusCallback.
   */
  initiateCall(opts: PSTNCallOptions): Promise<PSTNCallResult>;

  /**
   * Parse a raw webhook body into a normalised PSTNStatusEvent.
   * Called by the webhook handler before processing state transitions.
   */
  parseStatusWebhook(body: unknown, headers: Record<string, string>): PSTNStatusEvent | null;

  /**
   * Parse an inbound call webhook from the provider.
   * Return PSTNInboundEvent so the router can set up a LiveKit room.
   */
  parseInboundWebhook(body: unknown, headers: Record<string, string>): PSTNInboundEvent | null;

  /**
   * Generate the response payload the provider expects when we accept an inbound call.
   * For MSG91/Exotel this is a JSON/XML instruction; for Twilio it is TwiML.
   *
   * @param sipUri  LiveKit SIP ingress URI to bridge the call to
   * @param options Optional IVR message and timeout
   */
  buildInboundAcceptResponse(sipUri: string, options?: { welcomeMessage?: string }): unknown;

  /**
   * Hang up an active call.
   */
  hangup(providerCallId: string): Promise<void>;

  /**
   * Transfer an active call to another number.
   */
  transfer(opts: PSTNTransferOptions): Promise<void>;

  /**
   * Send DTMF tones into an active call.
   */
  sendDtmf(opts: PSTNDtmfOptions): Promise<void>;

  /**
   * Verify webhook authenticity using HMAC or signature header.
   * Throw if invalid — the caller must not process the payload.
   */
  verifyWebhookSignature(body: string, headers: Record<string, string>): boolean;

  /**
   * Health check: can we reach the provider API right now?
   */
  healthCheck(): Promise<PSTNProviderHealth>;
}
