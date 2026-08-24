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
];

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
function evalCond(row: Row, cond: any): boolean {
  if (!cond) return true;
  if (cond.__and) return cond.conds.every((c: any) => evalCond(row, c));
  if (cond.__or) return cond.conds.some((c: any) => evalCond(row, c));
  if (cond.__eq) return row[cond.field] === cond.value;
  if (cond.__in) return cond.values.includes(row[cond.field]);
  if (cond.__ilike) {
    const val = String(row[cond.field] ?? "").toLowerCase();
    const pattern = String(cond.value).replace(/%/g, "").toLowerCase();
    return val.includes(pattern);
  }
  throw new Error("Unknown condition: " + JSON.stringify(cond));
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
