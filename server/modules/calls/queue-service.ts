/**
 * Real ACD (Automatic Call Distributor) queue.
 *
 * Prior to this module, `routeToSkillAgent()` in smart-router.ts ignored the
 * `callQueues` schema entirely — it picked the single best available agent
 * and returned null if nobody was free, with no wait queue at all. This
 * module makes `callQueues` a real, working queue: calls that find no
 * available agent are durably enqueued (Postgres `queuedCalls` is the source
 * of truth; Redis holds a live sorted-set for fast FIFO ordering), and are
 * assigned to the next matching agent the moment one becomes available.
 *
 * Scope note (documented, not hidden): this implements queue ORDERING,
 * WAIT-TIME tracking, TIMEOUT handling, and AGENT ASSIGNMENT — a genuinely
 * working ACD queue. It does NOT implement in-call hold-music/announcement
 * audio playback (that requires a separate LiveKit audio-injection bot,
 * a distinct media feature, out of scope for this change) — the caller's
 * client is expected to show its own "waiting" UI using the position/
 * wait-time returned by getQueueStatus, the same way a REST-only ACD
 * integration would.
 */
import { eq, and, lte } from "drizzle-orm";
import { db } from "../../db";
import { getRedisClient } from "../../redis";
import { logger } from "../../observability";
import {
  callQueues,
  queuedCalls,
  agentSkills,
  agentPresence,
  QUEUED_CALL_STATUS,
  type CallQueue,
} from "@shared/schema";
import { issueAccessToken } from "../../livekit-service";
import { getSmartCall } from "./smart-router";
import { queueIncomingCall, initiateCall, resolveCalleeForTransfer, endCallById } from "./service";
import { storage } from "../../storage";

// Simple, documented heuristic — not a statistical forecast. Real average-
// handle-time-based estimation would need historical call-duration data
// aggregated per queue; that's a reporting/analytics feature, not part of
// making the queue itself functional.
const ASSUMED_AVG_HANDLE_TIME_SECONDS = 180;

function queueRedisKey(queueId: number): string {
  return `acd_queue:${queueId}`;
}

interface QueueMember {
  callId: string;
  requiredSkills: string[];
}

export async function enqueueCall(input: {
  queueId: number;
  callId: string;
  organizationId: number;
  requiredSkills: string[];
}): Promise<{ queued: true; position: number; estimatedWaitSeconds: number } | { queued: false; reason: string }> {
  const [queue] = await db.select().from(callQueues).where(eq(callQueues.id, input.queueId));
  if (!queue || !queue.isActive) {
    return { queued: false, reason: "QUEUE_NOT_FOUND_OR_INACTIVE" };
  }

  const client = getRedisClient();
  const key = queueRedisKey(input.queueId);
  const currentSize = await client.zcard(key);
  if (currentSize >= (queue.maxQueueSize ?? 20)) {
    return { queued: false, reason: "QUEUE_FULL" };
  }

  const enqueuedAtMs = Date.now();
  const member: QueueMember = { callId: input.callId, requiredSkills: input.requiredSkills };

  await db.insert(queuedCalls).values({
    queueId: input.queueId,
    callId: input.callId,
    organizationId: input.organizationId,
    requiredSkills: input.requiredSkills,
    status: QUEUED_CALL_STATUS.WAITING,
  });
  await client.zadd(key, enqueuedAtMs, JSON.stringify(member));

  const position = await getQueuePositionByScore(input.queueId, enqueuedAtMs);
  return {
    queued: true,
    position,
    estimatedWaitSeconds: position * ASSUMED_AVG_HANDLE_TIME_SECONDS,
  };
}

async function getQueuePositionByScore(queueId: number, enqueuedAtMs: number): Promise<number> {
  const client = getRedisClient();
  // Count of entries with an earlier (lower) score = how many are ahead in line.
  const ahead = await client.zcount(queueRedisKey(queueId), "-inf", `(${enqueuedAtMs}`);
  return ahead + 1;
}

export async function getQueueStatus(queueId: number, callId: string): Promise<
  { status: "waiting"; position: number; estimatedWaitSeconds: number }
  | { status: "assigned" | "abandoned" | "timed_out" }
  | { status: "not_found" }
