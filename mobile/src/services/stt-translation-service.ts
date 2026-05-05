import { TranslationEntry } from '../types';
import {
  getLanguageName,
  normalizeLanguageCode,
  resolveLanguageFallback,
  supportsRealtimeTranslation,
  supportsSpeechRecognition,
} from '../config/languages';
import { translationLogger } from './translation-logger';

export interface TranslationSessionConfig {
  requestedEnabled: boolean;
  sourceLanguage: string;
  targetLanguage: string;
}

export interface TranslationSessionDecision {
  enabled: boolean;
  sourceLanguage: string;
  targetLanguage: string;
  fallbackLanguage?: string;
  warning?: string;
  mode: 'active' | 'disabled' | 'fallback' | 'best_effort';
}

export interface NormalizedTranscriptEvent {
  type: 'transcript';
  text: string;
  confidence: number;
  isFinal: boolean;
  sourceLanguage: string;
  targetLanguage: string;
  provider: string;
  mixedLanguage: boolean;
}

export interface NormalizedTranslationEvent {
  type: 'translation';
  speaker: 'me' | 'them';
  originalText: string;
  translatedText: string;
  sourceLanguage: string;
  targetLanguage: string;
  confidence: number;
  latencyMs?: number;
  provider: string;
  mixedLanguage: boolean;
}

export interface TranslationFailureEvent {
  type: 'failure';
  reason: string;
  provider: string;
  latencyMs?: number;
}

export interface TranscriptEvaluationResult {
  shouldTranslate: boolean;
  shouldDisplayListening: boolean;
  confidenceAccepted: boolean;
  mixedLanguage: boolean;
  warning?: string;
}

const PARTIAL_MIN_WORDS = 3;
const PARTIAL_CONFIDENCE_THRESHOLD = 0.72;
const FINAL_CONFIDENCE_THRESHOLD = 0.55;
const SLOW_TRANSLATION_MS = 2000;
const DEGRADED_TRANSLATION_MS = 3000;

function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function detectMixedLanguage(text: string): boolean {
  if (!text.trim()) {
    return false;
  }

  const hasTeluguScript = /[\u0C00-\u0C7F]/.test(text);
  const hasDevanagari = /[\u0900-\u097F]/.test(text);
  const hasLatin = /[A-Za-z]/.test(text);

  if ((hasTeluguScript || hasDevanagari) && hasLatin) {
    return true;
  }

  const lowered = text.toLowerCase();
  const hybridMarkers = ['anna', 'nahi', 'please', 'call', 'matlad', 'acha', 'thanks'];
  return hybridMarkers.filter((token) => lowered.includes(token)).length >= 2;
}

function safeConfidence(value: unknown): number {
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric)) {
    return 0;
  }
  return Math.max(0, Math.min(1, numeric));
}

export class RealtimeTranslationService {
  createSession(config: TranslationSessionConfig): TranslationSessionDecision {
    const sourceLanguage = normalizeLanguageCode(config.sourceLanguage);
    const targetLanguage = normalizeLanguageCode(config.targetLanguage);

    if (!config.requestedEnabled) {
      return {
        enabled: false,
        sourceLanguage,
        targetLanguage,
        mode: 'disabled',
      };
    }

    if (sourceLanguage !== 'auto' && targetLanguage !== 'auto' && sourceLanguage === targetLanguage) {
      return {
        enabled: false,
        sourceLanguage,
        targetLanguage,
        mode: 'disabled',
        warning: 'Both participants are using the same language. Translation is paused.',
      };
    }

    const sourceSupported = supportsSpeechRecognition(sourceLanguage);
    const targetSupported = supportsRealtimeTranslation(targetLanguage);
    if (!sourceSupported || !targetSupported) {
      const fallbackLanguage = resolveLanguageFallback(targetLanguage, [sourceLanguage]);
      return {
        enabled: sourceSupported && supportsRealtimeTranslation(fallbackLanguage),
        sourceLanguage,
        targetLanguage: fallbackLanguage,
        fallbackLanguage,
        mode: 'fallback',
        warning: `Realtime translation is unavailable for ${getLanguageName(targetLanguage)}. Falling back to ${getLanguageName(fallbackLanguage)}.`,
      };
    }

    if (sourceLanguage === 'auto' || targetLanguage === 'auto') {
      return {
        enabled: true,
        sourceLanguage,
        targetLanguage,
        mode: 'best_effort',
        warning: 'Language detection is running in best-effort mode.',
      };
    }

    return {
      enabled: true,
      sourceLanguage,
      targetLanguage,
      mode: 'active',
    };
  }

  normalizeTranscriptEvent(raw: any, defaults: { sourceLanguage: string; targetLanguage: string }): NormalizedTranscriptEvent | null {
    const text = String(raw?.text || raw?.originalText || '').trim();
    if (!text) {
      return null;
    }

    return {
      type: 'transcript',
      text,
      confidence: safeConfidence(raw?.confidence),
      isFinal: raw?.type === 'transcript.final' || raw?.isFinal === true,
      sourceLanguage: normalizeLanguageCode(raw?.sourceLanguage || defaults.sourceLanguage),
      targetLanguage: normalizeLanguageCode(raw?.targetLanguage || defaults.targetLanguage),
      provider: String(raw?.provider || 'backend_realtime'),
      mixedLanguage: detectMixedLanguage(text),
    };
  }

