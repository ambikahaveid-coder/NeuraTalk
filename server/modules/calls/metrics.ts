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
export type VoiceLatencyMetric = "reconnect_recovery_ms" | "interruption_recovery_ms";
export type VoiceCounterMetric =
  | "transcript_events"
  | "transcript_finals"
  | "transcript_confidence_samples"
  | "transcript_confidence_missing"
  | "transcript_regressions"
  | "translation_fallbacks"
  | "stale_tts_segments"
  | "duplicate_turns"
  | "audio_backlog_events"
  | "ghost_audio_drops"
  | "turn_order_mismatches"
  | "stale_transcripts"
  | "overlap_events"
  | "reconnect_started"
  | "reconnect_recovered";

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

const voiceLatencyBuffers: Record<VoiceLatencyMetric, number[]> = {
  reconnect_recovery_ms: [],
  interruption_recovery_ms: [],
};

const voiceCounters: Record<VoiceCounterMetric, number> = {
  transcript_events: 0,
  transcript_finals: 0,
  transcript_confidence_samples: 0,
  transcript_confidence_missing: 0,
  transcript_regressions: 0,
  translation_fallbacks: 0,
  stale_tts_segments: 0,
  duplicate_turns: 0,
  audio_backlog_events: 0,
  ghost_audio_drops: 0,
  turn_order_mismatches: 0,
  stale_transcripts: 0,
  overlap_events: 0,
  reconnect_started: 0,
  reconnect_recovered: 0,
};

const transcriptConfidenceSamples: number[] = [];

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

export interface VoiceMetricsSnapshot {
  counters: Record<VoiceCounterMetric, number>;
  rates: {
    duplicateTurnRate: number;
    staleTranscriptRate: number;
    transcriptRegressionRate: number;
    overlapRate: number;
    reconnectRecoveryRate: number;
    confidenceCoverageRate: number;
  };
  transcriptConfidence: StageStats;
  reconnectRecoveryMs: StageStats;
  interruptionRecoveryMs: StageStats;
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

export function recordVoiceCounter(metric: VoiceCounterMetric, increment = 1): void {
  if (!Number.isFinite(increment) || increment <= 0) return;
  voiceCounters[metric] += increment;
}

export function recordVoiceLatency(metric: VoiceLatencyMetric, latencyMs: number): void {
  if (!Number.isFinite(latencyMs) || latencyMs < 0) return;
  const buf = voiceLatencyBuffers[metric];
  buf.push(latencyMs);
  if (buf.length > WINDOW_SIZE) buf.shift();
}

export function recordTranscriptObservation(opts: {
  isFinal: boolean;
  confidence?: number | null;
  stale?: boolean;
}): void {
  recordVoiceCounter("transcript_events");
  if (opts.isFinal) {
    recordVoiceCounter("transcript_finals");
  }
  if (opts.stale) {
    recordVoiceCounter("stale_transcripts");
  }
  if (typeof opts.confidence === "number" && Number.isFinite(opts.confidence)) {
    transcriptConfidenceSamples.push(opts.confidence * 100);
    if (transcriptConfidenceSamples.length > WINDOW_SIZE) transcriptConfidenceSamples.shift();
    recordVoiceCounter("transcript_confidence_samples");
  } else {
    recordVoiceCounter("transcript_confidence_missing");
  }
}

export function getVoiceMetricsSnapshot(): VoiceMetricsSnapshot {
  const transcriptEvents = voiceCounters.transcript_events || 0;
  const transcriptFinals = voiceCounters.transcript_finals || 0;
  const reconnectStarted = voiceCounters.reconnect_started || 0;
  const reconnectRecovered = voiceCounters.reconnect_recovered || 0;

  return {
    counters: { ...voiceCounters },
    rates: {
      duplicateTurnRate: transcriptFinals > 0 ? Number((voiceCounters.duplicate_turns / transcriptFinals).toFixed(4)) : 0,
      staleTranscriptRate: transcriptFinals > 0 ? Number((voiceCounters.stale_transcripts / transcriptFinals).toFixed(4)) : 0,
      transcriptRegressionRate: transcriptEvents > 0 ? Number((voiceCounters.transcript_regressions / transcriptEvents).toFixed(4)) : 0,
      overlapRate: transcriptEvents > 0 ? Number((voiceCounters.overlap_events / transcriptEvents).toFixed(4)) : 0,
      reconnectRecoveryRate: reconnectStarted > 0 ? Number((reconnectRecovered / reconnectStarted).toFixed(4)) : 0,
      confidenceCoverageRate: transcriptEvents > 0 ? Number((voiceCounters.transcript_confidence_samples / transcriptEvents).toFixed(4)) : 0,
    },
    transcriptConfidence: statsForBuffer(transcriptConfidenceSamples),
    reconnectRecoveryMs: statsForBuffer(voiceLatencyBuffers.reconnect_recovery_ms),
    interruptionRecoveryMs: statsForBuffer(voiceLatencyBuffers.interruption_recovery_ms),
  };
}

export function resetMetrics(): void {
  for (const key of Object.keys(buffers) as PipelineStage[]) {
    buffers[key].length = 0;
  }
  for (const key of Object.keys(voiceLatencyBuffers) as VoiceLatencyMetric[]) {
    voiceLatencyBuffers[key].length = 0;
  }
  for (const key of Object.keys(voiceCounters) as VoiceCounterMetric[]) {
    voiceCounters[key] = 0;
  }
  transcriptConfidenceSamples.length = 0;
}

function statsForBuffer(values: number[]): StageStats {
  const copy = values.slice().sort((a, b) => a - b);
  return {
    count: copy.length,
    p50: percentile(copy, 50),
    p95: percentile(copy, 95),
    p99: percentile(copy, 99),
  };
}
