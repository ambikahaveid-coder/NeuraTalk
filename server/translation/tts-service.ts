import type { ListenerTranslationMode } from "./translation-service";

export type TtsDeliveryMode = "session_injected" | "remote_only";

export interface TtsReadyEventInput {
  sourceIdentity: string;
  targetIdentity: string;
  sourceLanguage: string;
  targetLanguage: string;
  translatedText: string;
  latencyMs?: number;
  deliveryMode?: TtsDeliveryMode;
  replaceOriginalVoice?: boolean;
  translationMode: ListenerTranslationMode;
  audioUrl?: string | null;
}

export interface TtsFailedEventInput {
  sourceIdentity: string;
  targetIdentity: string;
  translatedText?: string;
  reason: string;
  latencyMs?: number;
  translationMode: ListenerTranslationMode;
}

export function buildTtsReadyEvent(input: TtsReadyEventInput) {
  return {
    type: "tts_ready",
    sourceIdentity: input.sourceIdentity,
    targetIdentity: input.targetIdentity,
    sourceLanguage: input.sourceLanguage,
    targetLanguage: input.targetLanguage,
    translatedText: input.translatedText,
    latencyMs: input.latencyMs,
    audioUrl: input.audioUrl || undefined,
    deliveryMode: input.deliveryMode || "session_injected",
    replaceOriginalVoice: input.replaceOriginalVoice === true,
    translationMode: input.translationMode,
  };
}

export function buildTtsFailedEvent(input: TtsFailedEventInput) {
  return {
    type: "tts_failed",
    sourceIdentity: input.sourceIdentity,
    targetIdentity: input.targetIdentity,
    translatedText: input.translatedText,
    reason: input.reason,
    latencyMs: input.latencyMs,
    translationMode: input.translationMode,
  };
}
