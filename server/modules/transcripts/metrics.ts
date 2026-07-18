/**
 * Transcript system metrics — same architecture as
 * server/modules/calls/metrics.ts (in-memory counters + EventEmitter for
 * live observers, no DB writes on the hot path), scoped to this module
 * rather than added to that file's closed VoiceCounterMetric union, which
 * is specific to the voice pipeline.
 */
import { EventEmitter } from "events";
import { logger } from "../../observability";

export type TranscriptCounterMetric =
  | "segments_persisted"
  | "segments_persist_failed"
  | "exports_txt"
  | "exports_pdf"
  | "exports_docx"
  | "exports_failed"
  | "searches"
  | "search_failed"
  | "deletions"
  | "retention_sweeps"
  | "retention_sweep_failed";

const counters: Record<TranscriptCounterMetric, number> = {
  segments_persisted: 0,
  segments_persist_failed: 0,
  exports_txt: 0,
  exports_pdf: 0,
  exports_docx: 0,
  exports_failed: 0,
  searches: 0,
  search_failed: 0,
  deletions: 0,
  retention_sweeps: 0,
  retention_sweep_failed: 0,
};

let lastRetentionSweep: { at: string; purgedCalls: number; purgedSegments: number } | null = null;
let lastRetentionFailure: { at: string; error: string } | null = null;

export const transcriptMetricsEmitter = new EventEmitter();
transcriptMetricsEmitter.setMaxListeners(32);

export function recordTranscriptCounter(metric: TranscriptCounterMetric, increment = 1): void {
  counters[metric] += increment;
  transcriptMetricsEmitter.emit("counter", { metric, value: counters[metric], increment });
  // Failure-class metrics also get a structured log line — this is the
  // "failure alert" hook: anything scraping/alerting on logs (Sentry,
  // a log-based alert rule) picks these up without needing a separate
  // alerting integration built for this pass.
  if (metric.endsWith("_failed")) {
    logger.warn("TranscriptMetrics", `${metric} incremented`, { total: counters[metric] });
  }
}

export function recordRetentionSweepResult(result: { purgedCalls: number; purgedSegments: number }): void {
  lastRetentionSweep = { at: new Date().toISOString(), ...result };
  recordTranscriptCounter("retention_sweeps");
}

export function recordRetentionSweepFailure(error: string): void {
  lastRetentionFailure = { at: new Date().toISOString(), error };
  recordTranscriptCounter("retention_sweep_failed");
  logger.error("TranscriptMetrics", `Retention sweep failed: ${error}`);
}

export function getTranscriptMetricsSnapshot() {
  return {
    counters: { ...counters },
    lastRetentionSweep,
    lastRetentionFailure,
  };
}

export function resetTranscriptMetrics(): void {
  for (const key of Object.keys(counters) as TranscriptCounterMetric[]) {
    counters[key] = 0;
  }
  lastRetentionSweep = null;
  lastRetentionFailure = null;
}
