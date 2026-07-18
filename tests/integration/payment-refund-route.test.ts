import { describe, it, expect, vi, beforeEach } from "vitest";
import express, { type Express } from "express";
import request from "supertest";

/**
 * HTTP-level tests for POST /api/payments/:transactionId/refund — verifies
 * the route wiring (validation, status-code mapping, Idempotency-Key header
 * handling) against the real server/payment-routes.ts, with the service
 * layer mocked (already covered independently by
 * tests/integration/payment-refund.test.ts).
 */

const initiateRefundMock = vi.fn();

vi.mock("../../server/payment-service", () => ({
  initiateRefund: (...args: any[]) => initiateRefundMock(...args),
  cancelViewerSubscription: vi.fn(),
  confirmCheckoutPayment: vi.fn(),
  createCheckoutOrder: vi.fn(),
  getGatewayStatus: vi.fn(async () => ({ configured: true, enabled: true, gateway: "razorpay", mode: "test", keyId: "x", webhookConfigured: true })),
  getPaymentMethods: vi.fn(),
  getViewerPaymentHistory: vi.fn(),
  handleRazorpayWebhook: vi.fn(),
  listPaymentPlans: vi.fn(),
  listWalletTopups: vi.fn(),
}));

vi.mock("../../server/rate-limit", () => ({
  paymentCreateLimiter: (_req: any, _res: any, next: any) => next(),
  paymentVerifyLimiter: (_req: any, _res: any, next: any) => next(),
  paymentWebhookLimiter: (_req: any, _res: any, next: any) => next(),
  paymentRefundLimiter: (_req: any, _res: any, next: any) => next(),
}));

let currentUser: { id: number; role: string; organizationId?: number | null } = { id: 7, role: "consumer" };
vi.mock("../../server/role-middleware", () => ({
  requireAuth: (req: any, _res: any, next: any) => { req.user = currentUser; next(); },
}));

async function buildApp(): Promise<Express> {
  const { registerPaymentRoutes } = await import("../../server/payment-routes");
  const app = express();
  app.use(express.json());
  registerPaymentRoutes(app);
  return app;
}

beforeEach(() => {
  vi.resetAllMocks();
  currentUser = { id: 7, role: "consumer" };
});

describe("POST /api/payments/:transactionId/refund", () => {
  it("rejects a non-numeric transaction id with 400", async () => {
    const app = await buildApp();
    const res = await request(app).post("/api/payments/not-a-number/refund").send({});
    expect(res.status).toBe(400);
    expect(initiateRefundMock).not.toHaveBeenCalled();
  });

  it("returns 200 with the refund result on success", async () => {
    initiateRefundMock.mockResolvedValue({
      success: true,
      refundId: 1,
      gatewayRefundId: "rfnd_1",
      status: "completed",
      amountPaise: 5000,
      isFullRefund: true,
      transactionStatus: "refunded",
    });
    const app = await buildApp();
    const res = await request(app).post("/api/payments/100/refund").send({ reason: "test" });
    expect(res.status).toBe(200);
    expect(res.body.gatewayRefundId).toBe("rfnd_1");
    expect(initiateRefundMock).toHaveBeenCalledWith(expect.objectContaining({ transactionId: 100, reason: "test" }));
  });

  it("prefers the Idempotency-Key header over a body field", async () => {
    initiateRefundMock.mockResolvedValue({ success: true, refundId: 1, gatewayRefundId: null, status: "processing", amountPaise: 100, isFullRefund: true, transactionStatus: "completed" });
    const app = await buildApp();
    await request(app)
      .post("/api/payments/100/refund")
      .set("Idempotency-Key", "header-key")
      .send({ idempotencyKey: "body-key" });

    expect(initiateRefundMock).toHaveBeenCalledWith(expect.objectContaining({ idempotencyKey: "header-key" }));
  });

  it("maps TRANSACTION_NOT_FOUND to 404", async () => {
    initiateRefundMock.mockRejectedValue(new Error("TRANSACTION_NOT_FOUND"));
    const app = await buildApp();
    const res = await request(app).post("/api/payments/999/refund").send({});
    expect(res.status).toBe(404);
  });

  it("maps UNAUTHORIZED_TRANSACTION to 403", async () => {
    initiateRefundMock.mockRejectedValue(new Error("UNAUTHORIZED_TRANSACTION"));
    const app = await buildApp();
    const res = await request(app).post("/api/payments/100/refund").send({});
    expect(res.status).toBe(403);
  });

  it("maps REFUND_ALREADY_IN_PROGRESS to 409", async () => {
    initiateRefundMock.mockRejectedValue(new Error("REFUND_ALREADY_IN_PROGRESS"));
    const app = await buildApp();
    const res = await request(app).post("/api/payments/100/refund").send({});
    expect(res.status).toBe(409);
  });

  it("maps PAYMENT_GATEWAY_NOT_CONFIGURED to 503", async () => {
    initiateRefundMock.mockRejectedValue(new Error("PAYMENT_GATEWAY_NOT_CONFIGURED"));
    const app = await buildApp();
    const res = await request(app).post("/api/payments/100/refund").send({});
    expect(res.status).toBe(503);
  });

  it("maps REFUND_AMOUNT_EXCEEDS_REMAINING to 400", async () => {
    initiateRefundMock.mockRejectedValue(new Error("REFUND_AMOUNT_EXCEEDS_REMAINING"));
    const app = await buildApp();
    const res = await request(app).post("/api/payments/100/refund").send({ amountPaise: 999999 });
    expect(res.status).toBe(400);
  });

  it("maps REFUND_GATEWAY_ERROR to 502", async () => {
    initiateRefundMock.mockRejectedValue(new Error("REFUND_GATEWAY_ERROR"));
    const app = await buildApp();
    const res = await request(app).post("/api/payments/100/refund").send({});
    expect(res.status).toBe(502);
  });

  it("rejects a negative amountPaise with 400 before ever calling the service", async () => {
    const app = await buildApp();
    const res = await request(app).post("/api/payments/100/refund").send({ amountPaise: -500 });
    expect(res.status).toBe(400);
    expect(initiateRefundMock).not.toHaveBeenCalled();
  });
});
