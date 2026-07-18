import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import crypto from "crypto";

/**
 * Verifies the real HMAC-SHA256 webhook-signature logic in
 * server/payment-service.ts (handleRazorpayWebhook) against independently
 * computed test vectors — this is the most security-critical path in the
 * payment integration (a bypassable signature check means an attacker can
 * forge "payment succeeded" events). No live Razorpay account is needed or
 * used; this only exercises the local crypto/verification logic.
 */

const dbSelectMock = vi.fn(async () => [] as any[]);
const dbUpdateMock = vi.fn(async () => [] as any[]);

vi.mock("../../server/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: (...args: any[]) => dbSelectMock(...args),
        }),
      }),
    }),
    update: () => ({
      set: () => ({
        where: (...args: any[]) => ({
          then: (resolve: any, reject: any) => dbUpdateMock(...args).then(resolve, reject),
          returning: (...args2: any[]) => dbUpdateMock(...args, ...args2),
        }),
      }),
    }),
  },
}));

vi.mock("../../server/audit-logging", () => ({
  logAuditEvent: vi.fn(async () => {}),
}));

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
vi.mock("@shared/schema", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@shared/schema")>();
  return {
    ...actual,
    paymentGateways: {},
    paymentTransactions: { gatewayOrderId: "gatewayOrderId", gatewayPaymentId: "gatewayPaymentId" },
    platformSettings: {},
  };
});
vi.mock("drizzle-orm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("drizzle-orm")>();
  return { ...actual, eq: (col: any, value: any) => ({ col, value }) };
});

const WEBHOOK_SECRET = "test_webhook_secret_do_not_use_in_prod";

function sign(body: string, secret: string): string {
  return crypto.createHmac("sha256", secret).update(body).digest("hex");
}

describe("Razorpay webhook signature verification (real crypto, no live account needed)", () => {
  const originalEnv = process.env.RAZORPAY_WEBHOOK_SECRET;

  beforeEach(() => {
    vi.resetAllMocks();
    dbSelectMock.mockResolvedValue([]); // no payment_gateways row -> falls back to env var
    dbUpdateMock.mockResolvedValue([]);
    process.env.RAZORPAY_WEBHOOK_SECRET = WEBHOOK_SECRET;
  });

  afterAll(() => {
    process.env.RAZORPAY_WEBHOOK_SECRET = originalEnv;
  });

  it("rejects when no webhook secret is configured", async () => {
    delete process.env.RAZORPAY_WEBHOOK_SECRET;
    const { handleRazorpayWebhook } = await import("../../server/payment-service");
    await expect(handleRazorpayWebhook("{}", "somesig", {})).rejects.toThrow("WEBHOOK_SECRET_NOT_CONFIGURED");
  });

  it("rejects when the signature header is missing", async () => {
    const { handleRazorpayWebhook } = await import("../../server/payment-service");
    await expect(handleRazorpayWebhook("{}", undefined, {})).rejects.toThrow("WEBHOOK_SIGNATURE_REQUIRED");
  });

  it("rejects a forged/tampered signature (wrong secret)", async () => {
    const { handleRazorpayWebhook } = await import("../../server/payment-service");
    const body = JSON.stringify({ event: "payment.captured" });
    const forgedSignature = sign(body, "attacker_guessed_wrong_secret");
    await expect(handleRazorpayWebhook(body, forgedSignature, JSON.parse(body))).rejects.toThrow("INVALID_WEBHOOK_SIGNATURE");
  });

  it("rejects a valid signature computed over a DIFFERENT body than what's forwarded (tamper-after-sign)", async () => {
    const { handleRazorpayWebhook } = await import("../../server/payment-service");
    const originalBody = JSON.stringify({ event: "payment.captured", payload: { payment: { entity: { order_id: "order_1", id: "pay_1" } } } });
    const validSignatureForOriginal = sign(originalBody, WEBHOOK_SECRET);
    const tamperedBody = JSON.stringify({ event: "payment.captured", payload: { payment: { entity: { order_id: "order_1", id: "pay_ATTACKER_SUBSTITUTED" } } } });
    await expect(
      handleRazorpayWebhook(tamperedBody, validSignatureForOriginal, JSON.parse(tamperedBody)),
    ).rejects.toThrow("INVALID_WEBHOOK_SIGNATURE");
  });

  it("accepts a genuinely valid signature and processes payment.failed", async () => {
    const { handleRazorpayWebhook } = await import("../../server/payment-service");
    const event = {
      event: "payment.failed",
      payload: { payment: { entity: { order_id: "order_42", error_description: "Card declined" } } },
    };
    const body = JSON.stringify(event);
    const validSignature = sign(body, WEBHOOK_SECRET);

    await handleRazorpayWebhook(body, validSignature, event);

    expect(dbUpdateMock).toHaveBeenCalled();
  });

  it("silently ignores an unknown event type after a valid signature (no crash)", async () => {
    const { handleRazorpayWebhook } = await import("../../server/payment-service");
    const event = { event: "subscription.charged", payload: {} };
    const body = JSON.stringify(event);
    const validSignature = sign(body, WEBHOOK_SECRET);

    await expect(handleRazorpayWebhook(body, validSignature, event)).resolves.toBeUndefined();
  });
});