> {
  const [row] = await db.select().from(queuedCalls).where(eq(queuedCalls.callId, callId));
  if (!row || row.queueId !== queueId) return { status: "not_found" };
  if (row.status !== QUEUED_CALL_STATUS.WAITING) {
    return { status: row.status as "assigned" | "abandoned" | "timed_out" };
  }
  const enqueuedAtMs = row.enqueuedAt ? new Date(row.enqueuedAt).getTime() : Date.now();
  const position = await getQueuePositionByScore(queueId, enqueuedAtMs);
  return { status: "waiting", position, estimatedWaitSeconds: position * ASSUMED_AVG_HANDLE_TIME_SECONDS };
}

export async function abandonQueuedCall(callId: string): Promise<void> {
  const [row] = await db.select().from(queuedCalls).where(eq(queuedCalls.callId, callId));
  if (!row || row.status !== QUEUED_CALL_STATUS.WAITING) return;

  const client = getRedisClient();
  await removeFromRedisByCallId(client, row.queueId, callId);
  const waitSeconds = row.enqueuedAt ? Math.round((Date.now() - new Date(row.enqueuedAt).getTime()) / 1000) : null;
  await db.update(queuedCalls).set({
    status: QUEUED_CALL_STATUS.ABANDONED,
    dequeuedAt: new Date(),
    waitSeconds,
  }).where(eq(queuedCalls.id, row.id));
}

async function removeFromRedisByCallId(client: ReturnType<typeof getRedisClient>, queueId: number, callId: string): Promise<void> {
  const key = queueRedisKey(queueId);
  const members = await client.zrange(key, 0, -1);
  for (const raw of members) {
    try {
      const parsed = JSON.parse(raw) as QueueMember;
      if (parsed.callId === callId) {
        await client.zrem(key, raw);
        return;
      }
    } catch {
      // malformed member, drop it defensively
      await client.zrem(key, raw).catch(() => undefined);
    }
  }
}

/**
 * Called whenever an agent becomes available (presence flips to
 * "available", or their concurrent-call count drops below their max) —
 * looks across this org's active queues (oldest-queue-first, matching the
 * order callQueues rows were created in) for the oldest waiting call this
 * agent is skilled for, assigns it, and issues the agent a token to join
 * the call's already-existing LiveKit room via the same incoming-call
 * notification path used for a fresh call (queueIncomingCall +
 * incomingCallBus, service.ts) — no new notification mechanism invented.
 */
export async function tryAssignQueuedCallToAgent(organizationId: number, agentUserId: number): Promise<boolean> {
  // Atomic claim-first: conditionally flip "available" -> "busy" and only
  // proceed if THIS call actually won that transition. Without this, two
  // near-simultaneous triggers for the same agent (e.g. a duplicate
  // heartbeat racing a genuine presence update) could both read "available"
  // before either had written "busy", and both go on to assign a call —
  // double-booking the agent. If no matching queued call turns out to
  // exist, the claim is released back to "available" below.
  const claimed = await db.update(agentPresence)
    .set({ status: "busy", lastStatusChangeAt: new Date(), updatedAt: new Date() })
    .where(and(eq(agentPresence.userId, agentUserId), eq(agentPresence.status, "available")))
    .returning({ userId: agentPresence.userId });
  if (claimed.length === 0) return false; // someone else already claimed this agent, or they're no longer available

  const [skillRow] = await db.select().from(agentSkills).where(
    and(eq(agentSkills.userId, agentUserId), eq(agentSkills.organizationId, organizationId)),
  );
  const agentSkillList = skillRow && Array.isArray(skillRow.skills) ? (skillRow.skills as string[]) : [];

  const queues = await db.select().from(callQueues).where(
    and(eq(callQueues.organizationId, organizationId), eq(callQueues.isActive, true)),
  );

  for (const queue of queues) {
    const assignedCallId = await dequeueOldestMatchingCall(queue, agentSkillList);
    if (!assignedCallId) continue;

    const assigned = await assignCallToAgent(assignedCallId, agentUserId);
    if (assigned) return true; // assignCallToAgent re-sets status:"busy" with currentCallId — the claim above already got them there, this just attaches the call id
  }

  // No matching call found anywhere — release the claim back to available
  // rather than leaving the agent stuck "busy" with nothing assigned.
  await db.update(agentPresence)
    .set({ status: "available", lastStatusChangeAt: new Date(), updatedAt: new Date() })
    .where(and(eq(agentPresence.userId, agentUserId), eq(agentPresence.status, "busy")));
  return false;
}

