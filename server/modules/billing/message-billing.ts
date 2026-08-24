/**
 * Generic per-message billing gate -- extracted in Phase 6 (2026-08-24)
 * from campaigns/billing.ts (Phase 5), which was already domain-agnostic
 * in its own logic (nothing about it referenced a campaign specifically).
 * Both server/modules/campaigns/billing.ts and server/modules/otp/billing.ts
 * now compose on top of THIS one primitive -- "do not duplicate billing
 * architecture" (doc 30 section 9, doc 31 section 14) means this function
 * exists exactly once.
 *
 * Deliberately NOT a rebuild of server/billing-engine.ts (call/voice/video
 * session-shaped, reservation-hold-then-flush over a live metered
 * duration, its own reservation/ledger tables keyed by callId). A single
 * message send is instantaneous, not a held-open session, so this is one
 * atomic conditional deduction against the SAME `billingAccounts.
 * walletBalancePaise` column billing-engine.ts already owns -- not a new
 * wallet, not a new reservation lifecycle, not a new ledger table.
 */
import { db } from "../../db";
import { billingAccounts } from "@shared/schema";
import { eq, and, gte, sql } from "drizzle-orm";

type DbLike = Pick<typeof db, "select" | "update">;

export interface ChargeResult {
  charged: boolean;
  reason?: "billing_not_configured" | "insufficient_credit";
  billingAccountId?: number;
  costPaise?: number;
}

/**
 * Atomically debits `costPaise` from the business's wallet if (and only if)
 * sufficient balance exists -- a single conditional UPDATE (the same
 * fails-closed CAS idiom as reserveWalletAmount and every other atomic
 * status transition in this codebase), never a read-then-write pair. Call
 * this from INSIDE the caller's own transaction, in the same tx as the
 * actual message/delivery-intent creation -- so a charge and its
 * corresponding send either both commit or both roll back together.
 */
export async function chargeMessage(tx: DbLike, businessId: number, costPaise: number): Promise<ChargeResult> {
  const [account] = await tx.select().from(billingAccounts).where(eq(billingAccounts.organizationId, businessId));
  if (!account) return { charged: false, reason: "billing_not_configured" };
  if (account.isBlocked) return { charged: false, reason: "insufficient_credit" };

  const [updated] = await tx.update(billingAccounts)
    .set({ walletBalancePaise: sql`${billingAccounts.walletBalancePaise} - ${costPaise}`, updatedAt: new Date() })
    .where(and(eq(billingAccounts.id, account.id), gte(billingAccounts.walletBalancePaise, costPaise)))
    .returning();

  if (!updated) return { charged: false, reason: "insufficient_credit" };
  return { charged: true, billingAccountId: account.id, costPaise };
}
