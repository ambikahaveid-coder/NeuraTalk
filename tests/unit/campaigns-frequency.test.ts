import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Marketing frequency/throughput cap tests (Phase 8 hardening).
 * See docs/neura-ecosystem/34_PHASE8_MARKETING_HARDENING_IMPLEMENTATION.md
 * section 3.
 *
 * Tests reserveCustomerFrequencySlot/reserveBusinessThroughputSlot's REAL
 * atomic-CAS arithmetic against a fake DB that genuinely simulates a
 * Postgres unique-constraint violation (code 23505) -- same technique
 * proven in utility.test.ts (Phase 7) -- so the "no app-level-only
 * concurrency claim" requirement is met with an actual simulated DB
 * constraint, not merely an in-process check.
 */

type Row = Record<string, any>;
const tables = new Map<string, Row[]>();
const idCounters = new Map<string, number>();

function resetFakeDb() {
  tables.clear();
  idCounters.clear();
  tables.set("customerMarketingFrequency", []);
  tables.set("businessMarketingThroughput", []);
}

const UNIQUE_KEYS: Record<string, string[]> = {
  customerMarketingFrequency: ["businessId", "customerId", "windowStart"],
  businessMarketingThroughput: ["businessId", "windowStart"],
};

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
  if (cond.__eq) return valuesEqual(row[cond.field], cond.value);
  if (cond.__lt) return row[cond.field] < cond.value;
  throw new Error("Unknown condition: " + JSON.stringify(cond));
}
function findUniqueConflict(tableName: string, data: Row): Row | undefined {
  const keyFields = UNIQUE_KEYS[tableName];
  if (!keyFields) return undefined;
  return (tables.get(tableName) ?? []).find((r) => keyFields.every((f) => valuesEqual(r[f], data[f])));
}

class SelectChain implements PromiseLike<Row[]> {
  private cond: any = null;
  constructor(private tableName: string) {}
  where(cond: any) { this.cond = cond; return this; }
  then<T1, T2>(res?: any, rej?: any) {
    return Promise.resolve((tables.get(this.tableName) ?? []).filter((r) => evalCond(r, this.cond))).then(res, rej);
  }
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
    this.row = { id, ...data };
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

const fakeDb = {
  select(_cols?: any) { return { from: (t: Row) => new SelectChain(tableNameOf(t)) }; },
  insert(t: Row) { return new InsertChain(tableNameOf(t)); },
  update(t: Row) { return new UpdateChain(tableNameOf(t)); },
};

vi.mock("../../server/db", () => ({ db: fakeDb }));

vi.mock("drizzle-orm", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    eq: (column: string, value: unknown) => ({ __eq: true, field: fieldNameOf(column), value }),
    and: (...conds: any[]) => ({ __and: true, conds }),
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
    customerMarketingFrequency: mkTable("customerMarketingFrequency", ["id", "businessId", "customerId", "windowStart", "sentCount", "updatedAt"]),
    businessMarketingThroughput: mkTable("businessMarketingThroughput", ["id", "businessId", "windowStart", "sentCount", "updatedAt"]),
  };
});

beforeEach(() => { resetFakeDb(); vi.clearAllMocks(); });

const WINDOW = new Date("2026-08-24T00:00:00.000Z");

