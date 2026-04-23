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
import { metrics, logger } from "./observability";
import { getMetricsSnapshot } from "./modules/calls/metrics";
import { getPipelineMetrics } from "./ultra-pipeline";
import { db } from "./db";
import { sql } from "drizzle-orm";
import { callBillingRecords } from "@shared/schema";

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

// ─── Registration ─────────────────────────────────────────────────
export function registerProductionMetrics(app: Express): void {

  /**
   * GET /metrics — Prometheus scrape endpoint
   * Content-Type: text/plain; version=0.04
   */
  app.get("/metrics", async (_req: Request, res: Response) => {
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
      try {
        pipelineSnapshot = getMetricsSnapshot();
      } catch { /* metrics module may not be initialized */ }

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

      res.setHeader("Content-Type", "text/plain; version=0.0.4; charset=utf-8");
      res.send(lines.join("\n") + "\n");
    } catch (error) {
      logger.error("Metrics", "Failed to generate metrics", error instanceof Error ? error : new Error(String(error)));
      res.status(500).send("# Error generating metrics\n");
    }
  });

  console.log("[ProductionMetrics] /metrics registered (/healthz, /readyz handled by production-routes)");
}
