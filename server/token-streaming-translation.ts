import OpenAI from "openai";
import { logger } from "./observability";
import { normalizeLanguage, normalizeSpaces } from "./realtime-translation-core";
import { getCachedTranslation, setCachedTranslation, ultraTranslate } from "./ultra-pipeline";
import { createLinkedAbortController, runWithResilience } from "./voice-resilience";

const translationOpenAI = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY || process.env.OPENAI_API_KEY || "",
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});

const OPENAI_TRANSLATION_MODEL =
  process.env.OPENAI_REALTIME_TRANSLATION_MODEL ||
  process.env.OPENAI_VOICE_ASSISTANT_MODEL ||
  "gpt-4.1-mini";
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
  provider: "cache" | "openai-stream" | "fallback";
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
    const stream = await runWithResilience(
      async (signal) => translationOpenAI.chat.completions.create(
        {
          model: OPENAI_TRANSLATION_MODEL,
          stream: true,
          temperature: 0,
          max_tokens: Math.max(
            OPENAI_TRANSLATION_MAX_TOKENS,
            Math.min(512, inputText.split(/\s+/).length * 4 + 24),
          ),
          messages: [
            {
              role: "system",
              content:
                `You are a live interpreter for a real-time voice call. Translate only from ${languageLabel(sourceLanguage)} to ${languageLabel(targetLanguage)}. ` +
                `Return only the translated spoken text in ${languageLabel(targetLanguage)}. ` +
                `Do not explain, do not answer, do not add quotes, labels, or commentary. Preserve intent, tone, and brevity.`,
            },
            {
              role: "user",
              content: inputText,
            },
          ],
        },
        {
          signal,
        } as any,
      ),
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
