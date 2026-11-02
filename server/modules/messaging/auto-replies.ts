/**
 * Automatic business replies (WhatsApp-Business style), sent as the
 * business itself after a customer's message has committed:
 *  - greeting: on the customer's very first message to the business
 *  - away: outside opening hours, at most once per 12 h per conversation
 * Both are configured in business-directory settings and are off by default.
 */
import { and, desc, eq, ne } from "drizzle-orm";
import { db } from "../../db";
import {
  businessConversations,
  messagingDeliveries,
  messagingEvents,
  messagingMessages,
  messagingParticipants,
  MESSAGE_CATEGORY,
  MESSAGE_DELIVERY_STATUS,
  MESSAGE_EVENT_TYPE,
  MESSAGE_TYPE,
  MESSAGING_PARTICIPANT_TYPE,
} from "@shared/schema";
import { logger } from "../../observability";
import { getMessagingSettings, isWithinOpeningHours } from "./business-directory";
import { deliverCommittedMessage } from "./delivery";

const AWAY_REPEAT_MS = 12 * 60 * 60_000;

async function sendAsBusiness(
  businessId: number, businessConversationId: number, conversationId: number, content: string, kind: string,
  extra: { messageType?: string; metadata?: Record<string, unknown> } = {},
): Promise<number | null> {
  const messageId = await db.transaction(async (tx) => {
    const [business] = await tx.select().from(messagingParticipants).where(and(
      eq(messagingParticipants.conversationId, conversationId),
      eq(messagingParticipants.participantType, MESSAGING_PARTICIPANT_TYPE.BUSINESS),
    ));
    if (!business) return null;
    const [message] = await tx.insert(messagingMessages).values({
      conversationId,
      senderParticipantId: business.id,
      messageType: (extra.messageType ?? MESSAGE_TYPE.SYSTEM) as typeof MESSAGE_TYPE.SYSTEM,
      category: MESSAGE_CATEGORY.CONVERSATIONAL,
      content,
      ...(extra.metadata ? { metadata: extra.metadata } : {}),
    }).returning();
    const recipients = await tx.select().from(messagingParticipants)
      .where(and(eq(messagingParticipants.conversationId, conversationId), ne(messagingParticipants.id, business.id)));
    for (const r of recipients) {
      await tx.insert(messagingDeliveries).values({ messageId: message.id, participantId: r.id, status: MESSAGE_DELIVERY_STATUS.QUEUED });
    }
    await tx.insert(messagingEvents).values({
      conversationId, messageId: message.id, eventType: MESSAGE_EVENT_TYPE.MESSAGE_CREATED,
      payload: { senderParticipantId: business.id, recipientCount: recipients.length, generationSource: { type: "auto_reply", kind } },
    });
    return message.id;
  });
  if (messageId) await deliverCommittedMessage({ businessId, businessConversationId, messageId, publishCreated: true });
  return messageId;
}

/** Call after a customer's message committed. Never throws. */
export async function sendAutoRepliesAfterCustomerMessage(
  businessId: number, businessConversationId: number,
  trigger?: { messageId: number; text: string; buttonId?: string | null; buttonTitle?: string | null },
): Promise<void> {
  try {
    const [conv] = await db.select().from(businessConversations)
      .where(and(eq(businessConversations.id, businessConversationId), eq(businessConversations.businessId, businessId)));
    if (!conv) return;

    const settings = await getMessagingSettings(businessId);
    // Read the chat before anything is sent, so "first message" means the customer's first message.
    const recent = await db.select({ id: messagingMessages.id, messageType: messagingMessages.messageType, createdAt: messagingMessages.createdAt, content: messagingMessages.content })
      .from(messagingMessages).where(eq(messagingMessages.conversationId, conv.conversationId))
      .orderBy(desc(messagingMessages.createdAt)).limit(50);

    // Order, like WhatsApp Business: greeting (first message only) -> keyword/button bot answer -> away notice.
    if (settings?.greeting.enabled && settings.greeting.text && recent.length === 1) {
      await sendAsBusiness(businessId, conv.id, conv.conversationId, settings.greeting.text, "greeting");
    }
    if (trigger) {
      const { runAutoResponders } = await import("./auto-responders");
      await runAutoResponders({
        businessId, businessConversationId: conv.id, conversationId: conv.conversationId,
        triggerMessageId: trigger.messageId,
        message: { text: trigger.text, buttonId: trigger.buttonId, buttonTitle: trigger.buttonTitle },
        send: (content, extra) => sendAsBusiness(businessId, conv.id, conv.conversationId, content, "auto_responder", extra),
      });
    }
    if (!settings) return;
    if (settings.away.enabled && settings.away.text && !isWithinOpeningHours(settings)) {
      const lastAway = recent.find((m) => m.messageType === MESSAGE_TYPE.SYSTEM && m.content === settings.away.text);
      if (!lastAway || Date.now() - (lastAway.createdAt?.getTime() ?? 0) > AWAY_REPEAT_MS) {
        await sendAsBusiness(businessId, conv.id, conv.conversationId, settings.away.text, "away");
      }
    }
  } catch (error) {
    logger.warn("Messaging", `auto-reply failed for business ${businessId}: ${String(error)}`);
  }
}
