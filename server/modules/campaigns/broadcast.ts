/**
 * Broadcasts from the Business app: the same campaign engine the website
 * uses (templates reviewed by NeuraTalk, audiences, approvals, consent,
 * frequency caps, daily limit, billing), reduced to three simple calls:
 *
 *   GET  /api/business/:id/broadcast-templates   my templates + review status
 *   POST /api/business/:id/broadcast-templates   write one, send for review
 *   GET  /api/business/:id/broadcasts            recent broadcasts + results
 *   POST /api/business/:id/broadcasts            send an approved template
 *                                                to all my customers
 *
 * Nothing here bypasses a rule: each step calls the existing services.
 */
import type { Express, NextFunction, Request, Response } from "express";
import { logger } from "../../observability";
import { z } from "zod";
import { and, desc, eq, inArray, isNotNull } from "drizzle-orm";
import { db } from "../../db";
import {
  campaigns, customers, templates, templateVersions, approvalRequests,
  CUSTOMER_STATUS, TEMPLATE_VERSION_STATUS, PERMISSIONS, CAMPAIGN_STATUS, APPROVAL_REQUEST_STATUS,
} from "@shared/schema";
import { requireAuth, requireCompanyAccess, requirePermission, requireAnyPermission } from "../../role-middleware";
import { createTemplate, createOrEditDraftVersion } from "../templates/service";
import { createAudience, addMember } from "../audiences/service";
import { cancelCampaign, createCampaign, updateCampaign, executeCampaign, getCampaignReport, scheduleCampaign } from "./service";
import { createApprovalRequest, approveRequest } from "../approvals/service";
import { messageButtonsSchema, prepareTemplateMedia, TemplateSendError, templateButtons, templateFooterSchema, templateHeaderSchema } from "../messaging/template-send";

const CATEGORIES = ["marketing", "utility"] as const;

function variablesFrom(content: string) {
  const names = Array.from(new Set(Array.from(content.matchAll(/\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g)).map((m) => m[1])));
  // {{name}} is filled from the customer record.
  return names.map((name) => ({ name, type: "text" as const, required: name !== "name" }));
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : "Something went wrong";
}

// Bad ids get a 400, and any error becomes a JSON reply -- an error thrown
// inside an async handler must never reach the process (it would crash it).
function validIds(req: Request, res: Response, next: NextFunction) {
  for (const key of ["businessId", "campaignId"]) {
    const value = req.params[key];
    if (value !== undefined && !(Number.isSafeInteger(Number(value)) && Number(value) > 0)) {
      return res.status(400).json({ success: false, error: "Invalid id." });
    }
  }
  next();
}
type Handler = (req: Request, res: Response, next: NextFunction) => unknown;
function safe(handler: Handler): Handler {
  return async (req, res, next) => {
    try {
      await handler(req, res, next);
    } catch (err) {
      logger.error("Broadcasts", "Request failed", err as Error);
      if (!res.headersSent) res.status(500).json({ success: false, error: "Something went wrong. Try again." });
    }
  };
}

