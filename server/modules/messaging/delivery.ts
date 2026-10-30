/**
 * In-app delivery for canonical business messaging.
 *
 * Every business message is stored with one messagingDeliveries row per
 * recipient participant, status QUEUED. This module is the channel that
 * moves those rows forward for recipients who are NeuraTalk users:
 *
 *   queued    -> sent       the message is stored and pushed to the user's
 *                           app (realtime event + FCM push) -- set here, right
 *                           after the send transaction commits
 *   sent      -> delivered  the user's app fetched the thread
 *   delivered -> read       the user opened the thread (explicit read call)
 *
 * A CUSTOMER recipient with no linked NeuraTalk account cannot receive an
 * in-app message, so its delivery is FAILED with reason
 * `customer_not_on_neuratalk` -- never left looking "sent".
 *
 * Business-side recipients (the BUSINESS participant and agent USER
 * participants) see the message in the Business Inbox as soon as it is
 * stored, so their deliveries go straight to DELIVERED, and to READ when an
 * agent opens that conversation.
 *
 * Everything here runs AFTER the send transaction committed and is
 * best-effort: a failure is logged and never turns a successful send into
 * an error for the sender.
 */
import { db } from "../../db";
import {
  businessConversations,
  customers,
  messagingDeliveries,
  messagingMessages,
  messagingParticipants,
  organizations,
  users,
  MESSAGE_DELIVERY_STATUS,
  MESSAGING_PARTICIPANT_TYPE,
} from "@shared/schema";
import { and, eq, inArray, isNull, or } from "drizzle-orm";
import { logger } from "../../observability";
import { sendPushNotification } from "../../firebase-admin";
import { publishMessagingEvent, publishPersonalChatEvent } from "./realtime";
import { revealInAppOtpCodes } from "../otp/reveal";

export const CUSTOMER_NOT_ON_NEURATALK = "customer_not_on_neuratalk";

const STATUS_RANK: Record<string, number> = {
  [MESSAGE_DELIVERY_STATUS.FAILED]: 0,
  [MESSAGE_DELIVERY_STATUS.QUEUED]: 1,
  [MESSAGE_DELIVERY_STATUS.SENT]: 2,
  [MESSAGE_DELIVERY_STATUS.DELIVERED]: 3,
  [MESSAGE_DELIVERY_STATUS.READ]: 4,
};

/** Highest-progress status of a set of deliveries (read > delivered > sent > queued > failed). */
export function summarizeDeliveryStatus(statuses: string[]): string | null {
  if (statuses.length === 0) return null;
  return statuses.reduce((best, s) => ((STATUS_RANK[s] ?? -1) > (STATUS_RANK[best] ?? -1) ? s : best));
}

function isCustomerSide(p: { participantType: string; role: string | null }): boolean {
  return p.participantType === MESSAGING_PARTICIPANT_TYPE.CUSTOMER
    || (p.participantType === MESSAGING_PARTICIPANT_TYPE.USER && p.role === "customer");
}

/** Tell the business's own server (webhooks it registered). Never throws. */
function notifyBusinessServer(businessId: number, event: "message.sent" | "message.delivered" | "message.read" | "message.failed" | "message.received", data: Record<string, unknown>): void {
  import("../webhooks/service")
    .then(({ dispatchEvent }) => dispatchEvent(businessId, event, data))
    .catch((error) => logger.warn("BusinessDelivery", `webhook ${event} failed for business ${businessId}: ${String(error)}`));
}

function notificationPreview(message: { content: string }): string {
  const text = message.content.replace(/\s+/g, " ").trim();
  return text.length > 120 ? `${text.slice(0, 117)}...` : text;
}

export interface DeliverCommittedMessageInput {
  businessId: number;
  /** Resolved from the message when omitted. */
  businessConversationId?: number;
  messageId: number;
  /**
   * Also publish the message.created realtime event. The inbox/consumer send
   * paths already publish it themselves; campaign, OTP and utility sends
   * don't, so they pass true.
   */
  publishCreated?: boolean;
}

/**
 * Moves a just-committed message's QUEUED deliveries forward and notifies
 * the consumer's app. Never throws.
 */
