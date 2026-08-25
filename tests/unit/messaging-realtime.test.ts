import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * P2: unit tests for server/modules/messaging/realtime.ts -- the
 * Redis-backed pub/sub transport underlying Business Messaging real-time
 * delivery. server/redis.ts is mocked with a tiny in-memory broker that
 * mimics real Redis PUBLISH/SUBSCRIBE fan-out (every registered
 * subscriber callback across every simulated "process" receives every
 * published message on the channel) -- this is what makes the
 * multi-instance test below a genuine proof of cross-instance delivery,
 * not just "the same EventEmitter fired twice".
 */

let brokerListeners: Array<(channel: string, msg: string) => void>;

function makeFakeMainClient() {
  return {
    publish: (channel: string, msg: string) => {
      for (const cb of brokerListeners) cb(channel, msg);
      return Promise.resolve(1);
    },
  };
}

function makeFakeSubscriberClient() {
  return {
    on: (event: string, cb: (...args: any[]) => void) => {
      if (event === "message") {
        brokerListeners.push((channel: string, msg: string) => cb(channel, msg));
      }
      // "error" handler etc. -- registered but never invoked in these tests
    },
    subscribe: (_channel: string) => Promise.resolve(),
  };
}

let redisReady = true;
// getRedisSubscriberClient is a spy specifically so tests can assert
// whether/how many times a subscriber connection was actually requested --
// central to proving publish() no longer creates one as a side effect.
const getRedisSubscriberClientSpy = vi.fn(() => makeFakeSubscriberClient());
vi.mock("../../server/redis", () => ({
  getRedisClient: () => makeFakeMainClient(),
  getRedisSubscriberClient: () => getRedisSubscriberClientSpy(),
  isRedisReady: () => redisReady,
}));

