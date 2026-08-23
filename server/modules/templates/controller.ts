import type { Request, Response } from "express";
import { z } from "zod";
import { logger } from "../../observability";
import {
  createTemplate, listTemplates, getTemplate,
  createOrEditDraftVersion, listVersions,
  submitVersion, approveVersion, rejectVersion, returnToDraft, archiveVersion,
  previewVersion,
  NotFoundError, ValidationError, SelfApprovalError, IllegalTemplateTransitionError,
} from "./service";
import { TemplateContentError, TemplateRenderError } from "./render";
import { MESSAGE_CATEGORY } from "@shared/schema";

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
  if (error instanceof TemplateContentError) return badRequest(res, error.message);
  if (error instanceof TemplateRenderError) return badRequest(res, error.message);
  if (error instanceof IllegalTemplateTransitionError) return res.status(409).json({ success: false, error: error.message });
  if (error instanceof SelfApprovalError) return res.status(403).json({ success: false, error: error.message });
  logger.error("Templates", fallbackMessage, error as Error);
  return res.status(500).json({ success: false, error: fallbackMessage });
}

const createTemplateSchema = z.object({
  name: z.string().trim().min(1).max(150).regex(/^[a-zA-Z0-9_-]+$/, "Use letters, numbers, underscores, hyphens only"),
  category: z.enum(Object.values(MESSAGE_CATEGORY) as [string, ...string[]]),
}).strict();

export async function postTemplate(req: Request, res: Response) {
  const businessId = parseId(req.params.businessId);
  if (businessId === null) return badRequest(res, "Invalid businessId");
  const parsed = createTemplateSchema.safeParse(req.body ?? {});
  if (!parsed.success) return badRequest(res, parsed.error.message);

  try {
    const template = await createTemplate(businessId, req.user!.id, parsed.data);
    return res.status(201).json({ success: true, template });
  } catch (error) {
    return handleServiceError(res, error, "Failed to create template");
  }
}

export async function getTemplates(req: Request, res: Response) {
  const businessId = parseId(req.params.businessId);
  if (businessId === null) return badRequest(res, "Invalid businessId");
  const templates = await listTemplates(businessId);
  return res.json({ success: true, templates });
}

export async function getTemplateById(req: Request, res: Response) {
  const businessId = parseId(req.params.businessId);
  const templateId = parseId(req.params.templateId);
  if (businessId === null || templateId === null) return badRequest(res, "Invalid id");
  const template = await getTemplate(businessId, templateId);
  if (!template) return res.status(404).json({ success: false, error: "Template not found" });
  return res.json({ success: true, template });
}

const variableSchema = z.object({
  name: z.string().trim().regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/),
  type: z.enum(["text", "number", "date"]),
  required: z.boolean(),
}).strict();

const draftVersionSchema = z.object({
  language: z.string().trim().min(2).max(10).optional(),
  title: z.string().trim().max(200).optional(),
  content: z.string().min(1).max(4096),
  variables: z.array(variableSchema).max(20),
  mediaType: z.string().trim().max(50).optional(),
  mediaUrl: z.string().trim().url().max(2000).optional(),
}).strict();

export async function putDraftVersion(req: Request, res: Response) {
  const businessId = parseId(req.params.businessId);
  const templateId = parseId(req.params.templateId);
  if (businessId === null || templateId === null) return badRequest(res, "Invalid id");
  const parsed = draftVersionSchema.safeParse(req.body ?? {});
  if (!parsed.success) return badRequest(res, parsed.error.message);

  try {
    const version = await createOrEditDraftVersion(businessId, req.user!.id, templateId, parsed.data);
    return res.status(200).json({ success: true, version });
  } catch (error) {
    return handleServiceError(res, error, "Failed to save draft version");
  }
}

export async function getVersions(req: Request, res: Response) {
  const businessId = parseId(req.params.businessId);
  const templateId = parseId(req.params.templateId);
  if (businessId === null || templateId === null) return badRequest(res, "Invalid id");
  const language = typeof req.query.language === "string" ? req.query.language : undefined;

  try {
    const versions = await listVersions(businessId, templateId, language);
    return res.json({ success: true, versions });
  } catch (error) {
    return handleServiceError(res, error, "Failed to list versions");
  }
}

function versionAction(fn: (businessId: number, actorUserId: number, templateId: number, versionId: number) => Promise<unknown>) {
  return async (req: Request, res: Response) => {
    const businessId = parseId(req.params.businessId);
    const templateId = parseId(req.params.templateId);
    const versionId = parseId(req.params.versionId);
    if (businessId === null || templateId === null || versionId === null) return badRequest(res, "Invalid id");

    try {
      const version = await fn(businessId, req.user!.id, templateId, versionId);
      return res.json({ success: true, version });
    } catch (error) {
      return handleServiceError(res, error, "Failed to update version");
    }
  };
}

export const postSubmitVersion = versionAction(submitVersion);
export const postReturnToDraft = versionAction(returnToDraft);
export const postArchiveVersion = versionAction(archiveVersion);

export async function postApproveVersion(req: Request, res: Response) {
  const businessId = parseId(req.params.businessId);
  const templateId = parseId(req.params.templateId);
  const versionId = parseId(req.params.versionId);
  if (businessId === null || templateId === null || versionId === null) return badRequest(res, "Invalid id");

  try {
    const isSuperAdmin = req.user?.role === "super_admin";
    const version = await approveVersion(businessId, req.user!.id, templateId, versionId, isSuperAdmin);
    return res.json({ success: true, version });
  } catch (error) {
    return handleServiceError(res, error, "Failed to approve version");
  }
}

const rejectSchema = z.object({ reason: z.string().trim().min(1).max(1000) }).strict();

export async function postRejectVersion(req: Request, res: Response) {
  const businessId = parseId(req.params.businessId);
  const templateId = parseId(req.params.templateId);
  const versionId = parseId(req.params.versionId);
  if (businessId === null || templateId === null || versionId === null) return badRequest(res, "Invalid id");
  const parsed = rejectSchema.safeParse(req.body ?? {});
  if (!parsed.success) return badRequest(res, parsed.error.message);

  try {
    const version = await rejectVersion(businessId, req.user!.id, templateId, versionId, parsed.data.reason);
    return res.json({ success: true, version });
  } catch (error) {
    return handleServiceError(res, error, "Failed to reject version");
  }
}

const previewSchema = z.object({ values: z.record(z.string(), z.unknown()).default({}) }).strict();

export async function postPreviewVersion(req: Request, res: Response) {
  const businessId = parseId(req.params.businessId);
  const templateId = parseId(req.params.templateId);
  const versionId = parseId(req.params.versionId);
  if (businessId === null || templateId === null || versionId === null) return badRequest(res, "Invalid id");
  const parsed = previewSchema.safeParse(req.body ?? {});
  if (!parsed.success) return badRequest(res, parsed.error.message);

  try {
    const result = await previewVersion(businessId, templateId, versionId, parsed.data.values);
    return res.json({ success: true, ...result });
  } catch (error) {
    return handleServiceError(res, error, "Failed to render preview");
  }
}
