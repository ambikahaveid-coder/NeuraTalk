export const SMART_CALL_STATE = {
  CREATED: "created",
  RINGING: "ringing",
  ANSWERED: "answered",
  ACTIVE: "active",
  ENDED: "ended",
  FAILED: "failed",
  MISSED: "missed",
  BUSY: "busy",
  CANCELLED: "cancelled",
} as const;

export type SmartCallState = typeof SMART_CALL_STATE[keyof typeof SMART_CALL_STATE];

const TERMINAL_STATES = new Set<SmartCallState>([
  SMART_CALL_STATE.ENDED,
  SMART_CALL_STATE.FAILED,
  SMART_CALL_STATE.MISSED,
  SMART_CALL_STATE.BUSY,
  SMART_CALL_STATE.CANCELLED,
]);

const ACTIVE_STATES = new Set<SmartCallState>([
  SMART_CALL_STATE.CREATED,
  SMART_CALL_STATE.RINGING,
  SMART_CALL_STATE.ANSWERED,
  SMART_CALL_STATE.ACTIVE,
]);

const TRANSITIONS: Record<SmartCallState, ReadonlySet<SmartCallState>> = {
  [SMART_CALL_STATE.CREATED]: new Set([
    SMART_CALL_STATE.RINGING,
    SMART_CALL_STATE.ANSWERED,
    SMART_CALL_STATE.BUSY,
    SMART_CALL_STATE.MISSED,
    SMART_CALL_STATE.CANCELLED,
    SMART_CALL_STATE.FAILED,
    SMART_CALL_STATE.ENDED,
  ]),
  [SMART_CALL_STATE.RINGING]: new Set([
    SMART_CALL_STATE.ANSWERED,
    SMART_CALL_STATE.ACTIVE,
    SMART_CALL_STATE.BUSY,
    SMART_CALL_STATE.MISSED,
    SMART_CALL_STATE.FAILED,
    SMART_CALL_STATE.CANCELLED,
    SMART_CALL_STATE.ENDED,
  ]),
  [SMART_CALL_STATE.ANSWERED]: new Set([
    SMART_CALL_STATE.ACTIVE,
    SMART_CALL_STATE.ENDED,
    SMART_CALL_STATE.FAILED,
  ]),
  [SMART_CALL_STATE.ACTIVE]: new Set([
    SMART_CALL_STATE.ENDED,
    SMART_CALL_STATE.FAILED,
  ]),
  [SMART_CALL_STATE.ENDED]: new Set(),
  [SMART_CALL_STATE.FAILED]: new Set(),
  [SMART_CALL_STATE.MISSED]: new Set(),
  [SMART_CALL_STATE.BUSY]: new Set(),
  [SMART_CALL_STATE.CANCELLED]: new Set(),
};

export function normalizeSmartCallState(input: string | null | undefined): SmartCallState | null {
  const value = (input || "").trim().toLowerCase();
  switch (value) {
    case "created":
    case "pending":
      return SMART_CALL_STATE.CREATED;
    case "ringing":
      return SMART_CALL_STATE.RINGING;
    case "answered":
    case "accepted":
      return SMART_CALL_STATE.ANSWERED;
    case "active":
    case "connected":
      return SMART_CALL_STATE.ACTIVE;
    case "ended":
    case "completed":
      return SMART_CALL_STATE.ENDED;
    case "failed":
      return SMART_CALL_STATE.FAILED;
    case "missed":
    case "no-answer":
      return SMART_CALL_STATE.MISSED;
    case "busy":
      return SMART_CALL_STATE.BUSY;
    case "cancelled":
    case "canceled":
    case "rejected":
      return SMART_CALL_STATE.CANCELLED;
    default:
      return null;
  }
}

export function isActiveSmartCallState(state: SmartCallState): boolean {
  return ACTIVE_STATES.has(state);
}

export function isTerminalSmartCallState(state: SmartCallState): boolean {
  return TERMINAL_STATES.has(state);
}

export function canTransitionSmartCallState(
  current: SmartCallState,
  next: SmartCallState,
): boolean {
  return current === next || TRANSITIONS[current].has(next);
}

export function assertSmartCallTransition(
  current: SmartCallState,
  next: SmartCallState,
): void {
  if (!canTransitionSmartCallState(current, next)) {
    throw new Error(`INVALID_CALL_STATE_TRANSITION:${current}->${next}`);
  }
}
