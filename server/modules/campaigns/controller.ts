import type { Request, Response } from "express";
import { z } from "zod";
import { logger } from "../../observability";
import {
  createCampaign, listCampaigns, getCampaign, updateCampaign,
  scheduleCampaign, cancelCampaign, executeCampaign, getCampaignPreflight,
  NotFoundError, ValidationError, IllegalCampaignTransitionError,
} from "./service";
import { CAMPAIGN_STATUS, CAMPAIGN_ALLOWED_CATEGORIES } from "@shared/schema";

function badRequest(res: Response, msg: string) {
  return res.status(400).json({ success: false, error: msg });
}
function parseId(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function handleServiceError(res: Response, error: unknown, fallbackMessage: string): Response {
  if (error instanceof NotFoundError) return res.status(404).json({ success: false, error: error.message });
  if (error instanceof ValidationError) return badRequest(res, error.message);
  if (error instanceof IllegalCampaignTransitionError) return res.status(409).json({ success: false, error: error.message });
  logger.error("Campaigns", fallbackMessage, error as Error);
  return res.status(500).json({ success: false, error: fallbackMessage });
}

const createCampaignSchema = z.object({
  name: z.string().trim().min(1).max(150),
  description: z.string().trim().max(1000).optional(),
  category: z.enum(CAMPAIGN_ALLOWED_CATEGORIES as unknown as [string, ...string[]]),
}).strict();

export async function postCampaign(req: Request, res: Response) {
  const businessId = parseId(req.params.businessId);
  if (businessId === null) return badRequest(res, "Invalid businessId");
  const parsed = createCampaignSchema.safeParse(req.body ?? {});
  if (!parsed.success) return badRequest(res, parsed.error.message);

  try {
    const campaign = await createCampaign(businessId, req.user!.id, parsed.data);
    return res.status(201).json({ success: true, campaign });
  } catch (error) {
    return handleServiceError(res, error, "Failed to create campaign");
  }
}

export async function getCampaigns(req: Request, res: Response) {
  const businessId = parseId(req.params.businessId);
  if (businessId === null) return badRequest(res, "Invalid businessId");
  const status = typeof req.query.status === "string" ? req.query.status : undefined;
  if (status && !Object.values(CAMPAIGN_STATUS).includes(status as any)) return badRequest(res, "Invalid status filter");

  try {
    const campaigns = await listCampaigns(businessId, status);
    return res.json({ success: true, campaigns });
  } catch (error) {
    return handleServiceError(res, error, "Failed to list campaigns");
  }
}

export async function getCampaignById(req: Request, res: Response) {
  const businessId = parseId(req.params.businessId);
  const campaignId = parseId(req.params.campaignId);
  if (businessId === null || campaignId === null) return badRequest(res, "Invalid id");
  const campaign = await getCampaign(businessId, campaignId);
  if (!campaign) return res.status(404).json({ success: false, error: "Campaign not found" });
  return res.json({ success: true, campaign });
}

const updateCampaignSchema = z.object({
  name: z.string().trim().min(1).max(150).optional(),
  description: z.string().trim().max(1000).optional(),
  category: z.enum(CAMPAIGN_ALLOWED_CATEGORIES as unknown as [string, ...string[]]).optional(),
  templateVersionId: z.number().int().positive().optional(),
  audienceId: z.number().int().positive().optional(),
}).strict();

export async function patchCampaign(req: Request, res: Response) {
  const businessId = parseId(req.params.businessId);
  const campaignId = parseId(req.params.campaignId);
  if (businessId === null || campaignId === null) return badRequest(res, "Invalid id");
  const parsed = updateCampaignSchema.safeParse(req.body ?? {});
  if (!parsed.success) return badRequest(res, parsed.error.message);

  try {
    const campaign = await updateCampaign(businessId, req.user!.id, campaignId, parsed.data);
    return res.json({ success: true, campaign });
  } catch (error) {
    return handleServiceError(res, error, "Failed to update campaign");
  }
}

const scheduleSchema = z.object({ scheduledAt: z.string().datetime() }).strict();

export async function postSchedule(req: Request, res: Response) {
  const businessId = parseId(req.params.businessId);
  const campaignId = parseId(req.params.campaignId);
  if (businessId === null || campaignId === null) return badRequest(res, "Invalid id");
  const parsed = scheduleSchema.safeParse(req.body ?? {});
  if (!parsed.success) return badRequest(res, parsed.error.message);

  try {
    const campaign = await scheduleCampaign(businessId, req.user!.id, campaignId, new Date(parsed.data.scheduledAt));
    return res.json({ success: true, campaign });
  } catch (error) {
    return handleServiceError(res, error, "Failed to schedule campaign");
  }
}

export async function postCancel(req: Request, res: Response) {
  const businessId = parseId(req.params.businessId);
  const campaignId = parseId(req.params.campaignId);
  if (businessId === null || campaignId === null) return badRequest(res, "Invalid id");

  try {
    const campaign = await cancelCampaign(businessId, req.user!.id, campaignId);
    return res.json({ success: true, campaign });
  } catch (error) {
    return handleServiceError(res, error, "Failed to cancel campaign");
  }
}

/**
 * Read-only preview -- never mutates, never charges, never reserves a
 * frequency slot (doc 36 section "R0-G"). Same RBAC/tenant scoping as
 * every other read on this resource.
 */
export async function getPreflight(req: Request, res: Response) {
  const businessId = parseId(req.params.businessId);
  const campaignId = parseId(req.params.campaignId);
  if (businessId === null || campaignId === null) return badRequest(res, "Invalid id");

  try {
    const preflight = await getCampaignPreflight(businessId, campaignId);
    return res.json({ success: true, preflight });
  } catch (error) {
    return handleServiceError(res, error, "Failed to compute campaign pre-flight");
  }
}

export async function postExecute(req: Request, res: Response) {
  const businessId = parseId(req.params.businessId);
  const campaignId = parseId(req.params.campaignId);
  if (businessId === null || campaignId === null) return badRequest(res, "Invalid id");

  try {
    const result = await executeCampaign(businessId, req.user!.id, campaignId);
    return res.json({ success: true, ...result });
  } catch (error) {
    return handleServiceError(res, error, "Failed to execute campaign");
  }
}
