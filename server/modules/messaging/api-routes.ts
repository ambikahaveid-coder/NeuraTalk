/**
 * Business Messaging API for a company's own systems (server-to-server),
 * authenticated with the company's NeuraTalk API key (X-API-Key) carrying
 * the "messages:send" permission.
 *
 *   POST /api/v1/messaging/utility-events      transactional message (order shipped, booking confirmed, ...)
 *   POST /api/v1/messaging/otp                 send a one-time code
 *   POST /api/v1/messaging/otp/:id/verify      check the code the person typed
 *
 * Every send goes through the same governed services the dashboard uses
 * (approved templates only, category locks, billing, consent for
 * marketing) and is delivered inside the customer's NeuraTalk app.
 * Customers are addressed by `customerId` or `phone`; a phone not yet in
 * the business's customer list is added automatically.
 */
import type { Express, Request, Response } from "express";
import { z } from "zod";
import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "../../db";
import { customers, users } from "@shared/schema";
import { normalizePhoneForIndia } from "@shared/phone";
import { createApiKeyMiddleware } from "../../api-key-auth";
import { logger } from "../../observability";
import { createCustomer, DuplicateCustomerError } from "../customers/service";
import * as utility from "../utility/service";
import * as otp from "../otp/service";

const addressSchema = {
  customerId: z.number().int().positive().optional(),
  phone: z.string().trim().min(6).max(32).optional(),
  name: z.string().trim().max(120).optional(),
};

const utilitySchema = z.object({
  ...addressSchema,
  eventType: z.string().min(1),
  eventReference: z.string().trim().min(1).max(200),
  templateVersionId: z.number().int().positive(),
  variables: z.record(z.unknown()).optional(),
});

const otpSchema = z.object({
  ...addressSchema,
  purpose: z.string().min(1),
  templateVersionId: z.number().int().positive().optional(),
});

const verifySchema = z.object({ code: z.string().trim().min(4).max(10) });

class ApiInputError extends Error {}

function organizationIdOf(req: Request): number {
  return (req as any).apiKey.organizationId as number;
}

/** The business account that API actions are recorded against (audit trail). */
async function businessActorUserId(organizationId: number): Promise<number> {
  const [admin] = await db.select({ id: users.id }).from(users)
    .where(and(eq(users.organizationId, organizationId), inArray(users.role, ["company_admin", "super_admin"])))
    .orderBy(asc(users.id)).limit(1);
  if (admin) return admin.id;
  const [anyMember] = await db.select({ id: users.id }).from(users)
    .where(eq(users.organizationId, organizationId)).orderBy(asc(users.id)).limit(1);
  if (!anyMember) throw new ApiInputError("This business has no user account to record the action against");
  return anyMember.id;
}

async function resolveCustomerId(organizationId: number, input: { customerId?: number; phone?: string; name?: string }): Promise<number> {
  if (input.customerId) {
    const [row] = await db.select({ id: customers.id }).from(customers)
      .where(and(eq(customers.id, input.customerId), eq(customers.businessId, organizationId)));
    if (!row) throw new ApiInputError("customerId not found for this business");
    return row.id;
  }
  if (!input.phone) throw new ApiInputError("Provide customerId or phone");
  const normalized = normalizePhoneForIndia(input.phone);
  if (!normalized) throw new ApiInputError("Invalid phone number");
  const [existing] = await db.select({ id: customers.id }).from(customers)
    .where(and(eq(customers.businessId, organizationId), eq(customers.normalizedPhone, normalized)));
  if (existing) return existing.id;
  try {
    const created = await createCustomer(organizationId, await businessActorUserId(organizationId), {
      phone: input.phone,
      name: input.name,
      source: "import",
    });
    return created.id;
  } catch (error) {
    if (error instanceof DuplicateCustomerError) return error.existingCustomerId;
    throw error;
  }
}

