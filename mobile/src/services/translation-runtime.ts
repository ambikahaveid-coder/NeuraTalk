import { TranslationEntry } from '../types';
import {
  normalizeLanguageCode,
  supportsRealtimeTranslation,
} from '../config/languages';
import {
  realtimeTranslationService,
  TranslationSessionDecision,
  TranscriptEvaluationResult,
} from './stt-translation-service';
import { translationLogger } from './translation-logger';

export const SUPPORTED_TRANSLATION_LANGUAGES = new Set(
  ['auto', ...Array.from(new Set(['en', 'hi', 'te']))].filter((code) => supportsRealtimeTranslation(code)),
);

export type TranslationMode =
  | 'active'
  | 'disabled_same_language'
  | 'disabled_unsupported'
  | 'disabled_requested_off'
  | 'best_effort_mixed';

export interface TranslationDecision {
  enabled: boolean;
  sourceLanguage: string;
  targetLanguage: string;
  mode: TranslationMode;
  warning?: string;
}

export interface TranscriptEvaluationInput {
  text?: string | null;
  confidence?: number | null;
  isFinal?: boolean;
  sourceLanguage?: string | null;
  targetLanguage?: string | null;
  translationEnabled: boolean;
}

export interface TranscriptEvaluation {
  shouldTranslate: boolean;
  isStable: boolean;
  mixedLanguage: boolean;
  warning?: string;
}

export interface TranslationMetric {
  event: 'transcript_ignored' | 'translation_started' | 'translation_completed' | 'translation_failed';
  timestamp: number;
  callId?: string;
  latencyMs?: number;
  confidence?: number;
  reason?: string;
  mixedLanguage?: boolean;
}

function mapDecision(decision: TranslationSessionDecision): TranslationDecision {
  if (decision.mode === 'active') {
    return { ...decision, mode: 'active' };
  }
  if (decision.mode === 'best_effort') {
    return { ...decision, mode: 'best_effort_mixed' };
  }
  if (decision.mode === 'fallback') {
    return { ...decision, mode: 'disabled_unsupported' };
  }
  if (!decision.enabled && decision.warning?.includes('same language')) {
    return { ...decision, mode: 'disabled_same_language' };
  }
  if (!decision.enabled && !decision.warning) {
    return { ...decision, mode: 'disabled_requested_off' };
  }
  return { ...decision, mode: 'disabled_unsupported' };
}

function mapEvaluation(result: TranscriptEvaluationResult): TranscriptEvaluation {
  return {
    shouldTranslate: result.shouldTranslate,
    isStable: result.confidenceAccepted,
    mixedLanguage: result.mixedLanguage,
    warning: result.warning,
  };
}

export function detectMixedLanguageText(text: string): boolean {
  return realtimeTranslationService.normalizeTranscriptEvent(
    { text, confidence: 1, isFinal: true },
    { sourceLanguage: 'auto', targetLanguage: 'en' },
  )?.mixedLanguage ?? false;
}

export function resolveTranslationDecision(
  requestedEnabled: boolean,
  sourceLanguage?: string | null,
  targetLanguage?: string | null,
): TranslationDecision {
  return mapDecision(realtimeTranslationService.createSession({
    requestedEnabled,
    sourceLanguage: normalizeLanguageCode(sourceLanguage),
    targetLanguage: normalizeLanguageCode(targetLanguage),
  }));
}

export function evaluateTranscriptForTranslation(input: TranscriptEvaluationInput): TranscriptEvaluation {
  const normalized = realtimeTranslationService.normalizeTranscriptEvent({
    text: input.text,
    confidence: input.confidence,
    isFinal: input.isFinal,
    sourceLanguage: input.sourceLanguage,
    targetLanguage: input.targetLanguage,
  }, {
    sourceLanguage: input.sourceLanguage || 'auto',
    targetLanguage: input.targetLanguage || 'en',
  });

  if (!normalized) {
    return { shouldTranslate: false, isStable: false, mixedLanguage: false };
  }

  return mapEvaluation(realtimeTranslationService.evaluateTranscript(normalized, input.translationEnabled));
}

export function deriveLatencyState(latencyMs?: number | null): 'ready' | 'translating' | 'unavailable' {
  return realtimeTranslationService.deriveLatencyState(latencyMs);
}

export function buildTranslationEntry(message: {
  speaker: 'me' | 'them';
  originalText: string;
  translatedText: string;
  sourceLanguage: string;
  targetLanguage: string;
  emotion?: string;
  confidence?: number;
  latencyMs?: number;
}): TranslationEntry | null {
  const normalized = realtimeTranslationService.normalizeTranslationEvent(message, {
    sourceLanguage: message.sourceLanguage,
    targetLanguage: message.targetLanguage,
  }, null);
  return normalized ? realtimeTranslationService.toTranslationEntry(normalized) : null;
}

export function logTranslationMetric(metric: TranslationMetric): void {
  if (metric.event === 'translation_failed') {
    translationLogger.warn(metric.event, metric);
  } else {
    translationLogger.info(metric.event, metric);
  }
}

export function getRecentTranslationMetrics(): TranslationMetric[] {
  return translationLogger.recent().map((entry) => ({
    event: entry.event as TranslationMetric['event'],
    timestamp: entry.timestamp,
    callId: entry.callId,
    latencyMs: entry.latencyMs,
    confidence: entry.confidence,
    reason: entry.reason,
    mixedLanguage: Boolean(entry.metadata?.mixedLanguage),
  }));
}
