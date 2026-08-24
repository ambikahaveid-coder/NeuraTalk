/**
 * Business OTP / Authentication Messaging -- Phase 6 (2026-08-24).
 * See docs/neura-ecosystem/31_BUSINESS_OTP_AUTHENTICATION_IMPLEMENTATION.md.
 *
 * Three-layer model per challenge: businessOtpChallenges (security object --
 * hash, attempts, expiry, NEVER a plaintext code) -> messagingMessages
 * (category=AUTHENTICATION, content REDACTED, reused canonical messaging) ->
 * businessOtpDeliveries (OTP-specific delivery intent). No external
 * provider is called anywhere in this file.
 */
import { db } from "../../db";
import {
  businessOtpChallenges,
  businessOtpDeliveries,
  customers,
  organizations,
  templates,
  templateVersions,
  messagingMessages,
  messagingDeliveries,
  messagingEvents,
  OTP_PURPOSE,
  BUSINESS_OTP_CHANNEL,
  OTP_CHALLENGE_STATUS,
  CUSTOMER_STATUS,
  MESSAGE_CATEGORY,
  MESSAGE_TYPE,
  MESSAGE_DELIVERY_STATUS,
  MESSAGE_EVENT_TYPE,
  TEMPLATE_VERSION_STATUS,
  type OtpPurpose,
  type BusinessOtpChannel,
  type OtpChallengeStatus,
  type TemplateVariableDeclaration,
} from "@shared/schema";
import { eq, and, sql } from "drizzle-orm";
import { generateOtpCode, hashOtpCode } from "./generate";
import { assertOtpTemplateShape, renderRedactedForRecord, DEFAULT_OTP_CONTENT, DEFAULT_OTP_VARIABLES } from "./render";
import { findOrCreateCustomerConversation } from "../messaging/service";
import { chargeOtpMessage, PLACEHOLDER_COST_PER_OTP_PAISE } from "./billing";
import { createAuditLog, AUDIT_ACTION_OTP } from "./audit";
import { isOtpVerifyLockedOut, recordOtpVerifyFailure, clearOtpVerifyFailures } from "../../rate-limit";
import { assertLegalOtpTransition } from "./lifecycle";

export class NotFoundError extends Error {
  constructor(message: string) { super(message); this.name = "NotFoundError"; }
}
export class ValidationError extends Error {
  constructor(message: string) { super(message); this.name = "ValidationError"; }
}
export class DuplicateChallengeError extends Error {
  constructor(public readonly existingChallengeId: number) {
    super("A pending challenge already exists for this customer and purpose -- use resend instead");
    this.name = "DuplicateChallengeError";
  }
}
export class BillingError extends Error {
  constructor(public readonly reason: string) {
    super(`Unable to bill for this OTP send: ${reason}`);
    this.name = "BillingError";
  }
}
/** One-time verification already resolved (verified/expired/failed/superseded), or a concurrent request won the race first. */
export class AlreadyResolvedError extends Error {
  constructor(public readonly status: string) {
    super(`This challenge has already been resolved (status: ${status})`);
    this.name = "AlreadyResolvedError";
  }
}
export class OtpExpiredError extends Error {
  constructor() { super("This code has expired"); this.name = "OtpExpiredError"; }
}
export class OtpIncorrectCodeError extends Error {
  constructor() { super("Incorrect code"); this.name = "OtpIncorrectCodeError"; }
}
export class OtpMaxAttemptsError extends Error {
  constructor() { super("Maximum verification attempts exceeded -- request a new code"); this.name = "OtpMaxAttemptsError"; }
}
export class OtpLockedOutError extends Error {
  constructor(public readonly retryAfterSec: number | undefined) {
    super("Too many failed attempts for this destination -- temporarily locked out");
    this.name = "OtpLockedOutError";
  }
}

type DbLike = Pick<typeof db, "select" | "update" | "insert">;

const OTP_EXPIRY_MINUTES = 10; // same default as the existing platform OTP (server/otp-auth.ts)
const MAX_ATTEMPTS = 3;        // same default as the existing platform OTP
const MAX_RESENDS = 3;
const REDIS_NAMESPACE = "biz"; // keeps business-OTP lockout keys separate from the platform's own login-OTP key space