export async function deliverCommittedMessage(input: DeliverCommittedMessageInput): Promise<void> {
  try {
    const [message] = await db.select().from(messagingMessages).where(eq(messagingMessages.id, input.messageId));
    if (!message) return;

    const [bizConv] = await db.select().from(businessConversations)
      .where(and(
        input.businessConversationId !== undefined
          ? eq(businessConversations.id, input.businessConversationId)
          : eq(businessConversations.conversationId, message.conversationId),
        eq(businessConversations.businessId, input.businessId),
      ));
    if (!bizConv) return;
    const businessConversationId = bizConv.id;

    const rows = await db.select({
      deliveryId: messagingDeliveries.id,
      status: messagingDeliveries.status,
      participantId: messagingParticipants.id,
      participantType: messagingParticipants.participantType,
      participantRefId: messagingParticipants.participantId,
      role: messagingParticipants.role,
    })
      .from(messagingDeliveries)
      .innerJoin(messagingParticipants, eq(messagingParticipants.id, messagingDeliveries.participantId))
      .where(eq(messagingDeliveries.messageId, message.id));

    const [customer] = bizConv.customerId
      ? await db.select({ id: customers.id, linkedUserId: customers.linkedUserId, blockedAt: customers.blockedByCustomerAt })
        .from(customers).where(eq(customers.id, bizConv.customerId))
      : [];
    // A person who blocked this business gets nothing from it (no message, no ping).
    const blockedByCustomer = Boolean(customer?.blockedAt);
    const consumerUserId = blockedByCustomer ? null : customer?.linkedUserId ?? null;

    const now = new Date();
    const toSent: number[] = [];
    const toDelivered: number[] = [];
    const toFailed: number[] = [];
    let consumerIsRecipient = false;

    for (const row of rows) {
      if (row.status !== MESSAGE_DELIVERY_STATUS.QUEUED) continue;
      if (isCustomerSide(row)) {
        if (consumerUserId) {
          toSent.push(row.deliveryId);
          consumerIsRecipient = true;
        } else {
          toFailed.push(row.deliveryId);
        }
      } else {
        // Business participant or an agent: it is in the Business Inbox now.
        toDelivered.push(row.deliveryId);
      }
    }

    if (toSent.length) {
      await db.update(messagingDeliveries)
        .set({ status: MESSAGE_DELIVERY_STATUS.SENT, statusAt: now, providerRef: "in_app" })
        .where(and(inArray(messagingDeliveries.id, toSent), eq(messagingDeliveries.status, MESSAGE_DELIVERY_STATUS.QUEUED)));
    }
    if (toDelivered.length) {
      await db.update(messagingDeliveries)
        .set({ status: MESSAGE_DELIVERY_STATUS.DELIVERED, statusAt: now, providerRef: "in_app" })
        .where(and(inArray(messagingDeliveries.id, toDelivered), eq(messagingDeliveries.status, MESSAGE_DELIVERY_STATUS.QUEUED)));
    }
    if (toFailed.length) {
      await db.update(messagingDeliveries)
        .set({ status: MESSAGE_DELIVERY_STATUS.FAILED, statusAt: now, failureReason: blockedByCustomer ? "blocked_by_customer" : CUSTOMER_NOT_ON_NEURATALK })
        .where(and(inArray(messagingDeliveries.id, toFailed), eq(messagingDeliveries.status, MESSAGE_DELIVERY_STATUS.QUEUED)));
    }

    if (input.publishCreated) {
      publishMessagingEvent({
        type: "message.created",
        businessId: input.businessId,
        conversationId: businessConversationId,
        customerUserId: consumerUserId,
        message: {
          id: message.id,
          senderParticipantId: message.senderParticipantId,
          content: message.content,
          createdAt: (message.createdAt ?? now).toISOString(),
        },
      });
    }

    // A customer wrote: ring the business team's phones (NeuraTalk
    // Business app) -- the assigned agent, or everyone on the team if the
    // chat is not assigned yet.
    const [senderParticipant] = await db.select().from(messagingParticipants).where(eq(messagingParticipants.id, message.senderParticipantId));
    if (senderParticipant && isCustomerSide(senderParticipant)) {
      void notifyBusinessTeam(input.businessId, businessConversationId, bizConv.assignedToUserId ?? null, customer?.id ?? null, message.content);
      const meta = (message.metadata ?? {}) as { buttonReply?: unknown; location?: unknown };
      notifyBusinessServer(input.businessId, "message.received", {
        messageId: message.id, customerId: customer?.id ?? null, text: message.content, messageType: message.messageType,
        replyToMessageId: message.replyToMessageId ?? null,
        ...(meta.buttonReply ? { buttonReply: meta.buttonReply } : {}),
        ...(meta.location ? { location: meta.location } : {}),
        createdAt: (message.createdAt ?? now).toISOString(),
      });
    } else {
      if (toSent.length) notifyBusinessServer(input.businessId, "message.sent", { messageId: message.id, customerId: customer?.id ?? null, category: message.category });
      if (toFailed.length) {
        notifyBusinessServer(input.businessId, "message.failed", {
          messageId: message.id, customerId: customer?.id ?? null, reason: blockedByCustomer ? "blocked_by_customer" : CUSTOMER_NOT_ON_NEURATALK,
        });
      }
    }

    if (consumerIsRecipient && consumerUserId) {
      const [org] = await db.select({ name: organizations.name }).from(organizations).where(eq(organizations.id, input.businessId));
      const businessName = org?.name || "Business";
      // The customer's own view: an in-app OTP shows its real code.
      const [forCustomer] = await revealInAppOtpCodes([message]);
      // App-wide signal (chat list badge, business inbox list) for an open app.
      publishPersonalChatEvent([consumerUserId], {
        type: "business.message",
        businessId: input.businessId,
        businessName,
        messageId: message.id,
        preview: notificationPreview(forCustomer),
        createdAt: (message.createdAt ?? now).toISOString(),
      });
      // Background / closed app.
      sendPushNotification(consumerUserId, {
        title: businessName,
        body: notificationPreview(forCustomer),
        data: { type: "business_message", businessId: String(input.businessId), messageId: String(message.id) },
      }).catch((error) => {
        logger.warn("BusinessDelivery", `push failed for user ${consumerUserId}: ${String(error)}`);
      });
    }
  } catch (error) {
    logger.error("BusinessDelivery", `delivery for message ${input.messageId} failed`, error instanceof Error ? error : new Error(String(error)));
  }
}

