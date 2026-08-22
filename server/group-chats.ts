import { Router, Request, Response } from "express";
import { db } from "./db";
import { groupChats, groupChatMembers, groupChatMessages, users } from "@shared/schema";
import { eq, and, desc, inArray } from "drizzle-orm";
import { ObjectStorageService } from "./ai_integrations/object_storage";
import { speechToText, textToSpeech } from "./ai_integrations/audio/client";
import crypto from "crypto";
import { openai } from "./ai_integrations/audio/client";
import { Readable } from "stream";
import { requireAuth } from "./role-middleware";
import { sendPushNotification } from "./firebase-admin";

const objectStorage = new ObjectStorageService();
const router = Router();

const ENCRYPTION_ALGORITHM = "aes-256-gcm";

function getEncryptionKey(): Buffer {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET required");
  return crypto.scryptSync(secret, "group-chat-salt", 32);
}

function encrypt(text: string): string {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ENCRYPTION_ALGORITHM, key, iv);
  let encrypted = cipher.update(text, "utf8", "hex");
  encrypted += cipher.final("hex");
  const authTag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${authTag.toString("hex")}:${encrypted}`;
}

function decrypt(encryptedText: string): string {
  const [ivHex, authTagHex, encrypted] = encryptedText.split(":");
  const key = getEncryptionKey();
  const iv = Buffer.from(ivHex, "hex");
  const authTag = Buffer.from(authTagHex, "hex");
  const decipher = crypto.createDecipheriv(ENCRYPTION_ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  let decrypted = decipher.update(encrypted, "hex", "utf8");
  decrypted += decipher.final("utf8");
  return decrypted;
}

async function streamToBuffer(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

const SUPPORTED_LANGUAGES = [
  { code: "en", name: "English" },
  { code: "es", name: "Spanish" },
  { code: "hi", name: "Hindi" },
  { code: "te", name: "Telugu" },
  { code: "ta", name: "Tamil" },
  { code: "kn", name: "Kannada" },
  { code: "ml", name: "Malayalam" },
  { code: "mr", name: "Marathi" },
  { code: "gu", name: "Gujarati" },
  { code: "bn", name: "Bengali" },
  { code: "pa", name: "Punjabi" },
  { code: "ur", name: "Urdu" },
  { code: "fr", name: "French" },
  { code: "de", name: "German" },
  { code: "ja", name: "Japanese" },
  { code: "ko", name: "Korean" },
  { code: "zh", name: "Chinese" },
  { code: "ar", name: "Arabic" },
  { code: "pt", name: "Portuguese" },
  { code: "ru", name: "Russian" },
];
// Italian was previously listed here but has no real Azure TTS voice
// mapped (see AZURE_VOICES in azure-service.ts) -- picking it silently
// fell back to an English voice for call/message audio. Swapped for Urdu,
// which does have a real mapped voice and was missing from this list
// despite being one of the "20 supported languages" shown in the admin
// panel.

async function translateText(text: string, fromLang: string, toLang: string): Promise<string> {
  if (fromLang === toLang) return text;
  
  // 1. Try Azure Translator first (2M chars/month FREE)
  try {
    const { isAzureTranslatorAvailable, azureTranslate } = await import("./azure-service");
    if (isAzureTranslatorAvailable()) {
      const result = await azureTranslate(text, fromLang, toLang);
      if (result && result !== text) return result;
    }
  } catch {
    // Azure not available
  }

  // 2. Try OpenAI
  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { 
          role: "system", 
          content: `Translate from ${fromLang} to ${toLang}. Preserve emotion and tone. Reply with ONLY the translation.` 
        },
        { role: "user", content: text }
      ]
    });
    return response.choices[0]?.message?.content?.trim() || text;
  } catch {
    // OpenAI failed, use free translation fallback
    try {
      const { translateText: freeTranslate } = await import("./elevenlabs-service");
      return await freeTranslate(text, fromLang, toLang);
    } catch {
      return text;
    }
  }
}

async function detectLanguageRaw(text: string): Promise<string> {
  // 1. Try Azure language detection first
  try {
    const { isAzureTranslatorAvailable, azureDetectLanguage } = await import("./azure-service");
    if (isAzureTranslatorAvailable()) {
      return await azureDetectLanguage(text);
    }
  } catch {
    // Azure not available
  }

  // 2. OpenAI fallback
  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: "Detect language. Reply with ONLY the ISO 639-1 code (e.g., 'en', 'hi', 'te')." },
        { role: "user", content: text }
      ],
      max_tokens: 5
    });
    return (response.choices[0]?.message?.content?.trim().toLowerCase() || "en").slice(0, 2);
  } catch {
    return "en";
  }
}

// Short, casual, romanized Indian-language text is frequently misidentified
// by generic language-ID as an unrelated language (real production data from
// the 1:1 chat path showed this exact failure -- Telugu words tagged as
// Malay, Polish, Tagalog, Finnish). When the raw detection doesn't match the
// sender's own known language and the message is short, trust the sender's
// profile language instead of the wild guess.
async function detectLanguage(text: string, senderLanguage?: string): Promise<string> {
  const detected = await detectLanguageRaw(text);
  const wordCount = text.trim().split(/\s+/).filter(Boolean).length;
  if (senderLanguage && senderLanguage !== detected && wordCount <= 5) {
    return senderLanguage;
  }
  return detected;
}

router.get("/api/group-chats/languages", (_req: Request, res: Response) => {
  res.json(SUPPORTED_LANGUAGES);
});

router.post("/api/group-chats", requireAuth, async (req: Request, res: Response) => {
  try {
    const createdById = req.user!.id;
    const { name, description, organizationId, defaultLanguage } = req.body;
    
    if (!name) {
      return res.status(400).json({ error: "Name required" });
    }
    
    const group = await db.insert(groupChats).values({
      name,
      description: description || null,
      createdById,
      organizationId: organizationId || req.user?.organizationId || null,
      defaultLanguage: defaultLanguage || "en",
      isTranslationEnabled: true,
      isActive: true,
    }).returning();
    
    await db.insert(groupChatMembers).values({
      groupChatId: group[0].id,
      userId: createdById,
      preferredLanguage: defaultLanguage || "en",
      role: "admin",
    });
    
    res.status(201).json(group[0]);
  } catch (error) {
    console.error("Error creating group chat:", error);
    res.status(500).json({ error: "Failed to create group chat" });
  }
});

router.get("/api/group-chats/my-groups", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    
    const memberships = await db.select({
      groupChatId: groupChatMembers.groupChatId,
    }).from(groupChatMembers).where(eq(groupChatMembers.userId, userId));
    
    if (memberships.length === 0) {
      return res.json([]);
    }
    
    const groupIds = memberships.map(m => m.groupChatId);
    
    const groups = await db.select().from(groupChats)
      .where(and(
        inArray(groupChats.id, groupIds),
        eq(groupChats.isActive, true)
      ))
      .orderBy(desc(groupChats.updatedAt));
    
    const groupsWithMembers = await Promise.all(groups.map(async (group) => {
      const members = await db.select({
        userId: groupChatMembers.userId,
        preferredLanguage: groupChatMembers.preferredLanguage,
        role: groupChatMembers.role,
        nickname: groupChatMembers.nickname,
      }).from(groupChatMembers).where(eq(groupChatMembers.groupChatId, group.id));
      
      return { ...group, members };
    }));
    
    res.json(groupsWithMembers);
  } catch (error) {
    console.error("Error fetching group chats:", error);
    res.status(500).json({ error: "Failed to fetch group chats" });
  }
});

router.get("/api/group-chats/:groupId", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const groupId = parseInt(req.params.groupId);
    
    const membership = await db.select().from(groupChatMembers)
      .where(and(eq(groupChatMembers.groupChatId, groupId), eq(groupChatMembers.userId, userId)));
    if (membership.length === 0) {
      return res.status(403).json({ error: "Not a member of this group" });
    }
    
    const group = await db.select().from(groupChats).where(eq(groupChats.id, groupId));
    if (group.length === 0) {
      return res.status(404).json({ error: "Group not found" });
    }
    
    const members = await db.select({
      id: groupChatMembers.id,
      userId: groupChatMembers.userId,
      preferredLanguage: groupChatMembers.preferredLanguage,
      role: groupChatMembers.role,
      nickname: groupChatMembers.nickname,
      isMuted: groupChatMembers.isMuted,
      joinedAt: groupChatMembers.joinedAt,
    }).from(groupChatMembers).where(eq(groupChatMembers.groupChatId, groupId));
    
    const memberUserIds = members.map(m => m.userId);
    const memberUsers = memberUserIds.length > 0 
      ? await db.select({
          id: users.id,
          username: users.username,
          email: users.email,
        }).from(users).where(inArray(users.id, memberUserIds))
      : [];
    
    const membersWithInfo = members.map(m => ({
      ...m,
      user: memberUsers.find(u => u.id === m.userId) || null,
    }));
    
    res.json({ ...group[0], members: membersWithInfo });
  } catch (error) {
    console.error("Error fetching group chat:", error);
    res.status(500).json({ error: "Failed to fetch group chat" });
  }
});

router.post("/api/group-chats/:groupId/members", requireAuth, async (req: Request, res: Response) => {
  try {
    const requesterId = req.user!.id;
    const groupId = parseInt(req.params.groupId);
    const { userId, preferredLanguage } = req.body;
    
    const requesterMember = await db.select().from(groupChatMembers)
      .where(and(
        eq(groupChatMembers.groupChatId, groupId),
        eq(groupChatMembers.userId, requesterId)
      ));
    if (requesterMember.length === 0 || !["admin", "moderator"].includes(requesterMember[0].role || "")) {
      return res.status(403).json({ error: "Only admins can add members" });
    }
    
    if (!userId) {
      return res.status(400).json({ error: "User ID required" });
    }
    
    const existing = await db.select().from(groupChatMembers)
      .where(and(
        eq(groupChatMembers.groupChatId, groupId),
        eq(groupChatMembers.userId, userId)
      ));
    
    if (existing.length > 0) {
      return res.status(400).json({ error: "User already in group" });
    }
    
    const member = await db.insert(groupChatMembers).values({
      groupChatId: groupId,
      userId,
      preferredLanguage: preferredLanguage || "en",
      role: "member",
    }).returning();
    
    res.status(201).json(member[0]);
  } catch (error) {
    console.error("Error adding member:", error);
    res.status(500).json({ error: "Failed to add member" });
  }
});

router.patch("/api/group-chats/:groupId/members/:userId", requireAuth, async (req: Request, res: Response) => {
  try {
    const requesterId = req.user!.id;
    const groupId = parseInt(req.params.groupId);
    const userId = parseInt(req.params.userId);
    const { preferredLanguage, nickname, isMuted, role } = req.body;
    
    const requesterMember = await db.select().from(groupChatMembers)
      .where(and(eq(groupChatMembers.groupChatId, groupId), eq(groupChatMembers.userId, requesterId)));
    
    const isAdmin = requesterMember.length > 0 && requesterMember[0].role === "admin";
    
    if (userId !== requesterId && !isAdmin) {
      return res.status(403).json({ error: "Only admins can modify other members" });
    }
    
    const updateData: Record<string, any> = {};
    
    if (isAdmin) {
      if (preferredLanguage) updateData.preferredLanguage = preferredLanguage;
      if (nickname !== undefined) updateData.nickname = nickname;
      if (isMuted !== undefined) updateData.isMuted = isMuted;
      if (role && ["admin", "moderator", "member"].includes(role)) updateData.role = role;
    } else {
      if (preferredLanguage) updateData.preferredLanguage = preferredLanguage;
      if (nickname !== undefined) updateData.nickname = nickname;
    }
    
    await db.update(groupChatMembers)
      .set(updateData)
      .where(and(
        eq(groupChatMembers.groupChatId, groupId),
        eq(groupChatMembers.userId, userId)
      ));
    
    res.json({ success: true });
  } catch (error) {
    console.error("Error updating member:", error);
    res.status(500).json({ error: "Failed to update member" });
  }
});

router.delete("/api/group-chats/:groupId/members/:userId", requireAuth, async (req: Request, res: Response) => {
  try {
    const requesterId = req.user!.id;
    const groupId = parseInt(req.params.groupId);
    const userId = parseInt(req.params.userId);
    
    if (userId !== requesterId) {
      const requesterMember = await db.select().from(groupChatMembers)
        .where(and(eq(groupChatMembers.groupChatId, groupId), eq(groupChatMembers.userId, requesterId)));
      if (requesterMember.length === 0 || requesterMember[0].role !== "admin") {
        return res.status(403).json({ error: "Only admins can remove members" });
      }
    }
    
    await db.delete(groupChatMembers)
      .where(and(
        eq(groupChatMembers.groupChatId, groupId),
        eq(groupChatMembers.userId, userId)
      ));
    
    res.json({ success: true });
  } catch (error) {
    console.error("Error removing member:", error);
    res.status(500).json({ error: "Failed to remove member" });
  }
});

router.post("/api/group-chats/:groupId/messages", requireAuth, async (req: Request, res: Response) => {
  try {
    const senderId = req.user!.id;
    const groupId = parseInt(req.params.groupId);
    const { messageType, content, originalLanguage, replyToId } = req.body;
    
    if (!content) {
      return res.status(400).json({ error: "Content required" });
    }
    
    const senderMember = await db.select().from(groupChatMembers)
      .where(and(
        eq(groupChatMembers.groupChatId, groupId),
        eq(groupChatMembers.userId, senderId)
      ));
    
    if (senderMember.length === 0) {
      return res.status(403).json({ error: "Not a member of this group" });
    }
    
    const detectedLang = originalLanguage || await detectLanguage(content, senderMember[0]?.preferredLanguage ?? undefined);
    
    const members = await db.select({
      userId: groupChatMembers.userId,
      preferredLanguage: groupChatMembers.preferredLanguage,
    }).from(groupChatMembers).where(eq(groupChatMembers.groupChatId, groupId));
    
    const targetLanguages = Array.from(new Set(members.map(m => m.preferredLanguage)));
    
    const translations: Record<string, string> = {};
    for (const targetLang of targetLanguages) {
      if (targetLang !== detectedLang) {
        translations[targetLang] = await translateText(content, detectedLang, targetLang);
      }
    }
    
    const message = await db.insert(groupChatMessages).values({
      groupChatId: groupId,
      senderId,
      messageType: messageType || "text",
      originalContent: content,
      originalLanguage: detectedLang,
      translations,
      replyToId: replyToId || null,
    }).returning();
    
    await db.update(groupChats)
      .set({ updatedAt: new Date() })
      .where(eq(groupChats.id, groupId));

    // Background/terminated-app push to every other member -- best-effort.
    const [senderRow] = await db.select({ username: users.username }).from(users).where(eq(users.id, senderId));
    const recipients = members.map((m) => m.userId).filter((id) => id !== senderId);
    for (const recipientId of recipients) {
      sendPushNotification(recipientId, {
        title: senderRow?.username || "New group message",
        body: content,
        data: { type: "group_chat_message", groupId: String(groupId) },
      }).catch(() => {});
    }

    res.status(201).json(message[0]);
  } catch (error) {
    console.error("Error sending message:", error);
    res.status(500).json({ error: "Failed to send message" });
  }
});

// Delete for everyone -- the sender, or a group admin, may delete a message.
router.delete("/api/group-chats/:groupId/messages/:messageId", requireAuth, async (req: Request, res: Response) => {
  try {
    const requesterId = req.user!.id;
    const groupId = parseInt(req.params.groupId);
    const messageId = parseInt(req.params.messageId);

    const [message] = await db.select().from(groupChatMessages).where(eq(groupChatMessages.id, messageId));
    if (!message || message.groupChatId !== groupId) {
      return res.status(404).json({ error: "Message not found" });
    }

    if (message.senderId !== requesterId) {
      const [requesterMember] = await db.select().from(groupChatMembers)
        .where(and(eq(groupChatMembers.groupChatId, groupId), eq(groupChatMembers.userId, requesterId)));
      if (!requesterMember || requesterMember.role !== "admin") {
        return res.status(403).json({ error: "Only the sender or a group admin can delete this message" });
      }
    }

    await db.update(groupChatMessages)
      .set({ isDeleted: true, originalContent: "", translations: {}, updatedAt: new Date() })
      .where(eq(groupChatMessages.id, messageId));

    res.json({ success: true });
  } catch (error) {
    console.error("Error deleting message:", error);
    res.status(500).json({ error: "Failed to delete message" });
  }
});

router.post("/api/group-chats/:groupId/voice-messages", requireAuth, async (req: Request, res: Response) => {
  try {
    const senderId = req.user!.id;
    const groupId = parseInt(req.params.groupId);
    const { audioPath, duration } = req.body;
    
    if (!audioPath) {
      return res.status(400).json({ error: "Audio path required" });
    }
    
    try {
      decrypt(audioPath);
    } catch {
      return res.status(400).json({ error: "Invalid audio path" });
    }
    
    const senderMember = await db.select().from(groupChatMembers)
      .where(and(eq(groupChatMembers.groupChatId, groupId), eq(groupChatMembers.userId, senderId)));
    if (senderMember.length === 0) {
      return res.status(403).json({ error: "Not a member of this group" });
    }
    
    const message = await db.insert(groupChatMessages).values({
      groupChatId: groupId,
      senderId,
      messageType: "voice",
      audioPath,
      duration: duration || 0,
      originalLanguage: "en",
      originalContent: null,
    }).returning();
    
    processVoiceMessage(message[0].id);
    
    res.status(201).json({ 
      ...message[0], 
      status: "processing" 
    });
  } catch (error) {
    console.error("Error sending voice message:", error);
    res.status(500).json({ error: "Failed to send voice message" });
  }
});

async function processVoiceMessage(messageId: number) {
  try {
    const message = await db.select().from(groupChatMessages)
      .where(eq(groupChatMessages.id, messageId));
    if (message.length === 0 || !message[0].audioPath) return;
    
    const decryptedPath = decrypt(message[0].audioPath);
    const file = await objectStorage.getObjectEntityFile(decryptedPath);
    const readStream = file.createReadStream();
    const audioBuffer = await streamToBuffer(readStream);
    
    const transcript = await speechToText(audioBuffer, "webm");
    const language = await detectLanguage(transcript);
    
    const members = await db.select({
      preferredLanguage: groupChatMembers.preferredLanguage,
    }).from(groupChatMembers).where(eq(groupChatMembers.groupChatId, message[0].groupChatId));
    
    const targetLanguages = Array.from(new Set(members.map(m => m.preferredLanguage)));
    
    const translations: Record<string, string> = {};
    const voiceTranslations: Record<string, { audioPath: string }> = {};
    
    for (const targetLang of targetLanguages) {
      if (targetLang !== language) {
        const translatedText = await translateText(transcript, language, targetLang);
        translations[targetLang] = translatedText;
        
        try {
          const audioBuffer = await textToSpeech(translatedText, "alloy", "wav", targetLang);
          const uploadURL = await objectStorage.getObjectEntityUploadURL();
          const translatedPath = objectStorage.normalizeObjectEntityPath(uploadURL);
          
          await fetch(uploadURL, {
            method: "PUT",
            body: audioBuffer,
            headers: { "Content-Type": "audio/mpeg" }
          });
          
          voiceTranslations[targetLang] = { audioPath: encrypt(translatedPath) };
        } catch (err) {
          console.error(`Voice translation failed for ${targetLang}:`, err);
        }
      }
    }
    
    await db.update(groupChatMessages)
      .set({
        originalContent: transcript,
        originalLanguage: language,
        translations,
        voiceTranslations,
      })
      .where(eq(groupChatMessages.id, messageId));
      
  } catch (error) {
    console.error("Error processing voice message:", error);
  }
}

router.get("/api/group-chats/:groupId/messages", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const groupId = parseInt(req.params.groupId);
    const limit = parseInt(req.query.limit as string) || 50;
    const offset = parseInt(req.query.offset as string) || 0;
    
    const memberInfo = await db.select().from(groupChatMembers)
      .where(and(
        eq(groupChatMembers.groupChatId, groupId),
        eq(groupChatMembers.userId, userId)
      ));
    
    if (memberInfo.length === 0) {
      return res.status(403).json({ error: "Not a member of this group" });
    }
    
    const userLanguage = memberInfo.length > 0 ? memberInfo[0].preferredLanguage : "en";
    
    const messages = await db.select().from(groupChatMessages)
      .where(and(
        eq(groupChatMessages.groupChatId, groupId),
        eq(groupChatMessages.isDeleted, false)
      ))
      .orderBy(desc(groupChatMessages.createdAt))
      .limit(limit)
      .offset(offset);
    
    const senderIds = Array.from(new Set(messages.map(m => m.senderId)));
    const senders = senderIds.length > 0
      ? await db.select({
          id: users.id,
          username: users.username,
        }).from(users).where(inArray(users.id, senderIds))
      : [];
    
    const messagesForUser = messages.map(msg => {
      const translations = msg.translations as Record<string, string> || {};
      const voiceTranslations = msg.voiceTranslations as Record<string, { audioPath: string }> || {};
      
      let displayContent = msg.originalContent;
      let hasVoiceTranslation = false;
      
      if (msg.originalLanguage !== userLanguage && translations[userLanguage]) {
        displayContent = translations[userLanguage];
        hasVoiceTranslation = !!voiceTranslations[userLanguage];
      }
      
      return {
        ...msg,
        displayContent,
        hasVoiceTranslation,
        sender: senders.find(s => s.id === msg.senderId) || null,
      };
    });
    
    if (memberInfo.length > 0) {
      await db.update(groupChatMembers)
        .set({ lastReadAt: new Date() })
        .where(eq(groupChatMembers.id, memberInfo[0].id));
    }
    
    res.json(messagesForUser.reverse());
  } catch (error) {
    console.error("Error fetching messages:", error);
    res.status(500).json({ error: "Failed to fetch messages" });
  }
});

router.get("/api/group-chats/:groupId/messages/:messageId/audio/:language", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const groupId = parseInt(req.params.groupId);
    const messageId = parseInt(req.params.messageId);
    const language = req.params.language;
    
    const membership = await db.select().from(groupChatMembers)
      .where(and(eq(groupChatMembers.groupChatId, groupId), eq(groupChatMembers.userId, userId)));
    if (membership.length === 0) {
      return res.status(403).json({ error: "Not a member of this group" });
    }
    
    const message = await db.select().from(groupChatMessages)
      .where(eq(groupChatMessages.id, messageId));
    
    if (message.length === 0) {
      return res.status(404).json({ error: "Message not found" });
    }
    
    let audioPath: string;
    
    if (language === message[0].originalLanguage || language === "original") {
      if (!message[0].audioPath) {
        return res.status(404).json({ error: "No audio for this message" });
      }
      audioPath = decrypt(message[0].audioPath);
    } else {
      const voiceTranslations = message[0].voiceTranslations as Record<string, { audioPath: string }>;
      if (!voiceTranslations[language]?.audioPath) {
        return res.status(404).json({ error: "Translation not available" });
      }
      audioPath = decrypt(voiceTranslations[language].audioPath);
    }
    
    const file = await objectStorage.getObjectEntityFile(audioPath);
    const readStream = file.createReadStream();
    const buffer = await streamToBuffer(readStream);
    
    res.set("Content-Type", "audio/mpeg");
    res.send(buffer);
  } catch (error) {
    console.error("Error fetching audio:", error);
    res.status(500).json({ error: "Failed to fetch audio" });
  }
});

export default router;
