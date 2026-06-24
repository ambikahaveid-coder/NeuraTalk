import { Router, type Request, type Response } from "express";
import { EventEmitter } from "node:events";
import { and, asc, desc, eq, inArray, or } from "drizzle-orm";
import { z } from "zod";
import { db } from "./db";
import { personalChatMessages, personalChatThreads, userContacts, users } from "@shared/schema";
import { normalizePhoneNumber } from "@shared/phone";
import { openai } from "./replit_integrations/audio/client";
import { requireAuth } from "./role-middleware";

const router = Router();

const createThreadSchema = z.object({
  userId: z.number().int().positive().optional(),
  identifier: z.string().trim().min(3).max(200).optional(),
  sourceLanguage: z.string().trim().min(2).max(16).optional(),
  targetLanguage: z.string().trim().min(2).max(16).optional(),
}).refine((value) => value.userId || value.identifier, {
  message: "A target user or identifier is required.",
});

const sendMessageSchema = z.object({
  content: z.string().trim().min(1).max(4000),
  originalLanguage: z.string().trim().min(2).max(16).optional(),
  clientMessageId: z.string().trim().min(1).max(120).optional(),
  messageType: z.enum(["text", "voice_note", "attachment"]).optional(),
  attachmentUrl: z.string().trim().min(1).max(2000).optional(),
  attachmentTitle: z.string().trim().min(1).max(240).optional(),
});

const typingSchema = z.object({
  isTyping: z.boolean(),
});

const TYPING_TTL_MS = 8_000;
const typingState = new Map<string, { isTyping: boolean; updatedAt: number }>();
const activePresence = new Map<number, number>();
const personalChatBus = new EventEmitter();
personalChatBus.setMaxListeners(512);

type AuthedRequest = Request & {
  user?: {
    id: number;
    username?: string | null;
    email?: string | null;
    phone?: string | null;
  };
};

function normalizeLanguage(language?: string | null): string {
  const value = String(language || "en").trim().toLowerCase();
  if (!value) return "en";
  return value.split(/[-_]/)[0] || "en";
}

function preferredAppIdentifier(peer: {
  username?: string | null;
  email?: string | null;
  phone?: string | null;
}) {
  return peer.username || peer.email || peer.phone || "";
}

function typingKey(threadId: number, userId: number) {
  return `${threadId}:${userId}`;
}

function markUserPresence(userId: number) {
  activePresence.set(userId, Date.now());
}

function setTyping(threadId: number, userId: number, isTyping: boolean) {
  const key = typingKey(threadId, userId);
  if (!isTyping) {
    typingState.delete(key);
    return;
  }

  typingState.set(key, {
    isTyping: true,
    updatedAt: Date.now(),
  });
}

function getTyping(threadId: number, userId: number) {
  const key = typingKey(threadId, userId);
  const existing = typingState.get(key);
  if (!existing) return false;
  if (Date.now() - existing.updatedAt > TYPING_TTL_MS) {
    typingState.delete(key);
    return false;
  }
  return existing.isTyping;
}

function normalizePair(userA: number, userB: number) {
  return userA < userB
    ? { participantAUserId: userA, participantBUserId: userB }
    : { participantAUserId: userB, participantBUserId: userA };
}

function personalChatEventKey(userId: number) {
  return `personal-chat:${userId}`;
}

function emitPersonalChatEvent(userIds: number[], event: Record<string, unknown>) {
  for (const userId of Array.from(new Set(userIds))) {
    personalChatBus.emit(personalChatEventKey(userId), {
      ...event,
      userId,
      emittedAt: new Date().toISOString(),
    });
  }
}

function buildMessagePreview(
  messageType: "text" | "voice_note" | "attachment",
  content: string,
  attachmentTitle?: string | null,
) {
  if (messageType === "voice_note") {
    return attachmentTitle?.trim() || "Voice note";
  }
  if (messageType === "attachment") {
    return attachmentTitle?.trim() || content.trim() || "Attachment";
  }
  return content.trim().slice(0, 180);
}

function translationsObject(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );
}