/**
 * The consumer's app fetched (delivered) or opened (read) their thread with
 * a business. Advances every delivery addressed to them in that thread and
 * tells the Business Inbox so the ticks update. Returns how many changed.
 */
export async function acknowledgeConsumerDeliveries(
  businessId: number,
  userId: number,
  status: "delivered" | "read",
): Promise<number> {
  const [customer] = await db.select({ id: customers.id }).from(customers)
    .where(and(eq(customers.businessId, businessId), eq(customers.linkedUserId, userId)));
  if (!customer) return 0;

  const [bizConv] = await db.select().from(businessConversations)
    .where(and(eq(businessConversations.businessId, businessId), eq(businessConversations.customerId, customer.id)));
  if (!bizConv) return 0;

  const participants = await db.select({ id: messagingParticipants.id }).from(messagingParticipants)
    .where(and(
      eq(messagingParticipants.conversationId, bizConv.conversationId),
      or(
        and(eq(messagingParticipants.participantType, MESSAGING_PARTICIPANT_TYPE.CUSTOMER), eq(messagingParticipants.participantId, customer.id)),
        and(eq(messagingParticipants.participantType, MESSAGING_PARTICIPANT_TYPE.USER), eq(messagingParticipants.participantId, userId)),
      ),
    ));
  const changed = await advanceDeliveries(businessId, bizConv.id, bizConv.conversationId, participants.map((p) => p.id), status, userId);
  if (changed.length) {
    notifyBusinessServer(businessId, status === "read" ? "message.read" : "message.delivered", {
      messageIds: changed, customerId: customer.id, at: new Date().toISOString(),
    });
  }
  return changed.length;
}

/** An agent opened a conversation in the Business Inbox: everything addressed to the business side is read. */
export async function acknowledgeBusinessReads(businessId: number, businessConversationId: number): Promise<number> {
  const [bizConv] = await db.select().from(businessConversations)
    .where(and(eq(businessConversations.id, businessConversationId), eq(businessConversations.businessId, businessId)));
  if (!bizConv) return 0;
  const participants = await db.select().from(messagingParticipants)
    .where(eq(messagingParticipants.conversationId, bizConv.conversationId));
  const businessSide = participants.filter((p) => !isCustomerSide(p)).map((p) => p.id);
  const [customer] = bizConv.customerId
    ? await db.select({ linkedUserId: customers.linkedUserId }).from(customers).where(eq(customers.id, bizConv.customerId))
    : [];
  return (await advanceDeliveries(businessId, bizConv.id, bizConv.conversationId, businessSide, "read", customer?.linkedUserId ?? null)).length;
}

async function advanceDeliveries(
  businessId: number,
  businessConversationId: number,
  conversationId: number,
  participantIds: number[],
  status: "delivered" | "read",
  consumerUserId: number | null,
): Promise<number[]> {
  if (participantIds.length === 0) return [];
  const from = status === "read"
    ? [MESSAGE_DELIVERY_STATUS.QUEUED, MESSAGE_DELIVERY_STATUS.SENT, MESSAGE_DELIVERY_STATUS.DELIVERED]
    : [MESSAGE_DELIVERY_STATUS.QUEUED, MESSAGE_DELIVERY_STATUS.SENT];

  const messageIds = db.select({ id: messagingMessages.id }).from(messagingMessages)
    .where(and(eq(messagingMessages.conversationId, conversationId), isNull(messagingMessages.deletedAt)));

  const updated = await db.update(messagingDeliveries)
    .set({ status, statusAt: new Date() })
    .where(and(
      inArray(messagingDeliveries.participantId, participantIds),
      inArray(messagingDeliveries.status, from),
      inArray(messagingDeliveries.messageId, messageIds),
    ))
    .returning({ id: messagingDeliveries.id, messageId: messagingDeliveries.messageId });

  if (updated.length > 0) {
    publishMessagingEvent({
      type: "delivery.updated",
      businessId,
      conversationId: businessConversationId,
      customerUserId: consumerUserId,
      status,
    });
  }
  return Array.from(new Set(updated.map((u) => u.messageId)));
}

