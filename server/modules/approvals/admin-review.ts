/**
 * NeuraTalk's own review of business message templates (super admin), the
 * way Meta reviews WhatsApp templates: every marketing, utility and
 * authentication template is checked here -- including that a "utility"
 * template is not marketing in disguise -- before any business can send it.
 *
 * Also the admins' view of business messaging by category, so marketing,
 * utility and OTP traffic are visible separately per business.
 */
import type { Express, Request, Response } from "express";
import { z } from "zod";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "../../db";
import { approvalRequests, organizations, templates, templateVersions, users, APPROVAL_REQUEST_STATUS } from "@shared/schema";
import { requireAuth, requireSuperAdmin } from "../../role-middleware";
import { logger } from "../../observability";
import { approveRequest, rejectRequest, AlreadyDecidedError, NotFoundError, ValidationError } from "./service";
import { getAccountHealth, setMessagingLimit, MESSAGING_TIERS, type AccountHealth } from "../messaging/account-health";
import { getMessagePrices, setMessagePrices } from "../messaging/pricing";
import { addPolicyAction, listPolicyActions } from "../messaging/policy";
import { sendPushNotification } from "../../firebase-admin";

const TEMPLATE_RESOURCE = "template_version";

async function listReviews(req: Request, res: Response) {
  const status = typeof req.query.status === "string" ? req.query.status : APPROVAL_REQUEST_STATUS.PENDING;
  try {
    const requests = await db.select().from(approvalRequests)
      .where(and(
        eq(approvalRequests.resourceType, TEMPLATE_RESOURCE),
        status === "all" ? undefined : eq(approvalRequests.status, status),
      ))
      .orderBy(desc(approvalRequests.createdAt))
      .limit(200);
    if (requests.length === 0) return res.json({ success: true, reviews: [] });

    const versions = await db.select().from(templateVersions).where(inArray(templateVersions.id, requests.map((r) => r.resourceId)));
    const versionById = new Map(versions.map((v) => [v.id, v]));
    const tpls = versions.length
      ? await db.select().from(templates).where(inArray(templates.id, versions.map((v) => v.templateId)))
      : [];
    const templateById = new Map(tpls.map((t) => [t.id, t]));
    const orgs = await db.select({ id: organizations.id, name: organizations.name, logoUrl: organizations.logoUrl, verifiedAt: organizations.verifiedAt })
      .from(organizations).where(inArray(organizations.id, Array.from(new Set(requests.map((r) => r.businessId)))));
    const orgById = new Map(orgs.map((o) => [o.id, o]));
    const people = await db.select({ id: users.id, displayName: users.displayName, username: users.username, phone: users.phone })
      .from(users).where(inArray(users.id, Array.from(new Set(requests.map((r) => r.requestedBy)))));
    const personById = new Map(people.map((p) => [p.id, p]));

    return res.json({
      success: true,
      reviews: requests.map((r) => {
        const v = versionById.get(r.resourceId);
        const t = v ? templateById.get(v.templateId) : undefined;
        const org = orgById.get(r.businessId);
        const who = personById.get(r.requestedBy);
        return {
          requestId: r.id,
          status: r.status,
          reason: r.reason,
          requestedAt: r.createdAt,
          decidedAt: r.decidedAt,
          business: org ? { id: org.id, name: org.name, logoUrl: org.logoUrl, verified: Boolean(org.verifiedAt) } : { id: r.businessId },
          requestedBy: who ? (who.displayName?.trim() || who.username || who.phone) : null,
          template: t && v ? {
            name: t.name,
            category: t.category,
            language: v.language,
            version: v.versionNumber,
            title: v.title,
            content: v.content,
            variables: v.variables ?? [],
          } : null,
        };
      }),
    });
  } catch (error) {
    logger.error("TemplateReview", "List failed", error as Error);
    return res.status(500).json({ success: false, error: "Could not load template reviews" });
  }
}

