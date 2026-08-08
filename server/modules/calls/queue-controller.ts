import type { Request, Response } from "express";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "../../db";
import { callQueues } from "@shared/schema";
import { logger } from "../../observability";
import { initiateConference, endCallById } from "./service";
import { getSmartCall } from "./smart-router";
import { enqueueCall, getQueueStatus, abandonQueuedCall } from "./queue-service";

const joinQueueSchema = z.object({
  requiredSkills: z.array(z.string()).default([]),
});

/**
 * Entry point for an app/web caller joining a skill-based support queue —
 * e.g. a "Talk to Support" button in a customer's own app/website, calling
 * this directly (this is exactly the "embeddable API" pattern documented
 * in the platform's earlier translation-layer audit: a third party can
 * build their own calling UI on top of just this endpoint).
 *
 * Creates a real LiveKit room up front via the existing initiateConference
 * primitive (host = this caller, zero other participants), THEN enqueues
 * it — so by the time an agent is assigned, there is always a live room
 * for them to join. This is the one queue entry point in this codebase
 * that is genuinely, verifiably complete end-to-end (see queue-service.ts's
 * header comment for why the raw-PSTN-webhook entry points are NOT wired
 * the same way yet).
 */
export async function joinQueue(req: Request, res: Response) {
  try {
    const queueId = Number(req.params.queueId);
    if (!Number.isFinite(queueId)) {
      return res.status(400).json({ success: false, error: "Invalid queueId" });
    }
    const parsed = joinQueueSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({ success: false, error: parsed.error.message });
    }

    const [queue] = await db.select().from(callQueues).where(eq(callQueues.id, queueId));
    if (!queue || !queue.isActive) {
      return res.status(404).json({ success: false, error: "Queue not found or inactive" });
    }

    const user = req.user!;
    const conference = await initiateConference({
      hostId: String(user.id),
      participantIds: [],
      title: `Queue: ${queue.name}`,
    });

    const result = await enqueueCall({
      queueId,
      callId: conference.callId,
      organizationId: queue.organizationId,
      requiredSkills: parsed.data.requiredSkills,
    });

    if (!result.queued) {
      // Room was created but the queue itself is full/unavailable — tear
      // the room back down rather than leaving an orphaned billed session.
      await endCallById(conference.callId, `queue_join_rejected_${result.reason.toLowerCase()}`);
      return res.status(409).json({ success: false, error: result.reason });
    }

    return res.status(201).json({
      success: true,
      callId: conference.callId,
      livekitUrl: conference.livekitUrl,
      livekitToken: conference.livekitToken,
      queuePosition: result.position,
      estimatedWaitSeconds: result.estimatedWaitSeconds,
    });
  } catch (error) {
    logger.error("QueueController", "joinQueue failed", error as Error);
    return res.status(500).json({ success: false, error: "Failed to join queue" });
  }
}

/**
 * Both handlers below previously had NO ownership check at all — any
 * authenticated user could query or force-end ANY other user's queued call
 * just by guessing/enumerating a callId (an IDOR vulnerability). Fixed by
 * requiring the requester to be the call's own host (the identity that
 * called joinQueue in the first place), the same way call access is
 * checked elsewhere in this module (e.g. controller.ts's canAccessSmartCall).
 */
async function assertOwnsQueuedCall(req: Request, callId: string): Promise<boolean> {
  const call = await getSmartCall(callId);
  if (!call) return false;
  return call.callerId === String(req.user!.id);
}

export async function getStatus(req: Request, res: Response) {
  const queueId = Number(req.params.queueId);
  const callId = req.params.callId;
  if (!Number.isFinite(queueId) || !callId) {
    return res.status(400).json({ success: false, error: "Invalid queueId or callId" });
  }
  if (!(await assertOwnsQueuedCall(req, callId))) {
    return res.status(403).json({ success: false, error: "Not authorized for this call" });
  }
  const status = await getQueueStatus(queueId, callId);
  return res.json({ success: true, ...status });
}

export async function abandon(req: Request, res: Response) {
  const callId = req.params.callId;
  if (!callId) return res.status(400).json({ success: false, error: "Invalid callId" });
  if (!(await assertOwnsQueuedCall(req, callId))) {
    return res.status(403).json({ success: false, error: "Not authorized for this call" });
  }

  await abandonQueuedCall(callId);
  await endCallById(callId, "queue_abandoned_by_caller").catch((err) => {
    logger.warn("QueueController", `abandon: endCallById failed for ${callId}: ${String(err)}`);
  });
  return res.json({ success: true });
}
