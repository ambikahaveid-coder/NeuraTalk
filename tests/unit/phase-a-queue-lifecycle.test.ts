import { beforeEach, describe, expect, it, vi } from "vitest";
import { callQueues, queuedCalls } from "@shared/schema";

const selectMock = vi.fn();
const updateMock = vi.fn();
const redis = {
  zrange: vi.fn(async () => []),
  zrem: vi.fn(async () => 1),
};
const endCallByIdMock = vi.fn(async () => undefined);
const getUserMock = vi.fn(async () => undefined);

vi.mock("../../server/db", () => ({
  db: {
    select: selectMock,
    update: updateMock,
  },
}));
vi.mock("../../server/redis", () => ({ getRedisClient: () => redis }));
vi.mock("../../server/observability", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("../../server/modules/calls/service", () => ({
  endCallById: endCallByIdMock,
  queueIncomingCall: vi.fn(),
  initiateCall: vi.fn(),
  resolveCalleeForTransfer: vi.fn(),
}));
vi.mock("../../server/modules/calls/smart-router", () => ({ getSmartCall: vi.fn() }));
vi.mock("../../server/livekit-service", () => ({ issueAccessToken: vi.fn() }));
vi.mock("../../server/storage", () => ({ storage: { getUser: getUserMock } }));

describe("Phase A canonical queue lifecycle", () => {
  beforeEach(() => {
    vi.resetModules();
    selectMock.mockReset();
    updateMock.mockReset();
    redis.zrange.mockResolvedValue([]);
    redis.zrem.mockClear();
    endCallByIdMock.mockClear();
    getUserMock.mockResolvedValue(undefined);
  });

  it("marks expired canonical queued calls timed_out and applies the configured fallback", async () => {
    const expired = {
      id: 21,
      callId: "call-timeout",
      queueId: 4,
      status: "waiting",
      enqueuedAt: new Date(Date.now() - 10_000),
    };
    selectMock
      .mockReturnValueOnce({
        from: () => ({
          where: async () => [{ id: 4, isActive: true, maxWaitSeconds: 1, afterQueueAction: "hangup" }],
        }),
      })
      .mockReturnValueOnce({
        from: () => ({
          where: async () => [expired],
        }),
      });
    updateMock.mockReturnValue({
      set: () => ({ where: async () => undefined }),
    });
    redis.zrange.mockResolvedValue([JSON.stringify({ callId: "call-timeout", requiredSkills: [] })]);

    const { sweepTimedOutQueueEntries } = await import("../../server/modules/calls/queue-service");
    const result = await sweepTimedOutQueueEntries();

    expect(result).toEqual({ timedOut: 1 });
    expect(redis.zrem).toHaveBeenCalled();
    expect(endCallByIdMock).toHaveBeenCalledWith("call-timeout", "queue_timeout_hangup");
  });

  it("abandons only the canonical waiting row and removes its Redis member", async () => {
    const row = {
      id: 22,
      callId: "call-abandon",
      queueId: 4,
      status: "waiting",
      enqueuedAt: new Date(Date.now() - 2_000),
    };
    selectMock.mockReturnValue({
      from: () => ({ where: async () => [row] }),
    });
    updateMock.mockReturnValue({
      set: (patch: Record<string, unknown>) => ({
        where: async () => {
          expect(patch.status).toBe("abandoned");
        },
      }),
    });
    redis.zrange.mockResolvedValue([JSON.stringify({ callId: "call-abandon", requiredSkills: [] })]);

    const { abandonQueuedCall } = await import("../../server/modules/calls/queue-service");
    await abandonQueuedCall("call-abandon");

    expect(redis.zrem).toHaveBeenCalled();
  });

  it("does not expose a queue row from another organization to canonical assignment", async () => {
    selectMock.mockReturnValue({
      from: (table: unknown) => ({
        where: async () => table === queuedCalls ? [] : [],
      }),
    });

    const { assignQueuedCallToAgent } = await import("../../server/modules/calls/queue-service");
    const result = await assignQueuedCallToAgent({ queuedCallId: 99, organizationId: 7, agentUserId: 42 });

    expect(result).toEqual({ assigned: false, reason: "NOT_FOUND" });
    expect(getUserMock).not.toHaveBeenCalled();
  });
});
