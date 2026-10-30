import type { Request, Response } from "express";
import { z } from "zod";
import { logger } from "../../observability";
import {
  createCustomer, listCustomers, getCustomer, updateCustomer, archiveCustomer,
  setChannelConsent, getCustomerConsents,
  NotFoundError, ValidationError, DuplicateCustomerError,
} from "./service";
import { CUSTOMER_STATUS, CUSTOMER_CONSENT_CHANNEL } from "@shared/schema";

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

const importSchema = z.object({
  rows: z.array(z.object({
    name: z.string().trim().max(200).optional(),
    phone: z.string().trim().max(30).optional(),
    email: z.string().trim().max(200).optional(),
  })).min(1).max(2000),
  // The business confirms these people agreed to receive offers (like the
  // WhatsApp Business opt-in rule). Without it they get order/account updates only.
  offersConsentConfirmed: z.boolean().optional(),
});

/**
 * Add many customers at once. Each row goes through the same createCustomer
 * checks (phone/email format, no duplicates); bad rows are reported, not fatal.
 */
export async function postImportCustomers(req: Request, res: Response) {
  const businessId = parseId(req.params.businessId);
  if (businessId === null) return badRequest(res, "Invalid businessId");
  const parsed = importSchema.safeParse(req.body ?? {});
  if (!parsed.success) return badRequest(res, parsed.error.issues[0]?.message ?? "Check the file");

  let added = 0;
  let alreadyThere = 0;
  let onNeuraTalk = 0;
  const problems: Array<{ row: number; reason: string }> = [];
  for (let i = 0; i < parsed.data.rows.length; i++) {
    const row = parsed.data.rows[i];
    const email = row.email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(row.email) ? row.email : undefined;
    if (!row.phone && !email) {
      problems.push({ row: i + 1, reason: "No phone number or email" });
      continue;
    }
    try {
      const customer = await createCustomer(businessId, req.user!.id, { name: row.name || undefined, phone: row.phone || undefined, email, source: "import" });
      added++;
      if (customer.linkedUserId) onNeuraTalk++;
      if (parsed.data.offersConsentConfirmed) {
        await setChannelConsent(businessId, req.user!.id, customer.id, CUSTOMER_CONSENT_CHANNEL.MARKETING, true, "import_confirmed").catch(() => undefined);
      }
    } catch (error) {
      if (error instanceof DuplicateCustomerError) alreadyThere++;
      else if (error instanceof ValidationError) problems.push({ row: i + 1, reason: error.message });
      else {
        logger.error("Customers", "Import row failed", error as Error);
        problems.push({ row: i + 1, reason: "Could not add this row" });
      }
    }
  }
  return res.json({ success: true, added, alreadyThere, onNeuraTalk, problems: problems.slice(0, 50), problemCount: problems.length });
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

// ---------------------------------------------------------------------------
// Consent write path -- Phase 8 (doc 34). businessId/customerId are ALWAYS
// resolved from the URL (verified server-side via requireCompanyAccess +
// getOwnedCustomer inside the service) -- a client body can never forge
// business ownership. "granted" is an explicit boolean the caller states;
// the service never infers consent from the customer merely existing.
// ---------------------------------------------------------------------------

const consentSchema = z.object({
  channel: z.enum(Object.values(CUSTOMER_CONSENT_CHANNEL) as [string, ...string[]]),
  granted: z.boolean(),
  source: z.string().trim().max(100).optional(),
}).strict();

export async function postConsent(req: Request, res: Response) {
  const businessId = parseId(req.params.businessId);
  const customerId = parseId(req.params.customerId);
  if (businessId === null || customerId === null) return badRequest(res, "Invalid id");
  const parsed = consentSchema.safeParse(req.body ?? {});
  if (!parsed.success) return badRequest(res, parsed.error.message);

  try {
    const consent = await setChannelConsent(businessId, req.user!.id, customerId, parsed.data.channel as any, parsed.data.granted, parsed.data.source);
    return res.status(200).json({ success: true, consent });
  } catch (error) {
    return handleServiceError(res, error, "Failed to update consent");
  }
}

export async function getConsents(req: Request, res: Response) {
  const businessId = parseId(req.params.businessId);
  const customerId = parseId(req.params.customerId);
  if (businessId === null || customerId === null) return badRequest(res, "Invalid id");

  try {
    const consents = await getCustomerConsents(businessId, customerId);
    return res.json({ success: true, consents });
  } catch (error) {
    return handleServiceError(res, error, "Failed to fetch consent");
  }
}
