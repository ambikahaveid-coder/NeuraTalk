import type { Request, Response, NextFunction } from "express";

/**
 * Per-route HTTP latency histogram (p50/p95/p99) and request counters,
 * exposed via /metrics (server/production-metrics.ts). In-memory ring
 * buffer, same pattern as the existing call/translation latency tracking in
 * server/observability.ts — no external APM agent required.
 */

const MAX_SAMPLES_PER_ROUTE = 500;
const latencySamplesByRoute = new Map<string, number[]>();
const requestCountsByRouteStatus = new Map<string, number>();

function routeLabel(req: Request): string {
  // req.route is only populated once Express matches a route — falls back
  // to the raw path for 404s/unmatched requests so those aren't lost.
  const path = req.route?.path ?? req.path ?? "unknown";
  return `${req.method} ${path}`;
}

export function httpMetricsMiddleware(req: Request, res: Response, next: NextFunction): void {
  const startedAt = process.hrtime.bigint();

  res.on("finish", () => {
    const elapsedMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
    const route = routeLabel(req);

    const samples = latencySamplesByRoute.get(route) ?? [];
    samples.push(elapsedMs);
    if (samples.length > MAX_SAMPLES_PER_ROUTE) samples.shift();
    latencySamplesByRoute.set(route, samples);

    const statusKey = `${route}::${res.statusCode}`;
    requestCountsByRouteStatus.set(statusKey, (requestCountsByRouteStatus.get(statusKey) ?? 0) + 1);
  });

  next();
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, index)];
}

export interface HttpMetricsSnapshot {
  overall: { p50: number; p95: number; p99: number; count: number };
  byRoute: Array<{ route: string; p50: number; p95: number; p99: number; count: number }>;
  requestCounts: Array<{ route: string; status: number; count: number }>;
  errorRate: number;
}

export function getHttpMetricsSnapshot(): HttpMetricsSnapshot {
  const allSamples: number[] = [];
  const byRoute: HttpMetricsSnapshot["byRoute"] = [];

  for (const [route, samples] of Array.from(latencySamplesByRoute.entries())) {
    const sorted = [...samples].sort((a, b) => a - b);
    allSamples.push(...samples);
    byRoute.push({
      route,
      p50: Math.round(percentile(sorted, 50)),
      p95: Math.round(percentile(sorted, 95)),
      p99: Math.round(percentile(sorted, 99)),
      count: samples.length,
    });
  }

  const overallSorted = [...allSamples].sort((a, b) => a - b);

  let totalRequests = 0;
  let errorRequests = 0;
  const requestCounts: HttpMetricsSnapshot["requestCounts"] = [];
  for (const [key, count] of Array.from(requestCountsByRouteStatus.entries())) {
    const [route, statusStr] = key.split("::");
    const status = Number(statusStr);
    requestCounts.push({ route, status, count });
    totalRequests += count;
    if (status >= 500) errorRequests += count;
  }

  return {
    overall: {
      p50: Math.round(percentile(overallSorted, 50)),
      p95: Math.round(percentile(overallSorted, 95)),
      p99: Math.round(percentile(overallSorted, 99)),
      count: allSamples.length,
    },
    byRoute,
    requestCounts,
    errorRate: totalRequests > 0 ? errorRequests / totalRequests : 0,
  };
}

export function resetHttpMetrics(): void {
  latencySamplesByRoute.clear();
  requestCountsByRouteStatus.clear();
}
