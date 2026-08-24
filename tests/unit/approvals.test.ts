import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Generic Approval Center tests (Phase 3).
 * See docs/neura-ecosystem/28_GENERIC_APPROVAL_CENTER_IMPLEMENTATION.md.
 *
 * Full integration: uses the REAL templates service, the REAL
 * templates/approval-policy.ts registration, and the REAL approvals
 * service against one shared in-memory fake DB -- proves the actual
 * wiring works end to end (submit -> PENDING -> approve -> template
 * APPROVED), not just each module in isolation.
 */

type Row = Record<string, any>;
const tables = new Map<string, Row[]>();
const idCounters = new Map<string, number>();

function resetFakeDb() {
  tables.clear();
  idCounters.clear();
  for (const t of ["organizations", "users", "templates", "templateVersions", "approvalRequests"]) {
    tables.set(t, []);
    idCounters.set(t, 0);
  }
  tables.get("organizations")!.push({ id: 1 }, { id: 2 });
}

function tableNameOf(tableDescriptor: Row): string {
  const sample = Object.values(tableDescriptor)[0] as string;
  return sample.split(".")[0];
}
function fieldNameOf(colDescriptor: string): string {
  return colDescriptor.split(".").pop()!;
}
function evalCond(row: Row, cond: any): boolean {
  if (!cond) return true;
  if (cond.__and) return cond.conds.every((c: any) => evalCond(row, c));
  if (cond.__eq) return row[cond.field] === cond.value;
  throw new Error("Unknown condition: " + JSON.stringify(cond));
}

class SelectChain implements PromiseLike<Row[]> {
  private cond: any = null;
  private orderField: string | null = null;
  private orderDesc = false;
  constructor(private tableName: string) {}
  where(cond: any) { this.cond = cond; return this; }
  orderBy(spec: any) {
    if (spec?.__desc) { this.orderField = spec.field; this.orderDesc = true; } else { this.orderField = spec; }
    return this;
  }
  private resolveRows(): Row[] {
    let rows = (tables.get(this.tableName) ?? []).filter((r) => evalCond(r, this.cond));
    if (this.orderField) {
      rows = [...rows].sort((a, b) => {
        const av = a[this.orderField!], bv = b[this.orderField!];
        const an = av?.getTime?.() ?? av, bn = bv?.getTime?.() ?? bv;
        return this.orderDesc ? (bn > an ? 1 : -1) : (an > bn ? 1 : -1);
      });
    }
    return rows;
  }
  then<T1, T2>(res?: any, rej?: any) { return Promise.resolve(this.resolveRows()).then(res, rej); }
}

class InsertChain implements PromiseLike<Row[]> {
  private row: Row | null = null;
  constructor(private tableName: string) {}
  values(data: Row) {
    const id = (idCounters.get(this.tableName) ?? 0) + 1;
    idCounters.set(this.tableName, id);
    this.row = { id, createdAt: new Date(), ...data };
    tables.get(this.tableName)!.push(this.row);
    return this;
  }
  returning() { return Promise.resolve([this.row]); }
  then<T1, T2>(res?: any, rej?: any) { return Promise.resolve([this.row]).then(res, rej); }
}

class UpdateChain {
  constructor(private tableName: string) {}
  set(patch: Row) {
    const tableName = this.tableName;
    let cond: any = null;
    const chain: any = {
      where(c: any) {
        cond = c;
        const affected = (tables.get(tableName) ?? []).filter((r: Row) => evalCond(r, cond));
        for (const row of affected) Object.assign(row, patch);
        chain._affected = affected;
        return chain;
      },
      returning() { return Promise.resolve(chain._affected ?? []); },
      then(res: any, rej: any) { return Promise.resolve(chain._affected ?? []).then(res, rej); },
    };
    return chain;
  }
}

const fakeDb = {
  select(_cols?: any) { return { from: (t: Row) => new SelectChain(tableNameOf(t)) }; },
  insert(t: Row) { return new InsertChain(tableNameOf(t)); },
  update(t: Row) { return new UpdateChain(tableNameOf(t)); },
  transaction(fn: (tx: typeof fakeDb) => Promise<any>) { return fn(fakeDb); },
};

const auditLogCalls: Array<Record<string, unknown>> = [];

