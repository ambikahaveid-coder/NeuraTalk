/**
 * Canonical messaging foundation -- Phase 0 (2026-08-23).
 * See docs/neura-ecosystem/24_CANONICAL_MESSAGING_FOUNDATION.md.
 *
 * Scope: create/read a BusinessConversation and canonical Messages inside
 * it, with tenant isolation, participant validation, and transactional
 * delivery/event fan-out. Nothing here touches the existing AI chat,
 * personal chat, or group chat systems.
 */
import { db } from "../../db";
import {
  messagingConversations,
  businessConversations,
  messagingParticipants,
  messagingMessages,
  messagingDeliveries,
  messagingEvents,
  users,
  organizations,
  customers,
  MESSAGING_CONVERSATION_TYPE,
  MESSAGING_PARTICIPANT_TYPE,
  MESSAGE_CATEGORY,
  MESSAGE_TYPE,
  MESSAGE_DELIVERY_STATUS,
  MESSAGE_EVENT_TYPE,
  type MessagingParticipantType,
} from "@shared/schema";
import { eq, and, isNull, desc, ne, inArray } from "drizzle-orm";
import { findOrCreateCustomerByLinkedUser } from "../customers/service";
import { createAuditLog } from "../../audit";
import { AUDIT_ACTION } from "@shared/schema";

export class InvalidParticipantError extends Error {
  constructor(public readonly participantType: string) {
    super(`Invalid or unsupported participant: type=${participantType}`);
    this.name = "InvalidParticipantError";
  }
}
export class NotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotFoundError";
  }
}
/** The authenticated caller has no participant record in this conversation. */
export class NotAParticipantError extends Error {
  constructor() {
    super("You are not a participant in this conversation");
    this.name = "NotAParticipantError";
  }
}
/**
 * The client supplied a senderParticipantId that does not match the
 * participant record resolved from the authenticated caller's own
 * identity. Never silently substituted -- always rejected (P1 fix,
 * 2026-08-23, see docs/neura-ecosystem/24_CANONICAL_MESSAGING_FOUNDATION.md
 * section 16).
 */
export class SenderIdentityMismatchError extends Error {
  constructor() {
    super("senderParticipantId does not match your own participant identity in this conversation");
    this.name = "SenderIdentityMismatchError";
  }
}

/**
 * Phase 0 only supported participant types with a real backing table to
 * validate against ("strict application-layer validation before accepting
 * the participant" -- participantId is polymorphic and carries no DB FK,
 * see doc 24 section 13). `ai_agent` still has no backing table and is
 * deliberately rejected here, not silently accepted with an unvalidated
 * reference. `customer` gained a real backing table in Phase 4 -- its
 * validation additionally requires `businessId` (passed by the caller, the
 * only participant type that needs it here since USER/BUSINESS ownership
 * isn't scoped the same way) to confirm the customer belongs to the SAME
 * business as this conversation, not just that the row exists somewhere.
 */
async function assertValidParticipant(
  tx: Pick<typeof db, "select">,
  participantType: string,
  participantId: number,
  businessId?: number,
): Promise<void> {
  if (participantType === MESSAGING_PARTICIPANT_TYPE.USER) {
    const [row] = await tx.select({ id: users.id }).from(users).where(eq(users.id, participantId));
    if (!row) throw new InvalidParticipantError(participantType);
    return;
  }
  if (participantType === MESSAGING_PARTICIPANT_TYPE.BUSINESS) {
    const [row] = await tx.select({ id: organizations.id }).from(organizations).where(eq(organizations.id, participantId));
    if (!row) throw new InvalidParticipantError(participantType);
    return;
  }
  if (participantType === MESSAGING_PARTICIPANT_TYPE.CUSTOMER) {
    const conditions = [eq(customers.id, participantId)];
    if (businessId !== undefined) conditions.push(eq(customers.businessId, businessId));
    const [row] = await tx.select({ id: customers.id }).from(customers).where(and(...conditions));
    if (!row) throw new InvalidParticipantError(participantType);
    return;
  }
  throw new InvalidParticipantError(participantType);
}

export interface CreateBusinessConversationInput {
  businessId: number;
  customerId?: number; // Phase 4/5: when set, wires businessConversations.customerId and is also validated/added as a CUSTOMER-type participant
  additionalParticipants?: Array<{ participantType: MessagingParticipantType; participantId: number; role?: string }>;
}

export interface CreateBusinessConversationResult {
  businessConversation: typeof businessConversations.$inferSelect;
  conversation: typeof messagingConversations.$inferSelect;
  participants: (typeof messagingParticipants.$inferSelect)[];
}

// Same DbLike convention as templates/approvals -- lets this run either
// standalone (own transaction) or composed inside a caller's own
// transaction (Phase 5's campaign send path).
type DbLike = Pick<typeof db, "select" | "update" | "insert">;

