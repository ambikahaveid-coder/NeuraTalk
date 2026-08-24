/**
 * Campaign billing gate -- Phase 5 (2026-08-24).
 * See docs/neura-ecosystem/30_CAMPAIGN_ENGINE_IMPLEMENTATION.md section 9.
 *
 * Deliberately NOT a rebuild of server/billing-engine.ts (which is entirely
 * call/voice/video-session-shaped -- reservation-hold-then-flush over a
 * live metered duration, with its own billingReservations/
 * billingLedgerEntries tables keyed by callId). A campaign send is
 * instantaneous, not a held-open session, so this is a single atomic
 * conditional deduction against the SAME `billingAccounts.walletBalancePaise`
 * column billing-engine.ts already owns -- not a new wallet, not a new
 * reservation lifecycle, not a new ledger table.
 *
 * PRICING IS NOT DEFINED BY THIS PHASE. `PLACEHOLDER_COST_PER_MESSAGE_PAISE`
 * exists only so the engine has a concrete, testable gate with a real
 * accounting effect -- doc 30 section 9 explicitly separates "campaign
 * execution accounting" (built here) from "future pricing policy" (NOT
 * decided here). Do not read this constant as an approved price.
 */
import { db } from "../../db";
import { billingAccounts } from "@shared/schema";
import { eq, and, gte, sql } from "drizzle-orm";

// NOT an approved price -- see file header. A future pricing-policy phase
// replaces this with a real rate (plan-based, per-category, etc.).
export const PLACEHOLDER_COST_PER_MESSAGE_PAISE = 10;

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
 * status transition in this codebase), never a read-then-write pair. Called
 * from INSIDE the campaign execution transaction, in the same tx as the
 * campaignRecipients row's PENDING->SENT transition (see campaigns/
 * service.ts) -- so a charge and its corresponding send either both commit
 * or both roll back together, and the unique (campaignId, customerId)
 * snapshot row plus its own atomic status CAS is what prevents this from
 * ever being called twice for the same recipient (Section 10 idempotency).
 */
export async function chargeCampaignMessage(tx: DbLike, businessId: number, costPaise: number = PLACEHOLDER_COST_PER_MESSAGE_PAISE): Promise<ChargeResult> {
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
