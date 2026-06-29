/**
 * BILLING & SUBSCRIPTION MANAGEMENT
 * 
 * Production-ready billing system for B2B and B2C.
 * 
 * FEATURES:
 * - Dynamic plan management (Super Admin)
 * - B2B: Prepaid (credits) + Postpaid (invoicing)
 * - B2C: Time-based plans (daily/weekly/monthly/etc)
 * - GST-compliant invoicing
 * - Usage tracking
 * - Billing dashboards
 * 
 * ACCESS CONTROL:
 * - Super Admin: Full plan/billing control
 * - Company Admin: View/purchase plans, invoices
 * - Consumer: View/purchase B2C plans
 * - Agents: No billing access
 */

import { Express, Request, Response } from "express";
import { z } from "zod";
import { db } from "./db";
import { 
  billingPlans, subscriptions, usageRecords, invoices, invoiceLineItems,
  gstSettings, billingSettings, users, organizations, billingAccounts,
  billingLedgerEntries, callBillingRecords, platformSettings,
  PLAN_TYPE, BILLING_MODEL, PLAN_DURATION, SUBSCRIPTION_STATUS, INVOICE_STATUS,
  type BillingPlan, type Subscription, type Invoice
} from "@shared/schema";
import { eq, and, or, desc, sql, gte, lte } from "drizzle-orm";
import { requireAuth, requireRole } from "./role-middleware";
import { logger } from "./observability";
import { AuditHelpers } from "./audit";
import { generateInvoiceHtml, createUsageInvoice, markInvoicePaid } from "./invoice-service";
import { formatInrFromPaise, summarizeBillingPlan } from "./billing-plan-utils";
import { BillingEngine } from "./billing-engine";
import { getOrganizationBillingSnapshot } from "./organization-billing";
import {
  strictBillingPlanConfigSchema,
  buildStrictBillingPlanConfig,
  normalizeBillingType,
} from "./billing-config";

// ============================================================================
// VALIDATION SCHEMAS
// ============================================================================

const createPlanSchema = z.object({
  name: z.string().min(2).max(100),
  planCode: z.string().min(2).max(100).optional(),
  description: z.string().optional(),
  planType: z.enum(["b2b", "b2c"]),
  billingModel: z.enum(["prepaid", "postpaid", "hybrid"]).default("prepaid"),
  duration: z.enum(["daily", "weekly", "monthly", "quarterly", "yearly", "custom"]),
  durationDays: z.number().int().positive(),
  includedMinutes: z.number().int().nonnegative(),
  priceInPaise: z.number().int().nonnegative(),
  currency: z.string().default("INR"),
  gstPercentage: z.number().int().min(0).max(28).default(0),
  features: z.record(z.any()).optional(),
  perSecondBilling: z.boolean().default(true),
  rates: strictBillingPlanConfigSchema.shape.rates,
  freeUnits: strictBillingPlanConfigSchema.shape.freeUnits,
  limits: strictBillingPlanConfigSchema.shape.limits,
  featuresEnabled: z.array(z.string()).default([]),
  isDefault: z.boolean().default(false),
  isEnabled: z.boolean().default(true),
  isFeatured: z.boolean().default(false),
  displayOrder: z.number().int().default(0),
  effectiveFrom: z.string().datetime().optional(),
  effectiveUntil: z.string().datetime().optional(),
});

const updatePlanSchema = createPlanSchema.partial();

const updateGlobalPricingSchema = strictBillingPlanConfigSchema.partial();

const updateCompanyBillingAccountSchema = z.object({
  assignedPlanId: z.number().int().positive().nullable().optional(),
  billingType: z.enum(["prepaid", "postpaid", "hybrid"]).optional(),
  customPricingOverride: strictBillingPlanConfigSchema.partial().optional(),
  creditLimitPaise: z.number().int().nonnegative().optional(),
  maxConcurrentCalls: z.number().int().nonnegative().optional(),
  dailyUsageLimitSeconds: z.number().int().nonnegative().optional(),
});

const billingAdjustmentSchema = z.object({
  amountPaise: z.number().int(),
  type: z.enum(["wallet_credit", "wallet_debit", "credit_limit_settlement", "manual_adjustment"]),
  description: z.string().max(300).optional(),
});

const companyBlockSchema = z.object({
  blocked: z.boolean(),
  reason: z.string().max(300).optional(),
});

const purchaseSubscriptionSchema = z.object({
  planId: z.number().int().positive(),
  autoRenew: z.boolean().default(false),
});

const updateBillingSettingsSchema = z.object({
  currentBillingModel: z.enum(["prepaid", "postpaid", "hybrid"]).optional(),
  lowCreditThreshold: z.number().int().min(0).optional(),
  autoPayEnabled: z.boolean().optional(),
  blockOnZeroCredits: z.boolean().optional(),
});

const updateGstSettingsSchema = z.object({
  gstin: z.string().optional(),
  panNumber: z.string().optional(),
  legalName: z.string().min(2),
  tradeName: z.string().optional(),
  registeredAddress: z.string().optional(),
  stateCode: z.string().optional(),
  placeOfSupply: z.string().optional(),
  invoicePrefix: z.string().optional(),
});

const approvePostpaidSchema = z.object({
  organizationId: z.number().int().positive(),
  creditLimitPaise: z.number().int().positive(),
});

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function generateInvoiceNumber(prefix: string, counter: number): string {
  const year = new Date().getFullYear();
  const paddedCounter = String(counter).padStart(6, "0");
  return `${prefix}-${year}-${paddedCounter}`;
}

function calculateGst(amountPaise: number, gstPercentage: number, isInterState: boolean) {
  const gstAmount = Math.round((amountPaise * gstPercentage) / 100);
  if (isInterState) {
    return { cgst: 0, sgst: 0, igst: gstAmount, total: gstAmount };
  }
  const halfGst = Math.round(gstAmount / 2);
  return { cgst: halfGst, sgst: halfGst, igst: 0, total: gstAmount };
}

function formatPrice(paise: number): string {
  return formatInrFromPaise(paise);
}

async function getGlobalBillingConfig() {
  const [settings] = await db.select()
    .from(platformSettings)
    .where(eq(platformSettings.key, "billing_global_defaults"))
    .limit(1);

  return updateGlobalPricingSchema.catch({}).parse(settings?.value ?? {});
}

// ============================================================================
// ROUTES REGISTRATION
// ============================================================================

