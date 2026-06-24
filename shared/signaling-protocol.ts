export const SIGNALING_MESSAGE = {
  REGISTER: "register",
  UNREGISTER: "unregister",
  CALL_INITIATE: "call_initiate",
  CALL_OFFER: "call_offer",
  CALL_ANSWER: "call_answer",
  CALL_ICE: "call_ice",
  CALL_RINGING: "call_ringing",
  CALL_ACCEPT: "call_accept",
  CALL_REJECT: "call_reject",
  CALL_BUSY: "call_busy",
  CALL_END: "call_end",
  CALL_HOLD: "call_hold",
  CALL_RESUME: "call_resume",
  CALL_MUTE: "call_mute",
  CALL_UNMUTE: "call_unmute",
  MEDIA_READY: "media_ready",
  ERROR: "error",
  HEARTBEAT: "heartbeat",
  ACK: "ack",
  VIDEO_ENABLE: "video_enable",
  VIDEO_DISABLE: "video_disable",
  SCREEN_SHARE_START: "screen_share_start",
  SCREEN_SHARE_STOP: "screen_share_stop",
  EXTERNAL_HANDOFF: "external_handoff",
  TRANSLATION_SUBTITLE: "translation_subtitle",
  APP_METADATA: "app_metadata",
} as const;

export type SignalingMessageType =
  typeof SIGNALING_MESSAGE[keyof typeof SIGNALING_MESSAGE];

export interface SignalingMessagePayload {
  [key: string]: unknown;
}

export interface SignalingMessage {
  type: SignalingMessageType;
  callId?: string;
  sessionId?: string;
  from?: string;
  to?: string;
  payload?: SignalingMessagePayload;
  timestamp: number;
}

const LEGACY_MESSAGE_ALIASES: Record<string, SignalingMessageType> = {
  initiate_call: SIGNALING_MESSAGE.CALL_INITIATE,
  answer: SIGNALING_MESSAGE.CALL_ANSWER,
  ice_candidate: SIGNALING_MESSAGE.CALL_ICE,
  end_call: SIGNALING_MESSAGE.CALL_END,
};

export function normalizeSignalingMessageType(rawType: unknown): SignalingMessageType | null {
  if (typeof rawType !== "string") {
    return null;
  }

  const normalized = rawType.trim();
  if (!normalized) {
    return null;
  }

  if (normalized in LEGACY_MESSAGE_ALIASES) {
    return LEGACY_MESSAGE_ALIASES[normalized];
  }

  const values = Object.values(SIGNALING_MESSAGE) as string[];
  return values.includes(normalized) ? (normalized as SignalingMessageType) : null;
}

export function normalizeSignalingMessage(
  value: unknown,
): (Omit<SignalingMessage, "type" | "timestamp"> & { type: SignalingMessageType; timestamp: number }) | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const candidate = value as Record<string, unknown>;
  const type = normalizeSignalingMessageType(candidate.type);
  if (!type) {
    return null;
  }

  const timestamp = typeof candidate.timestamp === "number" ? candidate.timestamp : Date.now();

  return {
    type,
    timestamp,
    callId: typeof candidate.callId === "string" ? candidate.callId : undefined,
    sessionId: typeof candidate.sessionId === "string" ? candidate.sessionId : undefined,
    from: typeof candidate.from === "string" ? candidate.from : undefined,
    to: typeof candidate.to === "string" ? candidate.to : undefined,
    payload: candidate.payload && typeof candidate.payload === "object" && !Array.isArray(candidate.payload)
      ? (candidate.payload as SignalingMessagePayload)
      : undefined,
  };
}
