import { Request, Response, NextFunction } from "express";
import { and, desc, eq } from "drizzle-orm";
import { db } from "./db";
import { billingPlans, subscriptions } from "@shared/schema";
import { logger } from "./observability";
import { getOrganizationBillingSnapshot } from "./organization-billing";

export interface BillingCheckResult {
  allowed: boolean;
  reason?: string;
  remainingMinutes?: number;
  remainingCredits?: number;
  remainingWalletPaise?: number;
  warningMessage?: string;
  subscriptionStatus?: string;
}

async function getActiveUserSubscription(userId: number) {
  const [subscription] = await db.select({
    subscription: subscriptions,
    plan: billingPlans,
  })
    .from(subscriptions)
    .innerJoin(billingPlans, eq(subscriptions.planId, billingPlans.id))
    .where(and(
      eq(subscriptions.userId, userId),
      eq(subscriptions.status, "active"),
    ))
    .orderBy(desc(subscriptions.createdAt))
    .limit(1);

  return subscription ?? null;
}

export async function checkUserBillingStatus(userId: number): Promise<BillingCheckResult> {
  try {
    const activeSubscription = await getActiveUserSubscription(userId);

    if (!activeSubscription) {
      return {
        allowed: false,
        reason: "NO_SUBSCRIPTION",
        warningMessage: "You need an active subscription to use this service.",
      };
    }

    const now = new Date();
    const endDate = new Date(activeSubscription.subscription.endDate);
    const minutesRemaining = activeSubscription.subscription.minutesRemaining || 0;

    if (endDate <= now) {
      return {
        allowed: false,
        reason: "SUBSCRIPTION_EXPIRED",
        remainingMinutes: minutesRemaining,
        warningMessage: "Your subscription has expired. Please renew to continue.",
      };
    }

    if (minutesRemaining <= 0) {
      return {
        allowed: false,
        reason: "NO_MINUTES",
        remainingMinutes: 0,
        warningMessage: "You have no minutes remaining. Please upgrade your plan.",
      };
    }

    const daysRemaining = Math.ceil((endDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    const warningMessage = daysRemaining <= 3
      ? `Your subscription expires in ${daysRemaining} day${daysRemaining === 1 ? "" : "s"}.`
      : minutesRemaining <= 10
        ? `Low balance: only ${minutesRemaining} minutes remaining.`
        : undefined;

    return {
      allowed: true,
      remainingMinutes: minutesRemaining,
      subscriptionStatus: "active",
      warningMessage,
    };
  } catch (error) {
    logger.error("UsageEnforcement", "Failed to check user billing", error as Error);
    return {
      allowed: true,
      warningMessage: "Unable to verify billing status. Proceeding with caution.",
    };
  }
}

export async function checkOrgBillingStatus(organizationId: number): Promise<BillingCheckResult> {
  try {
    const snapshot = await getOrganizationBillingSnapshot(organizationId);

    if (!snapshot || !snapshot.organizationActive || snapshot.organizationStatus !== "approved") {
      return {
        allowed: false,
        reason: "ORG_NOT_ACTIVE",
        warningMessage: "Your organization is not active for calling.",
      };
    }

    if (!snapshot.hasActiveSubscription) {
      return {
        allowed: false,
        reason: "NO_SUBSCRIPTION",
        remainingWalletPaise: snapshot.availableWalletPaise,
        warningMessage: "Your organization does not have an active billing plan.",
      };
    }

    const balanceUnits = Math.ceil(snapshot.availableWalletPaise / 100);

    if (!snapshot.canUsePaidServices) {
      return {
        allowed: false,
        reason: snapshot.billingType === "postpaid" ? "CREDIT_LIMIT_REACHED" : "NO_BALANCE",
        remainingCredits: balanceUnits,
        remainingWalletPaise: snapshot.availableWalletPaise,
        warningMessage: snapshot.billingType === "postpaid"
          ? "Your organization has exhausted its postpaid credit limit."
          : "Your organization has no prepaid balance remaining.",
      };
    }

    const warningMessage = balanceUnits <= 10
      ? `Critical: only ${balanceUnits} balance units remaining.`
      : balanceUnits <= 50
        ? `Low balance: ${balanceUnits} units remaining.`
        : undefined;

    return {
      allowed: true,
      remainingCredits: balanceUnits,
      remainingWalletPaise: snapshot.availableWalletPaise,
      warningMessage,
    };
  } catch (error) {
    logger.error("UsageEnforcement", "Failed to check org billing", error as Error);
    return {
      allowed: true,
      warningMessage: "Unable to verify billing status. Proceeding with caution.",
    };
  }
}

export function requireActiveSubscription(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const userId = req.user?.id;
  const organizationId = req.user?.organizationId;
  const userRole = req.user?.role;

  if (!userId) {
    res.status(401).json({
      success: false,
      error: "Authentication required",
      code: "UNAUTHENTICATED",
    });
    return;
  }

  if (userRole === "super_admin") {
    (req as any).billingStatus = { allowed: true, subscriptionStatus: "admin_bypass" };
    next();
    return;
  }

  void (async () => {
    try {
      const result = organizationId
        ? await checkOrgBillingStatus(organizationId)
        : await checkUserBillingStatus(userId);

      if (!result.allowed) {
        logger.warn("UsageEnforcement", "Access denied by billing guard", {
          userId,
          organizationId,
          reason: result.reason,
        });

        res.status(402).json({
          success: false,
          error: result.warningMessage || "Payment required",
          code: result.reason || "PAYMENT_REQUIRED",
          details: {
            remainingMinutes: result.remainingMinutes,
            remainingCredits: result.remainingCredits,
            remainingWalletPaise: result.remainingWalletPaise,
            renewalUrl: "/billing",
          },
        });
        return;
      }

      (req as any).billingStatus = result;
      next();
    } catch (error) {
      logger.error("UsageEnforcement", "Billing guard failed", error as Error);
      next();
    }
  })();
}

export function warnLowBalance(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const originalSend = res.send.bind(res);

  res.send = function sendWithBillingWarning(body: any) {
    const billingStatus = (req as any).billingStatus as BillingCheckResult | undefined;

    if (billingStatus?.warningMessage && typeof body === "string") {
      try {
        const parsed = JSON.parse(body);
        parsed.billingWarning = billingStatus.warningMessage;
        if (billingStatus.remainingMinutes !== undefined) {
          parsed.remainingMinutes = billingStatus.remainingMinutes;
        }
        if (billingStatus.remainingCredits !== undefined) {
          parsed.remainingCredits = billingStatus.remainingCredits;
        }
        if (billingStatus.remainingWalletPaise !== undefined) {
          parsed.remainingWalletPaise = billingStatus.remainingWalletPaise;
        }
        body = JSON.stringify(parsed);
      } catch {
        // Non-JSON responses should pass through untouched.
      }
    }

    return originalSend(body);
  };

  next();
}
