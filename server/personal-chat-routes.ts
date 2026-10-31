import { Router, type Request, type Response } from "express";
import { publicName } from "./user-display";
import { and, asc, desc, eq, gt, ilike, inArray, isNotNull, lt, or, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "./db";
import { personalChatMessages, personalChatThreads, userContacts, users } from "@shared/schema";
import { normalizePhoneNumber } from "@shared/phone";
import { openai } from "./ai_integrations/audio/client";
import { requireAuth } from "./role-middleware";
import { ObjectStorageService, ObjectNotFoundError } from "./ai_integrations/object_storage/objectStorage";
import { setObjectAclPolicy, getObjectAclPolicy, ObjectAccessGroupType, ObjectPermission } from "./ai_integrations/object_storage/objectAcl";
import { sendPushNotification } from "./firebase-admin";
import { isBlocked } from "./blocking";
import { personalChatSendLimiter } from "./rate-limit";
import { isTranslationConsentDenied } from "./translation-consent";
import { transcribeVoiceNote } from "./voice-note-transcript";
import { translateChatText } from "./translation/chat-translate";
import { publishPersonalChatEvent, subscribeToPersonalChatEvents } from "./modules/messaging/realtime";
import { getRedisClient, isRedisReady } from "./redis";
import { contactInputSchema, contactMetadata, extrasForViewer, extrasPreview, lastSeenShared, pollInputSchema, pollMetadata, readReceiptsShared } from "./chat-extras";

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
  // "file" added for non-image attachments (PDF/DOC/XLS/PPT/ZIP/video/etc.)
  // -- flutter_app/lib/screens/conversation_screen.dart's _pickAndSendFile()
  // already sends this, but this enum was never updated to match, so every
  // non-image file upload succeeded (the object storage PUT genuinely
  // completed) and then failed at the message-send step with a 400,
  // silently losing the message the recipient was supposed to see.
  messageType: z.enum(["text", "voice_note", "attachment", "file", "location", "poll", "contact", "sticker"]).optional(),
  attachmentUrl: z.string().trim().min(1).max(2000).optional(),
  attachmentTitle: z.string().trim().min(1).max(240).optional(),
  // Shown in the bubble ("PDF · 2.4 MB") and used to pick the right preview.
  attachmentSize: z.number().int().positive().max(1024 * 1024 * 1024).optional(),
  attachmentMime: z.string().trim().min(3).max(120).optional(),
  replyToId: z.number().int().positive().optional(),
  // A photo/video the other person can open once.
  viewOnce: z.boolean().optional(),
  poll: pollInputSchema.optional(),
  contact: contactInputSchema.optional(),
});

const typingSchema = z.object({
  isTyping: z.boolean(),
});

// Chat image/voice attachments are uploaded via the same presigned-URL flow
// as the profile avatar, but the object has no ACL until we grant one here —
// without this, both the sender and recipient get 403 fetching it back.
//
// Kept private (never "public"): the sender gets access as the ACL owner,
// and the recipient is granted READ via an explicit USER_LIST rule scoped to
// exactly this thread's two participants. A prior version marked these
// public, which meant anyone with the URL -- including an unauthenticated
// request -- could fetch a chat attachment. Fixed as a P0 security item.
export class AttachmentNotOwnedError extends Error {}

async function finalizeChatAttachment(senderUserId: number, recipientUserId: number, objectPath: string): Promise<void> {
  if (!objectPath.startsWith("/objects/")) return;
  const objectStorage = new ObjectStorageService();
  const objectFile = await objectStorage.getObjectEntityFile(objectPath);
  const existing = await getObjectAclPolicy(objectFile);
  // Only the person who uploaded a file may share it. Without this, anyone who
  // had seen a file's path could re-attach it and take over its access list.
  const { mayClaimUpload } = await import("./ai_integrations/object_storage/upload-owner");
  if ((existing && existing.owner !== String(senderUserId)) || (!existing && !(await mayClaimUpload(objectPath, senderUserId)))) {
    throw new AttachmentNotOwnedError("This attachment belongs to someone else.");
  }
  // Sending the same file to another chat adds that person; earlier readers keep access.
  const readers = new Set<string>([String(recipientUserId)]);
  for (const rule of existing?.aclRules ?? []) {
    if (rule.group?.type === ObjectAccessGroupType.USER_LIST) {
      try {
        for (const id of JSON.parse(rule.group.id) as string[]) readers.add(String(id));
      } catch { /* ignore malformed rule */ }
    }
  }
  await setObjectAclPolicy(objectFile, {
    owner: String(senderUserId),
    visibility: "private",
    aclRules: [
      {
        group: { type: ObjectAccessGroupType.USER_LIST, id: JSON.stringify(Array.from(readers)) },
        permission: ObjectPermission.READ,
      },
    ],
  });
}

const TYPING_TTL_MS = 8_000;
const typingState = new Map<string, { isTyping: boolean; updatedAt: number }>();
const activePresence = new Map<number, number>();
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

// Presence ("Online" / "last seen") and typing live in Redis so every server
// instance sees the same state, and "last seen" survives a restart. The
// in-memory maps stay as a fallback when Redis is unavailable.
const PRESENCE_REDIS_TTL_SECONDS = 60 * 60 * 24 * 30;
const PRESENCE_WRITE_INTERVAL_MS = 15_000;
const presenceWrittenAt = new Map<number, number>();

function presenceRedisKey(userId: number) {
  return `presence:last:${userId}`;
}

function typingRedisKey(threadId: number, userId: number) {
  return `typing:${threadId}:${userId}`;
}

function markUserPresence(userId: number) {
  const now = Date.now();
  activePresence.set(userId, now);
  // Throttled: a busy chat calls this on every request.
  if (now - (presenceWrittenAt.get(userId) ?? 0) < PRESENCE_WRITE_INTERVAL_MS) return;
  presenceWrittenAt.set(userId, now);
  if (!isRedisReady()) return;
  try {
    void getRedisClient().set(presenceRedisKey(userId), String(now), "EX", PRESENCE_REDIS_TTL_SECONDS).catch(() => undefined);
  } catch { /* fallback stays in memory */ }
}

