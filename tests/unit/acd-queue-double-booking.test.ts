import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Verifies the double-booking fix in tryAssignQueuedCallToAgent: an agent
 * must be atomically claimed (available -> busy, conditional on their
 * current status) BEFORE any queue is searched, so two near-simultaneous
 * triggers for the same agent can't both proceed to assign a call.
 *
 * This is a regression test for a real bug this audit caught: the original
 * version never touched agentPresence at all, so an agent stayed
 * "available" in the DB even after being handed a call.
 */

let presenceUpdateCallCount = 0;
let claimShouldSucceed = true;

vi.mock("../../server/db", () => ({
  db: {
    // Both the claim (which calls .returning()) and the release-if-nothing-
    // found path (which doesn't need the row back, so it doesn't call
    // .returning()) go through .where() — count there so both are captured
    // regardless of which one chains .returning() afterward.
    update: (_table: any) => ({
      set: (_row: any) => ({
        where: (_cond: any) => {
          presenceUpdateCallCount++;
          const result = Promise.resolve(claimShouldSucceed ? [{ userId: 42 }] : []);
          return Object.assign(result, { returning: () => result });
        },
      }),
    }),
    select: () => ({
      from: () => ({
        where: () => Promise.resolve([]), // no agentSkills row, no queues — irrelevant to this test
      }),
    }),
  },
}));

vi.mock("../../server/redis", () => ({ getRedisClient: () => ({}) }));
vi.mock("../../server/observability", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("../../server/livekit-service", () => ({ issueAccessToken: vi.fn() }));
vi.mock("../../server/storage", () => ({ storage: { getUser: vi.fn() } }));
vi.mock("../../server/modules/calls/smart-router", () => ({ getSmartCall: vi.fn() }));
vi.mock("../../server/modules/calls/service", () => ({
  queueIncomingCall: vi.fn(),
  initiateCall: vi.fn(),
  resolveCalleeForTransfer: vi.fn(),
  endCallById: vi.fn(),
}));

describe("ACD queue — double-booking prevention", () => {
  beforeEach(() => {
    presenceUpdateCallCount = 0;
    claimShouldSucceed = true;
  });

  it("returns false immediately, without searching any queue, when the agent could not be claimed (already busy or not actually available)", async () => {
    claimShouldSucceed = false; // simulates: presence row's status wasn't "available" when the conditional UPDATE ran
    const { tryAssignQueuedCallToAgent } = await import("../../server/modules/calls/queue-service");
    const result = await tryAssignQueuedCallToAgent(1, 42);
    expect(result).toBe(false);
    expect(presenceUpdateCallCount).toBe(1); // only the claim attempt itself, no release needed
  });

  it("proceeds to search queues once the agent is successfully claimed", async () => {
    claimShouldSucceed = true;
    const { tryAssignQueuedCallToAgent } = await import("../../server/modules/calls/queue-service");
    const result = await tryAssignQueuedCallToAgent(1, 42);
    // No queues/skills configured in this mock, so nothing gets assigned —
    // but the important assertion is that the claim succeeded (didn't
    // short-circuit) and the agent was released back to "available"
    // afterward since nothing was found (claim + release = 2 update calls).
    expect(result).toBe(false);
    expect(presenceUpdateCallCount).toBe(2);
  });
});
