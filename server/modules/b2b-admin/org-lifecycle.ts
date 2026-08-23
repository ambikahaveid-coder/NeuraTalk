/**
 * Organization lifecycle governance (P1 foundation hardening, 2026-08-23)
 *
 * Canonical 7-state model layered on top of the existing `organizations.status`
 * free-text column and `isActive` boolean. Storage is NOT renamed: "approved"
 * continues to mean operationally ACTIVE, because that string is read directly
 * by several pre-existing gates (server/role-middleware.ts requireApprovedCompany,
 * server/api-key-auth.ts, server/modules/auth/service.ts login gate,
 * server/billing-engine.ts startCallSession) that this hardening pass does not
 * touch, by design, to avoid any risk of breaking already-working access control.
 *
 * APPROVED and ACTIVE map to the same stored value ("approved") because the
 * existing approve endpoint has always activated billing in the same step --
 * there is no real intermediate "approved but not yet active" state in this
 * codebase today. This module names both canonical states for future clarity
 * (e.g. an admin UI badge), but the PENDING_APPROVAL -> APPROVED transition and
 * the (implicit) APPROVED -> ACTIVE transition are the same database write.
 */

import { db } from "../../db";
import { organizations } from "@shared/schema";
import { eq } from "drizzle-orm";
import { createAuditLog } from "../../audit";
import { AUDIT_ACTION } from "@shared/schema";
import { logger } from "../../observability";

export const ORG_STATE = {
  DRAFT: "DRAFT",
  PENDING_APPROVAL: "PENDING_APPROVAL",
  APPROVED: "APPROVED",
  ACTIVE: "ACTIVE",
  SUSPENDED: "SUSPENDED",
  DEACTIVATED: "DEACTIVATED",
  REJECTED: "REJECTED",
} as const;

export type OrgState = typeof ORG_STATE[keyof typeof ORG_STATE];

/**
 * Derive the canonical 7-state name from the compact DB representation.
 * Read-only mapping -- does not write anything.
 */
export function mapStoredStatusToOrgState(status: string | null, isActive: boolean | null): OrgState {
  switch (status) {
    case "pending":
      return ORG_STATE.PENDING_APPROVAL;
    case "approved":
      return isActive === false ? ORG_STATE.APPROVED : ORG_STATE.ACTIVE;
    case "suspended":
      return ORG_STATE.SUSPENDED;
    case "deactivated":
      return ORG_STATE.DEACTIVATED;
    case "rejected":
      return ORG_STATE.REJECTED;
    default:
      return ORG_STATE.DRAFT;
  }
}

const LEGAL_TRANSITIONS: Record<OrgState, OrgState[]> = {
  [ORG_STATE.DRAFT]: [ORG_STATE.PENDING_APPROVAL],
  [ORG_STATE.PENDING_APPROVAL]: [ORG_STATE.APPROVED, ORG_STATE.REJECTED],
  [ORG_STATE.APPROVED]: [ORG_STATE.ACTIVE],
  [ORG_STATE.ACTIVE]: [ORG_STATE.SUSPENDED, ORG_STATE.DEACTIVATED],
  [ORG_STATE.SUSPENDED]: [ORG_STATE.ACTIVE],
  [ORG_STATE.DEACTIVATED]: [],
  [ORG_STATE.REJECTED]: [],
};

export class IllegalOrgTransitionError extends Error {
  constructor(public readonly from: OrgState, public readonly to: OrgState) {
    super(`Illegal organization state transition: ${from} -> ${to}`);
    this.name = "IllegalOrgTransitionError";
  }
}

export function assertLegalTransition(from: OrgState, to: OrgState): void {
  const allowed = LEGAL_TRANSITIONS[from] ?? [];
  if (!allowed.includes(to)) {
    throw new IllegalOrgTransitionError(from, to);
  }
}

interface TransitionResult {
  ok: true;
  previousState: OrgState;
  newState: OrgState;
}
interface TransitionError {
  ok: false;
  reason: "NOT_FOUND" | "ILLEGAL_TRANSITION";
  previousState?: OrgState;
}

/**
 * Suspend an ACTIVE organization. Requires a reason. Audit-logged.
 * Does not touch billing balances -- BillingEngine.startCallSession already
 * blocks orgs with status "suspended", so this is sufficient to stop usage.
 */