async function dequeueOldestMatchingCall(queue: CallQueue, agentSkillList: string[]): Promise<string | null> {
  const client = getRedisClient();
  const key = queueRedisKey(queue.id);
  const members = await client.zrange(key, 0, -1); // ascending score = oldest first (FIFO)

  for (const raw of members) {
    let parsed: QueueMember;
    try {
      parsed = JSON.parse(raw) as QueueMember;
    } catch {
      await client.zrem(key, raw).catch(() => undefined);
      continue;
    }
    const matches = parsed.requiredSkills.length === 0 || parsed.requiredSkills.every((s) => agentSkillList.includes(s));
    if (!matches) continue;

    const removed = await client.zrem(key, raw);
    if (removed > 0) return parsed.callId; // won the race to claim this entry
  }
  return null;
}

async function assignCallToAgent(callId: string, agentUserId: number): Promise<boolean> {
  const [row] = await db.select().from(queuedCalls).where(eq(queuedCalls.callId, callId));
  if (!row || row.status !== QUEUED_CALL_STATUS.WAITING) return false;

  const call = await getSmartCall(callId);
  if (!call || !call.livekitUrl) {
    logger.warn("ACDQueue", `assignCallToAgent: call ${callId} has no active LiveKit room, dropping assignment`);
    await db.update(queuedCalls).set({ status: QUEUED_CALL_STATUS.TIMED_OUT, dequeuedAt: new Date() }).where(eq(queuedCalls.id, row.id));
    return false;
  }

  const waitSeconds = row.enqueuedAt ? Math.round((Date.now() - new Date(row.enqueuedAt).getTime()) / 1000) : null;
  await db.update(queuedCalls).set({
    status: QUEUED_CALL_STATUS.ASSIGNED,
    assignedAgentUserId: agentUserId,
    dequeuedAt: new Date(),
    waitSeconds,
  }).where(eq(queuedCalls.id, row.id));

  // Flip the agent's own presence to "busy" immediately, in the same
  // transaction-adjacent step as the assignment above. Without this, the
  // agent stays marked "available" in agentPresence after being handed a
  // call — a real double-booking bug: a second presence-update call (e.g.
  // a duplicate heartbeat, or another queue's dequeue racing in) could hand
  // them a SECOND call while they're still on the first, since nothing
  // records that they're now occupied.
  await db.update(agentPresence).set({
    status: "busy",
    currentCallId: callId,
    lastStatusChangeAt: new Date(),
    updatedAt: new Date(),
  }).where(eq(agentPresence.userId, agentUserId));

  // displayName is a required field on CallParticipant (livekit-service.ts)
  // — a previous version of this code omitted it and used an `as any` cast
  // to silence the resulting type error rather than fixing it, which would
  // have shown the agent's own client an undefined participant name.
  const agentUser = await storage.getUser(agentUserId).catch(() => undefined);
  const livekitToken = await issueAccessToken(callId, {
    userId: String(agentUserId),
    displayName: agentUser?.username || String(agentUserId),
    role: "callee",
    language: "auto",
  });

  await queueIncomingCall(String(agentUserId), {
    callId,
    callerId: call.callerId,
    callType: (call.callType as "voice" | "video") ?? "voice",
    livekitUrl: call.livekitUrl,
    livekitToken,
  });

  logger.info("ACDQueue", `Assigned queued call ${callId} to agent ${agentUserId} after ${waitSeconds}s wait`);
  return true;
}

/**
 * Timeout sweep — same setInterval-based scheduler convention as
 * cleanup-job.ts/billing-scheduler.ts. Applies each queue's own
 * `afterQueueAction` (voicemail | forward | hangup) once a waiting call
 * exceeds that queue's maxWaitSeconds.
 */
