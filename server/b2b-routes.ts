/**
 * B2B ROUTES
 * 
 * WHY THIS EXISTS:
 * Handles all B2B-specific functionality including:
 * - Company signup and onboarding
 * - OTP authentication
 * - Super Admin controls
 * - Agent/team management
 * - Credit management
 */

import type { Express } from "express";
import { db } from "./db";
import {
  users,
  organizations,
  orgMembers,
  platformSettings,
  billingPlans,
  subscriptions,
  bridgedCalls,
  billingLedgerEntries,
} from "@shared/schema";
import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { setDummyOtpMode } from "./otp-auth";
import { storage } from "./storage";
import {
  loadUser,
  requireAuth,
  requireSuperAdmin,
  requireCompanyAdminOrAbove,
  requireApprovedCompany,
} from "./role-middleware";
import { logger } from "./observability";
import { AuditHelpers } from "./audit";
import { BillingEngine } from "./billing-engine";
import { getOrganizationBillingSnapshot } from "./organization-billing";
import * as callService from "./modules/calls/service";
import { routeToSkillAgent } from "./modules/calls/smart-router";

// ============================================================================
// SCHEMAS
// ============================================================================

const companySignupSchema = z.object({
  name: z.string().min(2),
  email: z.string().email(),
  phone: z.string().optional(),
  industry: z.string().optional(),
  website: z.string().optional(),
  primaryLanguage: z.string().default("en"),
  adminName: z.string().min(2),
});

const addAgentSchema = z.object({
  email: z.string().email().optional(),
  phone: z.string().optional(),
  name: z.string().min(2),
  role: z.enum(["agent", "company_admin"]).default("agent"),
});

const createCompanySchema = z.object({
  companyName: z.string().min(2, "Company name required"),
  industry: z.string().optional(),
  website: z.string().optional(),
  companyEmail: z.string().email().optional(),
  companyPhone: z.string().optional(),
  plan: z.enum(["free", "pro", "enterprise"]).default("free"),
  adminEmail: z.string().email().optional(),
  adminPhone: z.string().optional(),
  adminName: z.string().min(2, "Admin name required"),
  autoApprove: z.boolean().default(true),
  initialWalletRupees: z.number().min(0).default(0),
}).refine(data => data.adminEmail || data.adminPhone, {
  message: "Admin email or phone required",
});

const b2bOutboundCallSchema = z.object({
  calleeIdentifier: z.string().min(3, "Callee identifier required"),
  callType: z.enum(["voice", "video"]).default("voice"),
  agentUserId: z.number().int().positive().optional(),
  myLanguage: z.string().min(2).max(16).optional().default("auto"),
  theirLanguage: z.string().min(2).max(16).optional().default("auto"),
  translationMode: z.enum(["off", "subtitles", "voice"]).optional().default("voice"),
  transportPreference: z.enum(["app_to_app", "app_to_pstn", "auto"]).optional().default("auto"),
  enableRecording: z.boolean().optional().default(false),
  enableLipsync: z.boolean().optional().default(false),
});

function toOpeningBalancePaise(input: { initialWalletRupees?: number }): number {
  const rupees = input.initialWalletRupees ?? 0;
  return Math.max(0, Math.round(rupees * 100));
}

async function getDefaultB2BPlan() {
  const [plan] = await db.select()
    .from(billingPlans)
    .where(and(
      eq(billingPlans.planType, "b2b"),
      eq(billingPlans.isEnabled, true),
    ))
    .orderBy(desc(billingPlans.isDefault), billingPlans.displayOrder, billingPlans.priceInPaise)
    .limit(1);

  return plan ?? null;
}

async function ensureOrganizationBillingReady(
  organizationId: number,
  actorUserId: number,
  openingBalancePaise = 0,
) {
  const [existingSubscription] = await db.select()
    .from(subscriptions)
    .where(and(
      eq(subscriptions.organizationId, organizationId),
      eq(subscriptions.status, "active"),
    ))
    .orderBy(desc(subscriptions.createdAt))
    .limit(1);

  let activeSubscription = existingSubscription ?? null;
  const defaultPlan = activeSubscription
    ? await db.query.billingPlans.findFirst({ where: eq(billingPlans.id, activeSubscription.planId) })
    : await getDefaultB2BPlan();

  if (!activeSubscription && defaultPlan) {
    const now = new Date();
    const endDate = new Date(now);
    endDate.setDate(endDate.getDate() + Math.max(1, defaultPlan.durationDays || 30));

    [activeSubscription] = await db.insert(subscriptions).values({
      organizationId,
      planId: defaultPlan.id,
      status: "active",
      billingModel: defaultPlan.billingModel || "prepaid",
      startDate: now,
      endDate,
      minutesRemaining: defaultPlan.includedMinutes || 0,
      autoRenew: false,
      currentUsage: 0,
    }).returning();
  }

  await BillingEngine.ensureOrganizationBillingAccount(organizationId);

  if (defaultPlan) {
    await BillingEngine.assignPlanToOrganization({
      organizationId,
      assignedPlanId: defaultPlan.id,
      billingType: (defaultPlan.billingModel || "prepaid") as "prepaid" | "postpaid" | "hybrid",
    });
  }

  if (openingBalancePaise > 0) {
    await BillingEngine.adjustOrganizationBalance({
      organizationId,
      amountPaise: openingBalancePaise,
      type: "wallet_credit",
      actorUserId,
      description: "Organization onboarding balance",
    });
  }

  return getOrganizationBillingSnapshot(organizationId);
}

