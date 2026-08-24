/**
 * Generic Approval Center -- Phase 3 (2026-08-24).
 * See docs/neura-ecosystem/28_GENERIC_APPROVAL_CENTER_IMPLEMENTATION.md.
 */
import { db } from "../../db";
import { approvalRequests, APPROVAL_REQUEST_STATUS, type ApprovalRequestStatus } from "@shared/schema";
import { eq, and, desc } from "drizzle-orm";
import { getApprovalPolicy } from "./policy";
import { createAuditLog } from "../../audit";
import { AUDIT_ACTION } from "@shared/schema";
import { logger } from "../../observability";

export class NotFoundError extends Error {
  constructor(message: string) { super(message); this.name = "NotFoundError"; }
}
export class ValidationError extends Error {
  constructor(message: string) { super(message); this.name = "ValidationError"; }
}
export class UnknownResourceTypeError extends Error {
  constructor(resourceType: string) { super(`Unknown resource type: ${resourceType}`); this.name = "UnknownResourceTypeError"; }
}
export class SelfApprovalError extends Error {
  constructor() { super("You cannot decide an approval request you submitted yourself"); this.name = "SelfApprovalError"; }
}
/** Lost the race (someone else decided first) or the request was already terminal. */
export class AlreadyDecidedError extends Error {
  constructor() { super("This approval request has already been decided"); this.name = "AlreadyDecidedError"; }
}
export class ForbiddenError extends Error {
  constructor(message: string) { super(message); this.name = "ForbiddenError"; }
}

async function writeAuditLog(actorUserId: number, businessId: number, action: string, requestId: number, metadata: Record<string, unknown>) {
  await createAuditLog({
    userId: actorUserId,
    organizationId: businessId,
    action: action as any,
    entityType: "approval_request",
    entityId: requestId,
    metadata,
  }).catch((err) => logger.error("Approvals", "Failed to write audit log", err as Error));
}

/**
 * Creates a PENDING approval request for a resource, after verifying:
 * (1) the resourceType is a registered policy, (2) the resource actually
 * exists, (3) it belongs to the CLAIMED businessId (never trusted from the
 * client without this check -- resolveOwnership is the source of truth),
 * (4) it's in a submittable state. The domain's own "mark as under review"
 * transition (policy.onSubmit) runs in the SAME transaction as the
 * approvalRequests insert -- both succeed or both roll back.
 */
export async function createApprovalRequest(
  businessId: number,
  actorUserId: number,
  resourceType: string,
  resourceId: number,
): Promise<typeof approvalRequests.$inferSelect> {
  const policy = getApprovalPolicy(resourceType);
  if (!policy) throw new UnknownResourceTypeError(resourceType);

  return db.transaction(async (tx) => {
    const ownership = await policy.resolveOwnership(resourceId, tx);
    // Deliberately the same NotFoundError/message whether the resource
    // doesn't exist at all or belongs to a different business -- never
    // reveal to a caller that a resource exists in another tenant.
    if (!ownership || ownership.businessId !== businessId) {
      throw new NotFoundError("Resource not found");
    }

    const submittable = await policy.isSubmittable(resourceId, tx);
    if (!submittable) {
      throw new ValidationError("Resource is not in a state that can be submitted for approval");
    }

    await policy.onSubmit(resourceId, actorUserId, tx);

    const [request] = await tx.insert(approvalRequests).values({
      businessId,
      resourceType,
      resourceId,
      requestedBy: actorUserId,
      status: APPROVAL_REQUEST_STATUS.PENDING,
    }).returning();

    await writeAuditLog(actorUserId, businessId, AUDIT_ACTION.CREATE, request.id, { resourceType, resourceId });
    return request;
  });
}

export async function listApprovalRequests(businessId: number, status?: ApprovalRequestStatus) {
  const conditions = [eq(approvalRequests.businessId, businessId)];
  if (status) conditions.push(eq(approvalRequests.status, status));
  return db.select().from(approvalRequests).where(and(...conditions)).orderBy(desc(approvalRequests.createdAt));
}

export async function getApprovalRequest(businessId: number, requestId: number) {
  const [request] = await db.select().from(approvalRequests)
    .where(and(eq(approvalRequests.id, requestId), eq(approvalRequests.businessId, businessId)));
  return request ?? null;
}

