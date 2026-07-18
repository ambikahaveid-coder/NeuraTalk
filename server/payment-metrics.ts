/**
 * Payment system metrics — same architecture as
 * server/modules/transcripts/metrics.ts and server/modules/calls/metrics.ts
 * (in-memory counters + EventEmitter for live observers, no DB writes on
 * the hot path).
 */
import { EventEmitter } from "events";
import { logger } from "./observability";

export type PaymentCounterMetric =
  | "orders_created"
  | "orders_failed"
  | "verifications_succeeded"
  | "verifications_failed"
  | "signature_failures"
  | "payments_succeeded"
  | "payments_failed"
  | "duplicate_attempts"
  | "refunds_requested"
  | "refunds_completed"
  | "refunds_failed"
  | "webhook_signature_failures";

const counters: Record<PaymentCounterMetric, number> = {
  orders_created: 0,
  orders_failed: 0,
  verifications_succeeded: 0,
  verifications_failed: 0,
  signature_failures: 0,
  payments_succeeded: 0,
  payments_failed: 0,
  duplicate_attempts: 0,
  refunds_requested: 0,
  refunds_completed: 0,
  refunds_failed: 0,
  webhook_signature_failures: 0,
};

export const paymentMetricsEmitter = new EventEmitter();
paymentMetricsEmitter.setMaxListeners(32);

export function recordPaymentCounter(metric: PaymentCounterMetric, increment = 1): void {
  counters[metric] += increment;
  paymentMetricsEmitter.emit("counter", { metric, value: counters[metric], increment });
  // Failure-class metrics also get a structured log line — the same
  // log-based "failure alert" hook used by the transcript/calls metrics
  // modules, so Sentry (when configured) or a log-based alert rule picks
  // these up without a separate alerting integration.
  if (metric.endsWith("_failed") || metric.endsWith("failures")) {
    logger.warn("PaymentMetrics", `${metric} incremented`, { total: counters[metric] });
  }
}

export function getPaymentMetricsSnapshot() {
  const totalPaymentAttempts = counters.payments_succeeded + counters.payments_failed;
  const totalRefundAttempts = counters.refunds_completed + counters.refunds_failed;
  return {
    counters: { ...counters },
    paymentSuccessRate: totalPaymentAttempts > 0 ? counters.payments_succeeded / totalPaymentAttempts : null,
    refundSuccessRate: totalRefundAttempts > 0 ? counters.refunds_completed / totalRefundAttempts : null,
  };
}

export function resetPaymentMetrics(): void {
  for (const key of Object.keys(counters) as PaymentCounterMetric[]) {
    counters[key] = 0;
  }
}
