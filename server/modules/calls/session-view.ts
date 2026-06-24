import { communicationSessions } from "@shared/schema";
import type { CallInitiateResponse, SmartCallRecord } from "./service";

type CommunicationSessionRow = typeof communicationSessions.$inferSelect;

export interface UnifiedCallPartyView {
  userId: string | null;
  externalId: string | null;
  phoneNumber: string | null;
  displayName: string | null;
}

export interface UnifiedCallSessionView {
  id: string;
  callId: string;
  sessionId: string;
  status: string;
  routeType: string;
  transport: string;
  provider: string | null;
  callType: string;
  sourceLanguage: string | null;
  targetLanguage: string | null;
  translationEnabled: boolean | null;
  translationMode: string | null;
  callerIdentityMode: string | null;
  callerIdentityDisclaimer: string | null;
  caller: UnifiedCallPartyView;
  callee: UnifiedCallPartyView;
  maskedNumber: string | null;
  livekitUrl: string | null;
  pstnCallId: string | null;
  createdAt: string | null;
  connectedAt: string | null;
  endedAt: string | null;
  durationSeconds: number | null;
  statusSource: "smart-router" | "legacy-gateway" | "communication-api" | "enterprise-memory";
  metadata: Record<string, unknown>;
}

function parseMetadata(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function deriveDurationSeconds(connectedAt?: string | Date | null, endedAt?: string | Date | null): number | null {
  const connectedMs = connectedAt ? new Date(connectedAt).getTime() : NaN;
  if (!Number.isFinite(connectedMs)) return null;
  const endedMs = endedAt ? new Date(endedAt).getTime() : Date.now();
  return Math.max(0, Math.floor((endedMs - connectedMs) / 1000));
}

function buildRouteType(joinMethod?: string | null, provider?: string | null): string {
  if (joinMethod === "app_to_app" || joinMethod === "app_to_pstn" || joinMethod === "conference") {
    return joinMethod;
  }
  if (provider === "conference") return "conference";
  if (provider) return provider;
  return "legacy_bridge";
}

export function buildUnifiedSessionFromSmartCall(record: SmartCallRecord): UnifiedCallSessionView {
  const metadata = parseMetadata(record.metadata);
  return {
    id: record.callId,
    callId: record.callId,
    sessionId: record.callId,
    status: record.status,
    routeType: buildRouteType(record.joinMethod, record.provider ?? null),
    transport: record.joinMethod === "app_to_app" ? "livekit" : "livekit_pstn_bridge",
    provider: record.provider ?? null,
    callType: record.callType,
    sourceLanguage: record.callerLanguage ?? null,
    targetLanguage: record.calleeLanguage ?? null,
    translationEnabled: record.languageDetectionActive,
    translationMode: typeof metadata.translationMode === "string" ? metadata.translationMode : null,
    callerIdentityMode: typeof metadata.callerIdentityMode === "string" ? metadata.callerIdentityMode : null,
    callerIdentityDisclaimer: typeof metadata.callerIdentityDisclaimer === "string" ? metadata.callerIdentityDisclaimer : null,
    caller: {
      userId: record.callerId ?? null,
      externalId: record.callerId ?? null,
      phoneNumber: record.callerNumber ?? null,
      displayName: typeof metadata.callerDisplayName === "string" ? metadata.callerDisplayName : null,
    },
    callee: {
      userId: record.calleeUserId ?? null,
      externalId: record.calleeUserId ?? record.calleeIdentifier,
      phoneNumber: record.joinMethod === "app_to_pstn" ? record.calleeIdentifier : null,
      displayName: typeof metadata.calleeDisplayName === "string" ? metadata.calleeDisplayName : null,
    },
    maskedNumber: typeof metadata.maskedNumber === "string" ? metadata.maskedNumber : null,
    livekitUrl: record.livekitUrl ?? null,
    pstnCallId: record.pstnCallId ?? null,
    createdAt: record.createdAt ?? null,
    connectedAt: record.connectedAt ?? null,
    endedAt: record.endedAt ?? null,
    durationSeconds: deriveDurationSeconds(record.connectedAt, record.endedAt),
    statusSource: "smart-router",
    metadata,
  };
}

export function buildUnifiedSessionFromLegacyCall(call: Record<string, unknown>): UnifiedCallSessionView {
  const callerUserId = typeof call.callerUserId === "number" ? String(call.callerUserId) : null;
  const receiverUserId = typeof call.receiverUserId === "number" ? String(call.receiverUserId) : null;
  const metadata = parseMetadata(call.metadata);
  const callId = String(call.callId ?? call.id ?? "");
  const connectedAt = call.connectedAt instanceof Date || typeof call.connectedAt === "string" ? call.connectedAt : null;
  const endedAt = call.endedAt instanceof Date || typeof call.endedAt === "string" ? call.endedAt : null;

  return {
    id: callId,
    callId,
    sessionId: callId,
    status: typeof call.status === "string" ? call.status : "unknown",
    routeType: "legacy_bridge",
    transport: "legacy_bridge",
    provider: typeof call.provider === "string" ? call.provider : null,
    callType: typeof call.callType === "string" ? call.callType : "voice",
    sourceLanguage: typeof call.callerLanguage === "string" ? call.callerLanguage : null,
    targetLanguage: typeof call.receiverLanguage === "string" ? call.receiverLanguage : null,
    translationEnabled: typeof call.translationEnabled === "boolean" ? call.translationEnabled : null,
    translationMode: typeof metadata.translationMode === "string" ? metadata.translationMode : null,
    callerIdentityMode: typeof metadata.callerIdentityMode === "string" ? metadata.callerIdentityMode : null,
    callerIdentityDisclaimer: typeof metadata.callerIdentityDisclaimer === "string" ? metadata.callerIdentityDisclaimer : null,
    caller: {
      userId: callerUserId,
      externalId: callerUserId,
      phoneNumber: typeof call.callerNumber === "string" ? call.callerNumber : null,
      displayName: typeof metadata.callerDisplayName === "string" ? metadata.callerDisplayName : null,
    },
    callee: {
      userId: receiverUserId,
      externalId: receiverUserId,
      phoneNumber: typeof call.receiverNumber === "string" ? call.receiverNumber : null,
      displayName: typeof metadata.calleeDisplayName === "string" ? metadata.calleeDisplayName : null,
    },
    maskedNumber: typeof metadata.maskedNumber === "string" ? metadata.maskedNumber : null,
    livekitUrl: typeof call.livekitUrl === "string" ? call.livekitUrl : null,
    pstnCallId: typeof call.pstnCallId === "string" ? call.pstnCallId : null,
    createdAt: call.createdAt instanceof Date ? call.createdAt.toISOString() : typeof call.createdAt === "string" ? call.createdAt : null,
    connectedAt: connectedAt instanceof Date ? connectedAt.toISOString() : typeof connectedAt === "string" ? connectedAt : null,
    endedAt: endedAt instanceof Date ? endedAt.toISOString() : typeof endedAt === "string" ? endedAt : null,
    durationSeconds: deriveDurationSeconds(connectedAt, endedAt),
    statusSource: "legacy-gateway",
    metadata,
  };
}

export function buildUnifiedSessionFromCommunicationSession(
  session: CommunicationSessionRow,
  opts: {
    smartCallStatus?: string | null;
    provider?: string | null;
    livekitUrl?: string | null;
    durationSeconds?: number | null;
  } = {},
): UnifiedCallSessionView {
  const metadata = parseMetadata(session.metadata);
  const telemetry = parseMetadata(session.telemetry);
  return {
    id: session.sessionId,
    callId: session.sessionId,
    sessionId: session.sessionId,
    status: opts.smartCallStatus ?? session.status,
    routeType: buildRouteType(session.joinMethod, opts.provider ?? null),
    transport: session.transport || "webrtc",
    provider: opts.provider ?? null,
    callType: session.callType,
    sourceLanguage: session.callerLanguage ?? null,
    targetLanguage: session.calleeLanguage ?? null,
    translationEnabled: session.aiAssistantEnabled ?? true,
    translationMode: typeof metadata.translationMode === "string" ? metadata.translationMode : null,
    callerIdentityMode: typeof metadata.callerIdentityMode === "string" ? metadata.callerIdentityMode : null,
    callerIdentityDisclaimer: typeof metadata.callerIdentityDisclaimer === "string" ? metadata.callerIdentityDisclaimer : null,
    caller: {
      userId: session.callerIdentity,
      externalId: session.callerIdentity,
      phoneNumber: session.callerPhoneNumber ?? null,
      displayName: session.callerDisplayName ?? null,
    },
    callee: {
      userId: session.calleeIdentity,
      externalId: session.calleeIdentity,
      phoneNumber: session.calleePhoneNumber ?? null,
      displayName: session.calleeDisplayName ?? null,
    },
    maskedNumber: session.maskedNumber ?? null,
    livekitUrl: opts.livekitUrl ?? null,
    pstnCallId: session.pstnCallId ?? null,
    createdAt: session.createdAt ? session.createdAt.toISOString() : null,
    connectedAt: session.connectedAt ? session.connectedAt.toISOString() : null,
    endedAt: session.endedAt ? session.endedAt.toISOString() : null,
    durationSeconds: opts.durationSeconds ?? deriveDurationSeconds(session.connectedAt, session.endedAt),
    statusSource: "communication-api",
    metadata: {
      ...metadata,
      telemetry,
    },
  };
}

export function buildUnifiedSessionFromInitiateResponse(
  result: CallInitiateResponse,
  input: {
    callerId: string;
    callerNumber?: string | null;
    callerDisplayName?: string | null;
    calleeIdentifier: string;
    calleeDisplayName?: string | null;
    callerLanguage?: string | null;
    calleeLanguage?: string | null;
    translationMode?: string | null;
    translationEnabled?: boolean | null;
  },
): UnifiedCallSessionView {
  return {
    id: result.callId,
    callId: result.callId,
    sessionId: result.callId,
    status: result.joinMethod === "app_to_pstn" ? "ringing" : "created",
    routeType: result.joinMethod,
    transport: result.joinMethod === "app_to_app" ? "livekit" : "livekit_pstn_bridge",
    provider: result.joinMethod === "app_to_pstn" ? "msg91_sip" : "livekit",
    callType: result.effectiveCallType || "voice",
    sourceLanguage: input.callerLanguage ?? null,
    targetLanguage: input.calleeLanguage ?? null,
    translationEnabled: input.translationEnabled ?? result.languageDetectionActive,
    translationMode: input.translationMode ?? null,
    callerIdentityMode: result.callerIdentityMode ?? null,
    callerIdentityDisclaimer: result.callerIdentityDisclaimer ?? null,
    caller: {
      userId: input.callerId,
      externalId: input.callerId,
      phoneNumber: input.callerNumber ?? null,
      displayName: input.callerDisplayName ?? null,
    },
    callee: {
      userId: null,
      externalId: input.calleeIdentifier,
      phoneNumber: result.joinMethod === "app_to_pstn" ? input.calleeIdentifier : null,
      displayName: input.calleeDisplayName ?? null,
    },
    maskedNumber: null,
    livekitUrl: result.livekitUrl ?? null,
    pstnCallId: result.pstnCallId ?? null,
    createdAt: new Date().toISOString(),
    connectedAt: null,
    endedAt: null,
    durationSeconds: null,
    statusSource: "smart-router",
    metadata: {
      operationalWarnings: result.operationalWarnings || [],
      estimatedRateInrPerMin: result.estimatedRateInrPerMin,
      languageDetectionActive: result.languageDetectionActive,
    },
  };
}