async function getOwnedRequest(tx: typeof db, businessId: number, requestId: number) {
  const [request] = await tx.select().from(approvalRequests)
    .where(and(eq(approvalRequests.id, requestId), eq(approvalRequests.businessId, businessId)));
  if (!request) throw new NotFoundError("Approval request not found");
  return request;
}

/**
 * Approves or rejects a PENDING request. Concurrency safety: the actual
 * status transition is a single UPDATE ... WHERE status = 'pending', the
 * same atomic compare-and-swap pattern already used in
 * server/billing-engine.ts's reserveWalletAmount -- if two decisions race,
 * only the first UPDATE actually matches a row; the second's WHERE clause
 * matches zero rows (the status has already moved), so `updated` comes
 * back undefined and AlreadyDecidedError is thrown for the loser. No
 * double-approval, no approved+rejected contradictory state is reachable.
 */
async function decide(
  businessId: number,
  actorUserId: number,
  requestId: number,
  decision: typeof APPROVAL_REQUEST_STATUS.APPROVED | typeof APPROVAL_REQUEST_STATUS.REJECTED,
  reason: string | undefined,
  isSuperAdmin: boolean,
): Promise<typeof approvalRequests.$inferSelect> {
  return db.transaction(async (tx) => {
    const request = await getOwnedRequest(tx as any, businessId, requestId);
    const policy = getApprovalPolicy(request.resourceType);
    if (!policy) throw new UnknownResourceTypeError(request.resourceType);

    if (policy.selfApprovalForbidden && !isSuperAdmin && request.requestedBy === actorUserId) {
      throw new SelfApprovalError();
    }
    if (decision === APPROVAL_REQUEST_STATUS.REJECTED && (!reason || !reason.trim())) {
      throw new ValidationError("A rejection reason is required");
    }

    const [updated] = await tx.update(approvalRequests).set({
      status: decision,
      decidedBy: actorUserId,
      decidedAt: new Date(),
      reason: reason ?? null,
    }).where(and(eq(approvalRequests.id, requestId), eq(approvalRequests.status, APPROVAL_REQUEST_STATUS.PENDING))).returning();

    if (!updated) throw new AlreadyDecidedError();

    if (decision === APPROVAL_REQUEST_STATUS.APPROVED) {
      await policy.onApproved(request.resourceId, actorUserId, tx);
    } else {
      await policy.onRejected(request.resourceId, actorUserId, reason!, tx);
    }

    await writeAuditLog(actorUserId, businessId, decision === APPROVAL_REQUEST_STATUS.APPROVED ? AUDIT_ACTION.APPROVE : AUDIT_ACTION.REJECT, requestId, {
      resourceType: request.resourceType, resourceId: request.resourceId, reason,
    });

    return updated;
  });
}

export async function approveRequest(businessId: number, actorUserId: number, requestId: number, isSuperAdmin: boolean) {
  return decide(businessId, actorUserId, requestId, APPROVAL_REQUEST_STATUS.APPROVED, undefined, isSuperAdmin);
}

export async function rejectRequest(businessId: number, actorUserId: number, requestId: number, reason: string, isSuperAdmin: boolean) {
  return decide(businessId, actorUserId, requestId, APPROVAL_REQUEST_STATUS.REJECTED, reason, isSuperAdmin);
}

export async function cancelRequest(businessId: number, actorUserId: number, requestId: number, isSuperAdmin: boolean) {
  return db.transaction(async (tx) => {
    const request = await getOwnedRequest(tx as any, businessId, requestId);
    if (!isSuperAdmin && request.requestedBy !== actorUserId) {
      throw new ForbiddenError("Only the original requester can cancel a pending request");
    }

    const [updated] = await tx.update(approvalRequests).set({
      status: APPROVAL_REQUEST_STATUS.CANCELLED,
      decidedBy: actorUserId,
      decidedAt: new Date(),
    }).where(and(eq(approvalRequests.id, requestId), eq(approvalRequests.status, APPROVAL_REQUEST_STATUS.PENDING))).returning();

    if (!updated) throw new AlreadyDecidedError();

    await writeAuditLog(actorUserId, businessId, AUDIT_ACTION.UPDATE, requestId, { resourceType: request.resourceType, resourceId: request.resourceId, cancelled: true });
    return updated;
  });
}