async function createBusinessConversationTx(
  tx: DbLike,
  input: CreateBusinessConversationInput,
): Promise<CreateBusinessConversationResult> {
  const [business] = await tx.select({ id: organizations.id }).from(organizations).where(eq(organizations.id, input.businessId));
  if (!business) throw new NotFoundError("Business not found");

  if (input.customerId !== undefined) {
    await assertValidParticipant(tx, MESSAGING_PARTICIPANT_TYPE.CUSTOMER, input.customerId, input.businessId);
  }

  const [conversation] = await tx.insert(messagingConversations).values({
    type: MESSAGING_CONVERSATION_TYPE.BUSINESS,
    organizationId: input.businessId,
  }).returning();

  const [bizConversation] = await tx.insert(businessConversations).values({
    conversationId: conversation.id,
    businessId: input.businessId,
    customerId: input.customerId ?? null,
    // Explicit (P1-6): a new conversation always starts unassigned.
    // Postgres would default an omitted nullable column to NULL anyway, so
    // this doesn't change runtime behavior against the real database, but
    // makes the assignment lifecycle's starting state visible here rather
    // than implicit, and matches customerId's own explicit-null convention
    // right above.
    assignedToUserId: null,
  }).returning();

  const participants: (typeof messagingParticipants.$inferSelect)[] = [];

  const [businessParticipant] = await tx.insert(messagingParticipants).values({
    conversationId: conversation.id,
    participantType: MESSAGING_PARTICIPANT_TYPE.BUSINESS,
    participantId: input.businessId,
    role: "business",
  }).returning();
  participants.push(businessParticipant);

  if (input.customerId !== undefined) {
    const [customerParticipant] = await tx.insert(messagingParticipants).values({
      conversationId: conversation.id,
      participantType: MESSAGING_PARTICIPANT_TYPE.CUSTOMER,
      participantId: input.customerId,
      role: "customer",
    }).returning();
    participants.push(customerParticipant);
  }

  for (const p of input.additionalParticipants ?? []) {
    await assertValidParticipant(tx, p.participantType, p.participantId, input.businessId);
    const [row] = await tx.insert(messagingParticipants).values({
      conversationId: conversation.id,
      participantType: p.participantType,
      participantId: p.participantId,
      role: p.role,
    }).returning();
    participants.push(row);
  }

  await tx.insert(messagingEvents).values({
    conversationId: conversation.id,
    eventType: MESSAGE_EVENT_TYPE.CONVERSATION_CREATED,
    payload: { businessId: input.businessId },
  });

  return { businessConversation: bizConversation, conversation, participants };
}

/**
 * Atomically creates businessConversations + messagingConversations + the
 * business's own participant row (always) + any additional validated
 * participants + a conversation.created event. Rolls back entirely on any
 * failure -- no partially-created conversation.
 */
export async function createBusinessConversation(
  input: CreateBusinessConversationInput,
): Promise<CreateBusinessConversationResult> {
  return db.transaction((tx) => createBusinessConversationTx(tx, input));
}

/**
 * Returns the existing businessConversation between this business and this
 * customer if one exists, otherwise creates one -- used by the campaign
 * send path (Phase 5) so a customer accumulates ONE ongoing conversation
 * with a business across multiple campaigns/messages, not a new one per
 * send. `tx` is required (not defaulted) so callers compose this inside
 * their own transaction, keeping "find-or-create conversation" + "create
 * message" + "charge" atomic together.
 */
export async function findOrCreateCustomerConversation(
  tx: DbLike,
  businessId: number,
  customerId: number,
): Promise<CreateBusinessConversationResult> {
  const [existing] = await tx.select().from(businessConversations)
    .where(and(eq(businessConversations.businessId, businessId), eq(businessConversations.customerId, customerId)));

  if (existing) {
    const [conversation] = await tx.select().from(messagingConversations).where(eq(messagingConversations.id, existing.conversationId));
    const participants = await tx.select().from(messagingParticipants).where(eq(messagingParticipants.conversationId, existing.conversationId));
    return { businessConversation: existing, conversation, participants };
  }

  return createBusinessConversationTx(tx, { businessId, customerId });
}

/**
 * Tenant-scoped fetch: the WHERE clause itself enforces businessId
 * ownership (not a post-fetch check), closing the IDOR shape doc 19/24
 * flagged (id/URL/body/query manipulation).
 */
export async function getBusinessConversation(businessId: number, conversationId: number) {
  const [row] = await db.select().from(businessConversations)
    .where(and(eq(businessConversations.id, conversationId), eq(businessConversations.businessId, businessId)));
  if (!row) return null;

  const [conversation] = await db.select().from(messagingConversations).where(eq(messagingConversations.id, row.conversationId));
  const participants = await db.select().from(messagingParticipants).where(eq(messagingParticipants.conversationId, row.conversationId));

  return { businessConversation: row, conversation, participants };
}

export interface CreateMessageInput {
  businessId: number;
  businessConversationId: number;
  /** The authenticated caller's own user id (req.user.id) -- NEVER a
   * client-suppliable value. The message sender is always resolved from
   * this, never trusted from the request body. */
  authenticatedUserId: number;
  /** Optional, client-supplied -- treated ONLY as a consistency check
   * against the participant resolved from authenticatedUserId. If present
   * and it doesn't match, the request is rejected outright; it is never
   * used to pick a different sender. See SenderIdentityMismatchError. */
  senderParticipantId?: number;
  content: string;
  messageType?: string;
}

export interface CreateMessageResult {
  message: typeof messagingMessages.$inferSelect;
  deliveries: (typeof messagingDeliveries.$inferSelect)[];
}

