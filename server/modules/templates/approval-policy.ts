/**
 * Registers "template_version" as an approvable resource type with the
 * generic Approval Center -- Phase 3 (2026-08-24).
 * See docs/neura-ecosystem/28_GENERIC_APPROVAL_CENTER_IMPLEMENTATION.md
 * section 8.
 *
 * This is the ONLY place that connects the two modules. The Template
 * domain still owns its own resource state transition (submitVersion/
 * approveVersion/rejectVersion in service.ts, unchanged in their own
 * logic, just now callable with an externally-supplied transaction) --
 * this file is purely the glue the Approval Center calls through.
 *
 * Importing this module (for its registration side effect) must happen
 * once at server startup, before any approval request can be processed --
 * done in server/routes.ts, alongside registerApprovalRoutes.
 */
import { TEMPLATE_VERSION_STATUS, PERMISSIONS } from "@shared/schema";
import { registerApprovalPolicy, type TxLike } from "../approvals/policy";
import { templateVersions } from "@shared/schema";
import { eq } from "drizzle-orm";
import { submitVersion, approveVersion, rejectVersion, getVersionBusinessId } from "./service";

registerApprovalPolicy({
  resourceType: "template_version",
  submitPermission: PERMISSIONS.TEMPLATES_MANAGE,
  decidePermission: PERMISSIONS.TEMPLATES_APPROVE,
  selfApprovalForbidden: true,

  async resolveOwnership(resourceId, tx) {
    const info = await getVersionBusinessId(resourceId, tx as any);
    return info ? { businessId: info.businessId } : null;
  },

  async isSubmittable(resourceId, tx) {
    const [v] = await (tx as any).select().from(templateVersions).where(eq(templateVersions.id, resourceId));
    return v?.status === TEMPLATE_VERSION_STATUS.DRAFT;
  },

  async onSubmit(resourceId, actorUserId, tx) {
    const info = await getVersionBusinessId(resourceId, tx as any);
    if (!info) throw new Error("Resource disappeared mid-transaction -- should be unreachable, already checked by the caller");
    await submitVersion(info.businessId, actorUserId, info.templateId, resourceId, tx as any);
  },

  async onApproved(resourceId, actorUserId, tx) {
    const info = await getVersionBusinessId(resourceId, tx as any);
    if (!info) throw new Error("Resource disappeared mid-transaction -- should be unreachable");
    await approveVersion(info.businessId, actorUserId, info.templateId, resourceId, tx as any);
  },

  async onRejected(resourceId, actorUserId, reason, tx) {
    const info = await getVersionBusinessId(resourceId, tx as any);
    if (!info) throw new Error("Resource disappeared mid-transaction -- should be unreachable");
    await rejectVersion(info.businessId, actorUserId, info.templateId, resourceId, reason, tx as any);
  },
});
