/**
 * Audience audit wrapper -- Phase 4 (2026-08-24).
 * Thin wrapper over the real, persistent audit_logs system (server/audit.ts).
 */
import { createAuditLog as writeAuditLog } from "../../audit";
import { AUDIT_ACTION, type AuditAction } from "@shared/schema";
import { logger } from "../../observability";

export const AUDIT_ACTION_AUDIENCE = {
  CREATED: AUDIT_ACTION.CREATE,
  UPDATED: AUDIT_ACTION.UPDATE,
  ARCHIVED: AUDIT_ACTION.ARCHIVE,
  MEMBER_ADDED: AUDIT_ACTION.MEMBER_ADDED,
  MEMBER_REMOVED: AUDIT_ACTION.MEMBER_REMOVED,
} as const satisfies Record<string, AuditAction>;

export async function createAuditLogEntry(
  actorUserId: number,
  businessId: number,
  action: AuditAction,
  audienceId: number,
  metadata: Record<string, unknown>,
): Promise<void> {
  await writeAuditLog({
    userId: actorUserId,
    organizationId: businessId,
    action,
    entityType: "audience",
    entityId: audienceId,
    metadata,
  }).catch((err) => logger.error("Audiences", "Failed to write audit log", err as Error));
}

export { createAuditLogEntry as createAuditLog };
