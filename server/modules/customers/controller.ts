import type { Request, Response } from "express";
import { z } from "zod";
import { logger } from "../../observability";
import {
  createCustomer, listCustomers, getCustomer, updateCustomer, archiveCustomer,
  NotFoundError, ValidationError, DuplicateCustomerError,
} from "./service";
import { CUSTOMER_STATUS } from "@shared/schema";

function badRequest(res: Response, msg: string) {
  return res.status(400).json({ success: false, error: msg });
}
function parseId(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function handleServiceError(res: Response, error: unknown, fallbackMessage: string): Response {
  if (error instanceof NotFoundError) return res.status(404).json({ success: false, error: error.message });
  if (error instanceof DuplicateCustomerError) {
    return res.status(409).json({ success: false, error: error.message, existingCustomerId: error.existingCustomerId });
  }
  if (error instanceof ValidationError) return badRequest(res, error.message);
  logger.error("Customers", fallbackMessage, error as Error);
  return res.status(500).json({ success: false, error: fallbackMessage });
}

const createCustomerSchema = z.object({
  name: z.string().trim().max(200).optional(),
  phone: z.string().trim().max(30).optional(),
  email: z.string().trim().email().max(200).optional(),
  externalRef: z.string().trim().max(200).optional(),
  notes: z.string().trim().max(2000).optional(),
  source: z.string().trim().max(20).optional(),
}).strict();

export async function postCustomer(req: Request, res: Response) {
  const businessId = parseId(req.params.businessId);
  if (businessId === null) return badRequest(res, "Invalid businessId");
  const parsed = createCustomerSchema.safeParse(req.body ?? {});
  if (!parsed.success) return badRequest(res, parsed.error.message);

  try {
    const customer = await createCustomer(businessId, req.user!.id, parsed.data);
    return res.status(201).json({ success: true, customer });
  } catch (error) {
    return handleServiceError(res, error, "Failed to create customer");
  }
}

export async function getCustomers(req: Request, res: Response) {
  const businessId = parseId(req.params.businessId);
  if (businessId === null) return badRequest(res, "Invalid businessId");

  const status = typeof req.query.status === "string" ? req.query.status : undefined;
  if (status && !Object.values(CUSTOMER_STATUS).includes(status as any)) {
    return badRequest(res, "Invalid status filter");
  }
  const search = typeof req.query.search === "string" ? req.query.search : undefined;
  const limit = req.query.limit !== undefined ? Number(req.query.limit) : undefined;
  const offset = req.query.offset !== undefined ? Number(req.query.offset) : undefined;

  try {
    const customers = await listCustomers(businessId, { status, search, limit, offset });
    return res.json({ success: true, customers });
  } catch (error) {
    return handleServiceError(res, error, "Failed to list customers");
  }
}

export async function getCustomerById(req: Request, res: Response) {
  const businessId = parseId(req.params.businessId);
  const customerId = parseId(req.params.customerId);
  if (businessId === null || customerId === null) return badRequest(res, "Invalid id");
  const customer = await getCustomer(businessId, customerId);
  if (!customer) return res.status(404).json({ success: false, error: "Customer not found" });
  return res.json({ success: true, customer });
}

const updateCustomerSchema = z.object({
  name: z.string().trim().max(200).optional(),
  phone: z.string().trim().max(30).optional(),
  email: z.string().trim().email().max(200).optional(),
  externalRef: z.string().trim().max(200).optional(),
  notes: z.string().trim().max(2000).optional(),
  status: z.enum([CUSTOMER_STATUS.ACTIVE, CUSTOMER_STATUS.BLOCKED]).optional(),
}).strict();

export async function putCustomer(req: Request, res: Response) {
  const businessId = parseId(req.params.businessId);
  const customerId = parseId(req.params.customerId);
  if (businessId === null || customerId === null) return badRequest(res, "Invalid id");
  const parsed = updateCustomerSchema.safeParse(req.body ?? {});
  if (!parsed.success) return badRequest(res, parsed.error.message);

  try {
    const customer = await updateCustomer(businessId, req.user!.id, customerId, parsed.data);
    return res.json({ success: true, customer });
  } catch (error) {
    return handleServiceError(res, error, "Failed to update customer");
  }
}

export async function postArchiveCustomer(req: Request, res: Response) {
  const businessId = parseId(req.params.businessId);
  const customerId = parseId(req.params.customerId);
  if (businessId === null || customerId === null) return badRequest(res, "Invalid id");

  try {
    const customer = await archiveCustomer(businessId, req.user!.id, customerId);
    return res.json({ success: true, customer });
  } catch (error) {
    return handleServiceError(res, error, "Failed to archive customer");
  }
}
