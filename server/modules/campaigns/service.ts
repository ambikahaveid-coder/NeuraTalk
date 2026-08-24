/**
 * Business Campaign Engine -- Phase 5 (2026-08-24).
 * See docs/neura-ecosystem/30_CAMPAIGN_ENGINE_IMPLEMENTATION.md.
 *
 * A campaign is an orchestration object, not a message: WHO (immutable
 * campaignRecipients snapshot), WHAT (a fixed, already-approved
 * templateVersions.id), WHEN (scheduledAt), UNDER WHICH AUTHORITY (Approval
 * Center, reused from Phase 3), UNDER WHICH CONSENT (customerConsents,
 * reused from Phase 4), all gated before a single message is ever created.
 * No external channel adapter exists here -- execution creates canonical
 * NEURA messages only (see doc 30 section 21 for the extension boundary).
 */
import { db } from "../../db";
import {
  campaigns,
  campaignRecipients,
  templates,
  templateVersions,
  audiences,
  audienceMembers,
  customers,
  organizations,
  messagingMessages,
  messagingDeliveries,
  messagingEvents,
  CAMPAIGN_STATUS,
  CAMPAIGN_ALLOWED_CATEGORIES,
  CAMPAIGN_RECIPIENT_STATUS,
  CAMPAIGN_SKIP_REASON,
  TEMPLATE_VERSION_STATUS,
  AUDIENCE_STATUS,
  CUSTOMER_STATUS,
  MESSAGE_TYPE,
  MESSAGE_DELIVERY_STATUS,
  MESSAGE_EVENT_TYPE,
  MESSAGE_CATEGORY,
  type CampaignStatus,
  type TemplateVariableDeclaration,
} from "@shared/schema";
import { eq, and, desc, inArray } from "drizzle-orm";
import { assertLegalCampaignTransition, isCampaignEditable, isCampaignCancellable, IllegalCampaignTransitionError } from "./lifecycle";
import { renderTemplateContent, TemplateRenderError } from "../templates/render";
import { isEligibleForChannel } from "../customers/service";
import { findOrCreateCustomerConversation } from "../messaging/service";
import { chargeCampaignMessage, PLACEHOLDER_COST_PER_MESSAGE_PAISE } from "./billing";
import { reserveCustomerFrequencySlot, reserveBusinessThroughputSlot } from "./frequency";
import { createAuditLog, AUDIT_ACTION_CAMPAIGN } from "./audit";

export class NotFoundError extends Error {
  constructor(message: string) { super(message); this.name = "NotFoundError"; }
}
export class ValidationError extends Error {
  constructor(message: string) { super(message); this.name = "ValidationError"; }
}
export { IllegalCampaignTransitionError };

type DbLike = Pick<typeof db, "select" | "update" | "insert">;

// Safety cap on audience size per campaign -- not a throttling engine, just
// a sane upper bound so a single campaign can't be scheduled against an
// unbounded recipient set. Documented, not invented as a real product
// limit (doc 30 section 9/11).
const MAX_RECIPIENTS_PER_CAMPAIGN = 5000;
// Bounded batch per execute() call -- keeps each call's transaction count
// and lock time bounded; a campaign larger than this needs multiple
// execute() calls (manual retriggers or scheduler ticks) to fully drain,
// staying RUNNING in between. See doc 30 section 11.
const MAX_RECIPIENTS_PER_EXECUTE_CALL = 200;
// Campaigns may only personalize with fields NEURA already has robust,
// safe values for. Extending this is a deliberate, reviewed decision, not
// something a template author can silently expand by declaring a new
// variable name (see assertSupportedVariables).
const SUPPORTED_CAMPAIGN_VARIABLES = new Set(["name"]);

function assertValidCategory(category: string): void {
  if (!(CAMPAIGN_ALLOWED_CATEGORIES as readonly string[]).includes(category)) {
    throw new ValidationError(`Invalid campaign category: ${category} (must be one of ${CAMPAIGN_ALLOWED_CATEGORIES.join(", ")})`);
  }
}