vi.mock("../../server/observability", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

beforeEach(() => {
  brokerListeners = [];
  redisReady = true;
  getRedisSubscriberClientSpy.mockClear();
  vi.resetModules();
});

describe("P2: publish/subscribe connection lifecycle -- exactly one subscriber connection per process, never created by publish alone", () => {
  it("publishMessagingEvent alone (no local subscription in this process) never requests a Redis subscriber connection", async () => {
    const { publishMessagingEvent } = await import("../../server/modules/messaging/realtime");

    publishMessagingEvent({ type: "conversation.created", businessId: 1, conversationId: 1 });
    publishMessagingEvent({ type: "conversation.created", businessId: 1, conversationId: 2 });

    expect(getRedisSubscriberClientSpy).not.toHaveBeenCalled();
  });

  it("subscribeToBusinessEvents/subscribeToConsumerEvents create the subscriber connection exactly ONCE per process, no matter how many separate subscriptions are made", async () => {
    const { subscribeToBusinessEvents, subscribeToConsumerEvents } = await import("../../server/modules/messaging/realtime");

    subscribeToBusinessEvents(1, () => {});
    subscribeToBusinessEvents(2, () => {});
    subscribeToConsumerEvents(42, 1, () => {});
    subscribeToConsumerEvents(43, 1, () => {});

    // four independent local subscriptions, but only one underlying Redis
    // subscriber connection for the whole process -- proves this is not
    // "one subscriber per business" or "one subscriber per user".
    expect(getRedisSubscriberClientSpy).toHaveBeenCalledTimes(1);
  });

  it("a subscription made AFTER a publish still only creates one subscriber connection (publish does not pre-create or interfere with lazy subscriber startup)", async () => {
    const { publishMessagingEvent, subscribeToBusinessEvents } = await import("../../server/modules/messaging/realtime");

    publishMessagingEvent({ type: "conversation.created", businessId: 1, conversationId: 1 });
    expect(getRedisSubscriberClientSpy).not.toHaveBeenCalled();

    subscribeToBusinessEvents(1, () => {});
    expect(getRedisSubscriberClientSpy).toHaveBeenCalledTimes(1);

    subscribeToBusinessEvents(2, () => {});
    expect(getRedisSubscriberClientSpy).toHaveBeenCalledTimes(1); // still just one
  });
});

describe("P2: publishMessagingEvent / local subscription routing (single process)", () => {
  it("a business-scoped listener receives an event published for that business", async () => {
    const { publishMessagingEvent, subscribeToBusinessEvents } = await import("../../server/modules/messaging/realtime");

    const received: any[] = [];
    const unsubscribe = subscribeToBusinessEvents(1, (event) => received.push(event));

    publishMessagingEvent({ type: "conversation.created", businessId: 1, conversationId: 10 });

    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({ type: "conversation.created", businessId: 1, conversationId: 10 });
    unsubscribe();
  });

  it("14. a business-scoped listener for a DIFFERENT business receives nothing (wrong business receives nothing)", async () => {
    const { publishMessagingEvent, subscribeToBusinessEvents } = await import("../../server/modules/messaging/realtime");

    const receivedForBusiness2: any[] = [];
    subscribeToBusinessEvents(2, (event) => receivedForBusiness2.push(event));

    publishMessagingEvent({ type: "conversation.created", businessId: 1, conversationId: 10 });

    expect(receivedForBusiness2).toHaveLength(0);
  });

  it("14. a consumer-scoped listener receives only message.created events for its own (userId, businessId) pair", async () => {
    const { publishMessagingEvent, subscribeToConsumerEvents } = await import("../../server/modules/messaging/realtime");

    const received: any[] = [];
    subscribeToConsumerEvents(42, 1, (event) => received.push(event));

    publishMessagingEvent({
      type: "message.created",
      businessId: 1,
      conversationId: 10,
      customerUserId: 42,
      message: { id: 1, senderParticipantId: 5, content: "hi", createdAt: new Date().toISOString() },
    });

    expect(received).toHaveLength(1);
  });

  it("14. an unauthorized/mismatched consumer subscriber (different userId) receives nothing -- proves a spoofed subscription key never overlaps a real customer's events", async () => {
    const { publishMessagingEvent, subscribeToConsumerEvents } = await import("../../server/modules/messaging/realtime");

    const receivedForWrongUser: any[] = [];
    subscribeToConsumerEvents(999, 1, (event) => receivedForWrongUser.push(event));

    publishMessagingEvent({
      type: "message.created",
      businessId: 1,
      conversationId: 10,
      customerUserId: 42, // the REAL customer -- not 999
      message: { id: 1, senderParticipantId: 5, content: "hi", createdAt: new Date().toISOString() },
    });

    expect(receivedForWrongUser).toHaveLength(0);
  });

  it("14. a consumer subscribed to the right userId but the WRONG businessId receives nothing (cross-business event subscription is rejected structurally)", async () => {
    const { publishMessagingEvent, subscribeToConsumerEvents } = await import("../../server/modules/messaging/realtime");

    const receivedForWrongBusiness: any[] = [];
    subscribeToConsumerEvents(42, 2, (event) => receivedForWrongBusiness.push(event)); // same user, different business

    publishMessagingEvent({
      type: "message.created",
      businessId: 1,
      conversationId: 10,
      customerUserId: 42,
      message: { id: 1, senderParticipantId: 5, content: "hi", createdAt: new Date().toISOString() },
    });

    expect(receivedForWrongBusiness).toHaveLength(0);
  });

  it("message.created also reaches the business-scoped (Inbox) listener at the same time as the consumer-scoped one -- one publish, two independent local routes", async () => {
    const { publishMessagingEvent, subscribeToBusinessEvents, subscribeToConsumerEvents } = await import("../../server/modules/messaging/realtime");

    const inboxReceived: any[] = [];
    const consumerReceived: any[] = [];
    subscribeToBusinessEvents(1, (event) => inboxReceived.push(event));
    subscribeToConsumerEvents(42, 1, (event) => consumerReceived.push(event));

    publishMessagingEvent({
      type: "message.created",
      businessId: 1,
      conversationId: 10,
      customerUserId: 42,
      message: { id: 1, senderParticipantId: 5, content: "hi", createdAt: new Date().toISOString() },
    });

    expect(inboxReceived).toHaveLength(1);
    expect(consumerReceived).toHaveLength(1);
  });

  it("assignment.changed and conversation.created reach the business-scoped listener but are never routed to any consumer-scoped listener (no customerUserId on those event types)", async () => {
    const { publishMessagingEvent, subscribeToBusinessEvents, subscribeToConsumerEvents } = await import("../../server/modules/messaging/realtime");

    const inboxReceived: any[] = [];
    const consumerReceived: any[] = [];
    subscribeToBusinessEvents(1, (event) => inboxReceived.push(event));
    subscribeToConsumerEvents(42, 1, (event) => consumerReceived.push(event));

    publishMessagingEvent({ type: "conversation.created", businessId: 1, conversationId: 10 });
    publishMessagingEvent({ type: "assignment.changed", businessId: 1, conversationId: 10, assignedToUserId: 100, assignedToUsername: "agent_a", operation: "claim" });

    expect(inboxReceived).toHaveLength(2);
    expect(consumerReceived).toHaveLength(0);
  });

  it("unsubscribe actually removes the listener -- no further events delivered after calling the returned function", async () => {
    const { publishMessagingEvent, subscribeToBusinessEvents } = await import("../../server/modules/messaging/realtime");

    const received: any[] = [];
    const unsubscribe = subscribeToBusinessEvents(1, (event) => received.push(event));
    publishMessagingEvent({ type: "conversation.created", businessId: 1, conversationId: 1 });
    expect(received).toHaveLength(1);

    unsubscribe();
    publishMessagingEvent({ type: "conversation.created", businessId: 1, conversationId: 2 });
    expect(received).toHaveLength(1); // unchanged -- no leak, no delivery to a torn-down listener
  });

  it("publishMessagingEvent never throws even if the underlying Redis client's publish rejects -- a broker failure never breaks a message send", async () => {
    vi.resetModules();
    vi.doMock("../../server/redis", () => ({
      getRedisClient: () => ({ publish: () => { throw new Error("ECONNRESET"); } }),
      getRedisSubscriberClient: () => makeFakeSubscriberClient(),
      isRedisReady: () => true,
    }));
    const { publishMessagingEvent } = await import("../../server/modules/messaging/realtime");

    expect(() => publishMessagingEvent({ type: "conversation.created", businessId: 1, conversationId: 1 })).not.toThrow();
  });

  it("publishMessagingEvent is a no-op (does not call the Redis client) when Redis is not ready -- degrades silently rather than queuing/throwing", async () => {
    redisReady = false;
    const { publishMessagingEvent } = await import("../../server/modules/messaging/realtime");

    const received: string[] = [];
    brokerListeners.push((channel) => received.push(channel));

    publishMessagingEvent({ type: "conversation.created", businessId: 1, conversationId: 1 });
    expect(received).toHaveLength(0);
  });
});

describe("14. MANDATORY multi-instance test -- an event published from one process reaches a subscriber on a DIFFERENT process via the shared Redis channel", () => {
  it("instance A publish -> instance B's Redis subscriber -> instance B's local SSE-equivalent listener", async () => {
    // Two independent module instances (simulating two separate Node
    // processes/app instances), each with its OWN local EventEmitter --
    // the only thing they share is the mocked Redis broker's listener
    // array (brokerListeners), exactly mirroring how two real app
    // instances only share the actual Redis server, nothing in-process.
    // vi.doMock (not just the file's hoisted vi.mock) re-declared explicitly
    // after each resetModules() -- makes the "fresh module instance" intent
    // explicit rather than relying on hoisted-mock persistence across resets.
    vi.resetModules();
    vi.doMock("../../server/redis", () => ({
      getRedisClient: () => makeFakeMainClient(),
      getRedisSubscriberClient: () => makeFakeSubscriberClient(),
      isRedisReady: () => redisReady,
    }));
    const instanceA = await import("../../server/modules/messaging/realtime");
    vi.resetModules();
    vi.doMock("../../server/redis", () => ({
      getRedisClient: () => makeFakeMainClient(),
      getRedisSubscriberClient: () => makeFakeSubscriberClient(),
      isRedisReady: () => redisReady,
    }));
    const instanceB = await import("../../server/modules/messaging/realtime");

    const receivedOnB: any[] = [];
    instanceB.subscribeToBusinessEvents(1, (event) => receivedOnB.push(event));

    // Also prove wrong-business isolation holds ACROSS instances, not just
    // within one -- a listener on instance B for a different business must
    // still receive nothing from instance A's publish.
    const receivedOnBWrongBusiness: any[] = [];
    instanceB.subscribeToBusinessEvents(2, (event) => receivedOnBWrongBusiness.push(event));

    // instance A never subscribed to anything -- it only publishes, proving
    // this isn't accidentally the SAME EventEmitter under the hood.
    instanceA.publishMessagingEvent({ type: "conversation.created", businessId: 1, conversationId: 42 });

    expect(receivedOnB).toHaveLength(1);
    expect(receivedOnB[0]).toMatchObject({ businessId: 1, conversationId: 42 });
    expect(receivedOnBWrongBusiness).toHaveLength(0);
  });

  it("cross-instance delivery also correctly scopes a consumer-specific event -- instance B's consumer listener only fires for the right (userId, businessId)", async () => {
    vi.resetModules();
    vi.doMock("../../server/redis", () => ({
      getRedisClient: () => makeFakeMainClient(),
      getRedisSubscriberClient: () => makeFakeSubscriberClient(),
      isRedisReady: () => redisReady,
    }));
    const instanceA = await import("../../server/modules/messaging/realtime");
    vi.resetModules();
    vi.doMock("../../server/redis", () => ({
      getRedisClient: () => makeFakeMainClient(),
      getRedisSubscriberClient: () => makeFakeSubscriberClient(),
      isRedisReady: () => redisReady,
    }));
    const instanceB = await import("../../server/modules/messaging/realtime");

    const receivedRightConsumer: any[] = [];
    const receivedWrongConsumer: any[] = [];
    instanceB.subscribeToConsumerEvents(42, 1, (event) => receivedRightConsumer.push(event));
    instanceB.subscribeToConsumerEvents(999, 1, (event) => receivedWrongConsumer.push(event));

    instanceA.publishMessagingEvent({
      type: "message.created",
      businessId: 1,
      conversationId: 10,
      customerUserId: 42,
      message: { id: 1, senderParticipantId: 5, content: "cross-instance hello", createdAt: new Date().toISOString() },
    });

    expect(receivedRightConsumer).toHaveLength(1);
    expect(receivedWrongConsumer).toHaveLength(0);
  });
});
