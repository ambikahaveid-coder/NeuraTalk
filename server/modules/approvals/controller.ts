import type { Request, Response } from "express";
import { z } from "zod";
import { logger } from "../../observability";
import { hasPermission, isSuperAdmin } from "../../role-middleware";
import { getApprovalPolicy, listRegisteredResourceTypes } from "./policy";
import {
  createApprovalRequest, listApprovalRequests, getApprovalRequest,
  approveRequest, rejectRequest, cancelRequest,
  NotFoundError, ValidationError, UnknownResourceTypeError, SelfApprovalError, AlreadyDecidedError, ForbiddenError,
} from "./service";
import { APPROVAL_REQUEST_STATUS } from "@shared/schema";

function badRequest(res: Response, msg: string) {
  return res.status(400).json({ success: false, error: msg });
}
function parseId(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}
function forbidden(res: Response, msg = "You don't have permission to perform this action") {
  return res.status(403).json({ success: false, error: msg });
}

function handleServiceError(res: Response, error: unknown, fallbackMessage: string): Response {
  if (error instanceof NotFoundError) return res.status(404).json({ success: false, error: error.message });
  if (error instanceof UnknownResourceTypeError) return badRequest(res, error.message);
  if (error instanceof ValidationError) return badRequest(res, error.message);
  if (error instanceof SelfApprovalError) return forbidden(res, error.message);
  if (error instanceof ForbiddenError) return forbidden(res, error.message);
  if (error instanceof AlreadyDecidedError) return res.status(409).json({ success: false, error: error.message });
  logger.error("Approvals", fallbackMessage, error as Error);
  return res.status(500).json({ success: false, error: fallbackMessage });
}

const createSchema = z.object({
  resourceType: z.string().trim().min(1).max(100),
  resourceId: z.number().int().positive(),
}).strict();

/**
 * Permission for this route depends on which resourceType the caller is
 * submitting -- known only after parsing the body, so it can't be checked
 * by the static requirePermission() middleware the way other routes do.
 * Resolved dynamically here via the policy's own declared submitPermission.
 * An unregistered resourceType (anything but "template_version" in this
 * phase) is rejected before any permission check even runs.
 */
export async function postCreateRequest(req: Request, res: Response) {
  const businessId = parseId(req.params.businessId);
  if (businessId === null) return badRequest(res, "Invalid businessId");
  const parsed = createSchema.safeParse(req.body ?? {});
  if (!parsed.success) return badRequest(res, parsed.error.message);

  const policy = getApprovalPolicy(parsed.data.resourceType);
  if (!policy) return badRequest(res, `Unsupported resourceType. Registered types: ${listRegisteredResourceTypes().join(", ") || "(none)"}`);
  if (!hasPermission(req.user, policy.submitPermission)) return forbidden(res);

  try {
    const request = await createApprovalRequest(businessId, req.user!.id, parsed.data.resourceType, parsed.data.resourceId);
    return res.status(201).json({ success: true, request });
  } catch (error) {
    return handleServiceError(res, error, "Failed to create approval request");
  }
}

const STATUS_VALUES = Object.values(APPROVAL_REQUEST_STATUS);

export async function getRequests(req: Request, res: Response) {
  const businessId = parseId(req.params.businessId);
  if (businessId === null) return badRequest(res, "Invalid businessId");

  const statusParam = typeof req.query.status === "string" ? req.query.status : undefined;
  if (statusParam && !STATUS_VALUES.includes(statusParam as any)) return badRequest(res, "Invalid status filter");

  const requests = await listApprovalRequests(businessId, statusParam as any);
  return res.json({ success: true, requests });
}

export async function getRequestById(req: Request, res: Response) {
  const businessId = parseId(req.params.businessId);
  const requestId = parseId(req.params.requestId);
  if (businessId === null || requestId === null) return badRequest(res, "Invalid id");

  const request = await getApprovalRequest(businessId, requestId);
  if (!request) return res.status(404).json({ success: false, error: "Approval request not found" });
  return res.json({ success: true, request });
}

/**
 * Same dynamic-permission pattern as postCreateRequest -- must look up the
 * request first to know its resourceType, then check that resourceType's
 * declared decidePermission.
 */
async function decideAction(req: Request, res: Response, run: (businessId: number, actorUserId: number, requestId: number, isSuperAdminFlag: boolean) => Promise<unknown>) {
  const businessId = parseId(req.params.businessId);
  const requestId = parseId(req.params.requestId);
  if (businessId === null || requestId === null) return badRequest(res, "Invalid id");

  const existing = await getApprovalRequest(businessId, requestId);
  if (!existing) return res.status(404).json({ success: false, error: "Approval request not found" });

  const policy = getApprovalPolicy(existing.resourceType);
  if (!policy) return handleServiceError(res, new UnknownResourceTypeError(existing.resourceType), "Failed to decide approval request");
  if (!hasPermission(req.user, policy.decidePermission)) return forbidden(res);

  try {
    const request = await run(businessId, req.user!.id, requestId, isSuperAdmin(req.user));
    return res.json({ success: true, request });
  } catch (error) {
    return handleServiceError(res, error, "Failed to decide approval request");
  }
}

export async function postApprove(req: Request, res: Response) {
  return decideAction(req, res, (businessId, actorUserId, requestId, superAdminFlag) => approveRequest(businessId, actorUserId, requestId, superAdminFlag));
}

const rejectSchema = z.object({ reason: z.string().trim().min(1).max(1000) }).strict();

export async function postReject(req: Request, res: Response) {
  const parsed = rejectSchema.safeParse(req.body ?? {});
  if (!parsed.success) return badRequest(res, parsed.error.message);
  return decideAction(req, res, (businessId, actorUserId, requestId, superAdminFlag) => rejectRequest(businessId, actorUserId, requestId, parsed.data.reason, superAdminFlag));
}

export async function postCancel(req: Request, res: Response) {
  const businessId = parseId(req.params.businessId);
  const requestId = parseId(req.params.requestId);
  if (businessId === null || requestId === null) return badRequest(res, "Invalid id");

  try {
    const request = await cancelRequest(businessId, req.user!.id, requestId, isSuperAdmin(req.user));
    return res.json({ success: true, request });
  } catch (error) {
    return handleServiceError(res, error, "Failed to cancel approval request");
  }
}
