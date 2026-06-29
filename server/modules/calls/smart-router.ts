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
import { getPSTNProvider, isPSTNAvailable } from "../../pstn/registry";
import { recordCallOutcome } from "../../pstn/monitor";
import { db } from "../../db";
import { eq } from "drizzle-orm";
import { organizations } from "@shared/schema";
import { logger } from "../../observability";
import { persistCompletedCall } from "../../call-persistence";
import { getRedisClient } from "../../redis";
import { storage } from "../../storage";
import type { StrictBillingPlanConfig } from "../../billing-config";
import { normalizePhoneNumber } from "@shared/phone";
import type { ListenerTranslationMode } from "../../translation/translation-service";
import {
  resolveEffectiveCallMode,
  resolveTranslationEnabled,
  type JoinMethod,
} from "@shared/call-behavior";
import {
  resolveCallerIdentityMode,
  resolveRequestedJoinMethod,
  type CallerIdentityMode,
} from "@shared/call-routing";
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
const MEDIA_STALL_WARN_MS = parsePositiveInt(process.env.SMART_CALL_MEDIA_STALL_WARN_MS, 30_000);
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

export interface CallInitiateRequest {
  sessionIdOverride?: string;
  callerId: string;
  callerNumber: string;
  callerLanguage?: string;
  calleeIdentifier: string;
  calleeLanguage?: string;
  translationEnabled?: boolean;
  callerTranslationMode?: ListenerTranslationMode;
  calleeTranslationMode?: ListenerTranslationMode;
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
  effectiveCallType?: "voice" | "video";
  callerIdentityMode?: "app_identity" | "organization_caller_id" | "user_verified_number" | "provider_caller_id";
  callerIdentityDisclaimer?: string;
  livekitUrl?: string;
  livekitToken?: string;
  pstnCallId?: string;
  estimatedRateInrPerMin: number;
  languageDetectionActive: boolean;
  operationalWarnings?: string[];
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
  const recordMetadata = (record.metadata || {}) as Record<string, unknown>;
  const callerIdentityMode = typeof recordMetadata.callerIdentityMode === "string"
    ? recordMetadata.callerIdentityMode
    : null;
  const requestedCallType = typeof recordMetadata.requestedCallType === "string"
    ? recordMetadata.requestedCallType
    : record.callType;
  const billingDurationSeconds = typeof recordMetadata.billingDurationSeconds === "number"
    ? recordMetadata.billingDurationSeconds
    : null;
  const totalCostInr = typeof recordMetadata.totalCostInr === "number"
    ? recordMetadata.totalCostInr
    : null;

