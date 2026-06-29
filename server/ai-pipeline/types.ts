/**
 * Unified AI Pipeline Type Definitions
 *
 * Provider-agnostic interfaces for STT, TTS, Translation, and Sentiment.
 * All AI features route through these interfaces — swap providers via env vars.
 */

export type SupportedLanguage =
  | "hi" | "te" | "ta" | "kn" | "ml" | "mr" | "gu" | "pa" | "bn" | "or"
  | "en" | "en-IN" | "fr" | "de" | "es" | "ar" | "zh" | "ja" | "ko" | "pt";

export type STTProvider = "openai" | "azure" | "elevenlabs" | "google" | "deepgram";
export type TTSProvider = "openai" | "azure" | "elevenlabs" | "google";
export type TranslationProvider = "google" | "azure" | "openai" | "deepl";

export interface STTRequest {
  audio: Buffer;
  mimeType: "audio/wav" | "audio/webm" | "audio/pcm" | "audio/ogg";
  language?: SupportedLanguage;
  sampleRateHz?: number;
  punctuate?: boolean;
  profanityFilter?: boolean;
  callId?: string;
}

export interface STTResult {
  transcript: string;
  confidence: number;
  language: SupportedLanguage | null;
  durationSeconds: number;
  words?: Array<{ word: string; startMs: number; endMs: number; confidence: number }>;
  provider: STTProvider;
  latencyMs: number;
}

export interface TTSRequest {
  text: string;
  language: SupportedLanguage;
  voiceId?: string;
  speedRate?: number;
  outputFormat?: "mp3" | "pcm" | "wav" | "ogg";
  callId?: string;
}

export interface TTSResult {
  audio: Buffer;
  mimeType: string;
  durationSeconds?: number;
  provider: TTSProvider;
  latencyMs: number;
}

export interface TranslationRequest {
  text: string;
  fromLanguage: SupportedLanguage | "auto";
  toLanguage: SupportedLanguage;
  domain?: "general" | "medical" | "legal" | "business";
  callId?: string;
}

export interface TranslationResult {
  translatedText: string;
  detectedLanguage?: SupportedLanguage;
  confidence: number;
  provider: TranslationProvider;
  latencyMs: number;
}

export interface SentimentResult {
  sentiment: "positive" | "negative" | "neutral" | "mixed";
  score: number;
  anger: number;
  joy: number;
  sadness: number;
  fear: number;
  provider: string;
}

export interface CallSummaryRequest {
  transcript: string;
  language: SupportedLanguage;
  agentName?: string;
  customerName?: string;
  callDurationSeconds?: number;
}

export interface CallSummaryResult {
  summary: string;
  keyPoints: string[];
  actionItems: string[];
  sentiment: SentimentResult;
  topics: string[];
  language: SupportedLanguage;
  provider: string;
  latencyMs: number;
}

export interface AIProviderHealth {
  provider: string;
  healthy: boolean;
  latencyMs?: number;
  message?: string;
}

export interface ISTTProvider {
  readonly name: STTProvider;
  isAvailable(): boolean;
  transcribe(req: STTRequest): Promise<STTResult>;
  healthCheck(): Promise<AIProviderHealth>;
}

export interface ITTSProvider {
  readonly name: TTSProvider;
  isAvailable(): boolean;
  synthesize(req: TTSRequest): Promise<TTSResult>;
  listVoices(language?: SupportedLanguage): Promise<Array<{ id: string; name: string; gender: "male" | "female" | "neutral" }>>;
  healthCheck(): Promise<AIProviderHealth>;
}

export interface ITranslationProvider {
  readonly name: TranslationProvider;
  isAvailable(): boolean;
  translate(req: TranslationRequest): Promise<TranslationResult>;
  getSupportedPairs(): Array<{ from: SupportedLanguage | "auto"; to: SupportedLanguage }>;
  healthCheck(): Promise<AIProviderHealth>;
}
