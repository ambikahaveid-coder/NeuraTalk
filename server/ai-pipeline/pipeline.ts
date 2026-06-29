/**
 * AI Pipeline — Unified provider router with fallback
 *
 * Routes STT/TTS/Translation requests to the best available provider.
 * Handles provider selection, fallback chains, and latency tracking.
 *
 * Provider selection via env vars:
 *   AI_STT_PROVIDER=openai|azure|elevenlabs     (default: openai)
 *   AI_TTS_PROVIDER=openai|azure|elevenlabs     (default: openai)
 *   AI_TRANSLATION_PROVIDER=google|openai|azure (default: openai)
 */

import { logger } from "../observability";
import { OpenAISTTProvider } from "./stt/openai-stt";
import { AzureSTTProvider } from "./stt/azure-stt";
import { GoogleTranslateProvider } from "./translation/google-translate";
import { OpenAITranslateProvider } from "./translation/openai-translate";
import type {
  ISTTProvider, ITTSProvider, ITranslationProvider,
  STTRequest, STTResult,
  TTSRequest, TTSResult,
  TranslationRequest, TranslationResult,
  CallSummaryRequest, CallSummaryResult,
  SentimentResult, AIProviderHealth,
} from "./types";
import OpenAI from "openai";
import { getOpenAIKey, hasWorkingOpenAIKey } from "../openai-config";

function preferredSTT(): string {
  return process.env.AI_STT_PROVIDER?.trim() || "openai";
}
function preferredTranslation(): string {
  return process.env.AI_TRANSLATION_PROVIDER?.trim() || "openai";
}

class AIPipeline {
  private sttProviders: Map<string, ISTTProvider> = new Map();
  private translationProviders: Map<string, ITranslationProvider> = new Map();

  constructor() {
    this.sttProviders.set("openai", new OpenAISTTProvider());
    this.sttProviders.set("azure", new AzureSTTProvider());
    this.translationProviders.set("google", new GoogleTranslateProvider());
    this.translationProviders.set("openai", new OpenAITranslateProvider());
  }

  /**
   * Transcribe audio — tries preferred provider, falls back to next available.
   */
  async transcribe(req: STTRequest): Promise<STTResult> {
    const order: string[] = [preferredSTT(), "openai", "azure"].filter((v, i, a) => a.indexOf(v) === i);

    for (const name of order) {
      const provider = this.sttProviders.get(name);
      if (!provider?.isAvailable()) continue;
      try {
        const result = await provider.transcribe(req);
        logger.debug("AIPipeline", `STT[${name}] '${result.transcript.slice(0, 60)}' ${result.latencyMs}ms`);
        return result;
      } catch (err) {
        logger.warn("AIPipeline", `STT[${name}] failed: ${err} — trying next provider`);
      }
    }
    throw new Error("All STT providers failed or unavailable");
  }

  /**
   * Translate text — tries preferred provider, falls back to next available.
   */
  async translate(req: TranslationRequest): Promise<TranslationResult> {
    const order: string[] = [preferredTranslation(), "google", "openai"].filter((v, i, a) => a.indexOf(v) === i);

    for (const name of order) {
      const provider = this.translationProviders.get(name);
      if (!provider?.isAvailable()) continue;
      try {
        const result = await provider.translate(req);
        logger.debug("AIPipeline", `Translation[${name}] ${req.fromLanguage}→${req.toLanguage} ${result.latencyMs}ms`);
        return result;
      } catch (err) {
        logger.warn("AIPipeline", `Translation[${name}] failed: ${err} — trying next provider`);
      }
    }
    throw new Error("All translation providers failed or unavailable");
  }

  /**
   * Synthesize speech using OpenAI TTS-1 or TTS-1-HD.
   * ElevenLabs/Azure TTS will be wired when those providers are added.
   */
  async synthesize(req: TTSRequest): Promise<TTSResult> {
    if (!hasWorkingOpenAIKey()) {
      throw new Error("No TTS provider available — OPENAI_API_KEY not set");
    }
    const start = Date.now();
    const client = new OpenAI({ apiKey: getOpenAIKey() || "" });

    const voice = this.pickTTSVoice(req.language, req.voiceId);
    const model = process.env.AI_TTS_HD === "true" ? "tts-1-hd" : "tts-1";

    const response = await client.audio.speech.create({
      model,
      voice,
      input: req.text,
      response_format: req.outputFormat === "pcm" ? "pcm" : "mp3",
      speed: req.speedRate || 1.0,
    });

    const audio = Buffer.from(await response.arrayBuffer());
    const latencyMs = Date.now() - start;

    return {
      audio,
      mimeType: req.outputFormat === "pcm" ? "audio/pcm" : "audio/mpeg",
      provider: "openai",
      latencyMs,
    };
  }

