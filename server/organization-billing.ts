import { and, desc, eq } from "drizzle-orm";
import { db } from "./db";
import { billingAccounts, billingPlans, organizations, subscriptions } from "@shared/schema";

export interface OrganizationBillingSnapshot {
  organizationId: number;
  billingType: "prepaid" | "postpaid" | "hybrid";
  organizationActive: boolean;
  organizationStatus: string | null;
  hasActiveSubscription: boolean;
  subscriptionId: number | null;
  subscriptionEndsAt: Date | null;
  availableWalletPaise: number;
  walletBalancePaise: number;
  lockedBalancePaise: number;
  includedSecondsRemaining: number;
  includedCreditsRemainingPaise: number;
  outstandingPostpaidPaise: number;
  creditLimitPaise: number;
  hasPrepaidCapacity: boolean;
  hasPostpaidCapacity: boolean;
  canUsePaidServices: boolean;
}

export async function getOrganizationBillingSnapshot(
  organizationId: number,
): Promise<OrganizationBillingSnapshot | null> {
  const [organization] = await db.select()
    .from(organizations)
    .where(eq(organizations.id, organizationId))
    .limit(1);

  if (!organization) {
    return null;
  }

  const [billingAccount] = await db.select()
    .from(billingAccounts)
    .where(eq(billingAccounts.organizationId, organizationId))
    .limit(1);

  const [subscriptionRow] = await db.select({
    subscription: subscriptions,
    plan: billingPlans,
  })
    .from(subscriptions)
    .leftJoin(billingPlans, eq(subscriptions.planId, billingPlans.id))
    .where(and(
      eq(subscriptions.organizationId, organizationId),
      eq(subscriptions.status, "active"),
    ))
    .orderBy(desc(subscriptions.createdAt))
    .limit(1);

  const walletBalancePaise = Math.max(0, billingAccount?.walletBalancePaise ?? 0);
  const lockedBalancePaise = Math.max(0, billingAccount?.lockedBalancePaise ?? 0);
  const availableWalletPaise = Math.max(0, walletBalancePaise - lockedBalancePaise);
  const includedSecondsRemaining = Math.max(0, billingAccount?.includedSecondsRemaining ?? 0);
  const includedCreditsRemainingPaise = Math.max(0, billingAccount?.includedCreditsRemaining ?? 0);
  const creditLimitPaise = Math.max(0, billingAccount?.creditLimitPaise ?? 0);
  const outstandingPostpaidPaise = Math.max(0, billingAccount?.outstandingPostpaidPaise ?? 0);

  const billingType = (
    billingAccount?.billingType
    || subscriptionRow?.subscription.billingModel
    || "prepaid"
  ) as "prepaid" | "postpaid" | "hybrid";

  const hasPrepaidCapacity = (
    availableWalletPaise > 0
    || includedSecondsRemaining > 0
    || includedCreditsRemainingPaise > 0
  );
  const hasPostpaidCapacity = creditLimitPaise > outstandingPostpaidPaise;
  const hasActiveSubscription = Boolean(
    subscriptionRow?.subscription
    && (!subscriptionRow.subscription.endDate || new Date(subscriptionRow.subscription.endDate) > new Date())
  );

  const canUsePaidServices = hasActiveSubscription && (
    billingType === "prepaid"
      ? hasPrepaidCapacity
      : billingType === "postpaid"
        ? hasPostpaidCapacity
        : hasPrepaidCapacity || hasPostpaidCapacity
  );

  return {
    organizationId,
    billingType,
    organizationActive: Boolean(organization.isActive),
    organizationStatus: organization.status ?? null,
    hasActiveSubscription,
    subscriptionId: subscriptionRow?.subscription.id ?? null,
    subscriptionEndsAt: subscriptionRow?.subscription.endDate ?? null,
    availableWalletPaise,
    walletBalancePaise,
    lockedBalancePaise,
    includedSecondsRemaining,
    includedCreditsRemainingPaise,
    outstandingPostpaidPaise,
    creditLimitPaise,
    hasPrepaidCapacity,
    hasPostpaidCapacity,
    canUsePaidServices,
  };
}
