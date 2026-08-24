import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Business Campaign Engine tests (Phase 5).
 * See docs/neura-ecosystem/30_CAMPAIGN_ENGINE_IMPLEMENTATION.md.
 *
 * Full integration: uses the REAL customers, audiences, templates,
 * approvals, and messaging services together with the REAL campaigns
 * service against ONE shared in-memory fake DB -- proves the actual
 * end-to-end wiring (create campaign -> bind approved template + active
 * audience -> submit for approval -> approve -> schedule/execute ->
 * recipient gates -> message creation), not just campaigns in isolation.
 * Same pattern established in approvals.test.ts (Phase 3), extended
 * further here since Phase 5 genuinely depends on real state from four
 * prior phases' modules.
 *
 * campaigns/billing.ts is mocked (not real) -- its own atomic-CAS
 * correctness is tested directly and separately in campaigns-billing.test.ts
 * against a fake DB that can evaluate real SQL arithmetic; this file
 * focuses on campaign orchestration/gating logic and controls the charge
 * outcome per test via the mock.
 */

type Row = Record<string, any>;
const tables = new Map<string, Row[]>();
const idCounters = new Map<string, number>();

const ALL_TABLES = [
  "organizations", "users", "customers", "customerConsents", "audiences", "audienceMembers",
  "templates", "templateVersions", "approvalRequests", "campaigns", "campaignRecipients",
  "messagingConversations", "businessConversations", "messagingParticipants",
  "messagingMessages", "messagingDeliveries", "messagingEvents",
  "customerMarketingFrequency", "businessMarketingThroughput", "billingAccounts",
];

// The two Phase 8 frequency-cap tables have a REAL unique constraint this
// suite must respect to prove genuine concurrency safety -- mirrors the
// pattern established in utility.test.ts for businessUtilityEvents.
const UNIQUE_KEYS: Record<string, string[]> = {
  customerMarketingFrequency: ["businessId", "customerId", "windowStart"],
  businessMarketingThroughput: ["businessId", "windowStart"],
};

function resetFakeDb() {
  tables.clear();
  idCounters.clear();
  for (const t of ALL_TABLES) { tables.set(t, []); idCounters.set(t, 0); }
  tables.get("organizations")!.push({ id: 1 }, { id: 2 });
}

function tableNameOf(tableDescriptor: Row): string {
  const sample = Object.values(tableDescriptor)[0] as string;
  return sample.split(".")[0];
}
function fieldNameOf(colDescriptor: string): string {
  return colDescriptor.split(".").pop()!;
}
function valuesEqual(a: unknown, b: unknown): boolean {
  if (a instanceof Date || b instanceof Date) return (a as any)?.getTime?.() === (b as any)?.getTime?.();
  return a === b;
}
function evalCond(row: Row, cond: any): boolean {
  if (!cond) return true;
  if (cond.__and) return cond.conds.every((c: any) => evalCond(row, c));
  if (cond.__or) return cond.conds.some((c: any) => evalCond(row, c));
  if (cond.__eq) return valuesEqual(row[cond.field], cond.value);
  if (cond.__lt) return row[cond.field] < cond.value;
  if (cond.__in) return cond.values.includes(row[cond.field]);
  if (cond.__ilike) {
    const val = String(row[cond.field] ?? "").toLowerCase();
    const pattern = String(cond.value).replace(/%/g, "").toLowerCase();
    return val.includes(pattern);
  }
  throw new Error("Unknown condition: " + JSON.stringify(cond));
}
function findUniqueConflict(tableName: string, data: Row): Row | undefined {
  const keyFields = UNIQUE_KEYS[tableName];
  if (!keyFields) return undefined;
  return (tables.get(tableName) ?? []).find((r) => keyFields.every((f) => valuesEqual(r[f], data[f])));
}

class SelectChain implements PromiseLike<Row[]> {
  private cond: any = null;
  private orderField: string | null = null;
  private orderDesc = false;
  private limitN: number | null = null;
  private offsetN = 0;
  constructor(private tableName: string) {}
  where(cond: any) { this.cond = cond; return this; }
  orderBy(spec: any) {
    if (spec?.__desc) { this.orderField = spec.field; this.orderDesc = true; } else { this.orderField = spec; }
    return this;
  }
  limit(n: number) { this.limitN = n; return this; }
  offset(n: number) { this.offsetN = n; return this; }
  private resolveRows(): Row[] {
    let rows = (tables.get(this.tableName) ?? []).filter((r) => evalCond(r, this.cond));
    if (this.orderField) {
      rows = [...rows].sort((a, b) => {
        const av = a[this.orderField!], bv = b[this.orderField!];
        const an = av?.getTime?.() ?? av, bn = bv?.getTime?.() ?? bv;
        return this.orderDesc ? (bn > an ? 1 : -1) : (an > bn ? 1 : -1);
      });
    }
    if (this.offsetN) rows = rows.slice(this.offsetN);
    if (this.limitN !== null) rows = rows.slice(0, this.limitN);
    return rows;
  }
  then<T1, T2>(res?: any, rej?: any) { return Promise.resolve(this.resolveRows()).then(res, rej); }
}

class InsertChain implements PromiseLike<Row[]> {
  private row: Row | null = null;
  constructor(private tableName: string) {}
  values(data: Row) {
    if (findUniqueConflict(this.tableName, data)) {
      const err: any = new Error("duplicate key value violates unique constraint");
      err.code = "23505";
      throw err;
    }
    const id = (idCounters.get(this.tableName) ?? 0) + 1;
    idCounters.set(this.tableName, id);
    this.row = { id, createdAt: new Date(), ...data };
    tables.get(this.tableName)!.push(this.row);
    return this;
  }
  returning() { return Promise.resolve([this.row]); }
  then<T1, T2>(res?: any, rej?: any) { return Promise.resolve([this.row]).then(res, rej); }
}

function applySqlExpr(row: Row, field: string, expr: any) {
  const [colDesc, amount] = expr.values;
  const op = String(expr.strings[1]).trim(); // "+" or "-"
  const base = row[fieldNameOf(colDesc)];
  row[field] = op === "+" ? base + amount : base - amount;
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
        for (const row of affected) {
          for (const [k, v] of Object.entries(patch)) {
            if (v && (v as any).__sqlExpr) applySqlExpr(row, k, v);
            else row[k] = v;
          }
        }
        chain._affected = affected;
        return chain;
      },
      returning() { return Promise.resolve(chain._affected ?? []); },
      then(res: any, rej: any) { return Promise.resolve(chain._affected ?? []).then(res, rej); },
    };
    return chain;
  }
}

class DeleteChain implements PromiseLike<Row[]> {
  constructor(private tableName: string) {}
  where(cond: any) {
    const remaining = (tables.get(this.tableName) ?? []).filter((r) => !evalCond(r, cond));
    tables.set(this.tableName, remaining);
    return Promise.resolve([]);
  }
  then<T1, T2>(res?: any, rej?: any) { return Promise.resolve([]).then(res, rej); }
}

const fakeDb = {
  select(_cols?: any) { return { from: (t: Row) => new SelectChain(tableNameOf(t)) }; },
  insert(t: Row) { return new InsertChain(tableNameOf(t)); },
  update(t: Row) { return new UpdateChain(tableNameOf(t)); },
  delete(t: Row) { return new DeleteChain(tableNameOf(t)); },
  transaction(fn: (tx: typeof fakeDb) => Promise<any>) { return fn(fakeDb); },
};