export function registerBroadcastRoutes(expressApp: Express): void {
  const app = {
    get: (path: string, ...handlers: Handler[]) => expressApp.get(path, validIds, ...handlers.map(safe)),
    post: (path: string, ...handlers: Handler[]) => expressApp.post(path, validIds, ...handlers.map(safe)),
  };
  const manage = [requireAuth, requireCompanyAccess("businessId"), requirePermission(PERMISSIONS.CAMPAIGNS_MANAGE)];
  // Approving and running a broadcast is the "execute" authority.
  const execute = [requireAuth, requireCompanyAccess("businessId"), requirePermission(PERMISSIONS.CAMPAIGNS_EXECUTE)];
  const send = [...manage, requirePermission(PERMISSIONS.CAMPAIGNS_EXECUTE)];
  const view = [requireAuth, requireCompanyAccess("businessId"), requireAnyPermission(PERMISSIONS.CAMPAIGNS_MANAGE, PERMISSIONS.CAMPAIGNS_EXECUTE, PERMISSIONS.CAMPAIGNS_VIEW)];

  // My templates with the latest version's review status.
  app.get("/api/business/:businessId/broadcast-templates", ...view, async (req: Request, res: Response) => {
    const businessId = Number(req.params.businessId);
    const tpls = await db.select().from(templates).where(eq(templates.businessId, businessId)).orderBy(desc(templates.createdAt)).limit(50);
    const versions = tpls.length
      ? await db.select().from(templateVersions).where(inArray(templateVersions.templateId, tpls.map((t) => t.id))).orderBy(desc(templateVersions.versionNumber))
      : [];
    const pending = versions.length
      ? await db.select({ resourceId: approvalRequests.resourceId, status: approvalRequests.status, reason: approvalRequests.reason })
          .from(approvalRequests)
          .where(and(eq(approvalRequests.resourceType, "template_version"), inArray(approvalRequests.resourceId, versions.map((v) => v.id))))
          .orderBy(desc(approvalRequests.createdAt))
      : [];
    const items = tpls.map((t) => {
      const latest = versions.find((v) => v.templateId === t.id);
      const review = latest ? pending.find((p) => p.resourceId === latest.id) : undefined;
      return {
        templateId: t.id,
        name: t.name,
        category: t.category,
        versionId: latest?.id ?? null,
        status: latest?.status ?? "draft",
        content: latest?.content ?? "",
        mediaType: latest?.mediaType ?? null,
        mediaUrl: latest?.mediaUrl ?? null,
        buttons: latest ? templateButtons(latest) : [],
        header: ((latest?.metadata ?? {}) as { header?: string }).header ?? null,
        footer: ((latest?.metadata ?? {}) as { footer?: string }).footer ?? null,
        rejectionReason: review?.status === "rejected" ? review.reason : null,
      };
    });
    return res.json({ success: true, templates: items });
  });

  // Write a template and send it to NeuraTalk for review.
  app.post("/api/business/:businessId/broadcast-templates", ...manage, async (req: Request, res: Response) => {
    const businessId = Number(req.params.businessId);
    const parsed = z.object({
      name: z.string().trim().min(2).max(60),
      category: z.enum(CATEGORIES),
      content: z.string().trim().min(5).max(1024),
      // Optional photo / video / PDF uploaded to NeuraTalk, reviewed with the text.
      mediaUrl: z.string().trim().max(2000).optional(),
      // Up to 3 buttons (quick reply / website / call), reviewed with the text.
      buttons: messageButtonsSchema.optional(),
      header: templateHeaderSchema,
      footer: templateFooterSchema,
    }).safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ success: false, error: parsed.error.issues[0]?.message ?? "Check the template" });
    try {
      const media = parsed.data.mediaUrl ? await prepareTemplateMedia(req.user!.id, parsed.data.mediaUrl) : null;
      const slug = parsed.data.name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 40) || "template";
      const template = await createTemplate(businessId, req.user!.id, { name: `${slug}_${Date.now().toString(36)}`, category: parsed.data.category });
      const version = await createOrEditDraftVersion(businessId, req.user!.id, template.id, {
        language: "en",
        title: parsed.data.name,
        content: parsed.data.content,
        variables: variablesFrom(parsed.data.content) as any,
        mediaType: media?.mediaType,
        mediaUrl: media?.mediaUrl,
      });
      const extras: Record<string, unknown> = {};
      if (parsed.data.buttons?.length) extras.buttons = parsed.data.buttons;
      if (parsed.data.header) extras.header = parsed.data.header;
      if (parsed.data.footer) extras.footer = parsed.data.footer;
      if (Object.keys(extras).length) {
        await db.update(templateVersions)
          .set({ metadata: extras })
          .where(eq(templateVersions.id, (version as { id: number }).id));
      }
      const request = await createApprovalRequest(businessId, req.user!.id, "template_version", (version as { id: number }).id);
      return res.status(201).json({ success: true, templateId: template.id, versionId: (version as { id: number }).id, review: request.status });
    } catch (err) {
      if ((err as Error)?.name === TemplateSendError.name) return res.status((err as TemplateSendError).status).json({ success: false, error: (err as Error).message });
      return res.status(400).json({ success: false, error: message(err) });
    }
  });

  // Recent broadcasts with sent / delivered / read.
  app.get("/api/business/:businessId/broadcasts", ...view, async (req: Request, res: Response) => {
    const businessId = Number(req.params.businessId);
    const list = await db.select().from(campaigns).where(eq(campaigns.businessId, businessId)).orderBy(desc(campaigns.createdAt)).limit(20);
    const requests = list.length
      ? await db.select().from(approvalRequests)
          .where(and(eq(approvalRequests.businessId, businessId), eq(approvalRequests.resourceType, "campaign"), inArray(approvalRequests.resourceId, list.map((c) => c.id))))
          .orderBy(desc(approvalRequests.createdAt))
      : [];
    const out = [];
    for (const c of list) {
      let report: unknown = null;
      if (c.status !== CAMPAIGN_STATUS.DRAFT) {
        try { report = await getCampaignReport(businessId, c.id); } catch { /* not started */ }
      }
      const request = requests.find((r) => r.resourceId === c.id);
      out.push({
        id: c.id, name: c.name, category: c.category, status: c.status, createdAt: c.createdAt, failureReason: c.failureReason, report,
        scheduledAt: c.scheduledAt,
        approval: request ? { status: request.status, requestedByMe: request.requestedBy === req.user!.id, reason: request.reason } : null,
      });
    }
    return res.json({ success: true, broadcasts: out });
  });

  // Send an approved template to all my customers on NeuraTalk.
  app.post("/api/business/:businessId/broadcasts", ...send, async (req: Request, res: Response) => {
    const businessId = Number(req.params.businessId);
    const actor = req.user!.id;
    const parsed = z.object({
      versionId: z.number().int().positive(),
      name: z.string().trim().max(80).optional(),
      // Send later: a time from 5 minutes to 30 days ahead.
      scheduledAt: z.string().datetime({ offset: true }).optional(),
    }).safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ success: false, error: "Pick a template." });
    const scheduledAt = parsed.data.scheduledAt ? new Date(parsed.data.scheduledAt) : null;
    if (scheduledAt) {
      const ahead = scheduledAt.getTime() - Date.now();
      if (ahead < 5 * 60 * 1000 || ahead > 30 * 24 * 60 * 60 * 1000) {
        return res.status(400).json({ success: false, error: "Pick a time between 5 minutes and 30 days from now." });
      }
    }
    try {
      const [version] = await db.select().from(templateVersions).where(eq(templateVersions.id, parsed.data.versionId));
      const [template] = version ? await db.select().from(templates).where(eq(templates.id, version.templateId)) : [];
      if (!version || !template || template.businessId !== businessId) return res.status(404).json({ success: false, error: "Template not found." });
      if (version.status !== TEMPLATE_VERSION_STATUS.APPROVED) {
        return res.status(400).json({ success: false, error: "NeuraTalk hasn't approved this template yet." });
      }

      // Everyone who is on NeuraTalk; consent, blocks and limits are checked at send time.
      const people = await db.select({ id: customers.id }).from(customers)
        .where(and(eq(customers.businessId, businessId), eq(customers.status, CUSTOMER_STATUS.ACTIVE), isNotNull(customers.linkedUserId)));
      if (people.length === 0) return res.status(400).json({ success: false, error: "You have no customers on NeuraTalk yet." });

      const label = parsed.data.name || `${template.category === "marketing" ? "Offer" : "Update"} · ${new Date().toLocaleDateString("en-IN")}`;
      const audience = await createAudience(businessId, actor, { name: `${label} (${Date.now().toString(36)})` });
      for (const p of people) await addMember(businessId, actor, (audience as { id: number }).id, p.id);

      const campaign = await createCampaign(businessId, actor, { name: label, category: template.category });
      await updateCampaign(businessId, actor, campaign.id, { templateVersionId: version.id, audienceId: (audience as { id: number }).id });
      // The wanted time is kept on the draft; it becomes a real schedule once approved.
      if (scheduledAt) await db.update(campaigns).set({ scheduledAt }).where(eq(campaigns.id, campaign.id));

      const request = await createApprovalRequest(businessId, actor, "campaign", campaign.id);
      let approved = false;
      try {
        await approveRequest(businessId, actor, request.id, false);
        approved = true;
      } catch {
        // Needs a second admin of this business (the usual two-person rule).
      }
      if (!approved) {
        return res.status(202).json({ success: true, campaignId: campaign.id, status: "waiting_for_approval", recipients: people.length, scheduledAt,
          message: "Another admin of your business needs to approve this broadcast before it is sent." });
      }
      const outcome = await sendOrSchedule(businessId, actor, campaign.id);
      return res.json({ success: true, campaignId: campaign.id, recipients: people.length, ...outcome });
    } catch (err) {
      return res.status(400).json({ success: false, error: message(err) });
    }
  });

  type Found =
    | { error: string; status: number }
    | { campaign: typeof campaigns.$inferSelect; request: typeof approvalRequests.$inferSelect | undefined };
  async function draftCampaign(businessId: number, campaignId: number): Promise<Found> {
    const [campaign] = await db.select().from(campaigns).where(and(eq(campaigns.id, campaignId), eq(campaigns.businessId, businessId)));
    if (!campaign) return { error: "Broadcast not found.", status: 404 };
    if (campaign.status !== CAMPAIGN_STATUS.DRAFT) return { error: "This broadcast was already sent.", status: 409 };
    const [request] = await db.select().from(approvalRequests)
      .where(and(eq(approvalRequests.businessId, businessId), eq(approvalRequests.resourceType, "campaign"), eq(approvalRequests.resourceId, campaignId)))
      .orderBy(desc(approvalRequests.createdAt)).limit(1);
    return { campaign, request };
  }

  // A second admin approves a waiting broadcast; it is sent right away.
  app.post("/api/business/:businessId/broadcasts/:campaignId/approve", ...execute, async (req: Request, res: Response) => {
    const businessId = Number(req.params.businessId);
    const found = await draftCampaign(businessId, Number(req.params.campaignId));
    if ("error" in found) return res.status(found.status).json({ success: false, error: found.error });
    if (!found.request || found.request.status !== APPROVAL_REQUEST_STATUS.PENDING) {
      return res.status(409).json({ success: false, error: "Nothing waiting for approval." });
    }
    try {
      await approveRequest(businessId, req.user!.id, found.request.id, false);
      return res.json({ success: true, ...(await sendOrSchedule(businessId, req.user!.id, found.campaign.id)) });
    } catch (err) {
      const msg = message(err);
      return res.status(400).json({ success: false, error: /own request|self/i.test(msg) ? "Another admin has to approve your broadcast." : msg });
    }
  });

  // Send a broadcast that was approved elsewhere (e.g. on the website).
  app.post("/api/business/:businessId/broadcasts/:campaignId/send", ...execute, async (req: Request, res: Response) => {
    const businessId = Number(req.params.businessId);
    const found = await draftCampaign(businessId, Number(req.params.campaignId));
    if ("error" in found) return res.status(found.status).json({ success: false, error: found.error });
    if (found.request?.status !== APPROVAL_REQUEST_STATUS.APPROVED) {
      return res.status(409).json({ success: false, error: "Not approved yet." });
    }
    try {
      return res.json({ success: true, ...(await sendOrSchedule(businessId, req.user!.id, found.campaign.id)) });
    } catch (err) {
      return res.status(400).json({ success: false, error: message(err) });
    }
  });

  // Cancel a broadcast that hasn't gone out yet (waiting or scheduled).
  app.post("/api/business/:businessId/broadcasts/:campaignId/cancel", ...manage, async (req: Request, res: Response) => {
    const businessId = Number(req.params.businessId);
    const campaignId = Number(req.params.campaignId);
    const [campaign] = await db.select().from(campaigns).where(and(eq(campaigns.id, campaignId), eq(campaigns.businessId, businessId)));
    if (!campaign) return res.status(404).json({ success: false, error: "Broadcast not found." });
    if (campaign.status !== CAMPAIGN_STATUS.DRAFT && campaign.status !== CAMPAIGN_STATUS.SCHEDULED) {
      const already = campaign.status === CAMPAIGN_STATUS.CANCELLED ? "This broadcast is already cancelled." : "This broadcast was already sent.";
      return res.status(409).json({ success: false, error: already });
    }
    try {
      await cancelCampaign(businessId, req.user!.id, campaignId);
      return res.json({ success: true, status: "cancelled" });
    } catch (err) {
      return res.status(409).json({ success: false, error: message(err) });
    }
  });
}

/** Approved: send now, or schedule for the time asked (if it is still ahead). */
async function sendOrSchedule(businessId: number, actor: number, campaignId: number) {
  const [campaign] = await db.select().from(campaigns).where(eq(campaigns.id, campaignId));
  if (campaign?.scheduledAt && campaign.scheduledAt.getTime() > Date.now() + 30_000) {
    const scheduled = await scheduleCampaign(businessId, actor, campaignId, campaign.scheduledAt);
    return { status: "scheduled", scheduledAt: scheduled.scheduledAt };
  }
  const result = await executeCampaign(businessId, actor, campaignId);
  return { status: result.campaignStatus, sent: result.sent, skipped: result.skipped };
}