  const payload = {
    event,
    callId: record.callId,
    joinMethod: record.joinMethod,
    status: record.status,
    provider: record.provider || null,
    callerId: record.callerId,
    calleeIdentifier: record.calleeIdentifier,
    callType: record.callType,
    requestedCallType,
    callerIdentityMode,
    languageDetectionActive: record.languageDetectionActive,
    estimatedRateInrPerMin: record.estimatedRateInrPerMin,
    billingDurationSeconds,
    totalCostInr,
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

function buildCallerIdentityDisclaimer(
  callerIdentityMode: CallerIdentityMode,
  joinMethod: JoinMethod,
): string | undefined {
  if (joinMethod !== "app_to_pstn") {
    return undefined;
  }

  if (callerIdentityMode === "provider_caller_id") {
    return "Carrier/provider caller ID may be shown instead of the user's number.";
  }

  if (callerIdentityMode === "user_verified_number") {
    return "Verified personal number is best-effort only and may be overridden by carrier or compliance rules.";
  }

  if (callerIdentityMode === "organization_caller_id") {
    return "Business caller ID depends on carrier acceptance and local telecom rules.";
  }

  return undefined;
}

async function resolveCallee(identifier: string): Promise<{
  hasApp: boolean;
  userId?: string;
  phoneNumber?: string;
  preferredLanguage?: string;
}> {
  const rawIdentifier = (identifier ?? "").trim();
  const normalizedPhone = rawIdentifier.replace(/\s+/g, "");
  const isPhone = /^\+?\d{10,15}$/.test(normalizedPhone);

  const toResolvedCallee = (user: any, fallbackPhone?: string) => ({
    hasApp: true as const,
    userId: String(user.id),
    phoneNumber: (user as any).phone ?? fallbackPhone,
    preferredLanguage: (user as any).preferredLanguage,
  });

  if (isPhone) {
    const user =
      (await storage.getUserByPhone(normalizedPhone)) ??
      (normalizedPhone.startsWith("+")
        ? await storage.getUserByPhone(normalizedPhone.slice(1))
        : await storage.getUserByPhone(`+${normalizedPhone}`));
    if (user) {
      return toResolvedCallee(user, normalizedPhone);
    }

    return { hasApp: false, phoneNumber: normalizedPhone };
  }

  const asNum = Number(rawIdentifier);
  if (Number.isFinite(asNum)) {
    const byId = await storage.getUser(asNum);
    if (byId) {
      return toResolvedCallee(byId);
    }
  }

  const loweredIdentifier = rawIdentifier.toLowerCase();
  const byIdentity = await db.query.users.findFirst({
    where: (users, { and, eq, or, sql }) =>
      and(
        eq(users.isActive, true),
        or(
          eq(users.username, rawIdentifier),
          sql`LOWER(${users.email}) = ${loweredIdentifier}`,
          sql`REPLACE(COALESCE(${users.phone}, ''), ' ', '') = ${normalizedPhone}`,
        ),
      ),
  });

  if (byIdentity) {
    return toResolvedCallee(byIdentity);
  }

  return { hasApp: false };
}

async function storeSmartCall(record: SmartCallRecord): Promise<void> {
  const score = Date.parse(record.createdAt) || Date.now();
  // Use expiry timestamp as ZSET score so watchdog uses ZRANGEBYSCORE instead of SMEMBERS (O(log N) vs O(N))
  const expiryScore = score + SMART_CALL_TTL_SECONDS * 1000;
  const multi = redisClient().multi();

  multi.set(smartCallKey(record.callId), JSON.stringify(record), "EX", SMART_CALL_TTL_SECONDS);

  if (isActiveSmartCallStatus(record.status)) {
    // ZADD with expiry score — watchdog queries ZRANGEBYSCORE(0, now) to find expired, ZRANGEBYSCORE(0, +inf) to find active
    multi.zadd("smart_call:active_z", expiryScore, record.callId);
  } else {
    multi.zrem("smart_call:active_z", record.callId);
    // Backward compat: also remove from legacy SET key if it exists
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
  multi.srem("smart_call:active", callId);       // legacy SET (backward compat)
  multi.zrem("smart_call:active_z", callId);     // new ZSET
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
      metadata: {
        ...(current.metadata || {}),
        ...(participantIdentity ? { lastMediaParticipant: participantIdentity } : {}),
        mediaStallWarningAt: null,
        mediaStallMs: null,
        mediaStallStatus: "healthy",
      },
    };
  }).catch(() => null);
}

function ensureSmartCallWatchdog(): void {
  if (watchdogStarted) {
    return;
  }

  watchdogStarted = true;
  setInterval(() => {
    void processSmartCallWatchdog().catch((error) => {
      logger.warn("SmartCallRouter", `watchdog tick skipped: ${String(error)}`);
    });
  }, 5_000).unref?.();
}