vi.mock("../../server/db", () => ({ db: fakeDb }));
vi.mock("../../server/observability", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock("../../server/audit", () => ({
  createAuditLog: vi.fn(async (params: Record<string, unknown>) => { auditLogCalls.push(params); }),
}));
vi.mock("../../server/modules/templates/audit", () => ({
  createAuditLog: vi.fn(async () => {}),
  AUDIT_ACTION_TEMPLATE: {
    CREATED: "create", VERSION_CREATED: "create", VERSION_EDITED: "update", SUBMITTED: "submit",
    APPROVED: "approve", REJECTED: "reject", RETURNED_TO_DRAFT: "return_to_draft", ARCHIVED: "archive",
  },
}));

vi.mock("drizzle-orm", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    eq: (column: string, value: unknown) => ({ __eq: true, field: fieldNameOf(column), value }),
    and: (...conds: any[]) => ({ __and: true, conds }),
    desc: (column: string) => ({ __desc: true, field: fieldNameOf(column) }),
  };
});

vi.mock("@shared/schema", async (importOriginal) => {
  const actual = await importOriginal<Record<string, any>>();
  const col = (t: string, f: string) => `${t}.${f}`;
  const mkTable = (t: string, fields: string[]) => Object.fromEntries(fields.map((f) => [f, col(t, f)]));
  return {
    ...actual,
    organizations: mkTable("organizations", ["id"]),
    users: mkTable("users", ["id"]),
    templates: mkTable("templates", ["id", "businessId", "name", "category", "createdBy", "createdAt"]),
    templateVersions: mkTable("templateVersions", [
      "id", "templateId", "language", "versionNumber", "status", "title", "content", "variables",
      "mediaType", "mediaUrl", "metadata", "createdBy", "createdAt", "submittedBy", "submittedAt",
      "decidedBy", "decidedAt", "rejectionReason", "archivedBy", "archivedAt",
    ]),
    approvalRequests: mkTable("approvalRequests", [
      "id", "businessId", "resourceType", "resourceId", "requestedBy", "status", "decidedBy", "decidedAt", "reason", "createdAt",
    ]),
  };
});

beforeEach(async () => {
  resetFakeDb();
  auditLogCalls.length = 0;
  vi.clearAllMocks();
  // Side-effect import: registers "template_version" with the policy
  // registry. Safe to re-import every test -- Map.set is idempotent.
  await import("../../server/modules/templates/approval-policy");
});

const VARS = [{ name: "customer_name", type: "text" as const, required: true }];

async function makeSubmittedVersion(businessId = 1, actorUserId = 42) {
  const { createTemplate, createOrEditDraftVersion } = await import("../../server/modules/templates/service");
  const t = await createTemplate(businessId, actorUserId, { name: `tpl_${Date.now()}_${Math.random()}`, category: "utility" });
  const v = await createOrEditDraftVersion(businessId, actorUserId, t.id, { content: "Hi {{customer_name}}", variables: VARS });
  return { template: t, version: v };
}

describe("1-3. Create approval request / view pending / template submission", () => {
  it("1. creates a PENDING approval request and transitions the template version to SUBMITTED atomically", async () => {
    const { createApprovalRequest } = await import("../../server/modules/approvals/service");
    const { template, version } = await makeSubmittedVersion();

    const request = await createApprovalRequest(1, 42, "template_version", version.id);
    expect(request.status).toBe("pending");
    expect(request.resourceType).toBe("template_version");
    expect(request.resourceId).toBe(version.id);
    expect(request.businessId).toBe(1);

    const versionRow = tables.get("templateVersions")!.find((v) => v.id === version.id)!;
    expect(versionRow.status).toBe("submitted");
  });

  it("2. lists pending requests for a business", async () => {
    const { createApprovalRequest, listApprovalRequests } = await import("../../server/modules/approvals/service");
    const { version } = await makeSubmittedVersion();
    await createApprovalRequest(1, 42, "template_version", version.id);

    const pending = await listApprovalRequests(1, "pending" as any);
    expect(pending).toHaveLength(1);
  });

  it("3. rejects submitting a resourceType that has no registered policy", async () => {
    const { createApprovalRequest, UnknownResourceTypeError } = await import("../../server/modules/approvals/service");
    await expect(createApprovalRequest(1, 42, "refund", 1)).rejects.toThrow(UnknownResourceTypeError);
  });

  it("rejects submitting a version that is not DRAFT (already submitted)", async () => {
    const { createApprovalRequest, ValidationError } = await import("../../server/modules/approvals/service");
    const { version } = await makeSubmittedVersion();
    await createApprovalRequest(1, 42, "template_version", version.id);
    await expect(createApprovalRequest(1, 42, "template_version", version.id)).rejects.toThrow(ValidationError);
  });
});

