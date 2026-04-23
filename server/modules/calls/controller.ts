/**
 * Calls controller — thin request/response adapters.
 * Validates input, delegates to service, maps result to HTTP.
 */

import type { Request, Response } from "express";
import { eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { logger } from "../../observability";
import { db } from "../../db";
import type { AuthenticatedUser } from "../../role-middleware";
import {
  grantConsent,
  revokeConsent,
  updateConsent,
  checkPreCallConsent,
  PRIVACY_DISCLOSURES,
  TELCO_SAFE_MESSAGING,
  getServiceDisclaimer,
  logConsentAction,
  getAudioPolicy,
} from "../../call-privacy";
import {
  getActiveCalls,
  getUserCalls,
  getCall,
  getCallWithDetails,
  getGatewayStatus,
  getIceServers,
  addParticipant,
  removeParticipant,
  muteParticipant,
  handleNativeTelephonyEvent,
  type NativeTelephonyEvent,
  connectCall,
  updateCallStatus,
  endCall as gatewayEndCall,
  processAudioChunk,
} from "./gateway";
import {
  processStreamingAudio,
  getCallHealth,
  handleConnectionInterrupt,
  handleConnectionResume,
  hasCallConsent,
  verifyCallConsent,
} from "./streaming";
import { hasValidConsent } from "../../call-privacy";
import { CALL_STATUS, PERMISSIONS, users } from "@shared/schema";
import * as svc from "./service";
import { getMetricsSnapshot } from "./metrics";
import {
  isTerminalSmartCallState,
  normalizeSmartCallState,
  SMART_CALL_STATE,
} from "./lifecycle";

const initiateSchema = z.object({
  calleeIdentifier: z.string().min(1),
  callType: z.enum(["voice", "video"]),
  myLanguage: z.string().min(2).max(16).optional().default("auto"),
  theirLanguage: z.string().min(2).max(16).optional().default("auto"),
  enableLipsync: z.boolean().optional(),
  enableRecording: z.boolean().optional(),
});

function hasPermission(user: AuthenticatedUser | undefined, permission: string): boolean {
  if (!user) {
    return false;
  }

  return user.role === "super_admin"
    || user.permissions?.includes("*")
    || user.permissions?.includes(permission)
    || false;
}

function canViewAllCalls(user: AuthenticatedUser | undefined): boolean {
  return hasPermission(user, PERMISSIONS.CALLS_VIEW_ALL);
}

function parseNumericCallId(rawCallId: string): number | null {
  const callId = Number.parseInt(rawCallId, 10);
  return Number.isFinite(callId) ? callId : null;
}

function smartCallParticipantIds(record: svc.SmartCallRecord): string[] {
  const metadataParticipants = Array.isArray(record.metadata?.participantIds)
    ? (record.metadata.participantIds as unknown[]).filter(
        (value): value is string => typeof value === "string" && value.length > 0,
      )
    : [];

  return Array.from(
    new Set([
      ...(record.calleeUserId ? [record.calleeUserId] : []),
      ...metadataParticipants,
    ]),
  );
}

function smartCallOrganizationIds(record: svc.SmartCallRecord): number[] {
  const metadataOrganizations = Array.isArray(record.metadata?.participantOrganizations)
    ? (record.metadata.participantOrganizations as unknown[]).filter(
        (value): value is number => typeof value === "number" && Number.isFinite(value),
      )
    : [];

  return Array.from(
    new Set(
      [
        record.callerOrganizationId,
        record.calleeOrganizationId,
        ...metadataOrganizations,
      ].filter((value): value is number => typeof value === "number" && Number.isFinite(value)),
    ),
  );
}

function isActiveStatus(status: string | null | undefined): boolean {
  const smartState = normalizeSmartCallState(status);
  if (smartState) {
    return !isTerminalSmartCallState(smartState);
  }

  const activeStatuses: string[] = [
    CALL_STATUS.PENDING,
    CALL_STATUS.RINGING,
    CALL_STATUS.ACTIVE,
    CALL_STATUS.ON_HOLD,
  ];
  return activeStatuses.includes(status ?? "");
}

function serializeSmartCall(record: svc.SmartCallRecord) {
  const connectedAtMs = record.connectedAt ? Date.parse(record.connectedAt) : NaN;
  const endedAtMs = record.endedAt ? Date.parse(record.endedAt) : Date.now();
  const duration = Number.isFinite(connectedAtMs)
    ? Math.max(0, Math.floor((endedAtMs - connectedAtMs) / 1000))
    : null;

  return {
    id: record.callId,
    callId: record.callId,
    status: record.status,
    joinMethod: record.joinMethod,
    callerUserId: Number.parseInt(record.callerId, 10) || null,
    receiverUserId: record.calleeUserId ? Number.parseInt(record.calleeUserId, 10) || null : null,
    callerNumber: record.callerNumber ?? null,
    receiverNumber: record.calleeIdentifier,
    callType: record.callType,
    callerLanguage: record.callerLanguage,
    receiverLanguage: record.calleeLanguage ?? null,
    translationEnabled: record.languageDetectionActive,
    startedAt: record.createdAt,
    connectedAt: record.connectedAt ?? null,
    endedAt: record.endedAt ?? null,
    duration,
    livekitUrl: record.livekitUrl ?? null,
    pstnCallId: record.pstnCallId ?? null,
    metadata: {
      ...(record.metadata || {}),
      participantIds: smartCallParticipantIds(record),
    },
  };
}

async function isUserInRequesterOrganization(
  requester: AuthenticatedUser,
  targetUserId: number,
): Promise<boolean> {
  if (!requester.organizationId) {
    return false;
  }

  const targetUser = await db.query.users.findFirst({
    columns: {
      id: true,
      organizationId: true,
    },
    where: eq(users.id, targetUserId),
  });

  return !!targetUser && targetUser.organizationId === requester.organizationId;
}

async function canAccessRequestedUser(
  requester: AuthenticatedUser,
  targetUserId: number,
): Promise<boolean> {
  if (requester.id === targetUserId || requester.role === "super_admin") {
    return true;
  }

  if (!canViewAllCalls(requester)) {
    return false;
  }

  return isUserInRequesterOrganization(requester, targetUserId);
}

async function legacyCallMatchesRequesterOrganization(
  requester: AuthenticatedUser,
  call: { callerUserId?: number | null; receiverUserId?: number | null },
): Promise<boolean> {
  if (!requester.organizationId) {
    return false;
  }

  const participantIds = [call.callerUserId, call.receiverUserId].filter(
    (value): value is number => typeof value === "number" && Number.isFinite(value),
  );
  if (participantIds.length === 0) {
    return false;
  }

  const participantUsers = await db.select({
    organizationId: users.organizationId,
  }).from(users).where(inArray(users.id, participantIds));

  return participantUsers.some((participant) => participant.organizationId === requester.organizationId);
}

async function canAccessLegacyCall(
  requester: AuthenticatedUser,
  call: { callerUserId?: number | null; receiverUserId?: number | null },
): Promise<boolean> {
  if (
    requester.role === "super_admin"
    || requester.id === call.callerUserId
    || requester.id === call.receiverUserId
  ) {
    return true;
  }

  if (!canViewAllCalls(requester)) {
    return false;
  }

  return legacyCallMatchesRequesterOrganization(requester, call);
}

function canAccessSmartCall(requester: AuthenticatedUser, call: svc.SmartCallRecord): boolean {
  if (requester.role === "super_admin" || String(requester.id) === call.callerId) {
    return true;
  }

  if (call.calleeUserId && String(requester.id) === call.calleeUserId) {
    return true;
  }

  if (smartCallParticipantIds(call).includes(String(requester.id))) {
    return true;
  }

  if (!canViewAllCalls(requester) || !requester.organizationId) {
    return false;
  }

  return smartCallOrganizationIds(call).includes(requester.organizationId);
}

function sendAccessDenied(res: Response) {
  return res.status(403).json({ error: "Access denied" });
}

export function livekitConfig(_req: Request, res: Response) {
  res.json(svc.getLivekitClientConfig());
}

export async function initiate(req: Request, res: Response) {
  try {
    const parsed = initiateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "Invalid request", errors: parsed.error.flatten() });
    }
    const user = req.user!;
    const result = await svc.initiateCall({
      callerId: String(user.id),
      callerUsername: user.username,
      callerNumber: (user as any).phone || "",
      calleeIdentifier: parsed.data.calleeIdentifier,
      callerLanguage: parsed.data.myLanguage,
      calleeLanguage: parsed.data.theirLanguage,
      callType: parsed.data.callType,
      enableLipsync: parsed.data.enableLipsync,
      enableRecording: parsed.data.enableRecording,
    });
    res.json(result);
  } catch (e: any) {
    logger.error("CallInitiate", `Failed: ${e?.message}`, e);
    res.status(500).json({ message: e?.message ?? "Call initiate failed" });
  }
}

