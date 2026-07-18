/**
 * Self-hosted resource monitoring + threshold-based alerting — CPU/memory
 * sampling and DB query latency, with no external agent (Datadog/New
 * Relic) required. Alerts are emitted as logger.error/warn calls, which
 * already cascade to Sentry when SENTRY_DSN is configured (see
 * server/observability.ts) — this is the same log-based alerting pattern
 * already used by the transcripts/payments/voice-clone metrics modules,
 * not a second alerting mechanism.
 */
import os from "os";
import { logger } from "./observability";

const MEMORY_ALERT_THRESHOLD_RATIO = Number(process.env.MEMORY_ALERT_THRESHOLD_RATIO ?? "0.90"); // heapUsed/heapTotal
const CPU_ALERT_THRESHOLD_PCT = Number(process.env.CPU_ALERT_THRESHOLD_PCT ?? "85");
const SAMPLE_INTERVAL_MS = 15_000;
const ALERT_COOLDOWN_MS = 60_000; // don't spam an alert every 15s while sustained

let lastCpuUsage = process.cpuUsage();
let lastCpuSampleAt = Date.now();
let currentCpuPercent = 0;
let lastMemoryAlertAt = 0;
let lastCpuAlertAt = 0;

function sample(): void {
  const now = Date.now();
  const elapsedMs = now - lastCpuSampleAt;
  const usage = process.cpuUsage(lastCpuUsage);
  lastCpuUsage = process.cpuUsage();
  lastCpuSampleAt = now;

  // usage.user/system are microseconds consumed across ALL cores during
  // elapsedMs — normalize against (cores * elapsedMs) for a 0-100% figure
  // comparable to `top`'s per-process CPU%.
  const cores = Math.max(1, os.cpus().length);
  const consumedMs = (usage.user + usage.system) / 1000;
  currentCpuPercent = elapsedMs > 0 ? Math.min(100, (consumedMs / (elapsedMs * cores)) * 100) : 0;

  const mem = process.memoryUsage();
  const heapRatio = mem.heapTotal > 0 ? mem.heapUsed / mem.heapTotal : 0;

  if (heapRatio >= MEMORY_ALERT_THRESHOLD_RATIO && now - lastMemoryAlertAt > ALERT_COOLDOWN_MS) {
    lastMemoryAlertAt = now;
    logger.error("ReliabilityMonitor", `High memory usage: heap ${(heapRatio * 100).toFixed(1)}% of allocated`, undefined, {
      heapUsedMb: Math.round(mem.heapUsed / 1024 / 1024),
      heapTotalMb: Math.round(mem.heapTotal / 1024 / 1024),
      rssMb: Math.round(mem.rss / 1024 / 1024),
    });
  }

  if (currentCpuPercent >= CPU_ALERT_THRESHOLD_PCT && now - lastCpuAlertAt > ALERT_COOLDOWN_MS) {
    lastCpuAlertAt = now;
    logger.error("ReliabilityMonitor", `High CPU usage: ${currentCpuPercent.toFixed(1)}%`, undefined, {
      cpuPercent: Number(currentCpuPercent.toFixed(1)),
      cores,
    });
  }
}

let started = false;
export function startReliabilityMonitor(): void {
  if (started) return;
  started = true;
  setInterval(sample, SAMPLE_INTERVAL_MS).unref?.();
}

export function getResourceSnapshot() {
  const mem = process.memoryUsage();
  return {
    cpuPercent: Number(currentCpuPercent.toFixed(1)),
    memory: {
      heapUsedMb: Math.round(mem.heapUsed / 1024 / 1024),
      heapTotalMb: Math.round(mem.heapTotal / 1024 / 1024),
      rssMb: Math.round(mem.rss / 1024 / 1024),
      heapRatio: mem.heapTotal > 0 ? Number((mem.heapUsed / mem.heapTotal).toFixed(3)) : 0,
    },
    loadAverage: os.loadavg(),
  };
}

// ─── DB query latency (lightweight, opt-in wrapper) ────────────────────
const DB_LATENCY_MAX_SAMPLES = 500;
const dbLatencySamples: number[] = [];
let dbQueryFailures = 0;

export async function timedDbQuery<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const startedAt = process.hrtime.bigint();
  try {
    const result = await fn();
    const elapsedMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
    dbLatencySamples.push(elapsedMs);
    if (dbLatencySamples.length > DB_LATENCY_MAX_SAMPLES) dbLatencySamples.shift();
    if (elapsedMs > 1000) {
      logger.warn("ReliabilityMonitor", `Slow DB query: ${label} took ${elapsedMs.toFixed(0)}ms`);
    }
    return result;
  } catch (error) {
    dbQueryFailures++;
    logger.error("ReliabilityMonitor", `DB query failed: ${label}`, error instanceof Error ? error : new Error(String(error)));
    throw error;
  }
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, index)];
}

export function getDbLatencySnapshot() {
  const sorted = [...dbLatencySamples].sort((a, b) => a - b);
  return {
    p50: Math.round(percentile(sorted, 50)),
    p95: Math.round(percentile(sorted, 95)),
    p99: Math.round(percentile(sorted, 99)),
    count: dbLatencySamples.length,
    failures: dbQueryFailures,
  };
}
