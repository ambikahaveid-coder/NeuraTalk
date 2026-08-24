/**
 * Business Utility Messaging -- Phase 7 (2026-08-24).
 * See docs/neura-ecosystem/32_BUSINESS_UTILITY_MESSAGING_IMPLEMENTATION.md.
 *
 * `triggerUtilityMessage` is an INTERNAL, server-side-only function --
 * there is no HTTP route that calls it (doc 32 section 4: "do not allow
 * arbitrary utility messages directly from a client"). It is meant to be
 * called by a future real event producer (a booking/order/payment module,
 * once one exists) the same way any internal module calls createAuditLog
 * -- trusted because the CALLER is trusted server-side code, not because
 * this function re-verifies the event against an external system of
 * record that doesn't exist yet in this codebase (documented trust
 * boundary, section 6).
 */
import { db } from "../../db";
import {
  businessUtilityEvents,
  customers,
  organizations,
  templates,
  templateVersions,
  messagingMessages,
  messagingDeliveries,
  messagingEvents,
  UTILITY_EVENT_TYPE,
  UTILITY_MESSAGE_STATUS,
  UTILITY_FAILURE_REASON,
  CUSTOMER_STATUS,
  MESSAGE_CATEGORY,
  MESSAGE_TYPE,
  MESSAGE_DELIVERY_STATUS,
  MESSAGE_EVENT_TYPE,
  TEMPLATE_VERSION_STATUS,
  type UtilityEventType,
  type UtilityFailureReason,
  type TemplateVariableDeclaration,
} from "@shared/schema";
import { eq, and, desc } from "drizzle-orm";
import { renderTemplateContent, TemplateRenderError } from "../templates/render";
import { findOrCreateCustomerConversation } from "../messaging/service";
import { chargeUtilityMessage, PLACEHOLDER_COST_PER_UTILITY_MESSAGE_PAISE } from "./billing";
import { createAuditLog, AUDIT_ACTION_UTILITY } from "./audit";

export class NotFoundError extends Error {
  constructor(message: string) { super(message); this.name = "NotFoundError"; }
}
export class ValidationError extends Error {
  constructor(message: string) { super(message); this.name = "ValidationError"; }
}
/** Structured, typed outcome for a rejected trigger -- carries the same governed UTILITY_FAILURE_REASON the persisted row uses, so callers can branch on it without string-matching a message. */
export class UtilityTriggerFailedError extends Error {
  constructor(public readonly reason: UtilityFailureReason, public readonly eventId: number) {
    super(`Utility event trigger failed: ${reason}`);
    this.name = "UtilityTriggerFailedError";
  }
}

type DbLike = Pick<typeof db, "select" | "update" | "insert">;

function isUniqueViolation(err: unknown): boolean {
  const code = (err as any)?.code ?? (err as any)?.cause?.code;
  return code === "23505" || (err instanceof Error && err.message === "UNIQUE_VIOLATION");
}

function assertValidEventType(eventType: string): asserts eventType is UtilityEventType {
  if (!Object.values(UTILITY_EVENT_TYPE).includes(eventType as UtilityEventType)) {
    throw new ValidationError(`Invalid utility event type: ${eventType}`);
  }
}

/**
 * Atomically claims the idempotency key (businessId, eventType,
 * eventReference) by attempting the insert itself -- the SAME row that
 * results from this insert IS the claim, no separate lock table needed.
 * A concurrent/replayed trigger for the same key hits the DB's own unique
 * constraint (or, in this test suite's fake DB, an equivalent simulated
 * violation) and is told about the EXISTING row instead of creating a
 * second one -- proven under genuine Promise.allSettled concurrency
 * (doc 32 section 11/12).
 */
async function claimEvent(tx: DbLike, businessId: number, eventType: UtilityEventType, eventReference: string, customerId: number, templateVersionId: number, actorUserId: number | undefined) {
  try {
    const [row] = await tx.insert(businessUtilityEvents).values({
      businessId, customerId, eventType, eventReference, templateVersionId,
      status: UTILITY_MESSAGE_STATUS.FAILED, // provisional -- promoted to CREATED only on full success
      createdBy: actorUserId ?? null,
    }).returning();
    return { row, isNew: true as const };
  } catch (err) {
    if (!isUniqueViolation(err)) throw err;
    const [existing] = await tx.select().from(businessUtilityEvents).where(and(
      eq(businessUtilityEvents.businessId, businessId),
      eq(businessUtilityEvents.eventType, eventType),
      eq(businessUtilityEvents.eventReference, eventReference),
    ));
    if (!existing) throw err; // shouldn't happen -- the violation implies a row exists
    return { row: existing, isNew: false as const };
  }
}