/**
 * Delivery status per message as seen by one side of the conversation:
 * for each message, the best status among deliveries to the OTHER side.
 */
export async function deliveryStatusByMessage(
  conversationId: number,
  messageIds: number[],
): Promise<Map<number, { toCustomer: string | null; toBusiness: string | null }>> {
  const result = new Map<number, { toCustomer: string | null; toBusiness: string | null }>();
  if (messageIds.length === 0) return result;
  const rows = await db.select({
    messageId: messagingDeliveries.messageId,
    status: messagingDeliveries.status,
    participantType: messagingParticipants.participantType,
    role: messagingParticipants.role,
  })
    .from(messagingDeliveries)
    .innerJoin(messagingParticipants, eq(messagingParticipants.id, messagingDeliveries.participantId))
    .where(and(eq(messagingParticipants.conversationId, conversationId), inArray(messagingDeliveries.messageId, messageIds)));

  const grouped = new Map<number, { customer: string[]; business: string[] }>();
  for (const row of rows) {
    const entry = grouped.get(row.messageId) ?? { customer: [], business: [] };
    (isCustomerSide(row) ? entry.customer : entry.business).push(row.status);
    grouped.set(row.messageId, entry);
  }
  grouped.forEach((entry, id) => {
    result.set(id, { toCustomer: summarizeDeliveryStatus(entry.customer), toBusiness: summarizeDeliveryStatus(entry.business) });
  });
  return result;
}

/**
 * Real delivery outcome counts for a set of messages, one outcome per
 * message (its best delivery): accepted = in the person's NeuraTalk inbox,
 * delivered = their app fetched it, read = they opened the chat.
 */
export async function countDeliveryOutcomes(messageIds: number[]): Promise<{ accepted: number; delivered: number; read: number; failed: number }> {
  const counts = { accepted: 0, delivered: 0, read: 0, failed: 0 };
  if (messageIds.length === 0) return counts;
  const rows = await db.select({ messageId: messagingDeliveries.messageId, status: messagingDeliveries.status })
    .from(messagingDeliveries).where(inArray(messagingDeliveries.messageId, messageIds));
  const best = new Map<number, string>();
  for (const row of rows) {
    const prev = best.get(row.messageId);
    best.set(row.messageId, prev ? (summarizeDeliveryStatus([prev, row.status]) ?? row.status) : row.status);
  }
  best.forEach((status) => {
    if (status === MESSAGE_DELIVERY_STATUS.FAILED) counts.failed++;
    if (status === MESSAGE_DELIVERY_STATUS.SENT || status === MESSAGE_DELIVERY_STATUS.DELIVERED || status === MESSAGE_DELIVERY_STATUS.READ) counts.accepted++;
    if (status === MESSAGE_DELIVERY_STATUS.DELIVERED || status === MESSAGE_DELIVERY_STATUS.READ) counts.delivered++;
    if (status === MESSAGE_DELIVERY_STATUS.READ) counts.read++;
  });
  return counts;
}
async function notifyBusinessTeam(
  businessId: number,
  businessConversationId: number,
  assignedToUserId: number | null,
  customerId: number | null,
  content: string,
): Promise<void> {
  try {
    const team = await db.select({ id: users.id, role: users.role }).from(users)
      .where(and(eq(users.organizationId, businessId), eq(users.isActive, true)));
    const recipients = assignedToUserId && team.some((u) => u.id === assignedToUserId)
      ? [assignedToUserId]
      : team.map((u) => u.id);
    if (recipients.length === 0) return;
    const { customerCard } = await import("./service");
    const customer = customerId ? await customerCard(customerId) : null;
    const title = customer?.name || customer?.phone || "New customer message";
    const body = notificationPreview({ content });
    await Promise.allSettled(recipients.map((userId) => sendPushNotification(userId, {
      title,
      body,
      data: { type: "business_inbox_message", businessId: String(businessId), conversationId: String(businessConversationId) },
    })));
  } catch (error) {
    logger.warn("BusinessDelivery", `team notification failed for business ${businessId}: ${String(error)}`);
  }
}