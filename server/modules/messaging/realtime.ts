/**
 * Redis-backed real-time transport for business and consumer messaging.
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
 *   responsible for authorizing a subscriber before ever calling a subscribe
 *   function; this module trusts whatever businessId/userId it's given.
 * - Not a durable delivery guarantee. Redis PUBLISH is fire-and-forget: a
 *   process crash between a successful Postgres COMMIT and the PUBLISH
 *   call below permanently loses that one real-time notification (the
 *   underlying message/assignment change is still safe in Postgres --
 *   only the PUSH of it is lost). The existing 8-second polling in
 *   client polling/reconnect paths remain the correctness backstop and are
 *   NOT being removed. Do not describe this system as "guaranteed real-time
 *   delivery" -- it is "Redis-backed SSE real-time delivery with polling
 *   correctness fallback."
 * - This does not replace server/signaling-server.ts (deprecated; see that
 *   file's own header comment).
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
import { randomUUID } from "node:crypto";
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
    }
  | {
      // Delivery ticks moved (see delivery.ts) -- clients refetch the thread.
      type: "delivery.updated";
      businessId: number;
      conversationId: number;
      customerUserId: number | null;
      status: "delivered" | "read";
    };

type PersonalChatRealtimeEnvelope = {
  type: "personal-chat.event";
  originInstanceId: string;
  userId: number;
  payload: Record<string, unknown>;
};

type RedisRealtimeMessage = MessagingRealtimeEvent | PersonalChatRealtimeEnvelope;

const localBus = new EventEmitter();
localBus.setMaxListeners(512);
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

function personalChatKey(userId: number): string {
  return `personal-chat:${userId}`;
}

function emitLocally(event: MessagingRealtimeEvent): void {
  localBus.emit(businessKey(event.businessId), event);
  if ((event.type === "message.created" || event.type === "delivery.updated") && event.customerUserId != null) {
    localBus.emit(consumerKey(event.customerUserId, event.businessId), event);
  }
}

const instanceId = randomUUID();
let subscriberClient: Redis | null = null;
let subscriberStarting = false;

function isRedisRealtimeMessage(value: unknown): value is RedisRealtimeMessage {
  if (!value || typeof value !== "object") return false;
  const message = value as Record<string, unknown>;

  if (message.type === "personal-chat.event") {
    return Number.isSafeInteger(message.userId)
      && typeof message.originInstanceId === "string"
      && Boolean(message.payload)
      && typeof message.payload === "object"
      && !Array.isArray(message.payload);
  }

  return (
    (message.type === "message.created"
      || message.type === "conversation.created"
      || message.type === "assignment.changed"
      || message.type === "delivery.updated")
    && Number.isSafeInteger(message.businessId)
  );
}

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
      let event: unknown;
      try {
        event = JSON.parse(raw);
      } catch {
        logger.warn("MessagingRealtime", "Dropped malformed real-time event payload");
        return;
      }

      if (!isRedisRealtimeMessage(event)) {
        logger.warn("MessagingRealtime", "Dropped invalid real-time event payload");
        return;
      }
      if (event.type === "personal-chat.event") {
        if (event.originInstanceId !== instanceId) {
          localBus.emit(personalChatKey(event.userId), event.payload);
        }
        return;
      }

      emitLocally(event);
    });
    sub.on("error", (error) => {
      logger.error("MessagingRealtime", "Redis subscriber error", error instanceof Error ? error : new Error(String(error)));
    });
    // The duplicated subscriber connection has no offline queue, so a
    // SUBSCRIBE sent before it is connected fails outright (and was never
    // retried -- live updates silently never worked). Subscribe once it is
    // ready; ioredis re-subscribes by itself after any later reconnect.
    const subscribe = () => {
      sub.subscribe(CHANNEL).catch((error) => {
        logger.error("MessagingRealtime", "Failed to subscribe to real-time channel", error instanceof Error ? error : new Error(String(error)));
      });
    };
    if (sub.status === "ready") subscribe();
    else sub.once("ready", subscribe);
    // Created with lazyConnect (inherited from the main client): it would
    // otherwise wait for a first command that can never be queued.
    if (sub.status === "wait") {
      sub.connect().catch((error) => {
        logger.error("MessagingRealtime", "Real-time subscriber could not connect", error instanceof Error ? error : new Error(String(error)));
      });
    }
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
    // No Redis: this instance's own SSE connections still get the event
    // (the same local fan-out the Redis subscriber would have done).
    emitLocally(event);
    return;
  }
  try {
    void getRedisClient().publish(CHANNEL, JSON.stringify(event)).catch((error) => {
      logger.error("MessagingRealtime", "Failed to publish real-time event", error instanceof Error ? error : new Error(String(error)));
      emitLocally(event);
    });
  } catch (error) {
    logger.error("MessagingRealtime", "Failed to publish real-time event", error instanceof Error ? error : new Error(String(error)));
    emitLocally(event);
  }
}

/**
 * Delivers a personal-chat event locally and, when Redis is available, to
 * other server instances. The origin marker prevents a Redis echo from
 * delivering the same event twice to this process's local SSE connections.
 */
export function publishPersonalChatEvent(userIds: number[], event: Record<string, unknown>): void {
  const emittedAt = new Date().toISOString();

  for (const userId of Array.from(new Set(userIds))) {
    if (!Number.isSafeInteger(userId) || userId <= 0) continue;

    const payload = { ...event, userId, emittedAt };
    localBus.emit(personalChatKey(userId), payload);
    if (!isRedisReady()) continue;

    const envelope: PersonalChatRealtimeEnvelope = {
      type: "personal-chat.event",
      originInstanceId: instanceId,
      userId,
      payload,
    };
    try {
      void getRedisClient().publish(CHANNEL, JSON.stringify(envelope)).catch((error) => {
        logger.error(
          "MessagingRealtime",
          "Failed to publish personal-chat event",
          error instanceof Error ? error : new Error(String(error)),
        );
      });
    } catch (error) {
      logger.error(
        "MessagingRealtime",
        "Failed to publish personal-chat event",
        error instanceof Error ? error : new Error(String(error)),
      );
    }
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

/**
 * Subscribes to personal-chat events for one authenticated user. The caller
 * must derive userId from the validated session, never from client input.
 */
export function subscribeToPersonalChatEvents(
  userId: number,
  listener: (event: Record<string, unknown>) => void,
): () => void {
  ensureSubscriber();
  const key = personalChatKey(userId);
  localBus.on(key, listener);
  return () => localBus.off(key, listener);
}
