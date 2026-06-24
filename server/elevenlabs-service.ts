/**
 * ElevenLabs Service - Primary Voice AI Provider for NeuraTalk
 *
 * Handles:
 * - Text-to-Speech (multilingual)
 * - Speech-to-Text (Scribe v1)
 * - Voice Cloning (add / delete voices)
 * - Free translation fallback via MyMemory
 */

import { logger } from "./observability";

const API_BASE = "https://api.elevenlabs.io/v1";

async function fetchWithTimeout(url: string, options: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
    logger.warn("ElevenLabs", `Request timed out after ${timeoutMs}ms`, { url: url.split("?")[0] });
  }, timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function apiKey(): string {
  const key = process.env.ELEVEN_LABS_API_KEY || process.env.ELEVENLABS_API_KEY;
  if (!key) throw new Error("ELEVEN_LABS_API_KEY / ELEVENLABS_API_KEY not configured");
  process.env.ELEVEN_LABS_API_KEY = key;
  process.env.ELEVENLABS_API_KEY = key;
  return key;
}

export interface ElevenLabsVoice {
  voice_id: string;
  name: string;
  category: string;
  description?: string;
  preview_url?: string;
  labels?: Record<string, string>;
}

// Curated built-in voices that work well for Indian + global languages
export const ELEVENLABS_VOICES = {
  rachel:  "21m00Tcm4TlvDq8ikWAM", // Female, warm conversational
  bella:   "EXAVITQu4vr4xnSDxMaL", // Female, soft
  elli:    "MF3mGyEYCl7XYWbV9V6O", // Female, emotional
  josh:    "TxGEqnHWrfWFTfGW9XjX", // Male, deep
  adam:    "pNInz6obpgDQGcFmaJgB", // Male, deep
  sam:     "yoZ06aMxZJJ28mfd3POQ", // Male, raspy
};

/**
 * Text-to-Speech
 * Returns an MP3 buffer by default (works in browser audio elements directly).
 */
export async function elevenLabsTTS(
  text: string,
  voiceId: string = ELEVENLABS_VOICES.rachel,
  options: {
    modelId?: string;
    stability?: number;
    similarityBoost?: number;
    style?: number;
    outputFormat?: string;
  } = {}
): Promise<Buffer> {
  const {
    modelId = "eleven_multilingual_v2",
    stability = 0.5,
    similarityBoost = 0.75,
    style = 0.4,
    outputFormat = "mp3_44100_128",
  } = options;

  const response = await fetchWithTimeout(
    `${API_BASE}/text-to-speech/${voiceId}?output_format=${outputFormat}`,
    {
      method: "POST",
      headers: {
        Accept: "audio/mpeg",
        "Content-Type": "application/json",
        "xi-api-key": apiKey(),
      },
      body: JSON.stringify({
        text,
        model_id: modelId,
        voice_settings: {
          stability,
          similarity_boost: similarityBoost,
          style,
          use_speaker_boost: true,
        },
      }),
    },
    20_000
  );

  if (!response.ok) {
    const err = await response.text().catch(() => response.status.toString());
    throw new Error(`ElevenLabs TTS (${response.status}): ${err}`);
  }

  return Buffer.from(await response.arrayBuffer());
}

/**
 * Speech-to-Text using ElevenLabs Scribe
 */
export async function elevenLabsSTT(
  audioBuffer: Buffer,
  format: "wav" | "mp3" | "webm" = "wav"
): Promise<string> {
  const form = new FormData();
  const blob = new Blob([audioBuffer], { type: `audio/${format}` });
  form.append("file", blob, `audio.${format}`);
  form.append("model_id", "scribe_v1");

  const response = await fetchWithTimeout(`${API_BASE}/speech-to-text`, {
    method: "POST",
    headers: { "xi-api-key": apiKey() },
    body: form,
  }, 20_000);

  if (!response.ok) {
    const err = await response.text().catch(() => response.status.toString());
    throw new Error(`ElevenLabs STT (${response.status}): ${err}`);
  }

  const data = (await response.json()) as { text: string };
  return data.text || "";
}

/**
 * List all available voices (built-in + cloned)
 */
export async function elevenLabsListVoices(): Promise<ElevenLabsVoice[]> {
  const response = await fetchWithTimeout(`${API_BASE}/voices`, {
    headers: { "xi-api-key": apiKey() },
  }, 10_000);

  if (!response.ok) throw new Error(`ElevenLabs list voices (${response.status})`);

  const data = (await response.json()) as { voices: ElevenLabsVoice[] };
  return data.voices || [];
}

/**
 * Create a voice clone from audio samples (Instant Voice Cloning)
 * Each buffer should be 1–5 min of clear speech, MP3 preferred.
 */