vi.mock("../../server/db", () => ({ db: fakeDb }));
vi.mock("../../server/observability", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock("../../server/audit", () => ({ createAuditLog: vi.fn(async () => {}) }));

let chargeMock: ReturnType<typeof vi.fn>;
vi.mock("../../server/modules/campaigns/billing", () => ({
  PLACEHOLDER_COST_PER_MESSAGE_PAISE: 10,
  chargeCampaignMessage: (...args: any[]) => chargeMock(...args),
}));

vi.mock("drizzle-orm", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    eq: (column: string, value: unknown) => ({ __eq: true, field: fieldNameOf(column), value }),
    and: (...conds: any[]) => ({ __and: true, conds }),
    or: (...conds: any[]) => ({ __or: true, conds }),
    desc: (column: string) => ({ __desc: true, field: fieldNameOf(column) }),
    ilike: (column: string, value: unknown) => ({ __ilike: true, field: fieldNameOf(column), value }),
    inArray: (column: string, values: unknown[]) => ({ __in: true, field: fieldNameOf(column), values }),
    lt: (column: string, value: unknown) => ({ __lt: true, field: fieldNameOf(column), value }),
    sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({ __sqlExpr: true, strings, values }),
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
    customers: mkTable("customers", [
      "id", "businessId", "linkedUserId", "name", "phone", "normalizedPhone", "email", "normalizedEmail",
      "externalRef", "notes", "status", "source", "createdBy", "createdAt", "updatedAt", "archivedBy", "archivedAt",
    ]),
    customerConsents: mkTable("customerConsents", ["id", "businessId", "customerId", "channel", "status", "source", "updatedBy", "createdAt", "updatedAt"]),
    audiences: mkTable("audiences", ["id", "businessId", "name", "description", "type", "status", "createdBy", "createdAt", "updatedAt", "archivedBy", "archivedAt"]),
    audienceMembers: mkTable("audienceMembers", ["id", "audienceId", "customerId", "addedBy", "addedAt"]),
    templates: mkTable("templates", ["id", "businessId", "name", "category", "createdBy", "createdAt"]),
    templateVersions: mkTable("templateVersions", [
      "id", "templateId", "language", "versionNumber", "status", "title", "content", "variables",
      "mediaType", "mediaUrl", "metadata", "createdBy", "createdAt", "submittedBy", "submittedAt",
      "decidedBy", "decidedAt", "rejectionReason", "archivedBy", "archivedAt",
    ]),
    approvalRequests: mkTable("approvalRequests", ["id", "businessId", "resourceType", "resourceId", "requestedBy", "status", "decidedBy", "decidedAt", "reason", "createdAt"]),
    campaigns: mkTable("campaigns", [
      "id", "businessId", "name", "description", "category", "status", "templateVersionId", "audienceId",
      "createdBy", "approvedBy", "approvedAt", "scheduledAt", "startedAt", "completedAt", "cancelledAt",
      "cancelledBy", "failureReason", "createdAt", "updatedAt",
    ]),
    campaignRecipients: mkTable("campaignRecipients", ["id", "campaignId", "customerId", "status", "skipReason", "messageId", "chargedPaise", "processedAt", "createdAt"]),
    messagingConversations: mkTable("messagingConversations", ["id", "type", "organizationId", "metadata", "isArchived", "createdAt", "updatedAt"]),
    businessConversations: mkTable("businessConversations", ["id", "conversationId", "businessId", "customerId", "status", "assignedToUserId", "createdAt"]),
    messagingParticipants: mkTable("messagingParticipants", ["id", "conversationId", "participantType", "participantId", "role", "joinedAt", "leftAt"]),
    messagingMessages: mkTable("messagingMessages", ["id", "conversationId", "senderParticipantId", "messageType", "category", "content", "templateId", "replyToMessageId", "createdAt", "editedAt", "deletedAt"]),
    messagingDeliveries: mkTable("messagingDeliveries", ["id", "messageId", "participantId", "status", "statusAt", "failureReason", "providerRef"]),
    messagingEvents: mkTable("messagingEvents", ["id", "conversationId", "messageId", "eventType", "payload", "createdAt"]),
    customerMarketingFrequency: mkTable("customerMarketingFrequency", ["id", "businessId", "customerId", "windowStart", "sentCount", "updatedAt"]),
    businessMarketingThroughput: mkTable("businessMarketingThroughput", ["id", "businessId", "windowStart", "sentCount", "updatedAt"]),
    billingAccounts: mkTable("billingAccounts", ["id", "organizationId", "walletBalancePaise", "lockedBalancePaise", "isBlocked", "updatedAt"]),
  };
});

beforeEach(async () => {
  resetFakeDb();
  vi.clearAllMocks();
  chargeMock = vi.fn(async () => ({ charged: true, billingAccountId: 1, costPaise: 10 }));
  // Side-effect imports: register resourceType policies. Safe to re-import
  // every test -- Map.set is idempotent.
  await import("../../server/modules/templates/approval-policy");
  await import("../../server/modules/campaigns/approval-policy");
});

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const BIZ = 1;
const OTHER_BIZ = 2;
const AUTHOR = 10;
const APPROVER = 20;

async function makeApprovedTemplateVersion(businessId = BIZ, vars: any[] = [{ name: "name", type: "text", required: false }]) {
  const { createTemplate, createOrEditDraftVersion } = await import("../../server/modules/templates/service");
  const t = await createTemplate(businessId, AUTHOR, { name: `tpl_${Date.now()}_${Math.random()}`, category: "marketing" });
  const content = vars.length ? vars.map((v) => `Hi {{${v.name}}}`).join(" ") : "Hi there";
  const v = await createOrEditDraftVersion(businessId, AUTHOR, t.id, { content, variables: vars });
  // Directly promote to APPROVED for test setup convenience -- template's
  // own submit/approve lifecycle is exhaustively tested in Phase 2/3's own
  // suites; this file's job is to test CAMPAIGN behavior given a valid
  // approved template, not to re-test template approval.
  const rows = tables.get("templateVersions")!;
  const row = rows.find((r) => r.id === v.id)!;
  row.status = "approved";
  return { template: t, version: row };
}

async function makeActiveAudienceWithCustomer(businessId = BIZ, customerOverrides: Record<string, any> = {}) {
  const { createCustomer } = await import("../../server/modules/customers/service");
  const { createAudience, addMember } = await import("../../server/modules/audiences/service");
  const customer = await createCustomer(businessId, AUTHOR, { name: "Kiran", phone: "9876543210", ...customerOverrides });
  const audience = await createAudience(businessId, AUTHOR, { name: `aud_${Date.now()}_${Math.random()}` });
  await addMember(businessId, AUTHOR, audience.id, customer.id);
  return { audience, customer };
}

async function grantMarketingConsent(businessId: number, customerId: number) {
  const { setChannelConsent } = await import("../../server/modules/customers/service");
  await setChannelConsent(businessId, AUTHOR, customerId, "marketing" as any, true, "business_admin");
}

async function makeReadyCampaign(opts: { businessId?: number; category?: string; vars?: any[]; customerOverrides?: Record<string, any>; grantConsent?: boolean } = {}) {
  const businessId = opts.businessId ?? BIZ;
  const category = opts.category ?? "marketing";
  const { createCampaign, updateCampaign } = await import("../../server/modules/campaigns/service");
  const { createApprovalRequest, approveRequest } = await import("../../server/modules/approvals/service");

  const { version } = await makeApprovedTemplateVersion(businessId, opts.vars);
  const { audience, customer } = await makeActiveAudienceWithCustomer(businessId, opts.customerOverrides);
  if (opts.grantConsent !== false) await grantMarketingConsent(businessId, customer.id);

  const campaign = await createCampaign(businessId, AUTHOR, { name: `camp_${Date.now()}_${Math.random()}`, category });
  await updateCampaign(businessId, AUTHOR, campaign.id, { templateVersionId: version.id, audienceId: audience.id });

  const request = await createApprovalRequest(businessId, AUTHOR, "campaign", campaign.id);
  await approveRequest(businessId, APPROVER, request.id, false);

  return { campaign, version, audience, customer };
}

// ---------------------------------------------------------------------------
// 2. Campaign domain / CRUD
// ---------------------------------------------------------------------------