async function resolveOwnedCustomer(tx: DbLike, businessId: number, customerId: number) {
  const [customer] = await tx.select().from(customers).where(and(eq(customers.id, customerId), eq(customers.businessId, businessId)));
  if (!customer) throw new NotFoundError("Customer not found");
  return customer;
}

interface ResolvedTemplate {
  templateId: number;
  content: string;
  variables: TemplateVariableDeclaration[];
}

/** Category is checked against the template's OWN stored row -- never accepted as client/caller input. This is the mechanism that answers "utility != marketing" (doc 32 section 10): approval + category governance, not content classification, which this phase explicitly does not attempt. */
async function resolveUtilityTemplate(tx: DbLike, businessId: number, templateVersionId: number): Promise<ResolvedTemplate> {
  const [version] = await tx.select().from(templateVersions).where(eq(templateVersions.id, templateVersionId));
  if (!version) throw new NotFoundError("Template version not found");
  const [template] = await tx.select().from(templates).where(eq(templates.id, version.templateId));
  if (!template || template.businessId !== businessId) throw new NotFoundError("Template version not found");
  if (template.category !== MESSAGE_CATEGORY.UTILITY) {
    throw new UtilityCategoryError(UTILITY_FAILURE_REASON.TEMPLATE_NOT_UTILITY_CATEGORY);
  }
  if (version.status !== TEMPLATE_VERSION_STATUS.APPROVED) {
    throw new UtilityCategoryError(UTILITY_FAILURE_REASON.TEMPLATE_NOT_APPROVED);
  }
  return { templateId: template.id, content: version.content, variables: (version.variables as TemplateVariableDeclaration[]) ?? [] };
}

/** Internal-only signal carrying a governed failure reason -- caught and translated inside triggerUtilityMessage, never leaks past this file. */
class UtilityCategoryError extends Error {
  constructor(public readonly reason: UtilityFailureReason) { super(reason); }
}

export interface TriggerUtilityMessageInput {
  eventType: string;
  eventReference: string;
  customerId: number;
  templateVersionId: number;
  /** Values for the template's OWN declared variables (validated by the existing Phase 2 renderer). "name", if declared, is ALWAYS server-overridden from the customer record regardless of what's supplied here -- the one field this function can independently verify. */
  variables?: Record<string, unknown>;
  actorUserId?: number;
}

export interface TriggerUtilityMessageResult {
  event: typeof businessUtilityEvents.$inferSelect;
  wasDuplicate: boolean;
}

