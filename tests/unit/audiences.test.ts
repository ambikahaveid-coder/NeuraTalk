import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Business Audiences tests (Phase 4).
 * See docs/neura-ecosystem/29_BUSINESS_CUSTOMERS_AUDIENCES_IMPLEMENTATION.md.
 * Full integration: uses the REAL customers service AND the REAL audiences
 * service against one shared in-memory fake DB, matching the pattern
 * established in approvals.test.ts (proves actual cross-module wiring, not
 * just each module mocked in isolation).
 */

type Row = Record<string, any>;
const tables = new Map<string, Row[]>();
const idCounters = new Map<string, number>();

function resetFakeDb() {
  tables.clear();
  idCounters.clear();
  for (const t of ["organizations", "users", "customers", "customerConsents", "audiences", "audienceMembers"]) {
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

const audienceAuditCalls: Array<{ actorUserId: number; businessId: number; action: string; audienceId: number; metadata: any }> = [];
const customerAuditCalls: Array<{ action: string; customerId: number }> = [];

vi.mock("../../server/db", () => ({ db: fakeDb }));
vi.mock("../../server/observability", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock("../../server/modules/audiences/audit", () => ({
  createAuditLog: vi.fn(async (actorUserId: number, businessId: number, action: string, audienceId: number, metadata: any) => {
    audienceAuditCalls.push({ actorUserId, businessId, action, audienceId, metadata });
  }),
  AUDIT_ACTION_AUDIENCE: { CREATED: "create", UPDATED: "update", ARCHIVED: "archive", MEMBER_ADDED: "member_added", MEMBER_REMOVED: "member_removed" },
}));
vi.mock("../../server/modules/customers/audit", () => ({
  createAuditLog: vi.fn(async (actorUserId: number, businessId: number, action: string, customerId: number, metadata: any) => {
    customerAuditCalls.push({ action, customerId });
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
    customerConsents: mkTable("customerConsents", ["id", "businessId", "customerId", "channel", "status", "source", "updatedBy", "createdAt", "updatedAt"]),
    audiences: mkTable("audiences", ["id", "businessId", "name", "description", "type", "status", "createdBy", "createdAt", "updatedAt", "archivedBy", "archivedAt"]),
    audienceMembers: mkTable("audienceMembers", ["id", "audienceId", "customerId", "addedBy", "addedAt"]),
  };
});

beforeEach(() => { resetFakeDb(); audienceAuditCalls.length = 0; customerAuditCalls.length = 0; vi.clearAllMocks(); });

async function customersSvc() { return import("../../server/modules/customers/service"); }
async function audiencesSvc() { return import("../../server/modules/audiences/service"); }

describe("6. Audience creation", () => {
  it("creates a static audience", async () => {
    const s = await audiencesSvc();
    const a = await s.createAudience(1, 10, { name: "VIP" });
    expect(a.id).toBeDefined();
    expect(a.type).toBe("static");
    expect(a.status).toBe("active");
  });

  it("rejects a duplicate audience name within the same business", async () => {
    const s = await audiencesSvc();
    await s.createAudience(1, 10, { name: "VIP" });
    await expect(s.createAudience(1, 10, { name: "VIP" })).rejects.toThrow(s.ValidationError);
  });

  it("allows the same audience name across different businesses", async () => {
    const s = await audiencesSvc();
    const a = await s.createAudience(1, 10, { name: "VIP" });
    const b = await s.createAudience(2, 10, { name: "VIP" });
    expect(a.id).not.toBe(b.id);
  });

  it("rejects type=dynamic -- documented extension point, not implemented (does not fake it as static)", async () => {
    const s = await audiencesSvc();
    await expect(s.createAudience(1, 10, { name: "Dyn", type: "dynamic" })).rejects.toThrow(s.ValidationError);
  });

  it("writes an audit log entry on create", async () => {
    const s = await audiencesSvc();
    const a = await s.createAudience(1, 10, { name: "VIP" });
    expect(audienceAuditCalls.find((c) => c.action === "create" && c.audienceId === a.id)).toBeDefined();
  });
});

describe("7. Audience listing", () => {
  it("lists only the requesting business's audiences, with memberCount", async () => {
    const s = await audiencesSvc();
    const c = await customersSvc();
    const audience = await s.createAudience(1, 10, { name: "VIP" });
    const customer = await c.createCustomer(1, 10, { name: "Kiran" });
    await s.addMember(1, 10, audience.id, customer.id);
    await s.createAudience(2, 10, { name: "Other biz" });

    const list = await s.listAudiences(1);
    expect(list.length).toBe(1);
    expect(list[0].name).toBe("VIP");
    expect(list[0].memberCount).toBe(1);
  });

  it("supports status filter", async () => {
    const s = await audiencesSvc();
    const a = await s.createAudience(1, 10, { name: "A" });
    await s.archiveAudience(1, 10, a.id);
    await s.createAudience(1, 10, { name: "B" });
    const active = await s.listAudiences(1, "active");
    expect(active.length).toBe(1);
    expect(active[0].name).toBe("B");
  });
});

describe("8. Audience retrieval", () => {
  it("gets an audience with its members list", async () => {
    const s = await audiencesSvc();
    const c = await customersSvc();
    const audience = await s.createAudience(1, 10, { name: "VIP" });
    const customer = await c.createCustomer(1, 10, { name: "Kiran" });
    await s.addMember(1, 10, audience.id, customer.id);

    const got = await s.getAudience(1, audience.id);
    expect(got?.members.length).toBe(1);
    expect(got?.members[0].customerId).toBe(customer.id);
  });

  it("returns null for a nonexistent audience", async () => {
    const s = await audiencesSvc();
    expect(await s.getAudience(1, 9999)).toBeNull();
  });
});

describe("9. Audience update", () => {
  it("renames an audience", async () => {
    const s = await audiencesSvc();
    const a = await s.createAudience(1, 10, { name: "VIP" });
    const updated = await s.updateAudience(1, 10, a.id, { name: "VIP-Renamed" });
    expect(updated.name).toBe("VIP-Renamed");
  });

  it("rejects renaming to a name already used by another audience in the same business", async () => {
    const s = await audiencesSvc();
    await s.createAudience(1, 10, { name: "Taken" });
    const b = await s.createAudience(1, 10, { name: "B" });
    await expect(s.updateAudience(1, 10, b.id, { name: "Taken" })).rejects.toThrow(s.ValidationError);
  });

  it("cannot edit an archived audience", async () => {
    const s = await audiencesSvc();
    const a = await s.createAudience(1, 10, { name: "A" });
    await s.archiveAudience(1, 10, a.id);
    await expect(s.updateAudience(1, 10, a.id, { name: "A2" })).rejects.toThrow(s.ValidationError);
  });
});

describe("10. Audience archive", () => {
  it("archives an active audience", async () => {
    const s = await audiencesSvc();
    const a = await s.createAudience(1, 10, { name: "A" });
    const archived = await s.archiveAudience(1, 10, a.id);
    expect(archived.status).toBe("archived");
  });

  it("rejects archiving an already-archived audience", async () => {
    const s = await audiencesSvc();
    const a = await s.createAudience(1, 10, { name: "A" });
    await s.archiveAudience(1, 10, a.id);
    await expect(s.archiveAudience(1, 10, a.id)).rejects.toThrow(s.ValidationError);
  });
});

describe("11. Add audience member", () => {
  it("adds a customer to an audience", async () => {
    const s = await audiencesSvc();
    const c = await customersSvc();
    const a = await s.createAudience(1, 10, { name: "VIP" });
    const customer = await c.createCustomer(1, 10, { name: "Kiran" });
    const member = await s.addMember(1, 10, a.id, customer.id);
    expect(member.audienceId).toBe(a.id);
    expect(member.customerId).toBe(customer.id);
  });

  it("rejects adding the same customer twice (uniqueness)", async () => {
    const s = await audiencesSvc();
    const c = await customersSvc();
    const a = await s.createAudience(1, 10, { name: "VIP" });
    const customer = await c.createCustomer(1, 10, { name: "Kiran" });
    await s.addMember(1, 10, a.id, customer.id);
    await expect(s.addMember(1, 10, a.id, customer.id)).rejects.toThrow(s.ValidationError);
  });

  it("rejects adding a customer belonging to a DIFFERENT business (tenant isolation, cross-business membership)", async () => {
    const s = await audiencesSvc();
    const c = await customersSvc();
    const a = await s.createAudience(1, 10, { name: "VIP" });
    const otherBizCustomer = await c.createCustomer(2, 10, { name: "Other" });
    await expect(s.addMember(1, 10, a.id, otherBizCustomer.id)).rejects.toThrow(s.NotFoundError);
  });

  it("rejects adding an archived customer", async () => {
    const s = await audiencesSvc();
    const c = await customersSvc();
    const a = await s.createAudience(1, 10, { name: "VIP" });
    const customer = await c.createCustomer(1, 10, { name: "Kiran" });
    await c.archiveCustomer(1, 10, customer.id);
    await expect(s.addMember(1, 10, a.id, customer.id)).rejects.toThrow(s.ValidationError);
  });

  it("rejects adding a member to an archived audience", async () => {
    const s = await audiencesSvc();
    const c = await customersSvc();
    const a = await s.createAudience(1, 10, { name: "VIP" });
    await s.archiveAudience(1, 10, a.id);
    const customer = await c.createCustomer(1, 10, { name: "Kiran" });
    await expect(s.addMember(1, 10, a.id, customer.id)).rejects.toThrow(s.ValidationError);
  });
});

describe("12. Remove audience member", () => {
  it("removes a customer from an audience", async () => {
    const s = await audiencesSvc();
    const c = await customersSvc();
    const a = await s.createAudience(1, 10, { name: "VIP" });
    const customer = await c.createCustomer(1, 10, { name: "Kiran" });
    await s.addMember(1, 10, a.id, customer.id);
    await s.removeMember(1, 10, a.id, customer.id);
    const members = await s.listMembers(1, a.id);
    expect(members.length).toBe(0);
  });

  it("rejects removing a customer who isn't a member", async () => {
    const s = await audiencesSvc();
    const c = await customersSvc();
    const a = await s.createAudience(1, 10, { name: "VIP" });
    const customer = await c.createCustomer(1, 10, { name: "Kiran" });
    await expect(s.removeMember(1, 10, a.id, customer.id)).rejects.toThrow(s.NotFoundError);
  });
});

describe("13. Multiple audiences per customer", () => {
  it("a customer can belong to more than one audience simultaneously", async () => {
    const s = await audiencesSvc();
    const c = await customersSvc();
    const customer = await c.createCustomer(1, 10, { name: "Kiran" });
    const vip = await s.createAudience(1, 10, { name: "VIP" });
    const hyd = await s.createAudience(1, 10, { name: "Hyderabad" });

    await s.addMember(1, 10, vip.id, customer.id);
    await s.addMember(1, 10, hyd.id, customer.id);

    const vipMembers = await s.listMembers(1, vip.id);
    const hydMembers = await s.listMembers(1, hyd.id);
    expect(vipMembers.map((m: any) => m.customerId)).toContain(customer.id);
    expect(hydMembers.map((m: any) => m.customerId)).toContain(customer.id);
  });
});

describe("18/19. Tenant isolation + URL ID manipulation (audiences)", () => {
  it("getAudience scoped to businessId returns null for another business's audience", async () => {
    const s = await audiencesSvc();
    const a = await s.createAudience(2, 10, { name: "Secret" });
    expect(await s.getAudience(1, a.id)).toBeNull();
  });

  it("updateAudience for a cross-business id throws NotFoundError", async () => {
    const s = await audiencesSvc();
    const a = await s.createAudience(2, 10, { name: "Secret" });
    await expect(s.updateAudience(1, 10, a.id, { name: "hacked" })).rejects.toThrow(s.NotFoundError);
  });

  it("archiveAudience for a cross-business id throws NotFoundError", async () => {
    const s = await audiencesSvc();
    const a = await s.createAudience(2, 10, { name: "Secret" });
    await expect(s.archiveAudience(1, 10, a.id)).rejects.toThrow(s.NotFoundError);
  });

  it("addMember for a cross-business audience id throws NotFoundError (audience-id URL manipulation)", async () => {
    const s = await audiencesSvc();
    const c = await customersSvc();
    const a = await s.createAudience(2, 10, { name: "Secret" });
    const customer = await c.createCustomer(1, 10, { name: "Kiran" });
    await expect(s.addMember(1, 10, a.id, customer.id)).rejects.toThrow(s.NotFoundError);
  });
});

describe("25. Archived audience behavior", () => {
  it("archived audience is still individually retrievable with its members intact", async () => {
    const s = await audiencesSvc();
    const c = await customersSvc();
    const a = await s.createAudience(1, 10, { name: "VIP" });
    const customer = await c.createCustomer(1, 10, { name: "Kiran" });
    await s.addMember(1, 10, a.id, customer.id);
    await s.archiveAudience(1, 10, a.id);

    const got = await s.getAudience(1, a.id);
    expect(got?.status).toBe("archived");
    expect(got?.members.length).toBe(1);
  });

  it("removeMember is still allowed on an archived audience (cleanup shouldn't be blocked)", async () => {
    const s = await audiencesSvc();
    const c = await customersSvc();
    const a = await s.createAudience(1, 10, { name: "VIP" });
    const customer = await c.createCustomer(1, 10, { name: "Kiran" });
    await s.addMember(1, 10, a.id, customer.id);
    await s.archiveAudience(1, 10, a.id);
    await expect(s.removeMember(1, 10, a.id, customer.id)).resolves.not.toThrow();
  });
});
