import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const ORIGINAL_ENV = { ...process.env };

const createCallRoomMock = vi.fn(async () => ({}));
const issueAccessTokenMock = vi.fn(async () => "fake-token");
const issueBotTokenMock = vi.fn(async () => "fake-bot-token");
vi.mock("../../server/livekit-service", () => ({
  createCallRoom: createCallRoomMock,
  issueAccessToken: issueAccessTokenMock,
  issueBotToken: issueBotTokenMock,
}));

const startCallSessionMock = vi.fn(async () => ({ allowed: true }));
vi.mock("../../server/billing-engine", () => ({
  BillingEngine: { startCallSession: startCallSessionMock },
}));

vi.mock("../../server/universal-language-runtime", () => ({
  initCallLanguageTracking: vi.fn(async () => {}),
}));

const registerInboundSmartCallMock = vi.fn(async () => ({}));
const routeToSkillAgentMock = vi.fn(async () => null as string | null);
vi.mock("../../server/modules/calls/smart-router", () => ({
  registerInboundSmartCall: registerInboundSmartCallMock,
  routeToSkillAgent: (...args: any[]) => routeToSkillAgentMock(...args),
}));

const getUserByPhoneMock = vi.fn(async () => null as any);
vi.mock("../../server/storage", () => ({
  storage: {
    getUserByPhone: (...args: any[]) => getUserByPhoneMock(...args),
    getUser: vi.fn(async (id: number) => ({ id, preferredLanguage: "en" })),
  },
}));

let orgDIDRows: any[] = [];
vi.mock("../../server/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => orgDIDRows,
        }),
      }),
    }),
  },
}));

vi.mock("@shared/schema", () => ({
  orgDIDNumbers: { phoneNumber: "phoneNumber" },
}));

vi.mock("drizzle-orm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("drizzle-orm")>();
  return { ...actual, eq: (col: any, value: any) => ({ col, value }) };
});

vi.mock("../../server/pstn/inbound-store", () => ({
  storeInboundCall: vi.fn(async () => {}),
  getInboundCallByDID: vi.fn(async () => null),
}));

// In-memory fake standing in for ioredis, just faithful enough to exercise
// the callee double-booking lock (SET ... NX) added to pstn/inbound.ts.
let fakeRedisStore: Map<string, string>;
const fakeRedisClient = {
  set: vi.fn(async (key: string, value: string, ..._rest: unknown[]) => {
    const isNx = _rest.includes("NX");
    if (isNx && fakeRedisStore.has(key)) return null;
    fakeRedisStore.set(key, value);
    return "OK";
  }),
  get: vi.fn(async (key: string) => fakeRedisStore.get(key) ?? null),
  del: vi.fn(async (key: string) => {
    const existed = fakeRedisStore.delete(key);
    return existed ? 1 : 0;
  }),
};
vi.mock("../../server/redis", () => ({
  getRedisClient: () => fakeRedisClient,
}));

// inbound.ts fire-and-forgets a translator-bot spawn on the successful path;
// mocked so it doesn't attempt a real (unconfigured, in this test) LiveKit
// connection in the background after assertions have already run.
vi.mock("../../server/translator-bot", () => ({
  startBotWorker: vi.fn(async () => {}),
}));

const mockProvider = {
  name: "msg91",
  parseInboundWebhook: vi.fn((body: any) => ({
    providerCallId: "prov-1",
    callerNumber: "+919000000001",
    calledNumber: body.calledNumber ?? "+919000000002",
    provider: "msg91",
    raw: body,
  })),
  buildInboundAcceptResponse: vi.fn((sipUri: string) => ({ action: "bridge", sip_uri: sipUri })),
};
vi.mock("../../server/pstn/registry", async () => {
  const actual = await vi.importActual<typeof import("../../server/pstn/registry")>("../../server/pstn/registry");
  return {
    ...actual,
    getPSTNProvider: () => mockProvider,
  };
});

beforeEach(() => {
  orgDIDRows = [];
  fakeRedisStore = new Map();
  vi.clearAllMocks();
  process.env = { ...ORIGINAL_ENV };
});

afterEach(async () => {
  process.env = { ...ORIGINAL_ENV };
  // handleInboundCall fire-and-forgets a translator-bot spawn
  // (`void mod.startBotWorker(...)`) on the successful bridge path — it's
  // mocked above, but without this flush the mocked call's resolution can
  // straggle past this file's run and land in a *different* test file's
  // module registry (this suite runs with fileParallelism: false, i.e.
  // sequentially in one process), where translator-bot.ts isn't mocked,
  // producing a spurious unhandled-rejection failure attributed to an
  // unrelated file. A couple of macrotask ticks gives it time to settle
  // here, where it's actually mocked.
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
});

