import { describe, it, expect } from "vitest";
import { vi } from "vitest";

vi.mock("../../server/db", () => ({ db: {} }));
vi.mock("../../server/audit-logging", () => ({ logAuditEvent: vi.fn(async () => {}) }));
vi.mock("../../server/observability", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("../../server/redis", () => ({
  withRedisLock: async (_key: string, fn: () => Promise<any>) => fn(),
  isRedisDegraded: () => false,
}));
vi.mock("razorpay", () => ({ default: vi.fn() }));
vi.mock("../../server/billing-plan-utils", () => ({ summarizeBillingPlan: vi.fn() }));
vi.mock("../../server/billing-engine", () => ({ BillingEngine: vi.fn() }));
vi.mock("../../server/invoice-service", () => ({
  createSubscriptionInvoice: vi.fn(),
  markInvoicePaid: vi.fn(),
}));

/**
 * Pure unit tests for the refund-authorization decision — no DB, no
 * network, no mocked call chains. This is the RBAC/ownership matrix that
 * decides who may trigger a refund: owner, same-org member, org-scoped
 * company_admin override, and platform-wide super_admin override.
 */
describe("canRefundTransaction (pure RBAC/ownership logic)", () => {
  it("allows the transaction owner", async () => {
    const { canRefundTransaction } = await import("../../server/payment-service");
    expect(canRefundTransaction({ id: 7, role: "consumer" }, { userId: 7, organizationId: null })).toBe(true);
  });

  it("denies a stranger with no ownership or org relationship", async () => {
    const { canRefundTransaction } = await import("../../server/payment-service");
    expect(canRefundTransaction({ id: 8, role: "consumer" }, { userId: 7, organizationId: null })).toBe(false);
  });

  it("allows a same-organization member even if not the payer", async () => {
    const { canRefundTransaction } = await import("../../server/payment-service");
    expect(canRefundTransaction({ id: 8, role: "agent", organizationId: 42 }, { userId: 7, organizationId: 42 })).toBe(true);
  });

  it("denies a company_admin from a DIFFERENT organization (admin override is org-scoped, not global)", async () => {
    const { canRefundTransaction } = await import("../../server/payment-service");
    expect(canRefundTransaction({ id: 8, role: "company_admin", organizationId: 99 }, { userId: 7, organizationId: 42 })).toBe(false);
  });

  it("allows a company_admin from the SAME organization (admin override)", async () => {
    const { canRefundTransaction } = await import("../../server/payment-service");
    expect(canRefundTransaction({ id: 8, role: "company_admin", organizationId: 42 }, { userId: 7, organizationId: 42 })).toBe(true);
  });

  it("allows super_admin regardless of organization (platform-wide override)", async () => {
    const { canRefundTransaction } = await import("../../server/payment-service");
    expect(canRefundTransaction({ id: 99, role: "super_admin", organizationId: null }, { userId: 7, organizationId: 42 })).toBe(true);
  });

  it("denies when neither actor nor transaction has an organizationId and actor isn't the owner", async () => {
    const { canRefundTransaction } = await import("../../server/payment-service");
    expect(canRefundTransaction({ id: 8, role: "consumer", organizationId: null }, { userId: 7, organizationId: null })).toBe(false);
  });
});