describe("4-6. Approve / Reject / Rejection reason", () => {
  it("4. approving flips both the approval request AND the template version, in the same transaction", async () => {
    const { createApprovalRequest, approveRequest } = await import("../../server/modules/approvals/service");
    const { version } = await makeSubmittedVersion();
    const request = await createApprovalRequest(1, 42, "template_version", version.id);

    const decided = await approveRequest(1, 99, request.id, false);
    expect(decided.status).toBe("approved");
    expect(decided.decidedBy).toBe(99);

    const versionRow = tables.get("templateVersions")!.find((v) => v.id === version.id)!;
    expect(versionRow.status).toBe("approved");
  });

  it("5. rejecting flips both the approval request AND the template version", async () => {
    const { createApprovalRequest, rejectRequest } = await import("../../server/modules/approvals/service");
    const { version } = await makeSubmittedVersion();
    const request = await createApprovalRequest(1, 42, "template_version", version.id);

    const decided = await rejectRequest(1, 99, request.id, "Not good enough", false);
    expect(decided.status).toBe("rejected");

    const versionRow = tables.get("templateVersions")!.find((v) => v.id === version.id)!;
    expect(versionRow.status).toBe("rejected");
  });

  it("6. rejection requires a non-empty reason", async () => {
    const { createApprovalRequest, rejectRequest, ValidationError } = await import("../../server/modules/approvals/service");
    const { version } = await makeSubmittedVersion();
    const request = await createApprovalRequest(1, 42, "template_version", version.id);
    await expect(rejectRequest(1, 99, request.id, "", false)).rejects.toThrow(ValidationError);
  });
});

describe("7. Approval history", () => {
  it("decided requests remain queryable and immutable (a second decide attempt fails, the record doesn't change)", async () => {
    const { createApprovalRequest, approveRequest, getApprovalRequest, AlreadyDecidedError } = await import("../../server/modules/approvals/service");
    const { version } = await makeSubmittedVersion();
    const request = await createApprovalRequest(1, 42, "template_version", version.id);
    await approveRequest(1, 99, request.id, false);

    await expect(approveRequest(1, 99, request.id, false)).rejects.toThrow(AlreadyDecidedError);

    const fetched = await getApprovalRequest(1, request.id);
    expect(fetched!.status).toBe("approved");
    expect(fetched!.decidedBy).toBe(99);
  });
});

describe("8-9-10. Tenant isolation, unauthorized viewer/approver (service-level ownership checks)", () => {
  it("8. Business B cannot create an approval request for Business A's template version (resourceId spoofing)", async () => {
    const { createApprovalRequest, NotFoundError } = await import("../../server/modules/approvals/service");
    const { version } = await makeSubmittedVersion(1, 42); // business 1's DRAFT version
    // attacker claims businessId=2 while pointing at business 1's resourceId
    await expect(createApprovalRequest(2, 43, "template_version", version.id)).rejects.toThrow(NotFoundError);
  });

  it("Business B cannot view Business A's approval request", async () => {
    const { createApprovalRequest, getApprovalRequest } = await import("../../server/modules/approvals/service");
    const { version } = await makeSubmittedVersion(1, 42);
    const request = await createApprovalRequest(1, 42, "template_version", version.id);
    expect(await getApprovalRequest(2, request.id)).toBeNull();
  });

  it("20. cross-business resource ID manipulation: Business B cannot approve Business A's request by guessing its id", async () => {
    const { createApprovalRequest, approveRequest, NotFoundError } = await import("../../server/modules/approvals/service");
    const { version } = await makeSubmittedVersion(1, 42);
    const request = await createApprovalRequest(1, 42, "template_version", version.id);
    await expect(approveRequest(2, 99, request.id, false)).rejects.toThrow(NotFoundError);
  });
});

