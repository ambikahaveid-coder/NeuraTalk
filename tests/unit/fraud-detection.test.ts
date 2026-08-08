import { describe, it, expect, vi, beforeEach } from "vitest";
import RedisMock from "ioredis-mock";

/**
 * Verifies the toll-fraud velocity/premium-destination checks in
 * server/fraud-detection-service.ts using a real (in-memory) Redis-
 * compatible client (ioredis-mock) so the actual INCR/EXPIRE/SADD
 * semantics are exercised, not hand-faked return values.
 */

const redisInstance = new RedisMock();

vi.mock("../../server/redis", () => ({
  getRedisClient: () => redisInstance,
}));

const dbInsertMock = vi.fn(async () => [{}]);
vi.mock("../../server/db", () => ({
  db: {
    insert: () => ({
      values: (...args: any[]) => dbInsertMock(...args),
    }),
  },
}));

vi.mock("../../server/observability", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

describe("toll-fraud detection", () => {
  beforeEach(async () => {
    await redisInstance.flushall();
    dbInsertMock.mockClear();
  });

  it("allows calls under the velocity threshold", async () => {
    const { checkOutboundCallFraud } = await import("../../server/fraud-detection-service");
    const result = await checkOutboundCallFraud({
      organizationId: 1,
      userId: 1,
      callerIdentity: "user_1",
      calleeNumber: "+919876543210",
    });
    expect(result.blocked).toBe(false);
    expect(dbInsertMock).not.toHaveBeenCalled();
  });

  it("blocks calls once the velocity threshold is exceeded", async () => {
    // The module reads FRAUD_VELOCITY_MAX_CALLS into a constant once at
    // import time, and a prior test in this file already imported it with
    // the default threshold — resetModules() forces a fresh evaluation so
    // this override actually takes effect.
    process.env.FRAUD_VELOCITY_MAX_CALLS = "3";
    vi.resetModules();
    const { checkOutboundCallFraud } = await import("../../server/fraud-detection-service");

    for (let i = 0; i < 3; i++) {
      const r = await checkOutboundCallFraud({
        organizationId: 1,
        userId: 1,
        callerIdentity: "velocity_user",
        calleeNumber: "+919876543210",
      });
      expect(r.blocked).toBe(false);
    }

    const blocked = await checkOutboundCallFraud({
      organizationId: 1,
      userId: 1,
      callerIdentity: "velocity_user",
      calleeNumber: "+919876543210",
    });
    expect(blocked.blocked).toBe(true);
    expect(blocked.reason).toBe("TOO_MANY_CALLS_TOO_FAST");
    expect(dbInsertMock).toHaveBeenCalled();
    delete process.env.FRAUD_VELOCITY_MAX_CALLS;
    vi.resetModules();
  });

  it("blocks calls to known premium-rate prefixes", async () => {
    const { checkOutboundCallFraud } = await import("../../server/fraud-detection-service");
    const result = await checkOutboundCallFraud({
      organizationId: 1,
      userId: 1,
      callerIdentity: "premium_test_user",
      calleeNumber: "+881612345678", // Iridium satellite prefix
    });
    expect(result.blocked).toBe(true);
    expect(result.reason).toBe("PREMIUM_DESTINATION_BLOCKED");
  });

  it("still blocks a premium-rate prefix even without a leading '+' (regression test for a real bypass: smart-router.ts's resolveCallee() treats '+' as optional when parsing a dialed number with no matching app user, so an unnormalized premium number could otherwise slip through)", async () => {
    const { checkOutboundCallFraud } = await import("../../server/fraud-detection-service");
    const result = await checkOutboundCallFraud({
      organizationId: 1,
      userId: 1,
      callerIdentity: "premium_no_plus_user",
      calleeNumber: "881612345678", // same Iridium prefix, no "+"
    });
    expect(result.blocked).toBe(true);
    expect(result.reason).toBe("PREMIUM_DESTINATION_BLOCKED");
  });

  it("does not block a normal-looking Indian mobile number", async () => {
    const { checkOutboundCallFraud } = await import("../../server/fraud-detection-service");
    const result = await checkOutboundCallFraud({
      organizationId: 1,
      userId: 1,
      callerIdentity: "normal_user",
      calleeNumber: "+919123456789",
    });
    expect(result.blocked).toBe(false);
  });

  it("fails open (allows the call) if Redis throws", async () => {
    const { checkOutboundCallFraud } = await import("../../server/fraud-detection-service");
    const brokenClient = { incr: () => { throw new Error("redis down"); } };
    vi.doMock("../../server/redis", () => ({ getRedisClient: () => brokenClient }));
    // Re-import with the broken mock active for this one call path is
    // awkward with static imports already cached; instead assert the
    // documented fail-open contract directly against the module's own
    // try/catch by simulating a throwing incr through the shared instance.
    const originalIncr = redisInstance.incr.bind(redisInstance);
    (redisInstance as any).incr = () => { throw new Error("simulated redis outage"); };
    const result = await checkOutboundCallFraud({
      organizationId: 1,
      userId: 1,
      callerIdentity: "outage_user",
      calleeNumber: "+919123456789",
    });
    expect(result.blocked).toBe(false);
    (redisInstance as any).incr = originalIncr;
  });
});
