/**
 * Template audit wrapper -- Phase 2 (2026-08-24).
 *
 * Thin wrapper over the REAL, existing, persistent audit_logs system
 * (server/audit.ts's createAuditLog). Deliberately does NOT write to
 * messagingEvents -- that table is the message-lifecycle trail (doc 24),
 * not the administrative audit system, and the two must not be conflated
 * (explicit instruction, restated from doc 26 section 9's same rule).
 */
import { createAuditLog as writeAuditLog } from "../../audit";
import { AUDIT_ACTION, type AuditAction } from "@shared/schema";
import { logger } from "../../observability";

export const AUDIT_ACTION_TEMPLATE = {
  CREATED: AUDIT_ACTION.CREATE,
  VERSION_CREATED: AUDIT_ACTION.CREATE,
  VERSION_EDITED: AUDIT_ACTION.UPDATE,
  SUBMITTED: AUDIT_ACTION.SUBMIT,
  APPROVED: AUDIT_ACTION.APPROVE,
  REJECTED: AUDIT_ACTION.REJECT,
  RETURNED_TO_DRAFT: AUDIT_ACTION.RETURN_TO_DRAFT,
  ARCHIVED: AUDIT_ACTION.ARCHIVE,
} as const satisfies Record<string, AuditAction>;

export async function createAuditLogEntry(
  actorUserId: number,
  businessId: number,
  action: AuditAction,
  templateId: number,
  versionId: number | undefined,
  metadata: Record<string, unknown>,
): Promise<void> {
  await writeAuditLog({
    userId: actorUserId,
    organizationId: businessId,
    action,
    entityType: versionId !== undefined ? "template_version" : "template",
    entityId: versionId ?? templateId,
    metadata: { templateId, ...metadata },
  }).catch((err) => logger.error("Templates", "Failed to write audit log", err as Error));
}

// Re-exported under the shorter name service.ts imports, for readability there.
export { createAuditLogEntry as createAuditLog };