function assertValidPurpose(purpose: string): asserts purpose is OtpPurpose {
  if (!Object.values(OTP_PURPOSE).includes(purpose as OtpPurpose)) {
    throw new ValidationError(`Invalid purpose: ${purpose}`);
  }
}

/** Resolves (channel, destination) server-side from the customer's own record -- the client never supplies a destination directly, only an optional channel preference. */
function resolveDestination(customer: typeof customers.$inferSelect, requestedChannel?: string): { channel: BusinessOtpChannel; destination: string } {
  if (requestedChannel !== undefined && !Object.values(BUSINESS_OTP_CHANNEL).includes(requestedChannel as BusinessOtpChannel)) {
    throw new ValidationError(`Invalid channel: ${requestedChannel}`);
  }

  const channel = (requestedChannel as BusinessOtpChannel | undefined)
    ?? (customer.normalizedPhone ? BUSINESS_OTP_CHANNEL.SMS : BUSINESS_OTP_CHANNEL.EMAIL);

  if (channel === BUSINESS_OTP_CHANNEL.SMS) {
    if (!customer.normalizedPhone) throw new ValidationError("Customer has no phone number on file");
    return { channel, destination: customer.normalizedPhone };
  }
  if (!customer.normalizedEmail) throw new ValidationError("Customer has no email address on file");
  return { channel, destination: customer.normalizedEmail };
}

async function resolveOwnedCustomer(tx: DbLike, businessId: number, customerId: number) {
  const [customer] = await tx.select().from(customers).where(and(eq(customers.id, customerId), eq(customers.businessId, businessId)));
  if (!customer) throw new NotFoundError("Customer not found");
  if (customer.status === CUSTOMER_STATUS.BLOCKED) throw new ValidationError("Customer is blocked");
  if (customer.status === CUSTOMER_STATUS.ARCHIVED) throw new ValidationError("Customer is archived");
  return customer;
}

interface ResolvedContent {
  templateId: number | null;
  content: string;
  variables: TemplateVariableDeclaration[];
}

/** Resolves+validates the optional business template (must be same-business, category=AUTHENTICATION, APPROVED, shape-checked) or falls back to the built-in default. Category is NEVER client-suppliable -- only ever read from the template's own row, or hardcoded to the default. */
async function resolveContent(tx: DbLike, businessId: number, templateVersionId?: number): Promise<ResolvedContent> {
  if (templateVersionId === undefined) {
    return { templateId: null, content: DEFAULT_OTP_CONTENT, variables: DEFAULT_OTP_VARIABLES };
  }
  const [version] = await tx.select().from(templateVersions).where(eq(templateVersions.id, templateVersionId));
  if (!version) throw new NotFoundError("Template version not found");
  const [template] = await tx.select().from(templates).where(eq(templates.id, version.templateId));
  if (!template || template.businessId !== businessId) throw new NotFoundError("Template version not found");
  if (template.category !== MESSAGE_CATEGORY.AUTHENTICATION) {
    throw new ValidationError("OTP templates must have category AUTHENTICATION -- category is server-controlled and cannot be changed for this purpose");
  }
  if (version.status !== TEMPLATE_VERSION_STATUS.APPROVED) {
    throw new ValidationError(`OTP template must be APPROVED (currently ${version.status})`);
  }
  const variables = (version.variables as TemplateVariableDeclaration[]) ?? [];
  try {
    assertOtpTemplateShape(variables);
  } catch (err) {
    // Normalize render.ts's specific error types into this module's own
    // ValidationError -- the controller only needs to know about one
    // validation-failure shape for this service, not reach into render.ts.
    throw new ValidationError(err instanceof Error ? err.message : "Invalid OTP template");
  }
  return { templateId: template.id, content: version.content, variables };
}

/**
 * Shared by createChallenge and resendChallenge: generates+hashes a code,
 * charges (inside the SAME transaction as the message/delivery-intent
 * creation -- the accounting boundary from doc 31 section 14), creates the
 * REDACTED conversational record via the reused canonical messaging
 * foundation (sender resolved server-side as the BUSINESS participant,
 * generationSource server-set only -- doc 31 section 16), and inserts the
 * challenge + delivery-intent rows. Never returns or logs the raw code.
 */
