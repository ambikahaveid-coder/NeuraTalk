/**
 * NeuraTalk Business app (WhatsApp-Business style, entirely inside
 * NeuraTalk -- no WhatsApp/Meta involved):
 *  - a person creates their business right in the app (self-signup)
 *  - business account summary: profile, link, verified-tick status
 *  - ask NeuraTalk to verify the business (super admin grants the tick)
 *  - start a chat with any customer by phone number
 *  - chat labels ("New order", "Paid", ...)
 *  - message statistics
 *  - customers can block a business from their NeuraTalk app
 */
import type { Express, Request, Response } from "express";
import { z } from "zod";
import { and, eq, gte, sql } from "drizzle-orm";
import { db } from "../../db";
import {
  businessConversations,
  customers,
  organizations,
  orgMembers,
  personalChatThreads,
  callBillingRecords,
  users,
  USER_ROLES,
  PERMISSIONS,
} from "@shared/schema";
import { requireAuth, requireCompanyAccess, requirePermission, requireRole } from "../../role-middleware";
import { AuditHelpers } from "../../audit";
import { logger } from "../../observability";
import { normalizePhoneForIndia } from "@shared/phone";
import { createCustomer, DuplicateCustomerError, ValidationError as CustomerValidationError } from "../customers/service";
import { findOrCreateCustomerConversation, sendBusinessAgentMessage } from "../messaging/service";
import { BUSINESS_MESSAGING_SETTINGS_KEY, businessMessagingSettingsSchema } from "../messaging/business-directory";

const businessIdOf = (req: Request) => Number(req.params.businessId);

// ---------------------------------------------------------------------------
// Self-signup
// ---------------------------------------------------------------------------

export const BUSINESS_CATEGORIES = [
  "Shopping & retail", "Food & restaurant", "Grocery", "Clothing & fashion", "Beauty, spa & salon",
  "Health & medical", "Education", "Automotive", "Travel & transport", "Hotel & lodging",
  "Finance & banking", "Professional services", "Real estate", "Home services", "Electronics",
  "Event planning", "Entertainment", "Non-profit", "Public service", "Other",
] as const;

const selfSignupSchema = z.object({
  name: z.string().trim().min(2, "Business name is too short").max(80),
  category: z.string().trim().min(2).max(60),
  description: z.string().trim().max(500).optional(),
  city: z.string().trim().max(80).optional(),
  address: z.string().trim().max(300).optional(),
  email: z.string().trim().email().max(255).optional().or(z.literal("")),
  website: z.string().trim().url().max(300).optional().or(z.literal("")),
});

/**
 * Like WhatsApp Business, a business uses its own number. A number that is
 * already someone's personal NeuraTalk (chats or calls) stays personal --
 * turning it into a business would bill that person's personal calls to the
 * business and mix their chats with customers.
 */
async function hasPersonalHistory(userId: number): Promise<boolean> {
  const [chat] = await db.select({ id: personalChatThreads.id }).from(personalChatThreads)
    .where(sql`${personalChatThreads.participantAUserId} = ${userId} OR ${personalChatThreads.participantBUserId} = ${userId}`)
    .limit(1);
  if (chat) return true;
  const [call] = await db.select({ id: callBillingRecords.id }).from(callBillingRecords)
    .where(eq(callBillingRecords.userId, userId)).limit(1);
  return Boolean(call);
}

function slugBase(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "business";
}

