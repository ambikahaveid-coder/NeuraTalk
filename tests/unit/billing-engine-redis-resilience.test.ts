import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Regression test for a real production incident: a transient Redis
 * disconnect (ECONNRESET / "Stream isn't writeable" while enableOfflineQueue
 * is false) made listActiveRuntimeSessionIds() reject. That rejection was
 * unguarded, became an unhandled promise rejection, and server/index.ts's
 * global handler treats any unhandled rejection as fatal — crashing the
 * entire process on every Redis blip. This test proves the runtime
 * supervisor's per-tick sweep survives a rejecting Redis client instead of
 * throwing out of processActiveRuntimeSessions.
 */

const smembersMock = vi.fn();

vi.mock("../../server/redis", () => ({
  getRedisClient: () => ({ smembers: smembersMock }),
  isRedisDegraded: () => false,
  withRedisLock: async (_key: string, fn: () => Promise<unknown>) => fn(),
}));

vi.mock("../../server/db", () => ({ db: {} }));

vi.mock("../../server/observability", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../../server/audit-logging", () => ({
  logAuditEvent: vi.fn(async () => undefined),
}));

describe("BillingEngine runtime supervisor — Redis resilience", () => {
  beforeEach(() => {
    smembersMock.mockReset();
    vi.resetModules();
  });

  it("does not throw or reject when Redis rejects the active-session lookup", async () => {
    smembersMock.mockRejectedValue(
      new Error("Stream isn't writeable and enableOfflineQueue options is false"),
    );

    const { BillingEngine } = await import("../../server/billing-engine");

    // processActiveRuntimeSessions is `private static` at compile time only;
    // it's a plain method at runtime, so this reaches the exact code path
    // the 1-second setInterval tick invokes in production.
    await expect(
      (BillingEngine as unknown as { processActiveRuntimeSessions: () => Promise<void> })
        .processActiveRuntimeSessions(),
    ).resolves.toBeUndefined();
  });

  it("recovers and processes sessions normally once Redis becomes available again", async () => {
    smembersMock
      .mockRejectedValueOnce(new Error("Stream isn't writeable and enableOfflineQueue options is false"))
      .mockResolvedValueOnce([]);

    const { BillingEngine } = await import("../../server/billing-engine");
    const engine = BillingEngine as unknown as { processActiveRuntimeSessions: () => Promise<void> };

    await expect(engine.processActiveRuntimeSessions()).resolves.toBeUndefined();
    await expect(engine.processActiveRuntimeSessions()).resolves.toBeUndefined();
    expect(smembersMock).toHaveBeenCalledTimes(2);
  });
});
