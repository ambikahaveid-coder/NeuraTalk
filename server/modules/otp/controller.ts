import type { Request, Response } from "express";
import { z } from "zod";
import { logger } from "../../observability";
import {
  createChallenge, getChallenge, listChallenges, verifyChallenge, resendChallenge,
  NotFoundError, ValidationError, DuplicateChallengeError, BillingError,
  AlreadyResolvedError, OtpExpiredError, OtpIncorrectCodeError, OtpMaxAttemptsError, OtpLockedOutError,
} from "./service";
import { OTP_PURPOSE, BUSINESS_OTP_CHANNEL } from "@shared/schema";

function badRequest(res: Response, msg: string) {
  return res.status(400).json({ success: false, error: msg });
}
function parseId(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

// Never includes the underlying error message verbatim for OTP-secret-
// adjacent failures where doing so could function as an oracle (e.g.
// distinguishing "wrong code" from "expired" from "locked out" is fine to
// expose -- none of these leak the code itself -- but this function is the
// single place that maps every OTP-domain error to an HTTP response, so a
// future new error type can't accidentally leak something by omission).
function handleServiceError(res: Response, error: unknown, fallbackMessage: string): Response {
  if (error instanceof NotFoundError) return res.status(404).json({ success: false, error: error.message });
  if (error instanceof DuplicateChallengeError) return res.status(409).json({ success: false, error: error.message, existingChallengeId: error.existingChallengeId });
  if (error instanceof ValidationError) return badRequest(res, error.message);
  if (error instanceof BillingError) return res.status(402).json({ success: false, error: "Unable to send OTP -- billing issue", reason: error.reason });
  if (error instanceof AlreadyResolvedError) return res.status(409).json({ success: false, error: error.message, status: error.status });
  if (error instanceof OtpExpiredError) return res.status(410).json({ success: false, error: error.message });
  if (error instanceof OtpMaxAttemptsError) return res.status(423).json({ success: false, error: error.message });
  if (error instanceof OtpLockedOutError) {
    if (error.retryAfterSec) res.setHeader("Retry-After", String(error.retryAfterSec));
    return res.status(429).json({ success: false, error: error.message });
  }
  if (error instanceof OtpIncorrectCodeError) return res.status(400).json({ success: false, error: error.message });
  logger.error("OTP", fallbackMessage, error as Error);
  return res.status(500).json({ success: false, error: fallbackMessage });
}

const createSchema = z.object({
  customerId: z.number().int().positive(),
  purpose: z.enum(Object.values(OTP_PURPOSE) as [string, ...string[]]),
  channel: z.enum(Object.values(BUSINESS_OTP_CHANNEL) as [string, ...string[]]).optional(),
  templateVersionId: z.number().int().positive().optional(),
}).strict();

export async function postChallenge(req: Request, res: Response) {
  const businessId = parseId(req.params.businessId);
  if (businessId === null) return badRequest(res, "Invalid businessId");
  const parsed = createSchema.safeParse(req.body ?? {});
  if (!parsed.success) return badRequest(res, parsed.error.message);

  try {
    const challenge = await createChallenge(businessId, req.user!.id, parsed.data);
    return res.status(201).json({ success: true, challenge });
  } catch (error) {
    return handleServiceError(res, error, "Failed to create OTP challenge");
  }
}

export async function getChallenges(req: Request, res: Response) {
  const businessId = parseId(req.params.businessId);
  if (businessId === null) return badRequest(res, "Invalid businessId");
  const customerId = req.query.customerId !== undefined ? parseId(req.query.customerId) : undefined;
  if (req.query.customerId !== undefined && customerId === null) return badRequest(res, "Invalid customerId");

  const challenges = await listChallenges(businessId, customerId ?? undefined);
  return res.json({ success: true, challenges });
}

export async function getChallengeById(req: Request, res: Response) {
  const businessId = parseId(req.params.businessId);
  const challengeId = parseId(req.params.challengeId);
  if (businessId === null || challengeId === null) return badRequest(res, "Invalid id");
  const challenge = await getChallenge(businessId, challengeId);
  if (!challenge) return res.status(404).json({ success: false, error: "Challenge not found" });
  return res.json({ success: true, challenge });
}

const verifySchema = z.object({
  code: z.string().trim().min(1).max(20),
  expectedPurpose: z.enum(Object.values(OTP_PURPOSE) as [string, ...string[]]).optional(),
  expectedDestination: z.string().trim().max(320).optional(),
}).strict();

export async function postVerify(req: Request, res: Response) {
  const businessId = parseId(req.params.businessId);
  const challengeId = parseId(req.params.challengeId);
  if (businessId === null || challengeId === null) return badRequest(res, "Invalid id");
  const parsed = verifySchema.safeParse(req.body ?? {});
  if (!parsed.success) return badRequest(res, parsed.error.message);

  try {
    const challenge = await verifyChallenge(businessId, req.user!.id, challengeId, parsed.data.code, {
      expectedPurpose: parsed.data.expectedPurpose,
      expectedDestination: parsed.data.expectedDestination,
    });
    return res.json({ success: true, challenge });
  } catch (error) {
    return handleServiceError(res, error, "Failed to verify OTP challenge");
  }
}

export async function postResend(req: Request, res: Response) {
  const businessId = parseId(req.params.businessId);
  const challengeId = parseId(req.params.challengeId);
  if (businessId === null || challengeId === null) return badRequest(res, "Invalid id");

  try {
    const challenge = await resendChallenge(businessId, req.user!.id, challengeId);
    return res.status(201).json({ success: true, challenge });
  } catch (error) {
    return handleServiceError(res, error, "Failed to resend OTP challenge");
  }
}
