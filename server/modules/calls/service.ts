/**
 * Calls service — orchestrates call initiation, conference, hang-up, and the
 * in-memory incoming-call queue. Wraps smart-call-router (the unified routing
 * engine) so controllers never touch low-level LiveKit/MSG91 concerns.
 *
 * NOTE: smart-call-router.ts itself is kept at server/smart-call-router.ts
 * until call-streaming + call-gateway also migrate (Phase 2). It is imported
 * through this service as the single integration point.
 */

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
  type CallInitiateRequest,
  type CallInitiateResponse,
  type SmartCallRecord,
} from "./smart-router";
import { getClientConfig, issueAccessToken } from "../../livekit-service";
import { storage } from "../../storage";
import { db } from "../../db";
import { registeredDevices, auditLogs } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import type { StrictBillingPlanConfig } from "../../billing-config";

const INCOMING_TTL_MS = 45_000;

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

export function queueIncomingCall(userId: string, payload: Omit<IncomingCallEntry, "expiresAt">): void {
  const list = incomingQueue.get(userId) ?? [];
  list.push({ ...payload, expiresAt: Date.now() + INCOMING_TTL_MS });
  incomingQueue.set(userId, list);
}

export function popIncomingCall(userId: string): IncomingCallEntry | null {
  const list = incomingQueue.get(userId);
  if (!list || list.length === 0) return null;
  const now = Date.now();
  const alive = list.filter(c => c.expiresAt > now);
  incomingQueue.set(userId, alive);
  return alive[0] ?? null;
}

export function removeIncomingCall(userId: string, callId: string): void {
  const list = incomingQueue.get(userId);
  if (!list) return;
  incomingQueue.set(userId, list.filter(c => c.callId !== callId));
}

export function getLivekitClientConfig() {
  return getClientConfig();
}

/**
 * Resolve a callee identifier (phone or numeric user id) to a stored user, if any.
 */
async function resolveCalleeUser(identifier: string) {
  const normalized = identifier.replace(/\s+/g, "");
  if (/^\+?\d{10,15}$/.test(normalized)) {
    return await storage.getUserByPhone(identifier);
  }
  const asNum = Number(identifier);
  if (Number.isFinite(asNum)) {
    return await storage.getUser(asNum);
  }
  return undefined;
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
        role: "callee",
      });
      queueIncomingCall(String(callee.id), {
        callId: result.callId,
        callerId: params.callerId,
        callerName: params.callerUsername,
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
      queueIncomingCall(pid, {
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
