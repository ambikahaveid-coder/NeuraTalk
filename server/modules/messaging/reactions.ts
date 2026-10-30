/**
 * Reactions and edits in business chats (customer <-> business), matching
 * 1:1 and group chats. A reaction belongs to a conversation participant:
 * the customer's own participant, or the business (one shared identity for
 * all its agents). Table `messaging_reactions` is created at startup.
 */
import type { Express, Request, Response } from "express";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "../../db";
import {
  businessConversations, customers, messagingMessages, messagingParticipants, messagingReactions, messagingTranslations,
  MESSAGING_PARTICIPANT_TYPE, MESSAGE_CATEGORY, PERMISSIONS,
} from "@shared/schema";
import { requireAuth, requireCompanyAccess, requirePermission } from "../../role-middleware";
import { publishMessagingEvent } from "./realtime";
import { logger } from "../../observability";
import { getRedisClient, isRedisReady } from "../../redis";

const NOT_AN_EMOJI = new RegExp("[\\p{L}\\p{N}\\s<>]", "u");
const EDIT_WINDOW_MS = 15 * 60 * 1000;

const TYPING_SECONDS = 6;
const typingKey = (conversationId: number, side: "business" | "customer") => `biztyping:${conversationId}:${side}`;

export async function setTyping(conversationId: number, side: "business" | "customer"): Promise<void> {
  try {
    if (!isRedisReady()) return;
    await getRedisClient().set(typingKey(conversationId, side), "1", "EX", TYPING_SECONDS);
  } catch { /* best effort */ }
}

export async function isTyping(conversationId: number, side: "business" | "customer"): Promise<boolean> {
  try {
    if (!isRedisReady()) return false;
    return (await getRedisClient().exists(typingKey(conversationId, side))) === 1;
  } catch {
    return false;
  }
}

// Same table and columns as shared/schema.ts `messagingReactions`
// (migration 0004); this only makes sure it exists on older databases.
export async function ensureReactionsTable(): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "messaging_reactions" (
      "id" serial PRIMARY KEY,
      "message_id" integer NOT NULL REFERENCES "messaging_messages"("id") ON DELETE CASCADE,
      "participant_id" integer NOT NULL REFERENCES "messaging_participants"("id"),
      "reaction" text NOT NULL,
      "created_at" timestamp DEFAULT now()
    )`);
  await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS "messaging_reactions_message_participant_idx" ON "messaging_reactions" ("message_id", "participant_id")`);
}

/** { messageId: { participantId: emoji } } for a page of messages. */
export async function reactionsByMessage(messageIds: number[]): Promise<Map<number, Record<string, string>>> {
  const out = new Map<number, Record<string, string>>();
  if (messageIds.length === 0) return out;
  try {
    const found = await db.select().from(messagingReactions).where(inArray(messagingReactions.messageId, messageIds));
    for (const r of found) {
      const map = out.get(r.messageId) ?? {};
      map[String(r.participantId)] = r.reaction;
      out.set(r.messageId, map);
    }
  } catch (err) {
    logger.warn("Reactions", "Could not load reactions", { error: (err as Error).message });
  }
  return out;
}

async function businessParticipantId(conversationId: number): Promise<number | null> {
  const [p] = await db.select({ id: messagingParticipants.id }).from(messagingParticipants)
    .where(and(eq(messagingParticipants.conversationId, conversationId), eq(messagingParticipants.participantType, MESSAGING_PARTICIPANT_TYPE.BUSINESS)));
  return p?.id ?? null;
}

async function userParticipantId(conversationId: number, userId: number): Promise<number | null> {
  const [p] = await db.select({ id: messagingParticipants.id }).from(messagingParticipants)
    .where(and(
      eq(messagingParticipants.conversationId, conversationId),
      eq(messagingParticipants.participantType, MESSAGING_PARTICIPANT_TYPE.USER),
      eq(messagingParticipants.participantId, userId),
    ));
  return p?.id ?? null;
}

async function messageIn(conversationId: number, messageId: number) {
  const [m] = await db.select().from(messagingMessages)
    .where(and(eq(messagingMessages.id, messageId), eq(messagingMessages.conversationId, conversationId), isNull(messagingMessages.deletedAt)));
  return m ?? null;
}

