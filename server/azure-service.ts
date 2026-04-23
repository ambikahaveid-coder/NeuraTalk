/**
 * Azure Cognitive Services — TTS, STT, Translation
 * 
 * Uses REST APIs only — NO SDK needed.
 * Gracefully returns null/throws when keys not configured,
 * so callers can fall back to ElevenLabs/free APIs.
 *
 * PERF: Uses undici connection pool for <200ms latency on warm connections.
 *
 * Required .env:
 *   AZURE_SPEECH_KEY=...
 *   AZURE_SPEECH_REGION=centralindia  (or eastus, etc.)
 *   AZURE_TRANSLATOR_KEY=...          (can be same as speech key if using multi-service)
 *   AZURE_TRANSLATOR_REGION=centralindia
 */

// ─── Keep-alive dispatcher ─────────────────────────────────
// Node's global `fetch` ignores http.Agent; must use undici's dispatcher.
// A persistent pool removes ~80–150ms TLS+TCP handshake on every Azure call,
// which is the single biggest latency win on the hot path.
import { Agent as UndiciAgent, fetch as undiciFetch } from "undici";

const azureDispatcher = new UndiciAgent({
  keepAliveTimeout: 30_000,      // Hold TCP sockets warm
  keepAliveMaxTimeout: 60_000,
  pipelining: 10,                // Reuse in-flight HTTP/1.1 multiplexed
  connections: 20,               // Per-origin pool
  connect: { timeout: 3000 },    // TCP+TLS connect must resolve fast
});

// Use this in place of global fetch so dispatcher is applied.
const azFetch = (url: string, init: Parameters<typeof undiciFetch>[1] = {}) =>
  undiciFetch(url, { ...init, dispatcher: azureDispatcher });

// ─── Config ────────────────────────────────────────────────

function speechKey(): string {
  const k = process.env.AZURE_SPEECH_KEY;
  if (!k) throw new Error("AZURE_SPEECH_KEY not configured");
  return k;
}

function speechRegion(): string {
  return process.env.AZURE_SPEECH_REGION || "centralindia";
}

function translatorKey(): string {
  const k = process.env.AZURE_TRANSLATOR_KEY || process.env.AZURE_SPEECH_KEY;
  if (!k) throw new Error("AZURE_TRANSLATOR_KEY not configured");
  return k;
}

function translatorRegion(): string {
  return process.env.AZURE_TRANSLATOR_REGION || process.env.AZURE_SPEECH_REGION || "centralindia";
}

export function isAzureAvailable(): boolean {
  return !!(process.env.AZURE_SPEECH_KEY || process.env.AZURE_TRANSLATOR_KEY);
}

export function isAzureSpeechAvailable(): boolean {
  return !!process.env.AZURE_SPEECH_KEY;
}

export function isAzureTranslatorAvailable(): boolean {
  return !!(process.env.AZURE_TRANSLATOR_KEY || process.env.AZURE_SPEECH_KEY);
}

// ─── Language code mapping ─────────────────────────────────

const AZURE_LANG_MAP: Record<string, string> = {
  en: "en", hi: "hi", te: "te", ta: "ta", kn: "kn", ml: "ml",
  mr: "mr", bn: "bn", gu: "gu", pa: "pa", ur: "ur", or: "or",
  as: "as", es: "es", fr: "fr", de: "de", ja: "ja", ko: "ko",
  zh: "zh-Hans", ar: "ar", pt: "pt", ru: "ru", it: "it", nl: "nl",
  tr: "tr", th: "th", vi: "vi", id: "id",
};