describe("reserveCustomerFrequencySlot", () => {
  it("allows the first send in a new window", async () => {
    const { reserveCustomerFrequencySlot } = await import("../../server/modules/campaigns/frequency");
    const result = await reserveCustomerFrequencySlot(fakeDb as any, 1, 10, WINDOW, 3);
    expect(result.allowed).toBe(true);
    expect(tables.get("customerMarketingFrequency")![0].sentCount).toBe(1);
  });

  it("allows sends up to the cap, then blocks the (cap+1)th", async () => {
    const { reserveCustomerFrequencySlot } = await import("../../server/modules/campaigns/frequency");
    const results = [];
    for (let i = 0; i < 4; i++) results.push(await reserveCustomerFrequencySlot(fakeDb as any, 1, 10, WINDOW, 3));
    expect(results.map((r) => r.allowed)).toEqual([true, true, true, false]);
    expect(tables.get("customerMarketingFrequency")![0].sentCount).toBe(3); // the 4th never incremented
  });

  it("a different customer has an independent budget", async () => {
    const { reserveCustomerFrequencySlot } = await import("../../server/modules/campaigns/frequency");
    await reserveCustomerFrequencySlot(fakeDb as any, 1, 10, WINDOW, 1);
    const other = await reserveCustomerFrequencySlot(fakeDb as any, 1, 20, WINDOW, 1);
    expect(other.allowed).toBe(true);
  });

  it("a different business has an independent budget for the SAME customer id", async () => {
    const { reserveCustomerFrequencySlot } = await import("../../server/modules/campaigns/frequency");
    await reserveCustomerFrequencySlot(fakeDb as any, 1, 10, WINDOW, 1);
    const otherBiz = await reserveCustomerFrequencySlot(fakeDb as any, 2, 10, WINDOW, 1);
    expect(otherBiz.allowed).toBe(true);
  });

  it("a new window resets the budget", async () => {
    const { reserveCustomerFrequencySlot } = await import("../../server/modules/campaigns/frequency");
    await reserveCustomerFrequencySlot(fakeDb as any, 1, 10, WINDOW, 1);
    const blocked = await reserveCustomerFrequencySlot(fakeDb as any, 1, 10, WINDOW, 1);
    expect(blocked.allowed).toBe(false);
    const nextWindow = new Date(WINDOW.getTime() + 24 * 60 * 60 * 1000);
    const afterReset = await reserveCustomerFrequencySlot(fakeDb as any, 1, 10, nextWindow, 1);
    expect(afterReset.allowed).toBe(true);
  });

  it("genuinely concurrent reservations against a cap of 1: exactly one wins", async () => {
    const { reserveCustomerFrequencySlot } = await import("../../server/modules/campaigns/frequency");
    const results = await Promise.allSettled([
      reserveCustomerFrequencySlot(fakeDb as any, 1, 10, WINDOW, 1),
      reserveCustomerFrequencySlot(fakeDb as any, 1, 10, WINDOW, 1),
      reserveCustomerFrequencySlot(fakeDb as any, 1, 10, WINDOW, 1),
    ]);
    const fulfilled = results.filter((r): r is PromiseFulfilledResult<any> => r.status === "fulfilled").map((r) => r.value);
    expect(fulfilled.length).toBe(3); // none reject -- a denied reservation is a normal {allowed:false} result, not a thrown error
    const allowedCount = fulfilled.filter((r) => r.allowed).length;
    expect(allowedCount).toBe(1);
    expect(tables.get("customerMarketingFrequency")![0].sentCount).toBe(1); // never over-incremented
  });
});

describe("reserveBusinessThroughputSlot", () => {
  it("allows sends up to the cap, then blocks", async () => {
    const { reserveBusinessThroughputSlot } = await import("../../server/modules/campaigns/frequency");
    const results = [];
    for (let i = 0; i < 3; i++) results.push(await reserveBusinessThroughputSlot(fakeDb as any, 1, WINDOW, 2));
    expect(results.map((r) => r.allowed)).toEqual([true, true, false]);
  });

  it("a different business has an independent budget", async () => {
    const { reserveBusinessThroughputSlot } = await import("../../server/modules/campaigns/frequency");
    await reserveBusinessThroughputSlot(fakeDb as any, 1, WINDOW, 1);
    const other = await reserveBusinessThroughputSlot(fakeDb as any, 2, WINDOW, 1);
    expect(other.allowed).toBe(true);
  });

  it("genuinely concurrent reservations against a cap of 5: exactly 5 win, never more", async () => {
    const { reserveBusinessThroughputSlot } = await import("../../server/modules/campaigns/frequency");
    const calls = Array.from({ length: 10 }, () => reserveBusinessThroughputSlot(fakeDb as any, 1, WINDOW, 5));
    const results = await Promise.allSettled(calls);
    const fulfilled = results.filter((r): r is PromiseFulfilledResult<any> => r.status === "fulfilled").map((r) => r.value);
    expect(fulfilled.length).toBe(10);
    expect(fulfilled.filter((r) => r.allowed).length).toBe(5);
    expect(tables.get("businessMarketingThroughput")![0].sentCount).toBe(5);
  });
});