export async function elevenLabsCreateVoice(
  name: string,
  samples: Array<{ buffer: Buffer; filename: string }>,
  description = ""
): Promise<{ voice_id: string; name: string }> {
  const form = new FormData();
  form.append("name", name);
  if (description) form.append("description", description);

  for (const s of samples) {
    const blob = new Blob([s.buffer], { type: "audio/mpeg" });
    form.append("files", blob, s.filename);
  }

  const response = await fetchWithTimeout(`${API_BASE}/voices/add`, {
    method: "POST",
    headers: { "xi-api-key": apiKey() },
    body: form,
  }, 30_000);

  if (!response.ok) {
    const err = await response.text().catch(() => response.status.toString());
    throw new Error(`ElevenLabs create voice (${response.status}): ${err}`);
  }

  return (await response.json()) as { voice_id: string; name: string };
}

/**
 * Delete a cloned voice by ID
 */
export async function elevenLabsDeleteVoice(voiceId: string): Promise<void> {
  const response = await fetchWithTimeout(`${API_BASE}/voices/${voiceId}`, {
    method: "DELETE",
    headers: { "xi-api-key": apiKey() },
  }, 10_000);

  if (!response.ok) throw new Error(`ElevenLabs delete voice (${response.status})`);
}

/**
 * Get subscription / usage info
 */
export async function elevenLabsGetSubscription(): Promise<{
  character_count: number;
  character_limit: number;
  voice_limit: number;
}> {
  const response = await fetchWithTimeout(`${API_BASE}/user/subscription`, {
    headers: { "xi-api-key": apiKey() },
  }, 10_000);

  if (!response.ok) throw new Error(`ElevenLabs subscription (${response.status})`);
  return (await response.json()) as {
    character_count: number;
    character_limit: number;
    voice_limit: number;
  };
}

/**
 * Quick availability check
 */
export async function isElevenLabsAvailable(): Promise<boolean> {
  const key = process.env.ELEVEN_LABS_API_KEY || process.env.ELEVENLABS_API_KEY;
  if (!key) return false;
  try {
    const r = await fetchWithTimeout(`${API_BASE}/user`, { headers: { "xi-api-key": key } }, 5_000);
    return r.ok;
  } catch {
    return false;
  }
}

// ─────────────────────────────────────────────
// FREE TRANSLATION FALLBACK (MyMemory API)
// ─────────────────────────────────────────────

const LANGUAGE_CODES: Record<string, string> = {
  en: "en-GB",
  hi: "hi-IN",
  te: "te-IN",
  ta: "ta-IN",
  kn: "kn-IN",
  ar: "ar-SA",
  zh: "zh-CN",
  ja: "ja-JP",
  es: "es-ES",
  fr: "fr-FR",
  de: "de-DE",
};

/**
 * Translate text — CASCADE: Azure → Lingva → MyMemory → original text.
 * Falls back to original text on any error.
 */
export async function translateText(
  text: string,
  from: string,
  to: string
): Promise<string> {
  if (!text.trim() || from === to) return text;

  // 0. Try Azure Translator first (2M chars/month FREE, best quality)
  try {
    const { isAzureTranslatorAvailable, azureTranslate } = await import("./azure-service");
    if (isAzureTranslatorAvailable()) {
      const result = await azureTranslate(text, from, to);
      if (result && result !== text) return result;
    }
  } catch {
    // Azure not available or failed, fall through
  }

  // 1. Try Lingva Translate (proxies Google Translate — high quality, free, no key)
  try {
    const lingvaUrl = `https://lingva.ml/api/v1/${encodeURIComponent(from)}/${encodeURIComponent(to)}/${encodeURIComponent(text)}`;
    const ctrl1 = new AbortController();
    const t1 = setTimeout(() => ctrl1.abort(), 6000);
    const resp1 = await fetch(lingvaUrl, { signal: ctrl1.signal });
    clearTimeout(t1);
    if (resp1.ok) {
      const d1 = (await resp1.json()) as { translation?: string };
      if (d1.translation && d1.translation.trim() && d1.translation !== text) {
        return d1.translation;
      }
    }
  } catch {
    // fall through to MyMemory
  }

  // 2. MyMemory fallback
  try {
    const fromCode = LANGUAGE_CODES[from] || from;
    const toCode   = LANGUAGE_CODES[to]   || to;
    const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=${fromCode}|${toCode}`;

    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 5000);

    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(t);

    if (!response.ok) return text;

    const data = (await response.json()) as {
      responseStatus: number;
      responseData?: { translatedText: string };
    };

    if (data.responseStatus === 200 && data.responseData?.translatedText) {
      const translated = data.responseData.translatedText;
      if (translated.startsWith("MYMEMORY WARNING")) return text;
      return translated;
    }

    return text;
  } catch {
    return text;
  }
}