// Azure TTS voice names for Indian + global languages
const AZURE_VOICES: Record<string, { male: string; female: string }> = {
  en: { male: "en-IN-PrabhatNeural", female: "en-IN-NeerjaNeural" },
  hi: { male: "hi-IN-MadhurNeural", female: "hi-IN-SwaraNeural" },
  te: { male: "te-IN-MohanNeural", female: "te-IN-ShrutiNeural" },
  ta: { male: "ta-IN-ValluvarNeural", female: "ta-IN-PallaviNeural" },
  kn: { male: "kn-IN-GaganNeural", female: "kn-IN-SapnaNeural" },
  ml: { male: "ml-IN-MidhunNeural", female: "ml-IN-SobhanaNeural" },
  mr: { male: "mr-IN-ManoharNeural", female: "mr-IN-AarohiNeural" },
  bn: { male: "bn-IN-BashkarNeural", female: "bn-IN-TanishaaNeural" },
  gu: { male: "gu-IN-NiranjanNeural", female: "gu-IN-DhwaniNeural" },
  pa: { male: "pa-IN-GurpreetNeural", female: "pa-IN-SalimNeural" },
  ur: { male: "ur-PK-AsadNeural", female: "ur-PK-UzmaNeural" },
  es: { male: "es-ES-AlvaroNeural", female: "es-ES-ElviraNeural" },
  fr: { male: "fr-FR-HenriNeural", female: "fr-FR-DeniseNeural" },
  de: { male: "de-DE-ConradNeural", female: "de-DE-KatjaNeural" },
  ja: { male: "ja-JP-KeitaNeural", female: "ja-JP-NanamiNeural" },
  ar: { male: "ar-SA-HamedNeural", female: "ar-SA-ZariyahNeural" },
  zh: { male: "zh-CN-YunxiNeural", female: "zh-CN-XiaoxiaoNeural" },
  ko: { male: "ko-KR-InJoonNeural", female: "ko-KR-SunHiNeural" },
  pt: { male: "pt-BR-AntonioNeural", female: "pt-BR-FranciscaNeural" },
  ru: { male: "ru-RU-DmitryNeural", female: "ru-RU-SvetlanaNeural" },
};

// Azure locale mapping — used for both STT and TTS SSML xml:lang
const AZURE_LOCALES: Record<string, string> = {
  en: "en-IN", hi: "hi-IN", te: "te-IN", ta: "ta-IN", kn: "kn-IN",
  ml: "ml-IN", mr: "mr-IN", bn: "bn-IN", gu: "gu-IN", pa: "pa-IN",
  ur: "ur-PK", es: "es-ES", fr: "fr-FR", de: "de-DE", ja: "ja-JP",
  zh: "zh-CN", ar: "ar-SA", ko: "ko-KR", pt: "pt-BR", ru: "ru-RU",
  it: "it-IT", nl: "nl-NL", tr: "tr-TR",
};

// Keep backward compat alias
const AZURE_STT_LOCALES = AZURE_LOCALES;

// ─── Translation ───────────────────────────────────────────

/**
 * Azure Translator — 2M chars/month FREE
 * REST API, no SDK needed
 */
export async function azureTranslate(
  text: string,
  from: string,
  to: string
): Promise<string> {
  const key = translatorKey();
  const region = translatorRegion();
  const fromLang = AZURE_LANG_MAP[from] || from;
  const toLang = AZURE_LANG_MAP[to] || to;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 4000);

  try {
    const response = await azFetch(
      `https://api.cognitive.microsofttranslator.com/translate?api-version=3.0&from=${fromLang}&to=${toLang}`,
      {
        method: "POST",
        headers: {
          "Ocp-Apim-Subscription-Key": key,
          "Ocp-Apim-Subscription-Region": region,
          "Content-Type": "application/json",
        },
        body: JSON.stringify([{ Text: text }]),
        signal: controller.signal,
      }
    );
    clearTimeout(timeout);

    if (!response.ok) {
      const errBody = await response.text();
      throw new Error(`Azure Translator ${response.status}: ${errBody}`);
    }

    const data = (await response.json()) as Array<{
      translations: Array<{ text: string; to: string }>;
    }>;

    return data?.[0]?.translations?.[0]?.text || text;
  } catch (e) {
    clearTimeout(timeout);
    throw e;
  }
}

/**
 * Azure Language Detection
 */
export async function azureDetectLanguage(text: string): Promise<string> {
  const key = translatorKey();
  const region = translatorRegion();

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3000);

  try {
    const response = await azFetch(
      "https://api.cognitive.microsofttranslator.com/detect?api-version=3.0",
      {
        method: "POST",
        headers: {
          "Ocp-Apim-Subscription-Key": key,
          "Ocp-Apim-Subscription-Region": region,
          "Content-Type": "application/json",
        },
        body: JSON.stringify([{ Text: text }]),
        signal: controller.signal,
      }
    );
    clearTimeout(timeout);

    if (!response.ok) throw new Error(`Azure detect ${response.status}`);

    const data = (await response.json()) as Array<{
      language: string;
      score: number;
    }>;

    return data?.[0]?.language || "en";
  } catch (e) {
    clearTimeout(timeout);
    throw e;
  }
}

