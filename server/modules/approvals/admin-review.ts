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
    return res.json({ success: true, days: 30, byBusiness });
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
}
