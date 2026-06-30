/**
 * Billing Lifecycle Scheduler
 *
 * Handles:
 * 1. Grace period: expired subscriptions get 7 days to renew before suspension
 * 2. Auto-suspend: billing account + org blocked after grace period expires
 * 3. Auto-resume: called by payment webhook — not here, handled inline
 */

import { and, eq, lt, sql } from "drizzle-orm";
import { db } from "./db";
import { subscriptions, billingAccounts, organizations } from "@shared/schema";
import { logger } from "./observability";
import { logAuditEvent } from "./audit-logging";

const GRACE_PERIOD_DAYS = 7;

export async function runBillingLifecycleCheck(): Promise<void> {
  const now = new Date();
  logger.info("BillingScheduler", "Running billing lifecycle check");

  try {
    await promoteExpiredToGrace(now);
    await suspendExpiredGrace(now);
  } catch (err) {
    logger.error("BillingScheduler", "Billing lifecycle check failed", err instanceof Error ? err : new Error(String(err)));
  }
}

/**
 * Step 1: Active subscriptions whose endDate has passed → pending_payment (grace period starts).
 * We re-purpose nextBillingDate as the grace-end timestamp.
 */
async function promoteExpiredToGrace(now: Date): Promise<void> {
  const expired = await db
    .select()
    .from(subscriptions)
    .where(
      and(
        eq(subscriptions.status, "active"),
        lt(subscriptions.endDate, now),
      ),
    );

  for (const sub of expired) {
    const graceEndsAt = new Date(sub.endDate);
    graceEndsAt.setDate(graceEndsAt.getDate() + GRACE_PERIOD_DAYS);

    await db
      .update(subscriptions)
      .set({
        status: "pending_payment",
        nextBillingDate: graceEndsAt,
        updatedAt: now,
      })
      .where(eq(subscriptions.id, sub.id));

    const orgId = sub.organizationId;
    if (orgId) {
      await logAuditEvent({
        userId: null,
        organizationId: orgId,
        action: "billing_event",
        details: {
          event: "subscription_grace_period_started",
          subscriptionId: sub.id,
          graceEndsAt: graceEndsAt.toISOString(),
        },
      });
      logger.info("BillingScheduler", `Org ${orgId} subscription ${sub.id} entered grace period (ends ${graceEndsAt.toISOString()})`);
    }
  }
}

/**
 * Step 2: Subscriptions in pending_payment whose grace period (nextBillingDate) has also passed
 * → block billing account + suspend org.
 */
async function suspendExpiredGrace(now: Date): Promise<void> {
  const overdue = await db
    .select()
    .from(subscriptions)
    .where(
      and(
        eq(subscriptions.status, "pending_payment"),
        sql`${subscriptions.nextBillingDate} IS NOT NULL`,
        lt(subscriptions.nextBillingDate, now),
      ),
    );

  for (const sub of overdue) {
    // Mark subscription suspended
    await db
      .update(subscriptions)
      .set({ status: "suspended", updatedAt: now })
      .where(eq(subscriptions.id, sub.id));

    const orgId = sub.organizationId;
    if (!orgId) continue;

    // Block billing account
    await db
      .update(billingAccounts)
      .set({
        isBlocked: true,
        blockedReason: "Subscription expired — grace period elapsed without payment",
        blockedAt: now,
        status: "suspended",
        updatedAt: now,
      })
      .where(eq(billingAccounts.organizationId, orgId));

    // Suspend org
    await db
      .update(organizations)
      .set({ status: "suspended", updatedAt: now })
      .where(eq(organizations.id, orgId));

    await logAuditEvent({
      userId: null,
      organizationId: orgId,
      action: "billing_event",
      details: {
        event: "org_auto_suspended",
        subscriptionId: sub.id,
        reason: "Grace period elapsed without payment",
      },
    });

    logger.warn("BillingScheduler", `Org ${orgId} auto-suspended: grace period elapsed (sub ${sub.id})`);
  }
}

/**
 * Called by payment webhook after successful payment to unsuspend.
 */
export async function autoResumeAfterPayment(organizationId: number, subscriptionId: number): Promise<void> {
  const now = new Date();

  await db
    .update(subscriptions)
    .set({ status: "active", updatedAt: now })
    .where(eq(subscriptions.id, subscriptionId));

  await db
    .update(billingAccounts)
    .set({ isBlocked: false, blockedReason: null, blockedAt: null, status: "active", updatedAt: now })
    .where(eq(billingAccounts.organizationId, organizationId));

  await db
    .update(organizations)
    .set({ status: "approved", updatedAt: now })
    .where(eq(organizations.id, organizationId));

  await logAuditEvent({
    userId: null,
    organizationId,
    action: "billing_event",
    details: { event: "org_auto_resumed", subscriptionId, reason: "Payment received" },
  });

  logger.info("BillingScheduler", `Org ${organizationId} auto-resumed after payment`);
}

/**
 * Grace period status for an org — used by the billing dashboard UI.
 */
export async function getGracePeriodStatus(organizationId: number): Promise<{
  inGrace: boolean;
  graceEndsAt: Date | null;
  isSuspended: boolean;
  daysRemaining: number | null;
}> {
  const [sub] = await db
    .select()
    .from(subscriptions)
    .where(
      and(
        eq(subscriptions.organizationId, organizationId),
        sql`${subscriptions.status} IN ('active', 'pending_payment', 'suspended')`,
      ),
    )
    .orderBy(sql`created_at DESC`)
    .limit(1);

  if (!sub) return { inGrace: false, graceEndsAt: null, isSuspended: false, daysRemaining: null };

  const isSuspended = sub.status === "suspended";
  const inGrace = sub.status === "pending_payment";
  const graceEndsAt = inGrace && sub.nextBillingDate ? sub.nextBillingDate : null;

  let daysRemaining: number | null = null;
  if (graceEndsAt) {
    const diff = graceEndsAt.getTime() - Date.now();
    daysRemaining = Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)));
  }

  return { inGrace, graceEndsAt, isSuspended, daysRemaining };
}

export function startBillingScheduler(): void {
  // Run once at startup (with a short delay to let DB stabilize)
  setTimeout(() => { void runBillingLifecycleCheck(); }, 30_000);

  // Then every 6 hours
  setInterval(() => { void runBillingLifecycleCheck(); }, 6 * 60 * 60 * 1000);

  logger.info("BillingScheduler", "Billing lifecycle scheduler initialized (6h interval, 30s startup delay)");
}
