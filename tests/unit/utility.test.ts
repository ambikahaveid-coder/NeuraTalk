import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Business Utility Messaging tests (Phase 7).
 * See docs/neura-ecosystem/32_BUSINESS_UTILITY_MESSAGING_IMPLEMENTATION.md.
 *
 * Full integration: uses the REAL customers, templates, and messaging
 * services together with the REAL utility service against ONE shared
 * in-memory fake DB -- same pattern as otp.test.ts/campaigns.test.ts.
 * utility/billing.ts is mocked (its shared underlying primitive's real
 * arithmetic is already proven in campaigns-billing.test.ts).
 *
 * The InsertChain below is constraint-aware SPECIFICALLY for
 * businessUtilityEvents' (businessId, eventType, eventReference) unique
 * index -- simulating a real Postgres unique-violation (code 23505) so
 * the idempotency guarantee can be proven under genuine
 * Promise.allSettled concurrency, exactly as the brief requires for this
 * table (unlike OTP's challenge-creation dedup, which this project
 * explicitly deferred).
 */

type Row = Record<string, any>;
const tables = new Map<string, Row[]>();
const idCounters = new Map<string, number>();

const ALL_TABLES = [
  "organizations", "users", "customers", "templates", "templateVersions",
  "businessUtilityEvents",
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

// The one table with a simulated real unique constraint -- proves genuine
// concurrent-insert idempotency, not just an app-level pre-check.
const UNIQUE_KEYS: Record<string, string[]> = {
  businessUtilityEvents: ["businessId", "eventType", "eventReference"],
};

class InsertChain implements PromiseLike<Row[]> {
  private row: Row | null = null;
  constructor(private tableName: string) {}
  values(data: Row) {
    const uniqueFields = UNIQUE_KEYS[this.tableName];
    if (uniqueFields) {
      const existing = (tables.get(this.tableName) ?? []).find((r) => uniqueFields.every((f) => r[f] === data[f]));
      if (existing) {
        const err: any = new Error("duplicate key value violates unique constraint");
        err.code = "23505";
        throw err;
      }
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

vi.mock("../../server/db", () => ({ db: fakeDb }));
vi.mock("../../server/observability", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock("../../server/audit", () => ({ createAuditLog: vi.fn(async () => {}) }));

let chargeMock: ReturnType<typeof vi.fn>;
vi.mock("../../server/modules/utility/billing", () => ({
  PLACEHOLDER_COST_PER_UTILITY_MESSAGE_PAISE: 10,
  chargeUtilityMessage: (...args: any[]) => chargeMock(...args),
}));

vi.mock("drizzle-orm", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    eq: (column: string, value: unknown) => ({ __eq: true, field: fieldNameOf(column), value }),
    and: (...conds: any[]) => ({ __and: true, conds }),
    or: (...conds: any[]) => ({ __or: true, conds }),
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
    customers: mkTable("customers", [
      "id", "businessId", "linkedUserId", "name", "phone", "normalizedPhone", "email", "normalizedEmail",
      "externalRef", "notes", "status", "source", "createdBy", "createdAt", "updatedAt", "archivedBy", "archivedAt",
    ]),
    templates: mkTable("templates", ["id", "businessId", "name", "category", "createdBy", "createdAt"]),
    templateVersions: mkTable("templateVersions", [
      "id", "templateId", "language", "versionNumber", "status", "title", "content", "variables",
      "mediaType", "mediaUrl", "metadata", "createdBy", "createdAt", "submittedBy", "submittedAt",
      "decidedBy", "decidedAt", "rejectionReason", "archivedBy", "archivedAt",
    ]),
    businessUtilityEvents: mkTable("businessUtilityEvents", [
      "id", "businessId", "customerId", "eventType", "eventReference", "templateVersionId", "status",
      "failureReason", "messageId", "chargedPaise", "createdBy", "createdAt", "processedAt",
    ]),
    messagingConversations: mkTable("messagingConversations", ["id", "type", "organizationId", "metadata", "isArchived", "createdAt", "updatedAt"]),
    businessConversations: mkTable("businessConversations", ["id", "conversationId", "businessId", "customerId", "status", "assignedToUserId", "createdAt"]),
    messagingParticipants: mkTable("messagingParticipants", ["id", "conversationId", "participantType", "participantId", "role", "joinedAt", "leftAt"]),
    messagingMessages: mkTable("messagingMessages", ["id", "conversationId", "senderParticipantId", "messageType", "category", "content", "templateId", "replyToMessageId", "createdAt", "editedAt", "deletedAt"]),
    messagingDeliveries: mkTable("messagingDeliveries", ["id", "messageId", "participantId", "status", "statusAt", "failureReason", "providerRef"]),
    messagingEvents: mkTable("messagingEvents", ["id", "conversationId", "messageId", "eventType", "payload", "createdAt"]),
  };
});

beforeEach(() => {
  resetFakeDb();
  vi.clearAllMocks();
  chargeMock = vi.fn(async () => ({ charged: true, billingAccountId: 1, costPaise: 10 }));
});

const BIZ = 1;
const OTHER_BIZ = 2;
const STAFF = 10;

async function makeCustomer(businessId = BIZ, overrides: Record<string, any> = {}) {
  const { createCustomer } = await import("../../server/modules/customers/service");
  return createCustomer(businessId, STAFF, { name: "Kiran", phone: "9876543210", ...overrides });
}

async function makeApprovedUtilityTemplate(businessId = BIZ, vars: any[] = [{ name: "bookingId", type: "text", required: true }]) {
  const { createTemplate, createOrEditDraftVersion } = await import("../../server/modules/templates/service");
  const t = await createTemplate(businessId, STAFF, { name: `util_tpl_${Date.now()}_${Math.random()}`, category: "utility" });
  const content = vars.map((v) => `{{${v.name}}}`).join(" ") || "Your update is ready";
  const v = await createOrEditDraftVersion(businessId, STAFF, t.id, { content, variables: vars });
  const row = tables.get("templateVersions")!.find((r) => r.id === v.id)!;
  row.status = "approved";
  return { template: t, version: row };
}

async function svc() { return import("../../server/modules/utility/service"); }

// ---------------------------------------------------------------------------
// 2/3. Category separation / domain model
// ---------------------------------------------------------------------------

describe("Utility message trigger", () => {
  it("creates a CREATED event with a canonical message, category=UTILITY", async () => {
    const s = await svc();
    const customer = await makeCustomer();
    const { version } = await makeApprovedUtilityTemplate();
    const result: any = await s.triggerUtilityMessage(BIZ, {
      eventType: "booking_confirmation", eventReference: "booking:1001", customerId: customer.id,
      templateVersionId: version.id, variables: { bookingId: "BK-1001" },
    });
    expect(result.wasDuplicate).toBe(false);
    expect(result.event.status).toBe("created");
    const message = tables.get("messagingMessages")!.at(-1)!;
    expect(message.category).toBe("utility");
    expect(message.content).toContain("BK-1001");
  });

  it("rejects an invalid event type", async () => {
    const s = await svc();
    const customer = await makeCustomer();
    const { version } = await makeApprovedUtilityTemplate();
    await expect(s.triggerUtilityMessage(BIZ, {
      eventType: "spam_blast", eventReference: "x:1", customerId: customer.id, templateVersionId: version.id,
    })).rejects.toThrow(s.ValidationError);
  });

  it("requires a non-empty eventReference", async () => {
    const s = await svc();
    const customer = await makeCustomer();
    const { version } = await makeApprovedUtilityTemplate();
    await expect(s.triggerUtilityMessage(BIZ, {
      eventType: "booking_confirmation", eventReference: "", customerId: customer.id, templateVersionId: version.id,
    })).rejects.toThrow(s.ValidationError);
  });
});

// ---------------------------------------------------------------------------
// 11/12/16. Idempotency, replay, retry
// ---------------------------------------------------------------------------

describe("Idempotency: same (business, eventType, eventReference) never produces two messages", () => {
  it("a duplicate trigger returns wasDuplicate=true and does not create a second message or charge", async () => {
    const s = await svc();
    const customer = await makeCustomer();
    const { version } = await makeApprovedUtilityTemplate();
    const input = { eventType: "booking_confirmation", eventReference: "booking:2002", customerId: customer.id, templateVersionId: version.id, variables: { bookingId: "BK-2002" } };
    const first: any = await s.triggerUtilityMessage(BIZ, input);
    const second: any = await s.triggerUtilityMessage(BIZ, input);
    expect(second.wasDuplicate).toBe(true);
    expect(second.event.id).toBe(first.event.id);
    expect(tables.get("messagingMessages")!.length).toBe(1);
    expect(chargeMock).toHaveBeenCalledTimes(1);
  });

  it("genuinely concurrent duplicate triggers: exactly one creates a message, the other reports wasDuplicate", async () => {
    const s = await svc();
    const customer = await makeCustomer();
    const { version } = await makeApprovedUtilityTemplate();
    const input = { eventType: "order_status_update", eventReference: "order:3003", customerId: customer.id, templateVersionId: version.id, variables: { bookingId: "ORD-3003" } };

    const results = await Promise.allSettled([
      s.triggerUtilityMessage(BIZ, input),
      s.triggerUtilityMessage(BIZ, input),
    ]);
    const fulfilled = results.filter((r): r is PromiseFulfilledResult<any> => r.status === "fulfilled").map((r) => r.value);
    expect(fulfilled.length).toBe(2); // both resolve -- one real, one duplicate-detected
    const duplicates = fulfilled.filter((r) => r.wasDuplicate);
    const reals = fulfilled.filter((r) => !r.wasDuplicate);
    expect(duplicates.length).toBe(1);
    expect(reals.length).toBe(1);
    expect(tables.get("messagingMessages")!.length).toBe(1);
    expect(chargeMock).toHaveBeenCalledTimes(1);
  });

  it("a DIFFERENT eventReference for the same business+eventType is a genuinely new event", async () => {
    const s = await svc();
    const customer = await makeCustomer();
    const { version } = await makeApprovedUtilityTemplate();
    await s.triggerUtilityMessage(BIZ, { eventType: "booking_confirmation", eventReference: "booking:A", customerId: customer.id, templateVersionId: version.id, variables: { bookingId: "A" } });
    const second: any = await s.triggerUtilityMessage(BIZ, { eventType: "booking_confirmation", eventReference: "booking:B", customerId: customer.id, templateVersionId: version.id, variables: { bookingId: "B" } });
    expect(second.wasDuplicate).toBe(false);
    expect(tables.get("messagingMessages")!.length).toBe(2);
  });

  it("retrying the SAME eventReference after a FAILED outcome returns the ORIGINAL failure, not a fresh attempt (documented retry policy)", async () => {
    const s = await svc();
    const { updateCustomer } = await import("../../server/modules/customers/service");
    const customer = await makeCustomer();
    await updateCustomer(BIZ, STAFF, customer.id, { status: "blocked" });
    const { version } = await makeApprovedUtilityTemplate();
    const input = { eventType: "service_reminder", eventReference: "reminder:4004", customerId: customer.id, templateVersionId: version.id };

    await expect(s.triggerUtilityMessage(BIZ, input)).rejects.toThrow(s.UtilityTriggerFailedError);
    // unblock the customer -- a real fix -- but retry with the SAME reference still returns the cached duplicate result, not a fresh success
    await updateCustomer(BIZ, STAFF, customer.id, { status: "active" });
    const retry: any = await s.triggerUtilityMessage(BIZ, input);
    expect(retry.wasDuplicate).toBe(true);
    expect(retry.event.status).toBe("failed");
  });
});

// ---------------------------------------------------------------------------
// 8. Customer-state rules
// ---------------------------------------------------------------------------

describe("Customer-state rules", () => {
  it("ACTIVE customer -> message created", async () => {
    const s = await svc();
    const customer = await makeCustomer();
    const { version } = await makeApprovedUtilityTemplate();
    const result: any = await s.triggerUtilityMessage(BIZ, { eventType: "payment_receipt", eventReference: "pay:1", customerId: customer.id, templateVersionId: version.id, variables: { bookingId: "P1" } });
    expect(result.event.status).toBe("created");
  });

  it("BLOCKED customer -> FAILED with reason customer_blocked, no message created", async () => {
    const s = await svc();
    const { updateCustomer } = await import("../../server/modules/customers/service");
    const customer = await makeCustomer();
    await updateCustomer(BIZ, STAFF, customer.id, { status: "blocked" });
    const { version } = await makeApprovedUtilityTemplate();
    try {
      await s.triggerUtilityMessage(BIZ, { eventType: "payment_receipt", eventReference: "pay:2", customerId: customer.id, templateVersionId: version.id });
      throw new Error("should have thrown");
    } catch (e: any) {
      expect(e).toBeInstanceOf(s.UtilityTriggerFailedError);
      expect(e.reason).toBe("customer_blocked");
    }
    expect(tables.get("messagingMessages")!.length).toBe(0);
  });

  it("ARCHIVED customer -> FAILED with reason customer_archived, no operational message leaks through", async () => {
    const s = await svc();
    const { archiveCustomer } = await import("../../server/modules/customers/service");
    const customer = await makeCustomer();
    await archiveCustomer(BIZ, STAFF, customer.id);
    const { version } = await makeApprovedUtilityTemplate();
    try {
      await s.triggerUtilityMessage(BIZ, { eventType: "delivery_status_update", eventReference: "del:1", customerId: customer.id, templateVersionId: version.id });
      throw new Error("should have thrown");
    } catch (e: any) {
      expect(e.reason).toBe("customer_archived");
    }
    expect(tables.get("messagingMessages")!.length).toBe(0);
  });

  it("unknown customerId -> NotFoundError (never confirms cross-tenant existence)", async () => {
    const s = await svc();
    const { version } = await makeApprovedUtilityTemplate();
    await expect(s.triggerUtilityMessage(BIZ, { eventType: "account_notification", eventReference: "acct:1", customerId: 9999, templateVersionId: version.id })).rejects.toThrow(s.NotFoundError);
  });
});

// ---------------------------------------------------------------------------
// 5/9/10. Template rules / consent boundary / marketing-content safety
// ---------------------------------------------------------------------------

describe("Template rules -- category and approval governance is the safety mechanism", () => {
  it("rejects a template with category=marketing (utility != marketing, category injection guard)", async () => {
    const s = await svc();
    const customer = await makeCustomer();
    const { createTemplate, createOrEditDraftVersion } = await import("../../server/modules/templates/service");
    const t = await createTemplate(BIZ, STAFF, { name: "promo_tpl", category: "marketing" });
    const v = await createOrEditDraftVersion(BIZ, STAFF, t.id, { content: "Buy now, 20% off!", variables: [] });
    tables.get("templateVersions")!.find((r) => r.id === v.id)!.status = "approved";
    try {
      await s.triggerUtilityMessage(BIZ, { eventType: "order_status_update", eventReference: "o:1", customerId: customer.id, templateVersionId: v.id });
      throw new Error("should have thrown");
    } catch (e: any) {
      expect(e.reason).toBe("template_not_utility_category");
    }
  });

  it("rejects a template with category=authentication (utility != authentication, category injection guard)", async () => {
    const s = await svc();
    const customer = await makeCustomer();
    const { createTemplate, createOrEditDraftVersion } = await import("../../server/modules/templates/service");
    const t = await createTemplate(BIZ, STAFF, { name: "auth_tpl", category: "authentication" });
    const v = await createOrEditDraftVersion(BIZ, STAFF, t.id, { content: "Code: {{code}}", variables: [{ name: "code", type: "text", required: true }] });
    tables.get("templateVersions")!.find((r) => r.id === v.id)!.status = "approved";
    try {
      await s.triggerUtilityMessage(BIZ, { eventType: "order_status_update", eventReference: "o:2", customerId: customer.id, templateVersionId: v.id, variables: { code: "424242" } });
      throw new Error("should have thrown");
    } catch (e: any) {
      expect(e.reason).toBe("template_not_utility_category");
    }
  });

  it("rejects a non-APPROVED utility template", async () => {
    const s = await svc();
    const customer = await makeCustomer();
    const { createTemplate, createOrEditDraftVersion } = await import("../../server/modules/templates/service");
    const t = await createTemplate(BIZ, STAFF, { name: "draft_util_tpl", category: "utility" });
    const v = await createOrEditDraftVersion(BIZ, STAFF, t.id, { content: "Update ready", variables: [] });
    try {
      await s.triggerUtilityMessage(BIZ, { eventType: "order_status_update", eventReference: "o:3", customerId: customer.id, templateVersionId: v.id });
      throw new Error("should have thrown");
    } catch (e: any) {
      expect(e.reason).toBe("template_not_approved");
    }
  });

  it("rejects an ARCHIVED utility template version", async () => {
    const s = await svc();
    const customer = await makeCustomer();
    const { version } = await makeApprovedUtilityTemplate();
    version.status = "archived";
    try {
      await s.triggerUtilityMessage(BIZ, { eventType: "order_status_update", eventReference: "o:4", customerId: customer.id, templateVersionId: version.id, variables: { bookingId: "X" } });
      throw new Error("should have thrown");
    } catch (e: any) {
      expect(e.reason).toBe("template_not_approved");
    }
  });

  it("rejects a template belonging to a different business (templateId manipulation)", async () => {
    const s = await svc();
    const customer = await makeCustomer();
    const { version } = await makeApprovedUtilityTemplate(OTHER_BIZ);
    await expect(s.triggerUtilityMessage(BIZ, { eventType: "order_status_update", eventReference: "o:5", customerId: customer.id, templateVersionId: version.id })).rejects.toThrow(s.NotFoundError);
  });
});

// ---------------------------------------------------------------------------
// 6. Variable safety
// ---------------------------------------------------------------------------

describe("Variable safety", () => {
  it("rejects a supplied variable the template didn't declare (structural injection guard)", async () => {
    const s = await svc();
    const customer = await makeCustomer();
    const { version } = await makeApprovedUtilityTemplate(BIZ, [{ name: "bookingId", type: "text", required: true }]);
    try {
      await s.triggerUtilityMessage(BIZ, {
        eventType: "booking_confirmation", eventReference: "b:1", customerId: customer.id, templateVersionId: version.id,
        variables: { bookingId: "BK1", discountCode: "20OFF" }, // unsupported extra field
      });
      throw new Error("should have thrown");
    } catch (e: any) {
      expect(e.reason).toBe("render_failed");
    }
  });

  it("rejects a missing required variable", async () => {
    const s = await svc();
    const customer = await makeCustomer();
    const { version } = await makeApprovedUtilityTemplate(BIZ, [{ name: "bookingId", type: "text", required: true }]);
    try {
      await s.triggerUtilityMessage(BIZ, { eventType: "booking_confirmation", eventReference: "b:2", customerId: customer.id, templateVersionId: version.id, variables: {} });
      throw new Error("should have thrown");
    } catch (e: any) {
      expect(e.reason).toBe("render_failed");
    }
  });

  it("the 'name' variable, if declared, is ALWAYS server-resolved from the customer record -- a caller-supplied value is ignored", async () => {
    const s = await svc();
    const customer = await makeCustomer(BIZ, { name: "RealCustomerName" });
    const { version } = await makeApprovedUtilityTemplate(BIZ, [{ name: "name", type: "text", required: true }]);
    await s.triggerUtilityMessage(BIZ, {
      eventType: "account_notification", eventReference: "acct:2", customerId: customer.id, templateVersionId: version.id,
      variables: { name: "SpoofedName" }, // attempted override
    });
    const message = tables.get("messagingMessages")!.at(-1)!;
    expect(message.content).toContain("RealCustomerName");
    expect(message.content).not.toContain("SpoofedName");
  });

  it("customerId=A + a templateVersionId belonging to A, but a template bound with variables describing customer B's data, is a caller-trust-boundary concern documented as out of scope -- this test proves TENANT scoping (not semantic booking ownership) is what this function verifies", async () => {
    const s = await svc();
    const customerA = await makeCustomer(BIZ, { name: "CustomerA" });
    const { version } = await makeApprovedUtilityTemplate(BIZ, [{ name: "bookingId", type: "text", required: true }]);
    // triggerUtilityMessage cannot know whether "booking:999" really belongs
    // to customerA -- that verification is the CALLER's responsibility
    // (documented trust boundary, doc 32 section 6). What IS verified here:
    // customerA genuinely belongs to BIZ.
    const result: any = await s.triggerUtilityMessage(BIZ, { eventType: "booking_confirmation", eventReference: "booking:999", customerId: customerA.id, templateVersionId: version.id, variables: { bookingId: "999" } });
    expect(result.event.customerId).toBe(customerA.id);
  });
});

// ---------------------------------------------------------------------------
// 7. Tenant isolation
// ---------------------------------------------------------------------------

describe("Tenant isolation", () => {
  it("Business A cannot trigger a utility message for Business B's customer (customerId manipulation)", async () => {
    const s = await svc();
    const otherCustomer = await makeCustomer(OTHER_BIZ);
    const { version } = await makeApprovedUtilityTemplate();
    await expect(s.triggerUtilityMessage(BIZ, { eventType: "booking_confirmation", eventReference: "b:x", customerId: otherCustomer.id, templateVersionId: version.id })).rejects.toThrow(s.NotFoundError);
  });

  it("Business A cannot read Business B's utility events", async () => {
    const s = await svc();
    const otherCustomer = await makeCustomer(OTHER_BIZ);
    const { version } = await makeApprovedUtilityTemplate(OTHER_BIZ);
    const created: any = await s.triggerUtilityMessage(OTHER_BIZ, { eventType: "booking_confirmation", eventReference: "b:y", customerId: otherCustomer.id, templateVersionId: version.id, variables: { bookingId: "Y" } });
    expect(await s.getUtilityEvent(BIZ, created.event.id)).toBeNull();
  });

  it("the SAME eventReference is independent per business -- no cross-business idempotency collision", async () => {
    const s = await svc();
    const customerA = await makeCustomer(BIZ);
    const customerB = await makeCustomer(OTHER_BIZ);
    const { version: vA } = await makeApprovedUtilityTemplate(BIZ);
    const { version: vB } = await makeApprovedUtilityTemplate(OTHER_BIZ);
    const a: any = await s.triggerUtilityMessage(BIZ, { eventType: "booking_confirmation", eventReference: "shared-ref", customerId: customerA.id, templateVersionId: vA.id, variables: { bookingId: "A" } });
    const b: any = await s.triggerUtilityMessage(OTHER_BIZ, { eventType: "booking_confirmation", eventReference: "shared-ref", customerId: customerB.id, templateVersionId: vB.id, variables: { bookingId: "B" } });
    expect(a.wasDuplicate).toBe(false);
    expect(b.wasDuplicate).toBe(false);
    expect(a.event.id).not.toBe(b.event.id);
  });
});

// ---------------------------------------------------------------------------
// 15. Message identity
// ---------------------------------------------------------------------------

describe("Messaging boundary", () => {
  it("sender is the BUSINESS participant, never a human user", async () => {
    const s = await svc();
    const customer = await makeCustomer();
    const { version } = await makeApprovedUtilityTemplate();
    await s.triggerUtilityMessage(BIZ, { eventType: "booking_confirmation", eventReference: "b:sender", customerId: customer.id, templateVersionId: version.id, variables: { bookingId: "S1" } });
    const message = tables.get("messagingMessages")!.at(-1)!;
    const sender = tables.get("messagingParticipants")!.find((p) => p.id === message.senderParticipantId);
    expect(sender.participantType).toBe("business");
  });

  it("generationSource is server-set, referencing the utility event id", async () => {
    const s = await svc();
    const customer = await makeCustomer();
    const { version } = await makeApprovedUtilityTemplate();
    const result: any = await s.triggerUtilityMessage(BIZ, { eventType: "booking_confirmation", eventReference: "b:gensrc", customerId: customer.id, templateVersionId: version.id, variables: { bookingId: "G1" } });
    const event = tables.get("messagingEvents")!.find((e) => e.eventType === "message.created");
    expect(event.payload.generationSource).toEqual({ type: "utility_event", id: result.event.id });
  });
});

// ---------------------------------------------------------------------------
// 13. Billing boundary
// ---------------------------------------------------------------------------

describe("Billing boundary", () => {
  it("charges exactly once per created event", async () => {
    const s = await svc();
    const customer = await makeCustomer();
    const { version } = await makeApprovedUtilityTemplate();
    await s.triggerUtilityMessage(BIZ, { eventType: "booking_confirmation", eventReference: "b:bill1", customerId: customer.id, templateVersionId: version.id, variables: { bookingId: "B1" } });
    expect(chargeMock).toHaveBeenCalledTimes(1);
  });

  it("insufficient credit fails closed -- no message, no charge left applied, event recorded as FAILED", async () => {
    const s = await svc();
    const customer = await makeCustomer();
    const { version } = await makeApprovedUtilityTemplate();
    chargeMock = vi.fn(async () => ({ charged: false, reason: "insufficient_credit" }));
    try {
      await s.triggerUtilityMessage(BIZ, { eventType: "booking_confirmation", eventReference: "b:bill2", customerId: customer.id, templateVersionId: version.id, variables: { bookingId: "B2" } });
      throw new Error("should have thrown");
    } catch (e: any) {
      expect(e.reason).toBe("insufficient_credit");
    }
    expect(tables.get("messagingMessages")!.length).toBe(0);
    const row = tables.get("businessUtilityEvents")!.find((r) => r.eventReference === "b:bill2")!;
    expect(row.status).toBe("failed");
  });
});

// ---------------------------------------------------------------------------
// 19/20. Audit + reporting foundation
// ---------------------------------------------------------------------------

describe("Reporting foundation: real counts, never fabricated", () => {
  it("distinguishes received/created/failed with a reason breakdown", async () => {
    const s = await svc();
    const { updateCustomer } = await import("../../server/modules/customers/service");
    const okCustomer = await makeCustomer(BIZ, { phone: "9111111111" });
    const blockedCustomer = await makeCustomer(BIZ, { phone: "9222222222" });
    await updateCustomer(BIZ, STAFF, blockedCustomer.id, { status: "blocked" });
    const { version } = await makeApprovedUtilityTemplate();

    await s.triggerUtilityMessage(BIZ, { eventType: "booking_confirmation", eventReference: "r:1", customerId: okCustomer.id, templateVersionId: version.id, variables: { bookingId: "R1" } });
    await expect(s.triggerUtilityMessage(BIZ, { eventType: "booking_confirmation", eventReference: "r:2", customerId: blockedCustomer.id, templateVersionId: version.id, variables: { bookingId: "R2" } })).rejects.toThrow();

    const report = await s.getUtilityReport(BIZ);
    expect(report).toMatchObject({ received: 2, created: 1, failed: 1, failedByReason: { customer_blocked: 1 } });
  });

  it("audit metadata for a created event never includes the rendered message content", async () => {
    const auditModule = await import("../../server/audit");
    const s = await svc();
    const customer = await makeCustomer();
    const { version } = await makeApprovedUtilityTemplate();
    await s.triggerUtilityMessage(BIZ, { eventType: "booking_confirmation", eventReference: "audit:1", customerId: customer.id, templateVersionId: version.id, variables: { bookingId: "AUDIT1" } });
    const calls = (auditModule.createAuditLog as any).mock.calls;
    for (const [params] of calls) {
      expect(JSON.stringify(params)).not.toContain("AUDIT1");
    }
  });
});