async function issueChallenge(
  tx: DbLike,
  businessId: number,
  actorUserId: number,
  customer: typeof customers.$inferSelect,
  purpose: OtpPurpose,
  channel: BusinessOtpChannel,
  destination: string,
  resolved: ResolvedContent,
  resendCount: number,
  supersedesChallengeId: number | null,
) {
  const charge = await chargeOtpMessage(tx, businessId, PLACEHOLDER_COST_PER_OTP_PAISE);
  if (!charge.charged) throw new BillingError(charge.reason ?? "unknown");

  const code = generateOtpCode();
  const codeHash = hashOtpCode(code);
  const expiresAt = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60_000);

  const [challenge] = await tx.insert(businessOtpChallenges).values({
    businessId,
    customerId: customer.id,
    destination,
    channel,
    purpose,
    codeHash,
    status: OTP_CHALLENGE_STATUS.PENDING,
    attempts: 0,
    maxAttempts: MAX_ATTEMPTS,
    resendCount,
    templateVersionId: resolved.templateId,
    supersedesChallengeId,
    createdBy: actorUserId,
    expiresAt,
  }).returning();

  const { conversation, participants } = await findOrCreateCustomerConversation(tx, businessId, customer.id);
  const businessParticipant = participants.find((p) => p.participantType === "business");
  const customerParticipant = participants.find((p) => p.participantType === "customer");
  if (!businessParticipant || !customerParticipant) throw new Error("OTP_SYSTEM_ERROR: conversation participants missing");

  const redacted = renderRedactedForRecord(resolved.content, resolved.variables, customer.name);

  const [message] = await tx.insert(messagingMessages).values({
    conversationId: conversation.id,
    senderParticipantId: businessParticipant.id,
    messageType: MESSAGE_TYPE.TEMPLATE,
    category: MESSAGE_CATEGORY.AUTHENTICATION,
    content: redacted.rendered,
    templateId: resolved.templateId,
  }).returning();

  await tx.insert(messagingDeliveries).values({
    messageId: message.id, participantId: customerParticipant.id, status: MESSAGE_DELIVERY_STATUS.QUEUED,
  });

  // generationSource established server-side ONLY -- no client input path
  // reaches this at all (doc 25/doc 30 section 17 precedent, extended here).
  await tx.insert(messagingEvents).values({
    conversationId: conversation.id,
    messageId: message.id,
    eventType: MESSAGE_EVENT_TYPE.MESSAGE_CREATED,
    payload: { senderParticipantId: businessParticipant.id, recipientCount: 1, generationSource: { type: "otp_challenge", id: challenge.id } },
  });

  await tx.insert(businessOtpDeliveries).values({
    challengeId: challenge.id, channel, destination, status: MESSAGE_DELIVERY_STATUS.QUEUED,
  });

  const [withMessage] = await tx.update(businessOtpChallenges).set({ messageId: message.id })
    .where(eq(businessOtpChallenges.id, challenge.id)).returning();

  return { challenge: withMessage, rawCode: code };
}

/** Strips codeHash (and everything else security-sensitive) before a challenge is ever returned to a caller -- defense in depth alongside "never select codeHash in the first place" at the controller layer. */
export function toSafeChallenge(row: typeof businessOtpChallenges.$inferSelect) {
  const { codeHash, ...safe } = row;
  void codeHash;
  return safe;
}

export interface CreateChallengeInput {
  customerId: number;
  purpose: string;
  channel?: string;
  templateVersionId?: number;
}

export async function createChallenge(businessId: number, actorUserId: number, input: CreateChallengeInput) {
  const { purpose } = input;
  assertValidPurpose(purpose);

  return db.transaction(async (tx) => {
    const [business] = await tx.select({ id: organizations.id }).from(organizations).where(eq(organizations.id, businessId));
    if (!business) throw new NotFoundError("Business not found");

    const customer = await resolveOwnedCustomer(tx, businessId, input.customerId);
    const { channel, destination } = resolveDestination(customer, input.channel);
    const resolved = await resolveContent(tx, businessId, input.templateVersionId);

    // Idempotency P0 (doc 31 section 21): app-level pre-check, backed by
    // the DB's own partial unique index (businessId,customerId,purpose)
    // WHERE status='pending') as defense-in-depth -- same precedent as
    // Phase 4's customer dedup (doc 29 section 4). NOT proven under a live
    // concurrent-INSERT race in this test suite (that would require a real
    // Postgres unique-constraint violation, unavailable without a live
    // DB); verification and resend below use an atomic UPDATE...WHERE
    // status='pending' CAS instead, which IS proven under genuine
    // Promise.allSettled concurrency (same technique validated in Phase 5).
    const [existingPending] = await tx.select().from(businessOtpChallenges).where(and(
      eq(businessOtpChallenges.businessId, businessId),
      eq(businessOtpChallenges.customerId, customer.id),
      eq(businessOtpChallenges.purpose, purpose),
      eq(businessOtpChallenges.status, OTP_CHALLENGE_STATUS.PENDING),
    ));
    if (existingPending) throw new DuplicateChallengeError(existingPending.id);

    const { challenge } = await issueChallenge(tx, businessId, actorUserId, customer, purpose, channel, destination, resolved, 0, null);

    await createAuditLog(actorUserId, businessId, AUDIT_ACTION_OTP.CHALLENGE_CREATED, challenge.id, { purpose, channel });
    return toSafeChallenge(challenge);
  });
}