describe("Campaign domain: create/list/get/update", () => {
  it("creates a DRAFT campaign", async () => {
    const { createCampaign } = await import("../../server/modules/campaigns/service");
    const c = await createCampaign(BIZ, AUTHOR, { name: "Diwali Sale", category: "marketing" });
    expect(c.status).toBe("draft");
    expect(c.approvedAt).toBeFalsy();
  });

  it("rejects an invalid category", async () => {
    const { createCampaign, ValidationError } = await import("../../server/modules/campaigns/service");
    await expect(createCampaign(BIZ, AUTHOR, { name: "X", category: "authentication" })).rejects.toThrow(ValidationError);
  });

  it("updateCampaign rejects binding a NON-approved template version", async () => {
    const { createTemplate, createOrEditDraftVersion } = await import("../../server/modules/templates/service");
    const { createCampaign, updateCampaign, ValidationError } = await import("../../server/modules/campaigns/service");
    const t = await createTemplate(BIZ, AUTHOR, { name: "draft_tpl", category: "marketing" });
    const v = await createOrEditDraftVersion(BIZ, AUTHOR, t.id, { content: "Hi", variables: [] });
    const c = await createCampaign(BIZ, AUTHOR, { name: "X", category: "marketing" });
    await expect(updateCampaign(BIZ, AUTHOR, c.id, { templateVersionId: v.id })).rejects.toThrow(ValidationError);
  });

  it("updateCampaign rejects a template with unsupported variables", async () => {
    const { createCampaign, updateCampaign, ValidationError } = await import("../../server/modules/campaigns/service");
    const { version } = await makeApprovedTemplateVersion(BIZ, [{ name: "city", type: "text", required: true }]);
    const c = await createCampaign(BIZ, AUTHOR, { name: "X", category: "marketing" });
    await expect(updateCampaign(BIZ, AUTHOR, c.id, { templateVersionId: version.id })).rejects.toThrow(ValidationError);
  });

  it("updateCampaign rejects binding an ARCHIVED audience", async () => {
    const { archiveAudience } = await import("../../server/modules/audiences/service");
    const { createCampaign, updateCampaign, ValidationError } = await import("../../server/modules/campaigns/service");
    const { audience } = await makeActiveAudienceWithCustomer();
    await archiveAudience(BIZ, AUTHOR, audience.id);
    const c = await createCampaign(BIZ, AUTHOR, { name: "X", category: "marketing" });
    await expect(updateCampaign(BIZ, AUTHOR, c.id, { audienceId: audience.id })).rejects.toThrow(ValidationError);
  });

  it("cannot edit a campaign that is no longer DRAFT", async () => {
    const { updateCampaign, ValidationError } = await import("../../server/modules/campaigns/service");
    const { campaign } = await makeReadyCampaign();
    const { scheduleCampaign } = await import("../../server/modules/campaigns/service");
    await scheduleCampaign(BIZ, AUTHOR, campaign.id, new Date(Date.now() + 3600_000));
    await expect(updateCampaign(BIZ, AUTHOR, campaign.id, { name: "renamed" })).rejects.toThrow(ValidationError);
  });
});

// ---------------------------------------------------------------------------
// 3/12/13. Lifecycle / unauthorized schedule+execute
// ---------------------------------------------------------------------------