async function getLastActiveAt(userId: number): Promise<number | null> {
  const local = activePresence.get(userId) ?? null;
  if (!isRedisReady()) return local;
  try {
    const raw = await getRedisClient().get(presenceRedisKey(userId));
    const shared = raw ? Number(raw) : NaN;
    if (!Number.isFinite(shared)) return local;
    return Math.max(shared, local ?? 0);
  } catch {
    return local;
  }
}

function setTyping(threadId: number, userId: number, isTyping: boolean) {
  const key = typingKey(threadId, userId);
  if (!isTyping) {
    typingState.delete(key);
  } else {
    typingState.set(key, {
      isTyping: true,
      updatedAt: Date.now(),
    });
  }
  if (!isRedisReady()) return;
  try {
    const client = getRedisClient();
    const redisKey = typingRedisKey(threadId, userId);
    const op = isTyping
      ? client.set(redisKey, "1", "PX", TYPING_TTL_MS)
      : client.del(redisKey);
    void op.catch(() => undefined);
  } catch { /* fallback stays in memory */ }
}

function getLocalTyping(threadId: number, userId: number) {
  const key = typingKey(threadId, userId);
  const existing = typingState.get(key);
  if (!existing) return false;
  if (Date.now() - existing.updatedAt > TYPING_TTL_MS) {
    typingState.delete(key);
    return false;
  }
  return existing.isTyping;
}

async function getTyping(threadId: number, userId: number): Promise<boolean> {
  if (getLocalTyping(threadId, userId)) return true;
  if (!isRedisReady()) return false;
  try {
    return (await getRedisClient().exists(typingRedisKey(threadId, userId))) > 0;
  } catch {
    return false;
  }
}

/** { "<userId>": "👍" } from a message's metadata, ignoring anything malformed. */
function reactionsObject(metadata: unknown): Record<string, string> {
  const raw = (metadata as { reactions?: unknown } | null)?.reactions;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  return Object.fromEntries(
    Object.entries(raw as Record<string, unknown>).filter((entry): entry is [string, string] => typeof entry[1] === "string" && entry[1].length > 0),
  );
}

function normalizePair(userA: number, userB: number) {
  return userA < userB
    ? { participantAUserId: userA, participantBUserId: userB }
    : { participantAUserId: userB, participantBUserId: userA };
}

function emitPersonalChatEvent(userIds: number[], event: Record<string, unknown>) {
  publishPersonalChatEvent(userIds, event);
}

function buildMessagePreview(
  messageType: "text" | "voice_note" | "attachment" | "file" | "location",
  content: string,
  attachmentTitle?: string | null,
) {
  if (messageType === "voice_note") {
    return attachmentTitle?.trim() ? `🎤 Voice message (${attachmentTitle.trim()})` : "🎤 Voice message";
  }
  if (messageType === "attachment") return "📷 Photo";
  if (messageType === "file") {
    const name = attachmentTitle?.trim() || content.trim() || "File";
    return /\.(mp4|mov|webm|3gp|mkv|avi|mpeg|m4v)$/i.test(name) ? "🎥 Video" : `📄 ${name}`;
  }
  if (messageType === "location") {
    return "📍 Location";
  }
  return content.trim().slice(0, 180);
}

function translationsObject(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );
}

