/**
 * PRODUCTION METRICS & HEALTH PROBES
 *
 * Exposes Prometheus-compatible /metrics endpoint and Kubernetes-style
 * health probes (/healthz, /readyz) for production monitoring.
 *
 * Metrics cover:
 * - Active calls and translator bots
 * - Translation pipeline latency (p50/p95/p99)
 * - Billing engine state
 * - Memory and event loop lag
 * - API key usage rates
 * - Error rates by category
 *
 * All metrics are privacy-safe — no PII, no call content.
 */

import type { Express, Request, Response } from "express";
import { timingSafeEqual } from "crypto";
import { metrics, logger } from "./observability";
import { getMetricsSnapshot, getVoiceMetricsSnapshot } from "./modules/calls/metrics";
import { getPipelineMetrics } from "./ultra-pipeline";
import { db } from "./db";
import { sql } from "drizzle-orm";
import { callBillingRecords } from "@shared/schema";
import { getProviderHealthSnapshot } from "./voice-resilience";
import { getResourceSnapshot, getDbLatencySnapshot } from "./reliability-monitor";
import { getHttpMetricsSnapshot } from "./http-metrics-middleware";
import { getPaymentMetricsSnapshot } from "./payment-metrics";
import { getVoiceCloneMetricsSnapshot } from "./voice-clone-metrics";
import { getTranscriptMetricsSnapshot } from "./modules/transcripts/metrics";
import { getIncomingCallQueueDepth } from "./modules/calls/service";

// ─── Event Loop Lag Measurement ───────────────────────────────────
let eventLoopLagMs = 0;
let lastLagCheck = process.hrtime.bigint();

setInterval(() => {
  const now = process.hrtime.bigint();
  const elapsedMs = Number(now - lastLagCheck) / 1_000_000;
  // Interval is 1000ms; lag is how far off we are
  eventLoopLagMs = Math.max(0, elapsedMs - 1000);
  lastLagCheck = now;
}, 1000).unref?.();

// ─── Error Counters ───────────────────────────────────────────────
const errorCounters: Record<string, number> = {};

logger.on("log", (entry: any) => {
  if (entry.level === "error") {
    const component = entry.component || "unknown";
    errorCounters[component] = (errorCounters[component] || 0) + 1;
  }
});

// ─── Prometheus Text Format Helpers ───────────────────────────────
function prometheusLine(name: string, value: number, labels?: Record<string, string>): string {
  if (labels && Object.keys(labels).length > 0) {
    const labelStr = Object.entries(labels)
      .map(([k, v]) => `${k}="${v}"`)
      .join(",");
    return `${name}{${labelStr}} ${value}`;
  }
  return `${name} ${value}`;
}

function prometheusHeader(name: string, help: string, type: string): string {
  return `# HELP ${name} ${help}\n# TYPE ${name} ${type}`;
}

// ─── Access Control ────────────────────────────────────────────────
// /metrics exposes operational data (queue depths, latency, error rates)
// but no PII or call content. It was previously reachable with zero auth.
// Gate it behind a static bearer token (METRICS_TOKEN) — the standard,
// least-disruptive way to protect a Prometheus scrape endpoint, since
// scrapers (Prometheus, Grafana Agent, etc.) authenticate via a static
// token in their scrape config, not a logged-in user session.
//
// Fails safe in the direction of NOT silently locking out an already-wired
// scraper: if METRICS_TOKEN isn't set, the endpoint stays open (matching
// today's behavior) but logs a warning once per process so operators
// notice and configure it. Once set, every request must present it via
// `Authorization: Bearer <token>` or `?token=<token>`.
let warnedMissingMetricsToken = false;

function isAuthorizedMetricsRequest(req: Request): boolean {
  const expected = process.env.METRICS_TOKEN;
  if (!expected) {
    if (!warnedMissingMetricsToken) {
      warnedMissingMetricsToken = true;
      logger.warn("Metrics", "METRICS_TOKEN is not set — /metrics is publicly reachable with no authentication. Set METRICS_TOKEN to restrict access.");
    }
    return true;
  }

  const authHeader = req.headers.authorization;
  const presented = authHeader?.startsWith("Bearer ")
    ? authHeader.slice(7)
    : typeof req.query.token === "string"
      ? req.query.token
      : null;

  if (!presented) return false;

  const expectedBuf = Buffer.from(expected);
  const presentedBuf = Buffer.from(presented);
  if (expectedBuf.length !== presentedBuf.length) return false;
  return timingSafeEqual(expectedBuf, presentedBuf);
}