async function processSmartCallWatchdog(): Promise<void> {
  let activeCalls: SmartCallRecord[] = [];
  try {
    activeCalls = await listSmartActiveCalls();
  } catch (error) {
    logger.warn("SmartCallRouter", `watchdog failed to load active calls: ${String(error)}`);
    return;
  }
  const nowMs = Date.now();

  await Promise.all(activeCalls.map(async (record) => {
    const referenceMs = latestHeartbeat(record);
    if (!Number.isFinite(referenceMs)) {
      return;
    }
    const inactiveMs = nowMs - referenceMs;

    if (
      record.status === SMART_CALL_STATE.ACTIVE
      && record.joinMethod !== "app_to_pstn"
      && inactiveMs >= MEDIA_STALL_WARN_MS
      && record.metadata?.mediaStallStatus !== "warning"
    ) {
      logger.warn("SmartCallRouter", `media stall detected for ${record.callId}`, {
        callId: record.callId,
        joinMethod: record.joinMethod,
        inactiveMs,
        lastProviderEventAt: record.lastProviderEventAt ?? null,
        lastMediaActivityAt: record.lastMediaActivityAt ?? null,
      });
      await mutateSmartCall(record.callId, (current) => ({
        ...current,
        metadata: {
          ...(current.metadata || {}),
          mediaStallStatus: "warning",
          mediaStallWarningAt: nowIso(),
          mediaStallMs: inactiveMs,
        },
      })).catch((error) => {
        logger.warn("SmartCallRouter", `media stall metadata update failed for ${record.callId}: ${String(error)}`);
      });
      emitStructuredCallEvent("call_media_stall_warning", record, {
        inactiveMs,
        joinMethod: record.joinMethod,
      });
    }

    if (record.joinMethod !== "app_to_pstn") {
      return;
    }
    const timeoutMs = record.status === SMART_CALL_STATE.ACTIVE
      ? PROVIDER_TIMEOUT_ACTIVE_MS
      : PROVIDER_TIMEOUT_RINGING_MS;

    if (inactiveMs < timeoutMs) {
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

export function startSmartCallWatchdog(): void {
  ensureSmartCallWatchdog();
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

export async function getSmartCall(callId: string): Promise<SmartCallRecord | null> {
  if (!isSmartCallId(callId)) {
    return null;
  }

  let raw: string | null = null;
  try {
    raw = await redisClient().get(smartCallKey(callId));
  } catch (error) {
    logger.warn("SmartCallRouter", `failed to read smart call ${callId}: ${String(error)}`);
    return null;
  }
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
  let callIds: string[] = [];
  try {
    callIds = await redisClient().zrevrange(smartCallUserIndexKey(userId), 0, 99);
  } catch (error) {
    logger.warn("SmartCallRouter", `failed to list smart calls for user ${userId}: ${String(error)}`);
    return [];
  }
  if (callIds.length === 0) {
    return [];
  }

  let rawRecords: (string | null)[] = [];
  try {
    rawRecords = await redisClient().mget(callIds.map((callId) => smartCallKey(callId)));
  } catch (error) {
    logger.warn("SmartCallRouter", `failed to load smart call records for user ${userId}: ${String(error)}`);
    return [];
  }
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
  let callIds: string[] = [];
  try {
    // ZRANGEBYSCORE with +inf ceiling — O(log N + M) vs SMEMBERS O(N)
    // Score = expiry timestamp so expired ghosts are naturally excluded by TTL
    callIds = await redisClient().zrangebyscore("smart_call:active_z", "-inf", "+inf");
  } catch (error) {
    logger.warn("SmartCallRouter", `failed to list active smart calls (ZSET): ${String(error)}`);
    // Fallback to legacy SET key during migration
    try {
      callIds = await redisClient().smembers("smart_call:active");
    } catch (fallbackErr) {
      logger.warn("SmartCallRouter", `fallback SMEMBERS also failed: ${String(fallbackErr)}`);
      return [];
    }
  }
  if (callIds.length === 0) {
    return [];
  }

  // Fetch in batches of 100 to avoid blocking Redis with huge MGET
  const BATCH = 100;
  const allRaw: (string | null)[] = [];
  for (let i = 0; i < callIds.length; i += BATCH) {
    const batch = callIds.slice(i, i + BATCH);
    try {
      const results = await redisClient().mget(batch.map((id) => smartCallKey(id)));
      allRaw.push(...results);
    } catch (error) {
      logger.warn("SmartCallRouter", `failed to load active smart call batch: ${String(error)}`);
    }
  }

  return allRaw.flatMap((raw) => {
    if (!raw) return [];
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
        joinMethod: updated.joinMethod,
        callerIdentityMode: updated.metadata?.callerIdentityMode ?? null,
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
  payload: { callId: string; callerId: string; callType: string; callerName?: string },
): Promise<void> {
  try {
    const mod: any = await import("../../firebase-admin").catch((err) => {
      logger.debug("SmartCallRouter", `firebase-admin optional module not loaded (push unavailable): ${String(err)}`);
      return {};
    });
    if (typeof mod.sendVoIPPush === "function") {
      await mod.sendVoIPPush(userId, payload);
    }
  } catch (error) {
    logger.warn("SmartCallRouter", `push failed for ${userId}: ${String(error)}`);
  }
}

async function resolveOrgOutboundCallerId(orgId: number | null | undefined): Promise<string | null> {
  if (!orgId) return null;
  try {
    const [org] = await db.select({ settings: organizations.settings })
      .from(organizations).where(eq(organizations.id, orgId));
    const callerId = (org?.settings as Record<string, unknown>)?.outboundCallerId;
    return typeof callerId === "string" && callerId.length > 0 ? callerId : null;
  } catch {
    return null;
  }
}

/**
 * Skill-based routing: given an org and required skills, find the best available agent.
 * Returns the userId of the chosen agent, or null if none available.
 * Scoring: availability > priority > least-loaded (active calls count).
 */
export async function routeToSkillAgent(
  organizationId: number,
  requiredSkills: string[],
): Promise<string | null> {
  try {
    const { agentSkills } = await import("@shared/schema");
    const agents = await db.select().from(agentSkills)
      .where(eq(agentSkills.organizationId, organizationId));

    const available = agents.filter((a) => {
      if (!a.isAvailable) return false;
      if (requiredSkills.length === 0) return true;
      const agentSkillList = Array.isArray(a.skills) ? (a.skills as string[]) : [];
      return requiredSkills.every((s) => agentSkillList.includes(s));
    });

    if (available.length === 0) return null;

    // Pick highest priority; break ties by id (FIFO)
    available.sort((a, b) => b.priority - a.priority || a.id - b.id);

    return String(available[0].userId);
  } catch (error) {
    logger.warn("SmartCallRouter", `skill routing failed: ${String(error)}`);
    return null;
  }
}

async function spawnTranslatorBot(callId: string, botToken: string): Promise<void> {
  try {
    const mod: any = await import("../../translator-bot").catch((err) => {
      logger.debug("SmartCallRouter", `translator-bot optional module not loaded: ${String(err)}`);
      return {};
    });
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

  const callerUserId = Number.isFinite(Number(req.callerId)) ? Number(req.callerId) : null;

  // Parallelize: callee resolution + caller user lookup are independent DB reads
  const [callee, callerUser] = await Promise.all([
    resolveCallee(req.calleeIdentifier),
    callerUserId ? storage.getUser(callerUserId) : Promise.resolve(undefined),
  ]);

  const calleeUserId = callee.userId && Number.isFinite(Number(callee.userId)) ? Number(callee.userId) : null;
  // Fetch callee user in background — only needed for org routing, non-blocking
  const calleeUserPromise = calleeUserId ? storage.getUser(calleeUserId) : Promise.resolve(undefined);

  const effectiveCalleeLanguage = (req.calleeLanguage ?? callee.preferredLanguage ?? "auto")?.trim().toLowerCase() || "auto";
  const requestedJoinMethod = resolveRequestedJoinMethod({
    transportPreference: req.transportPreference ?? "auto",
    calleeHasApp: callee.hasApp,
    calleeUserId: callee.userId,
  });
  const { effectiveCallType, effectiveLipsync } = resolveEffectiveCallMode(
    requestedJoinMethod,
    req.callType,
    req.enableLipsync,
  );
  let callerIdentityMode: CallerIdentityMode = resolveCallerIdentityMode({
    joinMethod: requestedJoinMethod,
  });
  let callerIdentityDisclaimer = buildCallerIdentityDisclaimer(callerIdentityMode, requestedJoinMethod);
  const translationEnabled = resolveTranslationEnabled({
    callerLanguage,
    calleeLanguage: effectiveCalleeLanguage,
    requestedTranslationEnabled: req.translationEnabled,
  });
  const operationalWarnings: string[] = [];
  if (requestedJoinMethod === "app_to_pstn" && req.callType === "video") {
    operationalWarnings.push("PSTN routes are audio-only. Video is downgraded to voice.");
  }
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
    callType: effectiveCallType,
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
    maxParticipants: effectiveCallType === "video" ? 10 : 4,
    emptyTimeoutSec: 120,
    metadata: {
      callerId: req.callerId,
      calleeIdentifier: req.calleeIdentifier,
      callType: effectiveCallType,
      lipsync: effectiveLipsync,
      recording: !!req.enableRecording,
      translationEnabled,
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
    translationMode: translationEnabled ? (req.callerTranslationMode || "subtitles") : "off",
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
  await redisClient().set(`call_metadata:${callId}:caller`, req.callerId, "EX", 7200);

  await storeSmartCall({
    callId,
    joinMethod: requestedJoinMethod,
    status: SMART_CALL_STATE.CREATED,
    callerId: req.callerId,
    callerOrganizationId: req.callerOrganizationIdOverride ?? callerUser?.organizationId ?? null,
    callerNumber: req.callerNumber,
    calleeIdentifier: callee.phoneNumber || req.calleeIdentifier,
    calleeUserId: requestedJoinMethod === "app_to_app" ? callee.userId ?? null : null,
    calleeOrganizationId: (await calleeUserPromise)?.organizationId ?? null,
    callType: effectiveCallType,
    callerLanguage,
    calleeLanguage: effectiveCalleeLanguage ?? null,
    livekitUrl: process.env.LIVEKIT_URL ?? null,
    languageDetectionActive: translationEnabled,
    estimatedRateInrPerMin: planRateInrPerMin,
    createdAt: nowIso(),
    lastProviderEventAt: requestedJoinMethod === "app_to_pstn" ? nowIso() : null,
    lastMediaActivityAt: null,
    provider: requestedJoinMethod === "app_to_app" ? "livekit" : "msg91_sip",
    metadata: {
      enableLipsync: effectiveLipsync,
      enableRecording: !!req.enableRecording,
      translationEnabled,
      calleeDisplayName: req.calleeDisplayName ?? null,
      transportPreference: req.transportPreference ?? "auto",
      callerIdentityMode,
      callerIdentityDisclaimer,
      requestedCallType: req.callType,
      pstnVideoDowngraded: requestedJoinMethod === "app_to_pstn" && req.callType === "video",
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
          callerName: req.callerDisplayName || req.callerId,
        });
      }

      await updateSmartCallStatus(callId, SMART_CALL_STATE.RINGING, {
        calleeIdentifier: req.calleeIdentifier,
      });

      return {
        callId,
        joinMethod: "app_to_app",
        effectiveCallType,
        callerIdentityMode: "app_identity",
        callerIdentityDisclaimer: undefined,
        livekitUrl: process.env.LIVEKIT_URL,
        livekitToken: callerToken,
        estimatedRateInrPerMin: planRateInrPerMin,
        languageDetectionActive: translationEnabled,
        operationalWarnings,
      };
    }

    if (!callee.phoneNumber) {
      throw new Error("CALLEE_PHONE_REQUIRED_FOR_PSTN");
    }
    if (!isPSTNAvailable()) {
      throw new Error("PSTN_NOT_CONFIGURED");
    }
    if (!process.env.APP_BASE_URL?.trim()) {
      throw new Error("APP_BASE_URL_REQUIRED_FOR_PSTN_WEBHOOKS");
    }
    if (!process.env.LIVEKIT_SIP_DOMAIN?.trim()) {
      throw new Error("LIVEKIT_SIP_DOMAIN_REQUIRED_FOR_PSTN");
    }

    // Per-org outbound caller ID: use org setting if set, else fall back to caller's verified number
    const callerOrgId = req.callerOrganizationIdOverride ?? callerUser?.organizationId ?? null;
    const orgOutboundCallerId = await resolveOrgOutboundCallerId(callerOrgId);
    const normalizedCallerNumber = normalizePhoneNumber(req.callerNumber);
    const callerOwnNumberAllowed = Boolean((callerUser as any)?.callerIdVerified && normalizedCallerNumber);
    const effectiveCallerNumber = orgOutboundCallerId || (callerOwnNumberAllowed ? normalizedCallerNumber : "") || process.env.MSG91_VOICE_CALLER_ID || "";
    callerIdentityMode = resolveCallerIdentityMode({
      joinMethod: requestedJoinMethod,
      organizationCallerId: orgOutboundCallerId,
      callerVerifiedNumber: normalizedCallerNumber,
      callerPhoneVerified: Boolean((callerUser as any)?.callerIdVerified),
    });
    callerIdentityDisclaimer = buildCallerIdentityDisclaimer(callerIdentityMode, requestedJoinMethod);
    if (callerIdentityDisclaimer) {
      operationalWarnings.push(callerIdentityDisclaimer);
    }

    const pstnProvider = getPSTNProvider();
    let pstnProviderCallId = "";
    let pstnProviderStatus = "queued";
    let attempts = 0;
    while (attempts < 3) {
      try {
        stageStartNs = process.hrtime.bigint();
        const pstnResult = await pstnProvider.initiateCall({
          to: callee.phoneNumber,
          from: effectiveCallerNumber,
          sipUri: buildLiveKitSipUri(callId),
          callbackUrl: `${process.env.APP_BASE_URL}/api/pstn/status`,
          internalCallId: callId,
          metadata: { callerId: req.callerId },
          timeoutSeconds: 30,
        });
        pstnProviderCallId = pstnResult.providerCallId;
        pstnProviderStatus = pstnResult.status;
        logSetupLatency(callId, "app_to_pstn", "bridge_pstn", elapsedMs(stageStartNs));
        await recordCallOutcome({
          callId,
          success: true,
          provider: pstnProvider.name,
          setupLatencyMs: elapsedMs(stageStartNs),
        });
        break;
      } catch (error) {
        attempts++;
        if (attempts >= 3) {
          await recordCallOutcome({
            callId,
            success: false,
            provider: pstnProvider.name,
            failureReason: String(error).slice(0, 60),
          });
          throw error;
        }
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }

    await mutateSmartCall(callId, (current) => ({
      ...current,
      pstnCallId: pstnProviderCallId,
      calleeIdentifier: callee.phoneNumber || current.calleeIdentifier,
      lastProviderEventAt: nowIso(),
    }));

    await updateSmartCallStatus(callId, SMART_CALL_STATE.RINGING, {
      pstnCallId: pstnProviderCallId,
      calleeIdentifier: callee.phoneNumber,
      providerStatus: pstnProviderStatus,
    });

    return {
      callId,
      joinMethod: "app_to_pstn",
      effectiveCallType,
      callerIdentityMode,
      callerIdentityDisclaimer,
      livekitUrl: process.env.LIVEKIT_URL,
      livekitToken: callerToken,
      pstnCallId: pstnProviderCallId,
      estimatedRateInrPerMin: planRateInrPerMin,
      languageDetectionActive: translationEnabled,
      operationalWarnings,
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
  spawnTranslatorBot(callId, botToken).catch((err) => {
    logger.error("SmartCallRouter", `Failed to spawn translator bot for call ${callId}: ${String(err)}`);
  });
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
  await redisClient().set(`call_metadata:${callId}:caller`, params.hostId, "EX", 7200);

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
    callerIdentityMode: "app_identity",
    livekitUrl: process.env.LIVEKIT_URL,
    livekitToken: hostToken,
    estimatedRateInrPerMin: planRateInrPerMin,
    languageDetectionActive: false,
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

  const orgOutboundFallback = await resolveOrgOutboundCallerId(current.callerOrganizationId ?? null);
  const normalizedCallerNumber = normalizePhoneNumber(input.callerNumber);
  const callerOwnNumberAllowed = Boolean(normalizedCallerNumber);
  const effectiveCallerNumber = orgOutboundFallback || (callerOwnNumberAllowed ? normalizedCallerNumber : "");
  const callerIdentityMode: CallerIdentityMode = resolveCallerIdentityMode({
    joinMethod: "app_to_pstn",
    organizationCallerId: orgOutboundFallback,
    callerVerifiedNumber: normalizedCallerNumber,
    callerPhoneVerified: callerOwnNumberAllowed,
  });
  if (!isPSTNAvailable()) {
    throw new Error("PSTN_NOT_CONFIGURED");
  }
  if (!process.env.APP_BASE_URL?.trim()) {
    throw new Error("APP_BASE_URL_REQUIRED_FOR_PSTN_WEBHOOKS");
  }
  if (!process.env.LIVEKIT_SIP_DOMAIN?.trim()) {
    throw new Error("LIVEKIT_SIP_DOMAIN_REQUIRED_FOR_PSTN");
  }
  const pstnProvider = getPSTNProvider();
  const pstnResult = await pstnProvider.initiateCall({
    to: input.calleePhoneNumber,
    from: effectiveCallerNumber || process.env.MSG91_VOICE_CALLER_ID || "",
    sipUri: buildLiveKitSipUri(callId),
    callbackUrl: `${process.env.APP_BASE_URL}/api/pstn/status`,
    internalCallId: callId,
    metadata: { callerId: current.callerId },
    timeoutSeconds: 30,
  });

  await mutateSmartCall(callId, (record) => ({
    ...record,
    joinMethod: "app_to_pstn",
    provider: pstnProvider.name === "twilio" ? "msg91_sip" : "msg91_sip",
    calleeIdentifier: input.calleePhoneNumber,
    pstnCallId: pstnResult.providerCallId,
    lastProviderEventAt: nowIso(),
    metadata: {
      ...(record.metadata || {}),
      callerIdentityMode,
      pstnFallbackActivated: true,
      pstnProvider: pstnProvider.name,
    },
  }));

  await updateSmartCallStatus(callId, SMART_CALL_STATE.RINGING, {
    pstnCallId: pstnResult.providerCallId,
    calleeIdentifier: input.calleePhoneNumber,
    providerStatus: pstnResult.status,
  });

  return {
    callId,
    pstnCallId: pstnResult.providerCallId,
    providerStatus: pstnResult.status,
  };
}

export async function endCall(callId: string, reason = "completed"): Promise<{
  totalCostInr: number;
  translationMinutes: number;
  relayOnlyMinutes: number;
}> {
  const existing = await getSmartCall(callId).catch(() => null);
  if (existing && isTerminalSmartCallState(existing.status)) {
    return {
      totalCostInr: Number(existing.metadata?.totalCostInr || 0),
      translationMinutes: Number(existing.metadata?.translationMinutes || 0),
      relayOnlyMinutes: Number(existing.metadata?.relayOnlyMinutes || 0),
    };
  }

  try {
    const mod: any = await import("../../translator-bot").catch((err) => {
      logger.debug("SmartCallRouter", `translator-bot optional module not loaded: ${String(err)}`);
      return {};
    });
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
    billingDurationSeconds: strictBilling?.durationSeconds ?? null,
  });

  // ── PERSIST TO POSTGRESQL (non-blocking, never fails call teardown) ──
  if (updatedCall) {
    logger.info("SmartCallBilling", "billing_stopped", {
      callId,
      reason,
      joinMethod: updatedCall.joinMethod,
      callerIdentityMode: updatedCall.metadata?.callerIdentityMode ?? null,
      durationSeconds: strictBilling?.durationSeconds ?? null,
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
      translationEnabled: updatedCall.languageDetectionActive,
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

/** Public alias for resolveCallee used by the transfer endpoint */
export async function resolveCalleeForTransfer(identifier: string): Promise<{
  hasApp: boolean;
  userId?: string;
  phoneNumber?: string;
}> {
  return resolveCallee(identifier);
}

/** Returns true when callId is a smart-call and its state is currently active/ringing/answered */
export async function isActiveSmartCall(callId: string): Promise<boolean> {
  if (!isSmartCallId(callId)) return false;
  const record = await getSmartCall(callId);
  if (!record) return false;
  const state = normalizeSmartCallState(record.status);
  return !!state && isActiveSmartCallState(state);
}
