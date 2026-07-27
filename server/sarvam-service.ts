/**
 * Sarvam AI — Indian-language STT/TTS purpose-built for code-mixed speech
 * (Hinglish, Tanglish, Tenglish) — unlike Azure/OpenAI which are general-purpose
 * and treat code-switching as an afterthought.
 *
 * Docs: https://docs.sarvam.ai (api.sarvam.ai) — auth via `api-subscription-key` header.
 *
 * IMPORTANT: the exact request/response shape below is built from Sarvam's
 * publicly documented parameters (language_code, model, mode=codemix for
 * saaras:v3) but has NOT been exercised against a live API key yet — verify
 * the response field names against a real call before relying on this in
 * production. If the shape differs, only parseSarvamSttResponse needs to change.
 */

import { logger } from "./observability";

const SARVAM_BASE_URL = "https://api.sarvam.ai";
const SARVAM_TIMEOUT_MS = 12_000;

// Sarvam's own locale codes (BCP-47-ish, India-suffixed)
const SARVAM_LOCALES: Record<string, string> = {
  hi: "hi-IN", te: "te-IN", ta: "ta-IN", kn: "kn-IN", ml: "ml-IN",
  mr: "mr-IN", bn: "bn-IN", gu: "gu-IN", od: "od-IN", or: "od-IN", pa: "pa-IN", en: "en-IN",
};

function apiKey(): string {
  return (process.env.SARVAM_API_KEY || "").trim();
}

export function isSarvamAvailable(): boolean {
  return Boolean(apiKey());
}

const SARVAM_LANGUAGE_BASES = new Set(["hi", "te", "ta", "kn", "ml", "mr", "bn", "gu", "od", "or", "pa", "en", "auto"]);

/** True if `language` (any casing/region-suffix, e.g. "te-IN", "en-US", "auto") is one Sarvam supports. */
export function isSarvamLanguage(language: string): boolean {
  const base = (language || "").split("-")[0].toLowerCase();
  return SARVAM_LANGUAGE_BASES.has(base);
}

function toSarvamLocale(language: string): string {
  if (!language || language === "auto") return "unknown";
  if (language.includes("-")) return language; // already BCP-47, e.g. te-IN
  return SARVAM_LOCALES[language] || "unknown";
}

/**
 * Speech-to-text via Sarvam Saaras v3 in "codemix" mode — the mode Sarvam
 * specifically ships for Hinglish/Tanglish/Tenglish-style mixed speech.
 */
export async function sarvamSTT(
  audioBuffer: Buffer,
  language: string = "auto",
  format: "wav" | "mp3" | "webm" = "wav",
): Promise<string> {
  const key = apiKey();
  if (!key) throw new Error("SARVAM_API_KEY not configured");

  const form = new FormData();
  const blob = new Blob([new Uint8Array(audioBuffer)], { type: format === "mp3" ? "audio/mpeg" : "audio/wav" });
  form.append("file", blob, `audio.${format === "webm" ? "wav" : format}`);
  form.append("model", "saaras:v3");
  form.append("mode", "codemix");
  form.append("language_code", toSarvamLocale(language));

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SARVAM_TIMEOUT_MS);

  try {
    const response = await fetch(`${SARVAM_BASE_URL}/speech-to-text`, {
      method: "POST",
      headers: { "api-subscription-key": key },
      body: form,
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!response.ok) {
      const errBody = await response.text().catch(() => "");
      throw new Error(`Sarvam STT ${response.status}: ${errBody}`);
    }

    const data = (await response.json()) as { transcript?: string; text?: string };
    return data.transcript || data.text || "";
  } catch (err) {
    clearTimeout(timeout);
    logger.warn("SarvamService", `STT failed: ${String(err)}`);
    throw err;
  }
}

/** Text translation via Sarvam Mayura — purpose-built for Indian language pairs, supports "auto" source. */
export async function sarvamTranslate(
  text: string,
  sourceLanguage: string = "auto",
  targetLanguage: string = "en",
): Promise<string> {
  const key = apiKey();
  if (!key) throw new Error("SARVAM_API_KEY not configured");
  if (!text.trim()) return text;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SARVAM_TIMEOUT_MS);

  try {
    const response = await fetch(`${SARVAM_BASE_URL}/translate`, {
      method: "POST",
      headers: {
        "api-subscription-key": key,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        input: text,
        source_language_code: toSarvamLocale(sourceLanguage) === "unknown" ? "auto" : toSarvamLocale(sourceLanguage),
        target_language_code: toSarvamLocale(targetLanguage),
        model: "mayura:v1",
      }),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!response.ok) {
      const errBody = await response.text().catch(() => "");
      throw new Error(`Sarvam Translate ${response.status}: ${errBody}`);
    }

    const data = (await response.json()) as { translated_text?: string };
    return data.translated_text || text;
  } catch (err) {
    clearTimeout(timeout);
    logger.warn("SarvamService", `Translate failed: ${String(err)}`);
    throw err;
  }
}

/** Text-to-speech via Sarvam Bulbul v3 — returns base64-decoded audio (WAV). */
export async function sarvamTTS(
  text: string,
  language: string = "en",
  speaker: string = "anand",
): Promise<Buffer> {
  const key = apiKey();
  if (!key) throw new Error("SARVAM_API_KEY not configured");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SARVAM_TIMEOUT_MS);

  try {
    const response = await fetch(`${SARVAM_BASE_URL}/text-to-speech`, {
      method: "POST",
      headers: {
        "api-subscription-key": key,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        text,
        target_language_code: toSarvamLocale(language),
        model: "bulbul:v3",
        speaker,
      }),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!response.ok) {
      const errBody = await response.text().catch(() => "");
      throw new Error(`Sarvam TTS ${response.status}: ${errBody}`);
    }

    const data = (await response.json()) as { audios?: string[] };
    const b64 = data.audios?.[0];
    if (!b64) throw new Error("Sarvam TTS returned no audio");
    return Buffer.from(b64, "base64");
  } catch (err) {
    clearTimeout(timeout);
    logger.warn("SarvamService", `TTS failed: ${String(err)}`);
    throw err;
  }
}