async function selfSignup(req: Request, res: Response) {
  const parsed = selfSignupSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ success: false, error: parsed.error.errors[0]?.message ?? "Check the details" });
  const input = parsed.data;
  const user = req.user!;

  if (user.organizationId) {
    return res.status(409).json({ success: false, code: "ALREADY_A_BUSINESS", error: "This number already belongs to a business on NeuraTalk." });
  }
  if (user.role !== USER_ROLES.CONSUMER) {
    return res.status(409).json({ success: false, code: "NOT_ALLOWED", error: "This account can't create a business." });
  }
  if (await hasPersonalHistory(user.id)) {
    return res.status(409).json({
      success: false,
      code: "PERSONAL_NUMBER",
      error: "This number is your personal NeuraTalk (it has chats or calls). Like WhatsApp Business, a business needs its own number — log in to NeuraTalk Business with your business number.",
    });
  }

  try {
    const settings = {
      [BUSINESS_MESSAGING_SETTINGS_KEY]: businessMessagingSettingsSchema.parse({}),
      selfServe: { source: "business_app", createdAt: new Date().toISOString(), createdBy: user.id },
    };
    const business = await db.transaction(async (tx) => {
      const [org] = await tx.insert(organizations).values({
        name: input.name,
        slug: `${slugBase(input.name)}-${Date.now().toString(36)}`,
        industry: input.category,
        description: input.description || null,
        addressCity: input.city || null,
        address: input.address || null,
        email: input.email || null,
        website: input.website || null,
        phone: user.phone ?? null,
        plan: "free",
        // Operates straight away (like WhatsApp Business); the blue tick is
        // separate and only a super admin grants it.
        status: "approved",
        isActive: true,
        approvedAt: new Date(),
        approvedBy: null,
        settings,
      }).returning();
      await tx.update(users).set({ role: USER_ROLES.COMPANY_ADMIN, organizationId: org.id }).where(eq(users.id, user.id));
      // The owner gets the whole Business toolset straight away (customers,
      // audiences, templates, campaigns, codes) -- what "Turn on" grants on
      // the web; there is nobody else to switch it on for them.
      const { GRANTABLE_BUSINESS_PERMISSIONS } = await import("../../business-rbac-routes");
      await tx.insert(orgMembers).values({ organizationId: org.id, userId: user.id, memberRole: "owner", permissions: GRANTABLE_BUSINESS_PERMISSIONS });
      return org;
    });

    try {
      const { ensureOrganizationBillingReady } = await import("../../b2b-routes");
      await ensureOrganizationBillingReady(business.id, user.id, 0);
    } catch (error) {
      logger.warn("BusinessApp", `billing setup for business ${business.id} deferred: ${String(error)}`);
    }
    await AuditHelpers.logCreate(user.id, "organization", business.id, { name: business.name, selfServe: true }).catch(() => undefined);
    logger.info("BusinessApp", "Business created in the app", { businessId: business.id, userId: user.id });

    return res.status(201).json({ success: true, business: { id: business.id, name: business.name, slug: business.slug } });
  } catch (error) {
    logger.error("BusinessApp", "Self-signup failed", error as Error);
    return res.status(500).json({ success: false, error: "Could not create the business. Please try again." });
  }
}

// ---------------------------------------------------------------------------
// Account summary + verification request
// ---------------------------------------------------------------------------

async function getAccount(req: Request, res: Response) {
  const businessId = businessIdOf(req);
  const [org] = await db.select().from(organizations).where(eq(organizations.id, businessId));
  if (!org) return res.status(404).json({ success: false, error: "Business not found" });
  const selfServe = Boolean((org.settings as Record<string, unknown> | null)?.selfServe);
  return res.json({
    success: true,
    business: {
      id: org.id,
      name: org.name,
      slug: org.slug,
      logoUrl: org.logoUrl,
      category: org.industry,
      description: org.description,
      address: org.address,
      city: org.addressCity,
      email: org.email,
      website: org.website,
      phone: org.phone,
      status: org.status,
      verified: Boolean(org.verifiedAt),
      verifiedAt: org.verifiedAt,
      verificationRequestedAt: org.verificationRequestedAt,
      selfServe,
      link: `https://neuratalk.in/b/${org.slug}`,
    },
    categories: BUSINESS_CATEGORIES,
  });
}

async function requestVerification(req: Request, res: Response) {
  const businessId = businessIdOf(req);
  const [org] = await db.select().from(organizations).where(eq(organizations.id, businessId));
  if (!org) return res.status(404).json({ success: false, error: "Business not found" });
  if (org.verifiedAt) return res.json({ success: true, verified: true });
  // A real check needs something to check: a logo and a description.
  if (!org.logoUrl || !org.description?.trim()) {
    return res.status(400).json({ success: false, error: "Add your logo and a short description first, so NeuraTalk can check your business." });
  }
  const [updated] = await db.update(organizations).set({ verificationRequestedAt: new Date() })
    .where(eq(organizations.id, businessId)).returning({ at: organizations.verificationRequestedAt });
  await AuditHelpers.logSettingsChange(req.user!.id, `business_verification_request:${businessId}`, {}, { requested: true }).catch(() => undefined);
  return res.json({ success: true, verified: false, verificationRequestedAt: updated?.at ?? null });
}

// ---------------------------------------------------------------------------
// Start a chat with a customer by phone number
// ---------------------------------------------------------------------------

