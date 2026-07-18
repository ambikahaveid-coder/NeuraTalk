import { logger } from "./observability";
import { purgeExpiredTranscripts } from "./modules/transcripts/service";
import { recordRetentionSweepResult, recordRetentionSweepFailure } from "./modules/transcripts/metrics";
import { runWithTrace } from "./request-context";

/**
 * Automated Data Retention & Compliance Job (Founder's Roadmap)
 * Runs daily to purge old call logs and translations.
 *
 * Retention window is per-user (callConsents.dataRetention) rather than a
 * single hard-coded 30-day global policy — see purgeExpiredTranscripts in
 * server/modules/transcripts/service.ts for the exact per-tier semantics.
 */
export async function runDataRetentionCleanup() {
  return runWithTrace("transcript", `retention-sweep:${new Date().toISOString()}`, runDataRetentionCleanupTraced);
}

async function runDataRetentionCleanupTraced() {
  const startTime = Date.now();
  logger.info("Cleanup", "Starting automated data retention sweep...");

  try {
    const { purgedCalls, purgedSegments } = await purgeExpiredTranscripts();
    recordRetentionSweepResult({ purgedCalls, purgedSegments });
    const duration = Date.now() - startTime;
    logger.info("Cleanup", `Data retention sweep complete. Purged ${purgedCalls} calls, ${purgedSegments} transcript segments.`, { durationMs: duration });
  } catch (error) {
    const normalized = error instanceof Error ? error : new Error(String(error));
    const pgCode = (error as { code?: string } | null)?.code;
    if (pgCode === "42P01") {
      logger.warn("Cleanup", "Skipping data retention sweep because legacy cleanup tables are not present");
      return;
    }
    recordRetentionSweepFailure(normalized.message);
    logger.error("Cleanup", "CRITICAL: Data retention job failed", normalized);
  }
}

/**
 * Initialize the cleanup scheduler
 * In a real production environment, this would be a separate K8s CronJob or similar.
 */
export function startCleanupScheduler() {
  // Run once on startup
  runDataRetentionCleanup();

  // Schedule to run every 24 hours
  setInterval(runDataRetentionCleanup, 24 * 60 * 60 * 1000);
  
  logger.info("System", "Data retention scheduler initialized (24h interval)");
}
