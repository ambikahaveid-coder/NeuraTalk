/**
 * Registers "campaign" as an approvable resource type with the generic
 * Approval Center -- Phase 5 (2026-08-24). See doc 30 section 13.
 *
 * A campaign must be approved before it can be scheduled or executed
 * (separation of duties: the author of a campaign must not be able to
 * unilaterally put it live -- same reasoning as Phase 2's template
 * approval). This is the ONLY place that connects the two modules; the
 * Campaign domain still owns its own "approved" fact (campaigns.approvedBy/
 * approvedAt), this file is purely the glue.
 *
 * Must be imported once at server startup (its side effect is the
 * registration) before any approval request can reference "campaign" --
 * done in server/routes.ts, alongside registerApprovalRoutes.
 */
import { PERMISSIONS } from "@shared/schema";
import { registerApprovalPolicy, type TxLike } from "../approvals/policy";
import { isCampaignSubmittable, getCampaignBusinessId, markCampaignApproved, markCampaignRejected } from "./service";

registerApprovalPolicy({
  resourceType: "campaign",
  submitPermission: PERMISSIONS.CAMPAIGNS_MANAGE,
  // Deliberately the SAME permission used to execute a campaign -- the
  // authority to approve a campaign for going live and the authority to
  // actually run it are treated as one authority in this model (doc 30
  // section 13), avoiding a 4th permission (CAMPAIGNS_APPROVE) the brief
  // asked to avoid unless clearly necessary.
  decidePermission: PERMISSIONS.CAMPAIGNS_EXECUTE,
  selfApprovalForbidden: true,

  async resolveOwnership(resourceId, tx: TxLike) {
    const businessId = await getCampaignBusinessId(resourceId, tx as any);
    return businessId !== null ? { businessId } : null;
  },

  async isSubmittable(resourceId, tx: TxLike) {
    const businessId = await getCampaignBusinessId(resourceId, tx as any);
    if (businessId === null) return false;
    return isCampaignSubmittable(businessId, resourceId, tx as any);
  },

  async onSubmit() {
    // No domain-side "under review" transition for campaigns -- see
    // lifecycle.ts's header comment. campaigns.status stays DRAFT.
  },

  async onApproved(resourceId, actorUserId, tx: TxLike) {
    const businessId = await getCampaignBusinessId(resourceId, tx as any);
    if (businessId === null) throw new Error("Resource disappeared mid-transaction -- should be unreachable");
    await markCampaignApproved(businessId, resourceId, actorUserId, tx as any);
  },

  async onRejected(resourceId, actorUserId, reason, tx: TxLike) {
    const businessId = await getCampaignBusinessId(resourceId, tx as any);
    if (businessId === null) throw new Error("Resource disappeared mid-transaction -- should be unreachable");
    await markCampaignRejected(businessId, resourceId, actorUserId, reason, tx as any);
  },
});