describe("11. Self-approval blocked (P0, enforced at the Approval Center)", () => {
  it("the submitter cannot approve their own request", async () => {
    const { createApprovalRequest, approveRequest, SelfApprovalError } = await import("../../server/modules/approvals/service");
    const { version } = await makeSubmittedVersion(1, 42);
    const request = await createApprovalRequest(1, 42, "template_version", version.id);
    await expect(approveRequest(1, 42, request.id, false)).rejects.toThrow(SelfApprovalError);
  });

  it("super_admin is exempted from the self-approval guard", async () => {
    const { createApprovalRequest, approveRequest } = await import("../../server/modules/approvals/service");
    const { version } = await makeSubmittedVersion(1, 42);
    const request = await createApprovalRequest(1, 42, "template_version", version.id);
    const decided = await approveRequest(1, 42, request.id, true); // same submitter, isSuperAdmin=true
    expect(decided.status).toBe("approved");
  });

  it("a different user CAN approve someone else's request", async () => {
    const { createApprovalRequest, approveRequest } = await import("../../server/modules/approvals/service");
    const { version } = await makeSubmittedVersion(1, 42);
    const request = await createApprovalRequest(1, 42, "template_version", version.id);
    const decided = await approveRequest(1, 99, request.id, false);
    expect(decided.status).toBe("approved");
  });
});

describe("12-13. Resource ownership and state validation", () => {
  it("12. rejects an approval request for a resourceId that doesn't exist at all", async () => {
    const { createApprovalRequest, NotFoundError } = await import("../../server/modules/approvals/service");
    await expect(createApprovalRequest(1, 42, "template_version", 999999)).rejects.toThrow(NotFoundError);
  });

  it("13. rejects submitting an ARCHIVED version for approval (wrong state)", async () => {
    // Structurally unreachable via the normal lifecycle (ARCHIVED isn't
    // reachable from SUBMITTED), but isSubmittable() is tested directly
    // here by archiving a DRAFT version then attempting to submit it.
    const { createTemplate, createOrEditDraftVersion, archiveVersion } = await import("../../server/modules/templates/service");
    const { createApprovalRequest, ValidationError } = await import("../../server/modules/approvals/service");
    const t = await createTemplate(1, 42, { name: "archived_tpl", category: "utility" });
    const v = await createOrEditDraftVersion(1, 42, t.id, { content: "Hi {{customer_name}}", variables: VARS });
    await archiveVersion(1, 42, t.id, v.id); // DRAFT -> ARCHIVED, legal
    await expect(createApprovalRequest(1, 42, "template_version", v.id)).rejects.toThrow(ValidationError);
  });
});

describe("14. Invalid state transition -> proper conflict handling", () => {
  it("approving an already-approved request fails with AlreadyDecidedError, not a silent no-op", async () => {
    const { createApprovalRequest, approveRequest, AlreadyDecidedError } = await import("../../server/modules/approvals/service");
    const { version } = await makeSubmittedVersion();
    const request = await createApprovalRequest(1, 42, "template_version", version.id);
    await approveRequest(1, 99, request.id, false);
    await expect(approveRequest(1, 99, request.id, false)).rejects.toThrow(AlreadyDecidedError);
  });
});

describe("15-16. Duplicate approval / duplicate rejection", () => {
  it("15. cannot approve the same request twice", async () => {
    const { createApprovalRequest, approveRequest, AlreadyDecidedError } = await import("../../server/modules/approvals/service");
    const { version } = await makeSubmittedVersion();
    const request = await createApprovalRequest(1, 42, "template_version", version.id);
    await approveRequest(1, 99, request.id, false);
    await expect(approveRequest(1, 98, request.id, false)).rejects.toThrow(AlreadyDecidedError);
  });

  it("16. cannot reject the same request twice", async () => {
    const { createApprovalRequest, rejectRequest, AlreadyDecidedError } = await import("../../server/modules/approvals/service");
    const { version } = await makeSubmittedVersion();
    const request = await createApprovalRequest(1, 42, "template_version", version.id);
    await rejectRequest(1, 99, request.id, "no", false);
    await expect(rejectRequest(1, 98, request.id, "no again", false)).rejects.toThrow(AlreadyDecidedError);
  });

  it("cannot approve after rejecting (terminal states don't cross-transition)", async () => {
    const { createApprovalRequest, approveRequest, rejectRequest, AlreadyDecidedError } = await import("../../server/modules/approvals/service");
    const { version } = await makeSubmittedVersion();
    const request = await createApprovalRequest(1, 42, "template_version", version.id);
    await rejectRequest(1, 99, request.id, "no", false);
    await expect(approveRequest(1, 98, request.id, false)).rejects.toThrow(AlreadyDecidedError);
  });
});

