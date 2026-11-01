import { describe, expect, it, vi } from "vitest";

vi.mock("../../server/db", () => ({ db: {} }));
vi.mock("../../server/redis", () => ({
  getRedisClient: () => ({}),
  isRedisDegraded: () => false,
  withRedisLock: async (_key: string, fn: () => Promise<any>) => fn(),
}));
vi.mock("../../server/audit-logging", () => ({ logAuditEvent: vi.fn(async () => {}) }));
vi.mock("../../server/observability", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), on: vi.fn() },
}));

const { getMaxDurationSeconds } = await import("../../server/billing-engine");
const { requireBusinessBillingForCalls } = await import("../../server/usage-enforcement");

function runtime(overrides: Record<string, unknown>) {
  return {
    estimatedRatePerMinutePaise: 0,
    freeSecondsRemaining: 0,
    freeCreditsRemainingPaise: 0,
    walletBalancePaise: 0,
    lockedBalancePaise: 0,
    reservedAvailablePaise: 0,
    billingType: "prepaid",
    config: { perSecondBilling: true },
    ...overrides,
  } as any;
}

describe("personal call billing rules", () => {
  it("a free (untranslated) personal call is open-ended", () => {
    expect(getMaxDurationSeconds(runtime({ chargesWaived: true }))).toBe(60 * 60 * 24);
  });

  it("a translated personal call lasts only as long as the AI minutes left", () => {
    expect(getMaxDurationSeconds(runtime({ aiMinutesOnly: true, freeSecondsRemaining: 300 }))).toBe(300);
  });

  it("a translated personal call with no AI minutes left cannot run (the free-plan ₹0 rate no longer means unlimited)", () => {
    expect(getMaxDurationSeconds(runtime({ aiMinutesOnly: true, freeSecondsRemaining: 0, estimatedRatePerMinutePaise: 0 }))).toBe(0);
  });

  it("personal users may start or answer a call without a plan", () => {
    const next = vi.fn();
    const res = { status: vi.fn(() => res), json: vi.fn() } as any;
    requireBusinessBillingForCalls({ user: { id: 7, organizationId: null, role: "user" } } as any, res, next);
    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it("business users still go through the paid-plan check", () => {
    const next = vi.fn();
    const res = { status: vi.fn(() => res), json: vi.fn() } as any;
    // No user id: the paid-plan check answers 401 instead of letting it through.
    requireBusinessBillingForCalls({ user: { organizationId: 3, role: "company_admin" } } as any, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });
});