/**
 * Category is NEVER accepted from the caller (structural governance per
 * doc 24 section 6) -- Phase 0 always writes `conversational`. Marketing/
 * authentication/utility categories are set only by their own dedicated
 * send paths, which don't exist yet.
 *
 * Sender identity (P1 fix, 2026-08-23): the actual sender participant is
 * ALWAYS resolved server-side from `authenticatedUserId` -- the caller's
 * own `messaging_participants` row (participantType='user', participantId
 * = authenticatedUserId) in this specific conversation. A client-supplied
 * `senderParticipantId` is never trusted as the write value; if present it
 * must match the resolved participant or the request is rejected. A caller
 * with no participant row in this conversation is rejected as a
 * non-member -- Phase 0 does not auto-join business members into
 * conversations they weren't explicitly added to.
 */
// tx-composable core, same convention as createBusinessConversationTx above
// -- extracted (2026-08-25, P1-1) so sendUserInitiatedMessage can compose
// message creation inside its own outer transaction (find-or-create
// customer + find-or-create conversation + ensure participant + create
// message, all atomic together) without nesting db.transaction() calls,
// which is unsafe. createMessage()'s own external behavior/signature is
// unchanged for every existing caller.
async function createMessageTx(tx: DbLike, input: CreateMessageInput): Promise<CreateMessageResult> {
  const [bizConversation] = await tx.select().from(businessConversations)
    .where(and(eq(businessConversations.id, input.businessConversationId), eq(businessConversations.businessId, input.businessId)));
  if (!bizConversation) throw new NotFoundError("Conversation not found");

  const [ownParticipant] = await tx.select().from(messagingParticipants)
    .where(and(
      eq(messagingParticipants.conversationId, bizConversation.conversationId),
      eq(messagingParticipants.participantType, MESSAGING_PARTICIPANT_TYPE.USER),
      eq(messagingParticipants.participantId, input.authenticatedUserId),
    ));
  if (!ownParticipant) throw new NotAParticipantError();

  if (input.senderParticipantId !== undefined && input.senderParticipantId !== ownParticipant.id) {
    throw new SenderIdentityMismatchError();
  }
  const senderParticipantId = ownParticipant.id;

  const content = input.content?.trim();
  if (!content) throw new Error("VALIDATION_EMPTY_CONTENT");
  if (content.length > 8192) throw new Error("VALIDATION_CONTENT_TOO_LONG");

  const messageType = input.messageType && Object.values(MESSAGE_TYPE).includes(input.messageType as any)
    ? input.messageType
    : MESSAGE_TYPE.TEXT;

  const [message] = await tx.insert(messagingMessages).values({
    conversationId: bizConversation.conversationId,
    senderParticipantId,
    messageType,
    category: MESSAGE_CATEGORY.CONVERSATIONAL,
    content,
  }).returning();

  const recipients = await tx.select().from(messagingParticipants)
    .where(and(
      eq(messagingParticipants.conversationId, bizConversation.conversationId),
      ne(messagingParticipants.id, senderParticipantId),
    ));

  const deliveries: (typeof messagingDeliveries.$inferSelect)[] = [];
  for (const recipient of recipients) {
    const [delivery] = await tx.insert(messagingDeliveries).values({
      messageId: message.id,
      participantId: recipient.id,
      status: MESSAGE_DELIVERY_STATUS.QUEUED,
    }).returning();
    deliveries.push(delivery);
  }

  await tx.insert(messagingEvents).values({
    conversationId: bizConversation.conversationId,
    messageId: message.id,
    eventType: MESSAGE_EVENT_TYPE.MESSAGE_CREATED,
    payload: { senderParticipantId, recipientCount: recipients.length },
  });

  return { message, deliveries };
}

export async function createMessage(input: CreateMessageInput): Promise<CreateMessageResult> {
  return db.transaction((tx) => createMessageTx(tx, input));
}

export interface ListMessagesResult {
  messages: (typeof messagingMessages.$inferSelect)[];
  total: number;
  limit: number;
  offset: number;
}

export async function listMessages(
  businessId: number,
  businessConversationId: number,
  opts: { limit?: number; offset?: number } = {},
): Promise<ListMessagesResult | null> {
  const [bizConversation] = await db.select().from(businessConversations)
    .where(and(eq(businessConversations.id, businessConversationId), eq(businessConversations.businessId, businessId)));
  if (!bizConversation) return null;

  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  const offset = Math.max(opts.offset ?? 0, 0);

  const rows = await db.select().from(messagingMessages)
    .where(and(
      eq(messagingMessages.conversationId, bizConversation.conversationId),
      isNull(messagingMessages.deletedAt),
    ))
    .orderBy(desc(messagingMessages.createdAt))
    .limit(limit)
    .offset(offset);

  return { messages: rows, total: rows.length, limit, offset };
}

export interface SendUserInitiatedMessageInput {
  businessId: number;
  /** The authenticated caller's own user id (req.user.id) -- NEVER a
   * client-suppliable value, same rule as CreateMessageInput.authenticatedUserId. */
  authenticatedUserId: number;
  content: string;
  messageType?: string;
}