describe("PSTN inbound — SIP bridge guard", () => {
  it("rejects the call before starting billing or creating a room when LIVEKIT_SIP_DOMAIN is unset", async () => {
    delete process.env.LIVEKIT_SIP_DOMAIN;
    // A resolvable target (real B2C user), so the rejection can only be
    // caused by the SIP-bridge guard, not by "no target found" — otherwise
    // this test would pass for the wrong reason.
    getUserByPhoneMock.mockResolvedValueOnce({ id: 5, organizationId: null, preferredLanguage: "en" });

    const { handleInboundCall } = await import("../../server/pstn/inbound");
    const result = await handleInboundCall({ calledNumber: "+919000000002" }, {});

    expect(result.body).toEqual({ action: "reject", reason: "busy" });
    expect(startCallSessionMock).not.toHaveBeenCalled();
    expect(createCallRoomMock).not.toHaveBeenCalled();
  }, 20_000);
});

describe("PSTN inbound — B2B org DID routing", () => {
  it("routes to a skill-matched agent and returns a real SIP-bridge accept response", async () => {
    process.env.LIVEKIT_SIP_DOMAIN = "sip.livekit.neuratalk.in";
    orgDIDRows = [{ organizationId: 42, isActive: true, type: "inbound", phoneNumber: "+919000000002" }];
    routeToSkillAgentMock.mockResolvedValueOnce("agent-77");

    const { handleInboundCall } = await import("../../server/pstn/inbound");
    const result = await handleInboundCall({ calledNumber: "+919000000002" }, {});

    expect(routeToSkillAgentMock).toHaveBeenCalledWith(42, []);
    expect(startCallSessionMock).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: 42 }),
    );
    expect(createCallRoomMock).toHaveBeenCalled();
    expect(result.body).toMatchObject({ action: "bridge" });
    expect((result.body as any).sip_uri).toContain("sip.livekit.neuratalk.in");
  }, 20_000); // first successful-path test also pays for the dynamic firebase-admin import

  it("rejects when the org DID has no available agent", async () => {
    process.env.LIVEKIT_SIP_DOMAIN = "sip.livekit.neuratalk.in";
    orgDIDRows = [{ organizationId: 42, isActive: true, type: "inbound", phoneNumber: "+919000000002" }];
    routeToSkillAgentMock.mockResolvedValueOnce(null);

    const { handleInboundCall } = await import("../../server/pstn/inbound");
    const result = await handleInboundCall({ calledNumber: "+919000000002" }, {});

    expect(result.body).toEqual({ action: "reject", reason: "busy" });
    expect(startCallSessionMock).not.toHaveBeenCalled();
  });

  it("does not treat an inactive DID as a valid B2B route", async () => {
    process.env.LIVEKIT_SIP_DOMAIN = "sip.livekit.neuratalk.in";
    orgDIDRows = [{ organizationId: 42, isActive: false, type: "inbound", phoneNumber: "+919000000002" }];

    const { handleInboundCall } = await import("../../server/pstn/inbound");
    await handleInboundCall({ calledNumber: "+919000000002" }, {});

    expect(routeToSkillAgentMock).not.toHaveBeenCalled();
  });
});

describe("PSTN inbound — callee double-booking guard (P0 fix)", () => {
  it("rejects a second simultaneous inbound call to a callee who already has one in progress", async () => {
    process.env.LIVEKIT_SIP_DOMAIN = "sip.livekit.neuratalk.in";
    orgDIDRows = [{ organizationId: 42, isActive: true, type: "inbound", phoneNumber: "+919000000002" }];
    routeToSkillAgentMock.mockResolvedValue("agent-77");

    const { handleInboundCall } = await import("../../server/pstn/inbound");

    const first = await handleInboundCall({ calledNumber: "+919000000002" }, {});
    expect(first.body).toMatchObject({ action: "bridge" });
    expect(createCallRoomMock).toHaveBeenCalledTimes(1);

    // Same callee (agent-77), a second inbound call arrives while the first
    // is still active — must be rejected before billing/room creation, not
    // silently double-booked.
    const second = await handleInboundCall({ calledNumber: "+919000000002" }, {});
    expect(second.body).toEqual({ action: "reject", reason: "busy" });
    expect(createCallRoomMock).toHaveBeenCalledTimes(1); // still just the first call
    expect(startCallSessionMock).toHaveBeenCalledTimes(1);
  }, 20_000);

  it("releases the callee lock if call setup fails after the lock was acquired, so a retry isn't permanently blocked", async () => {
    process.env.LIVEKIT_SIP_DOMAIN = "sip.livekit.neuratalk.in";
    orgDIDRows = [{ organizationId: 42, isActive: true, type: "inbound", phoneNumber: "+919000000002" }];
    routeToSkillAgentMock.mockResolvedValue("agent-77");
    createCallRoomMock.mockRejectedValueOnce(new Error("simulated LiveKit outage"));

    const { handleInboundCall } = await import("../../server/pstn/inbound");

    const failed = await handleInboundCall({ calledNumber: "+919000000002" }, {});
    expect(failed.body).toEqual({ action: "reject", reason: "busy" });

    // Lock must have been released — confirmed two ways: directly via the
    // fake store, and behaviorally via a second, now-successful attempt.
    expect(fakeRedisStore.has("user:active_call:agent-77")).toBe(false);

    const retry = await handleInboundCall({ calledNumber: "+919000000002" }, {});
    expect(retry.body).toMatchObject({ action: "bridge" });
  }, 20_000);
});
