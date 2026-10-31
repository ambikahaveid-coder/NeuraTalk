/**
 * Business-chat translation (NeuraTalk's edge over plain business chat):
 * each viewer reads the OTHER side's messages in their own language, with
 * the original kept alongside. Translations are cached per message+language
 * in messaging_translations, so each text is translated once.
 *
 * Never translated: the viewer's own messages, verification codes
 * (authentication category), and anything when the viewer turned
 * translation off.
 */
import { and, eq, inArray } from "drizzle-orm";
import { db } from "../../db";
import { messagingTranslations, users, MESSAGE_CATEGORY } from "@shared/schema";
import { isTranslationConsentDenied } from "../../translation-consent";
import { translateChatTextToLanguage } from "../../translation/chat-translate";
import { logger } from "../../observability";
import { createHash } from "crypto";
import { getRedisClient, isRedisReady } from "../../redis";

// A broadcast stores one message per customer. Without this, the same offer sent to
// 10,000 Telugu readers would be translated 10,000 times. Same text + same language
// is translated once and reused (30 days).
const SHARED_TTL_SECONDS = 30 * 24 * 60 * 60;
const sharedKey = (text: string, language: string) =>
  `bt:${language}:${createHash("sha256").update(text.trim()).digest("hex")}`;

async function sharedTranslation(text: string, language: string): Promise<string | null> {
  try {
    if (!isRedisReady()) return null;
    return await getRedisClient().get(sharedKey(text, language));
  } catch { return null; }
}

async function rememberShared(text: string, language: string, translated: string): Promise<void> {
  try {
    if (!isRedisReady() || !translated.trim()) return;
    await getRedisClient().set(sharedKey(text, language), translated, "EX", SHARED_TTL_SECONDS);
  } catch { /* best effort */ }
}

/** Script ranges: a message already in the viewer's script needs no translation. */
const SCRIPT: Record<string, RegExp> = {
  te: /[ఀ-౿]/, hi: /[ऀ-ॿ]/, mr: /[ऀ-ॿ]/, ta: /[஀-௿]/, kn: /[ಀ-೿]/,
  ml: /[ഀ-ൿ]/, bn: /[ঀ-৿]/, gu: /[઀-૿]/, pa: /[਀-੿]/, or: /[଀-୿]/,
  ur: /[؀-ۿ]/, ar: /[؀-ۿ]/,
};
// Letters outside Latin (Indic, Arabic, CJK...): Ͱ and up, minus punctuation/symbol blocks.
const ANY_NON_LATIN = /[Ͱ-῿Ⰰ-￯]/;

function obviouslyAlreadyIn(text: string, language: string): boolean {
  const script = SCRIPT[language];
  if (script) return script.test(text) && !/[A-Za-z]{3,}/.test(text.replace(/https?:\S+/g, ""));
  // Latin-script target (en, es, ...): plain Latin text with no other script is
  // most likely already readable -- but romanized Telugu/Hindi is Latin too,
  // so only skip pure-ASCII text when the target is English and it looks English.
  if (language === "en") return !ANY_NON_LATIN.test(text) && /\b(the|and|is|your|you|order|thanks?|please|hi|hello|yes|no|ok)\b/i.test(text);
  return false;
}

export interface ViewerLanguage { language: string | null }

/** The language this viewer reads, or null when they don't want translation. */
export async function viewerTranslationLanguage(userId: number): Promise<string | null> {
  const [user] = await db.select({
    preferredLanguage: users.preferredLanguage,
    translationEnabled: users.translationEnabled,
    consentTranslation: users.consentTranslation,
    consentTimestamp: users.consentTimestamp,
  }).from(users).where(eq(users.id, userId));
  if (!user || user.translationEnabled === false) return null;
  if (isTranslationConsentDenied(user.consentTranslation, user.consentTimestamp)) return null;
  const lang = (user.preferredLanguage || "").split(/[-_]/)[0].toLowerCase();
  return lang && lang !== "auto" ? lang : null;
}

type Translatable = { id: number; content: string; category: string };

/**
 * Adds `translatedContent` / `translatedLanguage` to messages that are not
 * the viewer's own (decided by `isOwn`) and not already in their language.
 */
export async function withTranslations<T extends Translatable>(
  messages: T[],
  language: string | null,
  isOwn: (message: T) => boolean,
): Promise<Array<T & { translatedContent: string | null; translatedLanguage: string | null }>> {
  const plain = messages.map((m) => ({ ...m, translatedContent: null as string | null, translatedLanguage: null as string | null }));
  if (!language) return plain;
  const candidates = plain.filter((m) =>
    !isOwn(m) && m.category !== MESSAGE_CATEGORY.AUTHENTICATION && m.content.trim() && !obviouslyAlreadyIn(m.content, language));
  if (candidates.length === 0) return plain;

  const cached = await db.select().from(messagingTranslations).where(and(
    inArray(messagingTranslations.messageId, candidates.map((m) => m.id)),
    eq(messagingTranslations.language, language),
  ));
  const byId = new Map(cached.map((row) => [row.messageId, row.translatedContent]));

  const missing = candidates.filter((m) => !byId.has(m.id)).slice(0, 25); // bound one request's work
  await Promise.all(missing.map(async (m) => {
    try {
      const reused = await sharedTranslation(m.content, language);
      const translated = reused ?? await translateChatTextToLanguage(m.content, language);
      if (!reused) await rememberShared(m.content, language, translated);
      byId.set(m.id, translated);
      await db.insert(messagingTranslations).values({ messageId: m.id, language, translatedContent: translated });
    } catch (error) {
      logger.warn("BusinessTranslate", `message ${m.id} -> ${language} failed: ${String(error)}`);
    }
  }));

  for (const m of plain) {
    const translated = byId.get(m.id);
    if (translated && translated.trim() && translated.trim() !== m.content.trim()) {
      m.translatedContent = translated;
      m.translatedLanguage = language;
    }
  }
  return plain;
}
