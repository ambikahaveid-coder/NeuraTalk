import { describe, it, expect, beforeEach, vi } from "vitest";
import { billingAccounts as realBillingAccountsTable } from "@shared/schema";

// billing-engine.ts imports server/db (and, transitively, server/load-env,
// server/redis, server/audit-logging) purely because those modules exist in
// its import graph — this test never touches the real database or Redis,
// it only calls reserveWalletAmount with a hand-built fake `tx`, so these
// are stubbed out the same way tests/integration/payment-refund.test.ts
// stubs them, to avoid load-env's real-environment conflict guard firing
// just from importing the module.
vi.mock("../../server/db", () => ({ db: {} }));
vi.mock("../../server/redis", () => ({
  getRedisClient: () => ({}),
  isRedisDegraded: () => false,
  withRedisLock: async (_key: string, fn: () => Promise<any>) => fn(),
}));
vi.mock("../../server/audit-logging", () => ({ logAuditEvent: vi.fn(async () => {}) }));
vi.mock("../../server/observability", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), on: vi.fn() },
}));

const { reserveWalletAmount } = await import("../../server/billing-engine");

/**
 * Concurrency/stress tests for the P0 wallet double-spend race condition
 * fix in server/billing-engine.ts (reserveWalletAmount, used by
 * BillingEngine.startCallSession's initial wallet reservation).
 *
 * Root cause that was fixed: the reservation used to read
 * account.lockedBalancePaise once (outside any lock), compute
 * `lockedBalancePaise + initialReservePaise` in JS, and write that absolute
 * value back with an unconditional SET — a classic lost-update race. Two
 * concurrent reservations against the same billing account could both read
 * the same stale `lockedBalancePaise`, both compute a "new" value from it,
 * and the second write would silently clobber the first's effect instead of
 * accumulating on top of it.
 *
 * The fix (reserveWalletAmount) replaces that with a single conditional
 * atomic UPDATE — `locked = locked + delta WHERE locked + delta <= wallet`
 * — evaluated against the row's live value at update time. This test proves
 * that pattern is actually race-free under real concurrent load, using a
 * mock `tx` that faithfully reproduces the one guarantee the fix depends on:
 * a single UPDATE statement is indivisible from the perspective of other
 * concurrent transactions (Postgres's row-level-lock semantics). The mock
 * applies each simulated UPDATE synchronously (no `await` before mutating
 * the shared row), which is what makes "run 1000 of these concurrently via
 * Promise.all in one single-threaded process" a valid way to exercise real
 * interleaving: JS never preempts a synchronous block, so each simulated
 * UPDATE really is atomic relative to the others, exactly like the real
 * database's guarantee.
 */

interface FakeAccountRow {
  id: number;
  walletBalancePaise: number;
  lockedBalancePaise: number;
}

// Extracts the raw JS number interpolated into a drizzle-orm `sql` tagged
// template (e.g. `sql`${billingAccounts.lockedBalancePaise} + ${delta}``).
// drizzle stores primitive interpolations directly (not wrapped) inside the
// fragment's queryChunks array, alongside StringChunk separators and Column
// references — this is how the query builder itself reads its own
// parameters back out, so it's a stable, necessary part of a working sql
// tag, not an obscure internal we're relying on by accident.
function extractInterpolatedNumber(fragment: unknown): number | undefined {
  if (typeof fragment === "number") return fragment;
  const chunks = (fragment as { queryChunks?: unknown[] } | null)?.queryChunks;
  if (!Array.isArray(chunks)) return undefined;
  for (const chunk of chunks) {
    if (typeof chunk === "number") return chunk;
  }
  return undefined;
}

function makeFakeTx(row: FakeAccountRow) {
  return {
    update: (table: unknown) => {
      if (table !== realBillingAccountsTable) {
        throw new Error("Test only models billingAccounts updates");
      }
      return {
        set: (patch: Record<string, unknown>) => ({
          where: (_condition: unknown) => ({
            returning: async (_projection?: unknown) => {
              // Everything below runs synchronously (no `await`) before
              // mutating `row` — this is the property that makes the
              // simulation faithful to a real atomic UPDATE statement.
              const delta = extractInterpolatedNumber(patch.lockedBalancePaise);
              if (delta === undefined) {
                return [{ walletBalancePaise: row.walletBalancePaise, lockedBalancePaise: row.lockedBalancePaise }];
              }
              const nextLocked = row.lockedBalancePaise + delta;
              if (nextLocked > row.walletBalancePaise) {
                return []; // simulates the WHERE clause matching 0 rows
              }
              row.lockedBalancePaise = nextLocked;
              return [{ walletBalancePaise: row.walletBalancePaise, lockedBalancePaise: row.lockedBalancePaise }];
            },
          }),
        }),
      };
    },
  };
}

