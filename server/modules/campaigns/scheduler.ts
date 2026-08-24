/**
 * Campaign scheduler -- Phase 5 (2026-08-24). See doc 30 section 11.
 *
 * No queue/worker infrastructure exists in this codebase (confirmed by
 * audit before writing this file) -- every periodic job here follows the
 * same setInterval-based `start<X>Scheduler()` convention already used by
 * server/billing-scheduler.ts and server/modules/webhooks/service.ts's
 * retry sweep. This is NOT a distributed scheduler and doesn't try to be
 * one, per the brief's explicit instruction not to build one unnecessarily.
 *
 * Duplicate-execution safety does not come from this scheduler being
 * careful about not double-firing -- it comes from executeCampaign()
 * itself being safe to call concurrently/redundantly (atomic CAS on both
 * the campaign's own status and each recipient's status, see
 * campaigns/service.ts). This tick is intentionally allowed to overlap
 * with a manual POST .../execute call for the same campaign without any
 * additional locking here.
 */
import { db } from "../../db";
import { campaigns, CAMPAIGN_STATUS } from "@shared/schema";
import { eq, and, lte } from "drizzle-orm";
import { executeCampaign } from "./service";
import { logger } from "../../observability";

const TICK_INTERVAL_MS = 60 * 1000; // 1 minute -- coarse enough not to hammer the DB, fine enough that a scheduled campaign doesn't sit for long past its scheduledAt

async function runDueCampaigns(): Promise<void> {
  const due = await db.select().from(campaigns).where(and(
    eq(campaigns.status, CAMPAIGN_STATUS.SCHEDULED),
    lte(campaigns.scheduledAt, new Date()),
  ));

  for (const campaign of due) {
    try {
      await executeCampaign(campaign.businessId, undefined, campaign.id);
    } catch (error) {
      // A single campaign's readiness/systemic failure (already recorded as
      // FAILED by executeCampaign itself) must never stop the tick from
      // processing the rest of the due campaigns.
      logger.warn("CampaignScheduler", `Tick failed for campaign ${campaign.id}: ${String(error)}`);
    }
  }
}

export function startCampaignScheduler(): void {
  const safeRun = () => {
    void runDueCampaigns().catch((error) => {
      logger.warn("CampaignScheduler", `Tick skipped: ${String(error)}`);
    });
  };

  setTimeout(safeRun, 15_000); // short startup delay, mirroring billing-scheduler's convention
  setInterval(safeRun, TICK_INTERVAL_MS);

  logger.info("CampaignScheduler", `Campaign scheduler initialized (${TICK_INTERVAL_MS / 1000}s interval)`);
}
