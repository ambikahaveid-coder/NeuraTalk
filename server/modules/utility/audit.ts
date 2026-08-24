/**
 * Business utility-messaging audit wrapper -- Phase 7 (2026-08-24).
 * Thin wrapper over the real, persistent audit_logs system (server/audit.ts),
 * matching the pattern established across every prior phase's own
 * <module>/audit.ts. Records safe metadata only -- event type, template
 * version id, message id, outcome, failure reason -- never the rendered
 * message content or any other event payload field.
 */
import { createAuditLog as writeAuditLog } from "../../audit";
import { AUDIT_ACTION, type AuditAction } from "@shared/schema";
import { logger } from "../../observability";

export const AUDIT_ACTION_UTILITY = {
  EVENT_CREATED: AUDIT_ACTION.CREATE,
  EVENT_FAILED: AUDIT_ACTION.FAIL,
} as const satisfies Record<string, AuditAction>;

export async function createAuditLogEntry(
  actorUserId: number | undefined,
  businessId: number,
  action: AuditAction,
  eventId: number,
  metadata: Record<string, unknown>,
): Promise<void> {
  await writeAuditLog({
    userId: actorUserId,
    organizationId: businessId,
    action,
    entityType: "business_utility_event",
    entityId: eventId,
    metadata,
  }).catch((err) => logger.error("Utility", "Failed to write audit log", err as Error));
}

export { createAuditLogEntry as createAuditLog };
