/**
 * PSTN Health Monitor
 *
 * Exposes metrics for:
 *   - Provider health (latency, reachability)
 *   - Call success rates (outbound, inbound)
 *   - Setup latency p50/p95
 *   - Provider failures and failover activations
 *   - Dropped calls and 504-causing timeouts
 *
 * Called by the health-check scheduler every 60s.
 * Metrics stored in Redis counters (1-hour windows).
 */

import { checkProviderHealth, getPSTNStatus } from "./registry";
import { getRedisClient } from "../redis";
import { logger } from "../observability";

const WINDOW_SECONDS = 3600;

function windowKey(metric: string): string {
  const windowId = Math.floor(Date.now() / (WINDOW_SECONDS * 1000));
  return `pstn:metrics:${windowId}:${metric}`;
}

export async function recordCallOutcome(outcome: {
  callId: string;
  success: boolean;
  provider: string;
  setupLatencyMs?: number;
  durationSeconds?: number;
  failureReason?: string;
}): Promise<void> {
  const redis = getRedisClient();
  const multi = redis.multi();
  const wk = windowKey;

  multi.incr(wk("calls_total"));
  multi.expire(wk("calls_total"), WINDOW_SECONDS * 2);

  if (outcome.success) {
    multi.incr(wk("calls_success"));
    multi.expire(wk("calls_success"), WINDOW_SECONDS * 2);
  } else {
    multi.incr(wk("calls_failed"));
    multi.expire(wk("calls_failed"), WINDOW_SECONDS * 2);
    if (outcome.failureReason) {
      const reasonKey = wk(`fail:${outcome.failureReason.slice(0, 40)}`);
      multi.incr(reasonKey);
      multi.expire(reasonKey, WINDOW_SECONDS * 2);
    }
  }

  if (outcome.setupLatencyMs !== undefined) {
    multi.rpush(wk("setup_latency_ms"), String(outcome.setupLatencyMs));
    multi.expire(wk("setup_latency_ms"), WINDOW_SECONDS * 2);
  }

  try {
    await multi.exec();
  } catch (err) {
    logger.warn("PSTNMonitor", `Failed to record call outcome: ${String(err)}`);
  }
}

export async function recordProviderFailover(from: string, to: string): Promise<void> {
  const redis = getRedisClient();
  try {
    await redis.multi()
      .incr(windowKey("failover_activations"))
      .expire(windowKey("failover_activations"), WINDOW_SECONDS * 2)
      .rpush("pstn:failover_log", JSON.stringify({ from, to, at: new Date().toISOString() }))
      .ltrim("pstn:failover_log", -100, -1)
      .exec();
  } catch (err) {
    logger.warn("PSTNMonitor", `Failed to record failover: ${String(err)}`);
  }
}

async function percentile(values: number[], p: number): Promise<number> {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

export async function getPSTNMetrics(): Promise<{
  providerStatus: Awaited<ReturnType<typeof checkProviderHealth>>;
  config: ReturnType<typeof getPSTNStatus>;
  windowSeconds: number;
  callsTotal: number;
  callsSuccess: number;
  callsFailed: number;
  successRate: number;
  setupLatencyP50Ms: number;
  setupLatencyP95Ms: number;
  failoverActivations: number;
  failoverLog: Array<{ from: string; to: string; at: string }>;
}> {
  const redis = getRedisClient();

  let providerStatus: Awaited<ReturnType<typeof checkProviderHealth>>;
  try {
    providerStatus = await checkProviderHealth();
  } catch (err) {
    logger.warn("PSTNMonitor", `Health check failed: ${String(err)}`);
    providerStatus = {
      primary: { name: "unknown", healthy: false, message: String(err) },
      usingFailover: false,
    };
  }

  const get = async (key: string): Promise<number> => {
    try {
      const v = await redis.get(windowKey(key));
      return v ? parseInt(v, 10) : 0;
    } catch {
      return 0;
    }
  };

  const [callsTotal, callsSuccess, callsFailed, failoverActivations] = await Promise.all([
    get("calls_total"),
    get("calls_success"),
    get("calls_failed"),
    get("failover_activations"),
  ]);

  let latencyValues: number[] = [];
  try {
    const raw = await redis.lrange(windowKey("setup_latency_ms"), 0, -1);
    latencyValues = raw.map(Number).filter((n) => Number.isFinite(n));
  } catch {
    latencyValues = [];
  }

  let failoverLog: Array<{ from: string; to: string; at: string }> = [];
  try {
    const raw = await redis.lrange("pstn:failover_log", -20, -1);
    failoverLog = raw.flatMap((r) => {
      try { return [JSON.parse(r)]; } catch { return []; }
    });
  } catch {
    failoverLog = [];
  }

  const successRate = callsTotal > 0 ? Math.round((callsSuccess / callsTotal) * 10000) / 100 : 100;

  return {
    providerStatus,
    config: getPSTNStatus(),
    windowSeconds: WINDOW_SECONDS,
    callsTotal,
    callsSuccess,
    callsFailed,
    successRate,
    setupLatencyP50Ms: await percentile(latencyValues, 50),
    setupLatencyP95Ms: await percentile(latencyValues, 95),
    failoverActivations,
    failoverLog,
  };
}

/**
 * Run a scheduled health check and log the result.
 * Safe to call from a setInterval.
 */
export async function runScheduledHealthCheck(): Promise<void> {
  try {
    const { providerStatus, successRate, setupLatencyP95Ms } = await getPSTNMetrics();
    logger.info("PSTNMonitor", "health_check", {
      primary: providerStatus.primary,
      failover: providerStatus.failover ?? null,
      usingFailover: providerStatus.usingFailover,
      successRate,
      setupLatencyP95Ms,
    });
  } catch (err) {
    logger.warn("PSTNMonitor", `Scheduled health check failed: ${String(err)}`);
  }
}
