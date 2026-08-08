/**
 * Toll-fraud / velocity detection for outbound PSTN calls.
 *
 * A prior audit of this codebase found zero fraud detection anywhere
 * despite the platform being PSTN-connected (a standard toll-fraud attack
 * vector: a compromised account or leaked API key dialing expensive
 * premium-rate/international numbers in bulk, racking up carrier charges
 * before anyone notices). This module closes that specific gap.
 *
 * Scope, stated plainly: this is velocity + known-premium-prefix
 * detection — the same first line of defense real telecom platforms use.
 * It is NOT a full ML-based anomaly detection system (that would need
 * historical calling-pattern data this platform doesn't yet have enough
 * volume to train on) — that's a longer-term enhancement, not pretended
 * to exist here.
 */
import { getRedisClient } from "./redis";
import { db } from "./db";
import { fraudFlags, FRAUD_FLAG_REASON } from "@shared/schema";
import { logger } from "./observability";

// Tunable via env so ops can adjust without a code change; sane defaults
// for a legitimate individual/small-business user's actual dialing pattern.
const VELOCITY_WINDOW_MS = Number(process.env.FRAUD_VELOCITY_WINDOW_MS) || 60_000; // 1 minute
const VELOCITY_MAX_CALLS = Number(process.env.FRAUD_VELOCITY_MAX_CALLS) || 10; // 10 outbound PSTN calls/minute/user
const NEW_DESTINATION_WINDOW_MS = Number(process.env.FRAUD_NEW_DEST_WINDOW_MS) || 10 * 60_000; // 10 minutes
const NEW_DESTINATION_MAX_DISTINCT = Number(process.env.FRAUD_NEW_DEST_MAX_DISTINCT) || 20; // 20 distinct new numbers/10min/org

// Known international premium-rate / high-toll-fraud-risk prefixes.
// Not exhaustive — a real production deployment would subscribe to a
// carrier-provided premium-number feed; this is a documented starting
// list covering the classic toll-fraud destinations (satellite phones,
// premium revenue-share numbers), not a claim of complete coverage.
const PREMIUM_PREFIXES = [
  "+881", "+882", "+883", // satellite phone ranges (Iridium/Globalstar/Thuraya)
  "+808", // international premium/shared-cost
  "+900", // US/generic premium-rate
  "+1900", // US premium-rate (900 numbers)
];

export interface FraudCheckResult {
  blocked: boolean;
  reason?: string;
}

function velocityKey(userId: string): string {
  return `fraud:velocity:${userId}`;
}

function newDestinationSetKey(organizationId: number): string {
  return `fraud:known_destinations:${organizationId}`;
}

async function recordFlag(input: {
  organizationId: number | null;
  userId: number | null;
  reason: string;
  calleeNumber: string;
  detail: Record<string, unknown>;
  actionTaken: "blocked" | "flagged_only";
}): Promise<void> {
  try {
    await db.insert(fraudFlags).values(input);
  } catch (error) {
    logger.warn("FraudDetection", `failed to persist fraud flag: ${String(error)}`);
  }
}

/**
 * Normalizes to digits-only before comparing against PREMIUM_PREFIXES
 * (which are also stripped of "+" for the comparison). This closes a real
 * bypass: smart-router.ts's resolveCallee() treats the "+" country-code
 * prefix as OPTIONAL when parsing a dialed number (regex `/^\+?\d{10,15}$/`)
 * — a number with no matching app user is stored exactly as dialed, so a
 * caller could dial "881612345678" (no leading "+") and the original
 * strict `calleeNumber.startsWith("+881")` check would silently never
 * match, letting a premium-rate call straight through.
 */
function isPremiumDestination(calleeNumber: string): boolean {
  const digitsOnly = calleeNumber.replace(/\D/g, "");
  return PREMIUM_PREFIXES.some((prefix) => digitsOnly.startsWith(prefix.replace(/\D/g, "")));
}

/**
 * Called from smart-router.ts's initiateCall (app_to_pstn branch) before
 * the PSTN provider is invoked. Never throws — a fraud-check failure
 * (e.g. Redis unavailable) fails OPEN (allows the call) rather than
 * blocking legitimate calls on an infrastructure hiccup; this mirrors how
 * this codebase already treats several other soft-dependency checks
 * (e.g. billing check failures in pstn/inbound.ts log a warning and
 * proceed rather than hard-failing the call).
 */
export async function checkOutboundCallFraud(input: {
  organizationId: number | null;
  userId: number | null;
  callerIdentity: string;
  calleeNumber: string;
}): Promise<FraudCheckResult> {
  try {
    const client = getRedisClient();

    // 1. Velocity check
    const vKey = velocityKey(input.callerIdentity);
    const count = await client.incr(vKey);
    if (count === 1) {
      await client.pexpire(vKey, VELOCITY_WINDOW_MS);
    }
    if (count > VELOCITY_MAX_CALLS) {
      await recordFlag({
        organizationId: input.organizationId,
        userId: input.userId,
        reason: FRAUD_FLAG_REASON.VELOCITY,
        calleeNumber: input.calleeNumber,
        detail: { count, windowMs: VELOCITY_WINDOW_MS },
        actionTaken: "blocked",
      });
      logger.warn("FraudDetection", `Velocity limit exceeded for ${input.callerIdentity}: ${count} calls/${VELOCITY_WINDOW_MS}ms — blocking`);
      return { blocked: true, reason: "TOO_MANY_CALLS_TOO_FAST" };
    }

    // 2. Premium-destination check
    if (isPremiumDestination(input.calleeNumber)) {
      await recordFlag({
        organizationId: input.organizationId,
        userId: input.userId,
        reason: FRAUD_FLAG_REASON.PREMIUM_DESTINATION,
        calleeNumber: input.calleeNumber,
        detail: {},
        actionTaken: "blocked",
      });
      logger.warn("FraudDetection", `Blocked call to premium-rate destination ${input.calleeNumber} from ${input.callerIdentity}`);
      return { blocked: true, reason: "PREMIUM_DESTINATION_BLOCKED" };
    }

    // 3. New-distinct-destination spike (org-level — catches a compromised
    // account fanning out to many never-before-called numbers, distinct
    // from the velocity check which only counts raw call count).
    if (input.organizationId) {
      const destKey = newDestinationSetKey(input.organizationId);
      const isNew = (await client.sadd(destKey, input.calleeNumber)) === 1;
      if (isNew) {
        // First time this member was added — set/refresh the window TTL only
        // when we don't know the key already has one, avoiding resetting an
        // in-progress window on every single call.
        const ttl = await client.pttl(destKey);
        if (ttl < 0) await client.pexpire(destKey, NEW_DESTINATION_WINDOW_MS);
      }
      const distinctCount = await client.scard(destKey);
      if (distinctCount > NEW_DESTINATION_MAX_DISTINCT) {
        await recordFlag({
          organizationId: input.organizationId,
          userId: input.userId,
          reason: FRAUD_FLAG_REASON.NEW_DESTINATION_SPIKE,
          calleeNumber: input.calleeNumber,
          detail: { distinctCount, windowMs: NEW_DESTINATION_WINDOW_MS },
          actionTaken: "flagged_only", // flag, don't block — higher false-positive risk than the other two checks
        });
        logger.warn("FraudDetection", `Org ${input.organizationId} dialed ${distinctCount} distinct new numbers in ${NEW_DESTINATION_WINDOW_MS}ms — flagged (not blocked)`);
      }
    }

    return { blocked: false };
  } catch (error) {
    logger.warn("FraudDetection", `fraud check failed open (allowing call): ${String(error)}`);
    return { blocked: false };
  }
}
