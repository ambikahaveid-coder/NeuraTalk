import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Regression tests for the P1 org-lifecycle mutation functions
 * (server/modules/b2b-admin/org-lifecycle.ts): every state-changing function
 * must (a) refuse an illegal transition without touching the DB, (b) record
 * actor + reason + timestamp on the row, and (c) write an audit log entry.
 */

let selectedOrg: { id: number; status: string; isActive: boolean } | null = null;
let updateSetArg: unknown;
let auditLogCalls: Array<Record<string, unknown>> = [];

vi.mock("../../server/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => Promise.resolve(selectedOrg ? [selectedOrg] : []),
      }),
    }),
    update: () => ({
      set: (patch: unknown) => {
        updateSetArg = patch;
        return { where: () => Promise.resolve([{ id: 1 }]) };
      },
    }),
  },
}));

vi.mock("@shared/schema", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    organizations: { id: "organizations.id", status: "organizations.status", isActive: "organizations.isActive" },
  };
});

vi.mock("../../server/audit", () => ({
  createAuditLog: (params: Record<string, unknown>) => {
    auditLogCalls.push(params);
    return Promise.resolve();
  },
}));

vi.mock("../../server/observability", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

describe("org-lifecycle mutation functions", () => {
  beforeEach(() => {
    selectedOrg = null;
    updateSetArg = undefined;
    auditLogCalls = [];
  });

  it("suspendOrganization: ACTIVE org -> writes suspended status, actor, reason, timestamp, and audit log", async () => {
    selectedOrg = { id: 5, status: "approved", isActive: true };
    const { suspendOrganization } = await import("../../server/modules/b2b-admin/org-lifecycle");

    const result = await suspendOrganization(5, 42, "Fraud reported by users");
    expect(result.ok).toBe(true);

    const patch = updateSetArg as Record<string, unknown>;
    expect(patch.status).toBe("suspended");
    expect(patch.isActive).toBe(false);
    expect(patch.suspendedBy).toBe(42);
    expect(patch.suspensionReason).toBe("Fraud reported by users");
    expect(patch.suspendedAt).toBeInstanceOf(Date);

    expect(auditLogCalls).toHaveLength(1);
    expect(auditLogCalls[0].action).toBe("suspend");
    expect(auditLogCalls[0].organizationId).toBe(5);
    expect(auditLogCalls[0].userId).toBe(42);
  });

  it("suspendOrganization: refuses to suspend a PENDING_APPROVAL org (illegal transition) and never writes", async () => {
    selectedOrg = { id: 6, status: "pending", isActive: true };
    const { suspendOrganization } = await import("../../server/modules/b2b-admin/org-lifecycle");

    const result = await suspendOrganization(6, 42, "should not apply");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("ILLEGAL_TRANSITION");
    expect(updateSetArg).toBeUndefined();
    expect(auditLogCalls).toHaveLength(0);
  });

  it("suspendOrganization: refuses to double-suspend an already-SUSPENDED org", async () => {
    selectedOrg = { id: 7, status: "suspended", isActive: false };
    const { suspendOrganization } = await import("../../server/modules/b2b-admin/org-lifecycle");

    const result = await suspendOrganization(7, 42, "should not apply");
    expect(result.ok).toBe(false);
    expect(updateSetArg).toBeUndefined();
  });

  it("suspendOrganization: NOT_FOUND when org does not exist", async () => {
    selectedOrg = null;
    const { suspendOrganization } = await import("../../server/modules/b2b-admin/org-lifecycle");

    const result = await suspendOrganization(999, 42, "reason");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("NOT_FOUND");
  });

  it("reactivateOrganization: SUSPENDED org -> ACTIVE, records actor + timestamp, audit-logged", async () => {
    selectedOrg = { id: 8, status: "suspended", isActive: false };
    const { reactivateOrganization } = await import("../../server/modules/b2b-admin/org-lifecycle");

    const result = await reactivateOrganization(8, 43);
    expect(result.ok).toBe(true);

    const patch = updateSetArg as Record<string, unknown>;
    expect(patch.status).toBe("approved"); // reuses the legacy "approved" string so pre-existing gates keep working
    expect(patch.isActive).toBe(true);
    expect(patch.reactivatedBy).toBe(43);
    expect(patch.reactivatedAt).toBeInstanceOf(Date);

    expect(auditLogCalls).toHaveLength(1);
    expect(auditLogCalls[0].action).toBe("reactivate");
  });

  it("reactivateOrganization: refuses to reactivate an ACTIVE org (already active, not a legal input state)", async () => {
    selectedOrg = { id: 9, status: "approved", isActive: true };
    const { reactivateOrganization } = await import("../../server/modules/b2b-admin/org-lifecycle");

    const result = await reactivateOrganization(9, 43);
    expect(result.ok).toBe(false);
    expect(updateSetArg).toBeUndefined();
  });

  it("deactivateOrganization: ACTIVE org -> DEACTIVATED, requires reason, audit-logged", async () => {
    selectedOrg = { id: 10, status: "approved", isActive: true };
    const { deactivateOrganization } = await import("../../server/modules/b2b-admin/org-lifecycle");

    const result = await deactivateOrganization(10, 44, "Business closed permanently");
    expect(result.ok).toBe(true);

    const patch = updateSetArg as Record<string, unknown>;
    expect(patch.status).toBe("deactivated");
    expect(patch.isActive).toBe(false);
    expect(patch.deactivatedBy).toBe(44);
    expect(patch.deactivationReason).toBe("Business closed permanently");

    expect(auditLogCalls).toHaveLength(1);
    expect(auditLogCalls[0].action).toBe("deactivate");
  });

  it("deactivateOrganization: refuses to deactivate an already-DEACTIVATED org (terminal state)", async () => {
    selectedOrg = { id: 11, status: "deactivated", isActive: false };
    const { deactivateOrganization } = await import("../../server/modules/b2b-admin/org-lifecycle");

    const result = await deactivateOrganization(11, 44, "should not apply");
    expect(result.ok).toBe(false);
    expect(updateSetArg).toBeUndefined();
  });

  it("deactivateOrganization: refuses to deactivate a SUSPENDED org directly (must reactivate first, per the legal transition table)", async () => {
    selectedOrg = { id: 12, status: "suspended", isActive: false };
    const { deactivateOrganization } = await import("../../server/modules/b2b-admin/org-lifecycle");

    const result = await deactivateOrganization(12, 44, "should not apply");
    expect(result.ok).toBe(false);
    expect(updateSetArg).toBeUndefined();
  });
});