async function getOwnedChallenge(tx: DbLike, businessId: number, challengeId: number) {
  const [row] = await tx.select().from(businessOtpChallenges).where(and(eq(businessOtpChallenges.id, challengeId), eq(businessOtpChallenges.businessId, businessId)));
  if (!row) throw new NotFoundError("Challenge not found");
  return row;
}

export async function getChallenge(businessId: number, challengeId: number) {
  const row = await getOwnedChallenge(db, businessId, challengeId).catch(() => null);
  if (!row) return null;
  return toSafeChallenge(deriveEffectiveStatus(row));
}

export async function listChallenges(businessId: number, customerId?: number) {
  const conditions = [eq(businessOtpChallenges.businessId, businessId)];
  if (customerId !== undefined) conditions.push(eq(businessOtpChallenges.customerId, customerId));
  const rows = await db.select().from(businessOtpChallenges).where(and(...conditions));
  return rows.map((r) => toSafeChallenge(deriveEffectiveStatus(r)));
}

/** Read-time-only lazy expiry -- reports EXPIRED accurately without needing a scheduler; the DB row's own status column only flips to EXPIRED for real inside verifyChallenge, when an actual verify attempt is made against it. */
function deriveEffectiveStatus(row: typeof businessOtpChallenges.$inferSelect): typeof businessOtpChallenges.$inferSelect {
  if (row.status === OTP_CHALLENGE_STATUS.PENDING && row.expiresAt.getTime() <= Date.now()) {
    return { ...row, status: OTP_CHALLENGE_STATUS.EXPIRED };
  }
  return row;
}

export interface VerifyOptions {
  expectedPurpose?: string;
  expectedDestination?: string;
}