  private pickTTSVoice(
    language: string,
    explicit?: string,
  ): "alloy" | "echo" | "fable" | "onyx" | "nova" | "shimmer" {
    if (explicit) return explicit as any;
    // For Indian languages, nova has the best accent handling in Whisper TTS
    const indianLangs = ["hi", "te", "ta", "kn", "ml", "mr", "gu", "pa", "bn", "en-IN"];
    return indianLangs.includes(language) ? "nova" : "alloy";
  }

  /**
   * Generate call summary + action items using GPT-4o-mini.
   */
  async summarizeCall(req: CallSummaryRequest): Promise<CallSummaryResult> {
    if (!hasWorkingOpenAIKey()) {
      throw new Error("OPENAI_API_KEY not set — cannot summarize");
    }
    const start = Date.now();
    const client = new OpenAI({ apiKey: getOpenAIKey() || "" });

    const contextInfo = [
      req.agentName ? `Agent: ${req.agentName}` : null,
      req.customerName ? `Customer: ${req.customerName}` : null,
      req.callDurationSeconds ? `Duration: ${Math.round(req.callDurationSeconds / 60)}m` : null,
    ].filter(Boolean).join(", ");

    const systemPrompt = `You are a call center AI analyst. Analyze the call transcript and respond with ONLY valid JSON in this exact format:
{
  "summary": "2-3 sentence summary",
  "keyPoints": ["point1", "point2"],
  "actionItems": ["action1", "action2"],
  "sentiment": { "sentiment": "positive|negative|neutral|mixed", "score": 0.8, "anger": 0.1, "joy": 0.7, "sadness": 0.1, "fear": 0.0 },
  "topics": ["topic1", "topic2"]
}`;

    const completion = await client.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.1,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: `${contextInfo ? `Context: ${contextInfo}\n\n` : ""}Transcript:\n${req.transcript}`,
        },
      ],
    });

    const latencyMs = Date.now() - start;
    let parsed: any = {};
    try {
      parsed = JSON.parse(completion.choices[0]?.message?.content || "{}");
    } catch {
      logger.warn("AIPipeline", "Failed to parse call summary JSON");
    }

    return {
      summary: parsed.summary || "",
      keyPoints: Array.isArray(parsed.keyPoints) ? parsed.keyPoints : [],
      actionItems: Array.isArray(parsed.actionItems) ? parsed.actionItems : [],
      sentiment: parsed.sentiment || { sentiment: "neutral", score: 0.5, anger: 0, joy: 0, sadness: 0, fear: 0, provider: "openai" },
      topics: Array.isArray(parsed.topics) ? parsed.topics : [],
      language: req.language,
      provider: "openai",
      latencyMs,
    };
  }

  /**
   * Quick sentiment analysis without full summary.
   */
  async analyzeSentiment(text: string): Promise<SentimentResult> {
    if (!hasWorkingOpenAIKey()) {
      return { sentiment: "neutral", score: 0.5, anger: 0, joy: 0, sadness: 0, fear: 0, provider: "none" };
    }
    const client = new OpenAI({ apiKey: getOpenAIKey() || "" });
    const completion = await client.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: 'Analyze sentiment of the text. Respond ONLY with JSON: {"sentiment":"positive|negative|neutral|mixed","score":0.8,"anger":0.0,"joy":0.8,"sadness":0.0,"fear":0.0}',
        },
        { role: "user", content: text.slice(0, 2000) },
      ],
    });
    try {
      const r = JSON.parse(completion.choices[0]?.message?.content || "{}");
      return { ...r, provider: "openai" };
    } catch {
      return { sentiment: "neutral", score: 0.5, anger: 0, joy: 0, sadness: 0, fear: 0, provider: "openai" };
    }
  }

  async healthCheck(): Promise<Record<string, AIProviderHealth>> {
    const results: Record<string, AIProviderHealth> = {};
    const checks = [
      ...Array.from(this.sttProviders.values()).map((p) => p.healthCheck().then((r) => { results[`stt_${p.name}`] = r; })),
      ...Array.from(this.translationProviders.values()).map((p) => p.healthCheck().then((r) => { results[`tr_${p.name}`] = r; })),
    ];
    await Promise.allSettled(checks);
    return results;
  }
}

let _pipeline: AIPipeline | null = null;

export function getAIPipeline(): AIPipeline {
  if (!_pipeline) _pipeline = new AIPipeline();
  return _pipeline;
}

export type { STTRequest, STTResult, TTSRequest, TTSResult, TranslationRequest, TranslationResult, CallSummaryRequest, CallSummaryResult };