const startChatSchema = z.object({
  phone: z.string().trim().min(6).max(20),
  name: z.string().trim().max(120).optional(),
  message: z.string().trim().min(1, "Write a message").max(4096),
});

/** New chats a business may start per day (spam brake; customers can block). */
const DAILY_NEW_CHAT_LIMIT = 200;

async function startChat(req: Request, res: Response) {
  const businessId = businessIdOf(req);
  const parsed = startChatSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ success: false, error: parsed.error.errors[0]?.message ?? "Check the number" });
  const normalized = normalizePhoneForIndia(parsed.data.phone);
  if (!normalized || normalized.replace(/\D/g, "").length < 10) {
    return res.status(400).json({ success: false, error: "Enter a valid mobile number" });
  }

  try {
    let customerId: number;
    try {
      const created = await createCustomer(businessId, req.user!.id, { phone: normalized, name: parsed.data.name || undefined });
      customerId = created.id;
    } catch (error) {
      if (error instanceof DuplicateCustomerError) customerId = error.existingCustomerId;
      else if (error instanceof CustomerValidationError) return res.status(400).json({ success: false, error: error.message });
      else throw error;
    }

    const [customer] = await db.select().from(customers).where(and(eq(customers.id, customerId), eq(customers.businessId, businessId)));
    if (!customer) return res.status(404).json({ success: false, error: "Customer not found" });

    const [existingChat] = await db.select({ id: businessConversations.id }).from(businessConversations)
      .where(and(eq(businessConversations.businessId, businessId), eq(businessConversations.customerId, customerId)));
    if (!existingChat) {
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const [today] = await db.select({ count: sql<number>`count(*)::int` }).from(businessConversations)
        .where(and(eq(businessConversations.businessId, businessId), gte(businessConversations.createdAt, since)));
      if ((today?.count ?? 0) >= DAILY_NEW_CHAT_LIMIT) {
        return res.status(429).json({ success: false, error: "You have started many new chats today. Try again tomorrow." });
      }
    }

    const businessConversationId = existingChat?.id
      ?? (await db.transaction((tx) => findOrCreateCustomerConversation(tx, businessId, customerId))).businessConversation.id;

    const sent = await sendBusinessAgentMessage({
      businessId,
      businessConversationId,
      authenticatedUserId: req.user!.id,
      content: parsed.data.message,
    });

    return res.status(201).json({
      success: true,
      conversationId: businessConversationId,
      messageId: sent.message.id,
      // Not on NeuraTalk (yet): the message waits; the app offers an invite.
      onNeuraTalk: Boolean(customer.linkedUserId),
      blocked: Boolean(customer.blockedByCustomerAt),
    });
  } catch (error) {
    logger.error("BusinessApp", "Start chat failed", error as Error);
    return res.status(500).json({ success: false, error: "Could not start the chat. Try again." });
  }
}

// ---------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------

const labelsSchema = z.object({ labels: z.array(z.string().trim().min(1).max(24)).max(5) });

async function setLabels(req: Request, res: Response) {
  const businessId = businessIdOf(req);
  const id = Number(req.params.id);
  const parsed = labelsSchema.safeParse(req.body ?? {});
  if (!parsed.success || !Number.isInteger(id)) return res.status(400).json({ success: false, error: "Up to 5 short labels" });
  const labels = Array.from(new Set(parsed.data.labels));
  const [updated] = await db.update(businessConversations).set({ labels })
    .where(and(eq(businessConversations.id, id), eq(businessConversations.businessId, businessId)))
    .returning({ id: businessConversations.id, labels: businessConversations.labels });
  if (!updated) return res.status(404).json({ success: false, error: "Chat not found" });
  return res.json({ success: true, labels: updated.labels ?? [] });
}

// ---------------------------------------------------------------------------
// Statistics (last 30 days)
// ---------------------------------------------------------------------------