export function registerBillingRoutes(app: Express) {
  // ==========================================================================
  // PUBLIC ROUTES - View available plans
  // ==========================================================================

  /**
   * Get all available plans (public) - combined B2C and B2B
   */
  app.get("/api/billing/plans", async (req: Request, res: Response) => {
    try {
      const now = new Date();
      const plans = await db.select()
        .from(billingPlans)
        .where(and(
          eq(billingPlans.isEnabled, true),
          or(
            sql`${billingPlans.effectiveFrom} IS NULL`,
            lte(billingPlans.effectiveFrom, now)
          ),
          or(
            sql`${billingPlans.effectiveUntil} IS NULL`,
            gte(billingPlans.effectiveUntil, now)
          )
        ))
        .orderBy(billingPlans.displayOrder, billingPlans.priceInPaise);

      res.json(plans.map((p) => {
        const summary = summarizeBillingPlan(p);
        return {
          ...summary,
          id: p.id,
          name: p.name,
          type: p.planType,
          description: p.description || "",
          priceMonthly: (p.priceInPaise / 100).toFixed(0),
          priceYearly: (p.priceInPaise * 10 / 100).toFixed(0),
          currency: p.currency || "INR",
          features: summary.featureHighlights,
          isActive: p.isEnabled,
          callMinutesIncluded: p.includedMinutes || 0,
          translationMinutesIncluded: p.includedMinutes || 0,
          voiceMinutesIncluded: p.includedMinutes || 0,
          usersIncluded: p.planType === "b2b" ? 5 : 1,
        };
      }));
    } catch (err) {
      logger.error("Failed to fetch billing plans", String(err));
      res.status(500).json({ success: false, message: "Failed to fetch plans" });
    }
  });

  /**
   * Get available B2C plans (public)
   */
  app.get("/api/billing/plans/b2c", async (req: Request, res: Response) => {
    try {
      const now = new Date();
      const plans = await db.select()
        .from(billingPlans)
        .where(and(
          eq(billingPlans.planType, "b2c"),
          eq(billingPlans.isEnabled, true),
          or(
            sql`${billingPlans.effectiveFrom} IS NULL`,
            lte(billingPlans.effectiveFrom, now)
          ),
          or(
            sql`${billingPlans.effectiveUntil} IS NULL`,
            gte(billingPlans.effectiveUntil, now)
          )
        ))
        .orderBy(billingPlans.displayOrder, billingPlans.priceInPaise);

      res.json({ 
        success: true, 
        data: plans.map(p => ({
          ...p,
          ...summarizeBillingPlan(p),
        }))
      });
    } catch (err) {
      logger.error("Billing", "Failed to fetch B2C plans", err as Error);
      res.status(500).json({ success: false, message: "Failed to fetch plans" });
    }
  });

  /**
   * Get available B2B plans (authenticated companies only)
   */
  app.get("/api/billing/plans/b2b", requireAuth, async (req: Request, res: Response) => {
    try {
      const now = new Date();
      const plans = await db.select()
        .from(billingPlans)
        .where(and(
          eq(billingPlans.planType, "b2b"),
          eq(billingPlans.isEnabled, true),
          or(
            sql`${billingPlans.effectiveFrom} IS NULL`,
            lte(billingPlans.effectiveFrom, now)
          ),
          or(
            sql`${billingPlans.effectiveUntil} IS NULL`,
            gte(billingPlans.effectiveUntil, now)
          )
        ))
        .orderBy(billingPlans.displayOrder, billingPlans.priceInPaise);

      res.json({ 
        success: true, 
        data: plans.map(p => ({
          ...p,
          ...summarizeBillingPlan(p),
        }))
      });
    } catch (err) {
      logger.error("Billing", "Failed to fetch B2B plans", err as Error);
      res.status(500).json({ success: false, message: "Failed to fetch plans" });
    }
  });

  /**
   * Get current user's billing status with warnings
   * Returns subscription status, remaining minutes/credits, and warning messages
   */
  app.get("/api/billing/status", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.user!.id;
      const organizationId = req.user?.organizationId;

      // Get user subscription
      let [sub] = await db.select({
        subscription: subscriptions,
        plan: billingPlans,
      })
        .from(subscriptions)
        .innerJoin(billingPlans, eq(subscriptions.planId, billingPlans.id))
        .where(and(
          eq(subscriptions.userId, userId),
          eq(subscriptions.status, "active")
        ))
        .orderBy(desc(subscriptions.createdAt))
        .limit(1);

      if (!sub && organizationId) {
        [sub] = await db.select({
          subscription: subscriptions,
          plan: billingPlans,
        })
          .from(subscriptions)
          .innerJoin(billingPlans, eq(subscriptions.planId, billingPlans.id))
          .where(and(
            eq(subscriptions.organizationId, organizationId),
            eq(subscriptions.status, "active"),
          ))
          .orderBy(desc(subscriptions.createdAt))
          .limit(1);
      }

      // Calculate days until expiry and warning level
      let warningMessage: string | null = null;
      let warningLevel: "none" | "low" | "medium" | "critical" = "none";
      let canMakeCalls = false;
      let daysRemaining: number | null = null;
      let minutesRemaining = 0;

      if (sub) {
        const now = new Date();
        const endDate = new Date(sub.subscription.endDate!);
        daysRemaining = Math.ceil((endDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
        minutesRemaining = sub.subscription.minutesRemaining || 0;

        if (daysRemaining <= 0) {
          warningLevel = "critical";
          warningMessage = "Your subscription has expired. Please renew to continue using NeuraTalk.";
          canMakeCalls = false;
        } else if (minutesRemaining <= 0) {
          warningLevel = "critical";
          warningMessage = "You have no minutes remaining. Please upgrade your plan.";
          canMakeCalls = false;
        } else if (daysRemaining <= 1) {
          warningLevel = "critical";
          warningMessage = "Your subscription expires today! Renew now to avoid service interruption.";
          canMakeCalls = true;
        } else if (daysRemaining <= 3) {
          warningLevel = "medium";
          warningMessage = `Your subscription expires in ${daysRemaining} days. Please renew soon.`;
          canMakeCalls = true;
        } else if (daysRemaining <= 7) {
          warningLevel = "low";
          warningMessage = `Reminder: Your subscription expires in ${daysRemaining} days.`;
          canMakeCalls = true;
        } else if (minutesRemaining <= 10) {
          warningLevel = "medium";
          warningMessage = `Low balance: Only ${minutesRemaining} minutes remaining.`;
          canMakeCalls = true;
        } else {
          canMakeCalls = true;
        }
      } else {
        warningLevel = "critical";
        warningMessage = "No active subscription. Subscribe to start using NeuraTalk services.";
      }

      // For B2B users, also check organization wallet capacity
      let balanceUnits: number | null = null;
      let walletBalancePaise: number | null = null;
      if (organizationId) {
        const billingSnapshot = await getOrganizationBillingSnapshot(organizationId);
        if (billingSnapshot) {
          balanceUnits = Math.ceil(billingSnapshot.availableWalletPaise / 100);
          walletBalancePaise = billingSnapshot.walletBalancePaise;
          if (!billingSnapshot.canUsePaidServices) {
            warningLevel = "critical";
            warningMessage = billingSnapshot.billingType === "postpaid"
              ? "Your organization has no postpaid capacity remaining. Settle dues to continue."
              : "Your organization has no prepaid balance remaining. Add wallet funds to continue.";
            canMakeCalls = false;
          } else if (balanceUnits <= 10) {
            warningLevel = "critical";
            warningMessage = `Critical: Only ${balanceUnits} balance units remaining.`;
          } else if (balanceUnits <= 50) {
            warningLevel = "medium";
            warningMessage = `Low balance: ${balanceUnits} remaining. Consider adding more funds.`;
          }
        }
      }

      res.json({
        success: true,
        data: {
          hasActiveSubscription: !!sub,
          canMakeCalls,
          subscription: sub ? {
            id: sub.subscription.id,
            planName: summarizeBillingPlan(sub.plan).displayName,
            status: sub.subscription.status,
            startDate: sub.subscription.startDate,
            endDate: sub.subscription.endDate,
            minutesRemaining,
            minutesUsed: sub.subscription.minutesUsed || 0,
            includedMinutes: sub.plan.includedMinutes,
            priceFormatted: formatPrice(sub.plan.priceInPaise),
            ratePerSecondFormatted: summarizeBillingPlan(sub.plan).ratePerSecondFormatted,
          } : null,
          daysRemaining,
          balanceUnits,
          walletBalancePaise,
          warningLevel,
          warningMessage,
          renewalUrl: "/billing",
        },
      });
    } catch (err) {
      logger.error("Billing", "Failed to get billing status", err as Error);
      res.status(500).json({ success: false, message: "Failed to get billing status" });
    }
  });

  /**
   * Get strict billing overview (Super Admin)
   */
  app.get("/api/admin/billing/overview", requireAuth, requireRole("super_admin"), async (req: Request, res: Response) => {
    try {
      const [revenueTrend] = await db.select({
        todayRevenuePaise: sql<number>`COALESCE(SUM(CASE WHEN ${callBillingRecords.createdAt} >= CURRENT_DATE THEN ${callBillingRecords.prepaidDebitPaise} + ${callBillingRecords.postpaidAccrualPaise} ELSE 0 END), 0)`,
      }).from(callBillingRecords);

      const overview = await BillingEngine.getAdminBillingOverview();
      const [walletSummary] = await db.select({
        walletBalancePaise: sql<number>`COALESCE(SUM(${billingAccounts.walletBalancePaise}), 0)`,
        lockedBalancePaise: sql<number>`COALESCE(SUM(${billingAccounts.lockedBalancePaise}), 0)`,
      }).from(billingAccounts);

      res.json({
        success: true,
        data: {
          ...overview,
          todayRevenuePaise: Number(revenueTrend?.todayRevenuePaise ?? 0),
          walletBalancePaise: Number(walletSummary?.walletBalancePaise ?? 0),
          lockedBalancePaise: Number(walletSummary?.lockedBalancePaise ?? 0),
        },
      });
    } catch (err) {
      logger.error("Billing", "Failed to fetch strict billing overview", err as Error);
      res.status(500).json({ success: false, message: "Failed to fetch billing overview" });
    }
  });

  /**
   * Get global billing defaults (Super Admin)
   */
  app.get("/api/admin/billing/default-pricing", requireAuth, requireRole("super_admin"), async (req: Request, res: Response) => {
    try {
      const data = await getGlobalBillingConfig();
      res.json({ success: true, data });
    } catch (err) {
      logger.error("Billing", "Failed to fetch global billing defaults", err as Error);
      res.status(500).json({ success: false, message: "Failed to fetch global billing defaults" });
    }
  });

  /**
   * Update global billing defaults (Super Admin)
   */
  app.put("/api/admin/billing/default-pricing", requireAuth, requireRole("super_admin"), async (req: Request, res: Response) => {
    try {
      const validation = updateGlobalPricingSchema.safeParse(req.body);
      if (!validation.success) {
        return res.status(400).json({ success: false, message: "Invalid billing defaults", errors: validation.error.errors });
      }

      const data = validation.data;
      const [existing] = await db.select()
        .from(platformSettings)
        .where(eq(platformSettings.key, "billing_global_defaults"))
        .limit(1);

      let updated;
      if (existing) {
        [updated] = await db.update(platformSettings)
          .set({
            value: data,
            updatedBy: req.user!.id,
            updatedAt: new Date(),
          })
          .where(eq(platformSettings.id, existing.id))
          .returning();
      } else {
        [updated] = await db.insert(platformSettings).values({
          key: "billing_global_defaults",
          value: data,
          description: "Super admin controlled strict billing defaults",
          updatedBy: req.user!.id,
        }).returning();
      }

      await AuditHelpers.logSettingsChange(
        req.user!.id,
        "billing_global_defaults_updated",
        existing?.value || null,
        data,
      );

      res.json({ success: true, data: updated?.value ?? data });
    } catch (err) {
      logger.error("Billing", "Failed to update global billing defaults", err as Error);
      res.status(500).json({ success: false, message: "Failed to update billing defaults" });
    }
  });

  // ==========================================================================
  // SUPER ADMIN ROUTES - Plan Management
  // ==========================================================================

  /**
   * Get all plans (Super Admin)
   */
  app.get("/api/admin/billing/plans", requireAuth, requireRole("super_admin"), async (req: Request, res: Response) => {
    try {
      const plans = await db.select()
        .from(billingPlans)
        .orderBy(billingPlans.planType, billingPlans.displayOrder);

      res.json({ success: true, data: plans });
    } catch (err) {
      logger.error("Billing", "Failed to fetch all plans", err as Error);
      res.status(500).json({ success: false, message: "Failed to fetch plans" });
    }
  });

  /**
   * Create new plan (Super Admin)
   */
  app.post("/api/admin/billing/plans", requireAuth, requireRole("super_admin"), async (req: Request, res: Response) => {
    try {
      const validation = createPlanSchema.safeParse(req.body);
      if (!validation.success) {
        return res.status(400).json({ success: false, message: "Invalid plan data", errors: validation.error.errors });
      }

      const data = validation.data;
      if (data.isDefault) {
        await db.update(billingPlans)
          .set({ isDefault: false, updatedAt: new Date() })
          .where(eq(billingPlans.planType, data.planType));
      }
      const [plan] = await db.insert(billingPlans).values({
        name: data.name,
        planCode: data.planCode,
        description: data.description,
        planType: data.planType,
        billingModel: data.billingModel,
        duration: data.duration,
        durationDays: data.durationDays,
        includedMinutes: data.includedMinutes,
        priceInPaise: data.priceInPaise,
        currency: data.currency,
        gstPercentage: data.gstPercentage,
        features: data.features || {},
        perSecondBilling: data.perSecondBilling,
        rates: data.rates,
        freeUnits: data.freeUnits,
        limits: data.limits,
        featuresEnabled: data.featuresEnabled,
        isDefault: data.isDefault,
        isEnabled: data.isEnabled,
        isFeatured: data.isFeatured,
        displayOrder: data.displayOrder,
        effectiveFrom: data.effectiveFrom ? new Date(data.effectiveFrom) : null,
        effectiveUntil: data.effectiveUntil ? new Date(data.effectiveUntil) : null,
        createdBy: req.user!.id,
      }).returning();

      await AuditHelpers.logSettingsChange(
        req.user!.id,
        "billing_plan_created",
        null,
        { id: plan.id, name: plan.name, planType: plan.planType, price: plan.priceInPaise }
      );

      logger.info("Billing", `Plan created: ${plan.name} by user ${req.user!.id}`);
      res.status(201).json({ success: true, data: plan });
    } catch (err) {
      logger.error("Billing", "Failed to create plan", err as Error);
      res.status(500).json({ success: false, message: "Failed to create plan" });
    }
  });

  /**
   * Update plan (Super Admin)
   */
  app.patch("/api/admin/billing/plans/:id", requireAuth, requireRole("super_admin"), async (req: Request, res: Response) => {
    try {
      const planId = parseInt(req.params.id);
      const validation = updatePlanSchema.safeParse(req.body);
      if (!validation.success) {
        return res.status(400).json({ success: false, message: "Invalid plan data", errors: validation.error.errors });
      }

      const [existingPlan] = await db.select().from(billingPlans).where(eq(billingPlans.id, planId));
      if (!existingPlan) {
        return res.status(404).json({ success: false, message: "Plan not found" });
      }

      const data = validation.data;
      const updateData: Record<string, any> = { updatedAt: new Date() };
      const nextPlanType = data.planType ?? existingPlan.planType;
      if (data.isDefault === true) {
        await db.update(billingPlans)
          .set({ isDefault: false, updatedAt: new Date() })
          .where(eq(billingPlans.planType, nextPlanType));
      }
      
      if (data.name !== undefined) updateData.name = data.name;
      if (data.planCode !== undefined) updateData.planCode = data.planCode;
      if (data.description !== undefined) updateData.description = data.description;
      if (data.planType !== undefined) updateData.planType = data.planType;
      if (data.billingModel !== undefined) updateData.billingModel = data.billingModel;
      if (data.duration !== undefined) updateData.duration = data.duration;
      if (data.durationDays !== undefined) updateData.durationDays = data.durationDays;
      if (data.includedMinutes !== undefined) updateData.includedMinutes = data.includedMinutes;
      if (data.priceInPaise !== undefined) updateData.priceInPaise = data.priceInPaise;
      if (data.currency !== undefined) updateData.currency = data.currency;
      if (data.gstPercentage !== undefined) updateData.gstPercentage = data.gstPercentage;
      if (data.features !== undefined) updateData.features = data.features;
      if (data.perSecondBilling !== undefined) updateData.perSecondBilling = data.perSecondBilling;
      if (data.rates !== undefined) updateData.rates = data.rates;
      if (data.freeUnits !== undefined) updateData.freeUnits = data.freeUnits;
      if (data.limits !== undefined) updateData.limits = data.limits;
      if (data.featuresEnabled !== undefined) updateData.featuresEnabled = data.featuresEnabled;
      if (data.isDefault !== undefined) updateData.isDefault = data.isDefault;
      if (data.isEnabled !== undefined) updateData.isEnabled = data.isEnabled;
      if (data.isFeatured !== undefined) updateData.isFeatured = data.isFeatured;
      if (data.displayOrder !== undefined) updateData.displayOrder = data.displayOrder;
      if (data.effectiveFrom !== undefined) updateData.effectiveFrom = new Date(data.effectiveFrom);
      if (data.effectiveUntil !== undefined) updateData.effectiveUntil = new Date(data.effectiveUntil);

      const [updatedPlan] = await db.update(billingPlans)
        .set(updateData)
        .where(eq(billingPlans.id, planId))
        .returning();

      await AuditHelpers.logSettingsChange(
        req.user!.id,
        "billing_plan_updated",
        { name: existingPlan.name, isEnabled: existingPlan.isEnabled },
        { name: updatedPlan.name, isEnabled: updatedPlan.isEnabled }
      );

      logger.info("Billing", `Plan updated: ${updatedPlan.name} by user ${req.user!.id}`);
      res.json({ success: true, data: updatedPlan });
    } catch (err) {
      logger.error("Billing", "Failed to update plan", err as Error);
      res.status(500).json({ success: false, message: "Failed to update plan" });
    }
  });

  /**
   * Delete plan (Super Admin) - Soft disable only
   */
  app.delete("/api/admin/billing/plans/:id", requireAuth, requireRole("super_admin"), async (req: Request, res: Response) => {
    try {
      const planId = parseInt(req.params.id);

      const [plan] = await db.select().from(billingPlans).where(eq(billingPlans.id, planId));
      if (!plan) {
        return res.status(404).json({ success: false, message: "Plan not found" });
      }

      // Check if plan has active subscriptions
      const activeSubscriptions = await db.select({ count: sql<number>`count(*)` })
        .from(subscriptions)
        .where(and(
          eq(subscriptions.planId, planId),
          eq(subscriptions.status, "active")
        ));

      if (activeSubscriptions[0]?.count > 0) {
        // Soft disable instead of delete
        await db.update(billingPlans)
          .set({ isEnabled: false, updatedAt: new Date() })
          .where(eq(billingPlans.id, planId));
        
        logger.info("Billing", `Plan disabled (has active subs): ${plan.name}`);
        return res.json({ success: true, message: "Plan disabled (has active subscriptions)" });
      }

      await db.update(billingPlans)
        .set({ isEnabled: false, updatedAt: new Date() })
        .where(eq(billingPlans.id, planId));

      await AuditHelpers.logDelete(req.user!.id, "billing_plan", planId, { name: plan.name });

      logger.info("Billing", `Plan disabled: ${plan.name} by user ${req.user!.id}`);
      res.json({ success: true, message: "Plan disabled successfully" });
    } catch (err) {
      logger.error("Billing", "Failed to delete plan", err as Error);
      res.status(500).json({ success: false, message: "Failed to delete plan" });
    }
  });

  // ==========================================================================
  // SUPER ADMIN ROUTES - GST Settings
  // ==========================================================================

  /**
   * Get platform GST settings (Super Admin)
   */
  app.get("/api/admin/billing/gst-settings", requireAuth, requireRole("super_admin"), async (req: Request, res: Response) => {
    try {
      const [settings] = await db.select()
        .from(gstSettings)
        .where(sql`${gstSettings.organizationId} IS NULL`);

      res.json({ success: true, data: settings || null });
    } catch (err) {
      logger.error("Billing", "Failed to fetch GST settings", err as Error);
      res.status(500).json({ success: false, message: "Failed to fetch GST settings" });
    }
  });

  /**
   * Update platform GST settings (Super Admin)
   */
  app.put("/api/admin/billing/gst-settings", requireAuth, requireRole("super_admin"), async (req: Request, res: Response) => {
    try {
      const validation = updateGstSettingsSchema.safeParse(req.body);
      if (!validation.success) {
        return res.status(400).json({ success: false, message: "Invalid GST data", errors: validation.error.errors });
      }

      const data = validation.data;
      
      // Upsert platform GST settings
      const [existing] = await db.select()
        .from(gstSettings)
        .where(sql`${gstSettings.organizationId} IS NULL`);

      let settings;
      if (existing) {
        [settings] = await db.update(gstSettings)
          .set({
            ...data,
            updatedAt: new Date(),
          })
          .where(eq(gstSettings.id, existing.id))
          .returning();
      } else {
        [settings] = await db.insert(gstSettings).values({
          ...data,
        }).returning();
      }

      await AuditHelpers.logSettingsChange(
        req.user!.id,
        "gst_settings_updated",
        existing ? { gstin: existing.gstin } : null,
        { gstin: settings.gstin, legalName: settings.legalName }
      );

      logger.info("Billing", `GST settings updated by user ${req.user!.id}`);
      res.json({ success: true, data: settings });
    } catch (err) {
      logger.error("Billing", "Failed to update GST settings", err as Error);
      res.status(500).json({ success: false, message: "Failed to update GST settings" });
    }
  });

  // ==========================================================================
  // SUPER ADMIN ROUTES - Postpaid Approval
  // ==========================================================================

  /**
   * Approve postpaid access for a company (Super Admin)
   */
  app.post("/api/admin/billing/approve-postpaid", requireAuth, requireRole("super_admin"), async (req: Request, res: Response) => {
    try {
      const validation = approvePostpaidSchema.safeParse(req.body);
      if (!validation.success) {
        return res.status(400).json({ success: false, message: "Invalid data", errors: validation.error.errors });
      }

      const { organizationId, creditLimitPaise } = validation.data;

      // Check if org exists
      const [org] = await db.select().from(organizations).where(eq(organizations.id, organizationId));
      if (!org) {
        return res.status(404).json({ success: false, message: "Organization not found" });
      }

      // Upsert billing settings
      const [existing] = await db.select()
        .from(billingSettings)
        .where(eq(billingSettings.organizationId, organizationId));

      let settings;
      if (existing) {
        [settings] = await db.update(billingSettings)
          .set({
            postpaidEnabled: true,
            postpaidApproved: true,
            postpaidApprovedBy: req.user!.id,
            postpaidApprovedAt: new Date(),
            creditLimitPaise,
            allowedBillingModels: ["prepaid", "postpaid", "hybrid"],
            updatedAt: new Date(),
          })
          .where(eq(billingSettings.id, existing.id))
          .returning();
      } else {
        [settings] = await db.insert(billingSettings).values({
          organizationId,
          postpaidEnabled: true,
          postpaidApproved: true,
          postpaidApprovedBy: req.user!.id,
          postpaidApprovedAt: new Date(),
          creditLimitPaise,
          allowedBillingModels: ["prepaid", "postpaid", "hybrid"],
        }).returning();
      }

      await BillingEngine.assignPlanToOrganization({
        organizationId,
        creditLimitPaise,
        billingType: "postpaid",
      }).catch(() => undefined);

      await AuditHelpers.logSettingsChange(
        req.user!.id,
        "postpaid_approved",
        null,
        { organizationId, creditLimit: formatPrice(creditLimitPaise) }
      );

      logger.info("Billing", `Postpaid approved for org ${organizationId} by user ${req.user!.id}`);
      res.json({ success: true, data: settings });
    } catch (err) {
      logger.error("Billing", "Failed to approve postpaid", err as Error);
      res.status(500).json({ success: false, message: "Failed to approve postpaid" });
    }
  });

  /**
   * Get all companies with billing status (Super Admin)
   */
  app.get("/api/admin/billing/companies", requireAuth, requireRole("super_admin"), async (req: Request, res: Response) => {
    try {
      const approvedCompanies = await db.select({ id: organizations.id })
        .from(organizations)
        .where(eq(organizations.status, "approved"));
      await Promise.all(approvedCompanies.map((company) => BillingEngine.ensureOrganizationBillingAccount(company.id)));

      const accounts = await BillingEngine.listOrganizationBillingAccounts();
      const companiesWithBilling = await Promise.all(
        accounts.map(async ({ account, organization, plan }) => {
          const [settings] = await db.select()
            .from(billingSettings)
            .where(eq(billingSettings.organizationId, organization.id))
            .limit(1);

          const [activeCalls] = await db.select({
            count: sql<number>`count(*)`,
          })
            .from(callBillingRecords)
            .where(and(
              eq(callBillingRecords.organizationId, organization.id),
              eq(callBillingRecords.status, "active"),
            ));

          const [usageSummary] = await db.select({
            totalCostPaise: sql<number>`COALESCE(SUM(${callBillingRecords.prepaidDebitPaise} + ${callBillingRecords.postpaidAccrualPaise}), 0)`,
            totalSeconds: sql<number>`COALESCE(SUM(${callBillingRecords.voiceSeconds} + ${callBillingRecords.videoSeconds}), 0)`,
          })
            .from(callBillingRecords)
            .where(eq(callBillingRecords.organizationId, organization.id));

          return {
            id: organization.id,
            name: organization.name,
            email: organization.email,
            status: organization.status,
            assignedPlan: plan ? {
              id: plan.id,
              name: plan.name,
              billingModel: plan.billingModel,
              rates: plan.rates,
            } : null,
            account,
            billingSettings: settings || null,
            activeCallCount: Number(activeCalls?.count ?? 0),
            lifetimeUsage: {
              totalCostPaise: Number(usageSummary?.totalCostPaise ?? 0),
              totalSeconds: Number(usageSummary?.totalSeconds ?? 0),
            },
          };
        }),
      );

      res.json({ success: true, data: companiesWithBilling });
    } catch (err) {
      logger.error("Billing", "Failed to fetch companies", err as Error);
      res.status(500).json({ success: false, message: "Failed to fetch companies" });
    }
  });

  app.patch("/api/admin/billing/companies/:organizationId/account", requireAuth, requireRole("super_admin"), async (req: Request, res: Response) => {
    try {
      const organizationId = parseInt(req.params.organizationId);
      const validation = updateCompanyBillingAccountSchema.safeParse(req.body);
      if (!validation.success) {
        return res.status(400).json({ success: false, message: "Invalid account update", errors: validation.error.errors });
      }

      const updated = await BillingEngine.assignPlanToOrganization({
        organizationId,
        assignedPlanId: validation.data.assignedPlanId,
        billingType: validation.data.billingType,
        customPricingOverride: validation.data.customPricingOverride,
        creditLimitPaise: validation.data.creditLimitPaise,
        maxConcurrentCalls: validation.data.maxConcurrentCalls,
        dailyUsageLimitSeconds: validation.data.dailyUsageLimitSeconds,
      });

      await AuditHelpers.logSettingsChange(
        req.user!.id,
        "company_billing_account_updated",
        null,
        { organizationId, assignedPlanId: updated.assignedPlanId, billingType: updated.billingType },
      );

      res.json({ success: true, data: updated });
    } catch (err) {
      logger.error("Billing", "Failed to update company billing account", err as Error);
      res.status(500).json({ success: false, message: "Failed to update company billing account" });
    }
  });

  app.post("/api/admin/billing/companies/:organizationId/adjustments", requireAuth, requireRole("super_admin"), async (req: Request, res: Response) => {
    try {
      const organizationId = parseInt(req.params.organizationId);
      const validation = billingAdjustmentSchema.safeParse(req.body);
      if (!validation.success) {
        return res.status(400).json({ success: false, message: "Invalid adjustment", errors: validation.error.errors });
      }

      const adjusted = await BillingEngine.adjustOrganizationBalance({
        organizationId,
        amountPaise: validation.data.amountPaise,
        type: validation.data.type,
        actorUserId: req.user!.id,
        description: validation.data.description,
      });

      res.json({ success: true, data: adjusted });
    } catch (err) {
      logger.error("Billing", "Failed to apply billing adjustment", err as Error);
      res.status(500).json({ success: false, message: "Failed to apply billing adjustment" });
    }
  });

  app.post("/api/admin/billing/companies/:organizationId/block", requireAuth, requireRole("super_admin"), async (req: Request, res: Response) => {
    try {
      const organizationId = parseInt(req.params.organizationId);
      const validation = companyBlockSchema.safeParse(req.body);
      if (!validation.success) {
        return res.status(400).json({ success: false, message: "Invalid block request", errors: validation.error.errors });
      }

      const updated = await BillingEngine.setOrganizationBlockStatus({
        organizationId,
        blocked: validation.data.blocked,
        reason: validation.data.reason,
      });

      res.json({ success: true, data: updated });
    } catch (err) {
      logger.error("Billing", "Failed to update block status", err as Error);
      res.status(500).json({ success: false, message: "Failed to update block status" });
    }
  });

  app.get("/api/admin/billing/logs", requireAuth, requireRole("super_admin"), async (req: Request, res: Response) => {
    try {
      const logs = await db.select()
        .from(billingLedgerEntries)
        .orderBy(desc(billingLedgerEntries.createdAt))
        .limit(200);

      res.json({ success: true, data: logs });
    } catch (err) {
      logger.error("Billing", "Failed to fetch billing logs", err as Error);
      res.status(500).json({ success: false, message: "Failed to fetch billing logs" });
    }
  });

  app.post("/api/admin/billing/companies/:organizationId/generate-invoice", requireAuth, requireRole("super_admin"), async (req: Request, res: Response) => {
    try {
      const organizationId = parseInt(req.params.organizationId);
      const periodEnd = req.body?.periodEnd ? new Date(req.body.periodEnd) : new Date();
      const periodStart = req.body?.periodStart
        ? new Date(req.body.periodStart)
        : new Date(periodEnd.getFullYear(), periodEnd.getMonth(), 1);

      const result = await createUsageInvoice(organizationId, periodStart, periodEnd);
      if (!result.success) {
        return res.status(400).json(result);
      }

      res.json(result);
    } catch (err) {
      logger.error("Billing", "Failed to generate usage invoice", err as Error);
      res.status(500).json({ success: false, message: "Failed to generate usage invoice" });
    }
  });

  // ==========================================================================
  // COMPANY ADMIN ROUTES - Billing Dashboard
  // ==========================================================================

  /**
   * Get company billing dashboard
   */
  app.get("/api/billing/dashboard", requireAuth, requireRole("company_admin", "super_admin"), async (req: Request, res: Response) => {
    try {
      const organizationId = req.user!.organizationId;
      if (!organizationId) {
        return res.status(400).json({ success: false, message: "No organization associated" });
      }

      // Get organization
      const [org] = await db.select().from(organizations).where(eq(organizations.id, organizationId));
      const account = await BillingEngine.ensureOrganizationBillingAccount(organizationId);
      
      // Get billing settings
      const [settings] = await db.select()
        .from(billingSettings)
        .where(eq(billingSettings.organizationId, organizationId));

      // Get active subscription
      const [subscription] = await db.select()
        .from(subscriptions)
        .where(and(
          eq(subscriptions.organizationId, organizationId),
          eq(subscriptions.status, "active")
        ));

      // Get recent invoices
      const recentInvoices = await db.select()
        .from(invoices)
        .where(eq(invoices.organizationId, organizationId))
        .orderBy(desc(invoices.createdAt))
        .limit(5);

      // Get usage summary (last 30 days)
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      
      const usageSummary = await db.select({
        totalMinutes: sql<number>`COALESCE(SUM(${usageRecords.minutesConsumed}), 0)`,
        totalCost: sql<number>`COALESCE(SUM(${usageRecords.totalCostPaise}), 0)`,
      })
        .from(usageRecords)
        .where(and(
          eq(usageRecords.organizationId, organizationId),
          gte(usageRecords.usageDate, thirtyDaysAgo)
        ));

      const [activeCalls] = await db.select({
        count: sql<number>`count(*)`,
      })
        .from(callBillingRecords)
        .where(and(
          eq(callBillingRecords.organizationId, organizationId),
          eq(callBillingRecords.status, "active")
        ));

      res.json({
        success: true,
        data: {
          organization: {
            id: org?.id,
            name: org?.name,
          },
          strictAccount: account,
          billingSettings: settings || null,
          subscription: subscription || null,
          recentInvoices,
          activeCallCount: Number(activeCalls?.count ?? 0),
          usageSummary: usageSummary[0] || { totalMinutes: 0, totalCost: 0 },
        }
      });
    } catch (err) {
      logger.error("Billing", "Failed to fetch billing dashboard", err as Error);
      res.status(500).json({ success: false, message: "Failed to fetch billing dashboard" });
    }
  });

  /**
   * Update company billing settings
   */
  app.patch("/api/billing/settings", requireAuth, requireRole("company_admin"), async (req: Request, res: Response) => {
    try {
      const organizationId = req.user!.organizationId;
      if (!organizationId) {
        return res.status(400).json({ success: false, message: "No organization associated" });
      }

      const validation = updateBillingSettingsSchema.safeParse(req.body);
      if (!validation.success) {
        return res.status(400).json({ success: false, message: "Invalid data", errors: validation.error.errors });
      }

      const data = validation.data;

      // Get existing settings
      const [existing] = await db.select()
        .from(billingSettings)
        .where(eq(billingSettings.organizationId, organizationId));

      // Check if trying to switch to postpaid without approval
      if ((data.currentBillingModel === "postpaid" || data.currentBillingModel === "hybrid") && (!existing || !existing.postpaidApproved)) {
        return res.status(403).json({ success: false, message: "Postpaid not approved for this organization" });
      }

      let settings;
      if (existing) {
        [settings] = await db.update(billingSettings)
          .set({
            ...data,
            updatedAt: new Date(),
          })
          .where(eq(billingSettings.id, existing.id))
          .returning();
      } else {
        [settings] = await db.insert(billingSettings).values({
          organizationId,
          ...data,
        }).returning();
      }

      logger.info("Billing", `Billing settings updated for org ${organizationId}`);
      res.json({ success: true, data: settings });
    } catch (err) {
      logger.error("Billing", "Failed to update billing settings", err as Error);
      res.status(500).json({ success: false, message: "Failed to update billing settings" });
    }
  });

  /**
   * Get company invoices
   */
  app.get("/api/billing/invoices", requireAuth, requireRole("company_admin", "super_admin"), async (req: Request, res: Response) => {
    try {
      const organizationId = req.user!.organizationId;
      if (!organizationId) {
        return res.status(400).json({ success: false, message: "No organization associated" });
      }

      const companyInvoices = await db.select()
        .from(invoices)
        .where(eq(invoices.organizationId, organizationId))
        .orderBy(desc(invoices.createdAt));

      res.json({
        success: true,
        data: companyInvoices.map(inv => ({
          ...inv,
          totalFormatted: formatPrice(inv.totalAmountPaise),
        }))
      });
    } catch (err) {
      logger.error("Billing", "Failed to fetch invoices", err as Error);
      res.status(500).json({ success: false, message: "Failed to fetch invoices" });
    }
  });

  /**
   * Get invoice details
   */
  app.get("/api/billing/invoices/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const invoiceId = parseInt(req.params.id);
      
      const [invoice] = await db.select()
        .from(invoices)
        .where(eq(invoices.id, invoiceId));

      if (!invoice) {
        return res.status(404).json({ success: false, message: "Invoice not found" });
      }

      // Check access
      if (req.user!.role !== "super_admin" && invoice.organizationId !== req.user!.organizationId && invoice.userId !== req.user!.id) {
        return res.status(403).json({ success: false, message: "Access denied" });
      }

      // Get line items
      const lineItems = await db.select()
        .from(invoiceLineItems)
        .where(eq(invoiceLineItems.invoiceId, invoiceId));

      res.json({
        success: true,
        data: {
          ...invoice,
          lineItems,
          totalFormatted: formatPrice(invoice.totalAmountPaise),
        }
      });
    } catch (err) {
      logger.error("Billing", "Failed to fetch invoice", err as Error);
      res.status(500).json({ success: false, message: "Failed to fetch invoice" });
    }
  });

  /**
   * Get invoice HTML (for viewing/printing)
   */
  app.get("/api/billing/invoices/:id/html", requireAuth, async (req: Request, res: Response) => {
    try {
      const invoiceId = parseInt(req.params.id);
      
      // Check invoice exists and user has access
      const [invoice] = await db.select()
        .from(invoices)
        .where(eq(invoices.id, invoiceId));

      if (!invoice) {
        return res.status(404).json({ success: false, message: "Invoice not found" });
      }

      // Check access
      if (req.user!.role !== "super_admin" && invoice.organizationId !== req.user!.organizationId && invoice.userId !== req.user!.id) {
        return res.status(403).json({ success: false, message: "Access denied" });
      }

      const html = await generateInvoiceHtml(invoiceId);
      if (!html) {
        return res.status(500).json({ success: false, message: "Failed to generate invoice" });
      }

      res.setHeader("Content-Type", "text/html");
      res.send(html);
    } catch (err) {
      logger.error("Billing", "Failed to generate invoice HTML", err as Error);
      res.status(500).json({ success: false, message: "Failed to generate invoice HTML" });
    }
  });

  /**
   * Mark invoice as paid (Super Admin or automated)
   */
  app.post("/api/billing/invoices/:id/mark-paid", requireAuth, requireRole("super_admin"), async (req: Request, res: Response) => {
    try {
      const invoiceId = parseInt(req.params.id);
      const { paymentId } = req.body;
      
      const result = await markInvoicePaid(invoiceId, paymentId);
      
      if (!result.success) {
        return res.status(400).json(result);
      }

      await AuditHelpers.logUpdate(req.user!.id, "invoice", invoiceId, 
        { status: "pending" }, { status: "paid", invoiceNumber: result.invoice?.invoiceNumber });

      res.json(result);
    } catch (err) {
      logger.error("Billing", "Failed to mark invoice paid", err as Error);
      res.status(500).json({ success: false, message: "Failed to mark invoice paid" });
    }
  });

  // ==========================================================================
  // B2C USER ROUTES - Consumer Billing
  // ==========================================================================

  /**
   * Get consumer billing dashboard
   */
  app.get("/api/billing/consumer/dashboard", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.user!.id;

      // Get active subscription
      const [subscription] = await db.select({
        subscription: subscriptions,
        plan: billingPlans,
      })
        .from(subscriptions)
        .innerJoin(billingPlans, eq(subscriptions.planId, billingPlans.id))
        .where(and(
          eq(subscriptions.userId, userId),
          eq(subscriptions.status, "active")
        ));

      // Get recent invoices
      const recentInvoices = await db.select()
        .from(invoices)
        .where(eq(invoices.userId, userId))
        .orderBy(desc(invoices.createdAt))
        .limit(5);

      // Get usage summary (last 30 days)
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      
      const usageSummary = await db.select({
        totalMinutes: sql<number>`COALESCE(SUM(${usageRecords.minutesConsumed}), 0)`,
      })
        .from(usageRecords)
        .where(and(
          eq(usageRecords.userId, userId),
          gte(usageRecords.usageDate, thirtyDaysAgo)
        ));

      res.json({
        success: true,
        data: {
          subscription: subscription ? {
            ...subscription.subscription,
            plan: {
              ...subscription.plan,
              ...summarizeBillingPlan(subscription.plan),
            },
            planName: summarizeBillingPlan(subscription.plan).displayName,
          } : null,
          recentInvoices,
          usageSummary: usageSummary[0] || { totalMinutes: 0 },
        }
      });
    } catch (err) {
      logger.error("Billing", "Failed to fetch consumer dashboard", err as Error);
      res.status(500).json({ success: false, message: "Failed to fetch dashboard" });
    }
  });

  /**
   * Purchase B2C subscription
   */
  app.post("/api/billing/consumer/subscribe", requireAuth, async (req: Request, res: Response) => {
    try {
      const validation = purchaseSubscriptionSchema.safeParse(req.body);
      if (!validation.success) {
        return res.status(400).json({ success: false, message: "Invalid data", errors: validation.error.errors });
      }

      const { planId, autoRenew } = validation.data;
      const userId = req.user!.id;

      // Get plan
      const [plan] = await db.select()
        .from(billingPlans)
        .where(and(
          eq(billingPlans.id, planId),
          eq(billingPlans.planType, "b2c"),
          eq(billingPlans.isEnabled, true)
        ));

      if (!plan) {
        return res.status(404).json({ success: false, message: "Plan not found or not available" });
      }

      // Check for existing active subscription
      const [existing] = await db.select()
        .from(subscriptions)
        .where(and(
          eq(subscriptions.userId, userId),
          eq(subscriptions.status, "active")
        ));

      if (existing) {
        return res.status(400).json({ success: false, message: "You already have an active subscription" });
      }

      // Create subscription (pending payment)
      const now = new Date();
      const endDate = new Date(now);
      endDate.setDate(endDate.getDate() + plan.durationDays);

      const [subscription] = await db.insert(subscriptions).values({
        userId,
        planId,
        status: "pending_payment",
        billingModel: "prepaid",
        startDate: now,
        endDate,
        minutesRemaining: plan.includedMinutes,
        autoRenew,
      }).returning();

      // Return subscription with plan details
      res.status(201).json({
        success: true,
        data: {
          subscription,
          plan,
          amountToPay: plan.priceInPaise,
          amountFormatted: formatPrice(plan.priceInPaise),
        }
      });
    } catch (err) {
      logger.error("Billing", "Failed to create subscription", err as Error);
      res.status(500).json({ success: false, message: "Failed to create subscription" });
    }
  });

  /**
   * Purchase subscription (direct purchase - activates immediately)
   * Deprecated: activation must happen only after payment verification.
   */
  app.post("/api/billing/subscriptions/purchase", requireAuth, async (req: Request, res: Response) => {
    try {
      const validation = purchaseSubscriptionSchema.safeParse(req.body);
      if (!validation.success) {
        return res.status(400).json({ success: false, message: "Invalid data", errors: validation.error.errors });
      }

      const { planId, autoRenew } = validation.data;
      const userId = req.user!.id;

      // Get plan
      const [plan] = await db.select()
        .from(billingPlans)
        .where(and(
          eq(billingPlans.id, planId),
          eq(billingPlans.isEnabled, true)
        ));

      if (!plan) {
        return res.status(404).json({ success: false, message: "Plan not found or not available" });
      }

      // Check for existing active subscription
      const [existing] = await db.select()
        .from(subscriptions)
        .where(and(
          eq(subscriptions.userId, userId),
          eq(subscriptions.status, "active")
        ));

      if (existing) {
        return res.status(400).json({ success: false, message: "You already have an active subscription. Please cancel it first." });
      }

      res.status(409).json({
        success: false,
        message: "Direct activation is disabled. Complete payment through the checkout flow first.",
        data: {
          plan,
          planId: plan.id,
          requiresPayment: true,
          checkoutEndpoint: "/api/payments/create-order",
          recommendedPayload: {
            planId: plan.id,
          },
        }
      });
    } catch (err) {
      logger.error("Billing", "Failed to purchase subscription", err as Error);
      res.status(500).json({ success: false, message: "Failed to purchase subscription" });
    }
  });

  /**
   * Get consumer invoices
   */
  app.get("/api/billing/consumer/invoices", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.user!.id;

      const userInvoices = await db.select()
        .from(invoices)
        .where(eq(invoices.userId, userId))
        .orderBy(desc(invoices.createdAt));

      res.json({
        success: true,
        data: userInvoices.map(inv => ({
          ...inv,
          totalFormatted: formatPrice(inv.totalAmountPaise),
        }))
      });
    } catch (err) {
      logger.error("Billing", "Failed to fetch consumer invoices", err as Error);
      res.status(500).json({ success: false, message: "Failed to fetch invoices" });
    }
  });

  // ==========================================================================
  // USAGE TRACKING
  // ==========================================================================

  /**
   * Get usage history
   */
  app.get("/api/billing/usage", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.user!.id;
      const organizationId = req.user!.organizationId;

      let whereClause;
      if (organizationId && ["company_admin", "super_admin"].includes(req.user!.role)) {
        whereClause = eq(usageRecords.organizationId, organizationId);
      } else {
        whereClause = eq(usageRecords.userId, userId);
      }

      const usage = await db.select()
        .from(usageRecords)
        .where(whereClause)
        .orderBy(desc(usageRecords.usageDate))
        .limit(100);

      res.json({ success: true, data: usage });
    } catch (err) {
      logger.error("Billing", "Failed to fetch usage", err as Error);
      res.status(500).json({ success: false, message: "Failed to fetch usage" });
    }
  });

  // Simple balance endpoint for ConsumerDashboard widget
  app.get("/api/billing/balance", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.user!.id;
      const [sub] = await db.select({
        minutesRemaining: subscriptions.minutesRemaining,
        endDate: subscriptions.endDate,
        plan: billingPlans,
      })
        .from(subscriptions)
        .innerJoin(billingPlans, eq(subscriptions.planId, billingPlans.id))
        .where(and(eq(subscriptions.userId, userId), eq(subscriptions.status, "active")))
        .orderBy(desc(subscriptions.createdAt))
        .limit(1);

      if (!sub) {
        return res.json({ balanceInr: 0, minutesRemaining: 0, hasActiveSubscription: false });
      }

      const minutesRemaining = sub.minutesRemaining ?? 0;
      // Approximate balance = remaining minutes × per-minute rate
      const ratePerSecondPaise = (sub.plan as any).ratePerSecondPaise ?? 0;
      const balancePaise = minutesRemaining * 60 * ratePerSecondPaise;

      res.json({
        hasActiveSubscription: true,
        minutesRemaining,
        balanceInr: Number((balancePaise / 100).toFixed(2)),
        planName: (sub.plan as any).name,
        expiresAt: sub.endDate,
      });
    } catch (err) {
      logger.error("Billing", "Failed to fetch balance", err as Error);
      res.status(500).json({ success: false, message: "Failed to fetch balance" });
    }
  });

  // ── GET /api/billing/wallet ──────────────────────────────────────────────────
  // Returns the caller's wallet balance and last 50 ledger transactions.
  // B2C users have a personal balance derived from their subscription remaining
  // minutes; B2B org members see their organisation's wallet balance.
  app.get("/api/billing/wallet", requireAuth, async (req: Request, res: Response) => {
    try {
      const user = req.user!;
      const userId = user.id;
      const orgId = (user as any).organizationId ?? null;

      // ── B2B: org wallet ───────────────────────────────────────────────────────
      if (orgId) {
        const [account] = await db
          .select()
          .from(billingAccounts)
          .where(eq(billingAccounts.organizationId, orgId))
          .limit(1);

        const ledger = await db
          .select()
          .from(billingLedgerEntries)
          .where(eq(billingLedgerEntries.organizationId, orgId))
          .orderBy(desc(billingLedgerEntries.createdAt))
          .limit(50);

        return res.json({
          success: true,
          walletType: "organization",
          balancePaise: account?.walletBalancePaise ?? 0,
          balanceInr: Number(((account?.walletBalancePaise ?? 0) / 100).toFixed(2)),
          lockedPaise: account?.lockedBalancePaise ?? 0,
          availablePaise: (account?.walletBalancePaise ?? 0) - (account?.lockedBalancePaise ?? 0),
          currency: account?.currency ?? "INR",
          isBlocked: account?.isBlocked ?? false,
          transactions: ledger.map((e) => ({
            id: e.id,
            type: e.entryType,
            direction: e.direction,
            amountPaise: e.amountPaise,
            amountInr: Number((e.amountPaise / 100).toFixed(2)),
            balanceAfterPaise: e.balanceAfterPaise,
            callId: e.callId,
            createdAt: e.createdAt,
            metadata: e.metadata,
          })),
        });
      }

      // ── B2C: personal subscription-based balance ──────────────────────────────
      const [activeSub] = await db
        .select({
          id: subscriptions.id,
          minutesRemaining: subscriptions.minutesRemaining,
          minutesUsed: subscriptions.minutesUsed,
          endDate: subscriptions.endDate,
          planName: billingPlans.name,
          priceInPaise: billingPlans.priceInPaise,
          includedMinutes: billingPlans.callMinutesIncluded,
        })
        .from(subscriptions)
        .innerJoin(billingPlans, eq(subscriptions.planId, billingPlans.id))
        .where(and(eq(subscriptions.userId, userId), eq(subscriptions.status, "active")))
        .orderBy(desc(subscriptions.createdAt))
        .limit(1);

      const ledger = await db
        .select()
        .from(billingLedgerEntries)
        .where(eq(billingLedgerEntries.userId, userId))
        .orderBy(desc(billingLedgerEntries.createdAt))
        .limit(50);

      const minutesRemaining = activeSub?.minutesRemaining ?? 0;

      return res.json({
        success: true,
        walletType: "personal",
        balancePaise: 0,
        balanceInr: 0,
        minutesRemaining,
        minutesUsed: activeSub?.minutesUsed ?? 0,
        hasActiveSubscription: !!activeSub,
        subscription: activeSub
          ? {
              id: activeSub.id,
              planName: activeSub.planName,
              minutesRemaining,
              expiresAt: activeSub.endDate,
            }
          : null,
        currency: "INR",
        transactions: ledger.map((e) => ({
          id: e.id,
          type: e.entryType,
          direction: e.direction,
          amountPaise: e.amountPaise,
          amountInr: Number((e.amountPaise / 100).toFixed(2)),
          callId: e.callId,
          createdAt: e.createdAt,
          metadata: e.metadata,
        })),
      });
    } catch (err) {
      logger.error("Billing", "Failed to fetch wallet", err as Error);
      res.status(500).json({ success: false, message: "Failed to fetch wallet" });
    }
  });

  // ── GET /api/billing/subscriptions ───────────────────────────────────────────
  // Returns all subscriptions for the authenticated user (active + historical),
  // with plan details, usage, and renewal status.
  app.get("/api/billing/subscriptions", requireAuth, async (req: Request, res: Response) => {
    try {
      const user = req.user!;
      const userId = user.id;
      const orgId = (user as any).organizationId ?? null;

      const limitRaw = Math.min(Number(req.query.limit) || 20, 100);
      const offsetRaw = Math.max(Number(req.query.offset) || 0, 0);
      const statusFilter = (req.query.status as string) || undefined;

      const conditions = orgId
        ? [eq(subscriptions.organizationId, orgId)]
        : [eq(subscriptions.userId, userId)];

      if (statusFilter) {
        conditions.push(eq(subscriptions.status, statusFilter));
      }

      const rows = await db
        .select({
          id: subscriptions.id,
          status: subscriptions.status,
          billingModel: subscriptions.billingModel,
          startDate: subscriptions.startDate,
          endDate: subscriptions.endDate,
          minutesUsed: subscriptions.minutesUsed,
          minutesRemaining: subscriptions.minutesRemaining,
          autoRenew: subscriptions.autoRenew,
          nextBillingDate: subscriptions.nextBillingDate,
          createdAt: subscriptions.createdAt,
          plan: {
            id: billingPlans.id,
            name: billingPlans.name,
            planType: billingPlans.planType,
            priceInPaise: billingPlans.priceInPaise,
            currency: billingPlans.currency,
            callMinutesIncluded: billingPlans.callMinutesIncluded,
            duration: billingPlans.duration,
          },
        })
        .from(subscriptions)
        .innerJoin(billingPlans, eq(subscriptions.planId, billingPlans.id))
        .where(and(...conditions))
        .orderBy(desc(subscriptions.createdAt))
        .limit(limitRaw)
        .offset(offsetRaw);

      const [{ total }] = await db
        .select({ total: sql<number>`cast(count(*) as int)` })
        .from(subscriptions)
        .where(and(...conditions));

      const active = rows.find((r) => r.status === "active") ?? null;

      return res.json({
        success: true,
        activeSubscription: active
          ? {
              id: active.id,
              planName: active.plan.name,
              status: active.status,
              minutesRemaining: active.minutesRemaining,
              minutesUsed: active.minutesUsed,
              expiresAt: active.endDate,
              autoRenew: active.autoRenew,
            }
          : null,
        subscriptions: rows.map((r) => ({
          id: r.id,
          status: r.status,
          billingModel: r.billingModel,
          plan: r.plan,
          minutesUsed: r.minutesUsed,
          minutesRemaining: r.minutesRemaining,
          startDate: r.startDate,
          endDate: r.endDate,
          autoRenew: r.autoRenew,
          nextBillingDate: r.nextBillingDate,
          createdAt: r.createdAt,
        })),
        pagination: { total, limit: limitRaw, offset: offsetRaw },
      });
    } catch (err) {
      logger.error("Billing", "Failed to fetch subscriptions", err as Error);
      res.status(500).json({ success: false, message: "Failed to fetch subscriptions" });
    }
  });

  logger.info("Billing", "Billing routes registered");
}