function sendError(res: Response, error: unknown, fallback: string) {
  if (error instanceof ApiInputError) return res.status(400).json({ success: false, error: error.message });
  if (error instanceof utility.UtilityTriggerFailedError) {
    return res.status(422).json({ success: false, error: "Message not sent", reason: error.reason });
  }
  if (error instanceof utility.ValidationError || error instanceof otp.ValidationError) {
    return res.status(400).json({ success: false, error: error.message });
  }
  if (error instanceof utility.NotFoundError || error instanceof otp.NotFoundError) {
    return res.status(404).json({ success: false, error: error.message });
  }
  if (error instanceof otp.DuplicateChallengeError) {
    return res.status(409).json({ success: false, error: error.message, existingChallengeId: error.existingChallengeId });
  }
  if (error instanceof otp.OtpDeliveryUnavailableError) return res.status(503).json({ success: false, error: error.message });
  if (error instanceof otp.BillingError) return res.status(402).json({ success: false, error: "Not enough message credit", reason: error.reason });
  if (error instanceof otp.AlreadyResolvedError) return res.status(409).json({ success: false, error: error.message, status: error.status });
  if (error instanceof otp.OtpExpiredError) return res.status(410).json({ success: false, error: error.message });
  if (error instanceof otp.OtpMaxAttemptsError) return res.status(423).json({ success: false, error: error.message });
  if (error instanceof otp.OtpLockedOutError) return res.status(429).json({ success: false, error: error.message });
  if (error instanceof otp.OtpIncorrectCodeError) return res.status(400).json({ success: false, verified: false, error: error.message });
  logger.error("BusinessMessagingApi", fallback, error instanceof Error ? error : new Error(String(error)));
  return res.status(500).json({ success: false, error: fallback });
}

export function registerBusinessMessagingApiRoutes(app: Express): void {
  const auth = createApiKeyMiddleware("messages:send");

  app.post("/api/v1/messaging/utility-events", auth, async (req, res) => {
    const parsed = utilitySchema.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ success: false, error: parsed.error.flatten() });
    try {
      const organizationId = organizationIdOf(req);
      const customerId = await resolveCustomerId(organizationId, parsed.data);
      const result = await utility.triggerUtilityMessage(organizationId, {
        eventType: parsed.data.eventType,
        eventReference: parsed.data.eventReference,
        customerId,
        templateVersionId: parsed.data.templateVersionId,
        variables: parsed.data.variables,
      });
      return res.status(result.wasDuplicate ? 200 : 201).json({
        success: true,
        duplicate: result.wasDuplicate,
        event: { id: result.event.id, status: result.event.status, messageId: result.event.messageId, customerId },
      });
    } catch (error) {
      return sendError(res, error, "Failed to send message");
    }
  });

  app.post("/api/v1/messaging/otp", auth, async (req, res) => {
    const parsed = otpSchema.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ success: false, error: parsed.error.flatten() });
    try {
      const organizationId = organizationIdOf(req);
      const customerId = await resolveCustomerId(organizationId, parsed.data);
      const challenge = await otp.createChallenge(organizationId, await businessActorUserId(organizationId), {
        customerId,
        purpose: parsed.data.purpose,
        templateVersionId: parsed.data.templateVersionId,
      });
      return res.status(201).json({
        success: true,
        challenge: { id: challenge.id, channel: challenge.channel, status: challenge.status, expiresAt: challenge.expiresAt, customerId },
      });
    } catch (error) {
      return sendError(res, error, "Failed to send code");
    }
  });

  app.post("/api/v1/messaging/otp/:challengeId/verify", auth, async (req, res) => {
    const challengeId = Number(req.params.challengeId);
    if (!Number.isInteger(challengeId) || challengeId <= 0) return res.status(400).json({ success: false, error: "Invalid challenge id" });
    const parsed = verifySchema.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ success: false, error: "code is required" });
    try {
      const challenge = await otp.verifyChallenge(organizationIdOf(req), undefined, challengeId, parsed.data.code);
      return res.json({ success: true, verified: true, challenge: { id: challenge.id, status: challenge.status } });
    } catch (error) {
      return sendError(res, error, "Failed to verify code");
    }
  });
}