async function detectLanguageRaw(text: string): Promise<string> {
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

/**
 * candidates should be the two chat participants' own known languages
 * (sender's own preference first). Short, casual, romanized Indian-language
 * text (e.g. Telugu written in Latin script -- "bayam", "eklada", "alla
 * kadu") is frequently misidentified by generic language-ID as an unrelated
 * language: real production data from this app showed such words tagged as
 * Malay, Polish, Tagalog, and Finnish, which then produced nonsense
 * translations. These detectors are tuned for script-based detection, not
 * romanized text, and have no real signal on a 1-3 word message. When the
 * raw detection doesn't match either participant's own known language and
 * the message is short, trust the sender's own profile language instead of
 * the wild guess -- in a 1:1 chat, the sender's own language is overwhelmingly
 * the correct answer for short ambiguous text.
 */
// Unicode script blocks that identify a language unambiguously. The short-
// message fallback below exists for *romanized* text; a message written in
// Telugu/Devanagari/etc. script is reliable regardless of length, and the
// fallback was turning short native-script messages into the sender's
// default profile language ("en"), so they were never translated.
const SCRIPT_LANGUAGES: Array<[RegExp, string]> = [
  [/[ఀ-౿]/, "te"],
  [/[஀-௿]/, "ta"],
  [/[ಀ-೿]/, "kn"],
  [/[ഀ-ൿ]/, "ml"],
  [/[ঀ-৿]/, "bn"],
  [/[઀-૿]/, "gu"],
  [/[਀-੿]/, "pa"],
  [/[଀-୿]/, "or"],
  [/[؀-ۿ]/, "ur"],
];

async function detectLanguage(text: string, candidates: string[] = []): Promise<string> {
  const pool = Array.from(new Set(candidates.map((c) => normalizeLanguage(c)).filter(Boolean)));
  for (const [pattern, language] of SCRIPT_LANGUAGES) {
    if (pattern.test(text)) return language;
  }
  const detected = await detectLanguageRaw(text);
  // Devanagari is shared by Hindi and Marathi — trust the detector there.
  if (/[ऀ-ॿ]/.test(text)) return detected || "hi";
  const wordCount = text.trim().split(/\s+/).filter(Boolean).length;
  if (pool.length > 0 && !pool.includes(detected) && wordCount <= 5) {
    return pool[0];
  }
  return detected;
}

async function translatePersonalText(text: string, fromLang: string, toLang: string): Promise<string> {
  if (!text.trim() || normalizeLanguage(fromLang) === normalizeLanguage(toLang)) {
    return text;
  }
  // Fail open: if every provider fails, deliver the original text.
  try {
    return await translateChatText(text, fromLang, toLang);
  } catch {
    return text;
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
  const extras = extrasForViewer(message.metadata, viewerId, message.senderUserId);
  const displayContent = message.isDeleted
    ? "This message was deleted"
    : (!isOwn && translatedContent ? translatedContent : message.originalContent);

  return {
    ...message,
    // View-once file paths are never sent to phones (opened via the one-time link).
    metadata: extras.metadata,
    viewOnce: !message.isDeleted && extras.viewOnce,
    viewOnceOpened: extras.viewOnceOpened,
    poll: message.isDeleted ? null : extras.poll,
    contact: message.isDeleted ? null : extras.contact,
    translations,
    attachmentUrl: message.isDeleted || extras.viewOnce ? null : (typeof (message.metadata as any)?.attachmentUrl === "string" ? (message.metadata as any).attachmentUrl : null),
    attachmentTitle: typeof (message.metadata as any)?.attachmentTitle === "string" ? (message.metadata as any).attachmentTitle : null,
    attachmentSize: typeof (message.metadata as any)?.attachmentSize === "number" ? (message.metadata as any).attachmentSize : null,
    attachmentMime: typeof (message.metadata as any)?.attachmentMime === "string" ? (message.metadata as any).attachmentMime : null,
    voiceTranscribed: (message.metadata as any)?.voiceTranscribed === true,
    reactions: message.isDeleted ? {} : reactionsObject(message.metadata),
    forwarded: !message.isDeleted && (message.metadata as any)?.forwarded === true,
    editedAt: !message.isDeleted && typeof (message.metadata as any)?.editedAt === "string" ? (message.metadata as any).editedAt : null,
    translatedContent: message.isDeleted ? null : translatedContent,
    displayContent,
    displayLanguage: !isOwn && translatedContent ? viewerLanguage : normalizeLanguage(message.originalLanguage),
    showingTranslated: !message.isDeleted && !isOwn && Boolean(translatedContent),
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

    // Real bug: eq() requires an exact full match, so searching "qa_test"
    // for a real user "qa_test_hindi_beta" (or any partial name/email a
    // real person would actually type) always returned zero results --
    // this is the New Chat search AND the Block Contact search (both call
    // this endpoint), so both silently looked broken/empty. Phone stays an
    // exact match (partial phone matching is a privacy/precision concern,
    // not a usability one -- numbers are typed in full or not at all).
    const normalizedPhone = normalizePhoneNumber(query);
    const candidates = await db.select({
      id: users.id,
      username: users.username,
      displayName: users.displayName,
      email: users.email,
      phone: users.phone,
      avatarUrl: users.avatarUrl,
    }).from(users).where(or(
      ilike(users.username, `%${query}%`),
      ilike(users.displayName, `%${query}%`),
      ilike(users.email, `%${query}%`),
      eq(users.phone, normalizedPhone),
    ));

    const results = candidates
      .filter((candidate) => candidate.id !== viewerId)
      .slice(0, 10)
      .map((candidate) => ({
        id: candidate.id,
        displayName: publicName(candidate),
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
      displayName: users.displayName,
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
        isPinned: context.isParticipantA ? thread.participantAPinned : thread.participantBPinned,
        isArchived: context.isParticipantA ? thread.participantAArchived : thread.participantBArchived,
        isMuted: context.isParticipantA ? thread.participantAMuted : thread.participantBMuted,
        unreadCount,
        peer: {
          id: peer?.id,
          username: peer?.username || matchingContact?.name || "Unknown user",
          email: peer?.email || null,
          phone: peer?.phone || null,
          avatarUrl: peer?.avatarUrl || matchingContact?.avatarUrl || null,
          displayName: matchingContact?.name || publicName(peer),
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

  const unsubscribe = subscribeToPersonalChatEvents(viewerId, listener);

  req.on("close", () => {
    clearInterval(heartbeat);
    unsubscribe();
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

    // The Flutter/web clients never actually send sourceLanguage/
    // targetLanguage on thread creation -- without this fallback both ended
    // up hardcoded to "en" for every single chat thread, which made
    // translation a permanent no-op (viewerLanguage === peerLanguage) even
    // between two users with genuinely different preferredLanguage profile
    // settings. Fall back to each user's own saved preference instead of a
    // blind "en" default.
    const viewerUser = (await db.select().from(users).where(eq(users.id, viewerId)))[0];
    const sourceLanguage = normalizeLanguage(input.sourceLanguage || viewerUser?.preferredLanguage || "en");
    const targetLanguage = normalizeLanguage(input.targetLanguage || recipient.preferredLanguage || "en");

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
          displayName: peerContact?.name || publicName(recipient as { displayName?: string | null; username?: string | null; email?: string | null; phone?: string | null }),
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
      displayName: users.displayName,
      email: users.email,
      phone: users.phone,
      avatarUrl: users.avatarUrl,
    }).from(users).where(eq(users.id, context.peerUserId));
    const peerContact = await findBestContact(viewerId, peer);

    const viewerClearedAt = context.isParticipantA ? thread.participantAClearedAt : thread.participantBClearedAt;
    const now = Date.now();
    const messages = (await db.select().from(personalChatMessages)
      .where(and(
        eq(personalChatMessages.threadId, threadId),
        ...(viewerClearedAt ? [gt(personalChatMessages.createdAt, viewerClearedAt)] : []),
      ))
      .orderBy(asc(personalChatMessages.createdAt), asc(personalChatMessages.id)))
      .filter((m) => !m.expiresAt || new Date(m.expiresAt).getTime() > now);

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

    // Read receipts show only when both people have them on.
    const receiptsOn = await readReceiptsShared(viewerId, context.peerUserId);
    const formattedMessages = messages.map((message) => formatMessage({
      ...message,
      deliveredAt: deliverableIds.includes(message.id) ? new Date() : message.deliveredAt,
      deliveryStatus: deliverableIds.includes(message.id) ? "delivered" : (!receiptsOn && message.deliveryStatus === "seen" ? "delivered" : message.deliveryStatus),
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
          displayName: peerContact?.name || publicName(peer),
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

/**
 * After a message is delivered: transcribe a voice note, detect the real
 * language and translate, then update the message and tell both phones
 * (as a message_created event so every app version refreshes it).
 */
async function finishMessageInBackground(job: {
  messageId: number;
  threadId: number;
  viewerId: number;
  peerUserId: number;
  viewerLanguage: string;
  peerLanguage: string;
  content: string;
  languageHint?: string | null;
  voiceAttachmentUrl: string | null;
  isTextMessage: boolean;
  translationAllowed: boolean;
}): Promise<void> {
  try {
    let content = job.content;
    let isText = job.isTextMessage;
    let voiceTranscribed = false;
    if (job.voiceAttachmentUrl) {
      const transcript = await transcribeVoiceNote(job.voiceAttachmentUrl, job.viewerLanguage);
      if (transcript) {
        content = transcript.slice(0, 4000);
        isText = true;
        voiceTranscribed = true;
      }
    }
    // Always detect from the text itself. A client's language hint is only a
    // tie-breaker: the website used to tag every message "en", which made
    // Telugu messages look like English and skipped their translation.
    const originalLanguage = normalizeLanguage(
      await detectLanguage(content, [job.viewerLanguage, job.languageHint ?? "", job.peerLanguage].filter(Boolean)),
    );
    const translations: Record<string, string> = {};
    if (isText && job.translationAllowed) {
      const targets = [job.peerLanguage, job.viewerLanguage].filter(
        (lang, i, all) => lang !== originalLanguage && all.indexOf(lang) === i,
      );
      const results = await Promise.all(targets.map((lang) => translatePersonalText(content, originalLanguage, lang)));
      targets.forEach((lang, i) => { translations[lang] = results[i]; });
    }
    const [current] = await db.select().from(personalChatMessages).where(eq(personalChatMessages.id, job.messageId));
    if (!current || current.isDeleted) return;
    // Edited while this was translating: the edit's own job owns the result.
    if (!voiceTranscribed && current.originalContent !== job.content) return;
    await db.update(personalChatMessages).set({
      originalContent: voiceTranscribed ? content : current.originalContent,
      originalLanguage,
      translations,
      // Merged in the database, so a reaction added meanwhile is kept.
      metadata: sql`coalesce(${personalChatMessages.metadata}, '{}'::jsonb) || ${JSON.stringify({ voiceTranscribed, translationPending: false })}::jsonb`,
    }).where(eq(personalChatMessages.id, job.messageId));
    emitPersonalChatEvent([job.viewerId, job.peerUserId], {
      type: "message_created",
      update: true,
      threadId: job.threadId,
      messageId: job.messageId,
      senderUserId: job.viewerId,
    });
  } catch (error) {
    console.error("[PersonalChat] background translation failed:", error);
    // The original message is already delivered; clear the pending flag.
    await db.update(personalChatMessages)
      .set({ metadata: sql`coalesce(${personalChatMessages.metadata}, '{}'::jsonb) || '{"translationPending": false}'::jsonb` })
      .where(eq(personalChatMessages.id, job.messageId))
      .catch(() => undefined);
  }
}

router.post("/api/personal-chats/:threadId/messages", requireAuth, personalChatSendLimiter, async (req: AuthedRequest, res: Response) => {
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

    if (await isBlocked(viewerId, context.peerUserId)) {
      return res.status(403).json({ error: "You can't message this user.", code: "BLOCKED" });
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

    const extraMeta: Record<string, unknown> = {};
    if (input.messageType === "poll") {
      if (!input.poll) return res.status(400).json({ error: "Add a question and at least two options." });
      Object.assign(extraMeta, pollMetadata(input.poll));
      input.content = input.poll.question;
    } else if (input.messageType === "contact") {
      if (!input.contact) return res.status(400).json({ error: "Pick a contact to share." });
      Object.assign(extraMeta, await contactMetadata(input.contact));
      input.content = input.contact.name;
    }
    if (input.messageType === "sticker" && !input.attachmentUrl) return res.status(400).json({ error: "Pick a sticker." });
    const viewOnce = input.viewOnce === true;
    if (viewOnce) {
      const mime = input.attachmentMime ?? (input.messageType === "attachment" ? "image/" : "");
      const isPhotoOrVideo = (input.messageType === "attachment" || input.messageType === "file") && !!input.attachmentUrl && /^(image|video)\//.test(mime);
      if (!isPhotoOrVideo) return res.status(400).json({ error: "Only photos and videos can be sent as view once." });
      extraMeta.viewOnce = true;
    }

    if (input.attachmentUrl) {
      try {
        // View once: only the sender owns it; the reader gets it through the one-time link.
        await finalizeChatAttachment(viewerId, viewOnce ? viewerId : context.peerUserId, input.attachmentUrl);
      } catch (err) {
        if (err instanceof AttachmentNotOwnedError) return res.status(403).json({ message: err.message });
        if (err instanceof ObjectNotFoundError) return res.status(400).json({ message: "The attachment was not uploaded. Please try again." });
        throw err;
      }
    }
    // Photos, videos, files and locations carry a caption/file name, not
    // something to translate.
    let isTextMessage = !input.messageType || input.messageType === "text" || input.messageType === "poll";

    // Speed: the message is stored and delivered first; voice-note
    // transcription, language detection and translation (1-4 s of AI calls)
    // run afterwards and update the message (see finishMessageInBackground).
    // Sending used to wait for all of them.
    const isVoiceNote = input.messageType === "voice_note" && !!input.attachmentUrl;
    const [senderRow] = await db.select({
      translationEnabled: users.translationEnabled,
      consentTranslation: users.consentTranslation,
      consentTimestamp: users.consentTimestamp,
    }).from(users).where(eq(users.id, viewerId));
    // Opt-out semantics (P0-4): only an explicit refusal blocks translation.
    const translationConsentDenied = isTranslationConsentDenied(senderRow?.consentTranslation, senderRow?.consentTimestamp);
    const translationAllowed = senderRow?.translationEnabled !== false && !translationConsentDenied;
    // Best guess until detection finishes: people mostly write their own language.
    const originalLanguage = normalizeLanguage(context.viewerLanguage);
    const needsBackgroundWork = isVoiceNote || (isTextMessage && translationAllowed);

    const expiresAt = thread.disappearingSeconds
      ? new Date(Date.now() + thread.disappearingSeconds * 1000)
      : null;

    const [message] = await db.insert(personalChatMessages).values({
      threadId,
      senderUserId: viewerId,
      messageType: input.messageType || "text",
      originalContent: input.content,
      originalLanguage,
      translations: {},
      clientMessageId: input.clientMessageId || null,
      deliveryStatus: "sent",
      replyToId: input.replyToId || null,
      expiresAt,
      metadata: {
        peerLanguage: context.peerLanguage,
        viewerLanguage: context.viewerLanguage,
        attachmentUrl: input.attachmentUrl || null,
        attachmentTitle: input.attachmentTitle || null,
        attachmentSize: input.attachmentSize ?? null,
        attachmentMime: input.attachmentMime || null,
        voiceTranscribed: false,
        translationPending: needsBackgroundWork,
        // Lets the client show "not translated -- no consent" instead of
        // silently looking like a same-language message.
        translationSkippedReason: translationConsentDenied ? "consent" : null,
        ...extraMeta,
      },
    }).returning();

    const lastMessagePreview = extrasPreview(input.messageType || "text", extraMeta, input.content) ?? buildMessagePreview(
      (input.messageType === "poll" || input.messageType === "contact" || input.messageType === "sticker" ? "text" : input.messageType || "text"),
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

    // Background/terminated-app push -- best-effort, never blocks the send.
    // The SSE event above only reaches a peer with the app open/foregrounded.
    sendPushNotification(context.peerUserId, {
      title: publicName(req.user as { displayName?: string | null; username?: string | null }, "New message"),
      body: lastMessagePreview,
      data: { type: "personal_chat_message", threadId: String(threadId) },
    }).catch(() => {});

    res.status(201).json({
      message: formatMessage(message, viewerId, context.viewerLanguage),
    });

    if (needsBackgroundWork) {
      void finishMessageInBackground({
        messageId: message.id,
        threadId,
        viewerId,
        peerUserId: context.peerUserId,
        viewerLanguage: context.viewerLanguage,
        peerLanguage: context.peerLanguage,
        content: input.content,
        languageHint: input.originalLanguage,
        voiceAttachmentUrl: isVoiceNote ? input.attachmentUrl! : null,
        isTextMessage,
        translationAllowed,
      });
    }
  } catch (error) {
    console.error("[PersonalChat] send failed:", error);
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.issues[0]?.message || "Invalid chat message." });
    }
    res.status(500).json({ error: "Failed to send personal message." });
  }
});

// Delete for everyone -- only the sender may delete their own message.
// Content is cleared server-side (not just hidden) so it can never be
// re-displayed to either participant.
router.delete("/api/personal-chats/:threadId/messages/:messageId", requireAuth, async (req: AuthedRequest, res: Response) => {
  try {
    const viewerId = req.user!.id;
    const threadId = Number(req.params.threadId);
    const messageId = Number(req.params.messageId);
    if (!Number.isFinite(threadId) || !Number.isFinite(messageId)) {
      return res.status(400).json({ error: "Invalid request." });
    }

    const [thread] = await db.select().from(personalChatThreads).where(eq(personalChatThreads.id, threadId));
    if (!thread) return res.status(404).json({ error: "Chat thread not found." });
    if (thread.participantAUserId !== viewerId && thread.participantBUserId !== viewerId) {
      return res.status(403).json({ error: "Access denied." });
    }

    const [message] = await db.select().from(personalChatMessages).where(eq(personalChatMessages.id, messageId));
    if (!message || message.threadId !== threadId) return res.status(404).json({ error: "Message not found." });
    if (message.senderUserId !== viewerId) return res.status(403).json({ error: "You can only delete your own messages." });

    await db.update(personalChatMessages)
      .set({ isDeleted: true, originalContent: "", translations: {}, metadata: {}, updatedAt: new Date() })
      .where(eq(personalChatMessages.id, messageId));

    const context = getViewerContext(thread, viewerId);
    emitPersonalChatEvent([viewerId, context.peerUserId], { type: "message_created", threadId, messageId });

    res.json({ success: true });
  } catch (error) {
    console.error("[PersonalChat] delete message failed:", error);
    res.status(500).json({ error: "Failed to delete message." });
  }
});

// Letters, digits, spaces or markup -- anything that is not an emoji.
const NOT_AN_EMOJI = new RegExp("[\\p{L}\\p{N}\\s<>]", "u");

/**
 * Lets one more person read a chat file someone forwards. The original
 * uploader stays the owner; this only adds a reader. Callers must already
 * have checked that the forwarder can read the file (they're in its chat).
 */
async function addAttachmentReader(objectPath: string, readerUserId: number): Promise<void> {
  if (!objectPath.startsWith("/objects/")) return;
  const objectStorage = new ObjectStorageService();
  const objectFile = await objectStorage.getObjectEntityFile(objectPath);
  const existing = await getObjectAclPolicy(objectFile);
  if (!existing) return;
  const readers = new Set<string>([String(readerUserId)]);
  const otherRules = [];
  for (const rule of existing.aclRules ?? []) {
    if (rule.group?.type === ObjectAccessGroupType.USER_LIST) {
      try {
        for (const id of JSON.parse(rule.group.id) as string[]) readers.add(String(id));
      } catch { /* ignore malformed rule */ }
    } else {
      otherRules.push(rule);
    }
  }
  await setObjectAclPolicy(objectFile, {
    ...existing,
    aclRules: [
      ...otherRules,
      { group: { type: ObjectAccessGroupType.USER_LIST, id: JSON.stringify(Array.from(readers)) }, permission: ObjectPermission.READ },
    ],
  });
}

const forwardSchema = z.object({ targetThreadIds: z.array(z.number().int().positive()).min(1).max(5) });

// Forward one message to up to 5 of my chats. Text is translated for each
// new reader; photos/files stay private (the new reader is added to them).
router.post("/api/personal-chats/:threadId/messages/:messageId/forward", requireAuth, personalChatSendLimiter, async (req: AuthedRequest, res: Response) => {
  try {
    const viewerId = req.user!.id;
    markUserPresence(viewerId);
    const threadId = Number(req.params.threadId);
    const messageId = Number(req.params.messageId);
    if (!Number.isFinite(threadId) || !Number.isFinite(messageId)) return res.status(400).json({ error: "Invalid request." });
    const input = forwardSchema.parse(req.body ?? {});

    const [source] = await db.select().from(personalChatThreads).where(eq(personalChatThreads.id, threadId));
    if (!source || (source.participantAUserId !== viewerId && source.participantBUserId !== viewerId)) {
      return res.status(403).json({ error: "Access denied." });
    }
    const [message] = await db.select().from(personalChatMessages).where(eq(personalChatMessages.id, messageId));
    if (!message || message.threadId !== threadId || message.isDeleted) return res.status(404).json({ error: "Message not found." });
    const meta = (message.metadata as Record<string, unknown> | null) || {};
    if (meta.viewOnce === true) return res.status(400).json({ error: "View once photos and videos can't be forwarded." });
    if (message.messageType === "poll") return res.status(400).json({ error: "Polls can't be forwarded." });
    const messageType = (message.messageType || "text") as "text" | "voice_note" | "attachment" | "file" | "location";
    const attachmentUrl = typeof meta.attachmentUrl === "string" ? meta.attachmentUrl : null;
    // What the forwarder actually saw: their own words, or the version in their language.
    const viewerLanguage = getViewerContext(source, viewerId).viewerLanguage;
    const translations = translationsObject(message.translations);
    const content = messageType === "text" && message.senderUserId !== viewerId && translations[viewerLanguage]
      ? translations[viewerLanguage]
      : message.originalContent;
    const contentLanguage = content === message.originalContent ? normalizeLanguage(message.originalLanguage) : viewerLanguage;

    const [senderRow] = await db.select({
      translationEnabled: users.translationEnabled,
      consentTranslation: users.consentTranslation,
      consentTimestamp: users.consentTimestamp,
    }).from(users).where(eq(users.id, viewerId));
    const translationAllowed = senderRow?.translationEnabled !== false
      && !isTranslationConsentDenied(senderRow?.consentTranslation, senderRow?.consentTimestamp);

    const forwarded: Array<{ threadId: number; messageId: number }> = [];
    const failed: Array<{ threadId: number; reason: string }> = [];
    for (const targetId of Array.from(new Set(input.targetThreadIds))) {
      const [target] = await db.select().from(personalChatThreads).where(eq(personalChatThreads.id, targetId));
      if (!target || (target.participantAUserId !== viewerId && target.participantBUserId !== viewerId)) {
        failed.push({ threadId: targetId, reason: "not_your_chat" });
        continue;
      }
      const context = getViewerContext(target, viewerId);
      if (await isBlocked(viewerId, context.peerUserId)) {
        failed.push({ threadId: targetId, reason: "blocked" });
        continue;
      }
      if (attachmentUrl && messageType !== "location") {
        try {
          await addAttachmentReader(attachmentUrl, context.peerUserId);
        } catch {
          failed.push({ threadId: targetId, reason: "attachment_unavailable" });
          continue;
        }
      }
      const isText = messageType === "text";
      const expiresAt = target.disappearingSeconds ? new Date(Date.now() + target.disappearingSeconds * 1000) : null;
      const [created] = await db.insert(personalChatMessages).values({
        threadId: targetId,
        senderUserId: viewerId,
        messageType,
        originalContent: content,
        originalLanguage: contentLanguage,
        translations: {},
        deliveryStatus: "sent",
        expiresAt,
        metadata: {
          peerLanguage: context.peerLanguage,
          viewerLanguage: context.viewerLanguage,
          attachmentUrl,
          attachmentTitle: typeof meta.attachmentTitle === "string" ? meta.attachmentTitle : null,
          attachmentSize: typeof meta.attachmentSize === "number" ? meta.attachmentSize : null,
          attachmentMime: typeof meta.attachmentMime === "string" ? meta.attachmentMime : null,
          voiceTranscribed: false,
          forwarded: true,
          ...(meta.contact ? { contact: meta.contact } : {}),
          translationPending: isText && translationAllowed,
        },
      }).returning();
      const preview = `↪ ${buildMessagePreview(messageType, content, typeof meta.attachmentTitle === "string" ? meta.attachmentTitle : null)}`;
      await db.update(personalChatThreads)
        .set({ lastMessageAt: new Date(), lastMessagePreview: preview, updatedAt: new Date() })
        .where(eq(personalChatThreads.id, targetId));
      emitPersonalChatEvent([viewerId, context.peerUserId], {
        type: "message_created",
        threadId: targetId,
        messageId: created.id,
        senderUserId: viewerId,
        messageType,
        lastMessagePreview: preview,
        messageCreatedAt: new Date().toISOString(),
      });
      sendPushNotification(context.peerUserId, {
        title: publicName(req.user as { displayName?: string | null; username?: string | null }, "New message"),
        body: preview,
        data: { type: "personal_chat_message", threadId: String(targetId) },
      }).catch(() => {});
      if (isText && translationAllowed) {
        void finishMessageInBackground({
          messageId: created.id,
          threadId: targetId,
          viewerId,
          peerUserId: context.peerUserId,
          viewerLanguage: context.viewerLanguage,
          peerLanguage: context.peerLanguage,
          content,
          languageHint: contentLanguage,
          voiceAttachmentUrl: null,
          isTextMessage: true,
          translationAllowed: true,
        });
      }
      forwarded.push({ threadId: targetId, messageId: created.id });
    }
    res.json({ forwarded, failed });
  } catch (error) {
    if (error instanceof z.ZodError) return res.status(400).json({ error: "Pick 1 to 5 chats." });
    console.error("[PersonalChat] forward failed:", error);
    res.status(500).json({ error: "Failed to forward message." });
  }
});

const reactionSchema = z.object({
  // One emoji (may be several code points, e.g. 👍🏽 or ❤️); null removes it.
  emoji: z.string().trim().min(1).max(16)
    .refine((value) => !NOT_AN_EMOJI.test(value), "Pick an emoji.")
    .nullable(),
});

// React to a message -- one reaction per person per message, either
// participant, like other messengers. Stored in metadata.reactions.
router.post("/api/personal-chats/:threadId/messages/:messageId/reaction", requireAuth, async (req: AuthedRequest, res: Response) => {
  try {
    const viewerId = req.user!.id;
    markUserPresence(viewerId);
    const threadId = Number(req.params.threadId);
    const messageId = Number(req.params.messageId);
    if (!Number.isFinite(threadId) || !Number.isFinite(messageId)) {
      return res.status(400).json({ error: "Invalid request." });
    }
    const input = reactionSchema.parse(req.body ?? {});

    const [thread] = await db.select().from(personalChatThreads).where(eq(personalChatThreads.id, threadId));
    if (!thread) return res.status(404).json({ error: "Chat thread not found." });
    if (thread.participantAUserId !== viewerId && thread.participantBUserId !== viewerId) {
      return res.status(403).json({ error: "Access denied." });
    }
    const context = getViewerContext(thread, viewerId);
    if (input.emoji && await isBlocked(viewerId, context.peerUserId)) {
      return res.status(403).json({ error: "You can't message this user.", code: "BLOCKED" });
    }

    const [message] = await db.select().from(personalChatMessages).where(eq(personalChatMessages.id, messageId));
    if (!message || message.threadId !== threadId || message.isDeleted) {
      return res.status(404).json({ error: "Message not found." });
    }

    const key = String(viewerId);
    // Atomic in the database, so two people reacting at once both count.
    const reactions = input.emoji
      ? sql`coalesce(${personalChatMessages.metadata}->'reactions', '{}'::jsonb) || jsonb_build_object(${key}::text, ${input.emoji}::text)`
      : sql`coalesce(${personalChatMessages.metadata}->'reactions', '{}'::jsonb) - ${key}::text`;
    const [updated] = await db.update(personalChatMessages)
      .set({ metadata: sql`jsonb_set(coalesce(${personalChatMessages.metadata}, '{}'::jsonb), '{reactions}', ${reactions})` })
      .where(eq(personalChatMessages.id, messageId))
      .returning();

    emitPersonalChatEvent([viewerId, context.peerUserId], {
      type: "message_created",
      update: true,
      threadId,
      messageId,
      senderUserId: viewerId,
    });

    // Tell the author when someone else reacts (not for removing a reaction).
    if (input.emoji && message.senderUserId !== viewerId) {
      sendPushNotification(message.senderUserId, {
        title: publicName(req.user as { displayName?: string | null; username?: string | null }, "NeuraTalk"),
        body: `Reacted ${input.emoji} to your message`,
        data: { type: "personal_chat_message", threadId: String(threadId) },
      }).catch(() => {});
    }

    res.json({ message: formatMessage(updated, viewerId, context.viewerLanguage) });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.issues[0]?.message || "Invalid reaction." });
    }
    console.error("[PersonalChat] reaction failed:", error);
    res.status(500).json({ error: "Failed to react to message." });
  }
});

const EDIT_WINDOW_MS = 15 * 60 * 1000;
const editMessageSchema = z.object({ content: z.string().trim().min(1).max(4000) });

// Edit your own text message within 15 minutes; it is translated again.
router.patch("/api/personal-chats/:threadId/messages/:messageId", requireAuth, async (req: AuthedRequest, res: Response) => {
  try {
    const viewerId = req.user!.id;
    markUserPresence(viewerId);
    const threadId = Number(req.params.threadId);
    const messageId = Number(req.params.messageId);
    if (!Number.isFinite(threadId) || !Number.isFinite(messageId)) {
      return res.status(400).json({ error: "Invalid request." });
    }
    const input = editMessageSchema.parse(req.body ?? {});

    const [thread] = await db.select().from(personalChatThreads).where(eq(personalChatThreads.id, threadId));
    if (!thread) return res.status(404).json({ error: "Chat thread not found." });
    if (thread.participantAUserId !== viewerId && thread.participantBUserId !== viewerId) {
      return res.status(403).json({ error: "Access denied." });
    }
    const context = getViewerContext(thread, viewerId);

    const [message] = await db.select().from(personalChatMessages).where(eq(personalChatMessages.id, messageId));
    if (!message || message.threadId !== threadId || message.isDeleted) {
      return res.status(404).json({ error: "Message not found." });
    }
    if (message.senderUserId !== viewerId) return res.status(403).json({ error: "You can only edit your own messages." });
    if (message.messageType !== "text") return res.status(400).json({ error: "Only text messages can be edited." });
    const sentAt = message.createdAt ? new Date(message.createdAt).getTime() : 0;
    if (Date.now() - sentAt > EDIT_WINDOW_MS) {
      return res.status(400).json({ error: "Messages can only be edited for 15 minutes after sending.", code: "EDIT_WINDOW_PASSED" });
    }
    if (input.content === message.originalContent) {
      return res.json({ message: formatMessage(message, viewerId, context.viewerLanguage) });
    }

    const [senderRow] = await db.select({
      translationEnabled: users.translationEnabled,
      consentTranslation: users.consentTranslation,
      consentTimestamp: users.consentTimestamp,
    }).from(users).where(eq(users.id, viewerId));
    const translationAllowed = senderRow?.translationEnabled !== false
      && !isTranslationConsentDenied(senderRow?.consentTranslation, senderRow?.consentTimestamp);

    const editedAt = new Date().toISOString();
    const [updated] = await db.update(personalChatMessages)
      .set({
        originalContent: input.content,
        translations: {},
        updatedAt: new Date(),
        metadata: sql`coalesce(${personalChatMessages.metadata}, '{}'::jsonb) || ${JSON.stringify({ editedAt, translationPending: translationAllowed })}::jsonb`,
      })
      .where(eq(personalChatMessages.id, messageId))
      .returning();

    // Keep the chat list preview in step when the last message was edited.
    const [latest] = await db.select({ id: personalChatMessages.id }).from(personalChatMessages)
      .where(eq(personalChatMessages.threadId, threadId))
      .orderBy(desc(personalChatMessages.id))
      .limit(1);
    if (latest?.id === messageId) {
      await db.update(personalChatThreads)
        .set({ lastMessagePreview: buildMessagePreview("text", input.content), updatedAt: new Date() })
        .where(eq(personalChatThreads.id, threadId));
    }

    emitPersonalChatEvent([viewerId, context.peerUserId], {
      type: "message_created",
      update: true,
      threadId,
      messageId,
      senderUserId: viewerId,
    });

    res.json({ message: formatMessage(updated, viewerId, context.viewerLanguage) });

    if (translationAllowed) {
      void finishMessageInBackground({
        messageId,
        threadId,
        viewerId,
        peerUserId: context.peerUserId,
        viewerLanguage: context.viewerLanguage,
        peerLanguage: context.peerLanguage,
        content: input.content,
        languageHint: null,
        voiceAttachmentUrl: null,
        isTextMessage: true,
        translationAllowed: true,
      });
    }
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.issues[0]?.message || "Invalid message." });
    }
    console.error("[PersonalChat] edit message failed:", error);
    res.status(500).json({ error: "Failed to edit message." });
  }
});

// Clear chat -- hides everything up to now from the requester's own view
// only; the other participant's view and the underlying rows are untouched.
router.post("/api/personal-chats/:threadId/clear", requireAuth, async (req: AuthedRequest, res: Response) => {
  try {
    const viewerId = req.user!.id;
    const threadId = Number(req.params.threadId);
    if (!Number.isFinite(threadId)) return res.status(400).json({ error: "Invalid chat thread." });

    const [thread] = await db.select().from(personalChatThreads).where(eq(personalChatThreads.id, threadId));
    if (!thread) return res.status(404).json({ error: "Chat thread not found." });

    if (thread.participantAUserId === viewerId) {
      await db.update(personalChatThreads).set({ participantAClearedAt: new Date() }).where(eq(personalChatThreads.id, threadId));
    } else if (thread.participantBUserId === viewerId) {
      await db.update(personalChatThreads).set({ participantBClearedAt: new Date() }).where(eq(personalChatThreads.id, threadId));
    } else {
      return res.status(403).json({ error: "Access denied." });
    }

    res.json({ success: true });
  } catch (error) {
    console.error("[PersonalChat] clear chat failed:", error);
    res.status(500).json({ error: "Failed to clear chat." });
  }
});

const ALLOWED_DISAPPEARING_SECONDS = [0, 86400, 604800, 7776000]; // off, 24h, 7d, 90d

// Disappearing messages -- unlike pin/archive/mute/clear above, this is
// shared between both participants (either one can change it, and it
// governs messages sent from that point on for both).
router.patch("/api/personal-chats/:threadId/disappearing", requireAuth, async (req: AuthedRequest, res: Response) => {
  try {
    const viewerId = req.user!.id;
    const threadId = Number(req.params.threadId);
    if (!Number.isFinite(threadId)) return res.status(400).json({ error: "Invalid chat thread." });

    const parsed = z.object({ seconds: z.number().int().min(0) }).safeParse(req.body);
    if (!parsed.success || !ALLOWED_DISAPPEARING_SECONDS.includes(parsed.data.seconds)) {
      return res.status(400).json({ error: "Invalid duration." });
    }

    const [thread] = await db.select().from(personalChatThreads).where(eq(personalChatThreads.id, threadId));
    if (!thread) return res.status(404).json({ error: "Chat thread not found." });
    if (thread.participantAUserId !== viewerId && thread.participantBUserId !== viewerId) {
      return res.status(403).json({ error: "Access denied." });
    }

    await db.update(personalChatThreads)
      .set({ disappearingSeconds: parsed.data.seconds || null, updatedAt: new Date() })
      .where(eq(personalChatThreads.id, threadId));

    const context = getViewerContext(thread, viewerId);
    emitPersonalChatEvent([viewerId, context.peerUserId], { type: "thread_updated", threadId });

    res.json({ success: true, disappearingSeconds: parsed.data.seconds || null });
  } catch (error) {
    console.error("[PersonalChat] update disappearing setting failed:", error);
    res.status(500).json({ error: "Failed to update disappearing messages." });
  }
});

const threadStateSchema = z.object({
  pinned: z.boolean().optional(),
  archived: z.boolean().optional(),
  muted: z.boolean().optional(),
});

// Pin/archive/mute -- per-viewer, mirrors clear chat's isolation.
router.patch("/api/personal-chats/:threadId/state", requireAuth, async (req: AuthedRequest, res: Response) => {
  try {
    const viewerId = req.user!.id;
    const threadId = Number(req.params.threadId);
    if (!Number.isFinite(threadId)) return res.status(400).json({ error: "Invalid chat thread." });

    const input = threadStateSchema.parse(req.body);
    if (Object.keys(input).length === 0) return res.status(400).json({ error: "No fields to update." });

    const [thread] = await db.select().from(personalChatThreads).where(eq(personalChatThreads.id, threadId));
    if (!thread) return res.status(404).json({ error: "Chat thread not found." });

    const isA = thread.participantAUserId === viewerId;
    const isB = thread.participantBUserId === viewerId;
    if (!isA && !isB) return res.status(403).json({ error: "Access denied." });

    const setValues: Record<string, unknown> = {};
    if (input.pinned !== undefined) setValues[isA ? "participantAPinned" : "participantBPinned"] = input.pinned;
    if (input.archived !== undefined) setValues[isA ? "participantAArchived" : "participantBArchived"] = input.archived;
    if (input.muted !== undefined) setValues[isA ? "participantAMuted" : "participantBMuted"] = input.muted;

    await db.update(personalChatThreads).set(setValues).where(eq(personalChatThreads.id, threadId));

    res.json({ success: true });
  } catch (error) {
    console.error("[PersonalChat] update thread state failed:", error);
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.issues[0]?.message || "Invalid request." });
    }
    res.status(500).json({ error: "Failed to update chat." });
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

      const seenPeer = getViewerContext(thread, viewerId).peerUserId;
      emitPersonalChatEvent((await readReceiptsShared(viewerId, seenPeer)) ? [viewerId, seenPeer] : [viewerId], {
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
    // Hidden when either person turned off "last seen and online".
    const lastActiveAt = (await lastSeenShared(viewerId, peerUserId)) ? await getLastActiveAt(peerUserId) : null;

    res.json({
      peerUserId,
      isTyping: await getTyping(threadId, peerUserId),
      lastActiveAt: lastActiveAt ? new Date(lastActiveAt).toISOString() : null,
      isRecentlyActive: lastActiveAt ? (Date.now() - lastActiveAt) < 60_000 : false,
    });
  } catch (error) {
    console.error("[PersonalChat] presence failed:", error);
    res.status(500).json({ error: "Failed to load presence state." });
  }
});

/** Real deletion (not soft-delete) of expired disappearing messages -- run
 * on an interval from server/index.ts. Privacy intent of "disappearing"
 * means the row should actually stop existing, not just be hidden. */
export async function deleteExpiredPersonalChatMessages(): Promise<number> {
  const deleted = await db.delete(personalChatMessages)
    .where(and(isNotNull(personalChatMessages.expiresAt), lt(personalChatMessages.expiresAt, new Date())))
    .returning({ id: personalChatMessages.id });
  return deleted.length;
}

export default router;
