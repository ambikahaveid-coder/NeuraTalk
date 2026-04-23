/**
 * CALL PERSISTENCE LAYER
 *
 * Bridges the Redis-based smart-call-router to permanent PostgreSQL storage.
 * Every completed call must be persisted so billing, analytics, and audit
 * remain accurate even after the 24-hour Redis TTL expires.
 *
 * This module is imported by smart-router.ts at call-end time.
 */

import { db } from "./db";
import { bridgedCalls, callTelemetry, usageRecords } from "@shared/schema";
import { eq } from "drizzle-orm";
import { logger } from "./observability";

export interface CallPersistencePayload {
  callId: string;
  joinMethod: "app_to_app" | "app_to_pstn" | "conference";
  callerId: string;
  callerUserId?: number | null;
  callerOrganizationId?: number | null;
  callerNumber?: string | null;
  calleeIdentifier: string;
  calleeUserId?: string | null;
  calleeOrganizationId?: number | null;
  callType: "voice" | "video";
  callerLanguage: string;
  calleeLanguage?: string | null;
  translationEnabled: boolean;
  emotionPreservation?: boolean;
  livekitUrl?: string | null;
  status: string;
  createdAt: string;
  connectedAt?: string | null;
  endedAt?: string | null;
  totalCostInr: number;
  translationMinutes: number;
  relayOnlyMinutes: number;
  metadata?: Record<string, unknown>;
}

/**
 * Persist a completed call to PostgreSQL.
 * Called from smart-router endCall() after billing is finalized.
 * Fails silently with logging — never blocks call teardown.
 */
export async function persistCompletedCall(payload: CallPersistencePayload): Promise<number | null> {
  try {
    const startedAt = payload.createdAt ? new Date(payload.createdAt) : new Date();
    const connectedAt = payload.connectedAt ? new Date(payload.connectedAt) : null;
    const endedAt = payload.endedAt ? new Date(payload.endedAt) : new Date();

    // Calculate duration in seconds
    const durationMs = connectedAt
      ? endedAt.getTime() - connectedAt.getTime()
      : endedAt.getTime() - startedAt.getTime();
    const durationSeconds = Math.max(0, Math.round(durationMs / 1000));

    const [inserted] = await db
      .insert(bridgedCalls)
      .values({
        callSid: payload.callId,
        callerNumber: payload.callerNumber || payload.callerId,
        callerUserId: payload.callerUserId ?? null,
        receiverNumber: payload.calleeIdentifier,
        receiverUserId: payload.calleeUserId ? parseInt(String(payload.calleeUserId), 10) || null : null,
        gatewayNumber: payload.joinMethod,
        providerId: payload.livekitUrl ? "livekit" : "direct",
        status: payload.status || "completed",
        callerLanguage: payload.callerLanguage || "auto",
        receiverLanguage: payload.calleeLanguage || "auto",
        translationEnabled: payload.translationEnabled ?? true,
        emotionPreservation: payload.emotionPreservation ?? true,
        startedAt,
        connectedAt,
        endedAt,
        duration: durationSeconds,
        metadata: {
          joinMethod: payload.joinMethod,
          callType: payload.callType,
          totalCostInr: payload.totalCostInr,
          translationMinutes: payload.translationMinutes,
          relayOnlyMinutes: payload.relayOnlyMinutes,
          callerOrganizationId: payload.callerOrganizationId,
          calleeOrganizationId: payload.calleeOrganizationId,
          ...(payload.metadata || {}),
        },
      })
      .returning({ id: bridgedCalls.id });

    logger.info("CallPersistence", `Call ${payload.callId} persisted to DB (id=${inserted.id}, duration=${durationSeconds}s, cost=₹${payload.totalCostInr})`);
    return inserted.id;
  } catch (error) {
    // Duplicate callSid — call was already persisted (idempotent)
    if (error instanceof Error && error.message.includes("unique")) {
      logger.info("CallPersistence", `Call ${payload.callId} already persisted (duplicate callSid)`);
      return null;
    }

    logger.error("CallPersistence", `Failed to persist call ${payload.callId}`, error instanceof Error ? error : new Error(String(error)));
    return null;
  }
}

/**
 * Persist call telemetry snapshot (latency, jitter, packet loss).
 * Called at call-end or periodically during long calls.
 */
export async function persistCallTelemetry(opts: {
  callDbId: number;
  userId?: number;
  sttLatency?: number;
  translationLatency?: number;
  ttsLatency?: number;
  audioJitter?: number;
  audioPacketLoss?: number;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  try {
    await db.insert(callTelemetry).values({
      callId: opts.callDbId,
      userId: opts.userId,
      speechToTextLatency: opts.sttLatency,
      translationLatency: opts.translationLatency,
      textToSpeechLatency: opts.ttsLatency,
      audioJitter: opts.audioJitter,
      audioPacketLoss: opts.audioPacketLoss,
      metadata: opts.metadata || {},
    });
  } catch (error) {
    logger.warn("CallPersistence", `Failed to persist telemetry for call DB id ${opts.callDbId}: ${String(error)}`);
  }
}

/**
 * Persist a usage record for billing audit trail.
 * Every deducted minute is recorded for reconciliation.
 */
export async function persistUsageRecord(opts: {
  userId: number;
  organizationId?: number | null;
  subscriptionId: number;
  callDbId?: number | null;
  callSid: string;
  durationSeconds: number;
  costPaise: number;
  translationUsed: boolean;
}): Promise<void> {
  try {
    await db.insert(usageRecords).values({
      userId: opts.userId,
      organizationId: opts.organizationId ?? null,
      subscriptionId: opts.subscriptionId,
      callId: opts.callDbId ?? null,
      usageType: "voice_call",
      durationSeconds: opts.durationSeconds,
      minutesConsumed: Math.ceil(opts.durationSeconds / 60),
      translationUsed: opts.translationUsed,
      baseCostPaise: opts.costPaise,
      totalCostPaise: opts.costPaise,
      billed: true,
    });
  } catch (error) {
    logger.warn("CallPersistence", `Failed to persist usage record: ${String(error)}`);
  }
}
