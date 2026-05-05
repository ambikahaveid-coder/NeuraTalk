import { useCallback, useMemo, useRef, useState } from 'react';
import { TranslationMode, VoiceTranslationStatus } from '../types';
import { ttsService } from '../services/tts-service';

export interface VoiceTranslationHookState {
  requestedMode: TranslationMode;
  effectiveMode: TranslationMode;
  status: VoiceTranslationStatus;
  warning?: string;
  latencyMs?: number;
  translatedAudioUrl?: string;
  originalVoiceSuppressed: boolean;
}

interface HandleVoiceEventContext {
  callId?: string;
  translationEnabled: boolean;
}

export interface UseVoiceTranslationOptions {
  initialMode?: TranslationMode;
  supportsNativePlayback: boolean;
  onPlayTranslatedAudio?: (audioUrl: string) => Promise<boolean>;
  onStopTranslatedAudio?: () => Promise<void>;
  onOriginalVoiceSuppressionChange?: (suppressed: boolean) => Promise<void>;
}

const initialState: VoiceTranslationHookState = {
  requestedMode: 'subtitles',
  effectiveMode: 'subtitles',
  status: 'idle',
  originalVoiceSuppressed: false,
};

export function useVoiceTranslation(options: UseVoiceTranslationOptions) {
  const startedAtRef = useRef<number | null>(null);
  const requestedModeRef = useRef<TranslationMode>(options.initialMode || initialState.requestedMode);
  const supportsNativePlayback = options.supportsNativePlayback;
  const [state, setState] = useState<VoiceTranslationHookState>({
    ...initialState,
    requestedMode: options.initialMode || initialState.requestedMode,
    effectiveMode: options.initialMode === 'off' ? 'off' : 'subtitles',
  });

  const stopVoiceTranslation = useCallback(async () => {
    if (state.originalVoiceSuppressed) {
      await options.onOriginalVoiceSuppressionChange?.(false);
    }
    await options.onStopTranslatedAudio?.();
  }, [options, state.originalVoiceSuppressed]);

  const setRequestedMode = useCallback((requestedMode: TranslationMode, translationEnabled: boolean) => {
    requestedModeRef.current = requestedMode;
    const decision = ttsService.createDecision(requestedMode, translationEnabled);
    if (requestedMode !== 'voice') {
      void stopVoiceTranslation();
    }

    setState((prev) => ({
      ...prev,
      requestedMode,
      effectiveMode: decision.effectiveMode,
      status: decision.effectiveMode === 'off' ? 'idle' : 'listening',
      warning: decision.warning,
      latencyMs: undefined,
      translatedAudioUrl: undefined,
      originalVoiceSuppressed: false,
    }));

    return decision;
  }, [stopVoiceTranslation]);

  const prepareForCall = useCallback((translationEnabled: boolean) => {
    startedAtRef.current = null;
    return setRequestedMode(requestedModeRef.current, translationEnabled);
  }, [setRequestedMode]);

  const reset = useCallback(() => {
    startedAtRef.current = null;
    void stopVoiceTranslation();
    setState((prev) => ({
      ...prev,
      effectiveMode: prev.requestedMode === 'off' ? 'off' : 'subtitles',
      status: prev.requestedMode === 'off' ? 'idle' : 'idle',
      warning: undefined,
      latencyMs: undefined,
      translatedAudioUrl: undefined,
      originalVoiceSuppressed: false,
    }));
  }, [stopVoiceTranslation]);

  const markListening = useCallback((translationEnabled: boolean) => {
    setState((prev) => ({
      ...prev,
      status: !translationEnabled || prev.requestedMode === 'off' ? 'idle' : 'listening',
    }));
  }, []);

  const handleRealtimeEvent = useCallback(async (message: any, context: HandleVoiceEventContext): Promise<boolean> => {
    if (!context.translationEnabled || state.requestedMode === 'off') {
      return false;
    }

    if (message?.type === 'transcript.final') {
      startedAtRef.current = Date.now();
      setState((prev) => ({
        ...prev,
        status: prev.requestedMode === 'voice' ? 'synthesizing' : prev.status,
      }));
      return false;
    }

    if (
      message?.type === 'translation' ||
      message?.type === 'translation.ready' ||
      message?.type === 'translation.partial'
    ) {
      setState((prev) => ({
        ...prev,
        status: prev.requestedMode === 'voice' ? 'synthesizing' : prev.status,
      }));
      return false;
    }

    const ttsReady = ttsService.normalizeTtsReadyEvent(message, {
      sourceLanguage: message?.sourceLanguage || 'auto',
      targetLanguage: message?.targetLanguage || 'en',
    }, startedAtRef.current);

    if (ttsReady) {
      startedAtRef.current = null;
      const latencyStatus = ttsService.deriveStatus(ttsReady.latencyMs);
      if (latencyStatus === 'fallback_original') {
        await stopVoiceTranslation();
        setState((prev) => ({
          ...prev,
          effectiveMode: 'subtitles',
          status: 'fallback_original',
          warning: 'Voice translation is too slow. Continuing with original voice and subtitles.',
          latencyMs: ttsReady.latencyMs,
          translatedAudioUrl: ttsReady.audioUrl,
          originalVoiceSuppressed: false,
        }));
        ttsService.log('voice_fallback', {
          callId: context.callId,
          latencyMs: ttsReady.latencyMs,
          provider: ttsReady.provider,
          reason: 'tts latency exceeded threshold',
        });
        return true;
      }

      const canUseVoicePath = ttsService.canUseVoicePath(ttsReady, supportsNativePlayback);
      if (!canUseVoicePath) {
        await stopVoiceTranslation();
        setState((prev) => ({
          ...prev,
          effectiveMode: 'subtitles',
          status: 'fallback_original',
          warning: 'Translated audio path is unavailable on this device. Continuing with original voice and subtitles.',
          latencyMs: ttsReady.latencyMs,
          translatedAudioUrl: ttsReady.audioUrl,
          originalVoiceSuppressed: false,
        }));
        ttsService.log('voice_fallback', {
          callId: context.callId,
          latencyMs: ttsReady.latencyMs,
          provider: ttsReady.provider,
          reason: 'no translated audio playback path',
          metadata: { deliveryMode: ttsReady.deliveryMode },
        });
        return true;
      }

      let played = true;
      if (ttsReady.deliveryMode === 'local_playback' && ttsReady.audioUrl) {
        played = await (options.onPlayTranslatedAudio?.(ttsReady.audioUrl) ?? Promise.resolve(false));
      }

      if (!played) {
        await stopVoiceTranslation();
        setState((prev) => ({
          ...prev,
          effectiveMode: 'subtitles',
          status: 'fallback_original',
          warning: 'Translated audio failed to play. Continuing with original voice.',
          latencyMs: ttsReady.latencyMs,
          translatedAudioUrl: ttsReady.audioUrl,
          originalVoiceSuppressed: false,
        }));
        ttsService.log('tts_failed', {
          callId: context.callId,
          latencyMs: ttsReady.latencyMs,
          provider: ttsReady.provider,
          reason: 'local translated audio playback failed',
        });
        return true;
      }

      if (ttsReady.replaceOriginalVoice) {
        await options.onOriginalVoiceSuppressionChange?.(true);
      }

      setState((prev) => ({
        ...prev,
        effectiveMode: 'voice',
        status: latencyStatus,
        warning: latencyStatus === 'synthesizing' ? 'Translating voice...' : undefined,
        latencyMs: ttsReady.latencyMs,
        translatedAudioUrl: ttsReady.audioUrl,
        originalVoiceSuppressed: ttsReady.replaceOriginalVoice,
      }));
      ttsService.log('tts_ready', {
        callId: context.callId,
        latencyMs: ttsReady.latencyMs,
        provider: ttsReady.provider,
        metadata: {
          deliveryMode: ttsReady.deliveryMode,
          replaceOriginalVoice: ttsReady.replaceOriginalVoice,
        },
      });
      return true;
    }

    if (
      message?.type === 'tts_failed' ||
      message?.type === 'translation-fallback' ||
      message?.type === 'tts_error' ||
      (message?.type === 'error' && (message?.scope === 'tts' || message?.stage === 'tts'))
    ) {
      startedAtRef.current = null;
      await stopVoiceTranslation();
      setState((prev) => ({
        ...prev,
        effectiveMode: 'subtitles',
        status: 'fallback_original',
        warning: 'Voice translation unavailable. Continuing with original voice.',
        latencyMs: typeof message?.latencyMs === 'number' ? message.latencyMs : undefined,
        originalVoiceSuppressed: false,
      }));
      ttsService.log('tts_failed', {
        callId: context.callId,
        latencyMs: typeof message?.latencyMs === 'number' ? message.latencyMs : undefined,
        provider: String(message?.provider || 'backend_tts'),
        reason: String(message?.reason || message?.message || 'tts failed'),
      });
      return true;
    }

    return false;
  }, [options, state.requestedMode, stopVoiceTranslation, supportsNativePlayback]);

  return useMemo(() => ({
    state,
    setRequestedMode,
    prepareForCall,
    reset,
    markListening,
    handleRealtimeEvent,
  }), [handleRealtimeEvent, markListening, prepareForCall, reset, setRequestedMode, state]);
}