async function detectLanguage(text: string): Promise<string> {
  try {
    const { isAzureTranslatorAvailable, azureDetectLanguage } = await import("./azure-service");
    if (isAzureTranslatorAvailable()) {
      return normalizeLanguage(await azureDetectLanguage(text));
    }
  } catch {
    // fall through
  }

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: "Detect the message language. Reply with only a short ISO 639-1 language code such as en, hi, te.",
        },
        { role: "user", content: text },
      ],
      max_tokens: 5,
    });

    return normalizeLanguage(response.choices[0]?.message?.content || "en");
  } catch {
    return "en";
  }
}

async function translatePersonalText(text: string, fromLang: string, toLang: string): Promise<string> {
  if (!text.trim() || normalizeLanguage(fromLang) === normalizeLanguage(toLang)) {
    return text;
  }

  try {
    const { isAzureTranslatorAvailable, azureTranslate } = await import("./azure-service");
    if (isAzureTranslatorAvailable()) {
      const translated = await azureTranslate(text, fromLang, toLang);
      if (translated?.trim()) {
        return translated;
      }
    }
  } catch {
    // fall through
  }

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `Translate this personal chat message from ${fromLang} to ${toLang}. Keep slang, tone, emojis, and casual wording natural. Reply with only the translated message.`,
        },
        { role: "user", content: text },
      ],
    });

    return response.choices[0]?.message?.content?.trim() || text;
  } catch {
    try {
      const { translateText } = await import("./elevenlabs-service");
      return await translateText(text, fromLang, toLang);
    } catch {
      return text;
    }
  }
}

async function resolveRecipientUser(currentUserId: number, payload: z.infer<typeof createThreadSchema>) {
  if (payload.userId) {
    const [recipient] = await db.select().from(users).where(eq(users.id, payload.userId));
    return recipient && recipient.id !== currentUserId ? recipient : null;
  }

  const identifier = String(payload.identifier || "").trim();
  if (!identifier) return null;

  const normalizedPhone = normalizePhoneNumber(identifier);
  const candidates = await db.select().from(users).where(or(
    eq(users.username, identifier),
    eq(users.email, identifier),
    eq(users.phone, normalizedPhone),
  ));

  return candidates.find((candidate) => candidate.id !== currentUserId) || null;
}

function getViewerContext(thread: typeof personalChatThreads.$inferSelect, viewerId: number) {
  const isParticipantA = thread.participantAUserId === viewerId;
  return {
    isParticipantA,
    viewerLanguage: normalizeLanguage(isParticipantA ? thread.participantALanguage : thread.participantBLanguage),
    peerLanguage: normalizeLanguage(isParticipantA ? thread.participantBLanguage : thread.participantALanguage),
    peerUserId: isParticipantA ? thread.participantBUserId : thread.participantAUserId,
  };
}

function formatMessage(
  message: typeof personalChatMessages.$inferSelect,
  viewerId: number,
  viewerLanguage: string,
) {
  const translations = translationsObject(message.translations);
  const translatedContent = viewerLanguage !== normalizeLanguage(message.originalLanguage)
    ? translations[viewerLanguage] || null
    : null;
  const isOwn = message.senderUserId === viewerId;
  const displayContent = !isOwn && translatedContent ? translatedContent : message.originalContent;

  return {
    ...message,
    translations,
    attachmentUrl: typeof (message.metadata as any)?.attachmentUrl === "string" ? (message.metadata as any).attachmentUrl : null,
    attachmentTitle: typeof (message.metadata as any)?.attachmentTitle === "string" ? (message.metadata as any).attachmentTitle : null,
    translatedContent,
    displayContent,
    displayLanguage: !isOwn && translatedContent ? viewerLanguage : normalizeLanguage(message.originalLanguage),
    showingTranslated: !isOwn && Boolean(translatedContent),
    isOwn,
  };
}

async function findBestContact(
  ownerUserId: number,
  peer: {
    username?: string | null;
    email?: string | null;
    phone?: string | null;
  } | undefined,
) {
  if (!peer) return null;

  const contacts = await db.select().from(userContacts).where(eq(userContacts.userId, ownerUserId));
  const phone = peer.phone ? normalizePhoneNumber(peer.phone) : "";

  return contacts.find((contact) => {
    const identifier = String(contact.identifier || "").trim();
    return identifier === peer.username
      || identifier === peer.email
      || normalizePhoneNumber(identifier) === phone;
  }) || null;
}

