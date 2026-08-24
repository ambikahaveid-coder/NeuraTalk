/**
 * Customer audit wrapper -- Phase 4 (2026-08-24).
 * Thin wrapper over the real, persistent audit_logs system (server/audit.ts),
 * matching the pattern established in server/modules/templates/audit.ts.
 */
import { createAuditLog as writeAuditLog } from "../../audit";
import { AUDIT_ACTION, type AuditAction } from "@shared/schema";
import { logger } from "../../observability";

export const AUDIT_ACTION_CUSTOMER = {
  CREATED: AUDIT_ACTION.CREATE,
  UPDATED: AUDIT_ACTION.UPDATE,
  ARCHIVED: AUDIT_ACTION.ARCHIVE,
  CONSENT_CHANGED: AUDIT_ACTION.CONSENT_ACTION,
} as const satisfies Record<string, AuditAction>;

export async function createAuditLogEntry(
  actorUserId: number,
  businessId: number,
  action: AuditAction,
  customerId: number,
  metadata: Record<string, unknown>,
): Promise<void> {
  await writeAuditLog({
    userId: actorUserId,
    organizationId: businessId,
    action,
    entityType: "customer",
    entityId: customerId,
    metadata,
  }).catch((err) => logger.error("Customers", "Failed to write audit log", err as Error));
}

export { createAuditLogEntry as createAuditLog };