export async function conference(req: Request, res: Response) {
  try {
    const { hostLanguage, participantIds, title } = req.body as {
      hostLanguage?: string;
      participantIds: string[];
      title?: string;
    };
    if (!Array.isArray(participantIds)) {
      return res.status(400).json({ message: "participantIds required" });
    }
    const user = req.user!;
    const result = await svc.initiateConference({
      hostId: String(user.id),
      hostUsername: user.username,
      hostLanguage: hostLanguage || "auto",
      participantIds,
      title,
    });
    res.json(result);
  } catch (e: any) {
    logger.error("CallConference", `Failed: ${e?.message}`, e);
    res.status(500).json({ message: e?.message ?? "Conference failed" });
  }
}

export async function end(req: Request, res: Response) {
  try {
    const user = req.user!;
    const rawCallId = req.params.callId;

    if (svc.isSmartCallId(rawCallId)) {
      const call = await svc.getSmartCall(rawCallId);
      if (!call) return res.status(404).json({ error: "Call not found" });
      if (!canAccessSmartCall(user, call)) return sendAccessDenied(res);

      const result = await svc.endCallById(rawCallId);
      return res.json({
        callId: rawCallId,
        status: SMART_CALL_STATE.ENDED,
        ...result,
      });
    }

    const callId = parseNumericCallId(rawCallId);
    if (callId === null) return res.status(400).json({ error: "Invalid call ID" });

    const call = await getCall(callId);
    if (!call) return res.status(404).json({ error: "Call not found" });
    if (!(await canAccessLegacyCall(user, call))) return sendAccessDenied(res);

    const endedCall = await gatewayEndCall(callId);
    if (!endedCall) return res.status(404).json({ error: "Call not found" });
    res.json(endedCall);
  } catch (error) {
    console.error("Error ending call:", error);
    res.status(500).json({ error: "Failed to end call" });
  }
}

const connectCallSchema = z.object({
  receiverNumber: z.string().min(10),
});

const updateStatusSchema = z.object({
  status: z.enum([
    "pending",
    "ringing",
    "active",
    "on_hold",
    "completed",
    "failed",
    "missed",
    "busy",
    "created",
    "answered",
    "ended",
    "cancelled",
  ]),
  metadata: z.record(z.unknown()).optional(),
  outboundCallSid: z.string().optional(),
});

export async function connect(req: Request, res: Response) {
  try {
    const rawCallId = req.params.callId;
    if (svc.isSmartCallId(rawCallId)) {
      const call = await svc.getSmartCall(rawCallId);
      if (!call) return res.status(404).json({ error: "Call not found" });
      if (!canAccessSmartCall(req.user!, call)) return sendAccessDenied(res);
      let updated;
      try {
        updated = await svc.updateSmartCallStatus(rawCallId, SMART_CALL_STATE.ANSWERED, {
          receiverNumber: req.body?.receiverNumber,
        });
      } catch (error: any) {
        return res.status(409).json({ error: error?.message ?? "Invalid call transition" });
      }
      return res.json(updated ? serializeSmartCall(updated) : { callId: rawCallId, status: SMART_CALL_STATE.ANSWERED });
    }

    const callId = parseNumericCallId(rawCallId);
    if (callId === null) return res.status(400).json({ error: "Invalid call ID" });
    const validation = connectCallSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({ error: "Invalid request", details: validation.error.issues });
    }
    const existingCall = await getCall(callId);
    if (!existingCall) return res.status(404).json({ error: "Call not found" });
    if (!(await canAccessLegacyCall(req.user!, existingCall))) return sendAccessDenied(res);
    const call = await connectCall(callId, validation.data.receiverNumber);
    if (!call) return res.status(404).json({ error: "Call not found" });
    res.json(call);
  } catch (error) {
    console.error("Error connecting call:", error);
    res.status(500).json({ error: "Failed to connect call" });
  }
}

export async function statusUpdate(req: Request, res: Response) {
  try {
    const validation = updateStatusSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({ error: "Invalid request", details: validation.error.issues });
    }

    const user = req.user!;
    const rawCallId = req.params.callId;
    const { status, metadata } = validation.data;

    if (svc.isSmartCallId(rawCallId)) {
      const call = await svc.getSmartCall(rawCallId);
      if (!call) return res.status(404).json({ error: "Call not found" });
      if (!canAccessSmartCall(user, call)) return sendAccessDenied(res);

      const nextState = normalizeSmartCallState(status);
      if (!nextState) {
        return res.status(400).json({ error: `Unsupported call state: ${status}` });
      }

      if (isTerminalSmartCallState(nextState)) {
        const result = await svc.endCallById(rawCallId, nextState);
        return res.json({
          callId: rawCallId,
          status: nextState,
          ...result,
        });
      }

      let updated;
      try {
        updated = await svc.updateSmartCallStatus(rawCallId, nextState, metadata);
      } catch (error: any) {
        return res.status(409).json({ error: error?.message ?? "Invalid call transition" });
      }
      if (!updated) return res.status(404).json({ error: "Call not found" });
      return res.json(serializeSmartCall(updated));
    }

    const callId = parseNumericCallId(rawCallId);
    if (callId === null) return res.status(400).json({ error: "Invalid call ID" });

    const call = await getCall(callId);
    if (!call) return res.status(404).json({ error: "Call not found" });
    if (!(await canAccessLegacyCall(user, call))) return sendAccessDenied(res);

    const updated = await updateCallStatus(callId, status, metadata);
    if (!updated) return res.status(404).json({ error: "Call not found" });
    res.json(updated);
  } catch (error) {
    console.error("Error updating call status:", error);
    res.status(500).json({ error: "Failed to update call status" });
  }
}

