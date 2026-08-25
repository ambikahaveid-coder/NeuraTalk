/**
 * P2: Redis-backed real-time transport for canonical business messaging.
 * See docs/neura-ecosystem (P2 architecture audit, 2026-08-25) for the full
 * investigation this implements. Read that first if extending this file.
 *
 * WHAT THIS IS: a thin pub/sub fan-out layer, deliberately kept separate
 * from server/modules/messaging/service.ts's business logic (transport
 * concerns here, message/assignment logic there -- neither imports the
 * other's internals beyond this module's public publish/subscribe API).
 *
 * WHAT THIS IS NOT:
 * - Not a new authentication system -- callers (the SSE routes) are
 *   responsible for authorizing a subscriber before ever calling
 *   subscribeToBusinessEvents/subscribeToConsumerEvents; this module trusts
 *   whatever businessId/userId it's given.
 * - Not a durable delivery guarantee. Redis PUBLISH is fire-and-forget: a
 *   process crash between a successful Postgres COMMIT and the PUBLISH
 *   call below permanently loses that one real-time notification (the
 *   underlying message/assignment change is still safe in Postgres --
 *   only the PUSH of it is lost). The existing 8-second polling in
 *   BusinessChatPage.tsx/BusinessInboxPanel.tsx is the correctness
 *   backstop for exactly this gap and is NOT being removed. Do not
 *   describe this system as "guaranteed real-time delivery" anywhere --
 *   it is "Redis-backed SSE real-time delivery with polling correctness
 *   fallback."
 * - Not a replacement for server/personal-chat-routes.ts's personalChatBus
 *   (that stays in-process, unmodified, out of scope here) or
 *   server/signaling-server.ts (deprecated, explicitly not touched or
 *   extended -- see that file's own header comment).
 *
 * ARCHITECTURE: exactly one Redis subscriber connection per application
 * process (module-singleton, lazily created on first use), subscribed to a
 * single fixed channel. Every canonical-messaging real-time event --
 * regardless of business or conversation -- is published to that one
 * channel with a businessId/customerUserId already embedded in the
 * payload; this process's subscriber re-emits it onto a local, in-process
 * EventEmitter, and THAT is what each authorized SSE connection on THIS
 * instance listens to. This is deliberately NOT one Redis SUBSCRIBE per
 * business/user (that would multiply Redis connections with instance
 * count * business count, not the "one subscriber per process" the P2
 * audit called for) -- local fan-out from a single shared subscription is
 * the whole point.
 */
import type { Redis } from "ioredis";
import { EventEmitter } from "node:events";
import { getRedisClient, getRedisSubscriberClient, isRedisReady } from "../../redis";
import { logger } from "../../observability";

const CHANNEL = "neura:messaging:realtime";

export type MessagingRealtimeEvent =
  | {
      type: "message.created";
      businessId: number;
      conversationId: number; // businessConversations.id
      customerUserId: number | null; // for local consumer-stream routing only -- see routes/controller for what actually gets forwarded to a browser
      message: { id: number; senderParticipantId: number; content: string; createdAt: string };
    }
  | {
      type: "conversation.created";
      businessId: number;
      conversationId: number;
    }
  | {
      type: "assignment.changed";
      businessId: number;
      conversationId: number;
      assignedToUserId: number | null;
      assignedToUsername: string | null;
      operation: "assign" | "reassign" | "unassign" | "claim" | "release";
    };

const localBus = new EventEmitter();
// Fan-out target is "every open SSE connection on this instance for every
// business/conversation this instance happens to be serving" -- not a
// per-user cap the way personalChatBus's 512 was sized for 1:1 chat. No
// hard ceiling enforced here beyond Node's own default warning threshold;
// revisit if a single instance ever needs to hold an unusually large
// number of concurrent Business Inbox/consumer connections.
localBus.setMaxListeners(0);

function businessKey(businessId: number): string {
  return `business:${businessId}`;
}

function consumerKey(userId: number, businessId: number): string {
  return `consumer:${userId}:${businessId}`;
}

let subscriberClient: Redis | null = null;
let subscriberStarting = false;

/**
 * Lazily starts this process's single Redis subscriber. Safe to call many
 * times (idempotent) -- publish()/subscribe() below both call this, and
 * only the first call does anything. Never throws: a Redis outage at
 * startup degrades to "no real-time push from this instance" rather than
 * crashing the app, since the 8s poll remains fully functional either way.
 */
