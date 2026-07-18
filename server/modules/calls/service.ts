/**
 * Calls service — orchestrates call initiation, conference, hang-up, and the
 * in-memory incoming-call queue. Wraps smart-call-router (the unified routing
 * engine) so controllers never touch low-level LiveKit/MSG91 concerns.
 *
 * NOTE: smart-call-router.ts itself is kept at server/smart-call-router.ts
 * until call-streaming + call-gateway also migrate (Phase 2). It is imported
 * through this service as the single integration point.
 */

import { EventEmitter } from "node:events";
import {
  initiateCall as routerInitiateCall,
  initiateConference as routerInitiateConference,
  activatePstnFallback as routerActivatePstnFallback,
  endCall as routerEndCall,
  getSmartCall as routerGetSmartCall,
  listSmartActiveCalls as routerListSmartActiveCalls,
  listSmartCallsForUser as routerListSmartCallsForUser,
  updateSmartCallStatus as routerUpdateSmartCallStatus,
  isSmartCallId as routerIsSmartCallId,
  isActiveSmartCall as routerIsActiveSmartCall,
  resolveCalleeForTransfer as routerResolveCalleeForTransfer,
  setCallHold as routerSetCallHold,
  type CallInitiateRequest,
  type CallInitiateResponse,
  type SmartCallRecord,
} from "./smart-router";
import { getClientConfig, issueAccessToken } from "../../livekit-service";
import { storage } from "../../storage";
import { db } from "../../db";
import { getRedisClient } from "../../redis";
import { logger } from "../../observability";
import { registeredDevices, auditLogs, users } from "@shared/schema";
import { eq, and, or, sql } from "drizzle-orm";
import type { StrictBillingPlanConfig } from "../../billing-config";
import type { ListenerTranslationMode } from "../../translation/translation-service";

// SSE notification bus — emits "incoming:<userId>" when a call arrives
export const incomingCallBus = new EventEmitter();
incomingCallBus.setMaxListeners(512);

const INCOMING_TTL_MS = 45_000;
const INCOMING_QUEUE_TTL_SECONDS = Math.max(60, Math.ceil((INCOMING_TTL_MS * 2) / 1000));
const INCOMING_QUEUE_KEY_PREFIX = "incoming_call_queue:";

interface IncomingCallEntry {
  callId: string;
  callerId: string;
  callerName?: string;
  callType: "voice" | "video";
  livekitUrl: string;
  livekitToken: string;
  expiresAt: number;
}

const incomingQueue = new Map<string, IncomingCallEntry[]>();

function incomingQueueKey(userId: string): string {
  return `${INCOMING_QUEUE_KEY_PREFIX}${userId}`;
}

function queueIncomingCallInMemory(userId: string, entry: IncomingCallEntry): void {
  const list = (incomingQueue.get(userId) ?? []).filter((existing) => existing.callId !== entry.callId);
  list.push(entry);
  incomingQueue.set(userId, list);
}

function popIncomingCallFromMemory(userId: string): IncomingCallEntry | null {
  const list = incomingQueue.get(userId);
  if (!list || list.length === 0) return null;
  const now = Date.now();
  const alive = list.filter(c => c.expiresAt > now);
  const [next, ...rest] = alive;
  incomingQueue.set(userId, rest);
  return next ?? null;
}

function removeIncomingCallFromMemory(userId: string, callId: string): void {
  const list = incomingQueue.get(userId);
  if (!list) return;
  incomingQueue.set(userId, list.filter(c => c.callId !== callId));
}

function parseIncomingCallEntry(raw: string): IncomingCallEntry | null {
  try {
    const parsed = JSON.parse(raw) as Partial<IncomingCallEntry>;
    if (
      typeof parsed.callId !== "string" ||
      typeof parsed.callerId !== "string" ||
      typeof parsed.callType !== "string" ||
      typeof parsed.livekitUrl !== "string" ||
      typeof parsed.livekitToken !== "string" ||
      typeof parsed.expiresAt !== "number"
    ) {
      return null;
    }

    return {
      callId: parsed.callId,
      callerId: parsed.callerId,
      callerName: typeof parsed.callerName === "string" ? parsed.callerName : undefined,
      callType: parsed.callType === "video" ? "video" : "voice",
      livekitUrl: parsed.livekitUrl,
      livekitToken: parsed.livekitToken,
      expiresAt: parsed.expiresAt,
    };
  } catch {
    return null;
  }
}

