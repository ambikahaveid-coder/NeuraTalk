import type { Request, Response } from "express";
import { z } from "zod";
import { logger } from "../../observability";
import {
  createAudience, listAudiences, getAudience, updateAudience, archiveAudience,
  addMember, removeMember, listMembers,
  NotFoundError, ValidationError,
} from "./service";
import { AUDIENCE_STATUS } from "@shared/schema";

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
  logger.error("Audiences", fallbackMessage, error as Error);
  return res.status(500).json({ success: false, error: fallbackMessage });
}

const createAudienceSchema = z.object({
  name: z.string().trim().min(1).max(150),
  description: z.string().trim().max(500).optional(),
  type: z.enum(["static", "dynamic"]).optional(),
}).strict();

export async function postAudience(req: Request, res: Response) {
  const businessId = parseId(req.params.businessId);
  if (businessId === null) return badRequest(res, "Invalid businessId");
  const parsed = createAudienceSchema.safeParse(req.body ?? {});
  if (!parsed.success) return badRequest(res, parsed.error.message);

  try {
    const audience = await createAudience(businessId, req.user!.id, parsed.data);
    return res.status(201).json({ success: true, audience });
  } catch (error) {
    return handleServiceError(res, error, "Failed to create audience");
  }
}

export async function getAudiences(req: Request, res: Response) {
  const businessId = parseId(req.params.businessId);
  if (businessId === null) return badRequest(res, "Invalid businessId");
  const status = typeof req.query.status === "string" ? req.query.status : undefined;
  if (status && !Object.values(AUDIENCE_STATUS).includes(status as any)) return badRequest(res, "Invalid status filter");

  try {
    const audiences = await listAudiences(businessId, status);
    return res.json({ success: true, audiences });
  } catch (error) {
    return handleServiceError(res, error, "Failed to list audiences");
  }
}

export async function getAudienceById(req: Request, res: Response) {
  const businessId = parseId(req.params.businessId);
  const audienceId = parseId(req.params.audienceId);
  if (businessId === null || audienceId === null) return badRequest(res, "Invalid id");
  const audience = await getAudience(businessId, audienceId);
  if (!audience) return res.status(404).json({ success: false, error: "Audience not found" });
  return res.json({ success: true, audience });
}

const updateAudienceSchema = z.object({
  name: z.string().trim().min(1).max(150).optional(),
  description: z.string().trim().max(500).optional(),
}).strict();

export async function putAudience(req: Request, res: Response) {
  const businessId = parseId(req.params.businessId);
  const audienceId = parseId(req.params.audienceId);
  if (businessId === null || audienceId === null) return badRequest(res, "Invalid id");
  const parsed = updateAudienceSchema.safeParse(req.body ?? {});
  if (!parsed.success) return badRequest(res, parsed.error.message);

  try {
    const audience = await updateAudience(businessId, req.user!.id, audienceId, parsed.data);
    return res.json({ success: true, audience });
  } catch (error) {
    return handleServiceError(res, error, "Failed to update audience");
  }
}

export async function postArchiveAudience(req: Request, res: Response) {
  const businessId = parseId(req.params.businessId);
  const audienceId = parseId(req.params.audienceId);
  if (businessId === null || audienceId === null) return badRequest(res, "Invalid id");

  try {
    const audience = await archiveAudience(businessId, req.user!.id, audienceId);
    return res.json({ success: true, audience });
  } catch (error) {
    return handleServiceError(res, error, "Failed to archive audience");
  }
}

const memberSchema = z.object({ customerId: z.number().int().positive() }).strict();

export async function postAddMember(req: Request, res: Response) {
  const businessId = parseId(req.params.businessId);
  const audienceId = parseId(req.params.audienceId);
  if (businessId === null || audienceId === null) return badRequest(res, "Invalid id");
  const parsed = memberSchema.safeParse(req.body ?? {});
  if (!parsed.success) return badRequest(res, parsed.error.message);

  try {
    const member = await addMember(businessId, req.user!.id, audienceId, parsed.data.customerId);
    return res.status(201).json({ success: true, member });
  } catch (error) {
    return handleServiceError(res, error, "Failed to add member");
  }
}

export async function deleteMember(req: Request, res: Response) {
  const businessId = parseId(req.params.businessId);
  const audienceId = parseId(req.params.audienceId);
  const customerId = parseId(req.params.customerId);
  if (businessId === null || audienceId === null || customerId === null) return badRequest(res, "Invalid id");

  try {
    await removeMember(businessId, req.user!.id, audienceId, customerId);
    return res.json({ success: true });
  } catch (error) {
    return handleServiceError(res, error, "Failed to remove member");
  }
}

export async function getMembers(req: Request, res: Response) {
  const businessId = parseId(req.params.businessId);
  const audienceId = parseId(req.params.audienceId);
  if (businessId === null || audienceId === null) return badRequest(res, "Invalid id");

  try {
    const members = await listMembers(businessId, audienceId);
    return res.json({ success: true, members });
  } catch (error) {
    return handleServiceError(res, error, "Failed to list members");
  }
}
