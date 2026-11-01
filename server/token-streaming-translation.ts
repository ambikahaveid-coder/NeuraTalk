import OpenAI from "openai";
import { logger } from "./observability";
import { normalizeLanguage, normalizeSpaces } from "./realtime-translation-core";
import { getCachedTranslation, setCachedTranslation, ultraTranslate } from "./ultra-pipeline";
import { createLinkedAbortController, runWithResilience } from "./voice-resilience";
import { azureTranslate } from "./azure-service";

const translationOpenAI = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY || process.env.OPENAI_API_KEY || "",
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});

const OPENAI_TRANSLATION_MODEL =
  process.env.OPENAI_REALTIME_TRANSLATION_MODEL ||
  process.env.OPENAI_VOICE_ASSISTANT_MODEL ||
  "gpt-4.1-mini";
// Measured 2026-11-01 for live calls: gpt-4.1-mini natural 9.1/10, first words ~0.57 s; gpt-5.4-nano 8.8, ~0.56 s.
const FALLBACK_TRANSLATION_MODEL = process.env.OPENAI_REALTIME_TRANSLATION_FALLBACK_MODEL || "gpt-5.4-nano";
let activeTranslationModel = OPENAI_TRANSLATION_MODEL;
function isModelGone(error: unknown): boolean {
  const e = error as { status?: number; code?: string; message?: string } | null;
  return e?.code === "model_not_found" || (e?.status === 404 && /model/i.test(String(e?.message ?? "")));
}
const OPENAI_TRANSLATION_MAX_TOKENS = parsePositiveInt(
  process.env.OPENAI_REALTIME_TRANSLATION_MAX_TOKENS,
  192,
);
const OPENAI_TRANSLATION_TIMEOUT_MS = parsePositiveInt(
  process.env.OPENAI_REALTIME_TRANSLATION_TIMEOUT_MS,
  8_000,
);

export interface StreamingTranslationCallbacks {
  signal?: AbortSignal;
  /**
   * "azure": translate with Azure Translator first (about 0.3-0.4 s, steady)
   * and use the OpenAI stream only if it fails. OpenAI's first token took
   * 0.6-1.5 s in our measurements, most of a live call's delay.
   */
  fastProvider?: "azure";
  onRequestStart?: () => void;
  onStreamReady?: (latencyMs: number) => void;
  onProviderSelected?: (provider: StreamingTranslationResult["provider"], streamed: boolean) => void;
  onFallback?: (reason: string) => void;
  onFirstToken?: () => void;
  onPartial?: (translatedText: string) => void;
  onSegment?: (segment: string, fullTranslatedText: string, isFinalSegment: boolean) => void;
  onFinal?: (translatedText: string) => void;
}

export interface StreamingTranslationResult {
  finalText: string;
  provider: "cache" | "azure" | "openai-stream" | "fallback";
  streamed: boolean;
}