export async function verifyChallenge(businessId: number, actorUserId: number | undefined, challengeId: number, code: string, options: VerifyOptions = {}) {
  const challenge = await getOwnedChallenge(db, businessId, challengeId);

  if (options.expectedPurpose !== undefined && options.expectedPurpose !== challenge.purpose) {
    throw new ValidationError("Purpose does not match this challenge");
  }
  if (options.expectedDestination !== undefined && options.expectedDestination !== challenge.destination) {
    throw new ValidationError("Destination does not match this challenge");
  }

  const lockout = await isOtpVerifyLockedOut(challenge.destination, REDIS_NAMESPACE);
  if (lockout.locked) throw new OtpLockedOutError(lockout.ttlSec);

  if (challenge.status !== OTP_CHALLENGE_STATUS.PENDING) {
    throw new AlreadyResolvedError(challenge.status);
  }

  return db.transaction(async (tx) => {
    if (challenge.expiresAt.getTime() <= Date.now()) {
      assertLegalOtpTransition(challenge.status as OtpChallengeStatus, OTP_CHALLENGE_STATUS.EXPIRED);
      const [expired] = await tx.update(businessOtpChallenges).set({ status: OTP_CHALLENGE_STATUS.EXPIRED })
        .where(and(eq(businessOtpChallenges.id, challengeId), eq(businessOtpChallenges.status, OTP_CHALLENGE_STATUS.PENDING))).returning();
      if (expired) await createAuditLog(actorUserId, businessId, AUDIT_ACTION_OTP.CHALLENGE_EXPIRED, challengeId, {});
      throw new OtpExpiredError();
    }

    const providedHash = hashOtpCode(code);
    if (providedHash !== challenge.codeHash) {
      const [afterIncrement] = await tx.update(businessOtpChallenges)
        .set({ attempts: sql`${businessOtpChallenges.attempts} + ${1}` })
        .where(and(eq(businessOtpChallenges.id, challengeId), eq(businessOtpChallenges.status, OTP_CHALLENGE_STATUS.PENDING)))
        .returning();
      if (!afterIncrement) throw new AlreadyResolvedError("pending"); // lost the race to a concurrent resolution

      await recordOtpVerifyFailure(challenge.destination, REDIS_NAMESPACE);

      if (afterIncrement.attempts >= afterIncrement.maxAttempts) {
        const [failed] = await tx.update(businessOtpChallenges).set({ status: OTP_CHALLENGE_STATUS.FAILED, failedAt: new Date() })
          .where(and(eq(businessOtpChallenges.id, challengeId), eq(businessOtpChallenges.status, OTP_CHALLENGE_STATUS.PENDING))).returning();
        if (failed) await createAuditLog(actorUserId, businessId, AUDIT_ACTION_OTP.CHALLENGE_FAILED, challengeId, { attempts: afterIncrement.attempts });
        throw new OtpMaxAttemptsError();
      }
      throw new OtpIncorrectCodeError();
    }

    const [verified] = await tx.update(businessOtpChallenges).set({ status: OTP_CHALLENGE_STATUS.VERIFIED, verifiedAt: new Date() })
      .where(and(eq(businessOtpChallenges.id, challengeId), eq(businessOtpChallenges.status, OTP_CHALLENGE_STATUS.PENDING))).returning();
    if (!verified) throw new AlreadyResolvedError("pending"); // lost the race -- e.g. a concurrent verify already succeeded

    await clearOtpVerifyFailures(challenge.destination, REDIS_NAMESPACE);
    await createAuditLog(actorUserId, businessId, AUDIT_ACTION_OTP.CHALLENGE_VERIFIED, challengeId, {});
    return toSafeChallenge(verified);
  });
}

/**
 * Resend policy (doc 31 section 9): SUPERSEDE, not multi-valid-OTP. The
 * prior PENDING challenge is atomically marked SUPERSEDED (CAS) and a
 * brand-new challenge (new code, new hash, new expiry) is issued in the
 * same transaction -- at no point can two challenges for the same
 * (business, customer, purpose) both be independently verifiable.
 * resendCount is carried forward and capped at MAX_RESENDS; beyond that,
 * the caller must wait for expiry or start a fresh POST .../challenges.
 */
export async function resendChallenge(businessId: number, actorUserId: number, challengeId: number) {
  return db.transaction(async (tx) => {
    const challenge = await getOwnedChallenge(tx, businessId, challengeId);
    if (challenge.status !== OTP_CHALLENGE_STATUS.PENDING) {
      throw new ValidationError(`Cannot resend a challenge with status ${challenge.status}`);
    }
    if (challenge.resendCount >= MAX_RESENDS) {
      throw new ValidationError("Maximum resend limit reached -- request a new challenge instead");
    }

    assertLegalOtpTransition(challenge.status as OtpChallengeStatus, OTP_CHALLENGE_STATUS.SUPERSEDED);
    const [superseded] = await tx.update(businessOtpChallenges).set({ status: OTP_CHALLENGE_STATUS.SUPERSEDED, supersededAt: new Date() })
      .where(and(eq(businessOtpChallenges.id, challengeId), eq(businessOtpChallenges.status, OTP_CHALLENGE_STATUS.PENDING))).returning();
    if (!superseded) throw new AlreadyResolvedError("pending"); // lost the race -- e.g. it was just verified or expired

    const customer = await resolveOwnedCustomer(tx, businessId, challenge.customerId);
    const resolved = await resolveContent(tx, businessId, challenge.templateVersionId ?? undefined);
    const { channel, destination } = resolveDestination(customer, challenge.channel);

    const { challenge: fresh } = await issueChallenge(
      tx, businessId, actorUserId, customer, challenge.purpose as OtpPurpose, channel, destination, resolved,
      superseded.resendCount + 1, superseded.id,
    );

    await createAuditLog(actorUserId, businessId, AUDIT_ACTION_OTP.RESEND_REQUESTED, fresh.id, { supersedes: superseded.id, resendCount: fresh.resendCount });
    return toSafeChallenge(fresh);
  });
}