/**
 * P1-1 (2026-08-25): customer-inbound ingestion -- lets a real NeuraTalk
 * user initiate (or continue) a conversation with a business, using the
 * SAME canonical messaging substrate business agents already use. This is
 * an internal service function only; no public route is wired to it yet
 * (see the approved architecture audit's P1-1 scope -- an internal
 * ingestion function first, not a public webhook or route).
 *
 * Composes three existing, unmodified pieces inside one transaction so the
 * whole operation is atomic (all-or-nothing, no partial state on failure):
 *   1. findOrCreateCustomerByLinkedUser (customers/service.ts) -- resolves
 *      this user's customer record for this specific business, keyed by
 *      linkedUserId (never phone/email), creating one only if none exists.
 *   2. findOrCreateCustomerConversation (this file, Phase 5, unmodified) --
 *      resolves this business+customer's ongoing conversation, creating one
 *      only if none exists. Its create path adds BUSINESS + CUSTOMER
 *      participants (built for the campaign-send caller, which has no
 *      NeuraTalk user to add) -- see step 3 for why that's not enough here.
 *   3. Idempotently ensures a participantType=USER row exists for this
 *      user in that conversation. createMessageTx resolves the sender via
 *      exactly that kind of row (see its own doc comment above), so
 *      without this a user-initiated conversation's own creator could
 *      never actually send into it.
 *   4. createMessageTx (this file, unmodified) -- identical sender
 *      resolution, tenant isolation, content validation, and delivery/event
 *      fan-out as the business-agent-reply path. No second messaging
 *      implementation.
 *
 * Tenant isolation: businessId is validated to reference a real
 * organization before anything else happens; a nonexistent business throws
 * NotFoundError, never silently creates orphaned state. authenticatedUserId
 * is a required parameter with no default -- callers MUST resolve it from
 * the authenticated session (req.user.id), never trust a client-supplied
 * value; there is no code path here that reads an id from a request body.
 * findOrCreateCustomerByLinkedUser is strictly scoped to (businessId,
 * userId) -- a user can never be linked as a customer of a business other
 * than the one named in this call, and an existing customer record under a
 * DIFFERENT business can never be reused or cross-linked.
 */
// Extracted (P1-5, 2026-08-25) from what was inline sendUserInitiatedMessage
// logic, so the exact same idempotent "ensure a USER participant row exists"
// step can be reused by the business-agent reply path (see
// sendBusinessAgentMessage below) without duplicating it. Behavior
// unchanged from the original inline version.
async function ensureUserParticipant(tx: DbLike, conversationId: number, userId: number, role: string): Promise<void> {
  const [existing] = await tx.select().from(messagingParticipants)
    .where(and(
      eq(messagingParticipants.conversationId, conversationId),
      eq(messagingParticipants.participantType, MESSAGING_PARTICIPANT_TYPE.USER),
      eq(messagingParticipants.participantId, userId),
    ));
  if (existing) return;

  // No MESSAGE_EVENT_TYPE entry exists for "participant added" (the enum is
  // exhaustively message-lifecycle-only, see shared/schema.ts) -- not
  // inventing one here. The substantive action is captured by the
  // message.created event createMessageTx emits right after this.
  await assertValidParticipant(tx, MESSAGING_PARTICIPANT_TYPE.USER, userId);
  await tx.insert(messagingParticipants).values({
    conversationId,
    participantType: MESSAGING_PARTICIPANT_TYPE.USER,
    participantId: userId,
    role,
  });
}

export async function sendUserInitiatedMessage(
  input: SendUserInitiatedMessageInput,
): Promise<CreateMessageResult> {
  return db.transaction(async (tx) => {
    const [business] = await tx.select({ id: organizations.id }).from(organizations).where(eq(organizations.id, input.businessId));
    if (!business) throw new NotFoundError("Business not found");

    const customer = await findOrCreateCustomerByLinkedUser(input.businessId, input.authenticatedUserId, tx);

    const { businessConversation } = await findOrCreateCustomerConversation(tx, input.businessId, customer.id);

    await ensureUserParticipant(tx, businessConversation.conversationId, input.authenticatedUserId, "customer");

    return createMessageTx(tx, {
      businessId: input.businessId,
      businessConversationId: businessConversation.id,
      authenticatedUserId: input.authenticatedUserId,
      content: input.content,
      messageType: input.messageType,
    });
  });
}

/**
 * P1-5: business-agent reply path for the Business Inbox. Existing
 * createMessage/createMessageTx deliberately rejects a caller who isn't
 * already a participant in the conversation ("Phase 0 does not auto-join
 * business members into conversations they weren't explicitly added to" --
 * see createMessageTx's doc comment, unchanged). Conversations created via
 * P1-1 only ever get a BUSINESS-type participant (the org itself) plus the
 * specific customer's USER participant -- no individual agent is ever
 * added, so reusing createMessage as-is would 403 every agent who didn't
 * happen to create the conversation, making a shared-team Inbox unusable.
 *
 * Resolved (explicit product decision, not a unilateral call): any agent
 * who is already authorized for this exact business (requireCompanyAccess
 * + MESSAGING_SEND, enforced in routes.ts/controller.ts before this is ever
 * called) may reply to any of that business's conversations; replying
 * auto-adds them as a USER participant on first use, via the SAME
 * ensureUserParticipant helper sendUserInitiatedMessage uses -- not a
 * second implementation. This only affects who can join a conversation
 * WITHIN an already-authorized business; it does not touch tenant
 * isolation (still fully enforced by the unchanged businessId/
 * businessConversationId checks below and in createMessageTx), and
 * createMessage/createMessageTx's own strict behavior is completely
 * unmodified for any other caller.
 */