  evaluateTranscript(event: NormalizedTranscriptEvent, translationEnabled: boolean): TranscriptEvaluationResult {
    if (!translationEnabled) {
      return {
        shouldTranslate: false,
        shouldDisplayListening: false,
        confidenceAccepted: false,
        mixedLanguage: event.mixedLanguage,
      };
    }

    if (!event.isFinal) {
      const stableEnough = wordCount(event.text) >= PARTIAL_MIN_WORDS && event.confidence >= PARTIAL_CONFIDENCE_THRESHOLD;
      return {
        shouldTranslate: false,
        shouldDisplayListening: true,
        confidenceAccepted: stableEnough,
        mixedLanguage: event.mixedLanguage,
        warning: stableEnough ? 'Translating...' : undefined,
      };
    }

    if (event.confidence < FINAL_CONFIDENCE_THRESHOLD) {
      return {
        shouldTranslate: false,
        shouldDisplayListening: true,
        confidenceAccepted: false,
        mixedLanguage: event.mixedLanguage,
        warning: 'Speech confidence is low. Waiting for a clearer phrase.',
      };
    }

    return {
      shouldTranslate: true,
      shouldDisplayListening: true,
      confidenceAccepted: true,
      mixedLanguage: event.mixedLanguage,
      warning: event.mixedLanguage ? 'Mixed language detected. Using best-effort translation.' : undefined,
    };
  }

  normalizeTranslationEvent(raw: any, defaults: { sourceLanguage: string; targetLanguage: string }, startedAt?: number | null): NormalizedTranslationEvent | null {
    const translatedText = String(raw?.translatedText || raw?.translated || '').trim();
    if (!translatedText) {
      return null;
    }

    const originalText = String(raw?.originalText || raw?.original || raw?.text || '').trim();
    const latencyMs = typeof raw?.latencyMs === 'number'
      ? raw.latencyMs
      : startedAt
        ? Date.now() - startedAt
        : undefined;

    return {
      type: 'translation',
      speaker: raw?.speaker === 'them' ? 'them' : 'me',
      originalText,
      translatedText,
      sourceLanguage: normalizeLanguageCode(raw?.sourceLanguage || defaults.sourceLanguage),
      targetLanguage: normalizeLanguageCode(raw?.targetLanguage || defaults.targetLanguage),
      confidence: safeConfidence(raw?.confidence),
      latencyMs,
      provider: String(raw?.provider || 'backend_realtime'),
      mixedLanguage: detectMixedLanguage(originalText),
    };
  }

  toTranslationEntry(event: NormalizedTranslationEvent): TranslationEntry {
    return {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`,
      speaker: event.speaker,
      originalText: event.originalText,
      translatedText: event.translatedText,
      sourceLanguage: event.sourceLanguage,
      targetLanguage: event.targetLanguage,
      timestamp: Date.now(),
      confidence: event.confidence,
      latencyMs: event.latencyMs,
      mixedLanguage: event.mixedLanguage,
    };
  }

  deriveLatencyState(latencyMs?: number | null): 'ready' | 'translating' | 'unavailable' {
    if (latencyMs == null) {
      return 'ready';
    }
    if (latencyMs > DEGRADED_TRANSLATION_MS) {
      return 'unavailable';
    }
    if (latencyMs > SLOW_TRANSLATION_MS) {
      return 'translating';
    }
    return 'ready';
  }

  normalizeFailureEvent(raw: any): TranslationFailureEvent {
    return {
      type: 'failure',
      reason: String(raw?.reason || raw?.message || 'Translation pipeline failed'),
      provider: String(raw?.provider || 'backend_realtime'),
      latencyMs: typeof raw?.latencyMs === 'number' ? raw.latencyMs : undefined,
    };
  }

  log(event: 'session' | 'transcript' | 'translation' | 'failure', details: {
    callId?: string;
    sourceLanguage?: string;
    targetLanguage?: string;
    latencyMs?: number;
    confidence?: number;
    provider?: string;
    reason?: string;
    metadata?: Record<string, unknown>;
    level?: 'info' | 'warn' | 'error';
  }): void {
    const languagePair = details.sourceLanguage && details.targetLanguage
      ? `${details.sourceLanguage}->${details.targetLanguage}`
      : undefined;

    const loggerPayload = {
      callId: details.callId,
      languagePair,
      latencyMs: details.latencyMs,
      confidence: details.confidence,
      provider: details.provider,
      reason: details.reason,
      metadata: details.metadata,
    };

    if (details.level === 'error') {
      translationLogger.error(event, loggerPayload);
    } else if (details.level === 'warn') {
      translationLogger.warn(event, loggerPayload);
    } else {
      translationLogger.info(event, loggerPayload);
    }
  }
}

export const realtimeTranslationService = new RealtimeTranslationService();
