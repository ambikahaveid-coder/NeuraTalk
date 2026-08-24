import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Business Message Template Engine tests (Phase 2).
 * See docs/neura-ecosystem/27_BUSINESS_TEMPLATE_ENGINE_IMPLEMENTATION.md.
 * In-memory fake DB with real filter/insert/update semantics, matching the
 * pattern established in messaging-phase0.test.ts and business-profile.test.ts.
 */

type Row = Record<string, any>;
const tables = new Map<string, Row[]>();
const idCounters = new Map<string, number>();

function resetFakeDb() {
  tables.clear();
  idCounters.clear();
  for (const t of ["organizations", "users", "templates", "templateVersions"]) {
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
    if (spec?.__desc) { this.orderField = spec.field; this.orderDesc = true; }
    else { this.orderField = spec; }
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
    let cond: any = null;
    const chain: any = {
      where(c: any) {
        cond = c;
        const affected = (tables.get(this.tableName2) ?? []).filter((r: Row) => evalCond(r, cond));
        for (const row of affected) Object.assign(row, patch);
        chain._affected = affected;
        return chain;
      },
      tableName2: this.tableName,
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
};

const auditCalls: Array<{ actorUserId: number; businessId: number; action: string; templateId: number; versionId?: number; metadata: any }> = [];

vi.mock("../../server/db", () => ({ db: fakeDb }));
vi.mock("../../server/observability", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock("../../server/modules/templates/audit", () => ({
  createAuditLog: vi.fn(async (actorUserId: number, businessId: number, action: string, templateId: number, versionId: number | undefined, metadata: any) => {
    auditCalls.push({ actorUserId, businessId, action, templateId, versionId, metadata });
  }),
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
  };
});

beforeEach(() => {
  resetFakeDb();
  auditCalls.length = 0;
  vi.clearAllMocks();
});

const VARS = [{ name: "customer_name", type: "text" as const, required: true }];

describe("1. Template creation", () => {
  it("creates a template with a valid category", async () => {
    const { createTemplate } = await import("../../server/modules/templates/service");
    const t = await createTemplate(1, 42, { name: "appointment_confirmation", category: "utility" });
    expect(t.businessId).toBe(1);
    expect(t.category).toBe("utility");
    expect(auditCalls.some((c) => c.action === "create" && c.templateId === t.id)).toBe(true);
  });

  it("rejects an invalid/fake category (server-governed, not client-defined)", async () => {
    const { createTemplate, ValidationError } = await import("../../server/modules/templates/service");
    await expect(createTemplate(1, 42, { name: "x", category: "marketing_approved" })).rejects.toThrow(ValidationError);
    await expect(createTemplate(1, 42, { name: "y", category: "otp_verified" })).rejects.toThrow(ValidationError);
  });

  it("rejects a duplicate name within the same business", async () => {
    const { createTemplate, ValidationError } = await import("../../server/modules/templates/service");
    await createTemplate(1, 42, { name: "dup", category: "utility" });
    await expect(createTemplate(1, 42, { name: "dup", category: "marketing" })).rejects.toThrow(ValidationError);
  });

  it("allows the same name across different businesses (no cross-tenant name collision)", async () => {
    const { createTemplate } = await import("../../server/modules/templates/service");
    await createTemplate(1, 42, { name: "shared_name", category: "utility" });
    const t2 = await createTemplate(2, 43, { name: "shared_name", category: "utility" });
    expect(t2.businessId).toBe(2);
  });
});

describe("2-3. Template listing and retrieval", () => {
  it("2. lists only the requesting business's templates", async () => {
    const { createTemplate, listTemplates } = await import("../../server/modules/templates/service");
    await createTemplate(1, 42, { name: "a", category: "utility" });
    await createTemplate(2, 43, { name: "b", category: "utility" });
    const list1 = await listTemplates(1);
    expect(list1).toHaveLength(1);
    expect(list1[0].name).toBe("a");
  });

  it("3. retrieves a single template with its versions", async () => {
    const { createTemplate, createOrEditDraftVersion, getTemplate } = await import("../../server/modules/templates/service");
    const t = await createTemplate(1, 42, { name: "a", category: "utility" });
    await createOrEditDraftVersion(1, 42, t.id, { content: "Hello {{customer_name}}", variables: VARS });
    const fetched = await getTemplate(1, t.id);
    expect(fetched!.versions).toHaveLength(1);
  });

  it("returns null for a non-existent template", async () => {
    const { getTemplate } = await import("../../server/modules/templates/service");
    expect(await getTemplate(1, 999)).toBeNull();
  });
});

describe("4-5. Draft editing and version creation", () => {
  it("4. editing an existing DRAFT updates it in place (same version number)", async () => {
    const { createTemplate, createOrEditDraftVersion } = await import("../../server/modules/templates/service");
    const t = await createTemplate(1, 42, { name: "a", category: "utility" });
    const v1 = await createOrEditDraftVersion(1, 42, t.id, { content: "Hi {{customer_name}}", variables: VARS });
    const v1edited = await createOrEditDraftVersion(1, 42, t.id, { content: "Hello {{customer_name}}!", variables: VARS });
    expect(v1edited.id).toBe(v1.id);
    expect(v1edited.versionNumber).toBe(1);
    expect(v1edited.content).toBe("Hello {{customer_name}}!");
  });

  it("5. editing after the latest version is APPROVED creates a NEW version, never mutates the approved one", async () => {
    const { createTemplate, createOrEditDraftVersion, submitVersion, approveVersion } = await import("../../server/modules/templates/service");
    const t = await createTemplate(1, 42, { name: "a", category: "utility" });
    const v1 = await createOrEditDraftVersion(1, 42, t.id, { content: "Hi {{customer_name}}", variables: VARS });
    await submitVersion(1, 42, t.id, v1.id);
    await approveVersion(1, 99, t.id, v1.id); // different approver, not self

    const v2 = await createOrEditDraftVersion(1, 42, t.id, { content: "Updated {{customer_name}}", variables: VARS });
    expect(v2.id).not.toBe(v1.id);
    expect(v2.versionNumber).toBe(2);
    expect(v2.status).toBe("draft");

    // v1's content is untouched
    const v1reloaded = tables.get("templateVersions")!.find((r) => r.id === v1.id)!;
    expect(v1reloaded.content).toBe("Hi {{customer_name}}");
    expect(v1reloaded.status).toBe("approved");
  });

  it("21. published (approved) version immutability -- direct attempt to edit an approved version is impossible via the draft-edit path (creates v2 instead)", async () => {
    const { createTemplate, createOrEditDraftVersion, submitVersion, approveVersion } = await import("../../server/modules/templates/service");
    const t = await createTemplate(1, 42, { name: "a", category: "authentication" });
    const v1 = await createOrEditDraftVersion(1, 42, t.id, { content: "OTP: {{customer_name}}", variables: VARS });
    await submitVersion(1, 42, t.id, v1.id);
    await approveVersion(1, 99, t.id, v1.id);

    const before = { ...tables.get("templateVersions")!.find((r) => r.id === v1.id)! };
    await createOrEditDraftVersion(1, 42, t.id, { content: "totally different", variables: [] });
    const after = tables.get("templateVersions")!.find((r) => r.id === v1.id)!;
    expect(after.content).toBe(before.content);
    expect(after.status).toBe("approved");
  });

  it("language-scoped versioning: two languages for the same template have independent version 1s", async () => {
    const { createTemplate, createOrEditDraftVersion } = await import("../../server/modules/templates/service");
    const t = await createTemplate(1, 42, { name: "a", category: "utility" });
    const en = await createOrEditDraftVersion(1, 42, t.id, { language: "en", content: "Hi {{customer_name}}", variables: VARS });
    const te = await createOrEditDraftVersion(1, 42, t.id, { language: "te", content: "Namaste {{customer_name}}", variables: VARS });
    expect(en.versionNumber).toBe(1);
    expect(te.versionNumber).toBe(1);
    expect(en.language).toBe("en");
    expect(te.language).toBe("te");
  });

  it("18. multi-language versions: 18. approving one language's version does not affect another language's draft", async () => {
    const { createTemplate, createOrEditDraftVersion, submitVersion, approveVersion, getTemplate } = await import("../../server/modules/templates/service");
    const t = await createTemplate(1, 42, { name: "a", category: "utility" });
    const en = await createOrEditDraftVersion(1, 42, t.id, { language: "en", content: "Hi {{customer_name}}", variables: VARS });
    await createOrEditDraftVersion(1, 42, t.id, { language: "hi", content: "Namaste {{customer_name}}", variables: VARS });
    await submitVersion(1, 42, t.id, en.id);
    await approveVersion(1, 99, t.id, en.id);

    const fetched = await getTemplate(1, t.id);
    const hiVersion = fetched!.versions.find((v: any) => v.language === "hi")!;
    expect(hiVersion.status).toBe("draft");
  });
});

describe("6-9. Submit / Approve / Reject / Archive lifecycle", () => {
  it("6. submits a draft version", async () => {
    const { createTemplate, createOrEditDraftVersion, submitVersion } = await import("../../server/modules/templates/service");
    const t = await createTemplate(1, 42, { name: "a", category: "utility" });
    const v = await createOrEditDraftVersion(1, 42, t.id, { content: "Hi {{customer_name}}", variables: VARS });
    const submitted = await submitVersion(1, 42, t.id, v.id);
    expect(submitted.status).toBe("submitted");
    expect(submitted.submittedBy).toBe(42);
  });

  it("7. approves a submitted version (different approver)", async () => {
    const { createTemplate, createOrEditDraftVersion, submitVersion, approveVersion } = await import("../../server/modules/templates/service");
    const t = await createTemplate(1, 42, { name: "a", category: "utility" });
    const v = await createOrEditDraftVersion(1, 42, t.id, { content: "Hi {{customer_name}}", variables: VARS });
    await submitVersion(1, 42, t.id, v.id);
    const approved = await approveVersion(1, 99, t.id, v.id);
    expect(approved.status).toBe("approved");
    expect(approved.decidedBy).toBe(99);
  });

  it("8. rejects a submitted version with a required reason", async () => {
    const { createTemplate, createOrEditDraftVersion, submitVersion, rejectVersion, ValidationError } = await import("../../server/modules/templates/service");
    const t = await createTemplate(1, 42, { name: "a", category: "utility" });
    const v = await createOrEditDraftVersion(1, 42, t.id, { content: "Hi {{customer_name}}", variables: VARS });
    await submitVersion(1, 42, t.id, v.id);
    await expect(rejectVersion(1, 99, t.id, v.id, "")).rejects.toThrow(ValidationError);
    const rejected = await rejectVersion(1, 99, t.id, v.id, "Grammar issue");
    expect(rejected.status).toBe("rejected");
    expect(rejected.rejectionReason).toBe("Grammar issue");
  });

  it("9. archives an approved version", async () => {
    const { createTemplate, createOrEditDraftVersion, submitVersion, approveVersion, archiveVersion } = await import("../../server/modules/templates/service");
    const t = await createTemplate(1, 42, { name: "a", category: "utility" });
    const v = await createOrEditDraftVersion(1, 42, t.id, { content: "Hi {{customer_name}}", variables: VARS });
    await submitVersion(1, 42, t.id, v.id);
    await approveVersion(1, 99, t.id, v.id);
    const archived = await archiveVersion(1, 99, t.id, v.id);
    expect(archived.status).toBe("archived");
    expect(archived.archivedBy).toBe(99);
  });

  it("rejected version returns to DRAFT via the server-controlled transition, then becomes editable again", async () => {
    const { createTemplate, createOrEditDraftVersion, submitVersion, rejectVersion, returnToDraft } = await import("../../server/modules/templates/service");
    const t = await createTemplate(1, 42, { name: "a", category: "utility" });
    const v = await createOrEditDraftVersion(1, 42, t.id, { content: "Hi {{customer_name}}", variables: VARS });
    await submitVersion(1, 42, t.id, v.id);
    await rejectVersion(1, 99, t.id, v.id, "Needs work");
    const backToDraft = await returnToDraft(1, 42, t.id, v.id);
    expect(backToDraft.status).toBe("draft");
    expect(backToDraft.rejectionReason).toBeNull();

    const edited = await createOrEditDraftVersion(1, 42, t.id, { content: "Fixed {{customer_name}}", variables: VARS });
    expect(edited.id).toBe(v.id); // same row, in-place edit
    expect(edited.content).toBe("Fixed {{customer_name}}");
  });
});

describe("10. Illegal state transitions", () => {
  it("cannot approve a DRAFT version directly (must submit first)", async () => {
    const { createTemplate, createOrEditDraftVersion, approveVersion, IllegalTemplateTransitionError } = await import("../../server/modules/templates/service");
    const t = await createTemplate(1, 42, { name: "a", category: "utility" });
    const v = await createOrEditDraftVersion(1, 42, t.id, { content: "Hi {{customer_name}}", variables: VARS });
    await expect(approveVersion(1, 99, t.id, v.id)).rejects.toThrow(IllegalTemplateTransitionError);
  });

  it("cannot archive a SUBMITTED version (must be decided first)", async () => {
    const { createTemplate, createOrEditDraftVersion, submitVersion, archiveVersion, IllegalTemplateTransitionError } = await import("../../server/modules/templates/service");
    const t = await createTemplate(1, 42, { name: "a", category: "utility" });
    const v = await createOrEditDraftVersion(1, 42, t.id, { content: "Hi {{customer_name}}", variables: VARS });
    await submitVersion(1, 42, t.id, v.id);
    await expect(archiveVersion(1, 42, t.id, v.id)).rejects.toThrow(IllegalTemplateTransitionError);
  });

  it("cannot transition an ARCHIVED (terminal) version anywhere", async () => {
    const { createTemplate, createOrEditDraftVersion, submitVersion, approveVersion, archiveVersion, IllegalTemplateTransitionError } = await import("../../server/modules/templates/service");
    const t = await createTemplate(1, 42, { name: "a", category: "utility" });
    const v = await createOrEditDraftVersion(1, 42, t.id, { content: "Hi {{customer_name}}", variables: VARS });
    await submitVersion(1, 42, t.id, v.id);
    await approveVersion(1, 99, t.id, v.id);
    await archiveVersion(1, 99, t.id, v.id);
    await expect(archiveVersion(1, 99, t.id, v.id)).rejects.toThrow(IllegalTemplateTransitionError);
  });

  it("returns a 'conflict-shaped' error (IllegalTemplateTransitionError, mapped to 409 at the controller) rather than a generic 500", async () => {
    const { createTemplate, createOrEditDraftVersion, rejectVersion, IllegalTemplateTransitionError } = await import("../../server/modules/templates/service");
    const t = await createTemplate(1, 42, { name: "a", category: "utility" });
    const v = await createOrEditDraftVersion(1, 42, t.id, { content: "Hi {{customer_name}}", variables: VARS });
    // still DRAFT -- reject requires SUBMITTED
    const err = await rejectVersion(1, 99, t.id, v.id, "reason").catch((e) => e);
    expect(err).toBeInstanceOf(IllegalTemplateTransitionError);
  });
});

describe("11. Tenant isolation", () => {
  it("Business A cannot read Business B's template", async () => {
    const { createTemplate, getTemplate } = await import("../../server/modules/templates/service");
    const t = await createTemplate(2, 43, { name: "b_only", category: "utility" });
    expect(await getTemplate(1, t.id)).toBeNull();
  });

  it("Business A cannot edit/submit/approve/archive Business B's template (ID reuse across businessId)", async () => {
    const { createTemplate, createOrEditDraftVersion, NotFoundError } = await import("../../server/modules/templates/service");
    const t = await createTemplate(2, 43, { name: "b_only", category: "utility" });
    await expect(createOrEditDraftVersion(1, 42, t.id, { content: "x", variables: [] })).rejects.toThrow(NotFoundError);
  });

  it("20. cross-tenant ID manipulation: referencing Business B's versionId while authenticated for Business A is denied even if the version id is a valid number", async () => {
    const { createTemplate, createOrEditDraftVersion, submitVersion, NotFoundError } = await import("../../server/modules/templates/service");
    const tB = await createTemplate(2, 43, { name: "b_only", category: "utility" });
    const vB = await createOrEditDraftVersion(2, 43, tB.id, { content: "Hi {{customer_name}}", variables: VARS });
    // Attacker (business 1) guesses/reuses business B's real template+version ids
    await expect(submitVersion(1, 42, tB.id, vB.id)).rejects.toThrow(NotFoundError);
  });
});

describe("RBAC: approveVersion/rejectVersion no longer self-check (moved to the Approval Center, Phase 3)", () => {
  // Self-approval enforcement moved ENTIRELY to server/modules/approvals/service.ts
  // as of Phase 3 -- see tests/unit/approvals.test.ts for that coverage.
  // templates/service.ts's approveVersion is now a pure state-transition
  // function, callable by anyone who can reach it (the Approval Center is
  // the only caller in production, via its own policy-checked decide()).
  it("approveVersion performs the transition regardless of who submitted (no self-check here anymore -- verifies the refactor, not a security gap)", async () => {
    const { createTemplate, createOrEditDraftVersion, submitVersion, approveVersion } = await import("../../server/modules/templates/service");
    const t = await createTemplate(1, 42, { name: "a", category: "utility" });
    const v = await createOrEditDraftVersion(1, 42, t.id, { content: "Hi {{customer_name}}", variables: VARS });
    await submitVersion(1, 42, t.id, v.id);
    const approved = await approveVersion(1, 42, t.id, v.id); // same user who submitted -- allowed at THIS layer
    expect(approved.status).toBe("approved");
  });
});

describe("14-17. Variable declaration and safe rendering", () => {
  it("14. required variables must be present at render time", async () => {
    const { createTemplate, createOrEditDraftVersion, previewVersion } = await import("../../server/modules/templates/service");
    const { TemplateRenderError } = await import("../../server/modules/templates/render");
    const t = await createTemplate(1, 42, { name: "a", category: "utility" });
    const v = await createOrEditDraftVersion(1, 42, t.id, { content: "Hi {{customer_name}}", variables: VARS });
    await expect(previewVersion(1, t.id, v.id, {})).rejects.toThrow(TemplateRenderError);
  });

  it("15. unknown/undeclared variables in render input are rejected, not silently ignored", async () => {
    const { createTemplate, createOrEditDraftVersion, previewVersion } = await import("../../server/modules/templates/service");
    const { TemplateRenderError } = await import("../../server/modules/templates/render");
    const t = await createTemplate(1, 42, { name: "a", category: "utility" });
    const v = await createOrEditDraftVersion(1, 42, t.id, { content: "Hi {{customer_name}}", variables: VARS });
    await expect(previewVersion(1, t.id, v.id, { customer_name: "Alice", sneaky: "value" })).rejects.toThrow(TemplateRenderError);
  });

  it("16. invalid variable types are rejected (number/date type mismatch)", async () => {
    const { createTemplate, createOrEditDraftVersion, previewVersion } = await import("../../server/modules/templates/service");
    const { TemplateRenderError } = await import("../../server/modules/templates/render");
    const t = await createTemplate(1, 42, { name: "a", category: "utility" });
    const v = await createOrEditDraftVersion(1, 42, t.id, {
      content: "Order {{order_id}} total {{amount}}",
      variables: [{ name: "order_id", type: "text", required: true }, { name: "amount", type: "number", required: true }],
    });
    await expect(previewVersion(1, t.id, v.id, { order_id: "A1", amount: "not-a-number" })).rejects.toThrow(TemplateRenderError);
  });

  it("17. safe rendering: substitutes declared variables, never executes code, never lets a value inject a second-order placeholder", async () => {
    const { createTemplate, createOrEditDraftVersion, previewVersion } = await import("../../server/modules/templates/service");
    const t = await createTemplate(1, 42, { name: "a", category: "utility" });
    const v = await createOrEditDraftVersion(1, 42, t.id, { content: "Hi {{customer_name}}, welcome!", variables: VARS });
    const result = await previewVersion(1, t.id, v.id, { customer_name: "{{malicious_injection}}" });
    // the injected value is treated as a literal string, never re-interpreted as a second placeholder
    expect(result.rendered).toBe("Hi {{malicious_injection}}, welcome!");
    // proves it was substituted (not left as the original token) and that
    // the literal braces in the VALUE were not re-scanned/re-substituted
    expect(result.rendered).not.toContain("{{customer_name}}");
  });

  it("rejects content referencing an undeclared placeholder at SAVE time, not just render time", async () => {
    const { createTemplate, createOrEditDraftVersion } = await import("../../server/modules/templates/service");
    const { TemplateContentError } = await import("../../server/modules/templates/render");
    const t = await createTemplate(1, 42, { name: "a", category: "utility" });
    await expect(createOrEditDraftVersion(1, 42, t.id, { content: "Hi {{undeclared}}", variables: [] })).rejects.toThrow(TemplateContentError);
  });

  it("rejects a malformed placeholder at save time", async () => {
    const { createTemplate, createOrEditDraftVersion } = await import("../../server/modules/templates/service");
    const { TemplateContentError } = await import("../../server/modules/templates/render");
    const t = await createTemplate(1, 42, { name: "a", category: "utility" });
    await expect(createOrEditDraftVersion(1, 42, t.id, { content: "Hi {{unterminated", variables: [] })).rejects.toThrow(TemplateContentError);
  });

  it("rejects oversized content", async () => {
    const { createTemplate, createOrEditDraftVersion } = await import("../../server/modules/templates/service");
    const { TemplateContentError } = await import("../../server/modules/templates/render");
    const t = await createTemplate(1, 42, { name: "a", category: "utility" });
    await expect(createOrEditDraftVersion(1, 42, t.id, { content: "a".repeat(5000), variables: [] })).rejects.toThrow(TemplateContentError);
  });
});

describe("19. Audit logging", () => {
  it("every lifecycle mutation writes an audit entry with actor/business/template/version", async () => {
    const { createTemplate, createOrEditDraftVersion, submitVersion, approveVersion, archiveVersion } = await import("../../server/modules/templates/service");
    const t = await createTemplate(1, 42, { name: "a", category: "utility" });
    const v = await createOrEditDraftVersion(1, 42, t.id, { content: "Hi {{customer_name}}", variables: VARS });
    await submitVersion(1, 42, t.id, v.id);
    await approveVersion(1, 99, t.id, v.id);
    await archiveVersion(1, 99, t.id, v.id);

    const actions = auditCalls.map((c) => c.action);
    expect(actions).toEqual(expect.arrayContaining(["create", "create", "submit", "approve", "archive"]));
    for (const call of auditCalls) {
      expect(call.businessId).toBe(1);
      expect(call.templateId).toBe(t.id);
    }
  });
});
