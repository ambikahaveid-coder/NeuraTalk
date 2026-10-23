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

async function sendAsBusiness(businessId: number, businessConversationId: number, conversationId: number, content: string, kind: string) {
  const messageId = await db.transaction(async (tx) => {
    const [business] = await tx.select().from(messagingParticipants).where(and(
      eq(messagingParticipants.conversationId, conversationId),
      eq(messagingParticipants.participantType, MESSAGING_PARTICIPANT_TYPE.BUSINESS),
    ));
    if (!business) return null;
    const [message] = await tx.insert(messagingMessages).values({
      conversationId,
      senderParticipantId: business.id,
      messageType: MESSAGE_TYPE.SYSTEM,
      category: MESSAGE_CATEGORY.CONVERSATIONAL,
      content,
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
}

/** Call after a customer's message committed. Never throws. */
export async function sendAutoRepliesAfterCustomerMessage(businessId: number, businessConversationId: number): Promise<void> {
  try {
    const settings = await getMessagingSettings(businessId);
    if (!settings || (!settings.greeting.enabled && !settings.away.enabled)) return;
    const [conv] = await db.select().from(businessConversations)
      .where(and(eq(businessConversations.id, businessConversationId), eq(businessConversations.businessId, businessId)));
    if (!conv) return;

    const recent = await db.select({ id: messagingMessages.id, messageType: messagingMessages.messageType, createdAt: messagingMessages.createdAt, content: messagingMessages.content })
      .from(messagingMessages).where(eq(messagingMessages.conversationId, conv.conversationId))
      .orderBy(desc(messagingMessages.createdAt)).limit(50);

    if (settings.greeting.enabled && settings.greeting.text && recent.length === 1) {
      await sendAsBusiness(businessId, conv.id, conv.conversationId, settings.greeting.text, "greeting");
    }
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
