/**
 * Inbound PSTN call store — Redis-backed, TTL 2h.
 * Maps providerCallId ↔ internalCallId so status webhooks can correlate.
 */

import { getRedisClient } from "../redis";

export interface InboundCallRecord {
  callId: string;
  providerCallId: string;
  provider: string;
  callerNumber: string;
  calledNumber: string;
  targetUserId: string;
  targetOrganizationId: number | null;
  livekitToken: string;
  livekitUrl: string;
  sipUri: string;
  createdAt: string;
  status: "ringing" | "answered" | "ended" | "failed";
}

const TTL_SECONDS = 7200;

function keyByCallId(callId: string): string {
  return `pstn_inbound:call:${callId}`;
}

function keyByProviderCallId(providerCallId: string): string {
  return `pstn_inbound:provider:${providerCallId}`;
}

export async function storeInboundCall(record: InboundCallRecord): Promise<void> {
  const redis = getRedisClient();
  const value = JSON.stringify(record);
  await redis
    .multi()
    .set(keyByCallId(record.callId), value, "EX", TTL_SECONDS)
    .set(keyByProviderCallId(record.providerCallId), record.callId, "EX", TTL_SECONDS)
    .exec();
}

export async function getInboundCallByDID(callId: string): Promise<InboundCallRecord | null> {
  const raw = await getRedisClient().get(keyByCallId(callId));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as InboundCallRecord;
  } catch {
    return null;
  }
}

export async function getInboundCallByProviderCallId(
  providerCallId: string,
): Promise<InboundCallRecord | null> {
  const callId = await getRedisClient().get(keyByProviderCallId(providerCallId));
  if (!callId) return null;
  return getInboundCallByDID(callId);
}

export async function updateInboundCallStatus(
  callId: string,
  status: InboundCallRecord["status"],
): Promise<void> {
  const record = await getInboundCallByDID(callId);
  if (!record) return;
  record.status = status;
  await getRedisClient().set(keyByCallId(callId), JSON.stringify(record), "EX", TTL_SECONDS);
}