async function queueIncomingCallInRedis(userId: string, entry: IncomingCallEntry): Promise<boolean> {
  try {
    const queueKey = incomingQueueKey(userId);
    const client = getRedisClient();
    const members = await client.zrange(queueKey, 0, -1);
    const toRemove = members.filter((member) => parseIncomingCallEntry(member)?.callId === entry.callId);
    const multi = client.multi();
    if (toRemove.length > 0) {
      multi.zrem(queueKey, ...toRemove);
    }
    await multi
      .zadd(queueKey, entry.expiresAt, JSON.stringify(entry))
      .expire(queueKey, INCOMING_QUEUE_TTL_SECONDS)
      .exec();
    return true;
  } catch (error) {
    logger.warn("CallsService", `incoming queue Redis write failed for ${userId}: ${String(error)}`);
    return false;
  }
}

async function popIncomingCallFromRedis(userId: string): Promise<IncomingCallEntry | null> {
  try {
    const queueKey = incomingQueueKey(userId);
    const client = getRedisClient();
    const now = Date.now();
    await client.zremrangebyscore(queueKey, 0, now);
    const members = await client.zrange(queueKey, 0, -1);

    for (const member of members) {
      const entry = parseIncomingCallEntry(member);
      if (!entry || entry.expiresAt <= now) {
        await client.zrem(queueKey, member).catch(() => undefined);
        continue;
      }

      const removed = await client.zrem(queueKey, member);
      if (removed > 0) {
        removeIncomingCallFromMemory(userId, entry.callId);
        return entry;
      }
    }
  } catch (error) {
    logger.warn("CallsService", `incoming queue Redis read failed for ${userId}: ${String(error)}`);
  }

  return null;
}

async function removeIncomingCallFromRedis(userId: string, callId: string): Promise<void> {
  try {
    const queueKey = incomingQueueKey(userId);
    const client = getRedisClient();
    const members = await client.zrange(queueKey, 0, -1);
    if (members.length === 0) return;

    const toRemove = members.filter((member) => parseIncomingCallEntry(member)?.callId === callId);
    if (toRemove.length > 0) {
      await client.zrem(queueKey, ...toRemove);
    }
  } catch (error) {
    logger.warn("CallsService", `incoming queue Redis remove failed for ${userId}/${callId}: ${String(error)}`);
  }
}

export async function queueIncomingCall(userId: string, payload: Omit<IncomingCallEntry, "expiresAt">): Promise<void> {
  const entry: IncomingCallEntry = { ...payload, expiresAt: Date.now() + INCOMING_TTL_MS };
  const persisted = await queueIncomingCallInRedis(userId, entry);
  if (!persisted) {
    queueIncomingCallInMemory(userId, entry);
  } else {
    removeIncomingCallFromMemory(userId, entry.callId);
  }

  // Notify any open SSE connections immediately (no polling needed)
  incomingCallBus.emit(`incoming:${userId}`, entry);
}

/**
 * Aggregate depth of the incoming-call queue across all users — the one
 * real queue in this architecture (calls/translation themselves are
 * synchronous/real-time via LiveKit, not queued). Used by /metrics and the
 * SLA dashboard. SCANs rather than KEYS to avoid blocking Redis on a large
 * keyspace; acceptable here since this only runs on a periodic metrics
 * scrape, not a request hot path.
 */
export async function getIncomingCallQueueDepth(): Promise<number> {
  try {
    const client = getRedisClient();
    let cursor = "0";
    let total = 0;
    do {
      const [nextCursor, keys] = await client.scan(cursor, "MATCH", `${INCOMING_QUEUE_KEY_PREFIX}*`, "COUNT", "100");
      cursor = nextCursor;
      for (const key of keys) {
        total += await client.zcard(key);
      }
    } while (cursor !== "0");
    return total;
  } catch (error) {
    logger.warn("CallsService", `Failed to compute incoming queue depth: ${String(error)}`);
    return Array.from(incomingQueue.values()).reduce((sum, list) => sum + list.length, 0);
  }
}

export async function popIncomingCall(userId: string): Promise<IncomingCallEntry | null> {
  const redisEntry = await popIncomingCallFromRedis(userId);
  if (redisEntry) {
    return redisEntry;
  }

  return popIncomingCallFromMemory(userId);
}

export async function removeIncomingCall(userId: string, callId: string): Promise<void> {
  removeIncomingCallFromMemory(userId, callId);
  await removeIncomingCallFromRedis(userId, callId);
}

export function getLivekitClientConfig() {
  return getClientConfig();
}

/**
 * Resolve a callee identifier (phone, email, username, or numeric user id) to a stored user, if any.
 */