async function decide(req: Request, res: Response, approve: boolean) {
  const requestId = Number(req.params.requestId);
  const parsed = z.object({ reason: z.string().trim().max(500).optional() }).safeParse(req.body ?? {});
  if (!Number.isInteger(requestId) || !parsed.success) return res.status(400).json({ success: false, error: "Invalid request" });
  if (!approve && !parsed.data.reason) return res.status(400).json({ success: false, error: "Tell the business why (for example: this is marketing, not utility)" });
  const [request] = await db.select().from(approvalRequests)
    .where(and(eq(approvalRequests.id, requestId), eq(approvalRequests.resourceType, TEMPLATE_RESOURCE)));
  if (!request) return res.status(404).json({ success: false, error: "Review not found" });
  try {
    const result = approve
      ? await approveRequest(request.businessId, req.user!.id, requestId, true)
      : await rejectRequest(request.businessId, req.user!.id, requestId, parsed.data.reason!, true);
    return res.json({ success: true, request: result });
  } catch (error) {
    if (error instanceof AlreadyDecidedError) return res.status(409).json({ success: false, error: error.message });
    if (error instanceof NotFoundError) return res.status(404).json({ success: false, error: error.message });
    if (error instanceof ValidationError) return res.status(400).json({ success: false, error: error.message });
    logger.error("TemplateReview", "Decision failed", error as Error);
    return res.status(500).json({ success: false, error: "Could not save the decision" });
  }
}

/** Per business, last 30 days: messages by category + blocks + pending reviews. */
async function messagingOverview(_req: Request, res: Response) {
  try {
    const result = await db.execute(sql`
      SELECT bc.business_id AS "businessId",
             count(*) FILTER (WHERE m.category = 'marketing')::int AS marketing,
             count(*) FILTER (WHERE m.category = 'utility')::int AS utility,
             count(*) FILTER (WHERE m.category = 'authentication')::int AS otp,
             count(*) FILTER (WHERE m.category = 'conversational')::int AS chat
      FROM messaging_messages m
      JOIN business_conversations bc ON bc.conversation_id = m.conversation_id
      WHERE m.deleted_at IS NULL AND m.created_at >= now() - interval '30 days'
      GROUP BY bc.business_id
    `);
    const blocks = await db.execute(sql`
      SELECT business_id AS "businessId", count(*)::int AS blocked
      FROM customers WHERE blocked_by_customer_at IS NOT NULL GROUP BY business_id
    `);
    const pending = await db.execute(sql`
      SELECT business_id AS "businessId", count(*)::int AS pending
      FROM approval_requests WHERE resource_type = ${TEMPLATE_RESOURCE} AND status = 'pending' GROUP BY business_id
    `);
    const rows = (r: unknown) => ((r as { rows?: Record<string, number>[] }).rows ?? (r as Record<string, number>[]));
    const byBusiness: Record<string, Record<string, number>> = {};
    for (const row of rows(result)) byBusiness[row.businessId] = { marketing: row.marketing, utility: row.utility, otp: row.otp, chat: row.chat, blocked: 0, pendingTemplates: 0 };
    for (const row of rows(blocks)) (byBusiness[row.businessId] ??= { marketing: 0, utility: 0, otp: 0, chat: 0, blocked: 0, pendingTemplates: 0 }).blocked = row.blocked;
    for (const row of rows(pending)) (byBusiness[row.businessId] ??= { marketing: 0, utility: 0, otp: 0, chat: 0, blocked: 0, pendingTemplates: 0 }).pendingTemplates = row.pending;
    // Quality rating + daily limit per business (same numbers the business sees).
    const health: Record<string, AccountHealth> = {};
    for (const businessId of Object.keys(byBusiness)) {
      try {
        const h = await getAccountHealth(Number(businessId));
        if (h) health[businessId] = h;
      } catch { /* one business failing must not hide the rest */ }
    }
    return res.json({ success: true, days: 30, byBusiness, health, tiers: MESSAGING_TIERS });
  } catch (error) {
    logger.error("TemplateReview", "Overview failed", error as Error);
    return res.status(500).json({ success: false, error: "Could not load messaging overview" });
  }
}

