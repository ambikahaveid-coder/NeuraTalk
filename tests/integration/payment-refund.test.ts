import { describe, it, expect, vi, beforeEach } from "vitest";
import { paymentTransactions as realPaymentTransactionsTable, paymentRefunds as realPaymentRefundsTable } from "@shared/schema";

/**
 * Integration tests for initiateRefund() — the real production refund flow
 * (server/payment-service.ts). DB, Redis, and the Razorpay client are
 * substituted (no live Razorpay account exists in this environment — see
 * the module certification), but the RBAC, idempotency, duplicate-protection,
 * amount validation, refund-ledger, and audit-logging logic under test is
 * 100% real, unmodified production code.
 *
 * The Razorpay client is injected via __setTestRazorpayClient rather than
 * `vi.mock("razorpay", ...)` — mocking a `new X()` construction from a
 * third-party CJS package proved unreliable via vi.mock in this project's
 * Vitest setup (the mock was silently bypassed depending on call path), so
 * payment-service.ts exposes an explicit test-only override hook instead.
 */

let paymentTransactionsRow: any = null;
let paymentRefundsRows: any[] = [];
let sumRefundedResult = 0;

const auditLogMock = vi.fn(async () => {});
const razorpayRefundMock = vi.fn();

vi.mock("../../server/db", () => {
  const normalize = (r: any) => (r == null ? [] : Array.isArray(r) ? r : [r]);

  return {
    db: {
      select: (proj?: any) => {
        // Aggregate (sum) queries pass a projection object; route those separately.
        if (proj && typeof proj === "object" && "alreadyRefunded" in proj) {
          return { from: () => ({ where: async () => [{ alreadyRefunded: sumRefundedResult }] }) };
        }
        if (proj && typeof proj === "object" && "totalRefunded" in proj) {
          return { from: () => ({ where: async () => [{ totalRefunded: sumRefundedResult }] }) };
        }
        return {
          from: (_table: any) => ({
            where: (..._args: any[]) => ({
              // Distinguish paymentTransactions vs paymentRefunds lookups by call order:
              // the test controls this via the module-level selectQueue below.
              limit: async () => normalize(selectRouter()),
            }),
          }),
        };
      },
      insert: (table: any) => ({
        values: (values: any) => ({
          returning: async () => {
            const row = { id: paymentRefundsRows.length + 1, ...values, createdAt: new Date() };
            if (table === realPaymentRefundsTable) paymentRefundsRows.push(row);
            return [row];
          },
        }),
      }),
      update: (table: any) => ({
        set: (patch: any) => ({
          where: (..._args: any[]) => ({
            returning: async () => {
              if (table === realPaymentTransactionsTable) {
                if (paymentTransactionsRow) Object.assign(paymentTransactionsRow, patch);
                return [paymentTransactionsRow];
              }
              const refund = paymentRefundsRows[paymentRefundsRows.length - 1];
              if (refund) Object.assign(refund, patch);
              return [refund];
            },
          }),
        }),
      }),
    },
  };
});

// Selects happen in a fixed order inside initiateRefund: (1) transaction,
// (2) idempotency-key lookup, (3) in-progress lookup. A queue keeps the stub simple.
let selectQueue: (() => any)[] = [];
function selectRouter() {
  const next = selectQueue.shift();
  return next ? next() : [];
}

vi.mock("../../server/audit-logging", () => ({ logAuditEvent: (...args: any[]) => auditLogMock(...args) }));
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

const ACTOR = { id: 7, role: "consumer" };

function makeTransaction(overrides: Record<string, any> = {}) {
  return {
    id: 100,
    userId: 7,
    organizationId: null,
    amount: 10_000,
    currency: "INR",
    status: "completed",
    gatewayPaymentId: "pay_abc123",
    gatewayOrderId: "order_abc123",
    metadata: {},
    ...overrides,
  };
}

beforeEach(async () => {
  vi.resetAllMocks();
  paymentTransactionsRow = null;
  paymentRefundsRows = [];
  selectQueue = [];
  sumRefundedResult = 0;
  auditLogMock.mockResolvedValue(undefined);
  razorpayRefundMock.mockResolvedValue({ id: "rfnd_xyz789" });
  process.env.RAZORPAY_KEY_ID = "rzp_test_fake";
  process.env.RAZORPAY_KEY_SECRET = "fake_secret";

  const { __setTestRazorpayClient } = await import("../../server/payment-service");
  __setTestRazorpayClient({
    payments: { refund: (...args: any[]) => razorpayRefundMock(...args) },
  } as any);
});

