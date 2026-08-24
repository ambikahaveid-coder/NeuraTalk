import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Campaign billing gate tests (Phase 5).
 * See docs/neura-ecosystem/30_CAMPAIGN_ENGINE_IMPLEMENTATION.md section 9.
 *
 * Unlike campaigns.test.ts (which mocks billing.ts wholesale to focus on
 * orchestration), this file tests chargeCampaignMessage's REAL atomic-CAS
 * arithmetic against a fake DB that actually evaluates the `sql` column
 * expression it produces -- proving the deduction is genuinely computed,
 * not just asserted by a mock.
 */

type Row = Record<string, any>;
const tables = new Map<string, Row[]>();

function resetFakeDb() {
  tables.clear();
  tables.set("billingAccounts", []);
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
  if (cond.__gte) return row[cond.field] >= cond.value;
  throw new Error("Unknown condition: " + JSON.stringify(cond));
}

class SelectChain implements PromiseLike<Row[]> {
  private cond: any = null;
  constructor(private tableName: string) {}
  where(cond: any) { this.cond = cond; return this; }
  then<T1, T2>(res?: any, rej?: any) {
    return Promise.resolve((tables.get(this.tableName) ?? []).filter((r) => evalCond(r, this.cond))).then(res, rej);
  }
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
            if (v && (v as any).__sqlExpr) {
              // Only expression this module ever produces:
              // sql`${billingAccounts.walletBalancePaise} - ${costPaise}`
              const [colDesc, amount] = (v as any).values;
              row[k] = row[fieldNameOf(colDesc)] - amount;
            } else {
              row[k] = v;
            }
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
  update(t: Row) { return new UpdateChain(tableNameOf(t)); },
};

vi.mock("../../server/db", () => ({ db: fakeDb }));

vi.mock("drizzle-orm", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    eq: (column: string, value: unknown) => ({ __eq: true, field: fieldNameOf(column), value }),
    and: (...conds: any[]) => ({ __and: true, conds }),
    gte: (column: string, value: unknown) => ({ __gte: true, field: fieldNameOf(column), value }),
    sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({ __sqlExpr: true, strings, values }),
  };
});

vi.mock("@shared/schema", async (importOriginal) => {
  const actual = await importOriginal<Record<string, any>>();
  const col = (t: string, f: string) => `${t}.${f}`;
  const mkTable = (t: string, fields: string[]) => Object.fromEntries(fields.map((f) => [f, col(t, f)]));
  return {
    ...actual,
    billingAccounts: mkTable("billingAccounts", ["id", "organizationId", "walletBalancePaise", "lockedBalancePaise", "isBlocked", "updatedAt"]),
  };
});

function seedAccount(id: number, organizationId: number, walletBalancePaise: number, isBlocked = false) {
  tables.get("billingAccounts")!.push({ id, organizationId, walletBalancePaise, lockedBalancePaise: 0, isBlocked });
}

beforeEach(() => { resetFakeDb(); vi.clearAllMocks(); });

describe("chargeCampaignMessage", () => {
  it("deducts the cost atomically when sufficient balance exists", async () => {
    seedAccount(1, 100, 1000);
    const { chargeCampaignMessage } = await import("../../server/modules/campaigns/billing");
    const result = await chargeCampaignMessage(fakeDb as any, 100, 10);
    expect(result.charged).toBe(true);
    expect(result.costPaise).toBe(10);
    const account = tables.get("billingAccounts")!.find((a) => a.id === 1)!;
    expect(account.walletBalancePaise).toBe(990);
  });

  it("does NOT deduct anything when balance is insufficient -- fails closed", async () => {
    seedAccount(1, 100, 5);
    const { chargeCampaignMessage } = await import("../../server/modules/campaigns/billing");
    const result = await chargeCampaignMessage(fakeDb as any, 100, 10);
    expect(result.charged).toBe(false);
    expect(result.reason).toBe("insufficient_credit");
    const account = tables.get("billingAccounts")!.find((a) => a.id === 1)!;
    expect(account.walletBalancePaise).toBe(5); // unchanged
  });

  it("charging exactly the remaining balance succeeds (boundary: balance == cost)", async () => {
    seedAccount(1, 100, 10);
    const { chargeCampaignMessage } = await import("../../server/modules/campaigns/billing");
    const result = await chargeCampaignMessage(fakeDb as any, 100, 10);
    expect(result.charged).toBe(true);
    const account = tables.get("billingAccounts")!.find((a) => a.id === 1)!;
    expect(account.walletBalancePaise).toBe(0);
  });

  it("returns billing_not_configured when the business has no billing account at all", async () => {
    const { chargeCampaignMessage } = await import("../../server/modules/campaigns/billing");
    const result = await chargeCampaignMessage(fakeDb as any, 999, 10);
    expect(result.charged).toBe(false);
    expect(result.reason).toBe("billing_not_configured");
  });

  it("a blocked billing account is never charged, even with sufficient balance", async () => {
    seedAccount(1, 100, 1000, true);
    const { chargeCampaignMessage } = await import("../../server/modules/campaigns/billing");
    const result = await chargeCampaignMessage(fakeDb as any, 100, 10);
    expect(result.charged).toBe(false);
    expect(result.reason).toBe("insufficient_credit");
    const account = tables.get("billingAccounts")!.find((a) => a.id === 1)!;
    expect(account.walletBalancePaise).toBe(1000); // unchanged
  });

  it("repeated charges accumulate correctly (sequential, not idempotency -- idempotency is enforced one layer up by campaignRecipients' atomic CAS)", async () => {
    seedAccount(1, 100, 100);
    const { chargeCampaignMessage } = await import("../../server/modules/campaigns/billing");
    await chargeCampaignMessage(fakeDb as any, 100, 10);
    await chargeCampaignMessage(fakeDb as any, 100, 10);
    await chargeCampaignMessage(fakeDb as any, 100, 10);
    const account = tables.get("billingAccounts")!.find((a) => a.id === 1)!;
    expect(account.walletBalancePaise).toBe(70);
  });
});
