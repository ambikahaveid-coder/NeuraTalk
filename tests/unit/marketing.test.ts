import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Business-wide marketing reporting tests (Phase 8B-R0).
 * See docs/neura-ecosystem/36_PHASE8B_R0_REPORTING_PREFLIGHT_IMPLEMENTATION.md.
 *
 * Full integration: uses the REAL customers, audiences, templates,
 * approvals, campaigns, and marketing services together against ONE
 * shared in-memory fake DB -- same pattern as campaigns.test.ts, focused
 * here on cross-campaign rollup and cross-business isolation of the
 * aggregate endpoints specifically (doc 36 section "R0-H" -- aggregate
 * endpoints are the most important tenant-isolation surface to test,
 * since they can leak cross-tenant information even when individual
 * records are protected).
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
  if (cond.__in) return cond.values.includes(row[cond.field]);
  if (cond.__lt) return row[cond.field] < cond.value;
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
  const op = String(expr.strings[1]).trim();
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

const BIZ = 1;
const OTHER_BIZ = 2;
const AUTHOR = 10;
const APPROVER = 20;

async function makeApprovedTemplateVersion(businessId = BIZ) {
  const { createTemplate, createOrEditDraftVersion } = await import("../../server/modules/templates/service");
  const t = await createTemplate(businessId, AUTHOR, { name: `tpl_${Date.now()}_${Math.random()}`, category: "marketing" });
  const v = await createOrEditDraftVersion(businessId, AUTHOR, t.id, { content: "Hi {{name}}", variables: [{ name: "name", type: "text", required: false }] });
  const row = tables.get("templateVersions")!.find((r) => r.id === v.id)!;
  row.status = "approved";
  return { template: t, version: row };
}

async function makeReadyCampaign(businessId = BIZ, phone: string) {
  const { createCustomer, setChannelConsent } = await import("../../server/modules/customers/service");
  const { createAudience, addMember } = await import("../../server/modules/audiences/service");
  const { createCampaign, updateCampaign } = await import("../../server/modules/campaigns/service");
  const { createApprovalRequest, approveRequest } = await import("../../server/modules/approvals/service");

  const customer = await createCustomer(businessId, AUTHOR, { name: "Kiran", phone });
  await setChannelConsent(businessId, AUTHOR, customer.id, "marketing" as any, true);
  const audience = await createAudience(businessId, AUTHOR, { name: `aud_${Date.now()}_${Math.random()}` });
  await addMember(businessId, AUTHOR, audience.id, customer.id);
  const { version } = await makeApprovedTemplateVersion(businessId);

  const campaign = await createCampaign(businessId, AUTHOR, { name: `camp_${Date.now()}_${Math.random()}`, category: "marketing" });
  await updateCampaign(businessId, AUTHOR, campaign.id, { templateVersionId: version.id, audienceId: audience.id });
  const request = await createApprovalRequest(businessId, AUTHOR, "campaign", campaign.id);
  await approveRequest(businessId, APPROVER, request.id, false);

  return { campaign, customer, audience };
}

function seedBillingAccount(businessId: number, walletBalancePaise: number) {
  tables.get("billingAccounts")!.push({ id: businessId, organizationId: businessId, walletBalancePaise, lockedBalancePaise: 0, isBlocked: false, updatedAt: new Date() });
}

async function svc() { return import("../../server/modules/marketing/service"); }

