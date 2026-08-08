import { describe, it, expect, vi, beforeEach } from "vitest";
import RedisMock from "ioredis-mock";

/**
 * Regression test for a real, independently-confirmed bug: `activatePstnFallback`
 * in server/modules/calls/smart-router.ts is a SECOND, independent
 * outbound-PSTN-dialing path (distinct from initiateCall's app_to_pstn
 * branch) — reachable externally via API-key-authenticated integration
 * routes (communication-api-routes.ts, jago-integration-routes.ts,
 * secplus-integration-routes.ts). An earlier pass added toll-fraud
 * detection only to initiateCall and missed this path entirely, leaving a
 * live, externally-reachable bypass of premium-destination/velocity
 * checking. This test exercises the REAL activatePstnFallback function
 * (not a mock of it) and proves the fraud gate is actually reached.
 */

const redisInstance = new RedisMock();
vi.mock("../../server/redis", () => ({ getRedisClient: () => redisInstance }));

const initiateCallMock = vi.fn(async () => ({ providerCallId: "prov_123", status: "queued" }));
vi.mock("../../server/pstn/registry", () => ({
  getPSTNProvider: () => ({ name: "msg91", initiateCall: initiateCallMock }),
  isPSTNAvailable: () => true,
}));

vi.mock("../../server/livekit-service", () => ({
  createCallRoom: vi.fn(async () => ({})),
  endCallRoom: vi.fn(async () => {}),
  issueAccessToken: vi.fn(async () => "fake-token"),
  issueBotToken: vi.fn(async () => "fake-bot-token"),
  setParticipantHold: vi.fn(async () => {}),
}));

vi.mock("../../server/billing-engine", () => ({
  BillingEngine: {
    startCallSession: vi.fn(async () => ({ allowed: true, estimatedRatePerMinutePaise: 100 })),
    setCallSessionStatus: vi.fn(async () => {}),
  },
  billingEvents: { on: vi.fn(), emit: vi.fn() },
}));

vi.mock("../../server/universal-language-runtime", () => ({
  finalizeCallBilling: vi.fn(async () => ({})),
  initCallLanguageTracking: vi.fn(async () => {}),
  setParticipantLanguagePreference: vi.fn(async () => {}),
}));

vi.mock("../../server/pstn/monitor", () => ({ recordCallOutcome: vi.fn(async () => {}) }));
vi.mock("../../server/db", () => ({ db: { select: () => ({ from: () => ({ where: () => Promise.resolve([]) }) }) } }));
vi.mock("../../server/observability", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("../../server/call-persistence", () => ({ persistCompletedCall: vi.fn(async () => {}) }));
vi.mock("../../server/storage", () => ({ storage: { getUser: vi.fn(async () => undefined) } }));

beforeEach(async () => {
  await redisInstance.flushall();
  initiateCallMock.mockClear();
  process.env.APP_BASE_URL = "https://example.com";
  process.env.LIVEKIT_SIP_DOMAIN = "sip.example.com";
});

async function seedSmartCall(callId: string, overrides: Record<string, unknown> = {}) {
  const record = {
    callId,
    joinMethod: "app_to_app",
    status: "created",
    callerId: "42",
    callerOrganizationId: 1,
    calleeIdentifier: "unassigned",
    callType: "voice",
    callerLanguage: "auto",
    languageDetectionActive: false,
    estimatedRateInrPerMin: 1,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
  await redisInstance.set(`smart_call:${callId}`, JSON.stringify(record));
}

describe("activatePstnFallback — fraud check regression (previously bypassed entirely)", () => {
  it("blocks a premium-rate destination and NEVER calls the PSTN provider", async () => {
    await seedSmartCall("call_test_1");
    const { activatePstnFallback } = await import("../../server/modules/calls/smart-router");

    await expect(
      activatePstnFallback("call_test_1", {
        callerNumber: "+919876543210",
        calleePhoneNumber: "+881612345678", // premium/satellite prefix
      }),
    ).rejects.toThrow(/FRAUD_CHECK_BLOCKED/);

    expect(initiateCallMock).not.toHaveBeenCalled();
  });

  it("blocks the same premium destination even without a leading '+' (the exact normalization bypass this fix addresses)", async () => {
    await seedSmartCall("call_test_2");
    const { activatePstnFallback } = await import("../../server/modules/calls/smart-router");

    await expect(
      activatePstnFallback("call_test_2", {
        callerNumber: "+919876543210",
        calleePhoneNumber: "881612345678", // no leading "+"
      }),
    ).rejects.toThrow(/FRAUD_CHECK_BLOCKED/);

    expect(initiateCallMock).not.toHaveBeenCalled();
  });

  it("allows a normal-looking destination through to the real PSTN provider call", async () => {
    await seedSmartCall("call_test_3");
    const { activatePstnFallback } = await import("../../server/modules/calls/smart-router");

    const result = await activatePstnFallback("call_test_3", {
      callerNumber: "+919876543210",
      calleePhoneNumber: "+919123456789",
    });

    expect(result.pstnCallId).toBe("prov_123");
    expect(initiateCallMock).toHaveBeenCalledTimes(1);
  });

  it("blocks after the velocity threshold is exceeded on this exact code path", async () => {
    process.env.FRAUD_VELOCITY_MAX_CALLS = "2";
    vi.resetModules();
    await seedSmartCall("call_test_4a");
    await seedSmartCall("call_test_4b");
    await seedSmartCall("call_test_4c");
    const { activatePstnFallback } = await import("../../server/modules/calls/smart-router");

    await activatePstnFallback("call_test_4a", { callerNumber: "+919876543210", calleePhoneNumber: "+919111111111" });
    await activatePstnFallback("call_test_4b", { callerNumber: "+919876543210", calleePhoneNumber: "+919111111112" });

    await expect(
      activatePstnFallback("call_test_4c", { callerNumber: "+919876543210", calleePhoneNumber: "+919111111113" }),
    ).rejects.toThrow(/FRAUD_CHECK_BLOCKED/);

    delete process.env.FRAUD_VELOCITY_MAX_CALLS;
    vi.resetModules();
  });
});