router.get("/api/personal-chats/discover", requireAuth, async (req: AuthedRequest, res: Response) => {
  try {
    const viewerId = req.user!.id;
    markUserPresence(viewerId);

    const query = String(req.query.q || "").trim();
    if (query.length < 2) {
      return res.json({ results: [] });
    }

    const normalizedPhone = normalizePhoneNumber(query);
    const candidates = await db.select({
      id: users.id,
      username: users.username,
      email: users.email,
      phone: users.phone,
      avatarUrl: users.avatarUrl,
    }).from(users).where(or(
      eq(users.username, query),
      eq(users.email, query),
      eq(users.phone, normalizedPhone),
    ));

    const results = candidates
      .filter((candidate) => candidate.id !== viewerId)
      .slice(0, 10)
      .map((candidate) => ({
        id: candidate.id,
        displayName: candidate.username || candidate.email || candidate.phone || "Unknown user",
        username: candidate.username,
        email: candidate.email,
        phone: candidate.phone,
        avatarUrl: candidate.avatarUrl,
        identifier: preferredAppIdentifier(candidate),
      }));

    res.json({ results });
  } catch (error) {
    console.error("[PersonalChat] discover failed:", error);
    res.status(500).json({ error: "Failed to discover users." });
  }
});

router.get("/api/personal-chats", requireAuth, async (req: AuthedRequest, res: Response) => {
  try {
    const viewerId = req.user!.id;
    markUserPresence(viewerId);
    const threads = await db.select().from(personalChatThreads)
      .where(or(
        eq(personalChatThreads.participantAUserId, viewerId),
        eq(personalChatThreads.participantBUserId, viewerId),
      ))
      .orderBy(desc(personalChatThreads.lastMessageAt), desc(personalChatThreads.updatedAt));

    if (threads.length === 0) {
      return res.json({ threads: [] });
    }

    const peerIds = Array.from(new Set(threads.map((thread) => getViewerContext(thread, viewerId).peerUserId)));
    const peers = await db.select({
      id: users.id,
      username: users.username,
      email: users.email,
      phone: users.phone,
      avatarUrl: users.avatarUrl,
    }).from(users).where(inArray(users.id, peerIds));
    const peerById = new Map(peers.map((peer) => [peer.id, peer]));

    const viewerContacts = await db.select().from(userContacts).where(eq(userContacts.userId, viewerId));
    const unreadMessages = await db.select().from(personalChatMessages)
      .where(inArray(personalChatMessages.threadId, threads.map((thread) => thread.id)));

    const formatted = threads.map((thread) => {
      const context = getViewerContext(thread, viewerId);
      const peer = peerById.get(context.peerUserId);
      const matchingContact = viewerContacts.find((contact) => {
        const identifier = String(contact.identifier || "").trim();
        return identifier === peer?.username
          || identifier === peer?.email
          || normalizePhoneNumber(identifier) === normalizePhoneNumber(peer?.phone || "");
      });

      const unreadCount = unreadMessages.filter((message) =>
        message.threadId === thread.id
        && message.senderUserId !== viewerId
        && !message.seenAt,
      ).length;

      return {
        ...thread,
        viewerLanguage: context.viewerLanguage,
        peerLanguage: context.peerLanguage,
        unreadCount,
        peer: {
          id: peer?.id,
          username: peer?.username || matchingContact?.name || "Unknown user",
          email: peer?.email || null,
          phone: peer?.phone || null,
          avatarUrl: peer?.avatarUrl || matchingContact?.avatarUrl || null,
          displayName: matchingContact?.name || peer?.username || peer?.email || peer?.phone || "Unknown user",
          contactLanguage: matchingContact?.language || context.peerLanguage,
          identifier: preferredAppIdentifier(peer || {}),
          isFavorite: matchingContact?.isFavorite || false,
        },
      };
    });

    res.json({ threads: formatted });
  } catch (error) {
    console.error("[PersonalChat] list failed:", error);
    res.status(500).json({ error: "Failed to load personal chats." });
  }
});

router.get("/api/personal-chats/stream", requireAuth, async (req: AuthedRequest, res: Response) => {
  const viewerId = req.user!.id;
  markUserPresence(viewerId);

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();

  const send = (payload: Record<string, unknown>) => {
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  };

  send({ type: "ready", viewerId, emittedAt: new Date().toISOString() });

  const heartbeat = setInterval(() => {
    send({ type: "heartbeat", ts: Date.now() });
  }, 20_000);

  const listener = (payload: Record<string, unknown>) => {
    send(payload);
  };

  personalChatBus.on(personalChatEventKey(viewerId), listener);

  req.on("close", () => {
    clearInterval(heartbeat);
    personalChatBus.off(personalChatEventKey(viewerId), listener);
    res.end();
  });
});