export async function sendBusinessAgentMessage(input: CreateMessageInput): Promise<CreateMessageResult> {
  return db.transaction(async (tx) => {
    const [bizConversation] = await tx.select().from(businessConversations)
      .where(and(eq(businessConversations.id, input.businessConversationId), eq(businessConversations.businessId, input.businessId)));
    if (!bizConversation) throw new NotFoundError("Conversation not found");

    await ensureUserParticipant(tx, bizConversation.conversationId, input.authenticatedUserId, "agent");

    return createMessageTx(tx, input);
  });
}

export interface PublicBusinessIdentity {
  id: number;
  name: string;
  logoUrl: string | null;
  description: string | null;
}

/**
 * P1-3A Part A: the SMALLEST consumer-safe projection of `organizations`.
 * Deliberately NOT a reuse of business-profile/service.ts's
 * getBusinessProfile() -- that function returns email/phone/legalBusinessName
 * /full address/status, all business-internal, none of it consumer-safe.
 * Only `name`, `logoUrl`, `description` are selected here -- an explicit
 * column list, not a spread of the organizations row, so no field can leak
 * into this response just by being added to the table later.
 */
export async function getPublicBusinessIdentity(businessId: number): Promise<PublicBusinessIdentity | null> {
  const [org] = await db.select({
    id: organizations.id,
    name: organizations.name,
    logoUrl: organizations.logoUrl,
    description: organizations.description,
  }).from(organizations).where(eq(organizations.id, businessId));
  return org ?? null;
}

export interface ListUserInitiatedMessagesResult extends ListMessagesResult {
  /**
   * P1-A fix (2026-08-25): the caller's OWN messaging_participants.id in
   * this conversation -- the smallest safe addition needed for
   * BusinessChatPage to tell "my message" from "the business's reply"
   * without a second identity system. Deliberately NOT any employee-
   * identifying field (no agent user id, name, or role is ever returned
   * here) -- just the numeric participant row id the CONSUMER'S OWN
   * messages already carry as senderParticipantId, which the client
   * compares against to decide role="user" vs role="assistant". null when
   * the caller has no participant row yet (e.g. no conversation exists at
   * all) -- every message the client then has (there are none) would
   * fall back to "assistant" harmlessly since chronologicalMessages is
   * also empty in that case.
   */
  viewerParticipantId: number | null;
}

/**
 * P1-3A Part B: read-only counterpart to sendUserInitiatedMessage. Resolves
 * (businessId, authenticatedUserId) -> customer -> businessConversation ->
 * listMessages, using find-ONLY lookups (no findOrCreateCustomerByLinkedUser,
 * no findOrCreateCustomerConversation) so a GET can never create a customer,
 * conversation, or participant row -- if either lookup misses, an empty
 * result is returned rather than materializing state. Reuses listMessages
 * (this file, Phase 0, unmodified) for the actual message fetch + its
 * existing pagination (limit clamped 1-200, default 50) -- no second
 * pagination implementation.
 *
 * Tenant isolation: authenticatedUserId is a required parameter, always the
 * caller's own id (see the controller) -- there is no code path here that
 * accepts a client-supplied customerId/userId. The customer lookup is
 * scoped to (businessId, linkedUserId) exactly as in Part A/P1-1, so a
 * caller can never read a conversation belonging to a different user or a
 * different business by varying businessId or any other input.
 *
 * P1-A fix: additionally resolves the caller's own participant id (find-
 * only, same as everything else in this function -- never creates a
 * participant row) so the consumer UI can determine sender side. This is
 * the ONLY new lookup added; no new table, no new identity concept.
 */
export async function listUserInitiatedMessages(
  businessId: number,
  authenticatedUserId: number,
  opts: { limit?: number; offset?: number } = {},
): Promise<ListUserInitiatedMessagesResult> {
  const emptyResult: ListUserInitiatedMessagesResult = {
    messages: [],
    total: 0,
    limit: Math.min(Math.max(opts.limit ?? 50, 1), 200),
    offset: Math.max(opts.offset ?? 0, 0),
    viewerParticipantId: null,
  };

  const [customer] = await db.select({ id: customers.id }).from(customers)
    .where(and(eq(customers.businessId, businessId), eq(customers.linkedUserId, authenticatedUserId)));
  if (!customer) return emptyResult;

  const [bizConversation] = await db.select({ id: businessConversations.id, conversationId: businessConversations.conversationId })
    .from(businessConversations)
    .where(and(eq(businessConversations.businessId, businessId), eq(businessConversations.customerId, customer.id)));
  if (!bizConversation) return emptyResult;

  const [viewerParticipant] = await db.select({ id: messagingParticipants.id }).from(messagingParticipants)
    .where(and(
      eq(messagingParticipants.conversationId, bizConversation.conversationId),
      eq(messagingParticipants.participantType, MESSAGING_PARTICIPANT_TYPE.USER),
      eq(messagingParticipants.participantId, authenticatedUserId),
    ));

  const result = await listMessages(businessId, bizConversation.id, opts);
  return { ...(result ?? emptyResult), viewerParticipantId: viewerParticipant?.id ?? null };
}