async function resolveCalleeUser(identifier: string) {
  const rawIdentifier = (identifier ?? "").trim();
  const normalized = rawIdentifier.replace(/\s+/g, "");
  if (/^\+?\d{10,15}$/.test(normalized)) {
    return (
      (await storage.getUserByPhone(normalized)) ??
      (normalized.startsWith("+")
        ? await storage.getUserByPhone(normalized.slice(1))
        : await storage.getUserByPhone(`+${normalized}`))
    );
  }
  const asNum = Number(rawIdentifier);
  if (Number.isFinite(asNum)) {
    const byId = await storage.getUser(asNum);
    if (byId) {
      return byId;
    }
  }

  const loweredIdentifier = rawIdentifier.toLowerCase();
  return await db.query.users.findFirst({
    where: and(
      eq(users.isActive, true),
      or(
        eq(users.username, rawIdentifier),
        sql`LOWER(${users.email}) = ${loweredIdentifier}`,
        sql`REPLACE(COALESCE(${users.phone}, ''), ' ', '') = ${normalized}`,
      ),
    ),
  });
}

export interface InitiateCallParams {
  sessionIdOverride?: string;
  callerId: string;
  callerUsername?: string;
  callerDisplayName?: string;
  callerNumber: string;
  calleeIdentifier: string;
  calleeDisplayName?: string;
  callerLanguage?: string;
  calleeLanguage?: string;
  translationEnabled?: boolean;
  callerTranslationMode?: ListenerTranslationMode;
  calleeTranslationMode?: ListenerTranslationMode;
  callType: "voice" | "video";
  enableLipsync?: boolean;
  enableRecording?: boolean;
  transportPreference?: "app_to_app" | "app_to_pstn" | "auto";
  organizationIdOverride?: number | null;
  pricingOverride?: Partial<StrictBillingPlanConfig> | null;
  pstnFallbackRatePerMinutePaise?: number;
}

export async function initiateCall(params: InitiateCallParams): Promise<CallInitiateResponse> {
  const routerReq: CallInitiateRequest = {
    sessionIdOverride: params.sessionIdOverride,
    callerId: params.callerId,
    callerNumber: params.callerNumber,
    callerLanguage: params.callerLanguage || "auto",
    calleeIdentifier: params.calleeIdentifier,
    calleeLanguage: params.calleeLanguage || "auto",
    translationEnabled: params.translationEnabled,
    callType: params.callType,
    enableLipsync: params.enableLipsync,
    enableRecording: params.enableRecording,
    transportPreference: params.transportPreference || "auto",
    callerDisplayName: params.callerDisplayName || params.callerUsername,
    calleeDisplayName: params.calleeDisplayName,
    callerOrganizationIdOverride: params.organizationIdOverride ?? null,
    pricingOverride: params.pricingOverride ?? null,
    pstnFallbackRatePerMinutePaise: params.pstnFallbackRatePerMinutePaise ?? 0,
  };

  const result = await routerInitiateCall(routerReq);

  // For app-to-app calls, issue a callee LiveKit token and queue an incoming notification.
  if (result.joinMethod === "app_to_app") {
    const callee = await resolveCalleeUser(params.calleeIdentifier);
    if (callee && result.livekitUrl) {
      const calleeToken = await issueAccessToken(result.callId, {
        userId: String(callee.id),
        displayName: (callee as any).username || String(callee.id),
        language: params.calleeLanguage || (callee as any).preferredLanguage || "auto",
        translationMode: params.calleeTranslationMode || (params.translationEnabled === false ? "off" : "subtitles"),
        role: "callee",
      });
      await queueIncomingCall(String(callee.id), {
        callId: result.callId,
        callerId: params.callerId,
        callerName: params.callerDisplayName || params.callerUsername || params.callerId,
        callType: params.callType,
        livekitUrl: result.livekitUrl,
        livekitToken: calleeToken,
      });
    }
  }

  return result;
}

export interface InitiateConferenceParams {
  hostId: string;
  hostUsername?: string;
  hostLanguage?: string;
  participantIds: string[];
  title?: string;
}

export async function initiateConference(params: InitiateConferenceParams) {
  const result = await routerInitiateConference({
    hostId: params.hostId,
    hostLanguage: params.hostLanguage || "auto",
    participantIds: params.participantIds,
    title: params.title,
  });

  for (const pid of params.participantIds) {
    const tok = result.participantTokens[pid];
    if (tok && result.livekitUrl) {
      await queueIncomingCall(pid, {
        callId: result.callId,
        callerId: params.hostId,
        callerName: params.hostUsername,
        callType: "voice",
        livekitUrl: result.livekitUrl,
        livekitToken: tok,
      });
    }
  }

  return result;
}

export async function endCallById(callId: string, reason?: string) {
  return await routerEndCall(callId, reason);
}

