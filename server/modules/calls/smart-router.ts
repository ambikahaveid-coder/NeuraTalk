import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import {
  BillingEngine,
  billingEvents,
  type CallBillingActivation,
} from "../../billing-engine";
import {
  finalizeCallBilling,
  initCallLanguageTracking,
  setParticipantLanguagePreference,
} from "../../universal-language-runtime";
import { createCallRoom, endCallRoom, issueAccessToken, issueBotToken } from "../../livekit-service";
import { bridgeCallToLiveKitRoom } from "../../msg91-service";
import { logger } from "../../observability";
import { persistCompletedCall } from "../../call-persistence";
import { getRedisClient } from "../../redis";
import { storage } from "../../storage";
import type { StrictBillingPlanConfig } from "../../billing-config";
import {
  assertSmartCallTransition,
  isActiveSmartCallState,
  isTerminalSmartCallState,
  normalizeSmartCallState,
  SMART_CALL_STATE,
  type SmartCallState,
} from "./lifecycle";

function redisClient() {
  return getRedisClient();
}

const SMART_CALL_TTL_SECONDS = 60 * 60 * 24;
const PROVIDER_TIMEOUT_ACTIVE_MS = parsePositiveInt(process.env.SMART_CALL_PROVIDER_TIMEOUT_ACTIVE_MS, 60_000);
const PROVIDER_TIMEOUT_RINGING_MS = parsePositiveInt(process.env.SMART_CALL_PROVIDER_TIMEOUT_RINGING_MS, 90_000);
const MEDIA_HEARTBEAT_INTERVAL_MS = parsePositiveInt(process.env.SMART_CALL_MEDIA_HEARTBEAT_INTERVAL_MS, 1_000);
let billingTerminationBound = false;
let watchdogStarted = false;

export const smartCallEvents = new EventEmitter();
smartCallEvents.setMaxListeners(64);

function elapsedMs(startNs: bigint): number {
  return Number((Number(process.hrtime.bigint() - startNs) / 1_000_000).toFixed(3));
}

function logSetupLatency(callId: string, joinMethod: JoinMethod, stage: string, latencyMs: number): void {
  try {
    console.log(JSON.stringify({
      type: "call_setup_latency",
      callId,
      joinMethod,
      stage,
      latencyMs,
      ts: Date.now(),
    }));
  } catch {
    // ignore setup audit logging failures
  }
}

export type JoinMethod = "app_to_app" | "app_to_pstn" | "conference";

export interface CallInitiateRequest {
  sessionIdOverride?: string;
  callerId: string;
  callerNumber: string;
  callerLanguage?: string;
  calleeIdentifier: string;
  calleeLanguage?: string;
  callType: "voice" | "video";
  enableLipsync?: boolean;
  enableRecording?: boolean;
  transportPreference?: "app_to_app" | "app_to_pstn" | "auto";
  callerDisplayName?: string;
  calleeDisplayName?: string;
  callerOrganizationIdOverride?: number | null;
  pricingOverride?: Partial<StrictBillingPlanConfig> | null;
  pstnFallbackRatePerMinutePaise?: number;
}

export interface CallInitiateResponse {
  callId: string;
  joinMethod: JoinMethod;
  livekitUrl?: string;
  livekitToken?: string;
  pstnCallId?: string;
  estimatedRateInrPerMin: number;
  languageDetectionActive: boolean;
}

export interface SmartCallRecord {
  callId: string;
  joinMethod: JoinMethod;
  status: SmartCallState;
  callerId: string;
  callerOrganizationId?: number | null;
  callerNumber?: string | null;
  calleeIdentifier: string;
  calleeUserId?: string | null;
  calleeOrganizationId?: number | null;
  callType: "voice" | "video";
  callerLanguage: string;
  calleeLanguage?: string | null;
  livekitUrl?: string | null;
  pstnCallId?: string | null;
  languageDetectionActive: boolean;
  estimatedRateInrPerMin: number;
  createdAt: string;
  billingActivatedAt?: string | null;
  connectedAt?: string | null;
  endedAt?: string | null;
  lastProviderEventAt?: string | null;
  lastMediaActivityAt?: string | null;
  terminationReason?: string | null;
  provider?: "livekit" | "msg91_sip" | "conference";
  metadata?: Record<string, unknown>;
}

function smartCallKey(callId: string): string {
  return `smart_call:${callId}`;
}