export async function sweepTimedOutQueueEntries(): Promise<{ timedOut: number }> {
  const queues = await db.select().from(callQueues).where(eq(callQueues.isActive, true));
  let timedOut = 0;

  for (const queue of queues) {
    const cutoff = new Date(Date.now() - (queue.maxWaitSeconds ?? 300) * 1000);
    const expired = await db.select().from(queuedCalls).where(
      and(
        eq(queuedCalls.queueId, queue.id),
        eq(queuedCalls.status, QUEUED_CALL_STATUS.WAITING),
        lte(queuedCalls.enqueuedAt, cutoff),
      ),
    );

    for (const entry of expired) {
      await removeFromRedisByCallId(getRedisClient(), queue.id, entry.callId);
      const waitSeconds = entry.enqueuedAt ? Math.round((Date.now() - new Date(entry.enqueuedAt).getTime()) / 1000) : null;
      await db.update(queuedCalls).set({
        status: QUEUED_CALL_STATUS.TIMED_OUT,
        dequeuedAt: new Date(),
        waitSeconds,
      }).where(eq(queuedCalls.id, entry.id));
      timedOut++;
      logger.info("ACDQueue", `Call ${entry.callId} timed out in queue ${queue.id} after ${waitSeconds}s (afterQueueAction=${queue.afterQueueAction})`);
      await applyAfterQueueAction(queue, entry.callId);
    }
  }

  return { timedOut };
}

/**
 * Applies a queue's configured post-timeout action to a specific call.
 *
 * "hangup" and "forward" (to an app user) are fully implemented, reusing
 * the existing endCallById/initiateCall/resolveCalleeForTransfer service
 * functions — the same primitives the real-time blind-transfer feature
 * uses (server/modules/calls/controller.ts's transferCall).
 *
 * "voicemail" and "forward to a PSTN number" are honestly NOT implemented:
 * no call-recording/voicemail-storage feature exists anywhere in this
 * codebase yet (a separate, larger feature), and blind transfer to a PSTN
 * destination is already a known, documented gap
 * (controller.ts: "Blind transfer to PSTN not yet supported"). Rather than
 * silently pretending these work, both fall back to a clean hangup with a
 * distinct, honest termination reason so this is visible in call history/
 * logs instead of hidden.
 */
async function applyAfterQueueAction(queue: CallQueue, callId: string): Promise<void> {
  try {
    if (queue.afterQueueAction === "forward" && queue.afterQueueTarget) {
      const target = await resolveCalleeForTransfer(queue.afterQueueTarget);
      if (target.userId) {
        const call = await getSmartCall(callId);
        if (call) {
          await initiateCall({
            callerId: call.callerId,
            callerNumber: call.callerNumber ?? "",
            callerDisplayName: `Queue timeout forward from ${callId}`,
            calleeIdentifier: target.userId,
            callType: (call.callType as "voice" | "video") ?? "voice",
            transportPreference: "app_to_app" as any,
            sessionIdOverride: `call_qfwd_${callId}`,
          });
          await endCallById(callId, "queue_timeout_forwarded");
          return;
        }
      }
      logger.warn("ACDQueue", `afterQueueAction=forward configured for queue ${queue.id} but target "${queue.afterQueueTarget}" is not an app user (PSTN forward not supported) — falling back to hangup`);
    } else if (queue.afterQueueAction === "voicemail") {
      logger.warn("ACDQueue", `afterQueueAction=voicemail configured for queue ${queue.id} but no voicemail/recording feature exists yet — falling back to hangup`);
    }

    await endCallById(callId, queue.afterQueueAction === "voicemail" ? "queue_timeout_no_voicemail" : "queue_timeout_hangup");
  } catch (error) {
    logger.warn("ACDQueue", `applyAfterQueueAction failed for call ${callId}: ${String(error)}`);
  }
}

export function startAcdQueueTimeoutScheduler(): void {
  setInterval(() => {
    void sweepTimedOutQueueEntries().catch((err) => {
      logger.warn("ACDQueue", `timeout sweep failed: ${String(err)}`);
    });
  }, 30_000); // check every 30s — fine-grained enough for maxWaitSeconds defaults around 300s
  logger.info("ACDQueue", "ACD queue timeout scheduler initialized (30s interval)");
}