describe("17. Concurrent approval/rejection -- only one valid terminal decision wins", () => {
  it("Approver A approves AND Approver B rejects at approximately the same time: exactly one succeeds", async () => {
    const { createApprovalRequest, approveRequest, rejectRequest } = await import("../../server/modules/approvals/service");
    const { version } = await makeSubmittedVersion();
    const request = await createApprovalRequest(1, 42, "template_version", version.id);

    // Fired concurrently (not sequentially awaited) -- the atomic
    // UPDATE ... WHERE status='pending' compare-and-swap (same pattern as
    // billing-engine.ts's reserveWalletAmount) means only the operation
    // that reaches the UPDATE first while status is still 'pending' wins;
    // the other's WHERE clause matches zero rows once the first commits.
    const [approveResult, rejectResult] = await Promise.allSettled([
      approveRequest(1, 99, request.id, false),
      rejectRequest(1, 98, request.id, "racing rejection", false),
    ]);

    const outcomes = [approveResult.status, rejectResult.status];
    const fulfilledCount = outcomes.filter((s) => s === "fulfilled").length;
    const rejectedCount = outcomes.filter((s) => s === "rejected").length;
    expect(fulfilledCount).toBe(1);
    expect(rejectedCount).toBe(1);

    // No contradictory state: the request is in exactly one terminal status.
    const finalRow = tables.get("approvalRequests")!.find((r) => r.id === request.id)!;
    expect(["approved", "rejected"]).toContain(finalRow.status);

    // The template version's status agrees with whichever decision won --
    // never left in an intermediate/contradictory state.
    const versionRow = tables.get("templateVersions")!.find((v) => v.id === version.id)!;
    expect(versionRow.status).toBe(finalRow.status);
  });
});

describe("18. Exact template-version binding", () => {
  it("an approval request created for v1 never applies to v2, even if v2 is later created for the same template", async () => {
    const { createTemplate, createOrEditDraftVersion, submitVersion } = await import("../../server/modules/templates/service");
    const { createApprovalRequest, approveRequest, getApprovalRequest } = await import("../../server/modules/approvals/service");

    const t = await createTemplate(1, 42, { name: "versioned", category: "utility" });
    const v1 = await createOrEditDraftVersion(1, 42, t.id, { content: "v1 {{customer_name}}", variables: VARS });
    const requestV1 = await createApprovalRequest(1, 42, "template_version", v1.id);
    await approveRequest(1, 99, requestV1.id, false);

    // Now create v2 (editing after v1 is approved creates a new version, per Phase 2)
    const v2 = await createOrEditDraftVersion(1, 42, t.id, { content: "v2 {{customer_name}}", variables: VARS });
    expect(v2.id).not.toBe(v1.id);
    expect(v2.status).toBe("draft"); // NOT auto-approved

    const requestV1Reloaded = await getApprovalRequest(1, requestV1.id);
    expect(requestV1Reloaded!.resourceId).toBe(v1.id); // still points at v1, never silently repointed
  });
});

describe("19. Archived template cannot be approved", () => {
  it("an ARCHIVED version cannot be submitted for approval at all (covered above, restated for the numbered list)", async () => {
    const { createTemplate, createOrEditDraftVersion, archiveVersion } = await import("../../server/modules/templates/service");
    const { createApprovalRequest, ValidationError } = await import("../../server/modules/approvals/service");
    const t = await createTemplate(1, 42, { name: "archived_tpl_2", category: "utility" });
    const v = await createOrEditDraftVersion(1, 42, t.id, { content: "Hi {{customer_name}}", variables: VARS });
    await archiveVersion(1, 42, t.id, v.id);
    await expect(createApprovalRequest(1, 42, "template_version", v.id)).rejects.toThrow(ValidationError);
  });
});

describe("21. Audit logging", () => {
  it("create/approve/reject each write a real audit_logs entry (not messagingEvents)", async () => {
    const { createApprovalRequest, approveRequest } = await import("../../server/modules/approvals/service");
    const { version } = await makeSubmittedVersion();
    const request = await createApprovalRequest(1, 42, "template_version", version.id);
    await approveRequest(1, 99, request.id, false);

    expect(auditLogCalls.some((c) => c.entityType === "approval_request" && c.action === "create")).toBe(true);
    expect(auditLogCalls.some((c) => c.entityType === "approval_request" && c.action === "approve")).toBe(true);
    for (const call of auditLogCalls) {
      expect(call.organizationId).toBe(1);
    }
  });
});
