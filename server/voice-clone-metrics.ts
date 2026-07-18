/**
 * Voice Clone usage metrics — same architecture as
 * server/modules/transcripts/metrics.ts and server/payment-metrics.ts
 * (in-memory counters + EventEmitter, no DB writes on the hot path).
 */
import { EventEmitter } from "events";
import { logger } from "./observability";

export type VoiceCloneCounterMetric =
  | "samples_uploaded"
  | "sample_upload_failed"
  | "samples_deleted"
  | "trainings_started"
  | "training_failed"
  | "profiles_toggled"
  | "moderation_approved"
  | "moderation_rejected"
  | "profiles_deleted_all";

const counters: Record<VoiceCloneCounterMetric, number> = {
  samples_uploaded: 0,
  sample_upload_failed: 0,
  samples_deleted: 0,
  trainings_started: 0,
  training_failed: 0,
  profiles_toggled: 0,
  moderation_approved: 0,
  moderation_rejected: 0,
  profiles_deleted_all: 0,
};

export const voiceCloneMetricsEmitter = new EventEmitter();
voiceCloneMetricsEmitter.setMaxListeners(32);

export function recordVoiceCloneCounter(metric: VoiceCloneCounterMetric, increment = 1): void {
  counters[metric] += increment;
  voiceCloneMetricsEmitter.emit("counter", { metric, value: counters[metric], increment });
  if (metric.endsWith("_failed")) {
    logger.warn("VoiceCloneMetrics", `${metric} incremented`, { total: counters[metric] });
  }
}

export function getVoiceCloneMetricsSnapshot() {
  return { counters: { ...counters } };
}

export function resetVoiceCloneMetrics(): void {
  for (const key of Object.keys(counters) as VoiceCloneCounterMetric[]) {
    counters[key] = 0;
  }
}
