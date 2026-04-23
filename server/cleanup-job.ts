import { db } from "./db";
import { organizations, bridgedCalls, callTranslations } from "@shared/schema";
import { eq, lt, sql } from "drizzle-orm";
import { logger } from "./observability";

/**
 * Automated Data Retention & Compliance Job (Founder's Roadmap)
 * Runs daily to purge old call logs and recordings based on organization policies.
 */
export async function runDataRetentionCleanup() {
  const startTime = Date.now();
  logger.info("Cleanup", "Starting automated data retention sweep...");

  try {
    // Purge old call translations and calls older than 30 days (global policy)
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - 30);

    // 1. Purge translations linked to old calls
    await db.delete(callTranslations)
      .where(sql`call_id IN (
        SELECT id FROM ${bridgedCalls}
        WHERE started_at < ${cutoffDate.toISOString()}
      )`);

    // 2. Purge the old call logs themselves
    const callPurgeResult = await db.delete(bridgedCalls)
      .where(sql`started_at < ${cutoffDate.toISOString()}`);

    const totalPurged = callPurgeResult.rowCount || 0;
    const duration = Date.now() - startTime;
    logger.info("Cleanup", `Data retention sweep complete. Purged ${totalPurged} stale records.`, { durationMs: duration });
  } catch (error) {
    const normalized = error instanceof Error ? error : new Error(String(error));
    const pgCode = (error as { code?: string } | null)?.code;
    if (pgCode === "42P01") {
      logger.warn("Cleanup", "Skipping data retention sweep because legacy cleanup tables are not present");
      return;
    }
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
