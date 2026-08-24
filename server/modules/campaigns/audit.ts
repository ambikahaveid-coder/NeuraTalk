/**
 * Campaign audit wrapper -- Phase 5 (2026-08-24).
 * Thin wrapper over the real, persistent audit_logs system (server/audit.ts),
 * matching the pattern established in templates/audit.ts and customers/audit.ts.
 */
import { createAuditLog as writeAuditLog } from "../../audit";
import { AUDIT_ACTION, type AuditAction } from "@shared/schema";
import { logger } from "../../observability";

export const AUDIT_ACTION_CAMPAIGN = {
  CREATED: AUDIT_ACTION.CREATE,
  UPDATED: AUDIT_ACTION.UPDATE,
  SCHEDULED: AUDIT_ACTION.SCHEDULE,
  STARTED: AUDIT_ACTION.START,
  COMPLETED: AUDIT_ACTION.COMPLETE,
  CANCELLED: AUDIT_ACTION.CANCEL,
  FAILED: AUDIT_ACTION.FAIL,
} as const satisfies Record<string, AuditAction>;

export async function createAuditLogEntry(
  actorUserId: number | undefined,
  businessId: number,
  action: AuditAction,
  campaignId: number,
  metadata: Record<string, unknown>,
): Promise<void> {
  await writeAuditLog({
    userId: actorUserId,
    organizationId: businessId,
    action,
    entityType: "campaign",
    entityId: campaignId,
    metadata,
  }).catch((err) => logger.error("Campaigns", "Failed to write audit log", err as Error));
}

export { createAuditLogEntry as createAuditLog };