export async function suspendOrganization(
  orgId: number,
  actorUserId: number,
  reason: string,
): Promise<TransitionResult | TransitionError> {
  const [org] = await db.select().from(organizations).where(eq(organizations.id, orgId));
  if (!org) return { ok: false, reason: "NOT_FOUND" };

  const current = mapStoredStatusToOrgState(org.status, org.isActive);
  try {
    assertLegalTransition(current, ORG_STATE.SUSPENDED);
  } catch {
    return { ok: false, reason: "ILLEGAL_TRANSITION", previousState: current };
  }

  await db.update(organizations)
    .set({
      status: "suspended",
      isActive: false,
      suspendedAt: new Date(),
      suspendedBy: actorUserId,
      suspensionReason: reason,
    })
    .where(eq(organizations.id, orgId));

  await createAuditLog({
    userId: actorUserId,
    organizationId: orgId,
    action: AUDIT_ACTION.SUSPEND,
    entityType: "organization",
    entityId: orgId,
    oldValue: { status: org.status, isActive: org.isActive },
    newValue: { status: "suspended", isActive: false },
    metadata: { reason },
  }).catch((err) => logger.error("OrgLifecycle", "Failed to audit-log suspend", err as Error));

  logger.info("OrgLifecycle", "Organization suspended", { orgId, actorUserId, reason });
  return { ok: true, previousState: current, newState: ORG_STATE.SUSPENDED };
}

/**
 * Reactivate a SUSPENDED organization back to ACTIVE.
 */
export async function reactivateOrganization(
  orgId: number,
  actorUserId: number,
): Promise<TransitionResult | TransitionError> {
  const [org] = await db.select().from(organizations).where(eq(organizations.id, orgId));
  if (!org) return { ok: false, reason: "NOT_FOUND" };

  const current = mapStoredStatusToOrgState(org.status, org.isActive);
  try {
    assertLegalTransition(current, ORG_STATE.ACTIVE);
  } catch {
    return { ok: false, reason: "ILLEGAL_TRANSITION", previousState: current };
  }

  await db.update(organizations)
    .set({
      status: "approved",
      isActive: true,
      reactivatedAt: new Date(),
      reactivatedBy: actorUserId,
    })
    .where(eq(organizations.id, orgId));

  await createAuditLog({
    userId: actorUserId,
    organizationId: orgId,
    action: AUDIT_ACTION.REACTIVATE,
    entityType: "organization",
    entityId: orgId,
    oldValue: { status: org.status, isActive: org.isActive },
    newValue: { status: "approved", isActive: true },
  }).catch((err) => logger.error("OrgLifecycle", "Failed to audit-log reactivate", err as Error));

  logger.info("OrgLifecycle", "Organization reactivated", { orgId, actorUserId });
  return { ok: true, previousState: current, newState: ORG_STATE.ACTIVE };
}

/**
 * Deactivate an ACTIVE organization. Terminal in this phase -- no admin route
 * reactivates a DEACTIVATED org (only SUSPENDED -> ACTIVE is legal). Requires
 * a reason. Preserves the row and all financial/audit history (no delete).
 */
export async function deactivateOrganization(
  orgId: number,
  actorUserId: number,
  reason: string,
): Promise<TransitionResult | TransitionError> {
  const [org] = await db.select().from(organizations).where(eq(organizations.id, orgId));
  if (!org) return { ok: false, reason: "NOT_FOUND" };

  const current = mapStoredStatusToOrgState(org.status, org.isActive);
  try {
    assertLegalTransition(current, ORG_STATE.DEACTIVATED);
  } catch {
    return { ok: false, reason: "ILLEGAL_TRANSITION", previousState: current };
  }

  await db.update(organizations)
    .set({
      status: "deactivated",
      isActive: false,
      deactivatedAt: new Date(),
      deactivatedBy: actorUserId,
      deactivationReason: reason,
    })
    .where(eq(organizations.id, orgId));

  await createAuditLog({
    userId: actorUserId,
    organizationId: orgId,
    action: AUDIT_ACTION.DEACTIVATE,
    entityType: "organization",
    entityId: orgId,
    oldValue: { status: org.status, isActive: org.isActive },
    newValue: { status: "deactivated", isActive: false },
    metadata: { reason },
  }).catch((err) => logger.error("OrgLifecycle", "Failed to audit-log deactivate", err as Error));

  logger.info("OrgLifecycle", "Organization deactivated", { orgId, actorUserId, reason });
  return { ok: true, previousState: current, newState: ORG_STATE.DEACTIVATED };
}