router.post("/api/personal-chats", requireAuth, async (req: AuthedRequest, res: Response) => {
  try {
    const viewerId = req.user!.id;
    markUserPresence(viewerId);
    const input = createThreadSchema.parse(req.body);
    const recipient = await resolveRecipientUser(viewerId, input);

    if (!recipient) {
      return res.status(404).json({ error: "Recipient user not found in Neura Talk." });
    }

    const pair = normalizePair(viewerId, recipient.id);
    const [existing] = await db.select().from(personalChatThreads).where(and(
      eq(personalChatThreads.participantAUserId, pair.participantAUserId),
      eq(personalChatThreads.participantBUserId, pair.participantBUserId),
    ));

    const sourceLanguage = normalizeLanguage(input.sourceLanguage || "en");
    const targetLanguage = normalizeLanguage(input.targetLanguage || "en");

    const participantValues = viewerId === pair.participantAUserId
      ? {
          participantALanguage: sourceLanguage,
          participantBLanguage: targetLanguage,
        }
      : {
          participantALanguage: targetLanguage,
          participantBLanguage: sourceLanguage,
        };

    const thread = existing
      ? (await db.update(personalChatThreads)
          .set({ ...participantValues, updatedAt: new Date() })
          .where(eq(personalChatThreads.id, existing.id))
          .returning())[0]
      : (await db.insert(personalChatThreads).values({
          ...pair,
          ...participantValues,
          createdByUserId: viewerId,
          lastMessageAt: new Date(),
        }).returning())[0];

    emitPersonalChatEvent([viewerId, recipient.id], {
      type: existing ? "thread_updated" : "thread_created",
      threadId: thread.id,
      peerUserId: recipient.id,
    });

    const peerContact = await findBestContact(viewerId, recipient);
    res.status(existing ? 200 : 201).json({
      thread: {
        ...thread,
        peer: {
          id: recipient.id,
          username: recipient.username,
          email: recipient.email,
          phone: recipient.phone,
          avatarUrl: recipient.avatarUrl,
          displayName: peerContact?.name || recipient.username || recipient.email || recipient.phone || "Unknown user",
          contactLanguage: peerContact?.language || targetLanguage,
          identifier: preferredAppIdentifier(recipient),
          isFavorite: peerContact?.isFavorite || false,
        },
      },
    });
  } catch (error) {
    console.error("[PersonalChat] create failed:", error);
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.issues[0]?.message || "Invalid personal chat request." });
    }
    res.status(500).json({ error: "Failed to create personal chat." });
  }
});

router.get("/api/personal-chats/:threadId", requireAuth, async (req: AuthedRequest, res: Response) => {
  try {
    const viewerId = req.user!.id;
    markUserPresence(viewerId);
    const threadId = Number(req.params.threadId);
    if (!Number.isFinite(threadId)) {
      return res.status(400).json({ error: "Invalid chat thread." });
    }

    const [thread] = await db.select().from(personalChatThreads).where(eq(personalChatThreads.id, threadId));
    if (!thread) {
      return res.status(404).json({ error: "Chat thread not found." });
    }

    const context = getViewerContext(thread, viewerId);
    if (context.peerUserId <= 0 || (thread.participantAUserId !== viewerId && thread.participantBUserId !== viewerId)) {
      return res.status(403).json({ error: "Access denied." });
    }

    const [peer] = await db.select({
      id: users.id,
      username: users.username,
      email: users.email,
      phone: users.phone,
      avatarUrl: users.avatarUrl,
    }).from(users).where(eq(users.id, context.peerUserId));
    const peerContact = await findBestContact(viewerId, peer);

    const messages = await db.select().from(personalChatMessages)
      .where(eq(personalChatMessages.threadId, threadId))
      .orderBy(asc(personalChatMessages.createdAt), asc(personalChatMessages.id));

    const deliverableIds = messages
      .filter((message) => message.senderUserId !== viewerId && !message.deliveredAt)
      .map((message) => message.id);

    if (deliverableIds.length > 0) {
      await db.update(personalChatMessages)
        .set({
          deliveredAt: new Date(),
          deliveryStatus: "delivered",
          updatedAt: new Date(),
        })
        .where(inArray(personalChatMessages.id, deliverableIds));

      emitPersonalChatEvent([viewerId, context.peerUserId], {
        type: "messages_delivered",
        threadId,
        deliveredIds: deliverableIds,
      });
    }

    const formattedMessages = messages.map((message) => formatMessage({
      ...message,
      deliveredAt: deliverableIds.includes(message.id) ? new Date() : message.deliveredAt,
      deliveryStatus: deliverableIds.includes(message.id) ? "delivered" : message.deliveryStatus,
    }, viewerId, context.viewerLanguage));

    res.json({
      thread: {
        ...thread,
        viewerLanguage: context.viewerLanguage,
        peerLanguage: context.peerLanguage,
        peer: {
          id: peer?.id,
          username: peer?.username,
          email: peer?.email,
          phone: peer?.phone,
          avatarUrl: peer?.avatarUrl || peerContact?.avatarUrl || null,
          displayName: peerContact?.name || peer?.username || peer?.email || peer?.phone || "Unknown user",
          contactLanguage: peerContact?.language || context.peerLanguage,
          identifier: preferredAppIdentifier(peer || {}),
          isFavorite: peerContact?.isFavorite || false,
        },
      },
      messages: formattedMessages,
    });
  } catch (error) {
    console.error("[PersonalChat] fetch failed:", error);
    res.status(500).json({ error: "Failed to load personal chat." });
  }
});

