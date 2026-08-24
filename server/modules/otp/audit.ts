/**
 * Business OTP audit wrapper -- Phase 6 (2026-08-24).
 * Thin wrapper over the real, persistent audit_logs system (server/audit.ts),
 * matching the pattern established across every prior phase's own
 * <module>/audit.ts. Records challenge_created/verified/failed/expired/
 * locked/resend_requested with SAFE metadata only -- the code, its hash,
 * and any rendered content are never passed to this function or to
 * writeAuditLog, so there is no path by which a secret could end up in
 * audit_logs even by accident (createAuditLog's own sanitizeForAudit is a
 * second, independent layer of defense, not the only one).
 */
import { createAuditLog as writeAuditLog } from "../../audit";
import { AUDIT_ACTION, type AuditAction } from "@shared/schema";
import { logger } from "../../observability";

export const AUDIT_ACTION_OTP = {
  CHALLENGE_CREATED: AUDIT_ACTION.CREATE,
  CHALLENGE_VERIFIED: AUDIT_ACTION.VERIFY,
  CHALLENGE_FAILED: AUDIT_ACTION.FAIL,
  CHALLENGE_EXPIRED: AUDIT_ACTION.FAIL,
  CHALLENGE_LOCKED: AUDIT_ACTION.FAIL,
  RESEND_REQUESTED: AUDIT_ACTION.RESEND,
} as const satisfies Record<string, AuditAction>;

export async function createAuditLogEntry(
  actorUserId: number | undefined,
  businessId: number,
  action: AuditAction,
  challengeId: number,
  metadata: Record<string, unknown>,
): Promise<void> {
  await writeAuditLog({
    userId: actorUserId,
    organizationId: businessId,
    action,
    entityType: "business_otp_challenge",
    entityId: challengeId,
    metadata,
  }).catch((err) => logger.error("OTP", "Failed to write audit log", err as Error));
}

export { createAuditLogEntry as createAuditLog };