export function reject(req: Request, res: Response) {
  try {
    svc.removeIncomingCall(String(req.user!.id), req.params.id);
    if (svc.isSmartCallId(req.params.id)) {
      void svc.updateSmartCallStatus(req.params.id, CALL_STATUS.MISSED, {
        rejectedByUserId: req.user!.id,
      });
    }
    res.json({ success: true });
  } catch {
    res.status(500).json({ message: "Reject failed" });
  }
}

export function incoming(req: Request, res: Response) {
  const next = svc.popIncomingCall(String(req.user!.id));
  res.json({ incoming: next });
}

export async function msg91Webhook(req: Request, res: Response) {
  logger.info("MSG91Webhook", `call=${req.params.id}`, req.body);

  const providerStatus = String(
    req.body?.status
      ?? req.body?.event
      ?? req.body?.call_status
      ?? req.body?.data?.status
      ?? "",
  ).toLowerCase();

  const mappedStatus =
    providerStatus.includes("answer") || providerStatus.includes("connect")
      ? SMART_CALL_STATE.ANSWERED
      : providerStatus.includes("ring")
        ? SMART_CALL_STATE.RINGING
        : providerStatus.includes("busy")
          ? SMART_CALL_STATE.BUSY
          : providerStatus.includes("fail") || providerStatus.includes("cancel") || providerStatus.includes("reject")
            ? SMART_CALL_STATE.FAILED
            : providerStatus.includes("complete") || providerStatus.includes("end")
              ? SMART_CALL_STATE.ENDED
              : null;

  if (mappedStatus && svc.isSmartCallId(req.params.id)) {
    try {
      if (mappedStatus === SMART_CALL_STATE.ANSWERED) {
        await svc.updateSmartCallStatus(req.params.id, SMART_CALL_STATE.ANSWERED, {
          providerStatus,
          webhookPayload: req.body,
        });
        await svc.updateSmartCallStatus(req.params.id, SMART_CALL_STATE.ACTIVE, {
          providerStatus,
          webhookPayload: req.body,
        });
      } else if (isTerminalSmartCallState(mappedStatus)) {
        await svc.endCallById(req.params.id, mappedStatus);
      } else {
        await svc.updateSmartCallStatus(req.params.id, mappedStatus, {
          providerStatus,
          webhookPayload: req.body,
        });
      }
    } catch (error) {
      logger.warn("MSG91Webhook", `state sync ignored for ${req.params.id}: ${String(error)}`);
    }
  }

  res.json({ received: true });
}

// === CONSENT & PRIVACY ===

export async function consentCheckMe(req: Request, res: Response) {
  try {
    const userId = req.user!.id;
    const check = await checkPreCallConsent(userId);
    res.json({ hasConsent: check.canProceed });
  } catch (error) {
    console.error("Error checking consent:", error);
    res.status(500).json({ error: "Failed to check consent" });
  }
}

export async function consentGrantMe(req: Request, res: Response) {
  try {
    const userId = req.user!.id;
    const { termsAccepted, translationConsent, recordingConsent } = req.body;
    if (!termsAccepted || !translationConsent) {
      return res.status(400).json({ error: "Terms and translation consent are required" });
    }
    const consent = await grantConsent(userId, {
      translationProcessing: translationConsent,
      audioRecording: recordingConsent || false,
      emotionAnalysis: true,
      dataRetention: "none",
    });
    logConsentAction(userId, "grant", `Consent granted via web: v${consent.consentVersion}`);
    res.status(201).json({ success: true, consent });
  } catch (error) {
    console.error("Error granting consent:", error);
    res.status(500).json({ error: "Failed to grant consent" });
  }
}

export function privacyDisclosures(_req: Request, res: Response) {
  res.json({
    disclosures: PRIVACY_DISCLOSURES,
    disclaimer: getServiceDisclaimer(),
    messaging: TELCO_SAFE_MESSAGING,
  });
}

export async function consentCheckByUser(req: Request, res: Response) {
  try {
    const userId = parseInt(req.params.userId);
    if (isNaN(userId)) return res.status(400).json({ error: "Invalid user ID" });
    if (!(await canAccessRequestedUser(req.user!, userId))) return sendAccessDenied(res);
    const check = await checkPreCallConsent(userId);
    logConsentAction(userId, "check", `Consent check: canProceed=${check.canProceed}`);
    res.json(check);
  } catch (error) {
    console.error("Error checking consent:", error);
    res.status(500).json({ error: "Failed to check consent" });
  }
}

export async function consentGrantByUser(req: Request, res: Response) {
  try {
    const userId = parseInt(req.params.userId);
    if (isNaN(userId)) return res.status(400).json({ error: "Invalid user ID" });
    if (!(await canAccessRequestedUser(req.user!, userId))) return sendAccessDenied(res);
    const { translationProcessing, audioRecording, emotionAnalysis, dataRetention } = req.body;
    if (translationProcessing !== true) {
      return res.status(400).json({ error: "Translation processing consent is required to use this service" });
    }
    const consent = await grantConsent(userId, {
      translationProcessing,
      audioRecording,
      emotionAnalysis,
      dataRetention,
    });
    logConsentAction(userId, "grant", `Consent granted: v${consent.consentVersion}`);
    res.status(201).json(consent);
  } catch (error) {
    console.error("Error granting consent:", error);
    res.status(500).json({ error: "Failed to grant consent" });
  }
}

export async function consentUpdateByUser(req: Request, res: Response) {
  try {
    const userId = parseInt(req.params.userId);
    if (isNaN(userId)) return res.status(400).json({ error: "Invalid user ID" });
    if (!(await canAccessRequestedUser(req.user!, userId))) return sendAccessDenied(res);
    const updates = req.body;
    const consent = await updateConsent(userId, updates);
    if (!consent) return res.status(404).json({ error: "No existing consent found" });
    logConsentAction(userId, "update", `Consent updated`);
    res.json(consent);
  } catch (error) {
    console.error("Error updating consent:", error);
    res.status(500).json({ error: "Failed to update consent" });
  }
}

export async function consentRevokeByUser(req: Request, res: Response) {
  try {
    const userId = parseInt(req.params.userId);
    if (isNaN(userId)) return res.status(400).json({ error: "Invalid user ID" });
    if (!(await canAccessRequestedUser(req.user!, userId))) return sendAccessDenied(res);
    await revokeConsent(userId);
    logConsentAction(userId, "revoke", `Consent revoked`);
    res.status(204).send();
  } catch (error) {
    console.error("Error revoking consent:", error);
    res.status(500).json({ error: "Failed to revoke consent" });
  }
}

// === READ / STATUS ===

export function gatewayStatus(_req: Request, res: Response) {
  try {
    const status = getGatewayStatus();
    res.json(status);
  } catch (error) {
    console.error("Error getting gateway status:", error);
    res.status(500).json({ error: "Failed to get gateway status" });
  }
}

