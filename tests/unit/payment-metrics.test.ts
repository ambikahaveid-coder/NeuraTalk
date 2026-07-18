import { describe, it, expect, beforeEach, vi } from "vitest";
import { recordPaymentCounter, getPaymentMetricsSnapshot, resetPaymentMetrics } from "../../server/payment-metrics";

vi.mock("../../server/observability", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

describe("payment-metrics", () => {
  beforeEach(() => {
    resetPaymentMetrics();
  });

  it("increments a counter and reflects it in the snapshot", () => {
    recordPaymentCounter("orders_created");
    recordPaymentCounter("orders_created");
    expect(getPaymentMetricsSnapshot().counters.orders_created).toBe(2);
  });

  it("computes payment success rate from succeeded/failed counters", () => {
    recordPaymentCounter("payments_succeeded", 3);
    recordPaymentCounter("payments_failed", 1);
    expect(getPaymentMetricsSnapshot().paymentSuccessRate).toBe(0.75);
  });

  it("returns null success rate when there have been no attempts yet", () => {
    expect(getPaymentMetricsSnapshot().paymentSuccessRate).toBeNull();
  });

  it("computes refund success rate independently from payment success rate", () => {
    recordPaymentCounter("refunds_completed", 2);
    recordPaymentCounter("refunds_failed", 2);
    expect(getPaymentMetricsSnapshot().refundSuccessRate).toBe(0.5);
  });

  it("resetPaymentMetrics zeroes every counter", () => {
    recordPaymentCounter("duplicate_attempts", 5);
    resetPaymentMetrics();
    expect(getPaymentMetricsSnapshot().counters.duplicate_attempts).toBe(0);
  });
});