describe("initiateRefund — authorization", () => {
  it("rejects a refund attempt by a user who neither owns nor administers the transaction", async () => {
    const { initiateRefund } = await import("../../server/payment-service");
    paymentTransactionsRow = makeTransaction({ userId: 999 });
    selectQueue = [() => paymentTransactionsRow];

    await expect(initiateRefund({ actor: ACTOR, transactionId: 100 })).rejects.toThrow("UNAUTHORIZED_TRANSACTION");
    expect(razorpayRefundMock).not.toHaveBeenCalled();
  });

  it("rejects when the transaction does not exist", async () => {
    const { initiateRefund } = await import("../../server/payment-service");
    selectQueue = [() => []];

    await expect(initiateRefund({ actor: ACTOR, transactionId: 999 })).rejects.toThrow("TRANSACTION_NOT_FOUND");
  });

  it("rejects refunding a transaction that was never completed", async () => {
    const { initiateRefund } = await import("../../server/payment-service");
    paymentTransactionsRow = makeTransaction({ status: "pending" });
    selectQueue = [() => paymentTransactionsRow];

    await expect(initiateRefund({ actor: ACTOR, transactionId: 100 })).rejects.toThrow("TRANSACTION_NOT_REFUNDABLE");
  });
});

describe("initiateRefund — duplicate protection & idempotency", () => {
  it("blocks a second refund while one is already PROCESSING for the same transaction", async () => {
    const { initiateRefund } = await import("../../server/payment-service");
    paymentTransactionsRow = makeTransaction();
    selectQueue = [
      () => paymentTransactionsRow, // transaction lookup
      () => [{ id: 1, transactionId: 100, status: "processing" }], // in-progress refund found
    ];

    await expect(initiateRefund({ actor: ACTOR, transactionId: 100 })).rejects.toThrow("REFUND_ALREADY_IN_PROGRESS");
    expect(razorpayRefundMock).not.toHaveBeenCalled();
  });

  it("replays the original result for a repeated idempotency key instead of calling the gateway again", async () => {
    const { initiateRefund } = await import("../../server/payment-service");
    paymentTransactionsRow = makeTransaction();
    const existingRefund = {
      id: 5,
      transactionId: 100,
      status: "completed",
      amountPaise: 10_000,
      isFullRefund: true,
      gatewayRefundId: "rfnd_previous",
    };
    selectQueue = [
      () => paymentTransactionsRow, // transaction lookup
      () => [existingRefund], // idempotency key match
    ];

    const result = await initiateRefund({ actor: ACTOR, transactionId: 100, idempotencyKey: "client-key-1" });

    expect(result.replayed).toBe(true);
    expect(result.gatewayRefundId).toBe("rfnd_previous");
    expect(razorpayRefundMock).not.toHaveBeenCalled();
  });

  it("re-raises the original failure for a repeated idempotency key tied to a FAILED attempt", async () => {
    const { initiateRefund } = await import("../../server/payment-service");
    paymentTransactionsRow = makeTransaction();
    selectQueue = [
      () => paymentTransactionsRow,
      () => [{ id: 5, transactionId: 100, status: "failed" }],
    ];

    await expect(initiateRefund({ actor: ACTOR, transactionId: 100, idempotencyKey: "client-key-2" })).rejects.toThrow("REFUND_GATEWAY_ERROR");
    expect(razorpayRefundMock).not.toHaveBeenCalled();
  });
});