router.post("/api/personal-chats/:threadId/messages", requireAuth, async (req: AuthedRequest, res: Response) => {
  try {
    const viewerId = req.user!.id;
    markUserPresence(viewerId);
    const threadId = Number(req.params.threadId);
    const input = sendMessageSchema.parse(req.body);

    const [thread] = await db.select().from(personalChatThreads).where(eq(personalChatThreads.id, threadId));
    if (!thread) {
      return res.status(404).json({ error: "Chat thread not found." });
    }

    const context = getViewerContext(thread, viewerId);
    if (thread.participantAUserId !== viewerId && thread.participantBUserId !== viewerId) {
      return res.status(403).json({ error: "Access denied." });
    }

    if (input.clientMessageId) {
      const [existing] = await db.select().from(personalChatMessages).where(and(
        eq(personalChatMessages.threadId, threadId),
        eq(personalChatMessages.clientMessageId, input.clientMessageId),
      ));
      if (existing) {
        return res.json({ message: formatMessage(existing, viewerId, context.viewerLanguage) });
      }
    }

    const originalLanguage = normalizeLanguage(input.originalLanguage || await detectLanguage(input.content));
    const translations: Record<string, string> = {};
    if (context.peerLanguage !== originalLanguage) {
      translations[context.peerLanguage] = await translatePersonalText(input.content, originalLanguage, context.peerLanguage);
    }
    if (context.viewerLanguage !== originalLanguage && context.viewerLanguage !== context.peerLanguage) {
      translations[context.viewerLanguage] = await translatePersonalText(input.content, originalLanguage, context.viewerLanguage);
    }

    const [message] = await db.insert(personalChatMessages).values({
      threadId,
      senderUserId: viewerId,
      messageType: input.messageType || "text",
      originalContent: input.content,
      originalLanguage,
      translations,
      clientMessageId: input.clientMessageId || null,
      deliveryStatus: "sent",
      metadata: {
        peerLanguage: context.peerLanguage,
        viewerLanguage: context.viewerLanguage,
        attachmentUrl: input.attachmentUrl || null,
        attachmentTitle: input.attachmentTitle || null,
      },
    }).returning();

    const lastMessagePreview = buildMessagePreview(
      input.messageType || "text",
      input.content,
      input.attachmentTitle,
    );

    await db.update(personalChatThreads)
      .set({
        lastMessageAt: new Date(),
        lastMessagePreview,
        updatedAt: new Date(),
      })
      .where(eq(personalChatThreads.id, threadId));

    emitPersonalChatEvent([viewerId, context.peerUserId], {
      type: "message_created",
      threadId,
      messageId: message.id,
      senderUserId: viewerId,
      messageType: input.messageType || "text",
      lastMessagePreview,
      messageCreatedAt: message.createdAt
        ? (message.createdAt instanceof Date ? message.createdAt.toISOString() : new Date(message.createdAt).toISOString())
        : new Date().toISOString(),
    });

    res.status(201).json({
      message: formatMessage(message, viewerId, context.viewerLanguage),
    });
  } catch (error) {
    console.error("[PersonalChat] send failed:", error);
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.issues[0]?.message || "Invalid chat message." });
    }
    res.status(500).json({ error: "Failed to send personal message." });
  }
});