export async function activeCalls(req: Request, res: Response) {
  try {
    const user = req.user!;

    if (canViewAllCalls(user)) {
      const [legacyCalls, smartCalls] = await Promise.all([
        getActiveCalls(),
        svc.listSmartActiveCalls(),
      ]);

      let scopedLegacy = legacyCalls;
      if (user.role !== "super_admin") {
        const allowedLegacyCalls = [];
        for (const call of legacyCalls) {
          if (await canAccessLegacyCall(user, call)) {
            allowedLegacyCalls.push(call);
          }
        }
        scopedLegacy = allowedLegacyCalls;
      }

      const scopedSmart = smartCalls
        .filter((call) => canAccessSmartCall(user, call))
        .map(serializeSmartCall);

      return res.json([...scopedLegacy, ...scopedSmart]);
    }

    const [legacyCalls, smartCalls] = await Promise.all([
      getUserCalls(user.id),
      svc.listSmartCallsForUser(String(user.id)),
    ]);

    const activeLegacy = legacyCalls.filter((call) => isActiveStatus(call.status));
    const activeSmart = smartCalls
      .filter((call) => isActiveStatus(call.status))
      .map(serializeSmartCall);

    res.json([...activeLegacy, ...activeSmart]);
  } catch (error) {
    console.error("Error getting active calls:", error);
    res.status(500).json({ error: "Failed to get active calls" });
  }
}

export async function userCalls(req: Request, res: Response) {
  try {
    const userId = parseInt(req.params.userId);
    if (isNaN(userId)) return res.status(400).json({ error: "Invalid user ID" });
    if (!(await canAccessRequestedUser(req.user!, userId))) return sendAccessDenied(res);

    const [legacyCalls, smartCalls] = await Promise.all([
      getUserCalls(userId),
      svc.listSmartCallsForUser(String(userId)),
    ]);

    res.json([...legacyCalls, ...smartCalls.map(serializeSmartCall)]);
  } catch (error) {
    console.error("Error getting user calls:", error);
    res.status(500).json({ error: "Failed to get user calls" });
  }
}

export async function callById(req: Request, res: Response) {
  try {
    const user = req.user!;
    const rawCallId = req.params.callId;

    if (svc.isSmartCallId(rawCallId)) {
      const call = await svc.getSmartCall(rawCallId);
      if (!call) return res.status(404).json({ error: "Call not found" });
      if (!canAccessSmartCall(user, call)) return sendAccessDenied(res);
      return res.json(serializeSmartCall(call));
    }

    const callId = parseNumericCallId(rawCallId);
    if (callId === null) return res.status(400).json({ error: "Invalid call ID" });

    const call = await getCall(callId);
    if (!call) return res.status(404).json({ error: "Call not found" });
    if (!(await canAccessLegacyCall(user, call))) return sendAccessDenied(res);
    res.json(call);
  } catch (error) {
    console.error("Error getting call:", error);
    res.status(500).json({ error: "Failed to get call" });
  }
}

export async function callDetails(req: Request, res: Response) {
  try {
    const user = req.user!;
    const rawCallId = req.params.callId;

    if (svc.isSmartCallId(rawCallId)) {
      const call = await svc.getSmartCall(rawCallId);
      if (!call) return res.status(404).json({ error: "Call not found" });
      if (!canAccessSmartCall(user, call)) return sendAccessDenied(res);
      return res.json(serializeSmartCall(call));
    }

    const callId = parseNumericCallId(rawCallId);
    if (callId === null) return res.status(400).json({ error: "Invalid call ID" });

    const call = await getCallWithDetails(callId);
    if (!call) return res.status(404).json({ error: "Call not found" });
    if (!(await canAccessLegacyCall(user, call))) return sendAccessDenied(res);
    res.json(call);
  } catch (error) {
    console.error("Error getting call details:", error);
    res.status(500).json({ error: "Failed to get call details" });
  }
}

export function iceServers(_req: Request, res: Response) {
  try {
    const servers = getIceServers();
    res.json({ iceServers: servers });
  } catch (error) {
    console.error("Error getting ICE servers:", error);
    res.status(500).json({ error: "Failed to get ICE servers" });
  }
}

export function signalingInfo(_req: Request, res: Response) {
  try {
    const status = getGatewayStatus();
    res.json({
      signalingUrl: `ws://localhost:${status.signalingPort}`,
      infrastructure: status.infrastructure,
      connectedClients: status.connectedClients,
      activeCalls: status.activeCalls,
    });
  } catch (error) {
    console.error("Error getting signaling info:", error);
    res.status(500).json({ error: "Failed to get signaling info" });
  }
}

// === PARTICIPANTS ===

const addParticipantSchema = z.object({
  phoneNumber: z.string().min(10),
  userId: z.number().optional(),
  role: z.string().optional(),
  language: z.string().optional(),
});

export async function participantAdd(req: Request, res: Response) {
  try {
    const rawCallId = req.params.callId;
    if (svc.isSmartCallId(rawCallId)) {
      const call = await svc.getSmartCall(rawCallId);
      if (!call) return res.status(404).json({ error: "Call not found" });
      if (!canAccessSmartCall(req.user!, call)) return sendAccessDenied(res);
      return res.status(400).json({ error: "Participant management is not supported for smart WebRTC sessions" });
    }

    const callId = parseNumericCallId(rawCallId);
    if (callId === null) return res.status(400).json({ error: "Invalid call ID" });
    const validation = addParticipantSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({ error: "Invalid request", details: validation.error.issues });
    }

    const call = await getCall(callId);
    if (!call) return res.status(404).json({ error: "Call not found" });
    if (!(await canAccessLegacyCall(req.user!, call))) return sendAccessDenied(res);

    const { phoneNumber, ...options } = validation.data;
    const participant = await addParticipant(callId, phoneNumber, options);
    res.status(201).json(participant);
  } catch (error) {
    console.error("Error adding participant:", error);
    res.status(500).json({ error: "Failed to add participant" });
  }
}

export async function participantRemove(req: Request, res: Response) {
  try {
    const rawCallId = req.params.callId;
    if (svc.isSmartCallId(rawCallId)) {
      const call = await svc.getSmartCall(rawCallId);
      if (!call) return res.status(404).json({ error: "Call not found" });
      if (!canAccessSmartCall(req.user!, call)) return sendAccessDenied(res);
      return res.status(400).json({ error: "Participant management is not supported for smart WebRTC sessions" });
    }

    const callId = parseNumericCallId(rawCallId);
    if (callId === null) return res.status(400).json({ error: "Invalid call ID" });
    const call = await getCall(callId);
    if (!call) return res.status(404).json({ error: "Call not found" });
    if (!(await canAccessLegacyCall(req.user!, call))) return sendAccessDenied(res);

    const participantId = parseInt(req.params.participantId);
    if (isNaN(participantId)) return res.status(400).json({ error: "Invalid participant ID" });
    await removeParticipant(participantId);
    res.status(204).send();
  } catch (error) {
    console.error("Error removing participant:", error);
    res.status(500).json({ error: "Failed to remove participant" });
  }
}

