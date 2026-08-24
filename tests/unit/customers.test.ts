import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Business Customers tests (Phase 4).
 * See docs/neura-ecosystem/29_BUSINESS_CUSTOMERS_AUDIENCES_IMPLEMENTATION.md.
 * In-memory fake DB with real filter/insert/update/delete semantics,
 * matching the pattern established in templates.test.ts / approvals.test.ts,
 * extended here with or()/ilike()/limit()/offset() support.
 */

type Row = Record<string, any>;
const tables = new Map<string, Row[]>();
const idCounters = new Map<string, number>();

function resetFakeDb() {
  tables.clear();
  idCounters.clear();
  for (const t of ["organizations", "users", "customers", "customerConsents"]) {
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
  if (cond.__or) return cond.conds.some((c: any) => evalCond(row, c));
  if (cond.__eq) return row[cond.field] === cond.value;
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
};

const auditCalls: Array<{ actorUserId: number; businessId: number; action: string; customerId: number; metadata: any }> = [];

vi.mock("../../server/db", () => ({ db: fakeDb }));
vi.mock("../../server/observability", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock("../../server/modules/customers/audit", () => ({
  createAuditLog: vi.fn(async (actorUserId: number, businessId: number, action: string, customerId: number, metadata: any) => {
    auditCalls.push({ actorUserId, businessId, action, customerId, metadata });
  }),
  AUDIT_ACTION_CUSTOMER: { CREATED: "create", UPDATED: "update", ARCHIVED: "archive", CONSENT_CHANGED: "consent_action" },
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
    customerConsents: mkTable("customerConsents", [
      "id", "businessId", "customerId", "channel", "status", "source", "updatedBy", "createdAt", "updatedAt",
    ]),
  };
});

beforeEach(() => { resetFakeDb(); auditCalls.length = 0; vi.clearAllMocks(); });

async function svc() { return import("../../server/modules/customers/service"); }

describe("1. Customer creation", () => {
  it("creates a customer with name+phone+email", async () => {
    const s = await svc();
    const c = await s.createCustomer(1, 10, { name: "Kiran", phone: "9876543210", email: "K@Example.com" });
    expect(c.id).toBeDefined();
    expect(c.businessId).toBe(1);
    expect(c.status).toBe("active");
    expect(c.source).toBe("manual");
  });

  it("rejects a customer with no name/phone/email at all", async () => {
    const s = await svc();
    await expect(s.createCustomer(1, 10, {})).rejects.toThrow(s.ValidationError);
  });

  it("rejects creation for a nonexistent business", async () => {
    const s = await svc();
    await expect(s.createCustomer(999, 10, { name: "X" })).rejects.toThrow(s.NotFoundError);
  });

  it("writes an audit log entry on create", async () => {
    const s = await svc();
    const c = await s.createCustomer(1, 10, { name: "Kiran" });
    const entry = auditCalls.find((a) => a.action === "create" && a.customerId === c.id);
    expect(entry).toBeDefined();
  });
});

describe("2. Customer listing", () => {
  it("lists only the requesting business's customers", async () => {
    const s = await svc();
    await s.createCustomer(1, 10, { name: "A" });
    await s.createCustomer(2, 10, { name: "B" });
    const list = await s.listCustomers(1);
    expect(list.length).toBe(1);
    expect(list[0].name).toBe("A");
  });

  it("supports search by name/phone/email substring", async () => {
    const s = await svc();
    await s.createCustomer(1, 10, { name: "Kiran Kumar", phone: "9876543210" });
    await s.createCustomer(1, 10, { name: "Someone Else", phone: "9123456780" });
    const bySearch = await s.listCustomers(1, { search: "kiran" });
    expect(bySearch.length).toBe(1);
    expect(bySearch[0].name).toBe("Kiran Kumar");
  });

  it("supports status filter", async () => {
    const s = await svc();
    const c = await s.createCustomer(1, 10, { name: "A" });
    await s.archiveCustomer(1, 10, c.id);
    await s.createCustomer(1, 10, { name: "B" });
    const active = await s.listCustomers(1, { status: "active" });
    expect(active.length).toBe(1);
    expect(active[0].name).toBe("B");
  });
});

describe("3. Customer retrieval", () => {
  it("gets a customer by id within its business", async () => {
    const s = await svc();
    const c = await s.createCustomer(1, 10, { name: "A" });
    const got = await s.getCustomer(1, c.id);
    expect(got?.name).toBe("A");
  });

  it("returns null for a nonexistent customer id", async () => {
    const s = await svc();
    const got = await s.getCustomer(1, 9999);
    expect(got).toBeNull();
  });
});

describe("4. Customer update", () => {
  it("updates name/notes", async () => {
    const s = await svc();
    const c = await s.createCustomer(1, 10, { name: "A" });
    const updated = await s.updateCustomer(1, 10, c.id, { name: "A2", notes: "vip" });
    expect(updated.name).toBe("A2");
    expect(updated.notes).toBe("vip");
  });

  it("can transition status ACTIVE <-> BLOCKED via update", async () => {
    const s = await svc();
    const c = await s.createCustomer(1, 10, { name: "A" });
    const blocked = await s.updateCustomer(1, 10, c.id, { status: "blocked" });
    expect(blocked.status).toBe("blocked");
  });

  it("rejects setting status=archived via update (must use archive action)", async () => {
    const s = await svc();
    const c = await s.createCustomer(1, 10, { name: "A" });
    await expect(s.updateCustomer(1, 10, c.id, { status: "archived" })).rejects.toThrow(s.ValidationError);
  });
});

describe("5. Customer archive", () => {
  it("archives an active customer", async () => {
    const s = await svc();
    const c = await s.createCustomer(1, 10, { name: "A" });
    const archived = await s.archiveCustomer(1, 10, c.id);
    expect(archived.status).toBe("archived");
    expect(archived.archivedBy).toBe(10);
  });

  it("rejects archiving an already-archived customer", async () => {
    const s = await svc();
    const c = await s.createCustomer(1, 10, { name: "A" });
    await s.archiveCustomer(1, 10, c.id);
    await expect(s.archiveCustomer(1, 10, c.id)).rejects.toThrow(s.ValidationError);
  });
});

describe("14. Duplicate customer detection", () => {
  it("rejects creating a second customer with the same normalized phone in the same business", async () => {
    const s = await svc();
    await s.createCustomer(1, 10, { name: "A", phone: "9876543210" });
    await expect(s.createCustomer(1, 10, { name: "B", phone: "+919876543210" })).rejects.toThrow(s.DuplicateCustomerError);
  });

  it("rejects creating a second customer with the same normalized email in the same business", async () => {
    const s = await svc();
    await s.createCustomer(1, 10, { name: "A", email: "a@b.com" });
    await expect(s.createCustomer(1, 10, { name: "B", email: "A@B.COM" })).rejects.toThrow(s.DuplicateCustomerError);
  });

  it("does NOT silently merge -- the duplicate error carries the existing customer's id, no write happens", async () => {
    const s = await svc();
    const first = await s.createCustomer(1, 10, { name: "A", phone: "9876543210" });
    try {
      await s.createCustomer(1, 10, { name: "B", phone: "9876543210" });
      throw new Error("should have thrown");
    } catch (e: any) {
      expect(e.existingCustomerId).toBe(first.id);
    }
    const list = await s.listCustomers(1);
    expect(list.length).toBe(1); // no second row was created
  });

  it("allows the SAME phone for customers of DIFFERENT businesses (dedup is business-scoped, not global)", async () => {
    const s = await svc();
    const a = await s.createCustomer(1, 10, { name: "A", phone: "9876543210" });
    const b = await s.createCustomer(2, 10, { name: "B", phone: "9876543210" });
    expect(a.id).not.toBe(b.id);
  });
});

describe("15. Phone normalization", () => {
  it("normalizes a bare 10-digit Indian number to E.164", async () => {
    const s = await svc();
    const c = await s.createCustomer(1, 10, { name: "A", phone: "9876543210" });
    expect(c.normalizedPhone).toBe("+919876543210");
  });

  it("treats +91-prefixed and bare forms of the same number as the same customer", async () => {
    const s = await svc();
    await s.createCustomer(1, 10, { name: "A", phone: "9876543210" });
    await expect(s.createCustomer(1, 10, { name: "B", phone: "+91 98765 43210" })).rejects.toThrow(s.DuplicateCustomerError);
  });
});

describe("16. Email normalization", () => {
  it("lowercases and trims email for the stored normalizedEmail field", async () => {
    const s = await svc();
    const c = await s.createCustomer(1, 10, { name: "A", email: "  Kiran@Example.com  " });
    expect(c.normalizedEmail).toBe("kiran@example.com");
  });
});

describe("17. External reference uniqueness", () => {
  it("rejects a duplicate externalRef within the same business", async () => {
    const s = await svc();
    await s.createCustomer(1, 10, { name: "A", externalRef: "CRM-1" });
    await expect(s.createCustomer(1, 10, { name: "B", externalRef: "CRM-1" })).rejects.toThrow(s.DuplicateCustomerError);
  });

  it("allows the same externalRef across different businesses", async () => {
    const s = await svc();
    const a = await s.createCustomer(1, 10, { name: "A", externalRef: "CRM-1" });
    const b = await s.createCustomer(2, 10, { name: "B", externalRef: "CRM-1" });
    expect(a.id).not.toBe(b.id);
  });

  it("update() also rejects introducing a duplicate externalRef", async () => {
    const s = await svc();
    await s.createCustomer(1, 10, { name: "A", externalRef: "CRM-1" });
    const c2 = await s.createCustomer(1, 10, { name: "B", externalRef: "CRM-2" });
    await expect(s.updateCustomer(1, 10, c2.id, { externalRef: "CRM-1" })).rejects.toThrow(s.DuplicateCustomerError);
  });
});

describe("18/19. Tenant isolation + URL ID manipulation", () => {
  it("getCustomer scoped to businessId returns null for a customer belonging to a different business", async () => {
    const s = await svc();
    const c = await s.createCustomer(2, 10, { name: "B-secret" });
    const attempted = await s.getCustomer(1, c.id);
    expect(attempted).toBeNull();
  });

  it("updateCustomer for a cross-business id throws NotFoundError, not a silent no-op success", async () => {
    const s = await svc();
    const c = await s.createCustomer(2, 10, { name: "B-secret" });
    await expect(s.updateCustomer(1, 10, c.id, { name: "hacked" })).rejects.toThrow(s.NotFoundError);
  });

  it("archiveCustomer for a cross-business id throws NotFoundError", async () => {
    const s = await svc();
    const c = await s.createCustomer(2, 10, { name: "B-secret" });
    await expect(s.archiveCustomer(1, 10, c.id)).rejects.toThrow(s.NotFoundError);
  });

  it("listCustomers for business 1 never includes business 2's rows, even by id guessing", async () => {
    const s = await svc();
    await s.createCustomer(2, 10, { name: "B-secret" });
    const list = await s.listCustomers(1);
    expect(list.find((c: any) => c.name === "B-secret")).toBeUndefined();
  });
});

describe("24. Archived customer behavior", () => {
  it("cannot edit an archived customer", async () => {
    const s = await svc();
    const c = await s.createCustomer(1, 10, { name: "A" });
    await s.archiveCustomer(1, 10, c.id);
    await expect(s.updateCustomer(1, 10, c.id, { name: "A2" })).rejects.toThrow(s.ValidationError);
  });

  it("archived customer is still individually retrievable (not hard-deleted)", async () => {
    const s = await svc();
    const c = await s.createCustomer(1, 10, { name: "A" });
    await s.archiveCustomer(1, 10, c.id);
    const got = await s.getCustomer(1, c.id);
    expect(got?.status).toBe("archived");
  });
});

describe("30. Communication eligibility -- separate from customer existence/status", () => {
  it("a freshly-created customer is NOT eligible for marketing until an explicit grant exists", async () => {
    const s = await svc();
    const c = await s.createCustomer(1, 10, { name: "A" });
    const eligible = await s.isEligibleForChannel(1, c.id, "marketing");
    expect(eligible).toBe(false);
  });

  it("explicit grant makes the customer eligible; explicit revoke makes them ineligible again", async () => {
    const s = await svc();
    const c = await s.createCustomer(1, 10, { name: "A" });
    await s.setChannelConsent(1, 10, c.id, "marketing", true, "business_admin");
    expect(await s.isEligibleForChannel(1, c.id, "marketing")).toBe(true);

    await s.setChannelConsent(1, 10, c.id, "marketing", false, "customer_reply_stop");
    expect(await s.isEligibleForChannel(1, c.id, "marketing")).toBe(false);
  });

  it("consent is per-channel -- granting marketing does not grant utility", async () => {
    const s = await svc();
    const c = await s.createCustomer(1, 10, { name: "A" });
    await s.setChannelConsent(1, 10, c.id, "marketing", true);
    expect(await s.isEligibleForChannel(1, c.id, "utility")).toBe(false);
  });

  it("rejects an invalid channel", async () => {
    const s = await svc();
    const c = await s.createCustomer(1, 10, { name: "A" });
    await expect(s.setChannelConsent(1, 10, c.id, "spam" as any, true)).rejects.toThrow(s.ValidationError);
  });
});

describe("Phase 8: consent write path -- getCustomerConsents (inspect current state)", () => {
  it("a customer with no consent action at all has an empty consent list -- never a fabricated row", async () => {
    const s = await svc();
    const c = await s.createCustomer(1, 10, { name: "A" });
    const consents = await s.getCustomerConsents(1, c.id);
    expect(consents).toEqual([]);
  });

  it("grant reflects GRANTED with actor and timestamp; a later revoke updates the SAME row to REVOKED with a new actor/timestamp", async () => {
    const s = await svc();
    const c = await s.createCustomer(1, 10, { name: "A" });
    await s.setChannelConsent(1, 10, c.id, "marketing", true, "business_admin");
    const [granted] = await s.getCustomerConsents(1, c.id);
    expect(granted.status).toBe("granted");
    expect(granted.updatedBy).toBe(10);
    expect(granted.source).toBe("business_admin");
    expect(granted.createdAt).toBeTruthy();

    await s.setChannelConsent(1, 20, c.id, "marketing", false, "customer_reply_stop");
    const consentsAfter = await s.getCustomerConsents(1, c.id);
    expect(consentsAfter.length).toBe(1); // same row updated in place, not a second history row
    expect(consentsAfter[0].status).toBe("revoked");
    expect(consentsAfter[0].updatedBy).toBe(20); // the revoking actor, not the original granter
    expect(consentsAfter[0].source).toBe("customer_reply_stop");
  });

  it("Business A cannot read or modify Business B's customer consent (tenant isolation, cross-business consent)", async () => {
    const s = await svc();
    const customerB = await s.createCustomer(2, 10, { name: "B-customer" });
    await expect(s.getCustomerConsents(1, customerB.id)).rejects.toThrow(s.NotFoundError);
    await expect(s.setChannelConsent(1, 10, customerB.id, "marketing", true)).rejects.toThrow(s.NotFoundError);
  });

  it("consent for a customer in Business A never affects the SAME customerId value in a different business record (distinct customer rows entirely)", async () => {
    const s = await svc();
    const customerA = await s.createCustomer(1, 10, { name: "A" });
    const customerB = await s.createCustomer(2, 10, { name: "B" });
    await s.setChannelConsent(1, 10, customerA.id, "marketing", true);
    expect(await s.isEligibleForChannel(1, customerA.id, "marketing")).toBe(true);
    expect(await s.isEligibleForChannel(2, customerB.id, "marketing")).toBe(false);
  });

  it("customer existence alone is never treated as consent -- eligibility is false immediately after creation, before any consent action", async () => {
    const s = await svc();
    const c = await s.createCustomer(1, 10, { name: "Brand New" });
    expect(await s.isEligibleForChannel(1, c.id, "marketing")).toBe(false);
    expect(await s.getCustomerConsents(1, c.id)).toEqual([]);
  });
});
