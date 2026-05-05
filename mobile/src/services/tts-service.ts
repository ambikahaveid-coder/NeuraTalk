import { TranslationMode, VoiceTranslationStatus } from '../types';
import { translationLogger } from './translation-logger';

export type TtsDeliveryMode = 'session_injected' | 'remote_only' | 'local_playback' | 'unknown';

export interface VoiceTranslationDecision {
  requestedMode: TranslationMode;
  effectiveMode: TranslationMode;
  warning?: string;
}

export interface NormalizedTtsEvent {
  type: 'tts_ready';
  audioUrl?: string;
  sourceLanguage: string;
  targetLanguage: string;
  translatedText?: string;
  latencyMs?: number;
  provider: string;
  deliveryMode: TtsDeliveryMode;
  replaceOriginalVoice: boolean;
}

const SLOW_TTS_MS = 2000;
const DEGRADED_TTS_MS = 3000;

function normalizeDeliveryMode(value: unknown): TtsDeliveryMode {
  if (value === 'session_injected' || value === 'remote_only' || value === 'local_playback') {
    return value;
  }
  return 'unknown';
}

export class TtsService {
  createDecision(requestedMode: TranslationMode, translationEnabled: boolean): VoiceTranslationDecision {
    if (!translationEnabled || requestedMode === 'off') {
      return {
        requestedMode,
        effectiveMode: 'off',
      };
    }

    if (requestedMode === 'voice') {
      return {
        requestedMode,
        effectiveMode: 'subtitles',
        warning: 'Voice translation is waiting for a verified audio path. Subtitles stay active until translated audio is ready.',
      };
    }

    return {
      requestedMode,
      effectiveMode: 'subtitles',
    };
  }

  normalizeTtsReadyEvent(
    raw: any,
    defaults: { sourceLanguage: string; targetLanguage: string },
    startedAt?: number | null,
  ): NormalizedTtsEvent | null {
    if (raw?.type !== 'tts_ready') {
      return null;
    }

    const audioUrl = typeof raw?.audioUrl === 'string' && raw.audioUrl.trim() ? raw.audioUrl.trim() : undefined;
    const translatedText = typeof raw?.translated === 'string' && raw.translated.trim()
      ? raw.translated.trim()
      : typeof raw?.translatedText === 'string' && raw.translatedText.trim()
        ? raw.translatedText.trim()
        : undefined;

    if (!audioUrl && !translatedText && normalizeDeliveryMode(raw?.deliveryMode) === 'unknown') {
      return null;
    }

    return {
      type: 'tts_ready',
      audioUrl,
      translatedText,
      sourceLanguage: String(raw?.sourceLanguage || defaults.sourceLanguage || 'auto'),
      targetLanguage: String(raw?.targetLanguage || defaults.targetLanguage || 'en'),
      latencyMs: typeof raw?.latencyMs === 'number'
        ? raw.latencyMs
        : startedAt
          ? Date.now() - startedAt
          : undefined,
      provider: String(raw?.provider || 'backend_tts'),
      deliveryMode: normalizeDeliveryMode(raw?.deliveryMode),
      replaceOriginalVoice: raw?.replaceOriginalVoice === true || raw?.muteOriginalVoice === true,
    };
  }

  deriveStatus(latencyMs?: number | null): VoiceTranslationStatus {
    if (latencyMs == null) {
      return 'playing';
    }
    if (latencyMs > DEGRADED_TTS_MS) {
      return 'fallback_original';
    }
    if (latencyMs > SLOW_TTS_MS) {
      return 'synthesizing';
    }
    return 'playing';
  }

  canUseVoicePath(event: NormalizedTtsEvent, supportsNativePlayback: boolean): boolean {
    if (event.deliveryMode === 'session_injected' || event.deliveryMode === 'remote_only') {
      return true;
    }

    return supportsNativePlayback && Boolean(event.audioUrl);
  }

  log(event: 'tts_ready' | 'tts_failed' | 'voice_fallback', details: {
    callId?: string;
    latencyMs?: number;
    provider?: string;
    reason?: string;
    metadata?: Record<string, unknown>;
  }) {
    const payload = {
      callId: details.callId,
      latencyMs: details.latencyMs,
      provider: details.provider,
      reason: details.reason,
      metadata: details.metadata,
    };

    if (event === 'tts_failed' || event === 'voice_fallback') {
      translationLogger.warn(event, payload);
      return;
    }

    translationLogger.info(event, payload);
  }
}

export const ttsService = new TtsService();