export async function participantMute(req: Request, res: Response) {
  try {
    const rawCallId = req.params.callId;
    if (svc.isSmartCallId(rawCallId)) {
      const call = await svc.getSmartCall(rawCallId);
      if (!call) return res.status(404).json({ error: "Call not found" });
      if (!canAccessSmartCall(req.user!, call)) return sendAccessDenied(res);
      return res.status(400).json({ error: "Participant management is not supported for smart WebRTC sessions" });
    }

    const callId = parseNumericCallId(rawCallId);
    if (callId === null) return res.status(400).json({ error: "Invalid call ID" });
    const call = await getCall(callId);
    if (!call) return res.status(404).json({ error: "Call not found" });
    if (!(await canAccessLegacyCall(req.user!, call))) return sendAccessDenied(res);

    const participantId = parseInt(req.params.participantId);
    if (isNaN(participantId)) return res.status(400).json({ error: "Invalid participant ID" });
    const { muted } = req.body;
    if (typeof muted !== "boolean") return res.status(400).json({ error: "muted must be a boolean" });
    await muteParticipant(participantId, muted);
    res.status(204).send();
  } catch (error) {
    console.error("Error muting participant:", error);
    res.status(500).json({ error: "Failed to mute participant" });
  }
}

// === NATIVE TELEPHONY & DISPOSITION ===

export async function nativeBridge(req: Request, res: Response) {
  try {
    const event = req.body as NativeTelephonyEvent;
    if (!event.type || !event.callId) {
      return res.status(400).json({ error: "Invalid event payload" });
    }
    const result = await handleNativeTelephonyEvent(event);
    if (result.success) {
      res.json(result);
    } else {
      res.status(400).json({ error: result.error });
    }
  } catch (error) {
    console.error("Error handling native telephony event:", error);
    res.status(500).json({ error: "Failed to handle telephony event" });
  }
}

export async function disposition(req: Request, res: Response) {
  try {
    const { callId, disposition, notes } = req.body;
    if (!disposition) return res.status(400).json({ error: "Disposition is required" });

    if (callId) {
      if (typeof callId === "string" && svc.isSmartCallId(callId)) {
        const smartCall = await svc.getSmartCall(callId);
        if (!smartCall) return res.status(404).json({ error: "Call not found" });
        if (!canAccessSmartCall(req.user!, smartCall)) return sendAccessDenied(res);
      } else {
        const numericCallId = parseNumericCallId(String(callId));
        if (numericCallId === null) return res.status(400).json({ error: "Invalid call ID" });
        const call = await getCall(numericCallId);
        if (!call) return res.status(404).json({ error: "Call not found" });
        if (!(await canAccessLegacyCall(req.user!, call))) return sendAccessDenied(res);
      }
    }

    await svc.recordDisposition({
      userId: req.user?.id ?? null,
      callId,
      disposition,
      notes,
      ipAddress: req.ip || "unknown",
    });
    res.json({ success: true, disposition });
  } catch (error) {
    console.error("Failed to save disposition:", error);
    res.status(500).json({ error: "Failed to save disposition" });
  }
}

// === DEVICES ===

const deviceRegistrationSchema = z.object({
  deviceId: z.string().min(1, "deviceId is required"),
  platform: z.enum(["android", "ios", "web"], { errorMap: () => ({ message: "platform must be android, ios, or web" }) }),
  pushToken: z.string().optional().nullable(),
  voipToken: z.string().optional().nullable(),
  deviceName: z.string().optional().nullable(),
  appVersion: z.string().optional().nullable(),
  osVersion: z.string().optional().nullable(),
  capabilities: z.record(z.unknown()).optional().default({}),
});

const deviceTokenUpdateSchema = z.object({
  pushToken: z.string().optional().nullable(),
  voipToken: z.string().optional().nullable(),
});

export async function deviceRegister(req: Request, res: Response) {
  try {
    const userId = req.user!.id;
    const validation = deviceRegistrationSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({ error: "Invalid request", details: validation.error.issues });
    }
    const device = await svc.upsertDevice({ userId, ...validation.data });
    res.status(201).json({ success: true, device });
  } catch (error) {
    console.error("Error registering device:", error);
    res.status(500).json({ error: "Failed to register device" });
  }
}

export async function deviceList(req: Request, res: Response) {
  try {
    const userId = req.user!.id;
    const devices = await svc.listDevicesForUser(userId);
    res.json({ devices });
  } catch (error) {
    console.error("Error fetching devices:", error);
    res.status(500).json({ error: "Failed to fetch devices" });
  }
}

export async function deviceUnregister(req: Request, res: Response) {
  try {
    const userId = req.user!.id;
    await svc.deactivateDevice(userId, req.params.deviceId);
    res.json({ success: true, message: "Device unregistered" });
  } catch (error) {
    console.error("Error unregistering device:", error);
    res.status(500).json({ error: "Failed to unregister device" });
  }
}

export async function deviceUpdateToken(req: Request, res: Response) {
  try {
    const userId = req.user!.id;
    const validation = deviceTokenUpdateSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({ error: "Invalid request", details: validation.error.issues });
    }
    await svc.updateDeviceToken(userId, req.params.deviceId, validation.data);
    res.json({ success: true, message: "Token updated" });
  } catch (error) {
    console.error("Error updating device token:", error);
    res.status(500).json({ error: "Failed to update token" });
  }
}

export async function consentAudioPolicy(req: Request, res: Response) {
  try {
    const userId = parseInt(req.params.userId);
    if (isNaN(userId)) return res.status(400).json({ error: "Invalid user ID" });
    if (!(await canAccessRequestedUser(req.user!, userId))) return sendAccessDenied(res);
    const policy = await getAudioPolicy(userId);
    res.json(policy);
  } catch (error) {
    console.error("Error getting audio policy:", error);
    res.status(500).json({ error: "Failed to get audio policy" });
  }
}

// === TRANSLATION / VOICE / MISC-STATUS ===

const VALID_VOICE_IDS = ["alloy", "echo", "fable", "onyx", "nova", "shimmer"] as const;
type VoiceId = typeof VALID_VOICE_IDS[number];

const EMOTION_SPEED_MAP: Record<string, number> = {
  happy: 1.05,
  excited: 1.1,
  calm: 0.95,
  sad: 0.88,
  angry: 1.08,
  stressed: 1.02,
  neutral: 1.0,
};

const EMOTION_VOICE_MAP: Record<string, { voice: string; speed: number }> = {
  happy: { voice: "nova", speed: 1.05 },
  excited: { voice: "nova", speed: 1.1 },
  calm: { voice: "shimmer", speed: 0.95 },
  sad: { voice: "onyx", speed: 0.88 },
  angry: { voice: "echo", speed: 1.08 },
  stressed: { voice: "fable", speed: 1.02 },
  neutral: { voice: "alloy", speed: 1.0 },
};

const MALE_VOICES: VoiceId[] = ["echo", "onyx", "fable"];
const FEMALE_VOICES: VoiceId[] = ["nova", "shimmer", "alloy"];

