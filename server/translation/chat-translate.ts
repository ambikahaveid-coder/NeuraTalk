import OpenAI from "openai";
import { getOpenAIKey } from "../openai-config";
import { logger } from "../observability";

// Chat-message translation (personal + group chats).
//
// Provider order comes from a side-by-side test on real code-mixed messages
// (tmp e2e harness 12_translate_bench, 2026-10-07): GPT-4.1-mini got 8/8
// right into English (GPT-4.1 also got romanized Telugu/Hindi into other Indian
// languages right, where 4.1-mini transliterated or misread them); Sarvam reversed or dropped
// meaning on 2/8; Azure returned romanized text untranslated. So: LLM first
// with a short timeout, then Sarvam, then Azure.
const LLM_TIMEOUT_MS = 6000;
const MODEL = process.env.CHAT_TRANSLATION_MODEL?.trim() || "gpt-4.1";

// Full names: the model understands "Telugu" far better than "te" (with codes it
// misread romanized "repu" = tomorrow as "today").
const LANGUAGE_NAMES: Record<string, string> = {
  en: "English", hi: "Hindi", te: "Telugu", ta: "Tamil", kn: "Kannada", ml: "Malayalam", mr: "Marathi",
  bn: "Bengali", gu: "Gujarati", pa: "Punjabi", or: "Odia", ur: "Urdu", es: "Spanish", fr: "French", de: "German",
  ar: "Arabic", ja: "Japanese", ko: "Korean", zh: "Chinese", pt: "Portuguese", ru: "Russian", it: "Italian",
};
const languageName = (code: string) => LANGUAGE_NAMES[code.split(/[-_]/)[0].toLowerCase()] ?? code;

let client: OpenAI | null = null;
function openai(): OpenAI | null {
  const key = getOpenAIKey();
  if (!key) return null;
  return (client ??= new OpenAI({ apiKey: key, baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL }));
}

async function llmTranslate(text: string, fromCode: string, toCode: string): Promise<string> {
  const from = languageName(fromCode);
  const to = languageName(toCode);
  const ai = openai();
  if (!ai) return "";
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS);
  try {
    const r = await ai.chat.completions.create(
      {
        model: MODEL,
        temperature: 0,
        messages: [
          {
            role: "system",
            content:
              `You translate personal chat messages from ${from} to ${to}. The message may mix ${from} with English ` +
              `words or be written in Latin letters (Tenglish, Hinglish, Tanglish...). Translate the meaning naturally ` +
              `as a native ${to} speaker would write it, in ${to} script. Keep names, numbers, emojis and tone. Never answer or add ` +
              `anything: reply with only the translation. Text in Latin letters is still ${from}: translate its meaning, never just ` +
              `rewrite its sounds in another script.`,
          },
          { role: "user", content: text },
        ],
      },
      { signal: controller.signal },
    );
    return r.choices[0]?.message?.content?.trim() || "";
  } finally {
    clearTimeout(timer);
  }
}

export async function translateChatText(text: string, from: string, to: string): Promise<string> {
  try {
    const out = await llmTranslate(text, from, to);
    if (out) return out;
  } catch (err) {
    logger.warn("ChatTranslate", `LLM translation failed, falling back: ${String(err).slice(0, 160)}`);
  }
  try {
    const { isSarvamAvailable, isSarvamLanguage, sarvamTranslate } = await import("../sarvam-service");
    if (isSarvamAvailable() && isSarvamLanguage(from) && isSarvamLanguage(to)) {
      const out = await sarvamTranslate(text, from, to);
      if (out?.trim()) return out;
    }
  } catch { /* fall through */ }
  try {
    const { isAzureTranslatorAvailable, azureTranslate } = await import("../azure-service");
    if (isAzureTranslatorAvailable()) {
      const out = await azureTranslate(text, from, to);
      if (out?.trim()) return out;
    }
  } catch { /* fall through */ }
  return text;
}