// ─── Text-to-Speech ────────────────────────────────────────

/**
 * Azure Neural TTS — 500K chars/month FREE
 * Returns audio buffer (MP3 or WAV)
 */
export async function azureTTS(
  text: string,
  language: string = "en",
  options: {
    gender?: "male" | "female";
    outputFormat?: string;
  } = {}
): Promise<Buffer> {
  const key = speechKey();
  const region = speechRegion();
  const gender = options.gender || "female";
  // Raw 16kHz PCM: no MP3 decode step before publishing to LiveKit audio track.
  // MP3 decode adds ~30–80ms in the bot and doubles CPU vs raw PCM. Default
  // flipped to raw PCM; callers that need MP3 for download can opt in.
  const outputFormat = options.outputFormat || "raw-16khz-16bit-mono-pcm";
  const voice = getAzureVoice(language, gender);
  const locale = AZURE_LOCALES[language] || `${language}-${language.toUpperCase()}`;

  const ssml = `<speak version='1.0' xml:lang='${locale}'>
  <voice name='${voice}'>
    ${escapeXml(text)}
  </voice>
</speak>`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  try {
    const response = await azFetch(
      `https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`,
      {
        method: "POST",
        headers: {
          "Ocp-Apim-Subscription-Key": key,
          "Content-Type": "application/ssml+xml",
          "X-Microsoft-OutputFormat": outputFormat,
          "User-Agent": "NeuraTalk",
        },
        body: ssml,
        signal: controller.signal,
      }
    );
    clearTimeout(timeout);

    if (!response.ok) {
      const errBody = await response.text();
      throw new Error(`Azure TTS ${response.status}: ${errBody}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  } catch (e) {
    clearTimeout(timeout);
    throw e;
  }
}

// ─── Speech-to-Text ────────────────────────────────────────

/**
 * Azure STT — 5 hrs/month FREE
 * Accepts WAV, MP3, OGG audio
 */
export async function azureSTT(
  audioBuffer: Buffer,
  language: string = "en",
  format: string = "wav"
): Promise<string> {
  const key = speechKey();
  const region = speechRegion();
  const locale = AZURE_STT_LOCALES[language] || `${language}-${language.toUpperCase()}`;

  const contentType = format === "pcm"
    ? "audio/wav; codecs=audio/pcm; samplerate=16000"
    : format === "mp3"
      ? "audio/mpeg"
      : "audio/wav";

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);

  try {
    const response = await azFetch(
      `https://${region}.stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1?language=${locale}&format=detailed`,
      {
        method: "POST",
        headers: {
          "Ocp-Apim-Subscription-Key": key,
          "Content-Type": contentType,
          Accept: "application/json",
        },
        body: new Uint8Array(audioBuffer.buffer, audioBuffer.byteOffset, audioBuffer.byteLength),
        signal: controller.signal,
      }
    );
    clearTimeout(timeout);

    if (!response.ok) {
      const errBody = await response.text();
      throw new Error(`Azure STT ${response.status}: ${errBody}`);
    }

    const data = (await response.json()) as {
      RecognitionStatus: string;
      DisplayText?: string;
      NBest?: Array<{ Display: string; Confidence: number }>;
    };

    if (data.RecognitionStatus === "Success") {
      return data.NBest?.[0]?.Display || data.DisplayText || "";
    }

    return "";
  } catch (e) {
    clearTimeout(timeout);
    throw e;
  }
}

// ─── Helpers ───────────────────────────────────────────────

function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Get the best Azure voice for a language + gender combo
 */
export function getAzureVoice(
  language: string,
  gender: "male" | "female" = "female"
): string {
  const voices = AZURE_VOICES[language] || AZURE_VOICES["en"];
  return gender === "male" ? voices.male : voices.female;
}

/**
 * List supported languages for Azure Translator
 */
export function getAzureSupportedLanguages(): string[] {
  return Object.keys(AZURE_LANG_MAP);
}