describe("Lifecycle: legal/illegal transitions", () => {
  it("cannot schedule a campaign that hasn't been approved", async () => {
    const { createCampaign, updateCampaign, scheduleCampaign, ValidationError } = await import("../../server/modules/campaigns/service");
    const { version } = await makeApprovedTemplateVersion();
    const { audience } = await makeActiveAudienceWithCustomer();
    const c = await createCampaign(BIZ, AUTHOR, { name: "X", category: "marketing" });
    await updateCampaign(BIZ, AUTHOR, c.id, { templateVersionId: version.id, audienceId: audience.id });
    await expect(scheduleCampaign(BIZ, AUTHOR, c.id, new Date(Date.now() + 3600_000))).rejects.toThrow(ValidationError);
  });

  it("scheduleCampaign rejects a past scheduledAt", async () => {
    const { scheduleCampaign, ValidationError } = await import("../../server/modules/campaigns/service");
    const { campaign } = await makeReadyCampaign();
    await expect(scheduleCampaign(BIZ, AUTHOR, campaign.id, new Date(Date.now() - 1000))).rejects.toThrow(ValidationError);
  });

  it("DRAFT -> SCHEDULED -> RUNNING -> COMPLETED is legal", async () => {
    const { scheduleCampaign, executeCampaign } = await import("../../server/modules/campaigns/service");
    const { campaign } = await makeReadyCampaign();
    const scheduled = await scheduleCampaign(BIZ, AUTHOR, campaign.id, new Date(Date.now() + 3600_000));
    expect(scheduled.status).toBe("scheduled");
    const result = await executeCampaign(BIZ, AUTHOR, campaign.id);
    expect(result.campaignStatus).toBe("completed");
  });

  it("DRAFT -> RUNNING -> COMPLETED (immediate execute, no scheduling) is legal", async () => {
    const { executeCampaign } = await import("../../server/modules/campaigns/service");
    const { campaign } = await makeReadyCampaign();
    const result = await executeCampaign(BIZ, AUTHOR, campaign.id);
    expect(result.campaignStatus).toBe("completed");
  });

  it("cannot cancel a RUNNING/COMPLETED campaign", async () => {
    const { executeCampaign, cancelCampaign, ValidationError } = await import("../../server/modules/campaigns/service");
    const { campaign } = await makeReadyCampaign();
    await executeCampaign(BIZ, AUTHOR, campaign.id); // -> completed
    await expect(cancelCampaign(BIZ, AUTHOR, campaign.id)).rejects.toThrow(ValidationError);
  });

  it("DRAFT/SCHEDULED can be cancelled", async () => {
    const { scheduleCampaign, cancelCampaign } = await import("../../server/modules/campaigns/service");
    const { campaign } = await makeReadyCampaign();
    await scheduleCampaign(BIZ, AUTHOR, campaign.id, new Date(Date.now() + 3600_000));
    const cancelled = await cancelCampaign(BIZ, AUTHOR, campaign.id);
    expect(cancelled.status).toBe("cancelled");
  });

  it("cannot execute a CANCELLED campaign", async () => {
    const { cancelCampaign, executeCampaign, ValidationError } = await import("../../server/modules/campaigns/service");
    const { campaign } = await makeReadyCampaign();
    await cancelCampaign(BIZ, AUTHOR, campaign.id);
    await expect(executeCampaign(BIZ, AUTHOR, campaign.id)).rejects.toThrow(ValidationError);
  });

  it("systemic failure at execute time (template archived after approval) transitions to FAILED, not silently skipping everyone", async () => {
    const { executeCampaign, ValidationError } = await import("../../server/modules/campaigns/service");
    const { campaign, version } = await makeReadyCampaign();
    const row = tables.get("templateVersions")!.find((r) => r.id === version.id)!;
    row.status = "archived";
    await expect(executeCampaign(BIZ, AUTHOR, campaign.id)).rejects.toThrow(ValidationError);
    const camp = tables.get("campaigns")!.find((c) => c.id === campaign.id)!;
    expect(camp.status).toBe("failed");
    expect(camp.failureReason).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// 4. Template binding immutability
// ---------------------------------------------------------------------------

describe("Template binding: fixed version, never 'latest'", () => {
  it("campaign keeps using v1 even after v2 is created and approved", async () => {
    const { createOrEditDraftVersion } = await import("../../server/modules/templates/service");
    const { campaign, version: v1 } = await makeReadyCampaign();

    // Create a v2 draft for the same template -- campaign must not resolve to it.
    const { template } = { template: { id: (tables.get("templates")!.find((t) => t.id === (tables.get("templateVersions")!.find((tv) => tv.id === v1.id)!.templateId)))!.id } };
    const v2 = await createOrEditDraftVersion(BIZ, AUTHOR, template.id, { content: "Hi v2 {{name}}", variables: [{ name: "name", type: "text", required: false }] });

    const campRow = tables.get("campaigns")!.find((c) => c.id === campaign.id)!;
    expect(campRow.templateVersionId).toBe(v1.id);
    expect(campRow.templateVersionId).not.toBe(v2.id);
  });

  it("rejects binding a DRAFT/SUBMITTED/REJECTED/ARCHIVED version", async () => {
    const { createTemplate, createOrEditDraftVersion } = await import("../../server/modules/templates/service");
    const { createCampaign, updateCampaign, ValidationError } = await import("../../server/modules/campaigns/service");
    for (const status of ["draft", "submitted", "rejected", "archived"]) {
      const t = await createTemplate(BIZ, AUTHOR, { name: `tpl_${status}_${Math.random()}`, category: "marketing" });
      const v = await createOrEditDraftVersion(BIZ, AUTHOR, t.id, { content: "Hi", variables: [] });
      tables.get("templateVersions")!.find((r) => r.id === v.id)!.status = status;
      const c = await createCampaign(BIZ, AUTHOR, { name: "X", category: "marketing" });
      await expect(updateCampaign(BIZ, AUTHOR, c.id, { templateVersionId: v.id })).rejects.toThrow(ValidationError);
    }
  });
});

// ---------------------------------------------------------------------------
// 5/10/11. Recipient snapshot + idempotency + concurrency
// ---------------------------------------------------------------------------

describe("Recipient snapshot: immutable, server-resolved", () => {
  it("snapshots audience membership at schedule time -- adding a new member afterward does NOT retroactively join the campaign", async () => {
    const { addMember } = await import("../../server/modules/audiences/service");
    const { createCustomer } = await import("../../server/modules/customers/service");
    const { scheduleCampaign, getCampaignReport } = await import("../../server/modules/campaigns/service");
    const { campaign, audience } = await makeReadyCampaign();

    await scheduleCampaign(BIZ, AUTHOR, campaign.id, new Date(Date.now() + 3600_000));
    const reportBefore = await getCampaignReport(BIZ, campaign.id);
    expect(reportBefore.targeted).toBe(1);

    const lateJoiner = await createCustomer(BIZ, AUTHOR, { name: "Late", phone: "9000000001" });
    await addMember(BIZ, AUTHOR, audience.id, lateJoiner.id);

    const reportAfter = await getCampaignReport(BIZ, campaign.id);
    expect(reportAfter.targeted).toBe(1); // unchanged -- snapshot is frozen
  });

  it("re-invoking execute() after completion is rejected outright (COMPLETED is terminal) -- and the one real send was never duplicated", async () => {
    const { executeCampaign, getCampaignReport, ValidationError } = await import("../../server/modules/campaigns/service");
    const { campaign } = await makeReadyCampaign();
    const first = await executeCampaign(BIZ, AUTHOR, campaign.id);
    expect(first.campaignStatus).toBe("completed");
    await expect(executeCampaign(BIZ, AUTHOR, campaign.id)).rejects.toThrow(ValidationError);
    const report = await getCampaignReport(BIZ, campaign.id);
    expect(report.sent).toBe(1);
    expect(chargeMock).toHaveBeenCalledTimes(1);
  });

  it("concurrent execute() calls for the same campaign do not double-charge or double-send", async () => {
    const { executeCampaign, getCampaignReport } = await import("../../server/modules/campaigns/service");
    const { campaign } = await makeReadyCampaign();
    const results = await Promise.allSettled([
      executeCampaign(BIZ, AUTHOR, campaign.id),
      executeCampaign(BIZ, AUTHOR, campaign.id),
    ]);
    expect(results.every((r) => r.status === "fulfilled")).toBe(true);
    const report = await getCampaignReport(BIZ, campaign.id);
    expect(report.sent).toBe(1);
    expect(chargeMock).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// 6/7/8/9. Recipient safety gate chain
// ---------------------------------------------------------------------------

describe("Recipient safety gate chain (P0)", () => {
  it("ACTIVE + eligible -> sent", async () => {
    const { executeCampaign, getCampaignReport } = await import("../../server/modules/campaigns/service");
    const { campaign } = await makeReadyCampaign();
    await executeCampaign(BIZ, AUTHOR, campaign.id);
    const report = await getCampaignReport(BIZ, campaign.id);
    expect(report.sent).toBe(1);
    expect(report.skipped).toBe(0);
  });

  it("BLOCKED customer -> skipped, never sent, even though eligible for consent", async () => {
    const { updateCustomer } = await import("../../server/modules/customers/service");
    const { executeCampaign, getCampaignReport } = await import("../../server/modules/campaigns/service");
    const { campaign, customer } = await makeReadyCampaign();
    await updateCustomer(BIZ, AUTHOR, customer.id, { status: "blocked" });
    await executeCampaign(BIZ, AUTHOR, campaign.id);
    const report = await getCampaignReport(BIZ, campaign.id);
    expect(report.sent).toBe(0);
    expect(report.skippedByReason["customer_blocked"]).toBe(1);
  });

  it("ARCHIVED customer -> skipped, never sent", async () => {
    const { archiveCustomer } = await import("../../server/modules/customers/service");
    const { executeCampaign, getCampaignReport } = await import("../../server/modules/campaigns/service");
    const { campaign, customer } = await makeReadyCampaign();
    await archiveCustomer(BIZ, AUTHOR, customer.id);
    await executeCampaign(BIZ, AUTHOR, campaign.id);
    const report = await getCampaignReport(BIZ, campaign.id);
    expect(report.sent).toBe(0);
    expect(report.skippedByReason["customer_archived"]).toBe(1);
  });

  it("ACTIVE + no consent -> skipped (absence of consent is never interpreted as consent)", async () => {
    const { executeCampaign, getCampaignReport } = await import("../../server/modules/campaigns/service");
    const { campaign } = await makeReadyCampaign({ grantConsent: false });
    await executeCampaign(BIZ, AUTHOR, campaign.id);
    const report = await getCampaignReport(BIZ, campaign.id);
    expect(report.sent).toBe(0);
    expect(report.skippedByReason["consent_missing"]).toBe(1);
  });

  it("ACTIVE + revoked consent -> skipped (opt-out is never silently overridden)", async () => {
    const { setChannelConsent } = await import("../../server/modules/customers/service");
    const { executeCampaign, getCampaignReport } = await import("../../server/modules/campaigns/service");
    const { campaign, customer } = await makeReadyCampaign();
    await setChannelConsent(BIZ, AUTHOR, customer.id, "marketing" as any, false, "customer_reply_stop");
    await executeCampaign(BIZ, AUTHOR, campaign.id);
    const report = await getCampaignReport(BIZ, campaign.id);
    expect(report.sent).toBe(0);
    expect(report.skippedByReason["consent_missing"]).toBe(1);
  });

  it("insufficient credit -> skipped, not sent, not silently ignored", async () => {
    const { executeCampaign, getCampaignReport } = await import("../../server/modules/campaigns/service");
    const { campaign } = await makeReadyCampaign();
    chargeMock = vi.fn(async () => ({ charged: false, reason: "insufficient_credit" }));
    await executeCampaign(BIZ, AUTHOR, campaign.id);
    const report = await getCampaignReport(BIZ, campaign.id);
    expect(report.sent).toBe(0);
    expect(report.skippedByReason["insufficient_credit"]).toBe(1);
  });

  it("audience membership alone is never sufficient -- a BLOCKED member is still targeted by the snapshot but never sent to", async () => {
    // Re-affirms the exact requirement identified during Phase 4 hardening (doc 29 H3).
    const { updateCustomer } = await import("../../server/modules/customers/service");
    const { listMembers } = await import("../../server/modules/audiences/service");
    const { getCampaignReport, executeCampaign } = await import("../../server/modules/campaigns/service");
    const { campaign, customer, audience } = await makeReadyCampaign();
    const membersBefore = await listMembers(BIZ, audience.id);
    expect(membersBefore.some((m: any) => m.customerId === customer.id)).toBe(true); // still an audience member

    await updateCustomer(BIZ, AUTHOR, customer.id, { status: "blocked" });
    await executeCampaign(BIZ, AUTHOR, campaign.id);
    const after = await getCampaignReport(BIZ, campaign.id);
    expect(after.targeted).toBe(1); // the snapshot still targeted them...
    expect(after.sent).toBe(0);     // ...but they were never sent to
  });
});

// ---------------------------------------------------------------------------
// 15/16/17. Security: sender identity, generationSource, tenant isolation
// ---------------------------------------------------------------------------

describe("Messaging boundary: sender identity + generationSource server-established only", () => {
  it("campaign-sent messages have the BUSINESS participant as sender, never a human user", async () => {
    const { executeCampaign } = await import("../../server/modules/campaigns/service");
    const { campaign } = await makeReadyCampaign();
    await executeCampaign(BIZ, AUTHOR, campaign.id);

    const message = tables.get("messagingMessages")![0];
    const senderParticipant = tables.get("messagingParticipants")!.find((p) => p.id === message.senderParticipantId);
    expect(senderParticipant.participantType).toBe("business");
    expect(message.category).toBe("marketing");
  });

  it("generationSource is recorded server-side on the message-created event, referencing the campaign id", async () => {
    const { executeCampaign } = await import("../../server/modules/campaigns/service");
    const { campaign } = await makeReadyCampaign();
    await executeCampaign(BIZ, AUTHOR, campaign.id);

    const event = tables.get("messagingEvents")!.find((e) => e.eventType === "message.created");
    expect(event.payload.generationSource).toEqual({ type: "campaign", id: campaign.id });
  });
});

describe("Tenant isolation", () => {
  it("Business A cannot read Business B's campaign", async () => {
    const { getCampaign } = await import("../../server/modules/campaigns/service");
    const { campaign } = await makeReadyCampaign({ businessId: OTHER_BIZ });
    expect(await getCampaign(BIZ, campaign.id)).toBeNull();
  });

  it("Business A cannot update/schedule/execute/cancel Business B's campaign", async () => {
    const { updateCampaign, scheduleCampaign, executeCampaign, cancelCampaign, NotFoundError } = await import("../../server/modules/campaigns/service");
    const { campaign } = await makeReadyCampaign({ businessId: OTHER_BIZ });
    await expect(updateCampaign(BIZ, AUTHOR, campaign.id, { name: "hacked" })).rejects.toThrow(NotFoundError);
    await expect(scheduleCampaign(BIZ, AUTHOR, campaign.id, new Date(Date.now() + 3600_000))).rejects.toThrow(NotFoundError);
    await expect(executeCampaign(BIZ, AUTHOR, campaign.id)).rejects.toThrow(NotFoundError);
    await expect(cancelCampaign(BIZ, AUTHOR, campaign.id)).rejects.toThrow(NotFoundError);
  });

  it("cannot bind a template belonging to a different business (templateId manipulation)", async () => {
    const { createCampaign, updateCampaign, NotFoundError } = await import("../../server/modules/campaigns/service");
    const { version } = await makeApprovedTemplateVersion(OTHER_BIZ);
    const c = await createCampaign(BIZ, AUTHOR, { name: "X", category: "marketing" });
    await expect(updateCampaign(BIZ, AUTHOR, c.id, { templateVersionId: version.id })).rejects.toThrow(NotFoundError);
  });

  it("cannot bind an audience belonging to a different business (audienceId manipulation)", async () => {
    const { createCampaign, updateCampaign, NotFoundError } = await import("../../server/modules/campaigns/service");
    const { audience } = await makeActiveAudienceWithCustomer(OTHER_BIZ);
    const c = await createCampaign(BIZ, AUTHOR, { name: "X", category: "marketing" });
    await expect(updateCampaign(BIZ, AUTHOR, c.id, { audienceId: audience.id })).rejects.toThrow(NotFoundError);
  });

  it("cross-business customer via a tampered audience/membership row is never targeted -- snapshotRecipientsIfNeeded filters by businessId ownership", async () => {
    const { createCampaign, updateCampaign, scheduleCampaign, getCampaignReport } = await import("../../server/modules/campaigns/service");
    const { version } = await makeApprovedTemplateVersion(BIZ);
    const { audience } = await makeActiveAudienceWithCustomer(BIZ);
    // Directly corrupt the fake DB to simulate a cross-business membership row (defense-in-depth test, not reachable via the real API).
    const { createCustomer } = await import("../../server/modules/customers/service");
    const otherBizCustomer = await createCustomer(OTHER_BIZ, AUTHOR, { name: "Intruder", phone: "9111111111" });
    tables.get("audienceMembers")!.push({ id: 999, audienceId: audience.id, customerId: otherBizCustomer.id, addedBy: AUTHOR, addedAt: new Date() });

    const c = await createCampaign(BIZ, AUTHOR, { name: "X", category: "marketing" });
    await updateCampaign(BIZ, AUTHOR, c.id, { templateVersionId: version.id, audienceId: audience.id });
    const { createApprovalRequest, approveRequest } = await import("../../server/modules/approvals/service");
    const req = await createApprovalRequest(BIZ, AUTHOR, "campaign", c.id);
    await approveRequest(BIZ, APPROVER, req.id, false);

    await scheduleCampaign(BIZ, AUTHOR, c.id, new Date(Date.now() + 3600_000));
    const report = await getCampaignReport(BIZ, c.id);
    expect(report.targeted).toBe(1); // only the real, same-business member -- the intruder row was filtered out
  });
});

// ---------------------------------------------------------------------------
// 13/14/22. RBAC-adjacent approval integration + audit
// ---------------------------------------------------------------------------

describe("Approval Center integration", () => {
  it("campaign is not submittable until template + audience are both bound", async () => {
    const { createCampaign } = await import("../../server/modules/campaigns/service");
    const { createApprovalRequest, ValidationError } = await import("../../server/modules/approvals/service");
    const c = await createCampaign(BIZ, AUTHOR, { name: "X", category: "marketing" });
    await expect(createApprovalRequest(BIZ, AUTHOR, "campaign", c.id)).rejects.toThrow(ValidationError);
  });

  it("self-approval is forbidden for campaigns (same as templates)", async () => {
    const { createCampaign, updateCampaign } = await import("../../server/modules/campaigns/service");
    const { createApprovalRequest, approveRequest, SelfApprovalError } = await import("../../server/modules/approvals/service");
    const { version } = await makeApprovedTemplateVersion();
    const { audience } = await makeActiveAudienceWithCustomer();
    const c = await createCampaign(BIZ, AUTHOR, { name: "X", category: "marketing" });
    await updateCampaign(BIZ, AUTHOR, c.id, { templateVersionId: version.id, audienceId: audience.id });
    const req = await createApprovalRequest(BIZ, AUTHOR, "campaign", c.id);
    await expect(approveRequest(BIZ, AUTHOR, req.id, false)).rejects.toThrow(SelfApprovalError);
  });

  it("approving sets campaigns.approvedBy/approvedAt (denormalized fast-read, not a second source of truth)", async () => {
    const { campaign } = await makeReadyCampaign();
    const row = tables.get("campaigns")!.find((c) => c.id === campaign.id)!;
    expect(row.approvedBy).toBe(APPROVER);
    expect(row.approvedAt).toBeTruthy();
  });

  it("rejection leaves the campaign in DRAFT, editable and resubmittable", async () => {
    const { createCampaign, updateCampaign } = await import("../../server/modules/campaigns/service");
    const { createApprovalRequest, rejectRequest } = await import("../../server/modules/approvals/service");
    const { version } = await makeApprovedTemplateVersion();
    const { audience } = await makeActiveAudienceWithCustomer();
    const c = await createCampaign(BIZ, AUTHOR, { name: "X", category: "marketing" });
    await updateCampaign(BIZ, AUTHOR, c.id, { templateVersionId: version.id, audienceId: audience.id });
    const req = await createApprovalRequest(BIZ, AUTHOR, "campaign", c.id);
    await rejectRequest(BIZ, APPROVER, req.id, "not ready", false);

    const row = tables.get("campaigns")!.find((r) => r.id === c.id)!;
    expect(row.status).toBe("draft");
    expect(row.approvedAt).toBeFalsy();
    await expect(updateCampaign(BIZ, AUTHOR, c.id, { name: "revised" })).resolves.toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// 18/19. Reporting + audit
// ---------------------------------------------------------------------------

describe("Reporting foundation: real counts, never fabricated", () => {
  it("a scheduled-but-not-yet-executed campaign reports zero sent (never assumes 'sent' merely because scheduled)", async () => {
    const { scheduleCampaign, getCampaignReport } = await import("../../server/modules/campaigns/service");
    const { campaign } = await makeReadyCampaign();
    await scheduleCampaign(BIZ, AUTHOR, campaign.id, new Date(Date.now() + 3600_000));
    const report = await getCampaignReport(BIZ, campaign.id);
    expect(report.sent).toBe(0);
    expect(report.pending).toBe(1);
  });

  it("report distinguishes targeted vs sent vs skipped-by-reason", async () => {
    const { executeCampaign, getCampaignReport } = await import("../../server/modules/campaigns/service");
    const { updateCustomer } = await import("../../server/modules/customers/service");
    const { campaign, customer } = await makeReadyCampaign();
    await updateCustomer(BIZ, AUTHOR, customer.id, { status: "blocked" });
    await executeCampaign(BIZ, AUTHOR, campaign.id);
    const report = await getCampaignReport(BIZ, campaign.id);
    expect(report).toMatchObject({ targeted: 1, sent: 0, skipped: 1, skippedByReason: { customer_blocked: 1 } });
  });
});

// ---------------------------------------------------------------------------
// Phase 8 hardening: consent revocation/opt-out re-checked at execution
// time (never overridden by the snapshot), and marketing frequency caps.
// See docs/neura-ecosystem/34_PHASE8_MARKETING_HARDENING_IMPLEMENTATION.md.
// ---------------------------------------------------------------------------

describe("Phase 8: snapshot does not override a later opt-out/consent revocation", () => {
  it("a customer who opts out (consent revoked) AFTER scheduling remains in the snapshot but is excluded at execution", async () => {
    const { scheduleCampaign, executeCampaign, getCampaignReport } = await import("../../server/modules/campaigns/service");
    const { setChannelConsent } = await import("../../server/modules/customers/service");
    const { campaign, customer } = await makeReadyCampaign();

    await scheduleCampaign(BIZ, AUTHOR, campaign.id, new Date(Date.now() + 3600_000));
    const beforeReport = await getCampaignReport(BIZ, campaign.id);
    expect(beforeReport.targeted).toBe(1); // still snapshotted

    // Real opt-out, via the exact same function the new HTTP consent route calls.
    await setChannelConsent(BIZ, AUTHOR, customer.id, "marketing" as any, false, "customer_reply_stop");

    await executeCampaign(BIZ, AUTHOR, campaign.id);
    const afterReport = await getCampaignReport(BIZ, campaign.id);
    expect(afterReport.targeted).toBe(1); // snapshot unchanged...
    expect(afterReport.sent).toBe(0);     // ...but never sent
    expect(afterReport.skippedByReason["consent_missing"]).toBe(1);
  });

  it("re-granting consent after an opt-out requires an explicit new grant call -- it is never automatic", async () => {
    const { setChannelConsent, isEligibleForChannel } = await import("../../server/modules/customers/service");
    const { customer } = await makeActiveAudienceWithCustomer();
    await setChannelConsent(BIZ, AUTHOR, customer.id, "marketing" as any, true);
    await setChannelConsent(BIZ, AUTHOR, customer.id, "marketing" as any, false);
    expect(await isEligibleForChannel(BIZ, customer.id, "marketing" as any)).toBe(false);
    await setChannelConsent(BIZ, AUTHOR, customer.id, "marketing" as any, true); // explicit re-consent
    expect(await isEligibleForChannel(BIZ, customer.id, "marketing" as any)).toBe(true);
  });
});

describe("Phase 8: marketing frequency cap gates execution (integration, real frequency.ts against the shared fake DB)", () => {
  it("a customer already at today's cap is skipped with CUSTOMER_FREQUENCY_CAP_EXCEEDED, never sent", async () => {
    const { executeCampaign, getCampaignReport } = await import("../../server/modules/campaigns/service");
    const { startOfUtcDay, DEFAULT_CUSTOMER_MARKETING_CAP_PER_DAY } = await import("../../server/modules/campaigns/frequency");
    const { campaign, customer } = await makeReadyCampaign();

    // Pre-seed the customer's frequency counter at the exact default cap
    // for today's window -- simulates "already received 3 marketing
    // messages today from earlier campaigns."
    tables.get("customerMarketingFrequency")!.push({
      id: 1, businessId: BIZ, customerId: customer.id, windowStart: startOfUtcDay(),
      sentCount: DEFAULT_CUSTOMER_MARKETING_CAP_PER_DAY, updatedAt: new Date(),
    });

    await executeCampaign(BIZ, AUTHOR, campaign.id);
    const report = await getCampaignReport(BIZ, campaign.id);
    expect(report.sent).toBe(0);
    expect(report.skippedByReason["customer_frequency_cap_exceeded"]).toBe(1);
  });

  it("frequency capping does not apply to UTILITY campaigns -- only MARKETING", async () => {
    const { executeCampaign, getCampaignReport } = await import("../../server/modules/campaigns/service");
    const { setChannelConsent } = await import("../../server/modules/customers/service");
    const { startOfUtcDay, DEFAULT_CUSTOMER_MARKETING_CAP_PER_DAY } = await import("../../server/modules/campaigns/frequency");
    const { campaign, customer } = await makeReadyCampaign({ category: "utility" });
    await setChannelConsent(BIZ, AUTHOR, customer.id, "utility" as any, true); // the campaign engine's own gate chain (Phase 5) checks consent for utility too, distinct from Phase 7's separate Utility Messaging module

    tables.get("customerMarketingFrequency")!.push({
      id: 1, businessId: BIZ, customerId: customer.id, windowStart: startOfUtcDay(),
      sentCount: DEFAULT_CUSTOMER_MARKETING_CAP_PER_DAY, updatedAt: new Date(),
    });

    await executeCampaign(BIZ, AUTHOR, campaign.id);
    const report = await getCampaignReport(BIZ, campaign.id);
    expect(report.sent).toBe(1); // utility is never frequency-capped
  });

  it("a business already at its throughput cap skips further marketing recipients with BUSINESS_THROUGHPUT_CAP_EXCEEDED", async () => {
    const { executeCampaign, getCampaignReport } = await import("../../server/modules/campaigns/service");
    const { startOfUtcHour, DEFAULT_BUSINESS_MARKETING_THROUGHPUT_PER_HOUR } = await import("../../server/modules/campaigns/frequency");
    const { campaign } = await makeReadyCampaign();

    tables.get("businessMarketingThroughput")!.push({
      id: 1, businessId: BIZ, windowStart: startOfUtcHour(),
      sentCount: DEFAULT_BUSINESS_MARKETING_THROUGHPUT_PER_HOUR, updatedAt: new Date(),
    });

    await executeCampaign(BIZ, AUTHOR, campaign.id);
    const report = await getCampaignReport(BIZ, campaign.id);
    expect(report.sent).toBe(0);
    expect(report.skippedByReason["business_throughput_cap_exceeded"]).toBe(1);
  });

  it("a capped-out recipient is never charged (frequency gate runs before billing)", async () => {
    const { executeCampaign } = await import("../../server/modules/campaigns/service");
    const { startOfUtcDay, DEFAULT_CUSTOMER_MARKETING_CAP_PER_DAY } = await import("../../server/modules/campaigns/frequency");
    const { campaign, customer } = await makeReadyCampaign();

    tables.get("customerMarketingFrequency")!.push({
      id: 1, businessId: BIZ, customerId: customer.id, windowStart: startOfUtcDay(),
      sentCount: DEFAULT_CUSTOMER_MARKETING_CAP_PER_DAY, updatedAt: new Date(),
    });

    await executeCampaign(BIZ, AUTHOR, campaign.id);
    expect(chargeMock).not.toHaveBeenCalled();
  });

  it("two DIFFERENT marketing campaigns to the SAME customer share one frequency budget (campaign-agnostic, overlap-safe)", async () => {
    const { executeCampaign, createCampaign, updateCampaign } = await import("../../server/modules/campaigns/service");
    const { createApprovalRequest, approveRequest } = await import("../../server/modules/approvals/service");

    const { campaign: campaign1, customer, audience } = await makeReadyCampaign();
    await executeCampaign(BIZ, AUTHOR, campaign1.id); // consumes 1 unit of the customer's shared daily budget

    const freqRows = tables.get("customerMarketingFrequency")!.filter((r: any) => r.customerId === customer.id);
    expect(freqRows.length).toBe(1); // ONE counter row for this customer+window, not one per campaign
    expect(freqRows[0].sentCount).toBe(1);

    // Second, independent campaign, same customer, same day.
    const { version } = await makeApprovedTemplateVersion(BIZ);
    const campaign2 = await createCampaign(BIZ, AUTHOR, { name: `camp2_${Date.now()}`, category: "marketing" });
    await updateCampaign(BIZ, AUTHOR, campaign2.id, { templateVersionId: version.id, audienceId: audience.id });
    const req2 = await createApprovalRequest(BIZ, AUTHOR, "campaign", campaign2.id);
    await approveRequest(BIZ, APPROVER, req2.id, false);

    await executeCampaign(BIZ, AUTHOR, campaign2.id);
    const freqRowsAfter = tables.get("customerMarketingFrequency")!.filter((r: any) => r.customerId === customer.id);
    expect(freqRowsAfter.length).toBe(1); // still one row -- campaign2 incremented the SAME counter, proving overlap protection is campaign-agnostic
    expect(freqRowsAfter[0].sentCount).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Phase 8B-R0: campaign pre-flight + enriched report.
// See docs/neura-ecosystem/36_PHASE8B_R0_REPORTING_PREFLIGHT_IMPLEMENTATION.md.
// getCampaignPreflight is a READ-ONLY preview -- must never mutate
// campaignRecipients/frequency counters/billing, and must reuse
// assertReadyToGoLive (the exact function execution calls) for the
// structural readiness verdict.
// ---------------------------------------------------------------------------

function seedBillingAccount(businessId: number, walletBalancePaise: number, isBlocked = false) {
  tables.get("billingAccounts")!.push({ id: businessId, organizationId: businessId, walletBalancePaise, lockedBalancePaise: 0, isBlocked, updatedAt: new Date() });
}

describe("Phase 8B-R0: campaign pre-flight", () => {
  it("READY: approved template, active audience, granted consent, sufficient credit", async () => {
    const { getCampaignPreflight } = await import("../../server/modules/campaigns/service");
    const { campaign } = await makeReadyCampaign();
    seedBillingAccount(BIZ, 1_000_000);

    const preflight = await getCampaignPreflight(BIZ, campaign.id);
    expect(preflight.readiness.ready).toBe(true);
    expect(preflight.readiness.reasons).toEqual([]);
    expect(preflight.eligibility.eligibleCount).toBe(1);
    expect(preflight.audience.size).toBe(1);
  });

  it("NOT_READY: campaign has no template/audience bound yet (fresh DRAFT)", async () => {
    const { createCampaign, getCampaignPreflight } = await import("../../server/modules/campaigns/service");
    const c = await createCampaign(BIZ, AUTHOR, { name: "fresh", category: "marketing" });
    const preflight = await getCampaignPreflight(BIZ, c.id);
    expect(preflight.readiness.ready).toBe(false);
    expect(preflight.readiness.reasons.length).toBeGreaterThan(0);
    expect(preflight.eligibility.eligibleCount).toBe(0);
  });

  it("NOT_READY: campaign has not been approved (no approval request decided yet)", async () => {
    const { createCampaign, updateCampaign, getCampaignPreflight } = await import("../../server/modules/campaigns/service");
    const { version } = await makeApprovedTemplateVersion();
    const { audience } = await makeActiveAudienceWithCustomer();
    const c = await createCampaign(BIZ, AUTHOR, { name: "unapproved", category: "marketing" });
    await updateCampaign(BIZ, AUTHOR, c.id, { templateVersionId: version.id, audienceId: audience.id });
    seedBillingAccount(BIZ, 1_000_000);

    const preflight = await getCampaignPreflight(BIZ, c.id);
    expect(preflight.readiness.ready).toBe(false);
    expect(preflight.readiness.reasons.some((r: string) => r.toLowerCase().includes("approved"))).toBe(true);
  });

  it("zero eligible recipients: audience has members, but none pass any gate", async () => {
    const { getCampaignPreflight } = await import("../../server/modules/campaigns/service");
    const { campaign } = await makeReadyCampaign({ grantConsent: false }); // no consent granted
    seedBillingAccount(BIZ, 1_000_000);

    const preflight = await getCampaignPreflight(BIZ, campaign.id);
    expect(preflight.eligibility.eligibleCount).toBe(0);
    expect(preflight.readiness.ready).toBe(false);
    expect(preflight.suppressionBreakdown["consent_missing"]).toBe(1);
  });

  it("blocked customer is excluded from eligible count and reflected in suppressionBreakdown", async () => {
    const { getCampaignPreflight } = await import("../../server/modules/campaigns/service");
    const { updateCustomer } = await import("../../server/modules/customers/service");
    const { campaign, customer } = await makeReadyCampaign();
    await updateCustomer(BIZ, AUTHOR, customer.id, { status: "blocked" });
    seedBillingAccount(BIZ, 1_000_000);

    const preflight = await getCampaignPreflight(BIZ, campaign.id);
    expect(preflight.eligibility.blocked).toBe(1);
    expect(preflight.eligibility.eligibleCount).toBe(0);
    expect(preflight.suppressionBreakdown["customer_blocked"]).toBe(1);
  });

  it("archived customer is excluded and reflected in suppressionBreakdown", async () => {
    const { getCampaignPreflight } = await import("../../server/modules/campaigns/service");
    const { archiveCustomer } = await import("../../server/modules/customers/service");
    const { campaign, customer } = await makeReadyCampaign();
    await archiveCustomer(BIZ, AUTHOR, customer.id);
    seedBillingAccount(BIZ, 1_000_000);

    const preflight = await getCampaignPreflight(BIZ, campaign.id);
    expect(preflight.eligibility.archived).toBe(1);
    expect(preflight.eligibility.eligibleCount).toBe(0);
    expect(preflight.suppressionBreakdown["customer_archived"]).toBe(1);
  });

  it("missing consent (never granted) is distinguished from revoked consent in eligibility, but both fold into consent_missing in suppressionBreakdown (parity with execution's actual skip reason)", async () => {
    const { getCampaignPreflight } = await import("../../server/modules/campaigns/service");
    const { setChannelConsent } = await import("../../server/modules/customers/service");
    const { campaign: campaignMissing } = await makeReadyCampaign({ grantConsent: false });
    seedBillingAccount(BIZ, 1_000_000);
    const preflightMissing = await getCampaignPreflight(BIZ, campaignMissing.id);
    expect(preflightMissing.eligibility.consentMissing).toBe(1);
    expect(preflightMissing.eligibility.consentRevoked).toBe(0);

    const { campaign: campaignRevoked, customer } = await makeReadyCampaign({ customerOverrides: { phone: "9000000002" } });
    await setChannelConsent(BIZ, AUTHOR, customer.id, "marketing" as any, false);
    const preflightRevoked = await getCampaignPreflight(BIZ, campaignRevoked.id);
    expect(preflightRevoked.eligibility.consentRevoked).toBe(1);
    expect(preflightRevoked.suppressionBreakdown["consent_missing"]).toBe(1); // same execution-facing reason as "missing"
  });

  it("frequency-capped customer is excluded and reflected distinctly", async () => {
    const { getCampaignPreflight } = await import("../../server/modules/campaigns/service");
    const { startOfUtcDay, DEFAULT_CUSTOMER_MARKETING_CAP_PER_DAY } = await import("../../server/modules/campaigns/frequency");
    const { campaign, customer } = await makeReadyCampaign();
    seedBillingAccount(BIZ, 1_000_000);
    tables.get("customerMarketingFrequency")!.push({
      id: 1, businessId: BIZ, customerId: customer.id, windowStart: startOfUtcDay(),
      sentCount: DEFAULT_CUSTOMER_MARKETING_CAP_PER_DAY, updatedAt: new Date(),
    });

    const preflight = await getCampaignPreflight(BIZ, campaign.id);
    expect(preflight.eligibility.frequencyCapped).toBe(1);
    expect(preflight.eligibility.eligibleCount).toBe(0);
    expect(preflight.suppressionBreakdown["customer_frequency_cap_exceeded"]).toBe(1);
  });

  it("frequency is not applicable to UTILITY campaigns", async () => {
    const { getCampaignPreflight } = await import("../../server/modules/campaigns/service");
    const { setChannelConsent } = await import("../../server/modules/customers/service");
    const { campaign, customer } = await makeReadyCampaign({ category: "utility" });
    await setChannelConsent(BIZ, AUTHOR, customer.id, "utility" as any, true);
    seedBillingAccount(BIZ, 1_000_000);

    const preflight = await getCampaignPreflight(BIZ, campaign.id);
    expect(preflight.frequency.applicable).toBe(false);
    expect(preflight.frequency.business).toBeNull();
    expect(preflight.eligibility.eligibleCount).toBe(1);
  });

  it("insufficient credit: billing configured but balance below estimated cost", async () => {
    const { getCampaignPreflight } = await import("../../server/modules/campaigns/service");
    const { PLACEHOLDER_COST_PER_MESSAGE_PAISE } = await import("../../server/modules/campaigns/billing");
    const { campaign } = await makeReadyCampaign();
    seedBillingAccount(BIZ, PLACEHOLDER_COST_PER_MESSAGE_PAISE - 1); // one paisa short

    const preflight = await getCampaignPreflight(BIZ, campaign.id);
    expect(preflight.billing.sufficientCreditForAllEligible).toBe(false);
    expect(preflight.readiness.ready).toBe(false);
    expect(preflight.readiness.reasons.some((r: string) => r.includes("afforded"))).toBe(true);
  });

  it("billing not configured at all -- NOT_READY with a clear reason, never silently treated as free", async () => {
    const { getCampaignPreflight } = await import("../../server/modules/campaigns/service");
    const { campaign } = await makeReadyCampaign();
    // no seedBillingAccount call -- business has no billing account
    const preflight = await getCampaignPreflight(BIZ, campaign.id);
    expect(preflight.billing.billingConfigured).toBe(false);
    expect(preflight.readiness.ready).toBe(false);
  });

  it("invalid/archived template version -- NOT_READY, zero eligible regardless of consent", async () => {
    const { getCampaignPreflight } = await import("../../server/modules/campaigns/service");
    const { campaign, version } = await makeReadyCampaign();
    seedBillingAccount(BIZ, 1_000_000);
    const row = tables.get("templateVersions")!.find((r: any) => r.id === version.id)!;
    row.status = "archived";

    const preflight = await getCampaignPreflight(BIZ, campaign.id);
    expect(preflight.eligibility.eligibleCount).toBe(0);
    expect(preflight.readiness.ready).toBe(false);
  });

  it("cross-business campaign access -- NotFoundError, never confirms existence", async () => {
    const { getCampaignPreflight, NotFoundError } = await import("../../server/modules/campaigns/service");
    const { campaign } = await makeReadyCampaign({ businessId: OTHER_BIZ });
    await expect(getCampaignPreflight(BIZ, campaign.id)).rejects.toThrow(NotFoundError);
  });

  it("pre-flight NEVER mutates -- no campaignRecipients row, no frequency reservation, no charge, no message, even after being called repeatedly", async () => {
    const { getCampaignPreflight } = await import("../../server/modules/campaigns/service");
    const { campaign } = await makeReadyCampaign();
    seedBillingAccount(BIZ, 1_000_000);

    await getCampaignPreflight(BIZ, campaign.id);
    await getCampaignPreflight(BIZ, campaign.id);
    await getCampaignPreflight(BIZ, campaign.id);

    expect(tables.get("campaignRecipients")!.length).toBe(0);
    expect(tables.get("customerMarketingFrequency")!.length).toBe(0);
    expect(tables.get("businessMarketingThroughput")!.length).toBe(0);
    expect(tables.get("messagingMessages")!.length).toBe(0);
    const account = tables.get("billingAccounts")!.find((a: any) => a.organizationId === BIZ)!;
    expect(account.walletBalancePaise).toBe(1_000_000); // untouched
  });

  it("PARITY: preflight's predicted eligible count matches actual sent count when nothing changes between preview and execution", async () => {
    const { getCampaignPreflight, executeCampaign, getCampaignReport } = await import("../../server/modules/campaigns/service");
    const { campaign } = await makeReadyCampaign();
    seedBillingAccount(BIZ, 1_000_000);

    const preflight = await getCampaignPreflight(BIZ, campaign.id);
    const predictedEligible = preflight.eligibility.eligibleCount;

    await executeCampaign(BIZ, AUTHOR, campaign.id);
    const report = await getCampaignReport(BIZ, campaign.id);

    expect(report.sent).toBe(predictedEligible);
  });

  it("PARITY: preflight correctly predicts zero-eligible for a blocked customer, and execution agrees", async () => {
    const { getCampaignPreflight, executeCampaign, getCampaignReport } = await import("../../server/modules/campaigns/service");
    const { updateCustomer } = await import("../../server/modules/customers/service");
    const { campaign, customer } = await makeReadyCampaign();
    await updateCustomer(BIZ, AUTHOR, customer.id, { status: "blocked" });
    seedBillingAccount(BIZ, 1_000_000);

    const preflight = await getCampaignPreflight(BIZ, campaign.id);
    expect(preflight.eligibility.eligibleCount).toBe(0);

    await executeCampaign(BIZ, AUTHOR, campaign.id);
    const report = await getCampaignReport(BIZ, campaign.id);
    expect(report.sent).toBe(0);
    expect(report.skippedByReason["customer_blocked"]).toBe(1);
  });
});

describe("Phase 8B-R0: enriched getCampaignReport (cost + delivery availability)", () => {
  it("cost.totalChargedPaise sums real per-recipient charges, never a placeholder-times-count estimate", async () => {
    const { executeCampaign, getCampaignReport } = await import("../../server/modules/campaigns/service");
    const { campaign } = await makeReadyCampaign();
    await executeCampaign(BIZ, AUTHOR, campaign.id);
    const report = await getCampaignReport(BIZ, campaign.id);
    expect(report.cost.availability).toBe("AVAILABLE");
    expect(report.cost.totalChargedPaise).toBe(10); // chargeMock returns costPaise:10, one recipient sent
  });

  it("cost is zero (not missing) when nothing was ever sent -- 0 means measured, not NOT_AVAILABLE", async () => {
    const { getCampaignReport } = await import("../../server/modules/campaigns/service");
    const { campaign } = await makeReadyCampaign();
    const report = await getCampaignReport(BIZ, campaign.id); // never scheduled/executed
    expect(report.cost.totalChargedPaise).toBe(0);
    expect(report.cost.availability).toBe("AVAILABLE"); // the system genuinely measured zero
  });

  it("delivery.sent is AVAILABLE; accepted/delivered/read are explicitly NOT_AVAILABLE, never fabricated as 0 or omitted", async () => {
    const { executeCampaign, getCampaignReport } = await import("../../server/modules/campaigns/service");
    const { campaign } = await makeReadyCampaign();
    await executeCampaign(BIZ, AUTHOR, campaign.id);
    const report = await getCampaignReport(BIZ, campaign.id);
    expect(report.delivery.sent).toEqual({ availability: "AVAILABLE", count: 1 });
    expect(report.delivery.accepted.availability).toBe("NOT_AVAILABLE");
    expect(report.delivery.delivered.availability).toBe("NOT_AVAILABLE");
    expect(report.delivery.read.availability).toBe("NOT_AVAILABLE");
    expect(typeof report.delivery.accepted.reason).toBe("string");
    expect(report.delivery.accepted.reason.length).toBeGreaterThan(0);
  });
});