export async function streamTranslationTokens(
  text: string,
  fromLanguage: string,
  toLanguage: string,
  callbacks: StreamingTranslationCallbacks = {},
): Promise<StreamingTranslationResult> {
  const sourceLanguage = normalizeLanguage(fromLanguage);
  const targetLanguage = normalizeLanguage(toLanguage);
  const inputText = normalizeSpaces(text);

  if (!inputText) {
    callbacks.onProviderSelected?.("cache", false);
    callbacks.onFinal?.("");
    return { finalText: "", provider: "cache", streamed: false };
  }

  if (sourceLanguage === targetLanguage) {
    callbacks.onProviderSelected?.("cache", false);
    emitImmediate(inputText, callbacks);
    return { finalText: inputText, provider: "cache", streamed: false };
  }

  const cached = getCachedTranslation(inputText, sourceLanguage, targetLanguage);
  if (cached) {
    callbacks.onProviderSelected?.("cache", false);
    emitImmediate(cached, callbacks);
    return { finalText: cached, provider: "cache", streamed: false };
  }

  if (callbacks.fastProvider === "azure") {
    try {
      callbacks.onRequestStart?.();
      const translated = normalizeSpaces(await azureTranslate(inputText, sourceLanguage, targetLanguage));
      if (callbacks.signal?.aborted) throw abortError();
      if (translated) {
        callbacks.onProviderSelected?.("azure", false);
        setCachedTranslation(inputText, sourceLanguage, targetLanguage, translated);
        emitImmediate(translated, callbacks);
        return { finalText: translated, provider: "azure", streamed: false };
      }
    } catch (error) {
      if (isAbortError(error)) throw error;
      callbacks.onFallback?.(`azure_translate_failed:${String(error).slice(0, 120)}`);
      logger.warn("StreamingTranslation", `Azure translation failed for ${sourceLanguage}->${targetLanguage}, using OpenAI: ${String(error)}`);
    }
  }

  const apiKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY || process.env.OPENAI_API_KEY;
  if (!apiKey) {
    callbacks.onFallback?.("missing_openai_api_key");
    return fallbackTranslate(inputText, sourceLanguage, targetLanguage, callbacks, "missing_openai_api_key");
  }

  const chunker = new SpeakableChunker();
  const responseBuffer: string[] = [];
  let sawFirstToken = false;
  let linkedAbort: ReturnType<typeof createLinkedAbortController> | null = null;

  try {
    callbacks.onProviderSelected?.("openai-stream", true);
    callbacks.onRequestStart?.();
    const requestStartNs = process.hrtime.bigint();
    linkedAbort = createLinkedAbortController({
      signal: callbacks.signal,
      timeoutMs: OPENAI_TRANSLATION_TIMEOUT_MS,
      label: `openai-stream ${sourceLanguage}->${targetLanguage}`,
    });
    const maxTokens = Math.max(OPENAI_TRANSLATION_MAX_TOKENS, Math.min(512, inputText.split(/\s+/).length * 4 + 24));
    const stream = await runWithResilience(
      async (signal) => {
        const request = (model: string): Promise<AsyncIterable<any>> => (translationOpenAI.chat.completions.create as any)(
          {
            model,
            stream: true,
            // gpt-5 models think first unless told not to; a live call can't wait for that.
            ...(model.startsWith("gpt-5")
              ? { reasoning_effort: "none", max_completion_tokens: maxTokens }
              : { temperature: 0, max_tokens: maxTokens }),
            messages: [
              { role: "system", content: spokenInterpreterPrompt(sourceLanguage, targetLanguage) },
              { role: "user", content: inputText },
            ],
          } as any,
          { signal } as any,
        );
        try {
          return await request(activeTranslationModel);
        } catch (error) {
          // OpenAI retires models (gpt-4.1-nano was): never let that silence calls.
          if (activeTranslationModel !== FALLBACK_TRANSLATION_MODEL && isModelGone(error)) {
            logger.error("TokenStreamingTranslation", `call translation model ${activeTranslationModel} unavailable; switching to ${FALLBACK_TRANSLATION_MODEL}`);
            activeTranslationModel = FALLBACK_TRANSLATION_MODEL;
            return await request(activeTranslationModel);
          }
          throw error;
        }
      },
      {
        provider: "openai-stream",
        operation: "translate",
        timeoutMs: OPENAI_TRANSLATION_TIMEOUT_MS,
        retries: 1,
        retryDelayMs: 200,
        signal: linkedAbort.controller.signal,
        metadata: {
          sourceLanguage,
          targetLanguage,
        },
      },
    );
    callbacks.onStreamReady?.(Number((Number(process.hrtime.bigint() - requestStartNs) / 1_000_000).toFixed(3)));

    for await (const chunk of stream) {
      if (linkedAbort.controller.signal.aborted) {
        throw abortError();
      }

      const token = chunk.choices?.[0]?.delta?.content || "";
      if (!token) continue;

      if (!sawFirstToken) {
        sawFirstToken = true;
        callbacks.onFirstToken?.();
      }

      responseBuffer.push(token);
      const partialText = normalizeSpaces(responseBuffer.join(""));
      if (partialText) {
        callbacks.onPartial?.(partialText);
      }

      const readySegments = chunker.feed(token);
      for (const ready of readySegments) {
        const segment = normalizeSpaces(ready);
        if (segment) {
          callbacks.onSegment?.(segment, partialText, false);
        }
      }
    }

    const finalText = normalizeSpaces(responseBuffer.join(""));
    const tail = normalizeSpaces(chunker.flush());

    if (!sawFirstToken && finalText) {
      callbacks.onFirstToken?.();
    }
    if (tail) {
      callbacks.onSegment?.(tail, finalText || tail, true);
    }
    callbacks.onFinal?.(finalText);

    if (finalText) {
      setCachedTranslation(inputText, sourceLanguage, targetLanguage, finalText);
    }

    return {
      finalText,
      provider: "openai-stream",
      streamed: true,
    };
  } catch (error) {
    if (isAbortError(error)) {
      throw error;
    }
    // The OpenAI SDK reports an abort as APIUserAbortError ("Request was
    // aborted."), which isAbortError() does not match. When the caller
    // cancelled (a newer partial transcript replaced this request, or the
    // listener barged in) nobody wants the result, so skip the fallback
    // translation. A timeout leaves the caller's signal untouched and still
    // falls back below.
    if (callbacks.signal?.aborted) {
      throw abortError();
    }

    logger.warn(
      "StreamingTranslation",
      `OpenAI translation stream failed for ${sourceLanguage}->${targetLanguage}: ${String(error)}`,
    );

    if (responseBuffer.length > 0) {
      const partialText = normalizeSpaces(responseBuffer.join(""));
      const tail = normalizeSpaces(chunker.flush());
      if (!sawFirstToken && partialText) {
        callbacks.onFirstToken?.();
      }
      if (tail) {
        callbacks.onSegment?.(tail, partialText || tail, true);
      }
      callbacks.onFinal?.(partialText);
      return {
        finalText: partialText,
        provider: "openai-stream",
        streamed: true,
      };
    }

    callbacks.onFallback?.(`openai_stream_failed:${String(error)}`);
    return fallbackTranslate(
      inputText,
      sourceLanguage,
      targetLanguage,
      callbacks,
      `openai_stream_failed:${String(error)}`,
    );
  } finally {
    linkedAbort?.cleanup();
  }
}

