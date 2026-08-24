/**
 * Business-wide marketing reporting/frequency visibility -- Phase 8B-R0
 * (2026-08-24). See docs/neura-ecosystem/36_PHASE8B_R0_REPORTING_PREFLIGHT_IMPLEMENTATION.md.
 *
 * Purely a read-side composition layer over the Campaign Engine (Phase 5)
 * and the frequency module (Phase 8 hardening) -- no new domain model, no
 * new mutation path, no duplicated business rules. This is NOT a second
 * campaign/messaging system; it exists because doc 35's audit found no
 * endpoint that rolls campaign data UP across a business (every existing
 * report is scoped to one campaign).
 */
import { db } from "../../db";
import { campaigns, campaignRecipients, CAMPAIGN_RECIPIENT_STATUS, CAMPAIGN_STATUS, type CampaignStatus } from "@shared/schema";
import { eq, inArray } from "drizzle-orm";
import { peekBusinessThroughputStatus, peekCustomerFrequencyStatus, type FrequencyStatus } from "../campaigns/frequency";
import { getCustomer } from "../customers/service";

export class NotFoundError extends Error {
  constructor(message: string) { super(message); this.name = "NotFoundError"; }
}

const NO_CHANNEL_ADAPTER_REASON = "No channel adapter is connected -- messagingDeliveries never progresses past QUEUED in this codebase (see docs 30 section 21, 31 section 25, 32 section 23)";

export interface BusinessMarketingReport {
  businessId: number;
  campaignCount: number;
  campaignsByStatus: Record<string, number>;
  totals: {
    targeted: number;
    sent: number;
    skipped: number;
    skippedByReason: Record<string, number>;
    cost: { totalChargedPaise: number; availability: "AVAILABLE" };
  };
  delivery: {
    sent: { availability: "AVAILABLE"; count: number };
    accepted: { availability: "NOT_AVAILABLE"; reason: string };
    delivered: { availability: "NOT_AVAILABLE"; reason: string };
    read: { availability: "NOT_AVAILABLE"; reason: string };
  };
}

/**
 * Full-table-scoped-by-business aggregation, not a per-campaign loop
 * calling getCampaignReport N times (would be N+1). Acceptable at current
 * scale (doc 36 section "R0-M") -- if a business's total campaign count
 * grows large enough for this to matter, a (businessId, createdAt) index
 * on campaignRecipients (via a join through campaigns) is the documented,
 * deferred recommendation, not built speculatively here.
 */
export async function getBusinessMarketingReport(businessId: number): Promise<BusinessMarketingReport> {
  const campaignRows = await db.select().from(campaigns).where(eq(campaigns.businessId, businessId));
  const campaignsByStatus: Record<string, number> = {};
  for (const c of campaignRows) {
    campaignsByStatus[c.status] = (campaignsByStatus[c.status] ?? 0) + 1;
  }

  const campaignIds = campaignRows.map((c) => c.id);
  const recipientRows = campaignIds.length
    ? await db.select().from(campaignRecipients).where(inArray(campaignRecipients.campaignId, campaignIds))
    : [];

  let targeted = 0, sent = 0, skipped = 0, totalChargedPaise = 0;
  const skippedByReason: Record<string, number> = {};
  for (const row of recipientRows) {
    targeted++;
    if (row.status === CAMPAIGN_RECIPIENT_STATUS.SENT) {
      sent++;
      if (typeof row.chargedPaise === "number") totalChargedPaise += row.chargedPaise;
    } else if (row.status === CAMPAIGN_RECIPIENT_STATUS.SKIPPED) {
      skipped++;
      const reason = row.skipReason ?? "unknown";
      skippedByReason[reason] = (skippedByReason[reason] ?? 0) + 1;
    }
  }

  return {
    businessId,
    campaignCount: campaignRows.length,
    campaignsByStatus,
    totals: { targeted, sent, skipped, skippedByReason, cost: { totalChargedPaise, availability: "AVAILABLE" } },
    delivery: {
      sent: { availability: "AVAILABLE", count: sent },
      accepted: { availability: "NOT_AVAILABLE", reason: NO_CHANNEL_ADAPTER_REASON },
      delivered: { availability: "NOT_AVAILABLE", reason: NO_CHANNEL_ADAPTER_REASON },
      read: { availability: "NOT_AVAILABLE", reason: NO_CHANNEL_ADAPTER_REASON },
    },
  };
}

export interface MarketingFrequencyStatusResult {
  business: FrequencyStatus & { windowGranularity: "hour" };
  customer: (FrequencyStatus & { windowGranularity: "day"; customerId: number }) | null;
}

/** customerId, if supplied, is tenant-verified via the existing getCustomer read (NotFoundError if it doesn't belong to this business) -- never a second, less-scoped lookup path. */
export async function getMarketingFrequencyStatus(businessId: number, customerId?: number): Promise<MarketingFrequencyStatusResult> {
  const businessStatus = await peekBusinessThroughputStatus(db, businessId);

  let customer: MarketingFrequencyStatusResult["customer"] = null;
  if (customerId !== undefined) {
    const owned = await getCustomer(businessId, customerId);
    if (!owned) throw new NotFoundError("Customer not found");
    const status = await peekCustomerFrequencyStatus(db, businessId, customerId);
    customer = { ...status, windowGranularity: "day", customerId };
  }

  return { business: { ...businessStatus, windowGranularity: "hour" }, customer };
}
