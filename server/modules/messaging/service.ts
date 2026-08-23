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
  MESSAGING_CONVERSATION_TYPE,
  MESSAGING_PARTICIPANT_TYPE,
  MESSAGE_CATEGORY,
  MESSAGE_TYPE,
  MESSAGE_DELIVERY_STATUS,
  MESSAGE_EVENT_TYPE,
  type MessagingParticipantType,
} from "@shared/schema";
import { eq, and, isNull, desc, ne } from "drizzle-orm";

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
 * Phase 0 only supports participant types with a real backing table to
 * validate against ("strict application-layer validation before accepting
 * the participant" -- participantId is polymorphic and carries no DB FK,
 * see doc 24 section 13). `customer` and `ai_agent` have no backing table
 * until later phases and are deliberately rejected here, not silently
 * accepted with an unvalidated reference.
 */
async function assertValidParticipant(
  tx: Pick<typeof db, "select">,
  participantType: string,
  participantId: number,
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
  throw new InvalidParticipantError(participantType);
}

export interface CreateBusinessConversationInput {
  businessId: number;
  additionalParticipants?: Array<{ participantType: MessagingParticipantType; participantId: number; role?: string }>;
}

export interface CreateBusinessConversationResult {
  businessConversation: typeof businessConversations.$inferSelect;
  conversation: typeof messagingConversations.$inferSelect;
  participants: (typeof messagingParticipants.$inferSelect)[];
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
  return db.transaction(async (tx) => {
    const [business] = await tx.select({ id: organizations.id }).from(organizations).where(eq(organizations.id, input.businessId));
    if (!business) throw new NotFoundError("Business not found");

    const [conversation] = await tx.insert(messagingConversations).values({
      type: MESSAGING_CONVERSATION_TYPE.BUSINESS,
      organizationId: input.businessId,
    }).returning();

    const [bizConversation] = await tx.insert(businessConversations).values({
      conversationId: conversation.id,
      businessId: input.businessId,
    }).returning();

    const participants: (typeof messagingParticipants.$inferSelect)[] = [];

    const [businessParticipant] = await tx.insert(messagingParticipants).values({
      conversationId: conversation.id,
      participantType: MESSAGING_PARTICIPANT_TYPE.BUSINESS,
      participantId: input.businessId,
      role: "business",
    }).returning();
    participants.push(businessParticipant);

    for (const p of input.additionalParticipants ?? []) {
      await assertValidParticipant(tx, p.participantType, p.participantId);
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
  });
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
export async function createMessage(input: CreateMessageInput): Promise<CreateMessageResult> {
  return db.transaction(async (tx) => {
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
  });
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
