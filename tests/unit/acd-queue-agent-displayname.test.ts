import { describe, it, expect, vi, beforeEach } from "vitest";
import RedisMock from "ioredis-mock";

/**
 * Regression test for a real bug: assignCallToAgent (inside
 * tryAssignQueuedCallToAgent's flow, server/modules/calls/queue-service.ts)
 * previously issued the agent's LiveKit token with an `as any` cast that
 * silenced a TypeScript error caused by omitting the REQUIRED `displayName`
 * field on CallParticipant — meaning the agent's own client would have
 * shown an undefined participant name. The fix looks up the agent's real
 * username via storage.getUser() and passes it through. This test drives
 * the real, full tryAssignQueuedCallToAgent -> assignCallToAgent path (not
 * a mock of assignCallToAgent itself, which isn't exported) and asserts on
 * the actual displayName value issueAccessToken was called with.
 */

const redisInstance = new RedisMock();
vi.mock("../../server/redis", () => ({ getRedisClient: () => redisInstance }));

const issueAccessTokenMock = vi.fn(async () => "fake-agent-token");
vi.mock("../../server/livekit-service", () => ({ issueAccessToken: issueAccessTokenMock }));

const getUserMock = vi.fn(async (id: number) => ({ id, username: "agent_jane_doe" }));
vi.mock("../../server/storage", () => ({ storage: { getUser: (...args: any[]) => getUserMock(...args) } }));

const getSmartCallMock = vi.fn(async (callId: string) => ({
  callId,
  livekitUrl: "wss://example.livekit.cloud",
  callerId: "1001",
  callType: "voice",
}));
vi.mock("../../server/modules/calls/smart-router", () => ({ getSmartCall: (...args: any[]) => getSmartCallMock(...args) }));

const queueIncomingCallMock = vi.fn(async () => {});
vi.mock("../../server/modules/calls/service", () => ({
  queueIncomingCall: (...args: any[]) => queueIncomingCallMock(...args),
  initiateCall: vi.fn(),
  resolveCalleeForTransfer: vi.fn(),
  endCallById: vi.fn(),
}));

vi.mock("../../server/observability", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// Table-aware DB mock: agentPresence claim (update), agentSkills (select),
// callQueues (select), queuedCalls (select + update).
const AGENT_ID = 42;
const ORG_ID = 7;
const QUEUE_ID = 5;

vi.mock("../../server/db", () => ({
  db: {
    update: (table: any) => ({
      set: (_row: any) => ({
        where: () => ({
          returning: () => {
            // Only the agentPresence claim update calls .returning() in this
            // flow (the queuedCalls status update further down does not).
            return Promise.resolve([{ userId: AGENT_ID }]);
          },
        }),
      }),
    }),
    select: () => ({
      from: (table: any) => ({
        where: () => {
          const name = table?.__name ?? table;
          if (name === "agentSkills") return Promise.resolve([{ userId: AGENT_ID, organizationId: ORG_ID, skills: [], isAvailable: true }]);
          if (name === "callQueues") return Promise.resolve([{ id: QUEUE_ID, organizationId: ORG_ID, isActive: true }]);
          if (name === "queuedCalls") return Promise.resolve([{ id: 1, callId: "call_target", status: "waiting", enqueuedAt: new Date() }]);
          return Promise.resolve([]);
        },
      }),
    }),
  },
}));

vi.mock("@shared/schema", () => ({
  agentSkills: "agentSkills",
  agentPresence: "agentPresence",
  callQueues: "callQueues",
  queuedCalls: "queuedCalls",
  QUEUED_CALL_STATUS: { WAITING: "waiting", ASSIGNED: "assigned", ABANDONED: "abandoned", TIMED_OUT: "timed_out" },
}));

vi.mock("drizzle-orm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("drizzle-orm")>();
  return { ...actual, eq: (a: any, b: any) => ({ a, b }), and: (...c: any[]) => c, lte: (a: any, b: any) => ({ a, b }) };
});

describe("ACD queue agent assignment — real displayName (regression for the as-any-masked bug)", () => {
  beforeEach(async () => {
    await redisInstance.flushall();
    issueAccessTokenMock.mockClear();
    getUserMock.mockClear();
    // Pre-populate the queue's Redis sorted set with one waiting call, matching
    // the real queueRedisKey/member format used by queue-service.ts.
    await redisInstance.zadd(`acd_queue:${QUEUE_ID}`, Date.now(), JSON.stringify({ callId: "call_target", requiredSkills: [] }));
  });

  it("issues the agent's LiveKit token with a real, non-undefined displayName looked up from storage.getUser()", async () => {
    const { tryAssignQueuedCallToAgent } = await import("../../server/modules/calls/queue-service");
    const assigned = await tryAssignQueuedCallToAgent(ORG_ID, AGENT_ID);

    expect(assigned).toBe(true);
    expect(getUserMock).toHaveBeenCalledWith(AGENT_ID);
    expect(issueAccessTokenMock).toHaveBeenCalledTimes(1);

    const [, participant] = issueAccessTokenMock.mock.calls[0];
    expect(participant.displayName).toBe("agent_jane_doe");
    expect(participant.displayName).not.toBeUndefined();
    expect(participant.userId).toBe(String(AGENT_ID));
  });

  it("falls back to the agent's userId as displayName if storage.getUser() can't find them, but never leaves it undefined", async () => {
    getUserMock.mockImplementationOnce(async () => undefined as any);
    const { tryAssignQueuedCallToAgent } = await import("../../server/modules/calls/queue-service");
    await tryAssignQueuedCallToAgent(ORG_ID, AGENT_ID);

    const [, participant] = issueAccessTokenMock.mock.calls[0];
    expect(participant.displayName).toBe(String(AGENT_ID));
    expect(participant.displayName).not.toBeUndefined();
  });
});
