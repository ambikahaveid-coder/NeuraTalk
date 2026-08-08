import { describe, it, expect, vi, beforeEach } from "vitest";
import RedisMock from "ioredis-mock";

/**
 * Verifies the real ACD queue engine in server/modules/calls/queue-service.ts
 * — specifically that enqueue ordering (FIFO position), maxQueueSize
 * enforcement, and wait-time estimation actually work, using a real
 * Redis-compatible sorted-set implementation (ioredis-mock) so the
 * ZADD/ZCOUNT logic is genuinely exercised, not hand-faked.
 */

const redisInstance = new RedisMock();
vi.mock("../../server/redis", () => ({ getRedisClient: () => redisInstance }));

let mockQueueRow: any = { id: 1, isActive: true, maxQueueSize: 20, maxWaitSeconds: 300, afterQueueAction: "hangup" };
const insertedQueuedCalls: any[] = [];

vi.mock("../../server/db", () => ({
  db: {
    select: () => ({
      from: (table: any) => ({
        where: () => Promise.resolve(
          // callQueues has an isActive field named "isActive" in our mock row;
          // queuedCalls lookups (by callId) aren't exercised directly in
          // these tests, so a single shared shape is sufficient here.
          [mockQueueRow],
        ),
      }),
    }),
    insert: () => ({
      values: (row: any) => ({
        returning: () => {
          insertedQueuedCalls.push(row);
          return Promise.resolve([{ id: insertedQueuedCalls.length, ...row }]);
        },
      }),
    }),
    update: () => ({
      set: () => ({
        where: () => Promise.resolve([]),
      }),
    }),
  },
}));

vi.mock("../../server/observability", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

describe("ACD queue engine", () => {
  beforeEach(async () => {
    await redisInstance.flushall();
    insertedQueuedCalls.length = 0;
    mockQueueRow = { id: 1, isActive: true, maxQueueSize: 20, maxWaitSeconds: 300, afterQueueAction: "hangup" };
  });

  it("assigns position 1 to the first call enqueued", async () => {
    const { enqueueCall } = await import("../../server/modules/calls/queue-service");
    const result = await enqueueCall({
      queueId: 1,
      callId: "call_a",
      organizationId: 1,
      requiredSkills: [],
    });
    expect(result.queued).toBe(true);
    if (result.queued) {
      expect(result.position).toBe(1);
    }
  });

  it("assigns increasing positions to calls enqueued in order (FIFO)", async () => {
    const { enqueueCall } = await import("../../server/modules/calls/queue-service");

    const first = await enqueueCall({ queueId: 1, callId: "call_1", organizationId: 1, requiredSkills: [] });
    // Force a distinct enqueue timestamp so ordering is deterministic even
    // if the test runs faster than 1ms resolution allows.
    await new Promise((r) => setTimeout(r, 2));
    const second = await enqueueCall({ queueId: 1, callId: "call_2", organizationId: 1, requiredSkills: [] });
    await new Promise((r) => setTimeout(r, 2));
    const third = await enqueueCall({ queueId: 1, callId: "call_3", organizationId: 1, requiredSkills: [] });

    expect(first.queued && first.position).toBe(1);
    expect(second.queued && second.position).toBe(2);
    expect(third.queued && third.position).toBe(3);
  });

  it("computes estimated wait time proportional to queue position", async () => {
    const { enqueueCall } = await import("../../server/modules/calls/queue-service");
    const result = await enqueueCall({ queueId: 1, callId: "call_x", organizationId: 1, requiredSkills: [] });
    expect(result.queued).toBe(true);
    if (result.queued) {
      expect(result.estimatedWaitSeconds).toBeGreaterThan(0);
      expect(result.estimatedWaitSeconds).toBe(result.position * 180); // documented ASSUMED_AVG_HANDLE_TIME_SECONDS
    }
  });

  it("rejects enqueue once maxQueueSize is reached", async () => {
    mockQueueRow.maxQueueSize = 2;
    const { enqueueCall } = await import("../../server/modules/calls/queue-service");

    const r1 = await enqueueCall({ queueId: 1, callId: "call_full_1", organizationId: 1, requiredSkills: [] });
    const r2 = await enqueueCall({ queueId: 1, callId: "call_full_2", organizationId: 1, requiredSkills: [] });
    const r3 = await enqueueCall({ queueId: 1, callId: "call_full_3", organizationId: 1, requiredSkills: [] });

    expect(r1.queued).toBe(true);
    expect(r2.queued).toBe(true);
    expect(r3.queued).toBe(false);
    if (!r3.queued) expect(r3.reason).toBe("QUEUE_FULL");
  });

  it("rejects enqueue into an inactive queue", async () => {
    mockQueueRow.isActive = false;
    const { enqueueCall } = await import("../../server/modules/calls/queue-service");
    const result = await enqueueCall({ queueId: 1, callId: "call_inactive", organizationId: 1, requiredSkills: [] });
    expect(result.queued).toBe(false);
    if (!result.queued) expect(result.reason).toBe("QUEUE_NOT_FOUND_OR_INACTIVE");
  });
});