function assertSupportedVariables(declarations: TemplateVariableDeclaration[]): void {
  for (const decl of declarations) {
    if (!SUPPORTED_CAMPAIGN_VARIABLES.has(decl.name)) {
      throw new ValidationError(`Template declares unsupported variable "${decl.name}" -- campaigns currently only support {{name}}`);
    }
  }
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

export interface CreateCampaignInput {
  name: string;
  description?: string;
  category: string;
}

export async function createCampaign(businessId: number, actorUserId: number, input: CreateCampaignInput) {
  const [business] = await db.select({ id: organizations.id }).from(organizations).where(eq(organizations.id, businessId));
  if (!business) throw new NotFoundError("Business not found");
  assertValidCategory(input.category);

  const [campaign] = await db.insert(campaigns).values({
    businessId,
    name: input.name,
    description: input.description?.trim() || null,
    category: input.category,
    status: CAMPAIGN_STATUS.DRAFT,
    createdBy: actorUserId,
  }).returning();

  await createAuditLog(actorUserId, businessId, AUDIT_ACTION_CAMPAIGN.CREATED, campaign.id, { name: campaign.name, category: campaign.category });
  return campaign;
}

export async function listCampaigns(businessId: number, status?: string) {
  const conditions = [eq(campaigns.businessId, businessId)];
  if (status) conditions.push(eq(campaigns.status, status));
  return db.select().from(campaigns).where(and(...conditions)).orderBy(desc(campaigns.createdAt));
}

async function getOwnedCampaign(businessId: number, campaignId: number, dbClient: DbLike = db) {
  const [c] = await dbClient.select().from(campaigns).where(and(eq(campaigns.id, campaignId), eq(campaigns.businessId, businessId)));
  if (!c) throw new NotFoundError("Campaign not found");
  return c;
}

export async function getCampaign(businessId: number, campaignId: number) {
  const c = await getOwnedCampaign(businessId, campaignId).catch(() => null);
  if (!c) return null;
  const report = await getCampaignReport(businessId, campaignId);
  return { ...c, report };
}

export interface UpdateCampaignInput {
  name?: string;
  description?: string;
  category?: string;
  templateVersionId?: number;
  audienceId?: number;
}

export async function updateCampaign(businessId: number, actorUserId: number, campaignId: number, input: UpdateCampaignInput) {
  const existing = await getOwnedCampaign(businessId, campaignId);
  if (!isCampaignEditable(existing.status as CampaignStatus)) {
    throw new ValidationError("Campaign can only be edited while in DRAFT");
  }

  const patch: Record<string, unknown> = { updatedAt: new Date() };
  if (input.name !== undefined) patch.name = input.name;
  if (input.description !== undefined) patch.description = input.description.trim() || null;
  if (input.category !== undefined) {
    assertValidCategory(input.category);
    patch.category = input.category;
  }

  if (input.templateVersionId !== undefined) {
    const [version] = await db.select().from(templateVersions).where(eq(templateVersions.id, input.templateVersionId));
    if (!version) throw new NotFoundError("Template version not found");
    const [template] = await db.select().from(templates).where(eq(templates.id, version.templateId));
    if (!template || template.businessId !== businessId) throw new NotFoundError("Template version not found");
    if (version.status !== TEMPLATE_VERSION_STATUS.APPROVED) {
      throw new ValidationError("Campaign can only be bound to an APPROVED template version");
    }
    assertSupportedVariables((version.variables as TemplateVariableDeclaration[]) ?? []);
    patch.templateVersionId = input.templateVersionId;
  }

  if (input.audienceId !== undefined) {
    const [audience] = await db.select().from(audiences).where(and(eq(audiences.id, input.audienceId), eq(audiences.businessId, businessId)));
    if (!audience) throw new NotFoundError("Audience not found");
    if (audience.status !== AUDIENCE_STATUS.ACTIVE) {
      throw new ValidationError("Campaign can only be bound to an active audience");
    }
    const memberRows = await db.select().from(audienceMembers).where(eq(audienceMembers.audienceId, input.audienceId));
    if (memberRows.length > MAX_RECIPIENTS_PER_CAMPAIGN) {
      throw new ValidationError(`Audience exceeds the maximum campaign recipient count (${MAX_RECIPIENTS_PER_CAMPAIGN})`);
    }
    patch.audienceId = input.audienceId;
  }

  const [updated] = await db.update(campaigns).set(patch).where(eq(campaigns.id, campaignId)).returning();
  await createAuditLog(actorUserId, businessId, AUDIT_ACTION_CAMPAIGN.UPDATED, campaignId, { fields: Object.keys(patch) });
  return updated;
}

// ---------------------------------------------------------------------------
// Approval integration (called only from campaigns/approval-policy.ts,
// inside the Approval Center's own transaction -- see doc 30 section 13)
// ---------------------------------------------------------------------------

export async function isCampaignSubmittable(businessId: number, campaignId: number, dbClient: DbLike = db): Promise<boolean> {
  const [c] = await dbClient.select().from(campaigns).where(and(eq(campaigns.id, campaignId), eq(campaigns.businessId, businessId)));
  return !!c && c.status === CAMPAIGN_STATUS.DRAFT && c.templateVersionId != null && c.audienceId != null;
}

export async function getCampaignBusinessId(campaignId: number, dbClient: DbLike = db): Promise<number | null> {
  const [c] = await dbClient.select({ businessId: campaigns.businessId }).from(campaigns).where(eq(campaigns.id, campaignId));
  return c?.businessId ?? null;
}

export async function markCampaignApproved(businessId: number, campaignId: number, actorUserId: number, tx: DbLike = db) {
  await tx.update(campaigns).set({ approvedBy: actorUserId, approvedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(campaigns.id, campaignId), eq(campaigns.businessId, businessId)));
}

// Rejection intentionally does nothing to campaigns.status -- a rejected
// campaign simply stays DRAFT (editable, resubmittable), mirroring how a
// REJECTED template version can be edited and resubmitted. No separate
// "REJECTED" campaign status exists, consistent with campaigns having no
// approval sub-state of their own (see lifecycle.ts's header comment).
export async function markCampaignRejected(_businessId: number, _campaignId: number, _actorUserId: number, _reason: string, _tx: DbLike = db) {
  // no-op by design
}

// ---------------------------------------------------------------------------
// Scheduling / execution
// ---------------------------------------------------------------------------

async function assertReadyToGoLive(businessId: number, campaign: typeof campaigns.$inferSelect, dbClient: DbLike): Promise<{ version: typeof templateVersions.$inferSelect }> {
  if (!campaign.templateVersionId) throw new ValidationError("Campaign has no template bound");
  if (!campaign.audienceId) throw new ValidationError("Campaign has no audience bound");
  if (!campaign.approvedAt) throw new ValidationError("Campaign has not been approved -- submit it to the Approval Center first");

  const [version] = await dbClient.select().from(templateVersions).where(eq(templateVersions.id, campaign.templateVersionId));
  if (!version) throw new ValidationError("Bound template version no longer exists");
  if (version.status !== TEMPLATE_VERSION_STATUS.APPROVED) {
    throw new ValidationError(`Bound template version is no longer APPROVED (currently ${version.status})`);
  }

  const [audience] = await dbClient.select().from(audiences).where(and(eq(audiences.id, campaign.audienceId), eq(audiences.businessId, businessId)));
  if (!audience || audience.status !== AUDIENCE_STATUS.ACTIVE) {
    throw new ValidationError("Bound audience is no longer active");
  }

  return { version };
}

async function snapshotRecipientsIfNeeded(tx: DbLike, businessId: number, campaign: typeof campaigns.$inferSelect) {
  const existing = await tx.select({ id: campaignRecipients.id }).from(campaignRecipients).where(eq(campaignRecipients.campaignId, campaign.id));
  if (existing.length > 0) return; // already snapshotted (e.g. SCHEDULED -> RUNNING re-entry)

  // Server-resolved ONLY -- never accepts recipient ids from the client.
  // Re-verifies audience ownership defensively even though updateCampaign
  // already checked it at bind time (belt-and-suspenders against a bound
  // audience being reassigned to another business in some future feature).
  const members = await tx.select().from(audienceMembers).where(eq(audienceMembers.audienceId, campaign.audienceId!));
  const memberCustomerIds = members.map((m) => m.customerId);
  if (memberCustomerIds.length === 0) return;

  const ownedCustomers = await tx.select({ id: customers.id }).from(customers)
    .where(and(eq(customers.businessId, businessId), inArray(customers.id, memberCustomerIds)));
  const ownedIds = new Set(ownedCustomers.map((c) => c.id));

  for (const customerId of memberCustomerIds) {
    if (!ownedIds.has(customerId)) continue; // cross-business membership row would be a data bug elsewhere; never trust it here
    await tx.insert(campaignRecipients).values({
      campaignId: campaign.id,
      customerId,
      status: CAMPAIGN_RECIPIENT_STATUS.PENDING,
    });
  }
}

export async function scheduleCampaign(businessId: number, actorUserId: number, campaignId: number, scheduledAt: Date) {
  if (!(scheduledAt instanceof Date) || Number.isNaN(scheduledAt.getTime())) {
    throw new ValidationError("Invalid scheduledAt");
  }
  if (scheduledAt.getTime() <= Date.now()) {
    throw new ValidationError("scheduledAt must be in the future");
  }

  return db.transaction(async (tx) => {
    const campaign = await getOwnedCampaign(businessId, campaignId, tx);
    assertLegalCampaignTransition(campaign.status as CampaignStatus, CAMPAIGN_STATUS.SCHEDULED);
    await assertReadyToGoLive(businessId, campaign, tx);

    const [updated] = await tx.update(campaigns).set({
      status: CAMPAIGN_STATUS.SCHEDULED, scheduledAt, updatedAt: new Date(),
    }).where(and(eq(campaigns.id, campaignId), eq(campaigns.status, CAMPAIGN_STATUS.DRAFT))).returning();
    if (!updated) throw new IllegalCampaignTransitionError(campaign.status as CampaignStatus, CAMPAIGN_STATUS.SCHEDULED);

    await snapshotRecipientsIfNeeded(tx, businessId, updated);
    await createAuditLog(actorUserId, businessId, AUDIT_ACTION_CAMPAIGN.SCHEDULED, campaignId, { scheduledAt });
    return updated;
  });
}

export async function cancelCampaign(businessId: number, actorUserId: number, campaignId: number) {
  return db.transaction(async (tx) => {
    const campaign = await getOwnedCampaign(businessId, campaignId, tx);
    if (!isCampaignCancellable(campaign.status as CampaignStatus)) {
      throw new ValidationError(`Campaign cannot be cancelled from status ${campaign.status}`);
    }

    const [updated] = await tx.update(campaigns).set({
      status: CAMPAIGN_STATUS.CANCELLED, cancelledAt: new Date(), cancelledBy: actorUserId, updatedAt: new Date(),
    }).where(and(eq(campaigns.id, campaignId), eq(campaigns.status, campaign.status))).returning();
    if (!updated) throw new ValidationError(`Campaign cannot be cancelled from status ${campaign.status}`);

    await createAuditLog(actorUserId, businessId, AUDIT_ACTION_CAMPAIGN.CANCELLED, campaignId, {});
    return updated;
  });
}

export interface ExecuteResult {
  campaignStatus: CampaignStatus;
  processed: number;
  sent: number;
  skipped: number;
}

/**
 * Idempotent, safe to call repeatedly/concurrently for the same campaign
 * (Section 10/11 of the brief). The DRAFT/SCHEDULED->RUNNING transition is
 * itself an atomic CAS; if this call loses that race (campaign is already
 * RUNNING), it simply joins in and helps drain PENDING recipients rather
 * than erroring -- concurrent execute() calls cooperate, they don't
 * conflict, because every recipient's own processing is ALSO an atomic
 * CAS (see processOneRecipient).
 */
export async function executeCampaign(businessId: number, actorUserId: number | undefined, campaignId: number): Promise<ExecuteResult> {
  const campaign = await getOwnedCampaign(businessId, campaignId);

  let becameRunningNow = false;
  if (campaign.status === CAMPAIGN_STATUS.DRAFT || campaign.status === CAMPAIGN_STATUS.SCHEDULED) {
    const fromStatus = campaign.status;
    assertLegalCampaignTransition(fromStatus as CampaignStatus, CAMPAIGN_STATUS.RUNNING);

    try {
      await db.transaction(async (tx) => {
        const fresh = await getOwnedCampaign(businessId, campaignId, tx);
        if (fresh.status !== fromStatus) throw new IllegalCampaignTransitionError(fresh.status as CampaignStatus, CAMPAIGN_STATUS.RUNNING);

        await assertReadyToGoLive(businessId, fresh, tx);

        const [updated] = await tx.update(campaigns).set({
          status: CAMPAIGN_STATUS.RUNNING, startedAt: new Date(), updatedAt: new Date(),
        }).where(and(eq(campaigns.id, campaignId), eq(campaigns.status, fromStatus))).returning();
        if (!updated) throw new IllegalCampaignTransitionError(fromStatus as CampaignStatus, CAMPAIGN_STATUS.RUNNING);

        await snapshotRecipientsIfNeeded(tx, businessId, updated);
        becameRunningNow = true;
      });
      await createAuditLog(actorUserId, businessId, AUDIT_ACTION_CAMPAIGN.STARTED, campaignId, {});
    } catch (err) {
      if (err instanceof ValidationError) {
        // Readiness gate failed at the moment of going live (e.g. template
        // was archived after scheduling) -- systemic failure, not a
        // per-recipient skip. Transition straight to FAILED.
        await db.transaction(async (tx) => {
          const fresh = await getOwnedCampaign(businessId, campaignId, tx);
          if (fresh.status === CAMPAIGN_STATUS.RUNNING) return; // someone else already started it successfully, don't clobber
          await tx.update(campaigns).set({
            status: CAMPAIGN_STATUS.FAILED, failureReason: err.message, updatedAt: new Date(),
          }).where(and(eq(campaigns.id, campaignId), eq(campaigns.status, fromStatus)));
        });
        await createAuditLog(actorUserId, businessId, AUDIT_ACTION_CAMPAIGN.FAILED, campaignId, { reason: err.message });
        throw err;
      }
      if (err instanceof IllegalCampaignTransitionError) {
        // Lost the CAS race for DRAFT/SCHEDULED->RUNNING. If someone else
        // won it (campaign is now RUNNING), this call simply joins in and
        // helps drain PENDING recipients below rather than erroring --
        // concurrent execute() calls cooperate, they don't conflict. Any
        // OTHER current status (e.g. it raced against a cancel) is a real
        // conflict and must still be reported as such.
        const nowCampaign = await getOwnedCampaign(businessId, campaignId);
        if (nowCampaign.status !== CAMPAIGN_STATUS.RUNNING) throw err;
      } else {
        throw err;
      }
    }
  } else if (campaign.status !== CAMPAIGN_STATUS.RUNNING) {
    throw new ValidationError(`Campaign cannot be executed from status ${campaign.status}`);
  }

  const pending = await db.select().from(campaignRecipients)
    .where(and(eq(campaignRecipients.campaignId, campaignId), eq(campaignRecipients.status, CAMPAIGN_RECIPIENT_STATUS.PENDING)))
    .limit(MAX_RECIPIENTS_PER_EXECUTE_CALL);

  const current = await getOwnedCampaign(businessId, campaignId);
  const version = current.templateVersionId
    ? (await db.select().from(templateVersions).where(eq(templateVersions.id, current.templateVersionId)))[0]
    : undefined;

  let sent = 0, skipped = 0;
  for (const recipient of pending) {
    const result = await processOneRecipient(businessId, current, version, recipient);
    if (result === "sent") sent++;
    else if (result === "skipped") skipped++;
  }

  // Completion check: only the run that observes zero remaining PENDING
  // rows transitions to COMPLETED -- an atomic CAS on campaigns.status
  // guards against two concurrent calls both trying to complete it.
  const stillPending = await db.select({ id: campaignRecipients.id }).from(campaignRecipients)
    .where(and(eq(campaignRecipients.campaignId, campaignId), eq(campaignRecipients.status, CAMPAIGN_RECIPIENT_STATUS.PENDING)));

  let finalStatus: CampaignStatus = CAMPAIGN_STATUS.RUNNING;
  if (stillPending.length === 0) {
    const [completed] = await db.update(campaigns).set({
      status: CAMPAIGN_STATUS.COMPLETED, completedAt: new Date(), updatedAt: new Date(),
    }).where(and(eq(campaigns.id, campaignId), eq(campaigns.status, CAMPAIGN_STATUS.RUNNING))).returning();
    if (completed) {
      finalStatus = CAMPAIGN_STATUS.COMPLETED;
      await createAuditLog(actorUserId, businessId, AUDIT_ACTION_CAMPAIGN.COMPLETED, campaignId, {});
    } else {
      finalStatus = (await getOwnedCampaign(businessId, campaignId)).status as CampaignStatus;
    }
  }

  return { campaignStatus: finalStatus, processed: pending.length, sent, skipped };
}

type RecipientOutcome = "sent" | "skipped" | "already_processed";

async function processOneRecipient(
  businessId: number,
  campaign: typeof campaigns.$inferSelect,
  version: (typeof templateVersions.$inferSelect) | undefined,
  recipient: typeof campaignRecipients.$inferSelect,
): Promise<RecipientOutcome> {
  return db.transaction(async (tx) => {
    const [current] = await tx.select().from(campaignRecipients).where(eq(campaignRecipients.id, recipient.id));
    if (!current || current.status !== CAMPAIGN_RECIPIENT_STATUS.PENDING) return "already_processed";

    async function skip(reason: string): Promise<RecipientOutcome> {
      const [updated] = await tx.update(campaignRecipients).set({
        status: CAMPAIGN_RECIPIENT_STATUS.SKIPPED, skipReason: reason, processedAt: new Date(),
      }).where(and(eq(campaignRecipients.id, recipient.id), eq(campaignRecipients.status, CAMPAIGN_RECIPIENT_STATUS.PENDING))).returning();
      if (!updated) return "already_processed"; // lost the race -- tx rolls back this no-op update, safe
      return "skipped";
    }

    const [customer] = await tx.select().from(customers).where(and(eq(customers.id, current.customerId), eq(customers.businessId, businessId)));
    if (!customer) return skip(CAMPAIGN_SKIP_REASON.SYSTEM_ERROR);
    if (customer.status === CUSTOMER_STATUS.BLOCKED) return skip(CAMPAIGN_SKIP_REASON.CUSTOMER_BLOCKED);
    if (customer.status === CUSTOMER_STATUS.ARCHIVED) return skip(CAMPAIGN_SKIP_REASON.CUSTOMER_ARCHIVED);

    const eligible = await isEligibleForChannel(businessId, customer.id, campaign.category as any);
    if (!eligible) return skip(CAMPAIGN_SKIP_REASON.CONSENT_MISSING);

    if (!version || version.status !== TEMPLATE_VERSION_STATUS.APPROVED) {
      return skip(CAMPAIGN_SKIP_REASON.TEMPLATE_NOT_APPROVED);
    }

    // Frequency/throughput gates -- MARKETING only (doc 34 section 3).
    // Reserved AFTER every other eligibility/template check (so a send
    // that wouldn't happen anyway never consumes frequency budget) and
    // BEFORE billing (so a capped-out send is never charged). Atomic
    // per-slot reservation -- see campaigns/frequency.ts for the
    // concurrency proof.
    if (campaign.category === MESSAGE_CATEGORY.MARKETING) {
      const customerSlot = await reserveCustomerFrequencySlot(tx, businessId, customer.id);
      if (!customerSlot.allowed) return skip(CAMPAIGN_SKIP_REASON.CUSTOMER_FREQUENCY_CAP_EXCEEDED);

      const businessSlot = await reserveBusinessThroughputSlot(tx, businessId);
      if (!businessSlot.allowed) return skip(CAMPAIGN_SKIP_REASON.BUSINESS_THROUGHPUT_CAP_EXCEEDED);
    }

    let rendered: string;
    try {
      const values: Record<string, unknown> = customer.name ? { name: customer.name } : {};
      rendered = renderTemplateContent(version.content, (version.variables as TemplateVariableDeclaration[]) ?? [], values).rendered;
    } catch (err) {
      if (err instanceof TemplateRenderError) return skip(CAMPAIGN_SKIP_REASON.RENDER_FAILED);
      throw err;
    }

    const charge = await chargeCampaignMessage(tx, businessId, PLACEHOLDER_COST_PER_MESSAGE_PAISE);
    if (!charge.charged) {
      return skip(charge.reason === "billing_not_configured" ? CAMPAIGN_SKIP_REASON.BILLING_NOT_CONFIGURED : CAMPAIGN_SKIP_REASON.INSUFFICIENT_CREDIT);
    }

    const { conversation, businessConversation, participants } = await findOrCreateCustomerConversation(tx, businessId, customer.id);
    const businessParticipant = participants.find((p) => p.participantType === "business");
    const customerParticipant = participants.find((p) => p.participantType === "customer");
    if (!businessParticipant || !customerParticipant) return skip(CAMPAIGN_SKIP_REASON.SYSTEM_ERROR);

    const [message] = await tx.insert(messagingMessages).values({
      conversationId: conversation.id,
      senderParticipantId: businessParticipant.id,
      messageType: MESSAGE_TYPE.TEMPLATE,
      category: campaign.category,
      content: rendered,
      templateId: version.templateId,
    }).returning();

    await tx.insert(messagingDeliveries).values({
      messageId: message.id, participantId: customerParticipant.id, status: MESSAGE_DELIVERY_STATUS.QUEUED,
    });

    // generationSource established server-side ONLY -- never from any
    // client input, since this whole function has no client-facing
    // entrypoint at all (doc 25 compliance, doc 30 section 17).
    await tx.insert(messagingEvents).values({
      conversationId: conversation.id,
      messageId: message.id,
      eventType: MESSAGE_EVENT_TYPE.MESSAGE_CREATED,
      payload: { senderParticipantId: businessParticipant.id, recipientCount: 1, generationSource: { type: "campaign", id: campaign.id } },
    });

    const [updated] = await tx.update(campaignRecipients).set({
      status: CAMPAIGN_RECIPIENT_STATUS.SENT, messageId: message.id, chargedPaise: charge.costPaise, processedAt: new Date(),
    }).where(and(eq(campaignRecipients.id, recipient.id), eq(campaignRecipients.status, CAMPAIGN_RECIPIENT_STATUS.PENDING))).returning();

    if (!updated) {
      // Lost the race after doing the work -- throwing rolls back this
      // ENTIRE transaction (message, delivery, event, charge included),
      // so no double-send and no double-charge is left behind.
      throw new Error("RACE_LOST");
    }

    void businessConversation; // referenced for clarity of destructure; not otherwise needed here
    return "sent";
  }).catch((err) => {
    if (err instanceof Error && err.message === "RACE_LOST") return "already_processed" as RecipientOutcome;
    throw err;
  });
}

// ---------------------------------------------------------------------------
// Reporting foundation (doc 30 section 16) -- durable counts derived from
// campaignRecipients, never fabricated. "Sent" is never assumed merely
// because a campaign was created or scheduled.
// ---------------------------------------------------------------------------

export interface CampaignReport {
  targeted: number;
  pending: number;
  sent: number;
  skipped: number;
  skippedByReason: Record<string, number>;
}

export async function getCampaignReport(businessId: number, campaignId: number): Promise<CampaignReport> {
  await getOwnedCampaign(businessId, campaignId);
  const rows = await db.select().from(campaignRecipients).where(eq(campaignRecipients.campaignId, campaignId));

  const report: CampaignReport = { targeted: rows.length, pending: 0, sent: 0, skipped: 0, skippedByReason: {} };
  for (const row of rows) {
    if (row.status === CAMPAIGN_RECIPIENT_STATUS.PENDING) report.pending++;
    else if (row.status === CAMPAIGN_RECIPIENT_STATUS.SENT) report.sent++;
    else if (row.status === CAMPAIGN_RECIPIENT_STATUS.SKIPPED) {
      report.skipped++;
      const reason = row.skipReason ?? "unknown";
      report.skippedByReason[reason] = (report.skippedByReason[reason] ?? 0) + 1;
    }
  }
  return report;
}