export function registerTemplateReviewRoutes(app: Express): void {
  app.get("/api/admin/template-reviews", requireAuth, requireSuperAdmin, listReviews);
  app.post("/api/admin/template-reviews/:requestId/approve", requireAuth, requireSuperAdmin, (req, res) => decide(req, res, true));
  app.post("/api/admin/template-reviews/:requestId/reject", requireAuth, requireSuperAdmin, (req, res) => decide(req, res, false));
  app.get("/api/admin/messaging-overview", requireAuth, requireSuperAdmin, messagingOverview);
  // Business message prices (paise per delivered message).
  app.get("/api/admin/messaging-prices", requireAuth, requireSuperAdmin, async (_req, res) => {
    return res.json({ success: true, prices: await getMessagePrices() });
  });
  app.put("/api/admin/messaging-prices", requireAuth, requireSuperAdmin, async (req, res) => {
    const paise = z.number().int().min(0).max(10_000);
    const parsed = z.object({ marketingPaise: paise, utilityPaise: paise, otpPaise: paise }).safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ success: false, error: "Prices must be whole paise between 0 and 10,000." });
    const prices = await setMessagePrices(parsed.data, req.user!.id);
    logger.info("MessagingPrices", "Business message prices changed", { ...parsed.data, by: req.user!.id });
    return res.json({ success: true, prices });
  });

  // Warnings / restrictions on a business, with history.
  app.get("/api/admin/companies/:id/policy-actions", requireAuth, requireSuperAdmin, async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || id <= 0) return res.status(400).json({ success: false, error: "Invalid company" });
    return res.json({ success: true, actions: await listPolicyActions(id, 50) });
  });
  app.post("/api/admin/companies/:id/policy-actions", requireAuth, requireSuperAdmin, async (req, res) => {
    const id = Number(req.params.id);
    const parsed = z.object({
      action: z.enum(["warning", "restricted", "lifted"]),
      reason: z.string().trim().min(5, "Write the reason the business will see.").max(1000),
      reportId: z.number().int().positive().optional(),
    }).safeParse(req.body ?? {});
    if (!Number.isSafeInteger(id) || id <= 0 || !parsed.success) {
      return res.status(400).json({ success: false, error: parsed.success ? "Invalid company" : parsed.error.issues[0]?.message });
    }
    const [org] = await db.select({ id: organizations.id, name: organizations.name }).from(organizations).where(eq(organizations.id, id));
    if (!org) return res.status(404).json({ success: false, error: "Company not found" });
    const action = await addPolicyAction(id, parsed.data.action, parsed.data.reason, req.user!.id, parsed.data.reportId);
    logger.info("MessagingPolicy", "Policy action on business", { businessId: id, action: action.action, by: req.user!.id });
    // Tell the business's admins right away.
    const admins = await db.select({ id: users.id }).from(users)
      .where(and(eq(users.organizationId, id), eq(users.role, "company_admin")));
    const title = action.action === "warning" ? "Warning from NeuraTalk"
      : action.action === "restricted" ? "NeuraTalk paused your campaigns" : "Your campaigns can run again";
    for (const admin of admins) {
      sendPushNotification(admin.id, { title, body: action.reason, data: { type: "business_notice", businessId: String(id) } }).catch(() => {});
    }
    return res.json({ success: true, action, health: await getAccountHealth(id) });
  });

  app.get("/api/admin/companies/:id/messaging-health", requireAuth, requireSuperAdmin, async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || id <= 0) return res.status(400).json({ success: false, error: "Invalid company" });
    const health = await getAccountHealth(id).catch(() => null);
    if (!health) return res.status(404).json({ success: false, error: "Company not found" });
    return res.json({ success: true, health, tiers: MESSAGING_TIERS });
  });
  app.patch("/api/admin/companies/:id/messaging-limit", requireAuth, requireSuperAdmin, async (req, res) => {
    const id = Number(req.params.id);
    const parsed = z.object({ tier: z.number().int(), pinned: z.boolean().default(true) }).safeParse(req.body ?? {});
    if (!Number.isSafeInteger(id) || id <= 0 || !parsed.success || !(MESSAGING_TIERS as readonly number[]).includes(parsed.data.tier)) {
      return res.status(400).json({ success: false, error: `Limit must be one of ${MESSAGING_TIERS.join(", ")}` });
    }
    const [org] = await db.select({ id: organizations.id }).from(organizations).where(eq(organizations.id, id));
    if (!org) return res.status(404).json({ success: false, error: "Company not found" });
    try {
      const limit = await setMessagingLimit(id, parsed.data.tier, parsed.data.pinned);
      logger.info("MessagingHealth", "Messaging limit set by admin", { businessId: id, tier: limit.tier, pinned: limit.pinned, by: req.user?.id });
      return res.json({ success: true, limit, health: await getAccountHealth(id) });
    } catch (error) {
      logger.error("MessagingHealth", "Set messaging limit failed", error as Error);
      return res.status(500).json({ success: false, error: "Could not change the limit" });
    }
  });
}
