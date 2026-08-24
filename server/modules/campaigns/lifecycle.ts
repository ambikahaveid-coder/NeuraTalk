/**
 * Campaign lifecycle -- Phase 5 (2026-08-24).
 * See docs/neura-ecosystem/30_CAMPAIGN_ENGINE_IMPLEMENTATION.md section 3.
 * Same pattern as server/modules/templates/lifecycle.ts -- a LEGAL_TRANSITIONS
 * map + a guard function, not a new state-machine abstraction.
 *
 * Note this is deliberately NOT the same shape as Phase 2's template
 * lifecycle: a campaign has no "SUBMITTED"/approval-pending status of its
 * own. Approval is entirely owned by the generic Approval Center (an
 * approvalRequests row for resourceType "campaign") -- campaigns.status
 * stays DRAFT the whole time a campaign is being authored AND while it's
 * pending approval; only campaigns.approvedAt (set by
 * campaigns/approval-policy.ts's onApproved callback) records that fact.
 * Folding a second "under review" status into THIS enum would have been
 * exactly the duplicate-approval-state-logic the brief prohibited.
 */
import { CAMPAIGN_STATUS, type CampaignStatus } from "@shared/schema";

const LEGAL_TRANSITIONS: Record<CampaignStatus, CampaignStatus[]> = {
  [CAMPAIGN_STATUS.DRAFT]: [CAMPAIGN_STATUS.SCHEDULED, CAMPAIGN_STATUS.RUNNING, CAMPAIGN_STATUS.CANCELLED],
  [CAMPAIGN_STATUS.SCHEDULED]: [CAMPAIGN_STATUS.RUNNING, CAMPAIGN_STATUS.CANCELLED],
  [CAMPAIGN_STATUS.RUNNING]: [CAMPAIGN_STATUS.COMPLETED, CAMPAIGN_STATUS.FAILED],
  [CAMPAIGN_STATUS.COMPLETED]: [], // terminal
  [CAMPAIGN_STATUS.CANCELLED]: [], // terminal
  [CAMPAIGN_STATUS.FAILED]: [], // terminal
};

export class IllegalCampaignTransitionError extends Error {
  constructor(public readonly from: CampaignStatus, public readonly to: CampaignStatus) {
    super(`Illegal campaign transition: ${from} -> ${to}`);
    this.name = "IllegalCampaignTransitionError";
  }
}

export function assertLegalCampaignTransition(from: CampaignStatus, to: CampaignStatus): void {
  const allowed = LEGAL_TRANSITIONS[from] ?? [];
  if (!allowed.includes(to)) {
    throw new IllegalCampaignTransitionError(from, to);
  }
}

/** Campaign fields (name/description/category/templateVersionId/audienceId) are mutable ONLY while DRAFT -- once scheduled/running, the recipient snapshot and template binding must not shift under it. */
export function isCampaignEditable(status: CampaignStatus): boolean {
  return status === CAMPAIGN_STATUS.DRAFT;
}

/** Cancellation is only supported before execution has started, per doc 30 section 3 -- a RUNNING campaign's per-recipient processing runs to completion (or FAILED on a systemic error), it is not interruptible mid-run in this foundation. */
export function isCampaignCancellable(status: CampaignStatus): boolean {
  return status === CAMPAIGN_STATUS.DRAFT || status === CAMPAIGN_STATUS.SCHEDULED;
}