describe("getBusinessMarketingReport: business-wide rollup", () => {
  it("aggregates across MULTIPLE campaigns for the same business", async () => {
    const { executeCampaign } = await import("../../server/modules/campaigns/service");
    seedBillingAccount(BIZ, 1_000_000);
    const { campaign: c1 } = await makeReadyCampaign(BIZ, "9111111111");
    const { campaign: c2 } = await makeReadyCampaign(BIZ, "9222222222");
    await executeCampaign(BIZ, AUTHOR, c1.id);
    await executeCampaign(BIZ, AUTHOR, c2.id);

    const s = await svc();
    const report = await s.getBusinessMarketingReport(BIZ);
    expect(report.campaignCount).toBe(2);
    expect(report.totals.sent).toBe(2);
    expect(report.totals.targeted).toBe(2);
    expect(report.totals.cost.totalChargedPaise).toBe(20);
    expect(report.campaignsByStatus["completed"]).toBe(2);
  });

  it("Business A's rollup NEVER includes Business B's campaign data (aggregate tenant isolation, doc 36 R0-H)", async () => {
    const { executeCampaign } = await import("../../server/modules/campaigns/service");
    seedBillingAccount(BIZ, 1_000_000);
    seedBillingAccount(OTHER_BIZ, 1_000_000);
    const { campaign: mine } = await makeReadyCampaign(BIZ, "9111111111");
    const { campaign: theirs } = await makeReadyCampaign(OTHER_BIZ, "9222222222");
    await executeCampaign(BIZ, AUTHOR, mine.id);
    await executeCampaign(OTHER_BIZ, AUTHOR, theirs.id);

    const s = await svc();
    const myReport = await s.getBusinessMarketingReport(BIZ);
    expect(myReport.campaignCount).toBe(1);
    expect(myReport.totals.sent).toBe(1);
    expect(myReport.totals.cost.totalChargedPaise).toBe(10); // never Business B's 10 too
  });

  it("a business with zero campaigns reports honest zeros, not an error", async () => {
    const s = await svc();
    const report = await s.getBusinessMarketingReport(BIZ);
    expect(report.campaignCount).toBe(0);
    expect(report.totals.sent).toBe(0);
    expect(report.totals.cost.totalChargedPaise).toBe(0);
  });

  it("delivery metrics beyond SENT are explicitly NOT_AVAILABLE at the rollup level too", async () => {
    const s = await svc();
    const report = await s.getBusinessMarketingReport(BIZ);
    expect(report.delivery.sent.availability).toBe("AVAILABLE");
    expect(report.delivery.accepted.availability).toBe("NOT_AVAILABLE");
    expect(report.delivery.delivered.availability).toBe("NOT_AVAILABLE");
  });
});

describe("getMarketingFrequencyStatus: business + per-customer visibility", () => {
  it("business-level status reflects real throughput usage", async () => {
    const { reserveBusinessThroughputSlot } = await import("../../server/modules/campaigns/frequency");
    await reserveBusinessThroughputSlot(fakeDb as any, BIZ);
    await reserveBusinessThroughputSlot(fakeDb as any, BIZ);

    const s = await svc();
    const status = await s.getMarketingFrequencyStatus(BIZ);
    expect(status.business.used).toBe(2);
    expect(status.customer).toBeNull();
  });

  it("per-customer status is returned when customerId is supplied and owned by the business", async () => {
    const { createCustomer } = await import("../../server/modules/customers/service");
    const { reserveCustomerFrequencySlot } = await import("../../server/modules/campaigns/frequency");
    const customer = await createCustomer(BIZ, AUTHOR, { name: "A", phone: "9333333333" });
    await reserveCustomerFrequencySlot(fakeDb as any, BIZ, customer.id);

    const s = await svc();
    const status = await s.getMarketingFrequencyStatus(BIZ, customer.id);
    expect(status.customer).not.toBeNull();
    expect(status.customer!.used).toBe(1);
    expect(status.customer!.customerId).toBe(customer.id);
  });

  it("Business A cannot see Business B's customer frequency usage (NotFoundError, never confirms existence)", async () => {
    const { createCustomer } = await import("../../server/modules/customers/service");
    const otherCustomer = await createCustomer(OTHER_BIZ, AUTHOR, { name: "B", phone: "9444444444" });

    const s = await svc();
    await expect(s.getMarketingFrequencyStatus(BIZ, otherCustomer.id)).rejects.toThrow(s.NotFoundError);
  });

  it("Business A's business-level throughput is independent of Business B's usage", async () => {
    const { reserveBusinessThroughputSlot } = await import("../../server/modules/campaigns/frequency");
    await reserveBusinessThroughputSlot(fakeDb as any, OTHER_BIZ);
    await reserveBusinessThroughputSlot(fakeDb as any, OTHER_BIZ);
    await reserveBusinessThroughputSlot(fakeDb as any, OTHER_BIZ);

    const s = await svc();
    const status = await s.getMarketingFrequencyStatus(BIZ);
    expect(status.business.used).toBe(0); // Business A's own usage, unaffected by B's 3 reservations
  });
});