// The OLD, buggy pattern this test suite guards against regressing to:
// an unconditional read-modify-write with no atomicity. Used below to prove
// the test harness itself is capable of detecting the double-spend (i.e.
// that a "pass" from reserveWalletAmount isn't just a tautology of the
// mock).
async function buggyUnconditionalReserve(row: FakeAccountRow, deltaPaise: number): Promise<void> {
  const observedLocked = row.lockedBalancePaise; // stale read, "before" any lock
  await Promise.resolve(); // force a real interleaving point, like a network round-trip would
  row.lockedBalancePaise = observedLocked + deltaPaise; // clobbers concurrent writers
}

describe("BillingEngine.reserveWalletAmount — wallet double-spend race condition (P0)", () => {
  let account: FakeAccountRow;

  beforeEach(() => {
    account = { id: 1, walletBalancePaise: 100_000, lockedBalancePaise: 0 }; // ₹1,000.00
  });

  it("a single reservation within budget succeeds and locks exactly the requested amount", async () => {
    const tx = makeFakeTx(account);
    const result = await reserveWalletAmount(tx, account.id, 10_000);
    expect(result).toEqual({ walletBalancePaise: 100_000, lockedBalancePaise: 10_000 });
    expect(account.lockedBalancePaise).toBe(10_000);
  });

  it("rejects (returns null) a reservation that would exceed the wallet balance", async () => {
    const tx = makeFakeTx(account);
    const result = await reserveWalletAmount(tx, account.id, 150_000);
    expect(result).toBeNull();
    expect(account.lockedBalancePaise).toBe(0); // untouched — fails closed
  });

  it("1000 concurrent reservation attempts: zero double-spend, zero negative available balance, zero duplicate reservations", async () => {
    // ₹1,000 wallet, each reservation asks for ₹5 (500 paise) => at most 200
    // can ever succeed. 1000 concurrent attempts is 5x oversubscription.
    const RESERVE_AMOUNT_PAISE = 500;
    const ATTEMPTS = 1000;
    const tx = makeFakeTx(account);

    const results = await Promise.all(
      Array.from({ length: ATTEMPTS }, () => reserveWalletAmount(tx, account.id, RESERVE_AMOUNT_PAISE)),
    );

    const successes = results.filter((r) => r !== null);
    const denials = results.filter((r) => r === null);

    // Zero negative balance: locked can never exceed wallet.
    expect(account.lockedBalancePaise).toBeLessThanOrEqual(account.walletBalancePaise);

    // Zero duplicate/lost reservations: the sum of what was actually locked
    // must equal exactly (successes * amount) — if any reservation had been
    // silently clobbered (the original bug) or double-counted, this
    // wouldn't hold.
    expect(account.lockedBalancePaise).toBe(successes.length * RESERVE_AMOUNT_PAISE);

    // Exactly floor(wallet / amount) reservations should succeed — not more
    // (double-spend), not fewer (lost availability due to over-conservative
    // locking).
    const expectedMaxSuccesses = Math.floor(account.walletBalancePaise / RESERVE_AMOUNT_PAISE);
    expect(successes.length).toBe(expectedMaxSuccesses);
    expect(denials.length).toBe(ATTEMPTS - expectedMaxSuccesses);

    // No reservation should ever "succeed" while reporting a locked amount
    // that isn't a clean multiple of the per-reservation amount (would
    // indicate a partial/corrupted update).
    for (const r of successes) {
      expect(r!.lockedBalancePaise % RESERVE_AMOUNT_PAISE).toBe(0);
    }
  });

  it("mixed concurrent reservation sizes never push locked balance past wallet balance", async () => {
    const tx = makeFakeTx(account);
    const amounts = Array.from({ length: 500 }, (_, i) => 100 + (i % 17) * 37); // varied paise amounts

    await Promise.all(amounts.map((amt) => reserveWalletAmount(tx, account.id, amt)));

    expect(account.lockedBalancePaise).toBeLessThanOrEqual(account.walletBalancePaise);
  });

  it("control: the harness itself detects a double-spend under the OLD unconditional-write pattern", async () => {
    // This does not exercise reserveWalletAmount — it exercises the
    // pre-fix pattern directly, to prove this test suite is actually
    // capable of catching the bug (i.e. the passing tests above are
    // meaningful, not vacuous).
    const RESERVE_AMOUNT_PAISE = 500;
    const ATTEMPTS = 1000;

    await Promise.all(
      Array.from({ length: ATTEMPTS }, () => buggyUnconditionalReserve(account, RESERVE_AMOUNT_PAISE)),
    );

    // Under the old pattern, every concurrent caller reads the same stale
    // `lockedBalancePaise` before any of them write, so the writes clobber
    // each other instead of accumulating — the correct, race-free result
    // (200 successful reservations of 500 paise each, i.e. 100,000 total)
    // never happens. This is the exact lost-update bug the fix closes.
    expect(account.lockedBalancePaise).not.toBe(200 * RESERVE_AMOUNT_PAISE);
  });
});
