import { Router, Request, Response } from "express";
import { db } from "./db";
import { voiceMemos, voiceProfiles, groupChatMembers } from "@shared/schema";
import { eq, and, or, desc } from "drizzle-orm";
import { ObjectStorageService } from "./replit_integrations/object_storage";
import { speechToText, textToSpeech } from "./replit_integrations/audio/client";
import crypto from "crypto";
import { openai } from "./replit_integrations/audio/client";
import { Readable } from "stream";
import { requireAuth } from "./role-middleware";

async function streamToBuffer(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

const objectStorage = new ObjectStorageService();
const router = Router();

const ENCRYPTION_ALGORITHM = "aes-256-gcm";

function getEncryptionKey(): Buffer {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET required");
  return crypto.scryptSync(secret, "voice-memo-salt", 32);
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
  { code: "fr", name: "French" },
  { code: "de", name: "German" },
  { code: "ja", name: "Japanese" },
  { code: "ko", name: "Korean" },
  { code: "zh", name: "Chinese" },
  { code: "ar", name: "Arabic" },
  { code: "pt", name: "Portuguese" },
  { code: "ru", name: "Russian" },
  { code: "it", name: "Italian" },
];

const OPENAI_VOICES = ["alloy", "echo", "fable", "onyx", "nova", "shimmer"] as const;
type OpenAIVoice = typeof OPENAI_VOICES[number];

async function detectLanguage(text: string): Promise<string> {
  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: "Detect the language of this text. Reply with ONLY the ISO 639-1 language code (e.g., 'en', 'hi', 'te')." },
        { role: "user", content: text }
      ],
      max_tokens: 5
    });
    return (response.choices[0]?.message?.content?.trim().toLowerCase() || "en").slice(0, 2);
  } catch {
    return "en";
  }
}

async function translateText(text: string, fromLang: string, toLang: string): Promise<string> {
  if (fromLang === toLang) return text;
  
  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { 
          role: "system", 
          content: `You are a translator. Translate the following text from ${fromLang} to ${toLang}. Preserve the emotion and tone. Reply with ONLY the translation, nothing else.` 
        },
        { role: "user", content: text }
      ]
    });
    return response.choices[0]?.message?.content?.trim() || text;
  } catch {
    return text;
  }
}

async function detectEmotion(text: string): Promise<string[]> {
  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { 
          role: "system", 
          content: "Detect the emotions in this text. Reply with a comma-separated list of emotion tags (e.g., 'happy,excited' or 'neutral' or 'sad,concerned'). Use simple emotion words only." 
        },
        { role: "user", content: text }
      ],
      max_tokens: 20
    });
    const emotions = response.choices[0]?.message?.content?.trim().toLowerCase().split(",").map(e => e.trim()) || ["neutral"];
    return emotions;
  } catch {
    return ["neutral"];
  }
}

router.get("/api/voice-memos/languages", (_req: Request, res: Response) => {
  res.json(SUPPORTED_LANGUAGES);
});

router.post("/api/voice-memos/upload-url", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    
    const uploadURL = await objectStorage.getObjectEntityUploadURL();
    const objectPath = objectStorage.normalizeObjectEntityPath(uploadURL);
    const encryptedPath = encrypt(objectPath);
    
    res.json({ uploadURL, objectPath: encryptedPath, userId });
  } catch (error) {
    console.error("Error generating upload URL:", error);
    res.status(500).json({ error: "Failed to generate upload URL" });
  }
});

router.post("/api/voice-memos", requireAuth, async (req: Request, res: Response) => {
  try {
    const senderId = req.user!.id;
    const { 
      recipientId, 
      groupChatId,
      audioPath, 
      duration,
      useVoiceCloning = false,
      voiceProfileId
    } = req.body;
    
    if (!audioPath) {
      return res.status(400).json({ error: "Audio path required" });
    }
    
    try {
      decrypt(audioPath);
    } catch {
      return res.status(400).json({ error: "Invalid audio path" });
    }
    
    if (groupChatId) {
      const membership = await db.select().from(groupChatMembers)
        .where(and(
          eq(groupChatMembers.groupChatId, groupChatId),
          eq(groupChatMembers.userId, senderId)
        ));
      if (membership.length === 0) {
        return res.status(403).json({ error: "Not a member of this group" });
      }
    }
    
    const memo = await db.insert(voiceMemos).values({
      senderId,
      recipientId: recipientId || null,
      groupChatId: groupChatId || null,
      originalAudioPath: audioPath,
      originalLanguage: "en",
      duration: duration || 0,
      useVoiceCloning,
      voiceProfileId: voiceProfileId || null,
      status: "pending",
    }).returning();
    
    processVoiceMemo(memo[0].id);
    
    res.status(201).json({ 
      id: memo[0].id, 
      status: "processing",
      message: "Voice memo uploaded, processing translation..." 
    });
  } catch (error) {
    console.error("Error creating voice memo:", error);
    res.status(500).json({ error: "Failed to create voice memo" });
  }
});

