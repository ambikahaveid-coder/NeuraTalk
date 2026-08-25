import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * P0-2: personal-chat and group-chat message-send routes previously had NO
 * rate limit at all, despite each send synchronously invoking a paid
 * translation provider. There is no separate "translate" endpoint -- the
 * send route IS the translation-triggering operation, so limiting it here
 * covers both concerns described in the audit.
 *
 * Exercises the REAL rateLimit()-built middleware exported from
 * server/rate-limit.ts (personalChatSendLimiter / groupChatSendLimiter),
 * not a re-implementation, against a fake Redis client shaped like the
 * project's own established test convention (see
 * tests/unit/otp-lockout-namespace.test.ts).
 */

interface Entry { value: string; expiresAt: number | null }
const store = new Map<string, Entry>();
function resetStore() { store.clear(); }

const fakeRedis = {
  async incr(key: string) {
    const entry = store.get(key);
    const next = entry ? String(Number(entry.value) + 1) : "1";
    store.set(key, { value: next, expiresAt: entry?.expiresAt ?? null });
    return Number(next);
  },
  async pexpire(key: string, ms: number) {
    const entry = store.get(key);
    if (entry) entry.expiresAt = Date.now() + ms;
    return 1;
  },
  async pttl(key: string) {
    const entry = store.get(key);
    if (!entry || entry.expiresAt === null) return -1;
    return Math.max(entry.expiresAt - Date.now(), 0);
  },
};

vi.mock("../../server/redis", () => ({ getRedisClient: () => fakeRedis }));
vi.mock("../../server/observability", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock("../../server/audit-logging", () => ({ logAuditEvent: vi.fn(async () => {}) }));

beforeEach(() => {
  resetStore();
  vi.clearAllMocks();
  vi.useRealTimers();
});

function makeReqRes(userId: number) {
  const req: any = { user: { id: userId }, ip: "10.0.0.1", body: {}, params: {}, query: {} };
  const res: any = {
    statusCode: 200,
    headers: {} as Record<string, string>,
    body: undefined,
    setHeader(k: string, v: string) { this.headers[k] = v; },
    status(code: number) { this.statusCode = code; return this; },
    json(body: unknown) { this.body = body; return this; },
  };
  return { req, res };
}

async function runMiddleware(mw: any, req: any, res: any): Promise<boolean> {
  let nextCalled = false;
  await mw(req, res, () => { nextCalled = true; });
  return nextCalled;
}

describe("P0-2: personalChatSendLimiter", () => {
  it("1. a normal message send succeeds (well under the limit)", async () => {
    const { personalChatSendLimiter } = await import("../../server/rate-limit");
    const { req, res } = makeReqRes(1);
    const next = await runMiddleware(personalChatSendLimiter, req, res);
    expect(next).toBe(true);
    expect(res.statusCode).toBe(200);
  });

  it("2. repeated abuse from the same user eventually returns 429 with Retry-After", async () => {
    const { personalChatSendLimiter } = await import("../../server/rate-limit");
    const { req, res } = makeReqRes(2);
    let last429 = false;
    for (let i = 0; i < 35; i++) {
      const r = makeReqRes(2);
      const next = await runMiddleware(personalChatSendLimiter, r.req, r.res);
      if (!next) {
        last429 = true;
        expect(r.res.statusCode).toBe(429);
        expect(r.res.headers["Retry-After"]).toBeDefined();
        break;
      }
    }
    expect(last429).toBe(true);
  });

  it("3. another legitimate user (different id) is not blocked by user #2's abuse", async () => {
    const { personalChatSendLimiter } = await import("../../server/rate-limit");
    // Exhaust user 2's budget.
    for (let i = 0; i < 31; i++) {
      const r = makeReqRes(2);
      await runMiddleware(personalChatSendLimiter, r.req, r.res);
    }
    // A different user, same IP, must be unaffected (per-user key, not per-IP).
    const other = makeReqRes(3);
    const next = await runMiddleware(personalChatSendLimiter, other.req, other.res);
    expect(next).toBe(true);
    expect(other.res.statusCode).toBe(200);
  });

  it("4. the limit resets once the window expires", async () => {
    const { personalChatSendLimiter } = await import("../../server/rate-limit");
    for (let i = 0; i < 31; i++) {
      const r = makeReqRes(4);
      await runMiddleware(personalChatSendLimiter, r.req, r.res);
    }
    const blocked = makeReqRes(4);
    const blockedNext = await runMiddleware(personalChatSendLimiter, blocked.req, blocked.res);
    expect(blockedNext).toBe(false);

    // Simulate window expiry by clearing the backing counter (equivalent to
    // Redis TTL elapsing / the key expiring).
    resetStore();

    const afterReset = makeReqRes(4);
    const afterResetNext = await runMiddleware(personalChatSendLimiter, afterReset.req, afterReset.res);
    expect(afterResetNext).toBe(true);
    expect(afterReset.res.statusCode).toBe(200);
  });

  it("falls back to safe in-memory limiting (not fail-open, not a crash) when Redis is unavailable", async () => {
    vi.resetModules();
    vi.doMock("../../server/redis", () => ({
      getRedisClient: () => ({
        incr: async () => { throw new Error("redis down"); },
        pexpire: async () => { throw new Error("redis down"); },
        pttl: async () => { throw new Error("redis down"); },
      }),
    }));
    const { personalChatSendLimiter: limiterWithNoRedis } = await import("../../server/rate-limit");
    let blockedAt: number | null = null;
    for (let i = 1; i <= 35; i++) {
      const r = makeReqRes(5);
      const next = await runMiddleware(limiterWithNoRedis, r.req, r.res);
      if (!next) { blockedAt = i; break; }
    }
    // Still enforces a real cap via the in-memory fallback bucket, not
    // unlimited pass-through.
    expect(blockedAt).not.toBeNull();
    vi.doUnmock("../../server/redis");
  });
});

describe("P0-2: groupChatSendLimiter (also covers translation-triggering group sends -- same route)", () => {
  it("normal group message succeeds", async () => {
    const { groupChatSendLimiter } = await import("../../server/rate-limit");
    const { req, res } = makeReqRes(10);
    const next = await runMiddleware(groupChatSendLimiter, req, res);
    expect(next).toBe(true);
  });

  it("translation-abuse via rapid group sends is capped the same way as plain sends", async () => {
    const { groupChatSendLimiter } = await import("../../server/rate-limit");
    let blocked = false;
    for (let i = 0; i < 35; i++) {
      const r = makeReqRes(11);
      const next = await runMiddleware(groupChatSendLimiter, r.req, r.res);
      if (!next) { blocked = true; expect(r.res.statusCode).toBe(429); break; }
    }
    expect(blocked).toBe(true);
  });

  it("personalChatSendLimiter and groupChatSendLimiter use independent key namespaces for the same user id", async () => {
    const { personalChatSendLimiter, groupChatSendLimiter } = await import("../../server/rate-limit");
    for (let i = 0; i < 31; i++) {
      const r = makeReqRes(20);
      await runMiddleware(personalChatSendLimiter, r.req, r.res);
    }
    const exhausted = makeReqRes(20);
    expect(await runMiddleware(personalChatSendLimiter, exhausted.req, exhausted.res)).toBe(false);

    // Same user id, but the group-chat limiter has its own budget.
    const groupStillOk = makeReqRes(20);
    expect(await runMiddleware(groupChatSendLimiter, groupStillOk.req, groupStillOk.res)).toBe(true);
  });
});