async function setReaction(messageId: number, participantId: number, emoji: string | null): Promise<Record<string, string>> {
  if (emoji) {
    await db.insert(messagingReactions).values({ messageId, participantId, reaction: emoji })
      .onConflictDoUpdate({
        target: [messagingReactions.messageId, messagingReactions.participantId],
        set: { reaction: emoji, createdAt: new Date() },
      });
  } else {
    await db.delete(messagingReactions).where(and(eq(messagingReactions.messageId, messageId), eq(messagingReactions.participantId, participantId)));
  }
  return (await reactionsByMessage([messageId])).get(messageId) ?? {};
}

async function editMessage(message: typeof messagingMessages.$inferSelect, content: string) {
  const [updated] = await db.update(messagingMessages)
    .set({ content, editedAt: new Date() })
    .where(eq(messagingMessages.id, message.id))
    .returning();
  // Cached translations are of the old words.
  await db.delete(messagingTranslations).where(eq(messagingTranslations.messageId, message.id));
  return updated;
}

function validEmoji(emoji: unknown): emoji is string | null {
  return emoji === null || (typeof emoji === "string" && emoji.trim().length > 0 && emoji.length <= 16 && !NOT_AN_EMOJI.test(emoji));
}

function canEdit(message: typeof messagingMessages.$inferSelect): string | null {
  if (message.messageType !== "text") return "Only text messages can be edited.";
  if (message.category !== MESSAGE_CATEGORY.CONVERSATIONAL) return "Template messages can't be edited.";
  if (Date.now() - new Date(message.createdAt ?? 0).getTime() > EDIT_WINDOW_MS) return "Messages can only be edited for 15 minutes after sending.";
  return null;
}

/** Tells both sides' open screens to refresh this conversation. */
function announce(businessId: number, bizConversationId: number, customerUserId: number | null) {
  // Clients refetch the thread on delivery.updated; reuse it for reactions/edits.
  publishMessagingEvent({ type: "delivery.updated", businessId, conversationId: bizConversationId, customerUserId, status: "delivered" });
}