export interface BusinessConversationSummary {
  id: number; // businessConversations.id -- what getConversation/getMessages/postMessage expect as :id
  conversationId: number;
  customerId: number | null;
  customerName: string | null;
  status: string;
  assignedToUserId: number | null;
  assignedToUsername: string | null;
  lastMessage: { content: string; createdAt: Date } | null;
  createdAt: Date;
}

export type ConversationAssignmentFilter = "all" | "mine" | "unassigned";

/**
 * P1-5: the Business Inbox's conversation list -- discovered missing during
 * this phase's architecture audit (Phase 0 shipped create/get-one/reply/
 * get-messages, deliberately no list route, per its own "do not expand
 * without a new approved design" comment; this IS that next approved
 * design). Tenant-scoped by businessId only, matching every other
 * business-side query in this file.
 *
 * "Latest message per conversation" is computed via a bounded, in-memory
 * reduction (fetch recent messages across this business's conversations,
 * keep the first -- i.e. most recent, since ordered DESC -- one seen per
 * conversationId), the same documented-shortcut pattern
 * getBusinessMarketingReport (server/modules/marketing/service.ts) already
 * uses for a similar per-group aggregation: a real Postgres DISTINCT ON
 * query would be more precise at scale, but this is a smaller, more
 * consistent-with-existing-conventions choice for the data volumes this
 * platform has today. The LIMIT below caps worst-case query cost; a
 * conversation whose only messages are all older than the LIMIT-most-recent
 * messages across the ENTIRE business would show no preview until it
 * receives a new message -- an acceptable, documented tradeoff at current
 * scale, not a silent bug.
 *
 * P1-6: accepts an optional assignment filter ("mine" requires viewerUserId;
 * "unassigned" needs no viewer). Filtering happens in-memory on the already
 * businessId-scoped row set, not a second query -- there is no case where
 * this filter could see a row outside the tenant scope the initial SELECT
 * already established.
 */
export async function listBusinessConversations(
  businessId: number,
  opts: { assignment?: ConversationAssignmentFilter; viewerUserId?: number } = {},
): Promise<BusinessConversationSummary[]> {
  let conversations = await db.select().from(businessConversations).where(eq(businessConversations.businessId, businessId));
  if (opts.assignment === "mine" && opts.viewerUserId !== undefined) {
    conversations = conversations.filter((c) => c.assignedToUserId === opts.viewerUserId);
  } else if (opts.assignment === "unassigned") {
    conversations = conversations.filter((c) => c.assignedToUserId === null);
  }
  if (conversations.length === 0) return [];

  const customerIds = conversations.map((c) => c.customerId).filter((id): id is number => id !== null);
  const customerRows = customerIds.length
    ? await db.select({ id: customers.id, name: customers.name }).from(customers).where(inArray(customers.id, customerIds))
    : [];
  const customerNameById = new Map(customerRows.map((c) => [c.id, c.name]));

  const assigneeIds = conversations.map((c) => c.assignedToUserId).filter((id): id is number => id !== null);
  const assigneeRows = assigneeIds.length
    ? await db.select({ id: users.id, username: users.username }).from(users).where(inArray(users.id, assigneeIds))
    : [];
  const assigneeUsernameById = new Map(assigneeRows.map((u) => [u.id, u.username]));

  const conversationIds = conversations.map((c) => c.conversationId);
  const RECENT_MESSAGE_SCAN_LIMIT = 500;
  const recentMessages = conversationIds.length
    ? await db.select({
        conversationId: messagingMessages.conversationId,
        content: messagingMessages.content,
        createdAt: messagingMessages.createdAt,
      }).from(messagingMessages)
        .where(and(inArray(messagingMessages.conversationId, conversationIds), isNull(messagingMessages.deletedAt)))
        .orderBy(desc(messagingMessages.createdAt))
        .limit(RECENT_MESSAGE_SCAN_LIMIT)
    : [];

  const latestByConversation = new Map<number, { content: string; createdAt: Date }>();
  for (const m of recentMessages) {
    if (!latestByConversation.has(m.conversationId)) {
      latestByConversation.set(m.conversationId, { content: m.content, createdAt: m.createdAt as Date });
    }
  }

  return conversations
    .map((c): BusinessConversationSummary => ({
      id: c.id,
      conversationId: c.conversationId,
      customerId: c.customerId,
      customerName: c.customerId ? (customerNameById.get(c.customerId) ?? null) : null,
      status: c.status,
      assignedToUserId: c.assignedToUserId,
      assignedToUsername: c.assignedToUserId ? (assigneeUsernameById.get(c.assignedToUserId) ?? null) : null,
      lastMessage: latestByConversation.get(c.conversationId) ?? null,
      createdAt: c.createdAt as Date,
    }))
    .sort((a, b) => {
      const aTime = (a.lastMessage?.createdAt ?? a.createdAt).getTime();
      const bTime = (b.lastMessage?.createdAt ?? b.createdAt).getTime();
      return bTime - aTime; // most recently active first
    });
}

/** Single-row counterpart to listBusinessConversations's mapping logic --
 * used by claim/unassign so they don't have to scan the business's entire
 * conversation list just to return the one row that changed. */
