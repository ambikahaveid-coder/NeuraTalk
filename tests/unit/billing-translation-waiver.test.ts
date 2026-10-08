import { describe, it, expect, beforeEach, vi } from "vitest";
import { subscriptions as subscriptionsTable } from "@shared/schema";

// A call whose translator never started must not use the caller's minutes.
// Redis and the database are faked: one runtime session in a map, and the
// last minutesRemaining written to the subscriptions table.

const redisStore = new Map<string, string>();
const subscriptionWrites: Array<Record<string, unknown>> = [];

vi.mock("../../server/redis", () => {
  const multi = () => {
    const chain: any = {
      set: (key: string, value: string) => { redisStore.clear(); redisStore.set(key, value); return chain; },
      sadd: () => chain,
      srem: () => chain,
      del: (key: string) => { redisStore.delete(key); return chain; },
      exec: async () => [],
    };
    return chain;
  };
  return {
    getRedisClient: () => ({
      // Keys are "<prefix><sessionId>"; match on the session id suffix.
      get: async (key: string) => {
        for (const [k, v] of redisStore) if (key.endsWith(k.slice(k.lastIndexOf(":") + 1)) && k.endsWith(key.slice(key.lastIndexOf(":") + 1))) return v;
        return null;
      },
      multi,
      smembers: async () => [],
    }),
    isRedisDegraded: () => false,
    withRedisLock: async (_key: string, fn: () => Promise<any>) => fn(),
  };
});
vi.mock("../../server/db", () => ({
  db: {
    update: (table: unknown) => ({
      set: (values: Record<string, unknown>) => ({
        where: async () => {
          if (table === subscriptionsTable) subscriptionWrites.push(values);
        },
      }),
    }),
  },
}));
vi.mock("../../server/audit-logging", () => ({ logAuditEvent: vi.fn(async () => {}) }));
vi.mock("../../server/observability", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), on: vi.fn() },
}));

const { BillingEngine } = await import("../../server/billing-engine");

const SESSION = "call_waiver_test";
const counter = () => ({ seconds: 0, paise: 0, remainder: 0 });

function seedSession(freeMinutes: number) {
  const now = Date.now();
  redisStore.clear();
  subscriptionWrites.length = 0;
  redisStore.set(`seed:${SESSION}`, JSON.stringify({
    sessionId: SESSION,
    userId: 7,
    organizationId: null,
    billingAccountId: null,
    subscriptionId: 42,
    reservationId: null,
    billingType: "prepaid",
    callType: "voice",
    translationEnabled: true,
    recordingEnabled: false,
    joinMethod: "app_to_app",
    currency: "INR",
    config: {
      limits: { dailyUsageLimit: 0 },
      rates: { voicePerMinutePaise: 100, videoPerMinutePaise: 0, translationPerMinutePaise: 200, recordingPerMinutePaise: 0 },
      perSecondBilling: true,
      freeUnits: { minutes: freeMinutes },
    },
    estimatedRatePerMinutePaise: 300,
    pricingOverride: null,
    maxDurationSeconds: freeMinutes * 60,
    freeSecondsRemaining: freeMinutes * 60,
    freeCreditsRemainingPaise: 0,
    walletBalancePaise: 0,
    lockedBalancePaise: 0,
    pendingWalletDeltaPaise: 0,
    pendingLockedDeltaPaise: 0,
    totalReservedPaise: 0,
    reservedAvailablePaise: 0,
    outstandingPostpaidPaise: 0,
    creditLimitPaise: 0,
    currentDayUsageSeconds: 0,
    usageDayAnchor: new Date(now).toISOString(),
    durationSeconds: 0,
    prepaidDebitPaise: 0,
    postpaidAccrualPaise: 0,
    includedFreeSecondsUsed: 0,
    includedFreeCreditsUsedPaise: 0,
    initialLockedPaise: 0,
    topupLockedPaise: 0,
    billingActive: true,
    authorizedAtMs: now,
    answeredAtMs: now,
    startedAtMs: now,
    lastProcessedAtMs: now,
    hardStopAtMs: now + 24 * 60 * 60 * 1000,
    terminationRequestedReason: null,
    features: { voice: counter(), video: counter(), translation: counter(), recording: counter() },
  }));
}

const lastMinutesRemaining = () => subscriptionWrites.at(-1)?.minutesRemaining;

describe("translation-failure charge waiver", () => {
  beforeEach(() => seedSession(10));

  it("a normal call uses the caller's minutes", async () => {
    await BillingEngine.tickCallSession(SESSION, 120);
    expect(lastMinutesRemaining()).toBe(8);
  });

  it("waiving refunds minutes already used and charges nothing afterwards", async () => {
    await BillingEngine.tickCallSession(SESSION, 120);
    expect(lastMinutesRemaining()).toBe(8);

    expect(await BillingEngine.waiveCallSessionCharges(SESSION, "bot failed")).toBe(true);
    expect(lastMinutesRemaining()).toBe(10);

    const progress = await BillingEngine.tickCallSession(SESSION, 180);
    expect(lastMinutesRemaining()).toBe(10);
    expect(progress.durationSeconds).toBe(300);
  });

  it("does not end a waived call for lack of minutes", async () => {
    seedSession(1);
    await BillingEngine.waiveCallSessionCharges(SESSION, "bot failed");
    const progress = await BillingEngine.tickCallSession(SESSION, 300);
    expect(progress.durationSeconds).toBe(300);
    expect(lastMinutesRemaining()).toBe(1);
  });

  it("waiving twice is a no-op", async () => {
    expect(await BillingEngine.waiveCallSessionCharges(SESSION, "bot failed")).toBe(true);
    expect(await BillingEngine.waiveCallSessionCharges(SESSION, "bot failed")).toBe(false);
  });

  it("an unknown session is ignored", async () => {
    redisStore.clear();
    expect(await BillingEngine.waiveCallSessionCharges("missing", "bot failed")).toBe(false);
  });
});
