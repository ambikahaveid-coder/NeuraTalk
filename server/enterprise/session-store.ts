/**
 * Enterprise Call Session Store
 *
 * Redis-backed store for active enterprise AI overlay sessions.
 * TTL: 4 hours (14400s) — covers even the longest enterprise call.
 */

import { getRedisClient } from "../redis";
import { logger } from "../observability";
import type { EnterpriseCallSession } from "./types";

const PREFIX = "enterprise:session";
const TTL = 14_400;

function key(callId: string): string {
  return `${PREFIX}:${callId}`;
}

export async function createEnterpriseSession(session: EnterpriseCallSession): Promise<void> {
  const redis = getRedisClient();
  await redis.set(key(session.callId), JSON.stringify(session), "EX", TTL);
  await redis.sadd(`enterprise:org:${session.organizationId}:active`, session.callId);
  await redis.expire(`enterprise:org:${session.organizationId}:active`, TTL);
}

export async function getEnterpriseSession(callId: string): Promise<EnterpriseCallSession | null> {
  try {
    const raw = await getRedisClient().get(key(callId));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export async function appendTranscript(
  callId: string,
  entry: EnterpriseCallSession["transcript"][0],
): Promise<void> {
  const session = await getEnterpriseSession(callId);
  if (!session) return;
  session.transcript.push(entry);
  // Keep last 500 utterances in memory
  if (session.transcript.length > 500) {
    session.transcript = session.transcript.slice(-500);
  }
  await getRedisClient().set(key(callId), JSON.stringify(session), "EX", TTL);
}

export async function endEnterpriseSession(callId: string): Promise<EnterpriseCallSession | null> {
  const session = await getEnterpriseSession(callId);
  if (!session) return null;
  const redis = getRedisClient();
  await redis.del(key(callId));
  if (session.organizationId) {
    await redis.srem(`enterprise:org:${session.organizationId}:active`, callId);
  }
  return session;
}

export async function getActiveSessionsForOrg(organizationId: string): Promise<string[]> {
  try {
    return await getRedisClient().smembers(`enterprise:org:${organizationId}:active`);
  } catch {
    return [];
  }
}