export function shouldEmitStreamingPartial(previous: string, next: string): boolean {
  const prev = normalizeSpaces(previous);
  const curr = normalizeSpaces(next);

  if (!curr || curr === prev) return false;
  if (!prev) return true;
  if (curr.length - prev.length >= 4) return true;
  return /[.,!?;:]$/.test(curr);
}

class SpeakableChunker {
  private buffer = "";

  feed(token: string): string[] {
    this.buffer += token;
    const ready: string[] = [];
    let boundary = findSpeakBoundary(this.buffer);

    while (boundary > 0) {
      const chunk = normalizeSpaces(this.buffer.slice(0, boundary));
      if (chunk) ready.push(chunk);
      this.buffer = this.buffer.slice(boundary);
      boundary = findSpeakBoundary(this.buffer);
    }

    return ready;
  }

  flush(): string {
    const tail = normalizeSpaces(this.buffer);
    this.buffer = "";
    return tail;
  }
}

async function fallbackTranslate(
  inputText: string,
  sourceLanguage: string,
  targetLanguage: string,
  callbacks: StreamingTranslationCallbacks,
  reason = "fallback_translate",
): Promise<StreamingTranslationResult> {
  callbacks.onProviderSelected?.("fallback", false);
  callbacks.onFallback?.(reason);
  const translated = normalizeSpaces(
    await ultraTranslate(inputText, sourceLanguage, targetLanguage),
  );
  emitImmediate(translated || inputText, callbacks);
  return {
    finalText: translated || inputText,
    provider: "fallback",
    streamed: false,
  };
}

function emitImmediate(text: string, callbacks: StreamingTranslationCallbacks): void {
  const clean = normalizeSpaces(text);
  if (!clean) {
    callbacks.onFinal?.("");
    return;
  }

  callbacks.onFirstToken?.();
  callbacks.onPartial?.(clean);
  callbacks.onSegment?.(clean, clean, true);
  callbacks.onFinal?.(clean);
}

function findSpeakBoundary(text: string): number {
  const punctuationMatch = text.match(/.*?[.!?;:](?:\s|$)/);
  if (punctuationMatch?.[0]) {
    return punctuationMatch[0].length;
  }

  const words = normalizeSpaces(text).split(" ").filter(Boolean);
  if (words.length >= 6) {
    const splitIndex = nthWordBoundary(text, 6);
    return splitIndex > 0 ? splitIndex : 0;
  }

  return 0;
}

function nthWordBoundary(text: string, wordIndex: number): number {
  let wordsSeen = 0;
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === " ") {
      wordsSeen += 1;
      if (wordsSeen >= wordIndex) return i + 1;
    }
  }
  return 0;
}

/**
 * People on a call talk like people, not like a textbook. Measured 2026-11-01 (9 everyday call sentences,
 * Telugu<->English, blind native-speaker judge): this prompt on gpt-4.1-mini scored 9.6/10 for sounding
 * natural vs 6.7 for Azure Translator ("works for me" -> "పనిచేస్తుంది"), at ~0.4 s more delay.
 */
export function spokenInterpreterPrompt(sourceLanguage: string, targetLanguage: string): string {
  const from = languageLabel(sourceLanguage);
  const to = languageLabel(targetLanguage);
  const english = targetLanguage === "en";
  return (
    `You are the live voice interpreter in a phone call between two people. Translate what was just said from ${from} into ${to} ` +
    `exactly the way a young native ${to} speaker would say it out loud on a call: everyday spoken words, short, warm, same tone. ` +
    (english
      ? ""
      : `Keep the English words people actually mix into everyday ${to} (office, traffic, location, weekend, OK, sorry, phone, call, tension), written in ${to} script. ` +
        `Never use bookish, formal or Sanskrit-heavy words. Always write in ${to} script, never in English letters. `) +
    `Keep people's names exactly as said. Say numbers and times the natural way. ` +
    `Reply with only what the interpreter says: no quotes, labels, explanations or answers.`
  );
}

function languageLabel(language: string): string {
  const labels: Record<string, string> = {
    en: "English",
    hi: "Hindi",
    te: "Telugu",
    ta: "Tamil",
    kn: "Kannada",
    ml: "Malayalam",
    mr: "Marathi",
    bn: "Bengali",
    gu: "Gujarati",
    pa: "Punjabi",
    ur: "Urdu",
    es: "Spanish",
    fr: "French",
    de: "German",
    ja: "Japanese",
    ko: "Korean",
    zh: "Chinese",
    ar: "Arabic",
    pt: "Portuguese",
    ru: "Russian",
    it: "Italian",
  };
  return labels[language] || "English";
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(String(value || ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && (
    error.message === "This operation was aborted" ||
    error.name === "AbortError"
  );
}

function abortError(): Error {
  const error = new Error("This operation was aborted");
  error.name = "AbortError";
  return error;
}
