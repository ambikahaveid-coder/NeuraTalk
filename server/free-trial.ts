import { and, asc, eq } from "drizzle-orm";
import { db } from "./db";
import { billingPlans, subscriptions } from "@shared/schema";
import { logger } from "./observability";

/**
 * Every individual (non-organization) user gets exactly this many free call
 * minutes, once, shared across audio, video and translated calls.
 */
export const FREE_TRIAL_MINUTES = 15;

// The minutes are the real limit; validity is long so unused minutes don't
// silently vanish after a week.
const FREE_TRIAL_VALIDITY_DAYS = 365;

/**
 * Find the free-trial plan. Several seeded plans are priced at ₹0 (e.g. the
 * "Enterprise"/contact-sales tiers with 99,999 minutes), so "any free plan"
 * is not safe — prefer the plan named "Free Trial", then the smallest free
 * B2C plan.
 */
export async function findFreeTrialPlan() {
  const [named] = await db.select().from(billingPlans)
    .where(and(
      eq(billingPlans.name, "Free Trial"),
      eq(billingPlans.planType, "b2c"),
      eq(billingPlans.isEnabled, true),
    ))
    .limit(1);
  if (named) return named;

  const [smallest] = await db.select().from(billingPlans)
    .where(and(
      eq(billingPlans.priceInPaise, 0),
      eq(billingPlans.planType, "b2c"),
      eq(billingPlans.isEnabled, true),
    ))
    .orderBy(asc(billingPlans.includedMinutes))
    .limit(1);
  return smallest ?? null;
}

/**
 * Give the one-time free trial to a user who has never had any subscription.
 * Safe to call on every login: users who already had a subscription (trial
 * used up, expired, or paid) are left untouched. Never throws.
 */
export async function grantFreeTrialIfEligible(userId: number): Promise<void> {
  try {
    const [existing] = await db.select({ id: subscriptions.id })
      .from(subscriptions)
      .where(eq(subscriptions.userId, userId))
      .limit(1);
    if (existing) return;

    const plan = await findFreeTrialPlan();
    if (!plan) {
      logger.warn("FreeTrial", "No enabled free B2C plan — user has no subscription", { userId });
      return;
    }

    const now = new Date();
    await db.insert(subscriptions).values({
      userId,
      planId: plan.id,
      status: "active",
      billingModel: "prepaid",
      startDate: now,
      endDate: new Date(now.getTime() + FREE_TRIAL_VALIDITY_DAYS * 24 * 60 * 60 * 1000),
      minutesUsed: 0,
      minutesRemaining: FREE_TRIAL_MINUTES,
      autoRenew: false,
    });
    logger.info("FreeTrial", "Granted free trial", { userId, minutes: FREE_TRIAL_MINUTES });
  } catch (err) {
    logger.error("FreeTrial", "Free trial grant failed", err as Error);
  }
}
