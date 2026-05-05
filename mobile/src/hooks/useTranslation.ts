import { useCallback, useMemo, useRef, useState } from 'react';
import { CallState } from '../types';
import { realtimeTranslationService } from '../services/stt-translation-service';

export interface TranslationHookState {
  myLanguage: string;
  theirLanguage: string;
  translationEnabled: boolean;
  translationStatus: NonNullable<CallState['translationStatus']>;
  translationWarning?: string;
  translationLatencyMs?: number;
  translationConfidence?: number;
  mixedLanguageDetected?: boolean;
  translations: CallState['translations'];
}

export interface UseTranslationOptions {
  initialMyLanguage?: string;
  initialTheirLanguage?: string;
  initialEnabled?: boolean;
}

const initialDefaults: TranslationHookState = {
  myLanguage: 'en',
  theirLanguage: 'auto',
  translationEnabled: true,
  translationStatus: 'idle',
  translations: [],
};

export function useTranslation(options: UseTranslationOptions = {}) {
  const requestedEnabledRef = useRef(options.initialEnabled ?? true);
  const pendingTranslationStartedAtRef = useRef<number | null>(null);
  const sourceLanguageRef = useRef(options.initialMyLanguage || initialDefaults.myLanguage);
  const targetLanguageRef = useRef(options.initialTheirLanguage || initialDefaults.theirLanguage);

  const [state, setState] = useState<TranslationHookState>({
    ...initialDefaults,
    myLanguage: options.initialMyLanguage || initialDefaults.myLanguage,
    theirLanguage: options.initialTheirLanguage || initialDefaults.theirLanguage,
    translationEnabled: options.initialEnabled ?? initialDefaults.translationEnabled,
  });

  const applyDecision = useCallback((sourceLanguage: string, targetLanguage: string, requestedEnabled: boolean) => {
    const decision = realtimeTranslationService.createSession({
      requestedEnabled,
      sourceLanguage,
      targetLanguage,
    });
    sourceLanguageRef.current = decision.sourceLanguage;
    targetLanguageRef.current = decision.targetLanguage;

    setState((prev) => ({
      ...prev,
      myLanguage: decision.sourceLanguage,
      theirLanguage: decision.targetLanguage,
      translationEnabled: decision.enabled,
      translationStatus: decision.enabled ? 'idle' : 'disabled',
      translationWarning: decision.warning,
      translationLatencyMs: undefined,
      translationConfidence: undefined,
      mixedLanguageDetected: decision.mode === 'best_effort',
    }));

    return decision;
  }, []);

  const setLanguages = useCallback((sourceLanguage: string, targetLanguage: string) => {
    return applyDecision(sourceLanguage, targetLanguage, requestedEnabledRef.current);
  }, [applyDecision]);

  const setTranslationRequested = useCallback((enabled: boolean) => {
    requestedEnabledRef.current = enabled;
    return applyDecision(sourceLanguageRef.current, targetLanguageRef.current, enabled);
  }, [applyDecision]);

  const prepareForCall = useCallback(() => {
    pendingTranslationStartedAtRef.current = null;
    return applyDecision(sourceLanguageRef.current, targetLanguageRef.current, requestedEnabledRef.current);
  }, [applyDecision]);

  const reset = useCallback(() => {
    pendingTranslationStartedAtRef.current = null;
    setState((prev) => ({
      ...prev,
      translationStatus: prev.translationEnabled ? 'idle' : 'disabled',
      translationWarning: undefined,
      translationLatencyMs: undefined,
      translationConfidence: undefined,
      mixedLanguageDetected: false,
      translations: [],
    }));
  }, []);

  const markListening = useCallback(() => {
    setState((prev) => ({
      ...prev,
      translationStatus: prev.translationEnabled ? 'listening' : 'disabled',
    }));
  }, []);

  const handleRealtimeEvent = useCallback((message: any, callId?: string): boolean => {
    if (message?.type === 'transcript.partial' || message?.type === 'transcript.final') {
      const normalized = realtimeTranslationService.normalizeTranscriptEvent(message, {
        sourceLanguage: state.myLanguage,
        targetLanguage: state.theirLanguage,
      });
      if (!normalized) {
        return true;
      }

      const evaluation = realtimeTranslationService.evaluateTranscript(normalized, state.translationEnabled);
      if (!evaluation.shouldTranslate) {
        setState((prev) => ({
          ...prev,
          translationStatus: prev.translationEnabled
            ? (evaluation.shouldDisplayListening ? 'listening' : prev.translationStatus)
            : 'disabled',
          translationWarning: evaluation.warning,
          translationConfidence: normalized.confidence || prev.translationConfidence,
          mixedLanguageDetected: evaluation.mixedLanguage,
        }));

        if (normalized.isFinal && !evaluation.confidenceAccepted) {
          realtimeTranslationService.log('transcript', {
            level: 'warn',
            callId,
            sourceLanguage: normalized.sourceLanguage,
            targetLanguage: normalized.targetLanguage,
            confidence: normalized.confidence,
            provider: normalized.provider,
            reason: evaluation.warning || 'transcript below threshold',
          });
        }
        return true;
      }

      pendingTranslationStartedAtRef.current = Date.now();
      setState((prev) => ({
        ...prev,
        translationStatus: 'translating',
        translationWarning: evaluation.warning,
        translationConfidence: normalized.confidence,
        mixedLanguageDetected: evaluation.mixedLanguage,
      }));
      realtimeTranslationService.log('transcript', {
        callId,
        sourceLanguage: normalized.sourceLanguage,
        targetLanguage: normalized.targetLanguage,
        confidence: normalized.confidence,
        provider: normalized.provider,
        metadata: { mixedLanguage: normalized.mixedLanguage, isFinal: normalized.isFinal },
      });
      return true;
    }

    if (
      message?.type === 'translation' ||
      message?.type === 'translation.ready' ||
      message?.type === 'translation.partial'
    ) {
      const normalized = realtimeTranslationService.normalizeTranslationEvent(message, {
        sourceLanguage: state.myLanguage,
        targetLanguage: state.theirLanguage,
      }, pendingTranslationStartedAtRef.current);

      if (!normalized) {
        setState((prev) => ({
          ...prev,
          translationStatus: 'unavailable',
          translationWarning: 'Translation unavailable. Call audio continues normally.',
        }));
        realtimeTranslationService.log('failure', {
          level: 'warn',
          callId,
          sourceLanguage: state.myLanguage,
          targetLanguage: state.theirLanguage,
          reason: 'empty translation payload',
        });
        return true;
      }

      const entry = realtimeTranslationService.toTranslationEntry(normalized);
      const latencyState = realtimeTranslationService.deriveLatencyState(normalized.latencyMs);

      setState((prev) => ({
        ...prev,
        translations: [...prev.translations, entry].slice(-50),
        translationStatus: latencyState === 'unavailable'
          ? 'unavailable'
          : latencyState === 'translating'
            ? 'translating'
            : 'ready',
        translationWarning: latencyState === 'unavailable'
          ? 'Translation delayed. Continuing without blocking call audio.'
          : latencyState === 'translating'
            ? 'Translating...'
            : undefined,
        translationLatencyMs: normalized.latencyMs,
        translationConfidence: normalized.confidence,
        mixedLanguageDetected: normalized.mixedLanguage,
      }));

      pendingTranslationStartedAtRef.current = null;
      realtimeTranslationService.log('translation', {
        callId,
        sourceLanguage: normalized.sourceLanguage,
        targetLanguage: normalized.targetLanguage,
        latencyMs: normalized.latencyMs,
        confidence: normalized.confidence,
        provider: normalized.provider,
        metadata: { mixedLanguage: normalized.mixedLanguage },
      });
      return true;
    }

    if (
      message?.type === 'translation_failed' ||
      message?.type === 'translation_error' ||
      message?.type === 'translation-fallback' ||
      (message?.type === 'error' && (message?.scope === 'translation' || message?.stage === 'translation'))
    ) {
      const failure = realtimeTranslationService.normalizeFailureEvent(message);
      pendingTranslationStartedAtRef.current = null;
      setState((prev) => ({
        ...prev,
        translationStatus: 'unavailable',
        translationWarning: 'Translation unavailable. Continuing the call without subtitles.',
        translationLatencyMs: failure.latencyMs,
      }));
      realtimeTranslationService.log('failure', {
        level: 'warn',
        callId,
        sourceLanguage: state.myLanguage,
        targetLanguage: state.theirLanguage,
        latencyMs: failure.latencyMs,
        provider: failure.provider,
        reason: failure.reason,
      });
      return true;
    }

    return false;
  }, [state.myLanguage, state.theirLanguage, state.translationEnabled]);

  return useMemo(() => ({
    state,
    requestedEnabledRef,
    setLanguages,
    setTranslationRequested,
    prepareForCall,
    reset,
    markListening,
    handleRealtimeEvent,
  }), [handleRealtimeEvent, markListening, prepareForCall, reset, setLanguages, setTranslationRequested, state]);
}