router.post("/api/personal-chats/:threadId/seen", requireAuth, async (req: AuthedRequest, res: Response) => {
  try {
    const viewerId = req.user!.id;
    markUserPresence(viewerId);
    const threadId = Number(req.params.threadId);

    const [thread] = await db.select().from(personalChatThreads).where(eq(personalChatThreads.id, threadId));
    if (!thread) {
      return res.status(404).json({ error: "Chat thread not found." });
    }
    if (thread.participantAUserId !== viewerId && thread.participantBUserId !== viewerId) {
      return res.status(403).json({ error: "Access denied." });
    }

    const incoming = await db.select().from(personalChatMessages).where(eq(personalChatMessages.threadId, threadId));
    const unseenIds = incoming
      .filter((message) => message.senderUserId !== viewerId && !message.seenAt)
      .map((message) => message.id);

    if (unseenIds.length > 0) {
      const now = new Date();
      await db.update(personalChatMessages)
        .set({
          deliveredAt: now,
          seenAt: now,
          deliveryStatus: "seen",
          updatedAt: now,
        })
        .where(inArray(personalChatMessages.id, unseenIds));

      emitPersonalChatEvent([viewerId, getViewerContext(thread, viewerId).peerUserId], {
        type: "messages_seen",
        threadId,
        seenCount: unseenIds.length,
      });
    }

    res.json({ success: true, seenCount: unseenIds.length });
  } catch (error) {
    console.error("[PersonalChat] seen failed:", error);
    res.status(500).json({ error: "Failed to update seen status." });
  }
});

router.post("/api/personal-chats/:threadId/typing", requireAuth, async (req: AuthedRequest, res: Response) => {
  try {
    const viewerId = req.user!.id;
    markUserPresence(viewerId);
    const threadId = Number(req.params.threadId);
    const input = typingSchema.parse(req.body);

    const [thread] = await db.select().from(personalChatThreads).where(eq(personalChatThreads.id, threadId));
    if (!thread) {
      return res.status(404).json({ error: "Chat thread not found." });
    }
    if (thread.participantAUserId !== viewerId && thread.participantBUserId !== viewerId) {
      return res.status(403).json({ error: "Access denied." });
    }

    setTyping(threadId, viewerId, input.isTyping);
    emitPersonalChatEvent([viewerId, getViewerContext(thread, viewerId).peerUserId], {
      type: "typing",
      threadId,
      senderUserId: viewerId,
      isTyping: input.isTyping,
    });
    res.json({ success: true });
  } catch (error) {
    console.error("[PersonalChat] typing failed:", error);
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.issues[0]?.message || "Invalid typing state." });
    }
    res.status(500).json({ error: "Failed to update typing state." });
  }
});

router.get("/api/personal-chats/:threadId/presence", requireAuth, async (req: AuthedRequest, res: Response) => {
  try {
    const viewerId = req.user!.id;
    markUserPresence(viewerId);
    const threadId = Number(req.params.threadId);

    const [thread] = await db.select().from(personalChatThreads).where(eq(personalChatThreads.id, threadId));
    if (!thread) {
      return res.status(404).json({ error: "Chat thread not found." });
    }
    if (thread.participantAUserId !== viewerId && thread.participantBUserId !== viewerId) {
      return res.status(403).json({ error: "Access denied." });
    }

    const { peerUserId } = getViewerContext(thread, viewerId);
    const lastActiveAt = activePresence.get(peerUserId) || null;

    res.json({
      peerUserId,
      isTyping: getTyping(threadId, peerUserId),
      lastActiveAt: lastActiveAt ? new Date(lastActiveAt).toISOString() : null,
      isRecentlyActive: lastActiveAt ? (Date.now() - lastActiveAt) < 60_000 : false,
    });
  } catch (error) {
    console.error("[PersonalChat] presence failed:", error);
    res.status(500).json({ error: "Failed to load presence state." });
  }
});

export default router;