export async function setCallHold(callId: string, requesterIdentity: string, onHold: boolean) {
  return await routerSetCallHold(callId, requesterIdentity, onHold);
}

export async function activatePstnFallback(callId: string, input: {
  callerNumber: string;
  calleePhoneNumber: string;
}) {
  return await routerActivatePstnFallback(callId, input);
}

export function isSmartCallId(callId: string): boolean {
  return routerIsSmartCallId(callId);
}

export async function getSmartCall(callId: string): Promise<SmartCallRecord | null> {
  return routerGetSmartCall(callId);
}

export async function listSmartCallsForUser(userId: string): Promise<SmartCallRecord[]> {
  return routerListSmartCallsForUser(userId);
}

export async function listSmartActiveCalls(): Promise<SmartCallRecord[]> {
  return routerListSmartActiveCalls();
}

export async function updateSmartCallStatus(
  callId: string,
  status: string,
  metadata?: Record<string, unknown>,
): Promise<SmartCallRecord | null> {
  return routerUpdateSmartCallStatus(callId, status, metadata);
}

export type { SmartCallRecord } from "./smart-router";
export type { CallInitiateResponse } from "./smart-router";

export async function isActiveSmartCall(callId: string): Promise<boolean> {
  return routerIsActiveSmartCall(callId);
}

export async function resolveCalleeForTransfer(identifier: string) {
  return routerResolveCalleeForTransfer(identifier);
}

// === DEVICE REGISTRATION ===

export interface DeviceUpsertInput {
  userId: number;
  deviceId: string;
  platform: "android" | "ios" | "web";
  pushToken?: string | null;
  voipToken?: string | null;
  deviceName?: string | null;
  appVersion?: string | null;
  osVersion?: string | null;
  capabilities?: Record<string, unknown>;
}

export async function upsertDevice(input: DeviceUpsertInput) {
  const existing = await db.select()
    .from(registeredDevices)
    .where(and(
      eq(registeredDevices.userId, input.userId),
      eq(registeredDevices.deviceId, input.deviceId),
    ))
    .limit(1);

  if (existing.length > 0) {
    const [device] = await db.update(registeredDevices)
      .set({
        pushToken: input.pushToken,
        voipToken: input.voipToken,
        deviceName: input.deviceName,
        appVersion: input.appVersion,
        osVersion: input.osVersion,
        capabilities: input.capabilities || {},
        isActive: true,
        lastSeenAt: new Date(),
      })
      .where(eq(registeredDevices.id, existing[0].id))
      .returning();
    return device;
  }

  const [device] = await db.insert(registeredDevices)
    .values({
      userId: input.userId,
      deviceId: input.deviceId,
      platform: input.platform,
      pushToken: input.pushToken,
      voipToken: input.voipToken,
      deviceName: input.deviceName,
      appVersion: input.appVersion,
      osVersion: input.osVersion,
      capabilities: input.capabilities || {},
    })
    .returning();
  return device;
}

export async function listDevicesForUser(userId: number) {
  return await db.select()
    .from(registeredDevices)
    .where(eq(registeredDevices.userId, userId));
}

export async function deactivateDevice(userId: number, deviceId: string) {
  await db.update(registeredDevices)
    .set({ isActive: false })
    .where(and(
      eq(registeredDevices.userId, userId),
      eq(registeredDevices.deviceId, deviceId),
    ));
}

export async function updateDeviceToken(
  userId: number,
  deviceId: string,
  tokens: { pushToken?: string | null; voipToken?: string | null },
) {
  const updateData: { pushToken?: string | null; voipToken?: string | null; lastSeenAt: Date } = {
    lastSeenAt: new Date(),
  };
  if (tokens.pushToken !== undefined) updateData.pushToken = tokens.pushToken ?? undefined;
  if (tokens.voipToken !== undefined) updateData.voipToken = tokens.voipToken ?? undefined;

  await db.update(registeredDevices)
    .set(updateData)
    .where(and(
      eq(registeredDevices.userId, userId),
      eq(registeredDevices.deviceId, deviceId),
    ));
}

// === DISPOSITION ===

export interface DispositionInput {
  userId: number | null;
  callId?: string | number | null;
  disposition: string;
  notes?: string;
  ipAddress: string;
}

export async function recordDisposition(input: DispositionInput) {
  await db.insert(auditLogs).values({
    userId: input.userId,
    action: "call_disposition",
    entityType: "call",
    entityId: input.callId ? parseInt(String(input.callId)) || null : null,
    metadata: { disposition: input.disposition, notes: input.notes, callId: input.callId },
    ipAddress: input.ipAddress,
  });
}
