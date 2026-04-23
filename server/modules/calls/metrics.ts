/**
 * Call pipeline metrics — rolling window of per-stage latencies.
 *
 * Design:
 *   - Fire-and-forget: `recordStageLatency` is synchronous-cheap (array push + emit);
 *     callers must not await its effects.
 *   - Bounded memory: each stage keeps a ring buffer of WINDOW_SIZE samples.
 *   - Observers subscribe via EventEmitter; admin-monitor broadcasts to admin WS.
 *   - No DB writes, no network I/O on the hot path.
 */

import { EventEmitter } from "events";
import { logger } from "../../observability";

export type PipelineStage = "stt" | "translation" | "tts" | "ultra" | "total";

export interface StageLatencyEvent {
  callId: string;
  stage: PipelineStage;
  latency_ms: number;
  timestamp: number;
}

const WINDOW_SIZE = 1000;

const buffers: Record<PipelineStage, number[]> = {
  stt: [],
  translation: [],
  tts: [],
  ultra: [],
  total: [],
};

export const metricsEmitter = new EventEmitter();
metricsEmitter.setMaxListeners(32);

export function recordStageLatency(callId: string | number, stage: PipelineStage, latencyMs: number): void {
  if (!Number.isFinite(latencyMs) || latencyMs < 0) return;
  const buf = buffers[stage];
  buf.push(latencyMs);
  if (buf.length > WINDOW_SIZE) buf.shift();

  const event: StageLatencyEvent = {
    callId: String(callId),
    stage,
    latency_ms: Math.round(latencyMs),
    timestamp: Date.now(),
  };

  // Structured log line — machine-readable.
  try {
    console.log(JSON.stringify({ type: "pipeline_latency", ...event }));
  } catch {
    // ignore
  }

  logger.info("RealtimePipeline", `${stage}_latency`, event as unknown as Record<string, unknown>);

  // Notify any listeners (e.g., admin-monitor). Listeners must be non-blocking.
  try {
    metricsEmitter.emit("stage_latency", event);
  } catch {
    // ignore listener errors — never fail the pipeline
  }
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return Math.round(sorted[idx]);
}

export interface StageStats {
  count: number;
  p50: number;
  p95: number;
  p99: number;
}

export interface MetricsSnapshot {
  windowSize: number;
  stt: StageStats;
  translation: StageStats;
  tts: StageStats;
  ultra: StageStats;
  total: StageStats;
}

function statsFor(stage: PipelineStage): StageStats {
  const copy = buffers[stage].slice().sort((a, b) => a - b);
  return {
    count: copy.length,
    p50: percentile(copy, 50),
    p95: percentile(copy, 95),
    p99: percentile(copy, 99),
  };
}

export function getMetricsSnapshot(): MetricsSnapshot {
  return {
    windowSize: WINDOW_SIZE,
    stt: statsFor("stt"),
    translation: statsFor("translation"),
    tts: statsFor("tts"),
    ultra: statsFor("ultra"),
    total: statsFor("total"),
  };
}

export function resetMetrics(): void {
  for (const key of Object.keys(buffers) as PipelineStage[]) {
    buffers[key].length = 0;
  }
}
