/**
 * Approval policy registry -- Phase 3 (2026-08-24).
 * See docs/neura-ecosystem/28_GENERIC_APPROVAL_CENTER_IMPLEMENTATION.md
 * section 4.
 *
 * A small, typed, CODE-level registry keyed by resourceType -- not a
 * database table. Exactly one domain (templates) registers a policy in
 * this phase; a DB-backed policy table would be speculative for domains
 * (refunds, white-label, etc.) that don't exist yet, explicitly out of
 * scope. Future domains register their own policy object the same way
 * templates does (server/modules/templates/approval-policy.ts) -- the
 * Approval Center core never needs to change to add one.
 */
// A transaction-capable DB handle -- matches the DbLike type already used
// in server/modules/templates/service.ts.
export type TxLike = { select: any; update: any; insert: any };

export interface ApprovalPolicy {
  resourceType: string;
  /** Permission required to submit a resource of this type for approval. */
  submitPermission: string;
  /** Permission required to approve/reject a request of this type. */
  decidePermission: string;
  /** Separation of duties: if true, the submitter can never also decide their own request (super_admin exempted, see approvals/service.ts). */
  selfApprovalForbidden: boolean;
  /** Resolves which business owns this resource, or null if it doesn't exist. Never trust a client-supplied businessId -- this is the source of truth. */
  resolveOwnership(resourceId: number, tx: TxLike): Promise<{ businessId: number } | null>;
  /** Is the resource currently in a state that can be submitted for approval? */
  isSubmittable(resourceId: number, tx: TxLike): Promise<boolean>;
  /** Domain's own transition to its "under review" state. Called inside the Approval Center's transaction. */
  onSubmit(resourceId: number, actorUserId: number, tx: TxLike): Promise<void>;
  /** Domain's own transition to its "approved" state. Called inside the Approval Center's transaction. */
  onApproved(resourceId: number, actorUserId: number, tx: TxLike): Promise<void>;
  /** Domain's own transition to its "rejected" state. Called inside the Approval Center's transaction. */
  onRejected(resourceId: number, actorUserId: number, reason: string, tx: TxLike): Promise<void>;
}

const registry = new Map<string, ApprovalPolicy>();

export function registerApprovalPolicy(policy: ApprovalPolicy): void {
  registry.set(policy.resourceType, policy);
}

export function getApprovalPolicy(resourceType: string): ApprovalPolicy | undefined {
  return registry.get(resourceType);
}

export function listRegisteredResourceTypes(): string[] {
  return Array.from(registry.keys());
}