export function registerBusinessChatReactionRoutes(app: Express): void {
  // ---- Business side (inbox / Business app)
  const bizGuard = [requireAuth, requireCompanyAccess("businessId"), requirePermission(PERMISSIONS.MESSAGING_SEND)];

  async function bizContext(req: Request) {
    const businessId = Number(req.params.businessId);
    const bizConversationId = Number(req.params.id);
    const [bc] = await db.select().from(businessConversations)
      .where(and(eq(businessConversations.id, bizConversationId), eq(businessConversations.businessId, businessId)));
    if (!bc) return null;
    const customerId = bc.customerId;
    const [customer] = customerId == null
      ? []
      : await db.select({ linkedUserId: customers.linkedUserId }).from(customers).where(eq(customers.id, customerId));
    return { businessId, bizConversationId, conversationId: bc.conversationId, customerUserId: customer?.linkedUserId ?? null };
  }

  app.post("/api/business/:businessId/conversations/:id/messages/:messageId/reaction", ...bizGuard, async (req: Request, res: Response) => {
    if (!validEmoji(req.body?.emoji)) return res.status(400).json({ success: false, error: "Pick an emoji." });
    const ctx = await bizContext(req);
    if (!ctx) return res.status(404).json({ success: false, error: "Conversation not found" });
    const message = await messageIn(ctx.conversationId, Number(req.params.messageId));
    if (!message) return res.status(404).json({ success: false, error: "Message not found" });
    const participant = await businessParticipantId(ctx.conversationId);
    if (!participant) return res.status(409).json({ success: false, error: "This conversation has no business participant" });
    const reactions = await setReaction(message.id, participant, req.body.emoji);
    announce(ctx.businessId, ctx.bizConversationId, ctx.customerUserId);
    return res.json({ success: true, reactions, myParticipantId: participant });
  });

  app.patch("/api/business/:businessId/conversations/:id/messages/:messageId", ...bizGuard, async (req: Request, res: Response) => {
    const content = typeof req.body?.content === "string" ? req.body.content.trim() : "";
    if (!content || content.length > 4096) return res.status(400).json({ success: false, error: "Message can't be empty." });
    const ctx = await bizContext(req);
    if (!ctx) return res.status(404).json({ success: false, error: "Conversation not found" });
    const message = await messageIn(ctx.conversationId, Number(req.params.messageId));
    if (!message) return res.status(404).json({ success: false, error: "Message not found" });
    // An agent edits only what they wrote themselves.
    const mine = await userParticipantId(ctx.conversationId, req.user!.id);
    if (!mine || message.senderParticipantId !== mine) return res.status(403).json({ success: false, error: "You can only edit your own messages." });
    const problem = canEdit(message);
    if (problem) return res.status(400).json({ success: false, error: problem });
    const updated = await editMessage(message, content);
    announce(ctx.businessId, ctx.bizConversationId, ctx.customerUserId);
    return res.json({ success: true, message: updated });
  });

  // ---- Customer side (NeuraTalk app / web)
  async function customerContext(req: Request) {
    const businessId = Number(req.params.businessId);
    const userId = req.user!.id;
    const [customer] = await db.select({ id: customers.id }).from(customers)
      .where(and(eq(customers.businessId, businessId), eq(customers.linkedUserId, userId)));
    if (!customer) return null;
    const [bc] = await db.select().from(businessConversations)
      .where(and(eq(businessConversations.businessId, businessId), eq(businessConversations.customerId, customer.id)));
    if (!bc) return null;
    const participant = await userParticipantId(bc.conversationId, userId);
    if (!participant) return null;
    return { businessId, bizConversationId: bc.id, conversationId: bc.conversationId, participant, userId };
  }

  // "typing…" -- each side pings while composing; it fades after 6 s.
  app.post("/api/business/:businessId/conversations/:id/typing", ...bizGuard, async (req: Request, res: Response) => {
    const ctx = await bizContext(req);
    if (!ctx) return res.status(404).json({ success: false, error: "Conversation not found" });
    await setTyping(ctx.conversationId, "business");
    return res.json({ success: true });
  });
  app.post("/api/messaging/business/:businessId/typing", requireAuth, async (req: Request, res: Response) => {
    const ctx = await customerContext(req);
    if (!ctx) return res.json({ success: true }); // no chat yet: nothing to show
    await setTyping(ctx.conversationId, "customer");
    return res.json({ success: true });
  });

  app.post("/api/messaging/business/:businessId/messages/:messageId/reaction", requireAuth, async (req: Request, res: Response) => {
    if (!validEmoji(req.body?.emoji)) return res.status(400).json({ success: false, error: "Pick an emoji." });
    const ctx = await customerContext(req);
    if (!ctx) return res.status(404).json({ success: false, error: "Conversation not found" });
    const message = await messageIn(ctx.conversationId, Number(req.params.messageId));
    if (!message) return res.status(404).json({ success: false, error: "Message not found" });
    const reactions = await setReaction(message.id, ctx.participant, req.body.emoji);
    announce(ctx.businessId, ctx.bizConversationId, ctx.userId);
    return res.json({ success: true, reactions, myParticipantId: ctx.participant });
  });

  app.patch("/api/messaging/business/:businessId/messages/:messageId", requireAuth, async (req: Request, res: Response) => {
    const content = typeof req.body?.content === "string" ? req.body.content.trim() : "";
    if (!content || content.length > 4096) return res.status(400).json({ success: false, error: "Message can't be empty." });
    const ctx = await customerContext(req);
    if (!ctx) return res.status(404).json({ success: false, error: "Conversation not found" });
    const message = await messageIn(ctx.conversationId, Number(req.params.messageId));
    if (!message) return res.status(404).json({ success: false, error: "Message not found" });
    if (message.senderParticipantId !== ctx.participant) return res.status(403).json({ success: false, error: "You can only edit your own messages." });
    // An order's message is its record; change an order by cancelling it.
    const { isOrderMessage } = await import("./orders");
    if (await isOrderMessage(message.id)) return res.status(409).json({ success: false, error: "An order can't be edited. Cancel it and order again." });
    const problem = canEdit(message);
    if (problem) return res.status(400).json({ success: false, error: problem });
    const updated = await editMessage(message, content);
    announce(ctx.businessId, ctx.bizConversationId, ctx.userId);
    return res.json({ success: true, message: updated });
  });
}

/** Adds `reactions` to a page of business-chat messages. */
export async function attachReactions<T extends { id: number }>(messages: T[]): Promise<Array<T & { reactions: Record<string, string> }>> {
  const map = await reactionsByMessage(messages.map((m) => m.id));
  return messages.map((m) => ({ ...m, reactions: map.get(m.id) ?? {} }));
}

export { businessParticipantId };
// Silence unused-import lint for inArray in some builds.
void inArray;