async function getOrganizationSubscription(organizationId: number) {
  const [row] = await db.select({
    subscriptionId: subscriptions.id,
    planId: subscriptions.planId,
    status: subscriptions.status,
    billingModel: subscriptions.billingModel,
    endDate: subscriptions.endDate,
    planName: billingPlans.name,
  })
    .from(subscriptions)
    .leftJoin(billingPlans, eq(subscriptions.planId, billingPlans.id))
    .where(and(
      eq(subscriptions.organizationId, organizationId),
      eq(subscriptions.status, "active"),
    ))
    .orderBy(desc(subscriptions.createdAt))
    .limit(1);

  return row ?? null;
}

async function getOrganizationWalletLedger(organizationId: number, limit = 50) {
  return db.select()
    .from(billingLedgerEntries)
    .where(eq(billingLedgerEntries.organizationId, organizationId))
    .orderBy(desc(billingLedgerEntries.createdAt))
    .limit(limit);
}

function safeAverageDuration(seconds: number, count: number): string {
  if (!count || seconds <= 0) return "0:00";
  const avg = Math.round(seconds / count);
  const mins = Math.floor(avg / 60);
  const secs = avg % 60;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

async function getAgentStatusRows(organizationId: number) {
  const members = await db.query.orgMembers.findMany({
    where: eq(orgMembers.organizationId, organizationId),
    with: { user: true },
  });

  const activeSmartCalls = await callService.listSmartActiveCalls();
  const activeOrgCalls = activeSmartCalls.filter((call) => {
    const orgIds = [call.callerOrganizationId, call.calleeOrganizationId].filter(
      (value): value is number => typeof value === "number" && Number.isFinite(value),
    );
    return orgIds.includes(organizationId);
  });

  const recentSmartCalls = await Promise.all(
    members.map(async (member) => ({
      member,
      calls: await callService.listSmartCallsForUser(String(member.user.id)).catch(() => []),
    })),
  );

  return members.map((member) => {
    const userId = String(member.user.id);
    const currentCall = activeOrgCalls.find((call) => call.callerId === userId || call.calleeUserId === userId);
    const userRecentCalls = recentSmartCalls.find((entry) => entry.member.user.id === member.user.id)?.calls || [];
    const completedToday = userRecentCalls.filter((call) => {
      const endedAt = call.endedAt ? Date.parse(call.endedAt) : NaN;
      if (!Number.isFinite(endedAt)) return false;
      const ended = new Date(endedAt);
      const now = new Date();
      return ended.toDateString() === now.toDateString();
    });
    const totalDuration = completedToday.reduce((sum, call) => {
      if (!call.connectedAt || !call.endedAt) return sum;
      const startedAt = Date.parse(call.connectedAt);
      const endedAt = Date.parse(call.endedAt);
      if (!Number.isFinite(startedAt) || !Number.isFinite(endedAt) || endedAt <= startedAt) return sum;
      return sum + Math.round((endedAt - startedAt) / 1000);
    }, 0);

    return {
      id: member.user.id,
      username: member.user.username,
      email: member.user.email,
      phone: member.user.phone,
      role: member.user.role,
      memberRole: member.memberRole,
      isActive: member.user.isActive,
      isOnline: member.user.isActive,
      isOnCall: !!currentCall,
      callsToday: completedToday.length,
      avgHandleTime: safeAverageDuration(totalDuration, completedToday.length),
      currentCall: currentCall ? {
        customer: currentCall.calleeUserId === userId ? (currentCall.callerNumber || currentCall.callerId) : currentCall.calleeIdentifier,
        language: currentCall.calleeUserId === userId ? currentCall.callerLanguage : (currentCall.calleeLanguage || "auto"),
        duration: currentCall.connectedAt
          ? Math.max(0, Math.round((Date.now() - Date.parse(currentCall.connectedAt)) / 1000))
          : 0,
      } : null,
    };
  });
}

function buildTranslationRouteSnapshot() {
  const azureKey = process.env.AZURE_SPEECH_KEY;
  const azureRegion = process.env.AZURE_SPEECH_REGION;
  const elevenLabsKey = process.env.ELEVEN_LABS_API_KEY || process.env.ELEVENLABS_API_KEY;
  const livekitUrl = process.env.LIVEKIT_URL;
  const livekitApiKey = process.env.LIVEKIT_API_KEY;
  const msg91Key = process.env.MSG91_AUTH_KEY;

  const routes = [
    {
      id: "azure",
      name: "Azure Cognitive Services",
      sourceLanguage: "Multi",
      targetLanguage: "Multi",
      status: azureKey && azureRegion ? "active" : "offline",
      latency: azureKey && azureRegion ? 130 : 0,
      issue: azureKey && azureRegion ? null : "Missing Azure speech credentials",
    },
    {
      id: "elevenlabs",
      name: "ElevenLabs TTS",
      sourceLanguage: "Text",
      targetLanguage: "Audio",
      status: elevenLabsKey ? "active" : "offline",
      latency: elevenLabsKey ? 900 : 0,
      issue: elevenLabsKey ? null : "Missing ElevenLabs API key",
    },
    {
      id: "lingva",
      name: "Lingva Translation Fallback",
      sourceLanguage: "Multi",
      targetLanguage: "Multi",
      status: azureKey && azureRegion ? "degraded" : "active",
      latency: azureKey && azureRegion ? 2500 : 2300,
      issue: azureKey && azureRegion
        ? "Fallback-only route with higher latency"
        : "Primary translation provider offline; fallback route carrying production load",
    },
    {
      id: "webrtc",
      name: "LiveKit WebRTC Gateway",
      sourceLanguage: "Audio",
      targetLanguage: "Audio",
      status: livekitUrl && livekitApiKey ? "active" : "offline",
      latency: livekitUrl && livekitApiKey ? 50 : 0,
      issue: livekitUrl && livekitApiKey ? null : "Missing LiveKit signaling configuration",
    },
    {
      id: "pstn",
      name: "PSTN Bridge",
      sourceLanguage: "Audio",
      targetLanguage: "Phone",
      status: msg91Key ? "active" : "offline",
      latency: msg91Key ? 400 : 0,
      issue: msg91Key ? null : "Missing PSTN bridge credentials",
    },
  ] as const;

  const active = routes.filter((route) => route.status === "active").length;
  const degraded = routes.filter((route) => route.status === "degraded").length;
  const offline = routes.filter((route) => route.status === "offline").length;

  return {
    routes,
    summary: {
      total: routes.length,
      active,
      degraded,
      offline,
      status: offline > 0 ? (active > 0 ? "degraded" : "offline") : degraded > 0 ? "degraded" : "healthy",
    },
  };
}

// ============================================================================
// ROUTE REGISTRATION
// ============================================================================

export function registerB2BRoutes(app: Express): void {
  // Apply auth middleware to all routes
  app.use(loadUser);

  // Auth endpoints (OTP request/verify, logout) are in server/modules/auth.


  // ========================================================================
  // COMPANY SIGNUP & ONBOARDING
  // ========================================================================

  /**
   * Company signup - creates pending company
   * Handles both new users and existing users (from OTP verification)
   */
  app.post("/api/companies/signup", async (req, res) => {
    try {
      const input = companySignupSchema.parse(req.body);
      
      // Generate slug
      const slug = input.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
      
      // Check if slug exists
      const existing = await db.query.organizations.findFirst({
        where: eq(organizations.slug, slug),
      });
      
      if (existing) {
        return res.status(400).json({ 
          success: false, 
          message: "A company with this name already exists" 
        });
      }

      // Create company in pending status
      const [company] = await db.insert(organizations).values({
        name: input.name,
        slug,
        email: input.email,
        phone: input.phone,
        industry: input.industry,
        website: input.website,
        primaryLanguage: input.primaryLanguage,
        status: "pending",
        plan: "free",
      }).returning();

      // Check if user already exists (from OTP verification)
      const existingUser = await db.query.users.findFirst({
        where: eq(users.email, input.email),
      });

      let adminUser;
      
      // Use adminName for display, generate unique username for system
      const displayUsername = input.adminName || `${slug}_admin`;
      const uniqueUsername = `${displayUsername.toLowerCase().replace(/[^a-z0-9]+/g, '_')}_${Date.now().toString(36)}`;
      
      if (existingUser) {
        // Update existing user to company_admin with the submitted admin name
        const [updated] = await db.update(users)
          .set({
            role: "company_admin",
            organizationId: company.id,
            username: uniqueUsername, // Use the admin name as username
          })
          .where(eq(users.id, existingUser.id))
          .returning();
        adminUser = updated;
      } else {
        // Create new admin user with the submitted admin name
        const [created] = await db.insert(users).values({
          username: uniqueUsername,
          email: input.email,
          role: "company_admin",
          organizationId: company.id,
        }).returning();
        adminUser = created;
      }

      // Add as owner
      await db.insert(orgMembers).values({
        organizationId: company.id,
        userId: adminUser.id,
        memberRole: "owner",
      });

      logger.info("B2BRoutes", "Company signup completed", {
        companyId: company.id,
        companyName: input.name,
        existingUser: !!existingUser,
      });

      res.status(201).json({
        success: true,
        message: "Company registered! Please wait for approval.",
        company: {
          id: company.id,
          name: company.name,
          status: company.status,
        },
        user: {
          id: adminUser.id,
          username: adminUser.username,
          email: adminUser.email,
          role: adminUser.role,
          organizationId: adminUser.organizationId,
        },
      });
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ success: false, message: err.errors[0].message });
      }
      logger.error("B2BRoutes", "Company signup failed", err as Error);
      res.status(500).json({ success: false, message: "Something went wrong" });
    }
  });

  // ========================================================================
  // SUPER ADMIN ROUTES
  // ========================================================================

  /**
   * Get all companies (Super Admin)
   */
  app.get("/api/admin/companies", requireAuth, requireSuperAdmin, async (req, res) => {
    try {
      const companies = await db.query.organizations.findMany({
        orderBy: [desc(organizations.createdAt)],
      });

      const companiesWithBilling = await Promise.all(companies.map(async (company) => {
        const billing = await getOrganizationBillingSnapshot(company.id);
        const subscription = await getOrganizationSubscription(company.id);

        return {
          ...company,
          contactEmail: company.email,
          billing,
          account: billing ? {
            billingType: billing.billingType,
            walletBalancePaise: billing.walletBalancePaise,
            availableWalletPaise: billing.availableWalletPaise,
            lockedBalancePaise: billing.lockedBalancePaise,
            includedSecondsRemaining: billing.includedSecondsRemaining,
            includedCreditsRemainingPaise: billing.includedCreditsRemainingPaise,
            outstandingPostpaidPaise: billing.outstandingPostpaidPaise,
            creditLimitPaise: billing.creditLimitPaise,
            canUsePaidServices: billing.canUsePaidServices,
          } : null,
          activeSubscription: subscription,
        };
      }));

      res.json({ success: true, companies: companiesWithBilling });
    } catch (err) {
      logger.error("B2BRoutes", "Failed to fetch companies", err as Error);
      res.status(500).json({ success: false, message: "Failed to fetch companies" });
    }
  });

  app.post("/api/admin/companies", requireAuth, requireSuperAdmin, async (req, res) => {
    try {
      const validation = createCompanySchema.safeParse(req.body);
      if (!validation.success) {
        return res.status(400).json({ 
          success: false, 
          message: validation.error.errors[0].message,
          errors: validation.error.errors 
        });
      }

      const data = validation.data;

      // Check for existing company email
      if (data.companyEmail) {
        const [existingOrg] = await db.select().from(organizations)
          .where(eq(organizations.email, data.companyEmail));
        if (existingOrg) {
          return res.status(400).json({ success: false, message: "Company email already exists" });
        }
      }

      // Check for existing admin user
      if (data.adminEmail) {
        const [existingUser] = await db.select().from(users)
          .where(eq(users.email, data.adminEmail));
        if (existingUser) {
          return res.status(400).json({ success: false, message: "Admin email already exists" });
        }
      }
      if (data.adminPhone) {
        const [existingUser] = await db.select().from(users)
          .where(eq(users.phone, data.adminPhone));
        if (existingUser) {
          return res.status(400).json({ success: false, message: "Admin phone already exists" });
        }
      }

      // Generate unique slug
      const baseSlug = data.companyName.toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');
      const uniqueSlug = `${baseSlug}-${Date.now().toString(36)}`;

      // Create organization
      const [newOrg] = await db.insert(organizations).values({
        name: data.companyName,
        slug: uniqueSlug,
        email: data.companyEmail,
        phone: data.companyPhone,
        industry: data.industry,
        website: data.website,
        plan: data.plan,
        status: data.autoApprove ? "approved" : "pending",
        isActive: data.autoApprove,
        approvedAt: data.autoApprove ? new Date() : null,
        approvedBy: data.autoApprove ? req.user!.id : null,
      }).returning();

      // Create company admin user
      const normalizedAdminName = data.adminName.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
      const [adminUser] = await db.insert(users).values({
        email: data.adminEmail,
        phone: data.adminPhone,
        username: `${normalizedAdminName || "company_admin"}_${Date.now().toString(36)}`,
        role: "company_admin",
        organizationId: newOrg.id,
      }).returning();

      await db.insert(orgMembers).values({
        organizationId: newOrg.id,
        userId: adminUser.id,
        memberRole: "owner",
      });

      const billing = data.autoApprove
        ? await ensureOrganizationBillingReady(newOrg.id, req.user!.id, toOpeningBalancePaise(data))
        : null;

      // Audit log
      await AuditHelpers.logCreate(
        req.user!.id,
        "organization",
        newOrg.id,
        { 
          companyName: data.companyName, 
          adminUserId: adminUser.id,
          autoApproved: data.autoApprove,
          plan: data.plan,
        }
      );

      logger.info("B2BRoutes", "Company created by Super Admin", {
        companyId: newOrg.id,
        companyName: data.companyName,
        adminUserId: adminUser.id,
        createdBy: req.user!.id,
      });

      res.status(201).json({ 
        success: true, 
        message: `Company "${data.companyName}" created successfully`,
        company: newOrg,
        admin: {
          id: adminUser.id,
          email: adminUser.email,
          phone: adminUser.phone,
          role: adminUser.role,
        },
        billing,
      });
    } catch (err) {
      logger.error("B2BRoutes", "Failed to create company", err as Error);
      res.status(500).json({ success: false, message: "Failed to create company" });
    }
  });

  /**
   * Approve company (Super Admin)
   */
  app.post("/api/admin/companies/:id/approve", requireAuth, requireSuperAdmin, async (req, res) => {
    try {
      const companyId = parseInt(req.params.id);
      
      // Update status
      await db.update(organizations)
        .set({
          status: "approved",
          approvedAt: new Date(),
          approvedBy: req.user!.id,
          isActive: true,
        })
        .where(eq(organizations.id, companyId));

      const billing = await ensureOrganizationBillingReady(companyId, req.user!.id, 0);

      // Audit log
      await AuditHelpers.logCompanyApproval(req.user!.id, companyId, true);

      logger.info("B2BRoutes", "Company approved", {
        companyId,
        approvedBy: req.user!.id,
      });

      res.json({ success: true, message: "Company approved and billing activated", billing });
    } catch (err) {
      logger.error("B2BRoutes", "Failed to approve company", err as Error);
      res.status(500).json({ success: false, message: "Failed to approve company" });
    }
  });

  /**
   * Reject company (Super Admin)
   */
  app.post("/api/admin/companies/:id/reject", requireAuth, requireSuperAdmin, async (req, res) => {
    try {
      const companyId = parseInt(req.params.id);
      const { reason } = req.body;
      
      await db.update(organizations)
        .set({
          status: "rejected",
          rejectedAt: new Date(),
          rejectionReason: reason,
          isActive: false,
        })
        .where(eq(organizations.id, companyId));

      // Audit log
      await AuditHelpers.logCompanyApproval(req.user!.id, companyId, false, reason);

      logger.info("B2BRoutes", "Company rejected", {
        companyId,
        reason,
      });

      res.json({ success: true, message: "Company rejected" });
    } catch (err) {
      logger.error("B2BRoutes", "Failed to reject company", err as Error);
      res.status(500).json({ success: false, message: "Failed to reject company" });
    }
  });

  /**
   * Toggle dummy OTP mode (Super Admin)
   */
  app.post("/api/admin/settings/dummy-otp", requireAuth, requireSuperAdmin, async (req, res) => {
    try {
      const { enabled } = req.body;
      await setDummyOtpMode(enabled, req.user!.id);
      
      res.json({ success: true, message: `Dummy OTP ${enabled ? "enabled" : "disabled"}` });
    } catch (err) {
      logger.error("B2BRoutes", "Failed to toggle dummy OTP", err as Error);
      res.status(500).json({ success: false, message: "Failed to update setting" });
    }
  });

  /**
   * Adjust company wallet balance (Super Admin)
   */
  app.post("/api/admin/companies/:id/credits", requireAuth, requireSuperAdmin, async (req, res) => {
    try {
      const companyId = parseInt(req.params.id);
      const { amount, description } = req.body;

      const amountRupees = Number(amount);
      if (!Number.isFinite(companyId) || companyId <= 0) {
        return res.status(400).json({ success: false, message: "Invalid company ID" });
      }
      if (!Number.isFinite(amountRupees) || amountRupees === 0) {
        return res.status(400).json({ success: false, message: "A non-zero amount is required" });
      }

      const updatedAccount = await BillingEngine.adjustOrganizationBalance({
        organizationId: companyId,
        amountPaise: Math.round(amountRupees * 100),
        type: "manual_adjustment",
        actorUserId: req.user!.id,
        description: description || "Super admin wallet adjustment",
      });

      res.json({
        success: true,
        message: "Wallet balance updated",
        walletBalancePaise: updatedAccount.walletBalancePaise,
        outstandingPostpaidPaise: updatedAccount.outstandingPostpaidPaise,
      });
    } catch (err) {
      logger.error("B2BRoutes", "Failed to adjust wallet", err as Error);
      res.status(500).json({ success: false, message: "Failed to adjust wallet balance" });
    }
  });

  /**
   * Get platform settings (Super Admin)
   */
  app.get("/api/admin/settings", requireAuth, requireSuperAdmin, async (req, res) => {
    try {
      const settings = await db.query.platformSettings.findMany();
      // Convert array to key-value object for easy frontend consumption
      const data: Record<string, any> = {};
      for (const s of settings) {
        try { data[s.key] = JSON.parse(String(s.value)); } catch { data[s.key] = s.value; }
      }
      res.json({ success: true, data, settings });
    } catch (err) {
      logger.error("B2BRoutes", "Failed to fetch settings", err as Error);
      res.status(500).json({ success: false, message: "Failed to fetch settings" });
    }
  });

  app.put("/api/admin/settings", requireAuth, requireSuperAdmin, async (req, res) => {
    try {
      const updates = req.body;
      for (const [key, value] of Object.entries(updates)) {
        const stringValue = typeof value === "string" ? value : JSON.stringify(value);
        const [existing] = await db.select().from(platformSettings).where(eq(platformSettings.key, key));
        if (existing) {
          await db.update(platformSettings)
            .set({ value: stringValue, updatedBy: req.user!.id, updatedAt: new Date() })
            .where(eq(platformSettings.key, key));
        } else {
          await db.insert(platformSettings)
            .values({ key, value: stringValue, description: `Setting: ${key}`, updatedBy: req.user!.id });
        }
      }
      res.json({ success: true, message: "Settings updated" });
    } catch (err) {
      logger.error("B2BRoutes", "Failed to update settings", err as Error);
      res.status(500).json({ success: false, message: "Failed to update settings" });
    }
  });

  // ========================================================================
  // COMPANY ADMIN ROUTES
  // ========================================================================

  /**
   * Get company dashboard data
   */
  app.get("/api/company/dashboard", requireAuth, requireApprovedCompany, async (req, res) => {
    try {
      if (!req.user?.organizationId) {
        return res.status(400).json({ success: false, message: "No company associated" });
      }

      const company = await db.query.organizations.findFirst({
        where: eq(organizations.id, req.user.organizationId),
      });

      const agents = await db.query.orgMembers.findMany({
        where: eq(orgMembers.organizationId, req.user.organizationId),
        with: { user: true },
      });

      const billing = await getOrganizationBillingSnapshot(req.user.organizationId);

      res.json({
        success: true,
        company,
        agents: agents.map(a => ({
          id: a.user.id,
          username: a.user.username,
          email: a.user.email,
          role: a.memberRole,
        })),
        billing,
      });
    } catch (err) {
      logger.error("B2BRoutes", "Failed to fetch dashboard", err as Error);
      res.status(500).json({ success: false, message: "Failed to fetch dashboard" });
    }
  });

  /**
   * Get company team members (agents)
   */
  app.get("/api/company/agents", requireAuth, requireApprovedCompany, async (req, res) => {
    try {
      if (!req.user?.organizationId) {
        return res.status(400).json({ success: false, message: "No company associated" });
      }
      const organizationId = req.user.organizationId;

      res.json({
        success: true,
        agents: await getAgentStatusRows(req.user.organizationId),
      });
    } catch (err) {
      logger.error("B2BRoutes", "Failed to fetch agents", err as Error);
      res.status(500).json({ success: false, message: "Failed to fetch team members" });
    }
  });

  // Alias route for backwards compatibility with /api/b2b prefix
  app.get("/api/b2b/company/agents", requireAuth, requireApprovedCompany, async (req, res) => {
    try {
      if (!req.user?.organizationId) {
        return res.status(400).json({ success: false, message: "No company associated" });
      }

      res.json({
        success: true,
        agents: await getAgentStatusRows(req.user.organizationId),
      });
    } catch (err) {
      logger.error("B2BRoutes", "Failed to fetch agents", err as Error);
      res.status(500).json({ success: false, message: "Failed to fetch team members" });
    }
  });

  /**
   * Add agent to company (main route)
   */
  app.post("/api/company/agents", requireAuth, requireCompanyAdminOrAbove, requireApprovedCompany, async (req, res) => {
    try {
      if (!req.user?.organizationId) {
        return res.status(400).json({ success: false, message: "No company associated" });
      }

      const input = addAgentSchema.parse(req.body);
      
      // Check if email already exists
      if (input.email) {
        const existingUser = await db.query.users.findFirst({
          where: eq(users.email, input.email),
        });
        if (existingUser) {
          return res.status(400).json({ 
            success: false, 
            message: "A user with this email already exists" 
          });
        }
      }
      
      // Create team member with specified role
      const rolePrefix = input.role === "company_admin" ? "admin" : "agent";
      const username = input.name.toLowerCase().replace(/\s+/g, '_') + '_' + Date.now().toString(36);
      
      const [teamMember] = await db.insert(users).values({
        username,
        email: input.email,
        phone: input.phone,
        role: input.role,
        organizationId: req.user.organizationId,
      }).returning();

      // Add to org members with appropriate role
      const memberRole = input.role === "company_admin" ? "admin" : "member";
      await db.insert(orgMembers).values({
        organizationId: req.user.organizationId,
        userId: teamMember.id,
        memberRole,
      });

      logger.info("B2BRoutes", "Team member added", {
        memberId: teamMember.id,
        role: input.role,
        companyId: req.user.organizationId,
      });

      res.status(201).json({
        success: true,
        message: `${input.role === "company_admin" ? "Admin" : "Agent"} added successfully`,
        agent: {
          id: teamMember.id,
          username: teamMember.username,
          email: teamMember.email,
          phone: teamMember.phone,
          role: teamMember.role,
        },
      });
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ success: false, message: err.errors[0].message });
      }
      logger.error("B2BRoutes", "Failed to add agent", err as Error);
      res.status(500).json({ success: false, message: "Failed to add agent" });
    }
  });

  /**
   * Remove agent from company
   */
  app.delete("/api/company/agents/:agentId", requireAuth, requireCompanyAdminOrAbove, requireApprovedCompany, async (req, res) => {
    try {
      if (!req.user?.organizationId) {
        return res.status(400).json({ success: false, message: "No company associated" });
      }

      const agentId = parseInt(req.params.agentId);

      // Verify agent belongs to company
      const agent = await db.query.users.findFirst({
        where: eq(users.id, agentId),
      });

      if (!agent || agent.organizationId !== req.user.organizationId) {
        return res.status(404).json({ success: false, message: "Agent not found" });
      }

      // Remove from org members
      await db.delete(orgMembers).where(
        eq(orgMembers.userId, agentId)
      );

      // Deactivate user
      await db.update(users)
        .set({ isActive: false })
        .where(eq(users.id, agentId));

      res.json({ success: true, message: "Agent removed" });
    } catch (err) {
      logger.error("B2BRoutes", "Failed to remove agent", err as Error);
      res.status(500).json({ success: false, message: "Failed to remove agent" });
    }
  });

  /**
   * Get company wallet ledger
   */
  app.get("/api/company/credits", requireAuth, requireApprovedCompany, async (req, res) => {
    try {
      if (!req.user?.organizationId) {
        return res.status(400).json({ success: false, message: "No company associated" });
      }

      const billing = await getOrganizationBillingSnapshot(req.user.organizationId);
      const ledger = await getOrganizationWalletLedger(req.user.organizationId);

      res.json({
        success: true,
        billing,
        ledger,
      });
    } catch (err) {
      logger.error("B2BRoutes", "Failed to fetch wallet ledger", err as Error);
      res.status(500).json({ success: false, message: "Failed to fetch wallet ledger" });
    }
  });

  /**
   * Get company API key
   */
  app.get("/api/company/api-key", requireAuth, requireApprovedCompany, async (req, res) => {
    try {
      if (!req.user?.organizationId) {
        return res.status(400).json({ success: false, message: "No company associated" });
      }

      const org = await db.query.organizations.findFirst({
        where: eq(organizations.id, req.user.organizationId),
      });

      const settings = (org?.settings as Record<string, any>) || {};
      res.json({
        success: true,
        key: settings.apiKey || null,
      });
    } catch (err) {
      logger.error("B2BRoutes", "Failed to fetch API key", err as Error);
      res.status(500).json({ success: false, message: "Failed to fetch API key" });
    }
  });

  /**
   * Generate new API key
   */
  app.post("/api/company/api-key/generate", requireAuth, requireCompanyAdminOrAbove, requireApprovedCompany, async (req, res) => {
    try {
      if (!req.user?.organizationId) {
        return res.status(400).json({ success: false, message: "No company associated" });
      }

      // Generate a new API key
      const prefix = "ntk_live_";
      const randomPart = Array.from({ length: 32 }, () => 
        "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789".charAt(Math.floor(Math.random() * 62))
      ).join("");
      const newKey = prefix + randomPart;

      // Get current org
      const org = await db.query.organizations.findFirst({
        where: eq(organizations.id, req.user.organizationId),
      });

      // Update org settings with new API key
      const currentSettings = (org?.settings as Record<string, any>) || {};
      await db.update(organizations)
        .set({ 
          settings: { ...currentSettings, apiKey: newKey, apiKeyCreatedAt: new Date().toISOString() } 
        })
        .where(eq(organizations.id, req.user.organizationId));

      // Audit log
      if (req.user) {
        AuditHelpers.logCreate(req.user.id, "api_key", 0, { action: "generated" });
      }

      res.json({
        success: true,
        key: newKey,
        message: "API key generated successfully",
      });
    } catch (err) {
      logger.error("B2BRoutes", "Failed to generate API key", err as Error);
      res.status(500).json({ success: false, message: "Failed to generate API key" });
    }
  });

  /**
   * Get B2B call queue (empty for now - ready for real data)
   */
  app.get("/api/b2b/call-queue", requireAuth, requireApprovedCompany, async (req, res) => {
    try {
      if (!req.user?.organizationId) {
        return res.status(400).json({ success: false, message: "No company associated" });
      }
      const organizationId = req.user.organizationId;

      const pendingCalls = await db.select().from(bridgedCalls)
        .where(eq(bridgedCalls.status, "pending"));

      const participantIds = Array.from(new Set(
        pendingCalls.flatMap((call) => [call.callerUserId, call.receiverUserId]).filter(
          (value): value is number => typeof value === "number" && Number.isFinite(value),
        ),
      ));

      const participants = participantIds.length > 0
        ? await db.select({
            id: users.id,
            organizationId: users.organizationId,
          }).from(users).where(inArray(users.id, participantIds))
        : [];

      const participantOrgMap = new Map(participants.map((participant) => [participant.id, participant.organizationId]));

      const relevantPendingCalls = pendingCalls.filter((call) => {
        const participantOrganizations = [call.callerUserId, call.receiverUserId]
          .map((userId) => (typeof userId === "number" ? participantOrgMap.get(userId) : undefined))
          .filter((organizationId): organizationId is number => typeof organizationId === "number");

        if (participantOrganizations.includes(organizationId)) {
          return true;
        }

        const metadata = (call.metadata as Record<string, unknown> | null) || {};
        const orgCandidates = [
          metadata.organizationId,
          metadata.callerOrganizationId,
          metadata.receiverOrganizationId,
          metadata.companyOrganizationId,
        ];
        return orgCandidates.some((candidateOrganizationId) => Number(candidateOrganizationId) === organizationId);
      });

      const queue = relevantPendingCalls.map((call) => {
        const metadata = (call.metadata as Record<string, unknown> | null) || {};
        const waitTime = call.createdAt ? Math.round((Date.now() - new Date(call.createdAt).getTime()) / 1000) : 0;

        return {
          id: String(call.id),
          customer: call.callerNumber,
          language: call.callerLanguage || "auto",
          waitTime,
          priority: waitTime >= 120 ? "vip" as const : waitTime >= 60 ? "high" as const : "normal" as const,
          type: metadata.direction === "outbound" ? "outbound" as const : "inbound" as const,
        };
      });

      res.json({ success: true, queue });
    } catch (err) {
      logger.error("B2BRoutes", "Failed to fetch call queue", err as Error);
      res.status(500).json({ success: false, message: "Failed to fetch call queue" });
    }
  });

  app.post("/api/b2b/outbound-call", requireAuth, requireApprovedCompany, async (req, res) => {
    try {
      if (!req.user?.organizationId) {
        return res.status(400).json({ success: false, message: "No company associated" });
      }

      const parsed = b2bOutboundCallSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ success: false, message: parsed.error.errors[0]?.message || "Invalid request" });
      }

      const input = parsed.data;
      let actingUser = req.user;

      if (input.agentUserId && input.agentUserId !== req.user.id) {
        const delegatedUser = await storage.getUser(input.agentUserId);
        if (!delegatedUser || delegatedUser.organizationId !== req.user.organizationId) {
          return res.status(404).json({ success: false, message: "Selected agent not found in your company" });
        }
        actingUser = { ...req.user, ...delegatedUser } as any;
      }

      const result = await callService.initiateCall({
        callerId: String(actingUser.id),
        callerUsername: actingUser.username,
        callerDisplayName: actingUser.username || actingUser.email || `Agent ${actingUser.id}`,
        callerNumber: (actingUser as any).phone || "",
        calleeIdentifier: input.calleeIdentifier,
        callerLanguage: input.myLanguage,
        calleeLanguage: input.theirLanguage,
        callerTranslationMode: input.translationMode,
        calleeTranslationMode: input.transportPreference === "app_to_app" ? "subtitles" : "voice",
        callType: input.callType,
        enableLipsync: input.enableLipsync,
        enableRecording: input.enableRecording,
        transportPreference: input.transportPreference,
        organizationIdOverride: req.user.organizationId,
      });

      res.json({
        success: true,
        message: "B2B outbound call initiated",
        call: result,
      });
    } catch (err) {
      logger.error("B2BRoutes", "Failed to start B2B outbound call", err as Error);
      res.status(500).json({ success: false, message: (err as Error)?.message || "Failed to start call" });
    }
  });

  app.post("/api/b2b/call-queue/:id/assign", requireAuth, requireApprovedCompany, async (req, res) => {
    try {
      if (!req.user?.organizationId) {
        return res.status(400).json({ success: false, message: "No company associated" });
      }

      const queueId = Number.parseInt(req.params.id, 10);
      const agentUserId = Number.parseInt(String(req.body?.agentUserId || ""), 10);
      if (!Number.isFinite(queueId) || !Number.isFinite(agentUserId)) {
        return res.status(400).json({ success: false, message: "Queue item and agent are required" });
      }

      const [call] = await db.select().from(bridgedCalls).where(eq(bridgedCalls.id, queueId));
      if (!call) {
        return res.status(404).json({ success: false, message: "Queue item not found" });
      }

      const agent = await storage.getUser(agentUserId);
      if (!agent || agent.organizationId !== req.user.organizationId) {
        return res.status(404).json({ success: false, message: "Agent not found in this company" });
      }

      await db.update(bridgedCalls)
        .set({
          receiverUserId: agent.id,
          receiverNumber: agent.phone || agent.email || agent.username,
          status: "ringing",
          metadata: {
            ...(call.metadata as Record<string, unknown> || {}),
            assignedAgentUserId: agent.id,
            assignedByUserId: req.user.id,
            assignedAt: new Date().toISOString(),
          },
        })
        .where(eq(bridgedCalls.id, queueId));

      res.json({ success: true, message: "Queue item assigned to agent" });
    } catch (err) {
      logger.error("B2BRoutes", "Failed to assign queue item", err as Error);
      res.status(500).json({ success: false, message: "Failed to assign queue item" });
    }
  });

  app.post("/api/b2b/call-queue/:id/auto-route", requireAuth, requireApprovedCompany, async (req, res) => {
    try {
      if (!req.user?.organizationId) {
        return res.status(400).json({ success: false, message: "No company associated" });
      }

      const queueId = Number.parseInt(req.params.id, 10);
      if (!Number.isFinite(queueId)) {
        return res.status(400).json({ success: false, message: "Invalid queue item" });
      }

      const [call] = await db.select().from(bridgedCalls).where(eq(bridgedCalls.id, queueId));
      if (!call) {
        return res.status(404).json({ success: false, message: "Queue item not found" });
      }

      const requiredSkills = [call.callerLanguage || "auto"].filter((value) => value && value !== "auto");
      const agentUserId = await routeToSkillAgent(req.user.organizationId, requiredSkills);
      if (!agentUserId) {
        return res.status(409).json({ success: false, message: "No available agent matched the call language" });
      }

      const agent = await storage.getUser(Number(agentUserId));
      if (!agent) {
        return res.status(404).json({ success: false, message: "Matched agent not found" });
      }

      await db.update(bridgedCalls)
        .set({
          receiverUserId: agent.id,
          receiverNumber: agent.phone || agent.email || agent.username,
          status: "ringing",
          metadata: {
            ...(call.metadata as Record<string, unknown> || {}),
            autoRoutedAgentUserId: agent.id,
            autoRoutedAt: new Date().toISOString(),
            autoRouteSkills: requiredSkills,
          },
        })
        .where(eq(bridgedCalls.id, queueId));

      res.json({ success: true, message: "Call auto-routed", agentUserId: agent.id });
    } catch (err) {
      logger.error("B2BRoutes", "Failed to auto-route queue item", err as Error);
      res.status(500).json({ success: false, message: "Failed to auto-route call" });
    }
  });

  // Real translation route health — checks which services are actually reachable
  app.get("/api/b2b/translation-routes", requireAuth, async (_req, res) => {
    try {
      // Free translation (Lingva) — always available
      res.json({ success: true, ...buildTranslationRouteSnapshot() });
    } catch (err) {
      logger.error("B2BRoutes", "Failed to fetch routes", err as Error);
      res.status(500).json({ success: false, message: "Failed" });
    }
  });

  /**
   * Get B2C current customer (from call context)
   */
  app.get("/api/b2c/current-customer", requireAuth, async (req, res) => {
    try {
      const userId = (req as any).user?.id;
      if (!userId) return res.json({ success: true, customer: null });

      // Return the current user's profile as customer context
      const [user] = await db.select().from(users).where(eq(users.id, userId));
      if (!user) return res.json({ success: true, customer: null });

      // Get call history count
      const callHistory = await db.select().from(bridgedCalls)
        .where(eq(bridgedCalls.callerUserId, userId));

      res.json({
        success: true,
        customer: {
          id: String(user.id),
          name: user.username || user.email?.split("@")[0] || "Customer",
          email: user.email || "",
          phone: user.phone || "",
          language: (user as any).preferredLanguage || "en",
          tier: (user as any).subscriptionTier || "free",
          totalCalls: callHistory.length,
          lastContact: callHistory.length > 0
            ? callHistory[callHistory.length - 1].createdAt?.toISOString() || "Never"
            : "Never",
          notes: "",
          tags: [],
        },
      });
    } catch (err) {
      logger.error("B2BRoutes", "Failed to fetch customer", err as Error);
      res.status(500).json({ success: false, message: "Failed to fetch customer" });
    }
  });

  logger.info("B2BRoutes", "B2B routes registered");
}