// ─── Registration ─────────────────────────────────────────────────
export function registerProductionMetrics(app: Express): void {

  /**
   * GET /metrics — Prometheus scrape endpoint
   * Content-Type: text/plain; version=0.04
   */
  app.get("/metrics", async (req: Request, res: Response) => {
    if (!isAuthorizedMetricsRequest(req)) {
      res.status(401).send("# Unauthorized — set Authorization: Bearer <METRICS_TOKEN>\n");
      return;
    }
    try {
      const lines: string[] = [];
      const memUsage = process.memoryUsage();
      const systemHealth = metrics.getSystemHealth();
      const aggregated = metrics.getAggregatedMetrics();
      const pipeline = getPipelineMetrics();
      const [callAggregate] = await db.select({
        total: sql<number>`count(*)`,
        ended: sql<number>`count(*) filter (where ${callBillingRecords.status} in ('completed', 'ended'))`,
        dropped: sql<number>`count(*) filter (where ${callBillingRecords.status} in ('dropped', 'failed'))`,
        avgDurationSeconds: sql<number>`coalesce(avg(greatest(${callBillingRecords.voiceSeconds}, ${callBillingRecords.videoSeconds})), 0)`,
      }).from(callBillingRecords);

      let pipelineSnapshot: any = {};
      let voiceSnapshot: any = {};
      try {
        pipelineSnapshot = getMetricsSnapshot();
        voiceSnapshot = getVoiceMetricsSnapshot();
      } catch { /* metrics module may not be initialized */ }
      const providerHealth = getProviderHealthSnapshot();

      // ── Process Metrics ──
      lines.push(prometheusHeader("neuratalk_process_heap_bytes", "Heap memory used in bytes", "gauge"));
      lines.push(prometheusLine("neuratalk_process_heap_bytes", memUsage.heapUsed));

      lines.push(prometheusHeader("neuratalk_process_heap_total_bytes", "Total heap size in bytes", "gauge"));
      lines.push(prometheusLine("neuratalk_process_heap_total_bytes", memUsage.heapTotal));

      lines.push(prometheusHeader("neuratalk_process_rss_bytes", "RSS memory in bytes", "gauge"));
      lines.push(prometheusLine("neuratalk_process_rss_bytes", memUsage.rss));

      lines.push(prometheusHeader("neuratalk_process_external_bytes", "External memory in bytes", "gauge"));
      lines.push(prometheusLine("neuratalk_process_external_bytes", memUsage.external));

      lines.push(prometheusHeader("neuratalk_event_loop_lag_ms", "Event loop lag in milliseconds", "gauge"));
      lines.push(prometheusLine("neuratalk_event_loop_lag_ms", Math.round(eventLoopLagMs)));

      lines.push(prometheusHeader("neuratalk_uptime_seconds", "Process uptime in seconds", "gauge"));
      lines.push(prometheusLine("neuratalk_uptime_seconds", Math.round(systemHealth.uptime / 1000)));

      // ── CPU / Resource Monitoring ──
      const resourceSnapshot = getResourceSnapshot();
      lines.push(prometheusHeader("neuratalk_process_cpu_percent", "Process CPU usage percent (0-100)", "gauge"));
      lines.push(prometheusLine("neuratalk_process_cpu_percent", resourceSnapshot.cpuPercent));
      lines.push(prometheusHeader("neuratalk_load_average_1m", "System 1-minute load average", "gauge"));
      lines.push(prometheusLine("neuratalk_load_average_1m", Number(resourceSnapshot.loadAverage[0].toFixed(2))));

      // ── API/HTTP Latency ──
      const httpSnapshot = getHttpMetricsSnapshot();
      lines.push(prometheusHeader("neuratalk_http_latency_p50_ms", "HTTP request latency p50", "gauge"));
      lines.push(prometheusLine("neuratalk_http_latency_p50_ms", httpSnapshot.overall.p50));
      lines.push(prometheusLine("neuratalk_http_latency_p95_ms", httpSnapshot.overall.p95));
      lines.push(prometheusLine("neuratalk_http_latency_p99_ms", httpSnapshot.overall.p99));
      lines.push(prometheusHeader("neuratalk_http_error_rate", "HTTP 5xx error rate (0-1)", "gauge"));
      lines.push(prometheusLine("neuratalk_http_error_rate", Number(httpSnapshot.errorRate.toFixed(4))));

      // ── Database Latency ──
      const dbLatency = getDbLatencySnapshot();
      lines.push(prometheusHeader("neuratalk_db_latency_p50_ms", "Instrumented DB query latency p50", "gauge"));
      lines.push(prometheusLine("neuratalk_db_latency_p50_ms", dbLatency.p50));
      lines.push(prometheusLine("neuratalk_db_latency_p95_ms", dbLatency.p95));
      lines.push(prometheusLine("neuratalk_db_latency_p99_ms", dbLatency.p99));
      lines.push(prometheusHeader("neuratalk_db_query_failures_total", "Instrumented DB query failures", "counter"));
      lines.push(prometheusLine("neuratalk_db_query_failures_total", dbLatency.failures));

      // ── Queue Depth ──
      const queueDepth = await getIncomingCallQueueDepth().catch(() => 0);
      lines.push(prometheusHeader("neuratalk_incoming_call_queue_depth", "Pending incoming-call queue entries across all users", "gauge"));
      lines.push(prometheusLine("neuratalk_incoming_call_queue_depth", queueDepth));

      // ── Payment Metrics ──
      const paymentSnapshot = getPaymentMetricsSnapshot();
      lines.push(prometheusHeader("neuratalk_payment_events_total", "Payment lifecycle events by type", "counter"));
      for (const [metric, count] of Object.entries(paymentSnapshot.counters)) {
        lines.push(prometheusLine("neuratalk_payment_events_total", count, { metric }));
      }
      if (paymentSnapshot.paymentSuccessRate != null) {
        lines.push(prometheusHeader("neuratalk_payment_success_rate", "Payment success rate (0-1)", "gauge"));
        lines.push(prometheusLine("neuratalk_payment_success_rate", Number(paymentSnapshot.paymentSuccessRate.toFixed(4))));
      }

      // ── Voice Clone Metrics ──
      const voiceCloneSnapshot = getVoiceCloneMetricsSnapshot();
      lines.push(prometheusHeader("neuratalk_voice_clone_events_total", "Voice clone lifecycle events by type", "counter"));
      for (const [metric, count] of Object.entries(voiceCloneSnapshot.counters)) {
        lines.push(prometheusLine("neuratalk_voice_clone_events_total", count, { metric }));
      }

      // ── Transcript Metrics ──
      const transcriptSnapshot = getTranscriptMetricsSnapshot();
      lines.push(prometheusHeader("neuratalk_transcript_events_total", "Transcript lifecycle events by type", "counter"));
      for (const [metric, count] of Object.entries(transcriptSnapshot.counters)) {
        lines.push(prometheusLine("neuratalk_transcript_events_total", count, { metric }));
      }

      // ── Active Connections ──
      lines.push(prometheusHeader("neuratalk_active_calls", "Number of active calls", "gauge"));
      lines.push(prometheusLine("neuratalk_active_calls", systemHealth.activeConnections));

      lines.push(prometheusHeader("neuratalk_total_calls", "Total calls since startup", "counter"));
      lines.push(prometheusLine("neuratalk_total_calls", aggregated.callCount));

      const totalCallCount = Number(callAggregate?.total ?? 0);
      const endedCallCount = Number(callAggregate?.ended ?? 0);
      const droppedCallCount = Number(callAggregate?.dropped ?? 0);
      const avgDurationSeconds = Number(callAggregate?.avgDurationSeconds ?? 0);

      lines.push(prometheusHeader("neuratalk_call_success_rate", "Ended call success rate (0-1)", "gauge"));
      lines.push(prometheusLine("neuratalk_call_success_rate", totalCallCount > 0 ? endedCallCount / totalCallCount : 0));

      lines.push(prometheusHeader("neuratalk_call_drop_rate", "Dropped or failed call rate (0-1)", "gauge"));
      lines.push(prometheusLine("neuratalk_call_drop_rate", totalCallCount > 0 ? droppedCallCount / totalCallCount : 0));

      lines.push(prometheusHeader("neuratalk_avg_call_duration_seconds", "Average completed call duration in seconds", "gauge"));
      lines.push(prometheusLine("neuratalk_avg_call_duration_seconds", Number(avgDurationSeconds.toFixed(2))));

      // ── Translation Pipeline Latency ──
      lines.push(prometheusHeader("neuratalk_translation_latency_p50_ms", "Translation latency p50", "gauge"));
      lines.push(prometheusLine("neuratalk_translation_latency_p50_ms", aggregated.p50LatencyMs));

      lines.push(prometheusHeader("neuratalk_translation_latency_p95_ms", "Translation latency p95", "gauge"));
      lines.push(prometheusLine("neuratalk_translation_latency_p95_ms", aggregated.p95LatencyMs));

      lines.push(prometheusHeader("neuratalk_translation_latency_p99_ms", "Translation latency p99", "gauge"));
      lines.push(prometheusLine("neuratalk_translation_latency_p99_ms", aggregated.p99LatencyMs));

      // ── Per-Stage Latency (from call metrics ring buffer) ──
      if (pipelineSnapshot) {
        for (const stage of ["stt", "translation", "tts", "ultra", "total"]) {
          const stageData = pipelineSnapshot[stage];
          if (stageData) {
            lines.push(prometheusHeader(`neuratalk_stage_latency_p50_ms`, `Per-stage p50 latency`, "gauge"));
            lines.push(prometheusLine(`neuratalk_stage_latency_p50_ms`, stageData.p50 || 0, { stage }));
            lines.push(prometheusLine(`neuratalk_stage_latency_p95_ms`, stageData.p95 || 0, { stage }));
            lines.push(prometheusLine(`neuratalk_stage_latency_p99_ms`, stageData.p99 || 0, { stage }));
          }
        }
      }

      // ── Ultra Pipeline Cache ──
      lines.push(prometheusHeader("neuratalk_cache_hit_rate", "Ultra pipeline cache hit rate (0-1)", "gauge"));
      lines.push(prometheusLine("neuratalk_cache_hit_rate", pipeline.cacheHitRate));

      lines.push(prometheusHeader("neuratalk_translation_cache_size", "Translation cache entries", "gauge"));
      lines.push(prometheusLine("neuratalk_translation_cache_size", pipeline.translationCacheSize));

      lines.push(prometheusHeader("neuratalk_tts_cache_size", "TTS audio cache entries", "gauge"));
      lines.push(prometheusLine("neuratalk_tts_cache_size", pipeline.ttsCacheSize));

      // ── Quality Metrics ──
      lines.push(prometheusHeader("neuratalk_audio_jitter_avg_ms", "Average audio jitter", "gauge"));
      lines.push(prometheusLine("neuratalk_audio_jitter_avg_ms", aggregated.avgJitterMs));

      lines.push(prometheusHeader("neuratalk_packet_drop_rate", "Packet drop rate (0-1)", "gauge"));
      lines.push(prometheusLine("neuratalk_packet_drop_rate", aggregated.dropRate));

      lines.push(prometheusHeader("neuratalk_degradation_rate", "Degradation rate per call", "gauge"));
      lines.push(prometheusLine("neuratalk_degradation_rate", aggregated.degradationRate));

      lines.push(prometheusHeader("neuratalk_recovery_rate", "Recovery rate after degradation", "gauge"));
      lines.push(prometheusLine("neuratalk_recovery_rate", aggregated.recoveryRate));

      // ── Error Counters ──
      lines.push(prometheusHeader("neuratalk_errors_total", "Total errors by component", "counter"));
      for (const [component, count] of Object.entries(errorCounters)) {
        lines.push(prometheusLine("neuratalk_errors_total", count, { component }));
      }

      // ── Translator Bot Active Sessions ──
      try {
        const { listActiveBots } = await import("./translator-bot");
        const bots = listActiveBots();
        lines.push(prometheusHeader("neuratalk_active_translator_bots", "Active translator bot sessions", "gauge"));
        lines.push(prometheusLine("neuratalk_active_translator_bots", bots.length));
      } catch {
        lines.push(prometheusLine("neuratalk_active_translator_bots", 0));
      }

      if (voiceSnapshot?.transcriptConfidence) {
        lines.push(prometheusHeader("neuratalk_transcript_confidence_p50_pct", "Transcript confidence p50 percent", "gauge"));
        lines.push(prometheusLine("neuratalk_transcript_confidence_p50_pct", voiceSnapshot.transcriptConfidence.p50 || 0));
        lines.push(prometheusLine("neuratalk_transcript_confidence_p95_pct", voiceSnapshot.transcriptConfidence.p95 || 0));
        lines.push(prometheusLine("neuratalk_transcript_confidence_p99_pct", voiceSnapshot.transcriptConfidence.p99 || 0));

        lines.push(prometheusHeader("neuratalk_reconnect_recovery_p50_ms", "Reconnect recovery p50 latency", "gauge"));
        lines.push(prometheusLine("neuratalk_reconnect_recovery_p50_ms", voiceSnapshot.reconnectRecoveryMs?.p50 || 0));
        lines.push(prometheusLine("neuratalk_reconnect_recovery_p95_ms", voiceSnapshot.reconnectRecoveryMs?.p95 || 0));
        lines.push(prometheusLine("neuratalk_reconnect_recovery_p99_ms", voiceSnapshot.reconnectRecoveryMs?.p99 || 0));

        lines.push(prometheusHeader("neuratalk_interruption_recovery_p50_ms", "Interruption recovery p50 latency", "gauge"));
        lines.push(prometheusLine("neuratalk_interruption_recovery_p50_ms", voiceSnapshot.interruptionRecoveryMs?.p50 || 0));
        lines.push(prometheusLine("neuratalk_interruption_recovery_p95_ms", voiceSnapshot.interruptionRecoveryMs?.p95 || 0));
        lines.push(prometheusLine("neuratalk_interruption_recovery_p99_ms", voiceSnapshot.interruptionRecoveryMs?.p99 || 0));

        lines.push(prometheusHeader("neuratalk_voice_signal_rate", "Derived realtime voice signal rates", "gauge"));
        lines.push(prometheusLine("neuratalk_voice_signal_rate", voiceSnapshot.rates?.duplicateTurnRate || 0, { metric: "duplicate_turn" }));
        lines.push(prometheusLine("neuratalk_voice_signal_rate", voiceSnapshot.rates?.staleTranscriptRate || 0, { metric: "stale_transcript" }));
        lines.push(prometheusLine("neuratalk_voice_signal_rate", voiceSnapshot.rates?.transcriptRegressionRate || 0, { metric: "transcript_regression" }));
        lines.push(prometheusLine("neuratalk_voice_signal_rate", voiceSnapshot.rates?.overlapRate || 0, { metric: "overlap" }));
        lines.push(prometheusLine("neuratalk_voice_signal_rate", voiceSnapshot.rates?.reconnectRecoveryRate || 0, { metric: "reconnect_recovery" }));
        lines.push(prometheusLine("neuratalk_voice_signal_rate", voiceSnapshot.rates?.confidenceCoverageRate || 0, { metric: "confidence_coverage" }));

        lines.push(prometheusHeader("neuratalk_voice_signal_total", "Realtime voice signal counters", "counter"));
        for (const [metric, count] of Object.entries(voiceSnapshot.counters || {})) {
          lines.push(prometheusLine("neuratalk_voice_signal_total", Number(count || 0), { metric }));
        }
      }

      lines.push(prometheusHeader("neuratalk_provider_health_score", "Provider health score (0-100)", "gauge"));
      lines.push(prometheusHeader("neuratalk_provider_circuit_open", "Provider circuit breaker open state", "gauge"));
      for (const provider of providerHealth) {
        lines.push(prometheusLine("neuratalk_provider_health_score", provider.score, { provider: provider.provider, state: provider.state }));
        lines.push(prometheusLine("neuratalk_provider_circuit_open", provider.state === "open" ? 1 : 0, { provider: provider.provider }));
      }

      res.setHeader("Content-Type", "text/plain; version=0.0.4; charset=utf-8");
      res.send(lines.join("\n") + "\n");
    } catch (error) {
      logger.error("Metrics", "Failed to generate metrics", error instanceof Error ? error : new Error(String(error)));
      res.status(500).send("# Error generating metrics\n");
    }
  });

  logger.info("ProductionMetrics", "/metrics registered (/healthz, /readyz handled by production-routes)");
}