export async function triggerUtilityMessage(businessId: number, input: TriggerUtilityMessageInput): Promise<TriggerUtilityMessageResult> {
  const { eventType, eventReference, customerId, templateVersionId } = input;
  assertValidEventType(eventType);
  if (!eventReference || !eventReference.trim()) throw new ValidationError("eventReference is required");

  return db.transaction(async (tx) => {
    const [business] = await tx.select({ id: organizations.id }).from(organizations).where(eq(organizations.id, businessId));
    if (!business) throw new NotFoundError("Business not found");

    // Resolve customer/template BEFORE claiming the idempotency key so a
    // malformed request (bad customerId/templateVersionId) never consumes
    // a real event slot -- only a structurally valid trigger claims one.
    const customer = await resolveOwnedCustomer(tx, businessId, customerId);

    const { row: claimed, isNew } = await claimEvent(tx, businessId, eventType, eventReference, customerId, templateVersionId, input.actorUserId);
    if (!isNew) {
      return { event: claimed, wasDuplicate: true };
    }

    const fail = async (reason: UtilityFailureReason): Promise<never> => {
      await tx.update(businessUtilityEvents).set({ failureReason: reason, processedAt: new Date() })
        .where(eq(businessUtilityEvents.id, claimed.id));
      await createAuditLog(input.actorUserId, businessId, AUDIT_ACTION_UTILITY.EVENT_FAILED, claimed.id, { eventType, reason });
      throw new UtilityTriggerFailedError(reason, claimed.id);
    };

    if (customer.status === CUSTOMER_STATUS.BLOCKED) return fail(UTILITY_FAILURE_REASON.CUSTOMER_BLOCKED);
    if (customer.status === CUSTOMER_STATUS.ARCHIVED) return fail(UTILITY_FAILURE_REASON.CUSTOMER_ARCHIVED);

    let resolvedTemplate: ResolvedTemplate;
    try {
      resolvedTemplate = await resolveUtilityTemplate(tx, businessId, templateVersionId);
    } catch (err) {
      if (err instanceof UtilityCategoryError) return fail(err.reason);
      if (err instanceof NotFoundError) throw err; // a genuinely wrong/cross-business templateVersionId is a caller bug, not a "failed event" outcome
      throw err;
    }

    const values: Record<string, unknown> = { ...(input.variables ?? {}) };
    if (resolvedTemplate.variables.some((v) => v.name === "name")) {
      values.name = customer.name ?? undefined; // server-resolved, never trusts a caller-supplied "name"
    }

    let rendered: string;
    try {
      rendered = renderTemplateContent(resolvedTemplate.content, resolvedTemplate.variables, values).rendered;
    } catch (err) {
      if (err instanceof TemplateRenderError) return fail(UTILITY_FAILURE_REASON.RENDER_FAILED);
      throw err;
    }

    const charge = await chargeUtilityMessage(tx, businessId, PLACEHOLDER_COST_PER_UTILITY_MESSAGE_PAISE);
    if (!charge.charged) {
      return fail(charge.reason === "billing_not_configured" ? UTILITY_FAILURE_REASON.BILLING_NOT_CONFIGURED : UTILITY_FAILURE_REASON.INSUFFICIENT_CREDIT);
    }

    const { conversation, participants } = await findOrCreateCustomerConversation(tx, businessId, customer.id);
    const businessParticipant = participants.find((p) => p.participantType === "business");
    const customerParticipant = participants.find((p) => p.participantType === "customer");
    if (!businessParticipant || !customerParticipant) return fail(UTILITY_FAILURE_REASON.SYSTEM_ERROR);

    const [message] = await tx.insert(messagingMessages).values({
      conversationId: conversation.id,
      senderParticipantId: businessParticipant.id,
      messageType: MESSAGE_TYPE.TEMPLATE,
      category: MESSAGE_CATEGORY.UTILITY,
      content: rendered,
      templateId: resolvedTemplate.templateId,
    }).returning();

    await tx.insert(messagingDeliveries).values({
      messageId: message.id, participantId: customerParticipant.id, status: MESSAGE_DELIVERY_STATUS.QUEUED,
    });

    // generationSource established server-side ONLY -- same rule as
    // Campaigns/OTP, no client input path reaches this at all.
    await tx.insert(messagingEvents).values({
      conversationId: conversation.id,
      messageId: message.id,
      eventType: MESSAGE_EVENT_TYPE.MESSAGE_CREATED,
      payload: { senderParticipantId: businessParticipant.id, recipientCount: 1, generationSource: { type: "utility_event", id: claimed.id } },
    });

    const [updated] = await tx.update(businessUtilityEvents).set({
      status: UTILITY_MESSAGE_STATUS.CREATED, messageId: message.id, chargedPaise: charge.costPaise, processedAt: new Date(),
    }).where(eq(businessUtilityEvents.id, claimed.id)).returning();

    await createAuditLog(input.actorUserId, businessId, AUDIT_ACTION_UTILITY.EVENT_CREATED, claimed.id, { eventType, templateVersionId });
    return { event: updated, wasDuplicate: false };
  });
}

export async function listUtilityEvents(businessId: number, customerId?: number, status?: string) {
  const conditions = [eq(businessUtilityEvents.businessId, businessId)];
  if (customerId !== undefined) conditions.push(eq(businessUtilityEvents.customerId, customerId));
  if (status !== undefined) conditions.push(eq(businessUtilityEvents.status, status));
  return db.select().from(businessUtilityEvents).where(and(...conditions)).orderBy(desc(businessUtilityEvents.createdAt));
}

export async function getUtilityEvent(businessId: number, eventId: number) {
  const [row] = await db.select().from(businessUtilityEvents).where(and(eq(businessUtilityEvents.id, eventId), eq(businessUtilityEvents.businessId, businessId)));
  return row ?? null;
}

export interface UtilityReport {
  received: number;
  created: number;
  failed: number;
  failedByReason: Record<string, number>;
}

/** Durable, derived-only reporting (doc 32 section 19) -- never a fabricated "delivered" claim; QUEUED-only delivery state is all this phase can honestly report, since no channel adapter exists to progress it further. */
export async function getUtilityReport(businessId: number): Promise<UtilityReport> {
  const rows = await db.select().from(businessUtilityEvents).where(eq(businessUtilityEvents.businessId, businessId));
  const report: UtilityReport = { received: rows.length, created: 0, failed: 0, failedByReason: {} };
  for (const row of rows) {
    if (row.status === UTILITY_MESSAGE_STATUS.CREATED) report.created++;
    else if (row.status === UTILITY_MESSAGE_STATUS.FAILED) {
      report.failed++;
      const reason = row.failureReason ?? "unknown";
      report.failedByReason[reason] = (report.failedByReason[reason] ?? 0) + 1;
    }
  }
  return report;
}