async function processVoiceMemo(memoId: number) {
  try {
    await db.update(voiceMemos)
      .set({ status: "transcribing" })
      .where(eq(voiceMemos.id, memoId));
    
    const memo = await db.select().from(voiceMemos).where(eq(voiceMemos.id, memoId));
    if (memo.length === 0) return;
    
    const decryptedPath = decrypt(memo[0].originalAudioPath);
    const file = await objectStorage.getObjectEntityFile(decryptedPath);
    const readStream = file.createReadStream();
    const audioBuffer = await streamToBuffer(readStream);
    
    const transcript = await speechToText(audioBuffer, "webm");
    
    const language = await detectLanguage(transcript);
    const emotions = await detectEmotion(transcript);
    
    await db.update(voiceMemos)
      .set({ 
        originalTranscript: transcript,
        originalLanguage: language,
        emotionTags: emotions,
        status: "translating"
      })
      .where(eq(voiceMemos.id, memoId));
    
    const translations: Record<string, { transcript: string; audioPath?: string }> = {};
    const targetLanguages = SUPPORTED_LANGUAGES.filter(l => l.code !== language).slice(0, 5);
    
    for (const targetLang of targetLanguages) {
      try {
        const translatedText = await translateText(transcript, language, targetLang.code);
        
        let voice: OpenAIVoice = "alloy";
        if (memo[0].voiceProfileId) {
          const profile = await db.select().from(voiceProfiles)
            .where(eq(voiceProfiles.id, memo[0].voiceProfileId));
          if (profile.length > 0 && profile[0].voiceId) {
            const voiceId = profile[0].voiceId as string;
            if (OPENAI_VOICES.includes(voiceId as OpenAIVoice)) {
              voice = voiceId as OpenAIVoice;
            }
          }
        }
        
        const audioBuffer = await textToSpeech(translatedText, voice, "wav", targetLang.code);
        
        const uploadURL = await objectStorage.getObjectEntityUploadURL();
        const translatedPath = objectStorage.normalizeObjectEntityPath(uploadURL);
        
        await fetch(uploadURL, {
          method: "PUT",
          body: audioBuffer,
          headers: { "Content-Type": "audio/mpeg" }
        });
        
        translations[targetLang.code] = {
          transcript: translatedText,
          audioPath: encrypt(translatedPath),
        };
      } catch (err) {
        console.error(`Translation failed for ${targetLang.code}:`, err);
      }
    }
    
    await db.update(voiceMemos)
      .set({ 
        translations,
        status: "ready"
      })
      .where(eq(voiceMemos.id, memoId));
      
  } catch (error) {
    console.error("Error processing voice memo:", error);
    await db.update(voiceMemos)
      .set({ status: "failed" })
      .where(eq(voiceMemos.id, memoId));
  }
}

router.get("/api/voice-memos", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    
    const memos = await db.select({
      id: voiceMemos.id,
      senderId: voiceMemos.senderId,
      recipientId: voiceMemos.recipientId,
      groupChatId: voiceMemos.groupChatId,
      originalLanguage: voiceMemos.originalLanguage,
      originalTranscript: voiceMemos.originalTranscript,
      translations: voiceMemos.translations,
      duration: voiceMemos.duration,
      status: voiceMemos.status,
      emotionTags: voiceMemos.emotionTags,
      isRead: voiceMemos.isRead,
      createdAt: voiceMemos.createdAt,
    })
    .from(voiceMemos)
    .where(or(
      eq(voiceMemos.senderId, userId),
      eq(voiceMemos.recipientId, userId)
    ))
    .orderBy(desc(voiceMemos.createdAt))
    .limit(50);
    
    res.json(memos);
  } catch (error) {
    console.error("Error fetching voice memos:", error);
    res.status(500).json({ error: "Failed to fetch voice memos" });
  }
});

router.get("/api/voice-memos/:memoId/audio/:language", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const memoId = parseInt(req.params.memoId);
    const language = req.params.language;
    
    const memo = await db.select().from(voiceMemos).where(eq(voiceMemos.id, memoId));
    if (memo.length === 0) {
      return res.status(404).json({ error: "Voice memo not found" });
    }
    
    if (memo[0].senderId !== userId && memo[0].recipientId !== userId) {
      return res.status(403).json({ error: "Access denied" });
    }
    
    let audioPath: string;
    
    if (language === memo[0].originalLanguage || language === "original") {
      audioPath = decrypt(memo[0].originalAudioPath);
    } else {
      const translations = memo[0].translations as Record<string, { audioPath: string }>;
      if (!translations[language]?.audioPath) {
        return res.status(404).json({ error: "Translation not available" });
      }
      audioPath = decrypt(translations[language].audioPath);
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

router.patch("/api/voice-memos/:memoId/read", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const memoId = parseInt(req.params.memoId);
    
    const memo = await db.select().from(voiceMemos).where(eq(voiceMemos.id, memoId));
    if (memo.length === 0 || memo[0].recipientId !== userId) {
      return res.status(403).json({ error: "Access denied" });
    }
    
    await db.update(voiceMemos)
      .set({ isRead: true })
      .where(eq(voiceMemos.id, memoId));
    
    res.json({ success: true });
  } catch (error) {
    console.error("Error marking memo as read:", error);
    res.status(500).json({ error: "Failed to update memo" });
  }
});

router.delete("/api/voice-memos/:memoId", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const memoId = parseInt(req.params.memoId);
    
    const memo = await db.select().from(voiceMemos)
      .where(and(eq(voiceMemos.id, memoId), eq(voiceMemos.senderId, userId)));
    
    if (memo.length === 0) {
      return res.status(404).json({ error: "Voice memo not found or unauthorized" });
    }
    
    try {
      const originalPath = decrypt(memo[0].originalAudioPath);
      const file = await objectStorage.getObjectEntityFile(originalPath);
      await file.delete();
    } catch {}
    
    const translations = memo[0].translations as Record<string, { audioPath?: string }>;
    for (const lang in translations) {
      if (translations[lang]?.audioPath) {
        try {
          const translatedPath = decrypt(translations[lang].audioPath!);
          const file = await objectStorage.getObjectEntityFile(translatedPath);
          await file.delete();
        } catch {}
      }
    }
    
    await db.delete(voiceMemos).where(eq(voiceMemos.id, memoId));
    
    res.json({ success: true, message: "Voice memo deleted" });
  } catch (error) {
    console.error("Error deleting voice memo:", error);
    res.status(500).json({ error: "Failed to delete voice memo" });
  }
});

export default router;