function smartCallUserIndexKey(userId: string): string {
  return `smart_call:user:${userId}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

function latestHeartbeat(record: SmartCallRecord): number {
  const timestamps = [
    record.lastMediaActivityAt,
    record.lastProviderEventAt,
    record.connectedAt,
    record.billingActivatedAt,
    record.createdAt,
  ]
    .map((value) => (value ? Date.parse(value) : NaN))
    .filter((value) => Number.isFinite(value));

  return timestamps.length > 0 ? Math.max(...timestamps) : Date.now();
}

function emitStructuredCallEvent(
  event: string,
  record: SmartCallRecord,
  metadata: Record<string, unknown> = {},
): void {
  const payload = {
    event,
    callId: record.callId,
    joinMethod: record.joinMethod,
    status: record.status,
    provider: record.provider || null,
    callerId: record.callerId,
    calleeIdentifier: record.calleeIdentifier,
    callType: record.callType,
    ...metadata,
  };

  logger.info("SmartCallLifecycle", event, payload);
  smartCallEvents.emit(event, payload);
}

function isActiveSmartCallStatus(status: string): boolean {
  const state = normalizeSmartCallState(status);
  return !!state && isActiveSmartCallState(state);
}

function buildLiveKitSipUri(callId: string): string {
  const sipDomain = process.env.LIVEKIT_SIP_DOMAIN || "sip.livekit.local";
  return `sip:${callId}@${sipDomain}`;
}

async function resolveCallee(identifier: string): Promise<{
  hasApp: boolean;
  userId?: string;
  phoneNumber?: string;
  preferredLanguage?: string;
}> {
  const isPhone = /^\+?\d{10,15}$/.test(identifier.replace(/\s+/g, ""));

  if (isPhone) {
    const user = await storage.getUserByPhone(identifier);
    if (user) {
      return {
        hasApp: true,
        userId: String(user.id),
        phoneNumber: identifier,
        preferredLanguage: (user as any).preferredLanguage,
      };
    }

    return { hasApp: false, phoneNumber: identifier };
  }

  const asNum = Number(identifier);
  const user = Number.isFinite(asNum) ? await storage.getUser(asNum) : undefined;
  if (!user) {
    return { hasApp: false };
  }

  return {
    hasApp: true,
    userId: String(user.id),
    phoneNumber: (user as any).phone ?? undefined,
    preferredLanguage: (user as any).preferredLanguage,
  };
}

async function storeSmartCall(record: SmartCallRecord): Promise<void> {
  const score = Date.parse(record.createdAt) || Date.now();
  const multi = redisClient().multi();

  multi.set(smartCallKey(record.callId), JSON.stringify(record), "EX", SMART_CALL_TTL_SECONDS);

  if (isActiveSmartCallStatus(record.status)) {
    multi.sadd("smart_call:active", record.callId);
  } else {
    multi.srem("smart_call:active", record.callId);
  }

  multi.zadd(smartCallUserIndexKey(record.callerId), score, record.callId);
  multi.expire(smartCallUserIndexKey(record.callerId), SMART_CALL_TTL_SECONDS);

  if (record.calleeUserId) {
    multi.zadd(smartCallUserIndexKey(record.calleeUserId), score, record.callId);
    multi.expire(smartCallUserIndexKey(record.calleeUserId), SMART_CALL_TTL_SECONDS);
  }

  const participantIds = Array.isArray(record.metadata?.participantIds)
    ? (record.metadata?.participantIds as unknown[]).filter(
        (value): value is string => typeof value === "string" && value.length > 0,
      )
    : [];

  for (const participantId of participantIds) {
    multi.zadd(smartCallUserIndexKey(participantId), score, record.callId);
    multi.expire(smartCallUserIndexKey(participantId), SMART_CALL_TTL_SECONDS);
  }

  await multi.exec();
}

async function mutateSmartCall(
  callId: string,
  updater: (current: SmartCallRecord) => SmartCallRecord,
): Promise<SmartCallRecord | null> {
  const current = await getSmartCall(callId);
  if (!current) {
    return null;
  }

  const next = updater(current);
  await storeSmartCall(next);
  return next;
}

function billingStatusForState(state: SmartCallState): string {
  switch (state) {
    case SMART_CALL_STATE.CREATED:
      return "created";
    case SMART_CALL_STATE.RINGING:
      return "ringing";
    case SMART_CALL_STATE.ANSWERED:
      return "answered";
    case SMART_CALL_STATE.ACTIVE:
      return "active";
    default:
      return state;
  }
}

async function activateBillingForCall(callId: string): Promise<CallBillingActivation | null> {
  try {
    return await BillingEngine.activateCallSession(callId);
  } catch (error) {
    logger.warn("SmartCallRouter", `billing activation failed for ${callId}: ${String(error)}`);
    return null;
  }
}

async function clearProvisionedCall(callId: string, callerId?: string | null): Promise<void> {
  if (callerId) {
    await redisClient().del(`user:active_call:${callerId}`);
  } else {
    const storedCallerId = await redisClient().get(`call_metadata:${callId}:caller`);
    if (storedCallerId) {
      await redisClient().del(`user:active_call:${storedCallerId}`);
    }
  }

  const multi = redisClient().multi();
  multi.del(`call_metadata:${callId}:caller`);
  multi.srem("smart_call:active", callId);
  await multi.exec();

  try {
    await endCallRoom(callId);
  } catch (error) {
    logger.warn("SmartCallRouter", `failed to cleanup room ${callId}: ${String(error)}`);
  }
}

async function noteProviderEvent(
  callId: string,
  metadata?: Record<string, unknown>,
): Promise<SmartCallRecord | null> {
  const timestamp = nowIso();
  return await mutateSmartCall(callId, (current) => ({
    ...current,
    lastProviderEventAt: timestamp,
    metadata: metadata ? { ...(current.metadata || {}), ...metadata } : current.metadata,
  }));
}

export async function recordSmartCallProviderEvent(
  callId: string,
  metadata?: Record<string, unknown>,
): Promise<SmartCallRecord | null> {
  return await noteProviderEvent(callId, metadata).catch(() => null);
}

export async function recordSmartCallMediaActivity(
  callId: string,
  participantIdentity?: string,
): Promise<SmartCallRecord | null> {
  const timestamp = nowIso();
  return await mutateSmartCall(callId, (current) => {
    if (current.lastMediaActivityAt) {
      const elapsed = Date.now() - Date.parse(current.lastMediaActivityAt);
      if (Number.isFinite(elapsed) && elapsed < MEDIA_HEARTBEAT_INTERVAL_MS) {
        return current;
      }
    }

    return {
      ...current,
      lastMediaActivityAt: timestamp,
      metadata: participantIdentity
        ? {
            ...(current.metadata || {}),
            lastMediaParticipant: participantIdentity,
          }
        : current.metadata,
    };
  }).catch(() => null);
}

function ensureSmartCallWatchdog(): void {
  if (watchdogStarted) {
    return;
  }

  watchdogStarted = true;
  setInterval(() => {
    void processSmartCallWatchdog();
  }, 5_000).unref?.();
}

async function processSmartCallWatchdog(): Promise<void> {
  const activeCalls = await listSmartActiveCalls();
  const nowMs = Date.now();

  await Promise.all(activeCalls.map(async (record) => {
    if (record.joinMethod !== "app_to_pstn") {
      return;
    }

    const referenceMs = latestHeartbeat(record);
    const timeoutMs = record.status === SMART_CALL_STATE.ACTIVE
      ? PROVIDER_TIMEOUT_ACTIVE_MS
      : PROVIDER_TIMEOUT_RINGING_MS;

    if (!Number.isFinite(referenceMs) || nowMs - referenceMs < timeoutMs) {
      return;
    }

    logger.warn("SmartCallRouter", `provider timeout watchdog ending ${record.callId}`, {
      callId: record.callId,
      status: record.status,
      lastProviderEventAt: record.lastProviderEventAt ?? null,
      lastMediaActivityAt: record.lastMediaActivityAt ?? null,
      timeoutMs,
    });

    await endCall(record.callId, "PROVIDER_TIMEOUT").catch((error) => {
      logger.error("SmartCallRouter", `watchdog failed to end ${record.callId}`, error as Error);
    });
  }));
}

export function isSmartCallId(callId: string): boolean {
  return callId.startsWith("call_") || callId.startsWith("conf_");
}

function ensureBillingTerminationBinding() {
  if (billingTerminationBound) {
    return;
  }

  billingTerminationBound = true;
  billingEvents.on("session.termination_requested", ({ sessionId, reason }) => {
    if (!isSmartCallId(sessionId)) {
      return;
    }

    if (reason === "INSUFFICIENT_BALANCE" || reason === "CREDIT_LIMIT_EXCEEDED" || reason === "DAILY_USAGE_LIMIT_REACHED") {
      logger.warn("SmartCallBilling", "balance_low_triggered", {
        callId: sessionId,
        reason,
      });
      smartCallEvents.emit("balance_low_triggered", {
        callId: sessionId,
        reason,
      });
    }

    void endCall(sessionId, reason).catch((error) => {
      logger.error("SmartCallRouter", `failed to end ${sessionId} after billing termination: ${String(error)}`);
    });
  });
}

ensureBillingTerminationBinding();
ensureSmartCallWatchdog();

export async function getSmartCall(callId: string): Promise<SmartCallRecord | null> {
  if (!isSmartCallId(callId)) {
    return null;
  }

  const raw = await redisClient().get(smartCallKey(callId));
  if (!raw) {
    return null;
  }

  try {
    return parseSmartCallRecord(raw);
  } catch (error) {
    logger.warn("SmartCallRouter", `invalid smart call payload for ${callId}: ${String(error)}`);
    return null;
  }
}

function parseSmartCallRecord(raw: string): SmartCallRecord {
  const parsed = JSON.parse(raw) as SmartCallRecord;
  const normalizedStatus = normalizeSmartCallState(parsed.status) ?? SMART_CALL_STATE.CREATED;
  return {
    ...parsed,
    status: normalizedStatus,
    provider: parsed.provider || (parsed.joinMethod === "app_to_pstn" ? "msg91_sip" : parsed.joinMethod === "conference" ? "conference" : "livekit"),
    billingActivatedAt: parsed.billingActivatedAt ?? null,
    lastProviderEventAt: parsed.lastProviderEventAt ?? null,
    lastMediaActivityAt: parsed.lastMediaActivityAt ?? null,
    terminationReason: parsed.terminationReason ?? null,
  };
}

export async function listSmartCallsForUser(userId: string): Promise<SmartCallRecord[]> {
  const callIds = await redisClient().zrevrange(smartCallUserIndexKey(userId), 0, 99);
  if (callIds.length === 0) {
    return [];
  }

  const rawRecords = await redisClient().mget(callIds.map((callId) => smartCallKey(callId)));
  return rawRecords.flatMap((raw) => {
    if (!raw) {
      return [];
    }

    try {
      return [parseSmartCallRecord(raw)];
    } catch {
      return [];
    }
  });
}

export async function listSmartActiveCalls(): Promise<SmartCallRecord[]> {
  const callIds = await redisClient().smembers("smart_call:active");
  if (callIds.length === 0) {
    return [];
  }

  const rawRecords = await redisClient().mget(callIds.map((callId) => smartCallKey(callId)));
  return rawRecords.flatMap((raw) => {
    if (!raw) {
      return [];
    }

    try {
      const record = parseSmartCallRecord(raw);
      return isActiveSmartCallStatus(record.status) ? [record] : [];
    } catch {
      return [];
    }
  });
}

export async function updateSmartCallStatus(
  callId: string,
  status: string,
  metadata?: Record<string, unknown>,
): Promise<SmartCallRecord | null> {
  const nextState = normalizeSmartCallState(status);
  if (!nextState) {
    throw new Error(`UNSUPPORTED_CALL_STATE:${status}`);
  }

  const previous = await getSmartCall(callId);
  const previousStatus = previous?.status ?? null;

  const nowIso = new Date().toISOString();
  const updated = await mutateSmartCall(callId, (current) => {
    const currentState = normalizeSmartCallState(current.status) ?? SMART_CALL_STATE.CREATED;
    assertSmartCallTransition(currentState, nextState);
    const providerEvent = current.joinMethod === "app_to_pstn"
      && (metadata?.providerStatus !== undefined || nextState === SMART_CALL_STATE.RINGING || nextState === SMART_CALL_STATE.ANSWERED || nextState === SMART_CALL_STATE.ACTIVE);

    return {
      ...current,
      status: nextState,
      billingActivatedAt: current.billingActivatedAt ?? null,
      lastProviderEventAt: providerEvent ? nowIso : current.lastProviderEventAt ?? null,
      connectedAt: nextState === SMART_CALL_STATE.ACTIVE
        ? current.connectedAt || nowIso
        : current.connectedAt ?? null,
      endedAt: isTerminalSmartCallState(nextState) ? current.endedAt || nowIso : null,
      terminationReason: isTerminalSmartCallState(nextState)
        ? String(metadata?.endReason || current.terminationReason || status)
        : current.terminationReason ?? null,
      metadata: metadata
        ? { ...(current.metadata || {}), ...metadata }
        : current.metadata,
    };
  });

  if (!updated) {
    return null;
  }

  if (nextState === SMART_CALL_STATE.ANSWERED || nextState === SMART_CALL_STATE.ACTIVE) {
    const activation = await activateBillingForCall(callId);
    if (activation && updated.billingActivatedAt !== new Date(activation.activatedAtMs).toISOString()) {
      updated.billingActivatedAt = new Date(activation.activatedAtMs).toISOString();
      await storeSmartCall(updated);
      logger.info("SmartCallBilling", "billing_started", {
        callId,
        activatedAt: updated.billingActivatedAt,
        estimatedRateInrPerMin: updated.estimatedRateInrPerMin,
      });
      smartCallEvents.emit("billing_started", {
        callId,
        activatedAt: updated.billingActivatedAt,
        estimatedRateInrPerMin: updated.estimatedRateInrPerMin,
      });
    }
  }

  if (!isTerminalSmartCallState(nextState)) {
    await BillingEngine.setCallSessionStatus(callId, billingStatusForState(nextState)).catch((error) => {
      logger.warn("SmartCallRouter", `billing status sync failed for ${callId}: ${String(error)}`);
    });
  }

  const lifecycleEvent = nextState === SMART_CALL_STATE.RINGING
    ? "call_ringing"
    : nextState === SMART_CALL_STATE.ANSWERED
      ? "call_answered"
      : nextState === SMART_CALL_STATE.ACTIVE
        ? "call_active"
        : nextState === SMART_CALL_STATE.CREATED
          ? "call_created"
          : "call_state_terminal";
  emitStructuredCallEvent(lifecycleEvent, updated, {
    previousStatus,
    metadata: metadata || {},
  });
  smartCallEvents.emit("status_changed", {
    callId,
    status: updated.status,
    metadata: metadata || {},
  });

  return updated;
}

async function sendIncomingCallPush(
  userId: string,
  payload: { callId: string; callerId: string; callType: string },
): Promise<void> {
  try {
    const mod: any = await import("../../firebase-admin").catch(() => ({}));
    if (typeof mod.sendVoIPPush === "function") {
      await mod.sendVoIPPush(userId, payload);
    }
  } catch (error) {
    logger.warn("SmartCallRouter", `push failed for ${userId}: ${String(error)}`);
  }
}

async function spawnTranslatorBot(callId: string, botToken: string): Promise<void> {
  try {
    const mod: any = await import("../../translator-bot").catch(() => ({}));
    if (typeof mod.startBotWorker === "function") {
      await mod.startBotWorker(callId, botToken);
    } else {
      logger.warn("SmartCallRouter", `translator-bot module not found - call ${callId} has no translation`);
    }
  } catch (error) {
    logger.error("SmartCallRouter", `bot worker start failed: ${String(error)}`);
  }
}

export async function initiateCall(req: CallInitiateRequest): Promise<CallInitiateResponse> {
  const callId = req.sessionIdOverride?.trim() || `call_${randomUUID()}`;
  const callerLanguage = (req.callerLanguage || "auto").trim().toLowerCase() || "auto";
  const activeCallKey = `user:active_call:${req.callerId}`;
  const alreadyInCall = await redisClient().get(activeCallKey);
  if (alreadyInCall) {
    throw new Error("CONCURRENT_CALL_RESTRICTED");
  }

  const callee = await resolveCallee(req.calleeIdentifier);
  const callerUserId = Number.isFinite(Number(req.callerId)) ? Number(req.callerId) : null;
  const callerUser = callerUserId ? await storage.getUser(callerUserId) : undefined;
  const calleeUserId = callee.userId && Number.isFinite(Number(callee.userId)) ? Number(callee.userId) : null;
  const calleeUser = calleeUserId ? await storage.getUser(calleeUserId) : undefined;
  const effectiveCalleeLanguage = (req.calleeLanguage ?? callee.preferredLanguage ?? "auto")?.trim().toLowerCase() || "auto";
  const requestedJoinMethod = req.transportPreference === "app_to_pstn"
    ? "app_to_pstn"
    : req.transportPreference === "app_to_app"
      ? "app_to_app"
      : callee.hasApp && callee.userId
        ? "app_to_app"
        : "app_to_pstn";
  const translationEnabled = callerLanguage === "auto" || effectiveCalleeLanguage === "auto"
    ? true
    : effectiveCalleeLanguage !== callerLanguage;
  const billingOverride: Partial<StrictBillingPlanConfig> | null = req.pricingOverride
    ? JSON.parse(JSON.stringify(req.pricingOverride)) as Partial<StrictBillingPlanConfig>
    : null;

  if (requestedJoinMethod === "app_to_pstn" && req.pstnFallbackRatePerMinutePaise && billingOverride) {
    const currentRates = billingOverride.rates || {
      voicePerMinutePaise: 0,
      videoPerMinutePaise: 0,
      translationPerMinutePaise: 0,
      recordingPerMinutePaise: 0,
    };
    const pstnRate = Math.max(0, req.pstnFallbackRatePerMinutePaise);
    billingOverride.rates = {
      ...currentRates,
      voicePerMinutePaise: Math.max(0, (currentRates.voicePerMinutePaise || 0) + pstnRate),
      videoPerMinutePaise: Math.max(0, (currentRates.videoPerMinutePaise || currentRates.voicePerMinutePaise || 0) + pstnRate),
      translationPerMinutePaise: currentRates.translationPerMinutePaise || 0,
      recordingPerMinutePaise: currentRates.recordingPerMinutePaise || 0,
    };
  }

  const auth = await BillingEngine.startCallSession({
    sessionId: callId,
    userId: callerUserId,
    organizationId: req.callerOrganizationIdOverride ?? callerUser?.organizationId ?? null,
    callType: req.callType,
    translationEnabled,
    recordingEnabled: !!req.enableRecording,
    joinMethod: requestedJoinMethod,
    activateOnAnswer: true,
    pricingOverride: billingOverride,
  });
  if (!auth.allowed) {
    throw new Error(auth.reason || "PAYMENT_REQUIRED");
  }

  const planRateInrPerMin = auth.estimatedRatePerMinutePaise / 100;

  let stageStartNs = process.hrtime.bigint();
  await createCallRoom({
    callId,
    maxParticipants: req.callType === "video" ? 10 : 4,
    emptyTimeoutSec: 120,
    metadata: {
      callerId: req.callerId,
      calleeIdentifier: req.calleeIdentifier,
      callType: req.callType,
      lipsync: !!req.enableLipsync,
      recording: !!req.enableRecording,
    },
  });
  logSetupLatency(callId, requestedJoinMethod, "create_room", elapsedMs(stageStartNs));

  await initCallLanguageTracking(callId, [
    { speakerId: req.callerId, preferredLanguage: callerLanguage },
    ...(callee.userId ? [{ speakerId: callee.userId, preferredLanguage: effectiveCalleeLanguage }] : []),
    ...(!callee.userId && callee.phoneNumber ? [{ speakerId: `pstn:${callee.phoneNumber}`, preferredLanguage: effectiveCalleeLanguage }] : []),
  ]);

  stageStartNs = process.hrtime.bigint();
  const callerToken = await issueAccessToken(callId, {
    userId: req.callerId,
    displayName: req.callerDisplayName || req.callerId,
    language: callerLanguage,
    role: "caller",
  });
  logSetupLatency(callId, requestedJoinMethod, "issue_caller_token", elapsedMs(stageStartNs));

  stageStartNs = process.hrtime.bigint();
  const botToken = await issueBotToken(callId);
  logSetupLatency(callId, requestedJoinMethod, "issue_bot_token", elapsedMs(stageStartNs));
  spawnTranslatorBot(callId, botToken).catch((error) =>
    logger.error("SmartCallRouter", `bot spawn failed: ${String(error)}`),
  );

  await redisClient().set(activeCallKey, callId, "EX", 3600);
  await redisClient().set(`call_metadata:${callId}:caller`, req.callerId);

  await storeSmartCall({
    callId,
    joinMethod: requestedJoinMethod,
    status: SMART_CALL_STATE.CREATED,
    callerId: req.callerId,
    callerOrganizationId: req.callerOrganizationIdOverride ?? callerUser?.organizationId ?? null,
    callerNumber: req.callerNumber,
    calleeIdentifier: callee.phoneNumber || req.calleeIdentifier,
    calleeUserId: requestedJoinMethod === "app_to_app" ? callee.userId ?? null : null,
    calleeOrganizationId: calleeUser?.organizationId ?? null,
    callType: req.callType,
    callerLanguage,
    calleeLanguage: effectiveCalleeLanguage ?? null,
    livekitUrl: process.env.LIVEKIT_URL ?? null,
    languageDetectionActive: true,
    estimatedRateInrPerMin: planRateInrPerMin,
    createdAt: nowIso(),
    lastProviderEventAt: requestedJoinMethod === "app_to_pstn" ? nowIso() : null,
    lastMediaActivityAt: null,
    provider: requestedJoinMethod === "app_to_app" ? "livekit" : "msg91_sip",
    metadata: {
      enableLipsync: !!req.enableLipsync,
      enableRecording: !!req.enableRecording,
      calleeDisplayName: req.calleeDisplayName ?? null,
      transportPreference: req.transportPreference ?? "auto",
    },
  });
  const createdRecord = await getSmartCall(callId);
  if (createdRecord) {
    emitStructuredCallEvent("call_created", createdRecord, {
      requestedJoinMethod,
      translationEnabled,
    });
  }

  try {
    if (requestedJoinMethod === "app_to_app") {
      if (callee.hasApp && callee.userId) {
        await sendIncomingCallPush(callee.userId, {
          callId,
          callerId: req.callerId,
          callType: req.callType,
        });
      }

      await updateSmartCallStatus(callId, SMART_CALL_STATE.RINGING, {
        calleeIdentifier: req.calleeIdentifier,
      });

      return {
        callId,
        joinMethod: "app_to_app",
        livekitUrl: process.env.LIVEKIT_URL,
        livekitToken: callerToken,
        estimatedRateInrPerMin: planRateInrPerMin,
        languageDetectionActive: true,
      };
    }

    if (!callee.phoneNumber) {
      throw new Error("CALLEE_PHONE_REQUIRED_FOR_PSTN");
    }

    let pstnResult: Awaited<ReturnType<typeof bridgeCallToLiveKitRoom>> | undefined;
    let attempts = 0;
    while (attempts < 3) {
      try {
        stageStartNs = process.hrtime.bigint();
        pstnResult = await bridgeCallToLiveKitRoom({
          to: callee.phoneNumber,
          from: req.callerNumber,
          sipUri: buildLiveKitSipUri(callId),
          callbackUrl: `${process.env.APP_BASE_URL}/api/calls/${callId}/msg91-webhook`,
          metadata: { internalCallId: callId, callerId: req.callerId },
        });
        logSetupLatency(callId, "app_to_pstn", "bridge_pstn", elapsedMs(stageStartNs));
        break;
      } catch (error) {
        attempts++;
        if (attempts >= 3) {
          throw error;
        }
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }

    await mutateSmartCall(callId, (current) => ({
      ...current,
      pstnCallId: pstnResult!.callId,
      calleeIdentifier: callee.phoneNumber || current.calleeIdentifier,
      lastProviderEventAt: nowIso(),
    }));

    await updateSmartCallStatus(callId, SMART_CALL_STATE.RINGING, {
      pstnCallId: pstnResult!.callId,
      calleeIdentifier: callee.phoneNumber,
      providerStatus: pstnResult!.status,
    });

    return {
      callId,
      joinMethod: "app_to_pstn",
      livekitUrl: process.env.LIVEKIT_URL,
      livekitToken: callerToken,
      pstnCallId: pstnResult!.callId,
      estimatedRateInrPerMin: planRateInrPerMin,
      languageDetectionActive: true,
    };
  } catch (error) {
    await mutateSmartCall(callId, (current) => ({
      ...current,
      status: SMART_CALL_STATE.FAILED,
      endedAt: current.endedAt || nowIso(),
      terminationReason: String(error),
      metadata: {
        ...(current.metadata || {}),
        provisioningFailed: true,
        provisioningError: String(error),
      },
    })).catch(() => null);
    await clearProvisionedCall(callId, req.callerId);
    await BillingEngine.finalizeCallSession(callId, "failed").catch(() => undefined);
    throw error;
  }
}

export async function initiateConference(params: {
  hostId: string;
  hostLanguage?: string;
  participantIds: string[];
  title?: string;
}): Promise<CallInitiateResponse & { participantTokens: Record<string, string> }> {
  const hostUserId = Number.isFinite(Number(params.hostId)) ? Number(params.hostId) : null;
  const hostUser = hostUserId ? await storage.getUser(hostUserId) : undefined;
  const callId = `conf_${randomUUID()}`;
  const auth = await BillingEngine.startCallSession({
    sessionId: callId,
    userId: hostUserId,
    organizationId: hostUser?.organizationId ?? null,
    callType: "voice",
    translationEnabled: false,
    recordingEnabled: false,
    joinMethod: "conference",
    activateOnAnswer: true,
  });
  if (!auth.allowed) {
    throw new Error(auth.reason || "PAYMENT_REQUIRED");
  }

  const planRateInrPerMin = auth.estimatedRatePerMinutePaise / 100;
  const hostLanguage = (params.hostLanguage || "auto").trim().toLowerCase() || "auto";

  await createCallRoom({
    callId,
    maxParticipants: params.participantIds.length + 5,
    emptyTimeoutSec: 300,
    metadata: { type: "conference", hostId: params.hostId, title: params.title },
  });
  await initCallLanguageTracking(callId, [
    { speakerId: params.hostId, preferredLanguage: hostLanguage },
  ]);

  const hostToken = await issueAccessToken(callId, {
    userId: params.hostId,
    displayName: params.hostId,
    language: hostLanguage,
    role: "caller",
  });

  const participantTokens: Record<string, string> = {};
  for (const participantId of params.participantIds) {
    const numericId = Number(participantId);
    const user = Number.isFinite(numericId) ? await storage.getUser(numericId) : undefined;
    const language = ((user as any)?.preferredLanguage || "auto").toLowerCase();
    await setParticipantLanguagePreference(callId, participantId, language);
    participantTokens[participantId] = await issueAccessToken(callId, {
      userId: participantId,
      displayName: participantId,
      language,
      role: "caller",
    });
    await sendIncomingCallPush(participantId, {
      callId,
      callerId: params.hostId,
      callType: "voice",
    });
  }

  const botToken = await issueBotToken(callId);
  spawnTranslatorBot(callId, botToken).catch(() => {});
  const participantOrganizations = await Promise.all(
    params.participantIds.map(async (participantId) => {
      const numericId = Number(participantId);
      if (!Number.isFinite(numericId)) {
        return null;
      }
      const user = await storage.getUser(numericId);
      return user?.organizationId ?? null;
    }),
  );

  await redisClient().set(`user:active_call:${params.hostId}`, callId, "EX", 3600);
  await redisClient().set(`call_metadata:${callId}:caller`, params.hostId);

  await storeSmartCall({
    callId,
    joinMethod: "conference",
    status: SMART_CALL_STATE.CREATED,
    callerId: params.hostId,
    callerOrganizationId: hostUser?.organizationId ?? null,
    callerNumber: hostUser?.phone ?? null,
    calleeIdentifier: params.participantIds.join(","),
    callType: "voice",
    callerLanguage: hostLanguage,
    livekitUrl: process.env.LIVEKIT_URL ?? null,
    languageDetectionActive: true,
    estimatedRateInrPerMin: planRateInrPerMin,
    createdAt: nowIso(),
    provider: "conference",
    metadata: {
      participantIds: params.participantIds,
      participantOrganizations,
      title: params.title ?? null,
    },
  });
  const createdConference = await getSmartCall(callId);
  if (createdConference) {
    emitStructuredCallEvent("call_created", createdConference, {
      requestedJoinMethod: "conference",
      translationEnabled: false,
    });
  }

  await updateSmartCallStatus(callId, SMART_CALL_STATE.RINGING, {
    participantIds: params.participantIds,
  });

  return {
    callId,
    joinMethod: "conference",
    livekitUrl: process.env.LIVEKIT_URL,
    livekitToken: hostToken,
    estimatedRateInrPerMin: planRateInrPerMin,
    languageDetectionActive: true,
    participantTokens,
  };
}

export async function activatePstnFallback(callId: string, input: {
  callerNumber: string;
  calleePhoneNumber: string;
}): Promise<{ callId: string; pstnCallId: string; providerStatus: string }> {
  const current = await getSmartCall(callId);
  if (!current) {
    throw new Error("SESSION_NOT_FOUND");
  }

  if (current.joinMethod === "app_to_pstn" && current.pstnCallId) {
    return {
      callId,
      pstnCallId: current.pstnCallId,
      providerStatus: "already_active",
    };
  }

  const pstnResult = await bridgeCallToLiveKitRoom({
    to: input.calleePhoneNumber,
    from: input.callerNumber,
    sipUri: buildLiveKitSipUri(callId),
    callbackUrl: `${process.env.APP_BASE_URL}/api/calls/${callId}/msg91-webhook`,
    metadata: { internalCallId: callId, callerId: current.callerId },
  });

  await mutateSmartCall(callId, (record) => ({
    ...record,
    joinMethod: "app_to_pstn",
    provider: "msg91_sip",
    calleeIdentifier: input.calleePhoneNumber,
    pstnCallId: pstnResult.callId,
    lastProviderEventAt: nowIso(),
  }));

  await updateSmartCallStatus(callId, SMART_CALL_STATE.RINGING, {
    pstnCallId: pstnResult.callId,
    calleeIdentifier: input.calleePhoneNumber,
    providerStatus: pstnResult.status,
  });

  return {
    callId,
    pstnCallId: pstnResult.callId,
    providerStatus: pstnResult.status,
  };
}

export async function endCall(callId: string, reason = "completed"): Promise<{
  totalCostInr: number;
  translationMinutes: number;
  relayOnlyMinutes: number;
}> {
  const existing = await getSmartCall(callId).catch(() => null);
  try {
    const mod: any = await import("../../translator-bot").catch(() => ({}));
    if (typeof mod.stopBotWorker === "function") {
      await mod.stopBotWorker(callId);
    }
  } catch (error) {
    logger.warn("SmartCallRouter", `bot worker stop failed: ${String(error)}`);
  }

  const callerId = await redisClient().get(`call_metadata:${callId}:caller`);
  if (callerId) {
    await redisClient().del(`user:active_call:${callerId}`);
  }
  await redisClient().del(`call_metadata:${callId}:caller`);

  await endCallRoom(callId);
  const terminationReasons = new Set([
    "insufficient_balance",
    "INSUFFICIENT_BALANCE",
    "CREDIT_LIMIT_EXCEEDED",
    "DAILY_USAGE_LIMIT_REACHED",
    "MAX_DURATION_REACHED",
    "BILLING_RUNTIME_FAILURE",
  ]);
  const finalBillingStatus = reason === "failed"
    || String(reason || "").toUpperCase() === "PROVIDER_TIMEOUT"
    ? "failed"
    : terminationReasons.has(reason)
      ? "ended"
      : "completed";
  const strictBilling = await BillingEngine.finalizeCallSession(callId, finalBillingStatus).catch((error) => {
    logger.warn("SmartCallRouter", `strict billing finalize failed for ${callId}: ${String(error)}`);
    return null;
  });
  const billing = await finalizeCallBilling(callId);
  const totalCostInr = strictBilling ? strictBilling.totalCostPaise / 100 : billing.totalCostInr;
  let finalCallState: SmartCallState = SMART_CALL_STATE.ENDED;
  const normalizedReason = String(reason || "").trim().toLowerCase();
  if (finalBillingStatus === "failed") {
    finalCallState = SMART_CALL_STATE.FAILED;
  } else if (normalizedReason.includes("provider_timeout")) {
    finalCallState = SMART_CALL_STATE.FAILED;
  } else if (normalizedReason.includes("busy")) {
    finalCallState = SMART_CALL_STATE.BUSY;
  } else if (normalizedReason.includes("missed") || normalizedReason.includes("no-answer")) {
    finalCallState = SMART_CALL_STATE.MISSED;
  } else if (normalizedReason.includes("cancel") || normalizedReason.includes("reject")) {
    finalCallState = SMART_CALL_STATE.CANCELLED;
  }

  const updatedCall = await updateSmartCallStatus(callId, finalCallState, {
    totalCostInr,
    endReason: reason,
    translationMinutes: billing.translationMinutes,
    relayOnlyMinutes: billing.relayOnlyMinutes,
    prepaidDebitPaise: strictBilling?.prepaidDebitPaise ?? null,
    postpaidAccrualPaise: strictBilling?.postpaidAccrualPaise ?? null,
  });

  // ── PERSIST TO POSTGRESQL (non-blocking, never fails call teardown) ──
  if (updatedCall) {
    logger.info("SmartCallBilling", "billing_stopped", {
      callId,
      reason,
      totalCostInr,
      prepaidDebitPaise: strictBilling?.prepaidDebitPaise ?? null,
      postpaidAccrualPaise: strictBilling?.postpaidAccrualPaise ?? null,
    });
    smartCallEvents.emit("billing_stopped", {
      callId,
      reason,
      totalCostInr,
    });
    emitStructuredCallEvent("call_ended", updatedCall, {
      reason,
      totalCostInr,
      translationMinutes: billing.translationMinutes,
      relayOnlyMinutes: billing.relayOnlyMinutes,
      durationSeconds: strictBilling?.durationSeconds ?? null,
      previousStatus: existing?.status ?? null,
    });
    persistCompletedCall({
      callId: updatedCall.callId,
      joinMethod: updatedCall.joinMethod as "app_to_app" | "app_to_pstn" | "conference",
      callerId: updatedCall.callerId,
      callerUserId: null,
      callerOrganizationId: updatedCall.callerOrganizationId ?? null,
      callerNumber: updatedCall.callerNumber ?? null,
      calleeIdentifier: updatedCall.calleeIdentifier,
      calleeUserId: updatedCall.calleeUserId ?? null,
      calleeOrganizationId: updatedCall.calleeOrganizationId ?? null,
      callType: (updatedCall.callType as "voice" | "video") || "voice",
      callerLanguage: updatedCall.callerLanguage || "auto",
      calleeLanguage: updatedCall.calleeLanguage ?? null,
      translationEnabled: updatedCall.callerLanguage !== updatedCall.calleeLanguage,
      livekitUrl: updatedCall.livekitUrl ?? null,
      status: updatedCall.status,
      createdAt: updatedCall.createdAt,
      connectedAt: updatedCall.connectedAt ?? null,
      endedAt: updatedCall.endedAt ?? null,
      totalCostInr,
      translationMinutes: billing.translationMinutes,
      relayOnlyMinutes: billing.relayOnlyMinutes,
      metadata: updatedCall.metadata as Record<string, unknown> | undefined,
    }).catch((err) => {
      logger.warn("SmartCallRouter", `DB persistence failed for ${callId}: ${String(err)}`);
    });
  }

  return {
    totalCostInr,
    translationMinutes: billing.translationMinutes,
    relayOnlyMinutes: billing.relayOnlyMinutes,
  };
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