async function summarizeConversation(businessId: number, businessConversationId: number): Promise<BusinessConversationSummary> {
  const [c] = await db.select().from(businessConversations)
    .where(and(eq(businessConversations.id, businessConversationId), eq(businessConversations.businessId, businessId)));

  const customerName = c.customerId
    ? (await db.select({ name: customers.name }).from(customers).where(eq(customers.id, c.customerId)))[0]?.name ?? null
    : null;
  const assignedToUsername = c.assignedToUserId
    ? (await db.select({ username: users.username }).from(users).where(eq(users.id, c.assignedToUserId)))[0]?.username ?? null
    : null;
  const [latest] = await db.select({ content: messagingMessages.content, createdAt: messagingMessages.createdAt })
    .from(messagingMessages)
    .where(and(eq(messagingMessages.conversationId, c.conversationId), isNull(messagingMessages.deletedAt)))
    .orderBy(desc(messagingMessages.createdAt))
    .limit(1);

  return {
    id: c.id,
    conversationId: c.conversationId,
    customerId: c.customerId,
    customerName,
    status: c.status,
    assignedToUserId: c.assignedToUserId,
    assignedToUsername,
    lastMessage: latest ? { content: latest.content, createdAt: latest.createdAt as Date } : null,
    createdAt: c.createdAt as Date,
  };
}

export class AssignmentConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AssignmentConflictError";
  }
}
/** The caller tried to unassign a conversation currently held by someone
 * else -- distinct from AssignmentConflictError (a race on an unassigned
 * conversation) since this is a straightforward authorization fact, not a
 * timing race. */
export class NotYourAssignmentError extends Error {
  constructor() {
    super("This conversation is not assigned to you");
    this.name = "NotYourAssignmentError";
  }
}

/**
 * P1-6: atomically self-assigns an UNASSIGNED conversation to the
 * authenticated caller. A single conditional UPDATE (the same fails-closed
 * CAS idiom as chargeMessage in server/modules/billing/message-billing.ts
 * -- "WHERE ... AND <still-in-the-expected-state>", never read-then-write),
 * so two agents claiming the same conversation at the same instant cannot
 * both succeed: exactly one UPDATE affects a row, the other affects zero
 * and is told so explicitly (AssignmentConflictError, mapped to 409 by the
 * controller) rather than silently overwriting or double-assigning.
 *
 * Deliberately does NOT let a claim steal an already-assigned conversation
 * -- the WHERE clause requires assignedToUserId IS NULL. Reassigning
 * someone else's conversation is a different, more privileged operation
 * this function does not perform (see this phase's report for why that was
 * deferred rather than guessed at).
 *
 * Tenant isolation: the WHERE clause requires businessId to match, exactly
 * like every other query in this file -- a conversation from a different
 * business can never be claimed via this function regardless of what id is
 * supplied, and returns the same NotFoundError as any other cross-tenant id
 * guess (not a distinguishable "wrong business" response).
 */
export async function claimConversation(businessId: number, businessConversationId: number, authenticatedUserId: number): Promise<BusinessConversationSummary> {
  const [existing] = await db.select({ id: businessConversations.id }).from(businessConversations)
    .where(and(eq(businessConversations.id, businessConversationId), eq(businessConversations.businessId, businessId)));
  if (!existing) throw new NotFoundError("Conversation not found");

  const [updated] = await db.update(businessConversations)
    .set({ assignedToUserId: authenticatedUserId })
    .where(and(
      eq(businessConversations.id, businessConversationId),
      eq(businessConversations.businessId, businessId),
      isNull(businessConversations.assignedToUserId),
    ))
    .returning();

  if (!updated) throw new AssignmentConflictError("This conversation was already claimed");

  return summarizeConversation(businessId, businessConversationId);
}

/**
 * P1-6: releases the caller's OWN claim on a conversation -- symmetric,
 * same-authority-level counterpart to claimConversation (an agent may
 * release what they themselves hold; this is not the elevated
 * "company_admin reassigns/unassigns anyone's conversation" operation,
 * which was deliberately not built this phase). The WHERE clause requires
 * assignedToUserId to equal the caller's own id -- a different agent's
 * assignment cannot be cleared this way, mapped by the controller to 403
 * via NotYourAssignmentError, not silently ignored or allowed.
 */
export async function unassignConversation(businessId: number, businessConversationId: number, authenticatedUserId: number): Promise<BusinessConversationSummary> {
  const [existing] = await db.select({ id: businessConversations.id, assignedToUserId: businessConversations.assignedToUserId })
    .from(businessConversations)
    .where(and(eq(businessConversations.id, businessConversationId), eq(businessConversations.businessId, businessId)));
  if (!existing) throw new NotFoundError("Conversation not found");
  if (existing.assignedToUserId !== authenticatedUserId) throw new NotYourAssignmentError();

  const [updated] = await db.update(businessConversations)
    .set({ assignedToUserId: null })
    .where(and(
      eq(businessConversations.id, businessConversationId),
      eq(businessConversations.businessId, businessId),
      eq(businessConversations.assignedToUserId, authenticatedUserId),
    ))
    .returning();

  if (!updated) throw new NotYourAssignmentError(); // lost the race to someone reassigning in between the check and the update

  return summarizeConversation(businessId, businessConversationId);
}