function createWavHeader(dataSize: number, sampleRate: number, bitsPerSample: number, channels: number): Buffer {
  const header = Buffer.alloc(44);
  const byteRate = sampleRate * channels * (bitsPerSample / 8);
  const blockAlign = channels * (bitsPerSample / 8);

  header.write("RIFF", 0);
  header.writeUInt32LE(36 + dataSize, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write("data", 36);
  header.writeUInt32LE(dataSize, 40);

  return header;
}

function analyzeAudioPitch(audioBuffer: Buffer): { estimatedGender: "male" | "female"; fundamentalFrequency: number; confidence: number } {
  const samples: number[] = [];
  const headerOffset = 44;
  for (let i = headerOffset; i < audioBuffer.length - 1; i += 2) {
    if (i + 1 < audioBuffer.length) {
      samples.push(audioBuffer.readInt16LE(i));
    }
  }

  if (samples.length < 1600) {
    return { estimatedGender: "male", fundamentalFrequency: 120, confidence: 0.3 };
  }

  const sampleRate = 16000;
  const minPeriod = Math.floor(sampleRate / 400);
  const maxPeriod = Math.floor(sampleRate / 60);
  const frameSize = Math.min(4096, samples.length);
  const frame = samples.slice(0, frameSize);

  let bestCorrelation = -1;
  let bestPeriod = minPeriod;

  for (let period = minPeriod; period <= Math.min(maxPeriod, frameSize / 2); period++) {
    let correlation = 0;
    let energy1 = 0;
    let energy2 = 0;
    const len = Math.min(frameSize - period, 2048);

    for (let i = 0; i < len; i++) {
      correlation += frame[i] * frame[i + period];
      energy1 += frame[i] * frame[i];
      energy2 += frame[i + period] * frame[i + period];
    }

    const normalizer = Math.sqrt(energy1 * energy2);
    if (normalizer > 0) {
      correlation /= normalizer;
    }

    if (correlation > bestCorrelation) {
      bestCorrelation = correlation;
      bestPeriod = period;
    }
  }

  const fundamentalFrequency = sampleRate / bestPeriod;
  const confidence = Math.max(0, Math.min(1, bestCorrelation));

  const estimatedGender: "male" | "female" = fundamentalFrequency < 180 ? "male" : "female";

  return { estimatedGender, fundamentalFrequency, confidence };
}

function selectVoiceForGender(gender: "male" | "female"): VoiceId {
  if (gender === "male") {
    return MALE_VOICES[Math.floor(Math.random() * MALE_VOICES.length)];
  }
  return FEMALE_VOICES[Math.floor(Math.random() * FEMALE_VOICES.length)];
}

export async function detectVoice(req: Request, res: Response) {
  try {
    const { audio } = req.body;

    if (!audio) {
      return res.status(400).json({ error: "Missing required field: audio (base64 encoded)" });
    }

    const audioBuffer = Buffer.from(audio, "base64");
    const wavHeader = createWavHeader(audioBuffer.length, 16000, 16, 1);
    const wavBuffer = Buffer.concat([wavHeader, audioBuffer]);

    const pitchAnalysis = analyzeAudioPitch(wavBuffer);
    const suggestedVoiceId = selectVoiceForGender(pitchAnalysis.estimatedGender);

    res.json({
      suggestedVoiceId,
      estimatedGender: pitchAnalysis.estimatedGender,
      fundamentalFrequency: Math.round(pitchAnalysis.fundamentalFrequency),
      confidence: Math.round(pitchAnalysis.confidence * 100) / 100,
      maleVoices: MALE_VOICES,
      femaleVoices: FEMALE_VOICES,
    });
  } catch (error) {
    console.error("Voice detection error:", error);
    res.status(500).json({ error: "Voice detection failed" });
  }
}

export async function translate(req: Request, res: Response) {
  try {
    const { audio, sourceLanguage, targetLanguage, detectEmotion, includeAudio = true, voiceId } = req.body;

    if (!audio || !sourceLanguage || !targetLanguage) {
      res.status(400).json({ error: "Missing required fields: audio, sourceLanguage, targetLanguage" });
      return;
    }

    const pipelineStart = Date.now();

    const audioBuffer = Buffer.from(audio, "base64");
    const wavHeader = createWavHeader(audioBuffer.length, 16000, 16, 1);
    const wavBuffer = Buffer.concat([wavHeader, audioBuffer]);

    const preferLocal = process.env.PREFER_LOCAL_AI === "true";
    if (preferLocal) {
      try {
        const { isLocalAIAvailable, localTranslateSpeech } = await import("../../local-ai-service");
        const availability = await isLocalAIAvailable();

        if (availability.whisper && availability.translation) {
          const result = await localTranslateSpeech(
            wavBuffer,
            sourceLanguage,
            targetLanguage,
            detectEmotion
          );

          let audioBase64: string | null = null;
          let usedVoice: string = "alloy";
          if (includeAudio && result.translatedText) {
            try {
              const validVoiceId = voiceId && VALID_VOICE_IDS.includes(voiceId) ? voiceId as VoiceId : null;
              if (validVoiceId) {
                usedVoice = validVoiceId;
              } else {
                const voiceConfig = EMOTION_VOICE_MAP[result.emotion || "neutral"] || EMOTION_VOICE_MAP.neutral;
                usedVoice = voiceConfig.voice;
              }
              const { textToSpeech } = await import("../../replit_integrations/audio/client");
              const ttsBuffer = await textToSpeech(result.translatedText, usedVoice as any, "mp3", targetLanguage);
              audioBase64 = ttsBuffer.toString("base64");
            } catch (ttsErr) {
              console.warn("[Translation] TTS failed for local result:", ttsErr);
            }
          }

          res.json({
            originalText: result.originalText,
            translatedText: result.translatedText,
            emotion: result.emotion || null,
            audioBase64,
            voiceId: usedVoice,
            sourceLanguage,
            targetLanguage,
            latencyMs: Date.now() - pipelineStart,
            provider: "local",
          });
          return;
        }
      } catch (localError) {
        console.warn("[Translation] Local AI unavailable, falling back to OpenAI");
      }
    }

    const { speechToText, textToSpeech, openai } = await import("../../replit_integrations/audio/client");
    let transcribedText = "";
    try {
      transcribedText = await speechToText(wavBuffer, "wav", sourceLanguage);
    } catch (sttError: any) {
      console.warn("[Translation] STT failed (possibly bad audio):", sttError?.message || sttError);
      res.json({ originalText: "", translatedText: "", emotion: null, audioBase64: null });
      return;
    }

    if (!transcribedText || transcribedText.trim().length === 0) {
      res.json({ originalText: "", translatedText: "", emotion: null, audioBase64: null });
      return;
    }

    let translatedText = transcribedText;
    try {
      const { getCachedTranslation, setCachedTranslation } = await import("../../ultra-pipeline");
      const cached = getCachedTranslation(transcribedText, sourceLanguage, targetLanguage);
      if (cached) {
        translatedText = cached;
      } else {
        try {
          const response = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [
              { role: "system", content: "You are a fast translator. Output only the translation, nothing else." },
              { role: "user", content: `Translate from ${sourceLanguage} to ${targetLanguage}:\n\n${transcribedText}` }
            ],
            max_tokens: 300,
            temperature: 0.3,
          });
          translatedText = response.choices[0]?.message?.content?.trim() || transcribedText;
          if (translatedText && translatedText !== transcribedText) {
            setCachedTranslation(transcribedText, sourceLanguage, targetLanguage, translatedText);
          }
        } catch {
          try {
            const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(transcribedText)}&langpair=${sourceLanguage}|${targetLanguage}`;
            const ctrl = new AbortController();
            const t = setTimeout(() => ctrl.abort(), 2000);
            const resp = await fetch(url, { signal: ctrl.signal });
            clearTimeout(t);
            if (resp.ok) {
              const data = (await resp.json()) as any;
              if (data.responseStatus === 200 && data.responseData?.translatedText) {
                translatedText = data.responseData.translatedText;
              }
            }
          } catch { /* keep original text */ }
        }
      }
    } catch {
      translatedText = transcribedText;
    }

    let emotion: string | null = null;
    if (detectEmotion) {
      const text = transcribedText.toLowerCase();
      if (/\b(happy|glad|great|wonderful|love|yay|haha|😊|😄)\b/i.test(text)) emotion = "happy";
      else if (/\b(sad|sorry|miss|cry|😢|😞)\b/i.test(text)) emotion = "sad";
      else if (/\b(angry|mad|furious|hate|damn|😡)\b/i.test(text)) emotion = "angry";
      else if (/\b(excited|amazing|wow|awesome|incredible|🎉)\b/i.test(text)) emotion = "excited";
      else if (/\b(calm|peaceful|relax|gentle)\b/i.test(text)) emotion = "calm";
      else if (/\b(stressed|anxious|worried|nervous)\b/i.test(text)) emotion = "stressed";
      else emotion = "neutral";
    }

    let audioBase64: string | null = null;
    let usedVoiceId: string = "alloy";
    if (includeAudio && translatedText && translatedText.trim().length > 0) {
      try {
        const validVoiceId = voiceId && VALID_VOICE_IDS.includes(voiceId) ? voiceId as VoiceId : null;

        if (validVoiceId) {
          usedVoiceId = validVoiceId;
        } else {
          const voiceConfig = EMOTION_VOICE_MAP[emotion || "neutral"] || EMOTION_VOICE_MAP.neutral;
          usedVoiceId = voiceConfig.voice;
        }

        let emotionModulatedText = translatedText.trim();
        const emotionSpeed = EMOTION_SPEED_MAP[emotion || "neutral"] || 1.0;
        if (emotion && emotion !== "neutral") {
          const intensity = emotionSpeed;
          if (emotion === "sad" && intensity < 1.0) {
            emotionModulatedText = emotionModulatedText.replace(/\./g, "...");
          } else if (emotion === "angry" && intensity > 1.0) {
            emotionModulatedText = emotionModulatedText.replace(/\./g, "!");
          }
        }

        const ttsBuffer = await textToSpeech(
          emotionModulatedText,
          usedVoiceId as any,
          "mp3",
          targetLanguage
        );
        audioBase64 = ttsBuffer.toString("base64");
      } catch (ttsError) {
        console.warn("[Translation] Voice identity TTS failed:", ttsError);
      }
    }

    res.json({
      originalText: transcribedText,
      translatedText: translatedText.trim(),
      emotion,
      audioBase64,
      voiceId: usedVoiceId,
      sourceLanguage,
      targetLanguage,
      latencyMs: Date.now() - pipelineStart,
      provider: "openai",
    });
  } catch (error) {
    console.error("Call translation error:", error);
    res.status(500).json({ error: "Translation failed" });
  }
}

export async function localAiStatus(_req: Request, res: Response) {
  try {
    const { isLocalAIAvailable, DOCKER_COMPOSE_CONFIG, ENV_VARS_TEMPLATE } = await import("../../local-ai-service");
    const availability = await isLocalAIAvailable();

    res.json({
      available: availability.whisper && availability.translation,
      services: availability,
      preferLocal: process.env.PREFER_LOCAL_AI === "true",
      expectedLatency: availability.whisper && availability.translation ? "<300ms" : "500-1500ms",
      setupGuide: {
        dockerCompose: DOCKER_COMPOSE_CONFIG,
        envVars: ENV_VARS_TEMPLATE,
      },
    });
  } catch (error) {
    res.json({
      available: false,
      services: { whisper: false, translation: false, emotion: false },
      preferLocal: false,
      expectedLatency: "500-1500ms",
      error: "Local AI services not configured",
    });
  }
}

export async function ultraLowLatencyStatus(_req: Request, res: Response) {
  try {
    const { isUltraLowLatencyAvailable, ULTRA_LOW_LATENCY_DOCKER_CONFIG, ULTRA_LOW_LATENCY_ENV_TEMPLATE } =
      await import("../../ultra-low-latency-service");
    const availability = await isUltraLowLatencyAvailable();

    res.json({
      available: availability.streamingSTT && availability.streamingTranslation && availability.streamingTTS,
      services: {
        streamingSTT: availability.streamingSTT,
        streamingTranslation: availability.streamingTranslation,
        streamingTTS: availability.streamingTTS,
      },
      enabled: process.env.ULTRA_LOW_LATENCY === "true",
      expectedLatencyMs: availability.expectedLatencyMs,
      target: "<100ms",
      setupGuide: {
        dockerCompose: ULTRA_LOW_LATENCY_DOCKER_CONFIG,
        envVars: ULTRA_LOW_LATENCY_ENV_TEMPLATE,
      },
    });
  } catch (error) {
    res.json({
      available: false,
      services: { streamingSTT: false, streamingTranslation: false, streamingTTS: false },
      enabled: false,
      expectedLatencyMs: 1500,
      error: "Ultra-low latency services not configured",
    });
  }
}

export async function voiceCloningStatus(_req: Request, res: Response) {
  try {
    const { isVoiceCloningAvailable, VOICE_CLONING_DOCKER_CONFIG, VOICE_CLONING_ENV_TEMPLATE } =
      await import("../../voice-cloning-service");
    const availability = await isVoiceCloningAvailable();

    res.json({
      available: availability.rvc || availability.xtts,
      services: availability,
      enabled: process.env.ENABLE_VOICE_CLONING === "true",
      features: {
        voicePreservation: availability.rvc || availability.xtts,
        prosodyExtraction: availability.prosody,
        emotionPreservation: availability.prosody,
      },
      setupGuide: {
        dockerCompose: VOICE_CLONING_DOCKER_CONFIG,
        envVars: VOICE_CLONING_ENV_TEMPLATE,
      },
    });
  } catch (error) {
    res.json({
      available: false,
      services: { rvc: false, xtts: false, prosody: false },
      enabled: false,
      error: "Voice cloning services not configured",
    });
  }
}

export async function translateNatural(req: Request, res: Response) {
  try {
    const { audio, sourceLanguage, targetLanguage, voiceProfileId } = req.body;

    if (!audio || !sourceLanguage || !targetLanguage) {
      res.status(400).json({ error: "Missing required fields" });
      return;
    }

    const audioBuffer = Buffer.from(audio, "base64");
    const wavHeader = createWavHeader(audioBuffer.length, 16000, 16, 1);
    const wavBuffer = Buffer.concat([wavHeader, audioBuffer]);

    const { speechToText, textToSpeech: ttsFunc, openai } = await import("../../replit_integrations/audio/client");
    let transcribedText = "";
    try {
      transcribedText = await speechToText(wavBuffer, "wav", sourceLanguage);
    } catch (sttError: any) {
      console.warn("[Translation-Natural] STT failed:", sttError?.message || sttError);
      res.json({ originalText: "", translatedText: "", audioBase64: null });
      return;
    }

    if (!transcribedText || transcribedText.trim().length === 0) {
      res.json({ originalText: "", translatedText: "", audioBase64: null });
      return;
    }

    let translatedText = "";

    try {
      const { isAzureTranslatorAvailable, azureTranslate } = await import("../../azure-service");
      if (isAzureTranslatorAvailable()) {
        const result = await azureTranslate(transcribedText, sourceLanguage, targetLanguage);
        if (result && result !== transcribedText) translatedText = result;
      }
    } catch {
      // Azure not available
    }

    if (!translatedText) {
      try {
        const translationResponse = await openai.chat.completions.create({
          model: "gpt-4o-mini",
          messages: [
            {
              role: "system",
              content: `Translate the following text from ${sourceLanguage} to ${targetLanguage}.
              Preserve the emotional tone and speaking style.
              Return only the translated text, nothing else.`,
            },
            { role: "user", content: transcribedText },
          ],
          temperature: 0.3,
        });
        translatedText = translationResponse.choices[0]?.message?.content?.trim() || "";
      } catch {
        console.warn("[Translation-Natural] OpenAI failed, using free fallback");
        try {
          const { translateText: freeTranslate } = await import("../../elevenlabs-service");
          translatedText = await freeTranslate(transcribedText, sourceLanguage, targetLanguage);
        } catch {
          translatedText = transcribedText;
        }
      }
    }

    let audioBase64: string | null = null;
    let provider = "none";

    if (process.env.ENABLE_VOICE_CLONING === "true" && voiceProfileId) {
      try {
        const { translateWithVoicePreservation } = await import("../../voice-cloning-service");
        const { storage } = await import("../../storage");

        const voiceProfile = await (storage as any).getVoiceProfile?.(voiceProfileId);

        if (voiceProfile && voiceProfile.status === "ready" && voiceProfile.embeddings) {
          const result = await translateWithVoicePreservation(
            wavBuffer,
            translatedText,
            voiceProfileId,
            voiceProfile.embeddings
          );

          audioBase64 = result.audioBuffer.toString("base64");
          provider = result.provider;
        }
      } catch (vcError) {
        console.warn("[Translation] Voice cloning unavailable:", vcError);
      }
    }

    if (!audioBase64) {
      try {
        const { textToSpeech } = await import("../../replit_integrations/audio/client");
        const ttsBuffer = await textToSpeech(translatedText, "nova", "mp3", targetLanguage);
        audioBase64 = ttsBuffer.toString("base64");
        provider = "openai-tts";
      } catch (ttsError) {
        console.warn("[Translation] TTS failed:", ttsError);
      }
    }

    res.json({
      originalText: transcribedText,
      translatedText,
      audioBase64,
      provider,
      sourceLanguage,
      targetLanguage,
    });
  } catch (error) {
    console.error("Natural translation error:", error);
    res.status(500).json({ error: "Translation failed" });
  }
}

// === AUDIO / STREAMING PIPELINE ===

export async function audio(req: Request, res: Response) {
  try {
    const callId = parseInt(req.params.callId);
    if (isNaN(callId)) {
      return res.status(400).json({ error: "Invalid call ID" });
    }

    const direction = req.query.direction as "caller" | "receiver";
    if (!direction || !["caller", "receiver"].includes(direction)) {
      return res.status(400).json({ error: "Invalid direction. Must be 'caller' or 'receiver'" });
    }

    const audioData = req.body as Buffer;
    if (!audioData || audioData.length === 0) {
      return res.status(400).json({ error: "No audio data provided" });
    }

    const result = await processAudioChunk(callId, audioData, direction);

    if (result.error) {
      return res.status(400).json({ error: result.error });
    }

    if (result.translatedAudio) {
      res.set("Content-Type", "audio/wav");
      res.send(result.translatedAudio);
    } else {
      res.status(204).send();
    }
  } catch (error) {
    console.error("Error processing audio:", error);
    res.status(500).json({ error: "Failed to process audio" });
  }
}

export async function stream(req: Request, res: Response) {
  try {
    const callId = parseInt(req.params.callId);
    if (isNaN(callId)) {
      return res.status(400).json({ error: "Invalid call ID" });
    }

    const direction = req.query.direction as "caller" | "receiver";
    const sequence = parseInt(req.query.sequence as string) || 0;

    if (!direction || !["caller", "receiver"].includes(direction)) {
      return res.status(400).json({ error: "Invalid direction" });
    }

    const consentInfo = hasCallConsent(callId);
    if (!consentInfo.verified) {
      const userId = direction === "caller" ? consentInfo.callerUserId : consentInfo.receiverUserId;
      if (userId) {
        const hasConsent = await hasValidConsent(userId);
        if (!hasConsent) {
          return res.status(403).json({
            error: "Consent required",
            message: "User must provide consent before audio processing"
          });
        }
        verifyCallConsent(callId);
      }
    }

    const audioData = req.body as Buffer;
    if (!audioData || audioData.length === 0) {
      return res.status(400).json({ error: "No audio data" });
    }

    const result = await processStreamingAudio(callId, audioData, direction, sequence);

    if (result.error) {
      return res.status(400).json({ error: result.error });
    }

    if (result.outputAudio) {
      res.set("Content-Type", "audio/wav");
      if (result.translation) {
        res.set("X-Translation-Latency", String(result.translation.latencyMs));
        res.set("X-Emotion-Detected", result.translation.emotion.emotion);
        if (result.translation.latencyMs > 500) {
          res.set("X-Latency-Warning", "true");
        }
      }
      res.send(result.outputAudio);
    } else {
      res.status(204).send();
    }
  } catch (error) {
    console.error("Error in streaming audio:", error);
    res.status(500).json({ error: "Streaming error" });
  }
}

export async function callHealth(req: Request, res: Response) {
  try {
    const callId = parseInt(req.params.callId);
    if (isNaN(callId)) {
      return res.status(400).json({ error: "Invalid call ID" });
    }

    const health = getCallHealth(callId);
    if (!health) {
      return res.status(404).json({ error: "Call not found" });
    }

    res.json(health);
  } catch (error) {
    console.error("Error getting call health:", error);
    res.status(500).json({ error: "Failed to get call health" });
  }
}

export async function interrupt(req: Request, res: Response) {
  try {
    const callId = parseInt(req.params.callId);
    if (isNaN(callId)) {
      return res.status(400).json({ error: "Invalid call ID" });
    }

    handleConnectionInterrupt(callId);
    res.status(204).send();
  } catch (error) {
    console.error("Error handling interrupt:", error);
    res.status(500).json({ error: "Failed to handle interrupt" });
  }
}

export async function resume(req: Request, res: Response) {
  try {
    const callId = parseInt(req.params.callId);
    if (isNaN(callId)) {
      return res.status(400).json({ error: "Invalid call ID" });
    }

    const success = handleConnectionResume(callId);
    if (!success) {
      return res.status(404).json({ error: "Call not found or ended" });
    }

    res.status(204).send();
  } catch (error) {
    console.error("Error resuming connection:", error);
    res.status(500).json({ error: "Failed to resume connection" });
  }
}

// === ADMIN METRICS ===

export function callMetrics(_req: Request, res: Response) {
  res.json(getMetricsSnapshot());
}