describe("initiateRefund — amount validation (full vs partial)", () => {
  it("rejects a request to refund more than remains on the transaction", async () => {
    const { initiateRefund } = await import("../../server/payment-service");
    paymentTransactionsRow = makeTransaction({ amount: 10_000 });
    selectQueue = [() => paymentTransactionsRow, () => [], () => []];
    sumRefundedResult = 0;

    await expect(initiateRefund({ actor: ACTOR, transactionId: 100, amountPaise: 15_000 })).rejects.toThrow("REFUND_AMOUNT_EXCEEDS_REMAINING");
  });

  it("rejects refunding an already fully-refunded transaction", async () => {
    const { initiateRefund } = await import("../../server/payment-service");
    paymentTransactionsRow = makeTransaction({ amount: 10_000, status: "partially_refunded" });
    selectQueue = [() => paymentTransactionsRow, () => [], () => []];
    sumRefundedResult = 10_000; // fully consumed already

    await expect(initiateRefund({ actor: ACTOR, transactionId: 100 })).rejects.toThrow("ALREADY_FULLY_REFUNDED");
  });

  it("processes a valid partial refund and marks the transaction PARTIALLY_REFUNDED", async () => {
    const { initiateRefund } = await import("../../server/payment-service");
    paymentTransactionsRow = makeTransaction({ amount: 10_000 });
    selectQueue = [() => paymentTransactionsRow, () => [], () => []];
    sumRefundedResult = 0;

    const result = await initiateRefund({ actor: ACTOR, transactionId: 100, amountPaise: 4_000, reason: "Customer request" });

    expect(result.success).toBe(true);
    expect(result.isFullRefund).toBe(false);
    expect(result.transactionStatus).toBe("partially_refunded");
    expect(razorpayRefundMock).toHaveBeenCalledWith("pay_abc123", expect.objectContaining({ amount: 4_000 }));
  });

  it("processes a full refund and marks the transaction REFUNDED", async () => {
    const { initiateRefund } = await import("../../server/payment-service");
    paymentTransactionsRow = makeTransaction({ amount: 10_000 });
    selectQueue = [() => paymentTransactionsRow, () => [], () => []];
    sumRefundedResult = 0;

    const result = await initiateRefund({ actor: ACTOR, transactionId: 100 });

    expect(result.isFullRefund).toBe(true);
    expect(result.transactionStatus).toBe("refunded");
    expect(result.amountPaise).toBe(10_000);
  });
});

describe("initiateRefund — audit logging", () => {
  it("logs billing_refund_requested and billing_refund on a successful refund", async () => {
    const { initiateRefund } = await import("../../server/payment-service");
    paymentTransactionsRow = makeTransaction({ amount: 10_000 });
    selectQueue = [() => paymentTransactionsRow, () => [], () => []];

    await initiateRefund({ actor: ACTOR, transactionId: 100 });

    const actions = auditLogMock.mock.calls.map((call) => call[0].action);
    expect(actions).toContain("billing_refund_requested");
    expect(actions).toContain("billing_refund");
  });

  it("logs billing_refund_failed when the gateway is not configured", async () => {
    const { initiateRefund, __setTestRazorpayClient } = await import("../../server/payment-service");
    __setTestRazorpayClient(null);
    paymentTransactionsRow = makeTransaction({ amount: 10_000 });
    selectQueue = [() => paymentTransactionsRow, () => [], () => []];

    await expect(initiateRefund({ actor: ACTOR, transactionId: 100 })).rejects.toThrow("PAYMENT_GATEWAY_NOT_CONFIGURED");

    const actions = auditLogMock.mock.calls.map((call) => call[0].action);
    expect(actions).toContain("billing_refund_failed");
  });

  it("logs billing_refund_failed and rejects when the Razorpay call fails after retries", async () => {
    const { initiateRefund } = await import("../../server/payment-service");
    paymentTransactionsRow = makeTransaction({ amount: 10_000 });
    selectQueue = [() => paymentTransactionsRow, () => [], () => []];
    razorpayRefundMock.mockRejectedValue(Object.assign(new Error("Bad request"), { statusCode: 400 }));

    await expect(initiateRefund({ actor: ACTOR, transactionId: 100 })).rejects.toThrow("REFUND_GATEWAY_ERROR");

    const actions = auditLogMock.mock.calls.map((call) => call[0].action);
    expect(actions).toContain("billing_refund_failed");
    expect(razorpayRefundMock).toHaveBeenCalledTimes(1); // non-retryable 4xx — no retry
  });

  it("retries a transient (5xx / network) gateway failure before giving up", async () => {
    const { initiateRefund } = await import("../../server/payment-service");
    paymentTransactionsRow = makeTransaction({ amount: 10_000 });
    selectQueue = [() => paymentTransactionsRow, () => [], () => []];
    razorpayRefundMock
      .mockRejectedValueOnce(Object.assign(new Error("Timeout"), { statusCode: 503 }))
      .mockResolvedValueOnce({ id: "rfnd_after_retry" });

    const result = await initiateRefund({ actor: ACTOR, transactionId: 100 });

    expect(result.gatewayRefundId).toBe("rfnd_after_retry");
    expect(razorpayRefundMock).toHaveBeenCalledTimes(2);
  });
});