/**
 * P1-7: the target of an admin assign/reassign is not a member of this
 * business -- either the user id doesn't exist, belongs to a different
 * organizationId, or is deactivated. Deliberately distinct from
 * NotFoundError (which means "the conversation itself is missing/wrong
 * tenant") since this is about the ASSIGNEE, not the conversation.
 */
export class InvalidAssigneeError extends Error {
  constructor(message: string = "Target user is not an eligible member of this business") {
    super(message);
    this.name = "InvalidAssigneeError";
  }
}

/**
 * P1-7: lightweight roster for the admin reassignment picker -- id/username
 * only for active members of this exact business, via the same
 * users.organizationId === businessId check adminSetConversationAssignment
 * itself enforces below (and the same one server/business-rbac-routes.ts
 * uses for its target-user check). Deliberately NOT reusing
 * getAgentStatusRows (server/b2b-routes.ts) -- that endpoint pulls in live
 * call status/duration for the full Team tab and is scoped to the caller's
 * OWN organizationId only (no :businessId param, so not directly reusable
 * behind requireCompanyAccess); this is a smaller, purpose-built read.
 */
export async function listEligibleAssignees(businessId: number): Promise<{ id: number; username: string }[]> {
  const rows = await db.select({ id: users.id, username: users.username })
    .from(users)
    .where(and(eq(users.organizationId, businessId), eq(users.isActive, true)));
  return rows;
}

/**
 * P1-7: company_admin/super_admin-only assignment mutation -- covers
 * assign (conversation currently unassigned), reassign (currently assigned
 * to someone else), and unassign (targetUserId === null), all through one
 * endpoint per the smallest-API-surface guidance, since all three are the
 * same authority-checked write to the same field.
 *
 * Authorization model (see this phase's report for the full architecture
 * comparison): gated at the ROUTE by requireRole("company_admin",
 * "super_admin") -- the same administrative-role-gate pattern
 * server/business-rbac-routes.ts already established for "company_admin
 * mutates another org member's state within their own business", not a new
 * MESSAGING_REASSIGN permission. MESSAGING_SEND/MESSAGING_VIEW were ruled
 * out as the gate because role-middleware.ts's default permission sets
 * grant BOTH to agent and company_admin identically -- an agent already
 * holds MESSAGING_SEND, so gating reassignment behind it would hand every
 * agent the same reassignment power this phase is explicitly not supposed
 * to grant them.
 *
 * Race-condition behavior (deliberately different from claimConversation's
 * CAS-against-NULL): an admin's authority to reassign does not depend on
 * the conversation's CURRENT assignee the way a self-claim depends on it
 * being unassigned -- there is no "expected prior state" for an admin
 * write to be conditioned on. The UPDATE is unconditional on
 * assignedToUserId (only conditioned on id+businessId, i.e. still tenant-
 * scoped and existence-checked), so concurrent admin reassignments
 * serialize on Postgres's normal row lock and the LAST COMMITTED write
 * wins deterministically -- no torn/partial state is possible, and every
 * individual write (including ones a later write immediately overwrites)
 * is still captured in the audit log, so the full history survives even
 * though only the final value is "current". This is standard last-write-
 * wins admin-override semantics, not a bug -- unlike claim/unassign there
 * is no meaningful "conflict" a second admin caller needs to be told about.
 *
 * Tenant isolation: both the conversation lookup/update AND the assignee
 * eligibility check are scoped to businessId -- a client cannot reassign a
 * conversation belonging to a different business (NotFoundError, same as
 * claim/unassign), and cannot assign to a user who is not a member of
 * exactly this business (InvalidAssigneeError) even if that user id is
 * valid in some OTHER business.
 */
export async function adminSetConversationAssignment(
  businessId: number,
  businessConversationId: number,
  actingUserId: number,
  targetUserId: number | null,
): Promise<BusinessConversationSummary> {
  const [existing] = await db.select({ id: businessConversations.id, assignedToUserId: businessConversations.assignedToUserId })
    .from(businessConversations)
    .where(and(eq(businessConversations.id, businessConversationId), eq(businessConversations.businessId, businessId)));
  if (!existing) throw new NotFoundError("Conversation not found");

  if (targetUserId !== null) {
    const [target] = await db.select({ id: users.id, organizationId: users.organizationId, isActive: users.isActive })
      .from(users)
      .where(eq(users.id, targetUserId));
    if (!target || target.organizationId !== businessId || !target.isActive) {
      throw new InvalidAssigneeError();
    }
  }

  const previousAssigneeId = existing.assignedToUserId;

  const [updated] = await db.update(businessConversations)
    .set({ assignedToUserId: targetUserId })
    .where(and(eq(businessConversations.id, businessConversationId), eq(businessConversations.businessId, businessId)))
    .returning();
  if (!updated) throw new NotFoundError("Conversation not found");

  const operation = targetUserId === null ? "unassign" : previousAssigneeId === null ? "assign" : "reassign";
  await createAuditLog({
    userId: actingUserId,
    organizationId: businessId,
    action: AUDIT_ACTION.UPDATE,
    entityType: "business_conversation_assignment",
    entityId: businessConversationId,
    oldValue: { assignedToUserId: previousAssigneeId },
    newValue: { assignedToUserId: targetUserId },
    metadata: { operation, conversationId: existing.id },
  });

  return summarizeConversation(businessId, businessConversationId);
}
