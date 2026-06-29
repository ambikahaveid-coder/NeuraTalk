/**
 * PSTN Call Detail Record (CDR) exporter.
 *
 * Reads completed SmartCallRecords from Redis and persists structured CDRs to
 * PostgreSQL via call-persistence.ts.  Also provides an export endpoint so
 * admins can download CDRs as CSV/JSON.
 *
 * CDR fields:
 *   callId, direction, provider, route, callerNumber, calleeNumber,
 *   durationSeconds, costPaise, currency, result, disconnectReason,
 *   callerLanguage, calleeLanguage, translationEnabled,
 *   startedAt, answeredAt, endedAt
 */

import { getRedisClient } from "../redis";
import { logger } from "../observability";

export interface CallDetailRecord {
  callId: string;
  direction: "outbound" | "inbound";
  provider: string;
  route: "app_to_app" | "app_to_pstn" | "inbound_pstn" | "conference";
  callerNumber: string | null;
  calleeNumber: string | null;
  durationSeconds: number;
  costPaise: number;
  currency: "INR";
  result: "completed" | "failed" | "busy" | "no-answer" | "cancelled" | "missed";
  disconnectReason: string | null;
  callerLanguage: string;
  calleeLanguage: string | null;
  translationEnabled: boolean;
  startedAt: string;
  answeredAt: string | null;
  endedAt: string | null;
  organizationId: number | null;
  userId: string | null;
  rawMetadata?: Record<string, unknown>;
}

/**
 * Build a CDR from a completed SmartCallRecord.
 * Returns null if the record is not yet terminal.
 */
export function buildCDR(record: {
  callId: string;
  joinMethod: string;
  provider?: string;
  callerId: string;
  callerNumber?: string | null;
  calleeIdentifier: string;
  callerLanguage: string;
  calleeLanguage?: string | null;
  languageDetectionActive: boolean;
  status: string;
  createdAt: string;
  connectedAt?: string | null;
  endedAt?: string | null;
  terminationReason?: string | null;
  callerOrganizationId?: number | null;
  metadata?: Record<string, unknown>;
}): CallDetailRecord | null {
  const terminal = ["ended", "failed", "busy", "missed", "cancelled"].includes(record.status);
  if (!terminal) return null;

  const meta = record.metadata || {};
  const costPaise = typeof meta.prepaidDebitPaise === "number"
    ? meta.prepaidDebitPaise
    : typeof meta.postpaidAccrualPaise === "number"
      ? meta.postpaidAccrualPaise
      : 0;

  const durationSeconds = typeof meta.billingDurationSeconds === "number"
    ? meta.billingDurationSeconds
    : record.connectedAt && record.endedAt
      ? Math.round((Date.parse(record.endedAt) - Date.parse(record.connectedAt)) / 1000)
      : 0;

  const resultMap: Record<string, CallDetailRecord["result"]> = {
    ended: "completed",
    failed: "failed",
    busy: "busy",
    missed: "no-answer",
    cancelled: "cancelled",
  };

  const route: CallDetailRecord["route"] =
    record.joinMethod === "app_to_pstn" ? "app_to_pstn"
    : record.joinMethod === "conference" ? "conference"
    : record.joinMethod === "inbound_pstn" ? "inbound_pstn"
    : "app_to_app";

  return {
    callId: record.callId,
    direction: route === "inbound_pstn" ? "inbound" : "outbound",
    provider: record.provider || "livekit",
    route,
    callerNumber: record.callerNumber || null,
    calleeNumber: /^\+?\d{10,15}$/.test(record.calleeIdentifier.replace(/\s/g, ""))
      ? record.calleeIdentifier
      : null,
    durationSeconds,
    costPaise,
    currency: "INR",
    result: resultMap[record.status] || "failed",
    disconnectReason: record.terminationReason || null,
    callerLanguage: record.callerLanguage || "auto",
    calleeLanguage: record.calleeLanguage || null,
    translationEnabled: record.languageDetectionActive,
    startedAt: record.createdAt,
    answeredAt: record.connectedAt || null,
    endedAt: record.endedAt || null,
    organizationId: record.callerOrganizationId ?? null,
    userId: record.callerId || null,
    rawMetadata: meta as Record<string, unknown>,
  };
}

/**
 * Fetch CDRs for an organization from Redis (live cache; up to 200 most recent calls).
 * For full historical CDRs use the DB query in call-persistence.ts.
 */
export async function listRecentCDRsForOrg(
  organizationId: number,
  limit = 50,
): Promise<CallDetailRecord[]> {
  const redis = getRedisClient();
  try {
    const key = `cdr:org:${organizationId}`;
    const items = await redis.lrange(key, 0, limit - 1);
    return items.flatMap((raw) => {
      try {
        return [JSON.parse(raw) as CallDetailRecord];
      } catch {
        return [];
      }
    });
  } catch (err) {
    logger.warn("PSTNCDR", `Failed to fetch CDRs for org ${organizationId}: ${String(err)}`);
    return [];
  }
}

/**
 * Persist a CDR to the Redis CDR ring buffer (org-scoped, 1000-entry FIFO).
 * DB persistence happens via call-persistence.ts in smart-router endCall().
 */
export async function appendCDR(cdr: CallDetailRecord): Promise<void> {
  if (!cdr.organizationId) return;
  const redis = getRedisClient();
  const key = `cdr:org:${cdr.organizationId}`;
  try {
    await redis
      .multi()
      .lpush(key, JSON.stringify(cdr))
      .ltrim(key, 0, 999)
      .expire(key, 60 * 60 * 24 * 30) // 30 days
      .exec();
  } catch (err) {
    logger.warn("PSTNCDR", `CDR append failed for ${cdr.callId}: ${String(err)}`);
  }
}

/**
 * Format CDRs as CSV for download.
 */
export function cdrsToCSV(cdrs: CallDetailRecord[]): string {
  const headers = [
    "callId", "direction", "provider", "route", "callerNumber", "calleeNumber",
    "durationSeconds", "costPaise", "currency", "result", "disconnectReason",
    "callerLanguage", "calleeLanguage", "translationEnabled",
    "startedAt", "answeredAt", "endedAt", "organizationId", "userId",
  ];

  const escape = (v: unknown): string => {
    const s = String(v ?? "");
    return s.includes(",") || s.includes('"') || s.includes("\n")
      ? `"${s.replace(/"/g, '""')}"`
      : s;
  };

  const rows = cdrs.map((r) =>
    headers.map((h) => escape((r as any)[h])).join(",")
  );

  return [headers.join(","), ...rows].join("\n");
}
