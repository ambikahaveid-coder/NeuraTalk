import { db } from "../../db";
import { conversations, messages } from "@shared/schema";
import { eq, desc, and } from "drizzle-orm";

// P0 security fix (2026-08-23): every method here now requires and enforces
// userId ownership. Previously getAllConversations()/getConversation() had
// no user filter at all -- any caller (and the routes calling these had no
// auth middleware either) could list and read every user's AI-chat
// conversations. conversations.userId already existed as a column; it was
// simply never used to scope these queries.
export interface IChatStorage {
  getConversation(id: number, userId: number): Promise<typeof conversations.$inferSelect | undefined>;
  getAllConversations(userId: number): Promise<(typeof conversations.$inferSelect)[]>;
  createConversation(title: string, userId: number): Promise<typeof conversations.$inferSelect>;
  deleteConversation(id: number, userId: number): Promise<void>;
  getMessagesByConversation(conversationId: number): Promise<(typeof messages.$inferSelect)[]>;
  createMessage(conversationId: number, role: string, content: string): Promise<typeof messages.$inferSelect>;
}

export const chatStorage: IChatStorage = {
  async getConversation(id: number, userId: number) {
    const [conversation] = await db.select().from(conversations)
      .where(and(eq(conversations.id, id), eq(conversations.userId, userId)));
    return conversation;
  },

  async getAllConversations(userId: number) {
    return db.select().from(conversations)
      .where(eq(conversations.userId, userId))
      .orderBy(desc(conversations.createdAt));
  },

  async createConversation(title: string, userId: number) {
    const [conversation] = await db.insert(conversations).values({ title, userId }).returning();
    return conversation;
  },

  async deleteConversation(id: number, userId: number) {
    // Ownership check via WHERE, not a separate lookup -- deleteConversation
    // is only ever called after the route already loaded and confirmed
    // ownership via getConversation(), so this is a second belt-and-
    // suspenders check, not the only one. Messages deleted first (rather
    // than relying solely on the schema's ON DELETE CASCADE) to keep this
    // method correct even if that constraint is ever changed.
    await db.delete(messages).where(eq(messages.conversationId, id));
    await db.delete(conversations).where(and(eq(conversations.id, id), eq(conversations.userId, userId)));
  },

  // Scoped by conversationId only -- callers are required to have already
  // verified conversation ownership via getConversation(id, userId) before
  // reaching these, since a message has no direct userId of its own.
  async getMessagesByConversation(conversationId: number) {
    return db.select().from(messages).where(eq(messages.conversationId, conversationId)).orderBy(messages.createdAt);
  },

  async createMessage(conversationId: number, role: string, content: string) {
    const [message] = await db.insert(messages).values({ conversationId, role, content }).returning();
    return message;
  },
};