async function getStats(req: Request, res: Response) {
  const businessId = businessIdOf(req);
  const days = 30;
  try {
    const result = await db.execute(sql`
      WITH conv AS (
        SELECT conversation_id FROM business_conversations WHERE business_id = ${businessId}
      ),
      msgs AS (
        SELECT m.id,
               (p.participant_type = 'customer' OR (p.participant_type = 'user' AND p.role = 'customer')) AS from_customer
        FROM messaging_messages m
        JOIN messaging_participants p ON p.id = m.sender_participant_id
        WHERE m.conversation_id IN (SELECT conversation_id FROM conv)
          AND m.deleted_at IS NULL
          AND m.created_at >= now() - make_interval(days => ${days})
      ),
      to_customer AS (
        SELECT d.status
        FROM messaging_deliveries d
        JOIN messaging_participants p ON p.id = d.participant_id
        WHERE d.message_id IN (SELECT id FROM msgs WHERE NOT from_customer)
          AND (p.participant_type = 'customer' OR (p.participant_type = 'user' AND p.role = 'customer'))
      )
      SELECT
        (SELECT count(*)::int FROM msgs WHERE NOT from_customer) AS sent,
        (SELECT count(*)::int FROM to_customer WHERE status IN ('delivered', 'read')) AS delivered,
        (SELECT count(*)::int FROM to_customer WHERE status = 'read') AS read,
        (SELECT count(*)::int FROM msgs WHERE from_customer) AS received,
        (SELECT count(*)::int FROM business_conversations WHERE business_id = ${businessId}) AS chats
    `);
    const row = ((result as unknown as { rows?: Record<string, number>[] }).rows ?? (result as unknown as Record<string, number>[]))[0] ?? {};
    return res.json({ success: true, days, stats: {
      sent: Number(row.sent ?? 0), delivered: Number(row.delivered ?? 0), read: Number(row.read ?? 0),
      received: Number(row.received ?? 0), chats: Number(row.chats ?? 0),
    } });
  } catch (error) {
    logger.error("BusinessApp", "Stats failed", error as Error);
    return res.status(500).json({ success: false, error: "Could not load statistics" });
  }
}

// ---------------------------------------------------------------------------
// Customer: block / unblock a business
// ---------------------------------------------------------------------------

const blockSchema = z.object({ blocked: z.boolean() });

async function setBlocked(req: Request, res: Response) {
  const businessId = businessIdOf(req);
  const parsed = blockSchema.safeParse(req.body ?? {});
  if (!parsed.success || !Number.isInteger(businessId)) return res.status(400).json({ success: false, error: "Invalid request" });
  const [updated] = await db.update(customers)
    .set({ blockedByCustomerAt: parsed.data.blocked ? new Date() : null, updatedAt: new Date() })
    .where(and(eq(customers.businessId, businessId), eq(customers.linkedUserId, req.user!.id)))
    .returning({ id: customers.id });
  if (!updated) return res.status(404).json({ success: false, error: "You have no chat with this business" });
  logger.info("BusinessApp", parsed.data.blocked ? "Customer blocked a business" : "Customer unblocked a business", { businessId, userId: req.user!.id });
  return res.json({ success: true, blocked: parsed.data.blocked });
}

/** Has this person blocked this business? (for the send path) */
export async function isBusinessBlockedByUser(businessId: number, userId: number): Promise<boolean> {
  const [row] = await db.select({ blockedAt: customers.blockedByCustomerAt }).from(customers)
    .where(and(eq(customers.businessId, businessId), eq(customers.linkedUserId, userId)));
  return Boolean(row?.blockedAt);
}

export function registerBusinessAppRoutes(app: Express): void {
  app.post("/api/business/self-signup", requireAuth, selfSignup);
  app.get("/api/business/categories", requireAuth, (_req, res) => res.json({ success: true, categories: BUSINESS_CATEGORIES }));

  app.get("/api/business/:businessId/account", requireAuth, requireCompanyAccess("businessId"), getAccount);
  app.post("/api/business/:businessId/verification-request", requireAuth, requireCompanyAccess("businessId"), requireRole("company_admin", "super_admin"), requestVerification);

  app.post("/api/business/:businessId/chats", requireAuth, requireCompanyAccess("businessId"), requirePermission(PERMISSIONS.MESSAGING_SEND), startChat);
  app.patch("/api/business/:businessId/conversations/:id/labels", requireAuth, requireCompanyAccess("businessId"), requirePermission(PERMISSIONS.MESSAGING_SEND), setLabels);
  app.get("/api/business/:businessId/messaging-stats", requireAuth, requireCompanyAccess("businessId"), requirePermission(PERMISSIONS.MESSAGING_VIEW), getStats);

  app.put("/api/messaging/business/:businessId/block", requireAuth, setBlocked);
}

export { hasPersonalHistory };