function ensureSubscriber(): void {
  if (subscriberClient || subscriberStarting) return;
  subscriberStarting = true;

  try {
    const sub = getRedisSubscriberClient();
    sub.on("message", (channel: string, raw: string) => {
      if (channel !== CHANNEL) return;
      let event: MessagingRealtimeEvent;
      try {
        event = JSON.parse(raw);
      } catch {
        logger.warn("MessagingRealtime", "Dropped malformed real-time event payload");
        return;
      }
      localBus.emit(businessKey(event.businessId), event);
      if (event.type === "message.created" && event.customerUserId != null) {
        localBus.emit(consumerKey(event.customerUserId, event.businessId), event);
      }
    });
    sub.on("error", (error) => {
      logger.error("MessagingRealtime", "Redis subscriber error", error instanceof Error ? error : new Error(String(error)));
    });
    sub.subscribe(CHANNEL).catch((error) => {
      logger.error("MessagingRealtime", "Failed to subscribe to real-time channel", error instanceof Error ? error : new Error(String(error)));
    });
    subscriberClient = sub;
  } catch (error) {
    // getRedisClient()/getRedisSubscriberClient() throw if Redis hasn't
    // finished its own startup readiness check yet, or if Redis is simply
    // unavailable. Either way: log and continue running poll-only for this
    // instance rather than taking the process down.
    logger.error("MessagingRealtime", "Could not start real-time subscriber -- falling back to polling-only for this instance", error instanceof Error ? error : new Error(String(error)));
  } finally {
    subscriberStarting = false;
  }
}

/**
 * Publishes a real-time event. MUST be called only after the database
 * change it describes has already committed (see the doc comments at each
 * call site in service.ts for the exact commit point) -- never from inside
 * a db.transaction(...) closure. Best-effort: publish failures are logged
 * and swallowed, never thrown, so a Redis blip can never turn a successful
 * message send into a 500 for the sender.
 *
 * Deliberately does NOT call ensureSubscriber() -- publishing on the main
 * (already-connected) Redis client requires no local subscriber connection
 * at all. A process that only ever sends messages/changes assignments but
 * never opens an SSE endpoint of its own (e.g. a worker with no inbound
 * HTTP traffic) would otherwise pay for a subscriber connection it never
 * uses. The subscriber is started ONLY by actual local subscription
 * demand -- see subscribeToBusinessEvents/subscribeToConsumerEvents below.
 */
export function publishMessagingEvent(event: MessagingRealtimeEvent): void {
  if (!isRedisReady()) {
    // Consistent with the rest of this module's fail-open posture: no
    // subscriber is listening anyway if Redis isn't ready, so skip the
    // publish call rather than let it queue/throw.
    return;
  }
  try {
    getRedisClient().publish(CHANNEL, JSON.stringify(event));
  } catch (error) {
    logger.error("MessagingRealtime", "Failed to publish real-time event", error instanceof Error ? error : new Error(String(error)));
  }
}

/**
 * Subscribes to every real-time event for one business -- the Business
 * Inbox stream's source. Caller (the SSE route) is solely responsible for
 * having already verified the connecting user is authorized for this
 * businessId (requireCompanyAccess + requirePermission) before calling
 * this. Returns an unsubscribe function; callers MUST call it on
 * connection close to avoid a listener leak (mirrors personalChatBus's
 * existing req.on("close", ...) convention).
 */
export function subscribeToBusinessEvents(businessId: number, listener: (event: MessagingRealtimeEvent) => void): () => void {
  ensureSubscriber();
  const key = businessKey(businessId);
  localBus.on(key, listener);
  return () => localBus.off(key, listener);
}

/**
 * Subscribes to message.created events for one specific (userId, businessId)
 * pair -- the consumer BusinessChatPage stream's source. Caller is solely
 * responsible for having already verified userId === req.user.id (never a
 * client-suppliable value) before calling this.
 */
export function subscribeToConsumerEvents(userId: number, businessId: number, listener: (event: MessagingRealtimeEvent) => void): () => void {
  ensureSubscriber();
  const key = consumerKey(userId, businessId);
  localBus.on(key, listener);
  return () => localBus.off(key, listener);
}
