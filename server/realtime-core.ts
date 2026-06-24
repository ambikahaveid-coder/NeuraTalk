/**
 * RealtimeTranslationCore — transport-agnostic streaming translation orchestrator.
 *
 * Owns the full pipeline: VAD -> managed streaming STT -> OpenAI streaming
 * translation -> Azure streaming TTS -> per-listener PCM16 frames, with
 * per-source barge-in and per-speaker language detection via the shared
 * universal-language-runtime (Redis).
 *
 * This module has zero knowledge of LiveKit, Twilio, WebSocket, or any other
 * transport. Transport adapters call pushAudioFrame() to feed in audio and
 * implement RealtimeTransport to receive outputs.
 *
 * Contract:
 *   Input:  PCM16 mono frames at PCM_SAMPLE_RATE (16kHz), 20ms each.
 *   Output: PCM16 mono frames at PCM_SAMPLE_RATE, plus data messages.
 *   Adapters resample / format-convert to their transport's native codec.
 *
 * Step 6 enforcement — if OPENAI_API_KEY is missing, the constructor throws.
 * There is no silent batch fallback in this core. This is deliberate.
 */

import { randomUUID } from "crypto";
import { detectEmotionFast, type EmotionState } from "./emotion-engine";
import {
  recordStageLatency,
  recordTranscriptObservation,
  recordVoiceCounter,
  recordVoiceLatency,
} from "./modules/calls/metrics";
import { logger } from "./observability";
import { buildTranscriptSignalEvent } from "./translation/stt-service";
import {
  buildTranslationFailedEvent,
  buildTranslationReadyEvent,
  resolveListenerTranslationMode,
  shouldDeliverVoiceTranslation,
  shouldTranslateForListener,
  type ListenerTranslationMode,
} from "./translation/translation-service";
import { buildTtsFailedEvent, buildTtsReadyEvent } from "./translation/tts-service";
import {
  registerParticipantTranscript,
  resolveDirectionalLanguages,
  setParticipantLanguagePreference,
} from "./universal-language-runtime";
import {
  PCM_SAMPLE_RATE,
  applySpokenCorrections,
  computeRms,
  normalizeLanguage,
  normalizeSpaces,
  normalizeTranscript,
  streamAzureTtsFrames,
  wordCount,
} from "./realtime-translation-core";
import {
  appendFinalTranscriptSegment,
  clearFinalizedTranscriptSegments,
  isDuplicateFinalTranslation,
  isStaleFinalTranscript,
  isTranscriptRegression,
  isTurnOrderMismatch,
  markStartedTranslation,
  recordDeliveredFinalTranslation,
  recordRenderedTranslation,
  resetTranscriptMemory,
  shouldStartTranslationFromTranscript,
} from "./conversation-engine";
import { createManagedStreamingSttSession } from "./providers/stt-provider-registry";
import type { StreamingSttProviderSession, StreamingTranscriptEvent } from "./providers/voice-contracts";
import { shouldEmitStreamingPartial, streamTranslationTokens } from "./token-streaming-translation";

// ─── Public Types ─────────────────────────────────────────────────────────

export interface RealtimeSpeaker {
  id: string;
  name?: string;
  preferredLanguage: string; // "auto" | ISO code
  translationMode?: ListenerTranslationMode;
}

export type RealtimeMessageType =
  | "translation"
  | "translation-fallback"
  | "translator-state"
  | "transcript";

export interface RealtimeTransportMessage {
  type: RealtimeMessageType;
  payload: Record<string, unknown>;
}

export interface RealtimeTransport {
  /** Emit one PCM16 mono audio frame at PCM_SAMPLE_RATE to a specific listener. */
  emitAudioFrame(listenerId: string, pcm16: Int16Array): Promise<void> | void;

  /** Flush any queued/in-flight audio for this listener. Must return within ~10ms.
   *  Implementations should also send any transport-specific "clear" control
   *  message (e.g. Twilio media clear event). */
  clearListenerAudio(listenerId: string): Promise<void> | void;

  /** Send a data/metadata message. If listenerId is null, broadcast to all. */
  emitData(listenerId: string | null, message: RealtimeTransportMessage): Promise<void> | void;
}

export interface RealtimeCoreOptions {
  callId: string;
  transport: RealtimeTransport;
  vadThreshold?: number;
  silenceResetFrames?: number;
  partialMinWords?: number;
  restartMinCharDelta?: number;
  autoDetectEnabled?: boolean;
  targetLatencyMs?: number;
}

// ─── Constants (tunable via env in adapters) ──────────────────────────────

const DEFAULT_VAD_THRESHOLD = 0.018;
const DEFAULT_SILENCE_RESET_FRAMES = 6;
const DEFAULT_PARTIAL_MIN_WORDS = 1;
const DEFAULT_RESTART_MIN_CHAR_DELTA = 4;
const DEFAULT_TARGET_LATENCY_MS = 800;
const DEFAULT_TTS_READY_TIMEOUT_MS = 3_000;
const DEFAULT_MAX_TTS_BACKLOG_SEGMENTS = 3;
const DEFAULT_MAX_TTS_BACKLOG_MS = 1_500;

// ─── Internal Types ───────────────────────────────────────────────────────

interface TurnLatency {
  turnId: string;
  speechStartedAt?: number;
  firstTranscriptAt?: number;
  translationStartedAt?: number;
  translationCompletedAt?: number;
  ttsStartedAt?: number;
  firstAudioAt?: number;
  finalAudioAt?: number;
  sttLogged?: boolean;
  translationLogged?: boolean;
  ttsLogged?: boolean;
  totalLogged?: boolean;
  userText?: string;
  translatedText?: string;
}

interface SpeakerPipeline {
  identity: string;
  name: string;
  preferredLanguage: string;
  translationMode: ListenerTranslationMode;
  effectiveLanguage: string;
  detectedLanguage: string | null;
  deepgram: StreamingSttProviderSession | null;
  recentSilenceFrames: number;
  turnId: string | null;
  turn: TurnLatency | null;
  firstSpeechFrameAt: number;
  finalizedSegments: string[];
  lastStartedTranscript: string;
  lastFinalTranscript: string;
  latestEmotion: EmotionState | null;
  lastBargeInAt?: number;
}

interface OutputChannel {
  key: string;
  sourceIdentity: string;
  targetIdentity: string;
  targetLanguage: string;
  currentGeneration: number;
  currentTurnId: string | null;
  translationAbort: AbortController | null;
  ttsAbort: AbortController | null;
  ttsChain: Promise<void>;
  speaking: boolean;
  lastRenderedTranslation: string;
  lastDeliveredFinalTranslation: string;
  pendingTtsSegments: number;
  backlogSinceAt: number | null;
}

// ─── Core ─────────────────────────────────────────────────────────────────

export class RealtimeTranslationCore {
  private readonly callId: string;
  private readonly transport: RealtimeTransport;
  private readonly vadThreshold: number;
  private readonly silenceResetFrames: number;
  private readonly partialMinWords: number;
  private readonly restartMinCharDelta: number;
  private readonly autoDetectEnabled: boolean;
  private readonly targetLatencyMs: number;

  private readonly speakerPipelines = new Map<string, SpeakerPipeline>();
  private readonly outputChannels = new Map<string, OutputChannel>();
  private closed = false;

  constructor(opts: RealtimeCoreOptions) {
    // Step 6 enforcement — loud failure when streaming translator key is missing.
    const openaiKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY || process.env.OPENAI_API_KEY;
    if (!openaiKey) {
      throw new Error(
        "RealtimeTranslationCore requires OPENAI_API_KEY (or AI_INTEGRATIONS_OPENAI_API_KEY). " +
          "Silent fallback to batch translation is disabled. Configure the key or use the non-realtime helpers.",
      );
    }

    this.callId = opts.callId;
    this.transport = opts.transport;
    this.vadThreshold = opts.vadThreshold ?? DEFAULT_VAD_THRESHOLD;
    this.silenceResetFrames = opts.silenceResetFrames ?? DEFAULT_SILENCE_RESET_FRAMES;
    this.partialMinWords = opts.partialMinWords ?? DEFAULT_PARTIAL_MIN_WORDS;
    this.restartMinCharDelta = opts.restartMinCharDelta ?? DEFAULT_RESTART_MIN_CHAR_DELTA;
    this.autoDetectEnabled = opts.autoDetectEnabled ?? true;
    this.targetLatencyMs = opts.targetLatencyMs ?? DEFAULT_TARGET_LATENCY_MS;
  }

  // ─── Participant lifecycle ───────────────────────────────────────────────

  async addParticipant(speaker: RealtimeSpeaker): Promise<void> {
    if (this.closed) return;
    const preferredLanguage = normalizeLanguage(speaker.preferredLanguage || "auto");
    const existing = this.speakerPipelines.get(speaker.id);
    if (existing) {
      existing.preferredLanguage = preferredLanguage;
      existing.translationMode = resolveListenerTranslationMode(speaker.translationMode);
      if (preferredLanguage !== "auto") {
        existing.effectiveLanguage = preferredLanguage;
        await this.reconnectDeepgram(existing, preferredLanguage);
      }
      await setParticipantLanguagePreference(this.callId, speaker.id, preferredLanguage).catch(() => undefined);
      return;
    }

    const initialLanguage = preferredLanguage === "auto" ? "en" : preferredLanguage;
    const pipeline: SpeakerPipeline = {
      identity: speaker.id,
      name: speaker.name || speaker.id,
      preferredLanguage,
      translationMode: resolveListenerTranslationMode(speaker.translationMode),
      effectiveLanguage: initialLanguage,
      detectedLanguage: null,
      deepgram: null,
      recentSilenceFrames: 0,
      turnId: null,
      turn: null,
      firstSpeechFrameAt: 0,
      finalizedSegments: [],
      lastStartedTranscript: "",
      lastFinalTranscript: "",
      latestEmotion: null,
      lastBargeInAt: undefined,
    };
    this.speakerPipelines.set(speaker.id, pipeline);
    await setParticipantLanguagePreference(this.callId, speaker.id, preferredLanguage).catch(() => undefined);
  }

  async removeParticipant(speakerId: string): Promise<void> {
    const pipeline = this.speakerPipelines.get(speakerId);
    if (pipeline) {
      await this.disposeSpeakerPipeline(pipeline);
      this.speakerPipelines.delete(speakerId);
    }

    const related = Array.from(this.outputChannels.values()).filter(
      (channel) => channel.sourceIdentity === speakerId || channel.targetIdentity === speakerId,
    );
    for (const channel of related) {
      this.interruptChannel(channel, "participant-removed");
      this.outputChannels.delete(channel.key);
    }
  }

  async updateParticipantLanguage(speakerId: string, language: string): Promise<void> {
    const pipeline = this.speakerPipelines.get(speakerId);
    if (!pipeline) return;
    const normalized = normalizeLanguage(language || "auto");
    pipeline.preferredLanguage = normalized;
    await setParticipantLanguagePreference(this.callId, speakerId, normalized).catch(() => undefined);
    if (normalized !== "auto") {
      pipeline.effectiveLanguage = normalized;
      await this.reconnectDeepgram(pipeline, normalized);
    }
  }

  // ─── Audio ingress ───────────────────────────────────────────────────────

  /** Feed one PCM16 mono frame at PCM_SAMPLE_RATE from a specific speaker. */
  async pushAudioFrame(speakerId: string, pcm16: Int16Array): Promise<void> {
    if (this.closed) return;
    const pipeline = this.speakerPipelines.get(speakerId);
    if (!pipeline) return;

    this.observeVad(pipeline, pcm16);
    await this.ensureDeepgramForPipeline(pipeline);
    pipeline.deepgram?.send(pcm16);
  }

  async stop(): Promise<void> {
    if (this.closed) return;
    this.closed = true;

    await Promise.allSettled(
      Array.from(this.speakerPipelines.values()).map((p) => this.disposeSpeakerPipeline(p)),
    );
    this.speakerPipelines.clear();

    for (const channel of Array.from(this.outputChannels.values())) {
      this.interruptChannel(channel, "core-stop");
    }
    this.outputChannels.clear();
  }

  // ─── VAD + barge-in ──────────────────────────────────────────────────────

  private observeVad(pipeline: SpeakerPipeline, pcm16: Int16Array): void {
    const rms = computeRms(pcm16);
    const speaking = rms >= this.vadThreshold;

    if (speaking) {
      if (!pipeline.turnId || pipeline.recentSilenceFrames > this.silenceResetFrames) {
        pipeline.turnId = randomUUID();
        pipeline.firstSpeechFrameAt = Date.now();
        pipeline.turn = {
          turnId: pipeline.turnId,
          speechStartedAt: pipeline.firstSpeechFrameAt,
        };
        resetTranscriptMemory(pipeline);
        this.resetChannelStateForSource(pipeline.identity, pipeline.turnId);
      }

      pipeline.recentSilenceFrames = 0;
      pipeline.lastBargeInAt = Date.now();
      recordVoiceCounter("overlap_events");
      // Barge-in: cancel anything we were saying AS or TO this speaker.
      this.interruptChannelsForSource(pipeline.identity, "speaker-restarted");
      this.interruptChannelsForTarget(pipeline.identity, "barge-in");
      return;
    }

    pipeline.recentSilenceFrames += 1;
  }

  // ─── Streaming STT lifecycle ────────────────────────────────────────────

  private async ensureDeepgramForPipeline(pipeline: SpeakerPipeline): Promise<void> {
    if (pipeline.deepgram) return;

    pipeline.deepgram = createManagedStreamingSttSession({
      language: pipeline.effectiveLanguage,
      onTranscript: (event) => void this.handleTranscript(pipeline.identity, event),
      onProviderSwitch: (provider, reason) => {
        logger.warn("RealtimeCore", `[${this.callId}] STT provider switched to ${provider} for ${pipeline.identity}: ${reason}`);
      },
      onError: (error) => {
        logger.warn("RealtimeCore", `[${this.callId}] STT error for ${pipeline.identity}: ${error.message}`);
      },
    });

    await pipeline.deepgram.connect();
  }

  private async reconnectDeepgram(pipeline: SpeakerPipeline, language: string): Promise<void> {
    const targetLanguage = normalizeLanguage(language === "auto" ? pipeline.effectiveLanguage : language);
    pipeline.effectiveLanguage = targetLanguage;
    if (!pipeline.deepgram) return;

    await pipeline.deepgram.close().catch(() => {});
    pipeline.deepgram = null;
    await this.ensureDeepgramForPipeline(pipeline);
  }

  // ─── Transcript handling ─────────────────────────────────────────────────

  private async handleTranscript(identity: string, event: StreamingTranscriptEvent): Promise<void> {
    const pipeline = this.speakerPipelines.get(identity);
    if (!pipeline || this.closed) return;

    const text = applySpokenCorrections(event.text, pipeline.effectiveLanguage);
    if (!text) return;

    const staleTranscript = isStaleFinalTranscript(pipeline, text, event.isFinal);
    recordTranscriptObservation({
      isFinal: event.isFinal,
      confidence: event.confidence,
      stale: staleTranscript,
    });
    if (staleTranscript) {
      return;
    }
    if (isTranscriptRegression(pipeline, text, event.isFinal)) {
      recordVoiceCounter("transcript_regressions");
      return;
    }
    if (pipeline.lastBargeInAt) {
      recordVoiceLatency("interruption_recovery_ms", Math.max(0, Date.now() - pipeline.lastBargeInAt));
      pipeline.lastBargeInAt = undefined;
    }

    if (pipeline.turn && !pipeline.turn.firstTranscriptAt) {
      pipeline.turn.firstTranscriptAt = Date.now();
      if (!pipeline.turn.sttLogged && pipeline.turn.speechStartedAt) {
        pipeline.turn.sttLogged = true;
        recordStageLatency(this.callId, "stt", pipeline.turn.firstTranscriptAt - pipeline.turn.speechStartedAt);
      }
    }

    void this.transport.emitData(null, {
      type: "transcript",
      payload: buildTranscriptSignalEvent({
        sourceIdentity: pipeline.identity,
        text,
        isFinal: event.isFinal,
        speechFinal: Boolean(event.speechFinal),
        sourceLanguage: pipeline.effectiveLanguage,
        turnId: pipeline.turnId,
      }),
    });

    if (!event.isFinal) {
      if (wordCount(text) >= this.partialMinWords) {
        await this.maybeStartTranslation(pipeline, text, false);
      }
      return;
    }

    const finalizedText = appendFinalTranscriptSegment(pipeline, text);

    if (event.speechFinal && finalizedText) {
      pipeline.latestEmotion = detectEmotionFast(finalizedText);
      if (pipeline.turn) pipeline.turn.userText = finalizedText;
      clearFinalizedTranscriptSegments(pipeline);
      await this.maybeStartTranslation(pipeline, finalizedText, true);
      return;
    }

    if (finalizedText) {
      await this.maybeStartTranslation(pipeline, finalizedText, false);
    }
  }

  private async maybeStartTranslation(
    pipeline: SpeakerPipeline,
    transcript: string,
    isFinal: boolean,
  ): Promise<void> {
    const shouldRestart = shouldStartTranslationFromTranscript({
      transcript,
      isFinal,
      partialMinWords: this.partialMinWords,
      restartMinCharDelta: this.restartMinCharDelta,
      lastStartedTranscript: pipeline.lastStartedTranscript,
    });
    if (!shouldRestart) return;

    markStartedTranslation(pipeline, transcript);
    const sourceLanguage = await this.resolveSourceLanguage(pipeline, transcript, isFinal);
    const targets = await this.listTargetsForSpeaker(pipeline.identity, sourceLanguage);
    if (targets.length === 0) return;

    for (const target of targets) {
      const channel = this.ensureOutputChannel(pipeline.identity, target.identity, target.language);
      if (channel.currentTurnId !== pipeline.turnId) {
        channel.currentTurnId = pipeline.turnId;
        channel.lastRenderedTranslation = "";
      }

      const generation = channel.currentGeneration + 1;
      channel.currentGeneration = generation;
      this.interruptChannel(channel, isFinal ? "new-final" : "new-partial");

      void this.translateAndSpeak({
        pipeline,
        channel,
        transcript,
        turnId: pipeline.turnId,
        sourceLanguage,
        targetLanguage: target.language,
        targetIdentity: target.identity,
        targetMode: target.mode,
        generation,
        isFinal,
      });
    }
  }

  // ─── Language detection ──────────────────────────────────────────────────

  private async resolveSourceLanguage(
    pipeline: SpeakerPipeline,
    transcript: string,
    isFinal: boolean,
  ): Promise<string> {
    const previousLanguage = pipeline.effectiveLanguage;

    if (pipeline.preferredLanguage !== "auto") {
      pipeline.effectiveLanguage = pipeline.preferredLanguage;
      await setParticipantLanguagePreference(this.callId, pipeline.identity, pipeline.preferredLanguage).catch(() => undefined);
      return pipeline.effectiveLanguage;
    }

    if (!this.autoDetectEnabled) return pipeline.effectiveLanguage;

    const shouldDetect = isFinal || transcript.length >= 12;
    if (!shouldDetect) return pipeline.effectiveLanguage;

    try {
      const detected = await registerParticipantTranscript(this.callId, pipeline.identity, transcript, {
        preferredLanguage: pipeline.preferredLanguage,
        isFinal,
      });
      if (detected.participant.detectedLanguage && detected.participant.detectedLanguage !== "unknown") {
        pipeline.detectedLanguage = detected.participant.detectedLanguage;
        pipeline.effectiveLanguage = detected.effectiveLanguage;
        if (pipeline.effectiveLanguage !== previousLanguage) {
          await this.reconnectDeepgram(pipeline, pipeline.effectiveLanguage);
        }
      }
    } catch (error) {
      logger.debug("RealtimeCore", `[${this.callId}] language detect skipped for ${pipeline.identity}: ${String(error)}`);
    }

    return pipeline.effectiveLanguage;
  }

  private async listTargetsForSpeaker(
    sourceIdentity: string,
    sourceLanguage: string,
  ): Promise<Array<{ identity: string; language: string; mode: ListenerTranslationMode }>> {
    const targets: Array<{ identity: string; language: string; mode: ListenerTranslationMode }> = [];

    for (const [listenerId, listenerPipeline] of Array.from(this.speakerPipelines.entries())) {
      if (listenerId === sourceIdentity) continue;
      const mode = resolveListenerTranslationMode(listenerPipeline.translationMode);
      if (!shouldTranslateForListener(mode)) continue;

      const preferred = listenerPipeline.preferredLanguage;
      const resolved = await resolveDirectionalLanguages(this.callId, sourceIdentity, listenerId, {
        sourceLanguage,
        targetLanguage: preferred,
      }).catch(() => ({
        sourceLanguage,
        targetLanguage: preferred === "auto" ? listenerPipeline.effectiveLanguage || "en" : preferred,
        translationActive: preferred !== sourceLanguage,
      }));

      if (!resolved.translationActive) continue;

      targets.push({ identity: listenerId, language: resolved.targetLanguage, mode });
    }

    return targets;
  }

  // ─── Output channels + streaming translation + TTS ───────────────────────

  private ensureOutputChannel(
    sourceIdentity: string,
    targetIdentity: string,
    targetLanguage: string,
  ): OutputChannel {
    const key = `${sourceIdentity}=>${targetIdentity}`;
    const existing = this.outputChannels.get(key);
    if (existing) {
      existing.targetLanguage = targetLanguage;
      return existing;
    }

    const channel: OutputChannel = {
      key,
      sourceIdentity,
      targetIdentity,
      targetLanguage,
      currentGeneration: 0,
      currentTurnId: null,
      translationAbort: null,
      ttsAbort: null,
      ttsChain: Promise.resolve(),
      speaking: false,
      lastRenderedTranslation: "",
      lastDeliveredFinalTranslation: "",
      pendingTtsSegments: 0,
      backlogSinceAt: null,
    };
    this.outputChannels.set(key, channel);
    return channel;
  }

  private async translateAndSpeak(opts: {
    pipeline: SpeakerPipeline;
    channel: OutputChannel;
    transcript: string;
    turnId: string | null;
    sourceLanguage: string;
    targetLanguage: string;
    targetIdentity: string;
    targetMode: ListenerTranslationMode;
    generation: number;
    isFinal: boolean;
  }): Promise<void> {
    const translationStartedAt = Date.now();
    let translationAbort: AbortController | null = null;

    try {
      if (this.closed || opts.generation !== opts.channel.currentGeneration) return;

      if (opts.pipeline.turn && !opts.pipeline.turn.translationStartedAt) {
        opts.pipeline.turn.translationStartedAt = translationStartedAt;
      }

      translationAbort = new AbortController();
      opts.channel.translationAbort = translationAbort;
      let lastPublishedTranslation = "";

      const result = await streamTranslationTokens(
        opts.transcript,
        opts.sourceLanguage,
        opts.targetLanguage,
        {
          signal: translationAbort.signal,
          onFirstToken: () => {
            const translationCompletedAt = Date.now();
            if (
              opts.pipeline.turn &&
              !opts.pipeline.turn.translationLogged &&
              opts.pipeline.turn.firstTranscriptAt
            ) {
              opts.pipeline.turn.translationLogged = true;
              opts.pipeline.turn.translationCompletedAt = translationCompletedAt;
              recordStageLatency(
                this.callId,
                "translation",
                translationCompletedAt - opts.pipeline.turn.firstTranscriptAt,
              );
            }
          },
          onPartial: (translatedText) => {
            if (this.closed || opts.generation !== opts.channel.currentGeneration) return;
            if (isTurnOrderMismatch(opts.channel.currentTurnId, opts.turnId)) {
              recordVoiceCounter("turn_order_mismatches");
              return;
            }
            const translated = normalizeSpaces(translatedText);
            if (!translated || !shouldEmitStreamingPartial(lastPublishedTranslation, translated)) return;

            lastPublishedTranslation = translated;
            recordRenderedTranslation(opts.channel, translated);
            if (opts.pipeline.turn) opts.pipeline.turn.translatedText = translated;

            void this.transport.emitData(opts.targetIdentity, {
              type: "translation",
              payload: buildTranslationReadyEvent({
                sourceIdentity: opts.pipeline.identity,
                sourceLanguage: opts.sourceLanguage,
                targetIdentity: opts.targetIdentity,
                targetLanguage: opts.targetLanguage,
                original: opts.transcript,
                translated,
                partial: true,
                mode: opts.targetMode,
              }),
            });
          },
          onSegment: (segment, fullTranslatedText) => {
            if (this.closed || opts.generation !== opts.channel.currentGeneration) return;
            if (isTurnOrderMismatch(opts.channel.currentTurnId, opts.turnId)) {
              recordVoiceCounter("turn_order_mismatches");
              return;
            }
            const translated = normalizeSpaces(fullTranslatedText);
            if (translated) {
              recordRenderedTranslation(opts.channel, translated);
              if (opts.pipeline.turn) opts.pipeline.turn.translatedText = translated;
            }
            if (shouldDeliverVoiceTranslation(opts.targetMode)) {
              this.enqueueTtsSegment(opts.channel, segment, opts.generation, opts.turnId, Date.now(), opts.pipeline, opts.targetLanguage, opts.targetMode);
            }
          },
          onFinal: (translatedText) => {
            if (this.closed || opts.generation !== opts.channel.currentGeneration) return;
            if (isTurnOrderMismatch(opts.channel.currentTurnId, opts.turnId)) {
              recordVoiceCounter("turn_order_mismatches");
              return;
            }
            const translated = normalizeSpaces(translatedText);
            if (!translated) return;

            if (isDuplicateFinalTranslation(opts.channel, translated)) {
              recordVoiceCounter("duplicate_turns");
            }

            recordDeliveredFinalTranslation(opts.channel, translated);
            if (opts.pipeline.turn) opts.pipeline.turn.translatedText = translated;

            void this.transport.emitData(opts.targetIdentity, {
              type: "translation",
              payload: buildTranslationReadyEvent({
                sourceIdentity: opts.pipeline.identity,
                sourceLanguage: opts.sourceLanguage,
                targetIdentity: opts.targetIdentity,
                targetLanguage: opts.targetLanguage,
                original: opts.transcript,
                translated,
                partial: false,
                mode: opts.targetMode,
              }),
            });
          },
        },
      );

      // Loud signal if streaming degraded — no silent batch mode.
      if (!result.streamed) {
        logger.warn(
          "RealtimeCore",
          `[${this.callId}] streaming translation degraded to ${result.provider} for ${opts.sourceLanguage}->${opts.targetLanguage}. Check OPENAI_API_KEY and network.`,
        );
      }

      await opts.channel.ttsChain.catch(() => {});
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message === "This operation was aborted") return;
      logger.warn(
        "RealtimeCore",
        `[${this.callId}] translation failed ${opts.pipeline.identity} -> ${opts.targetIdentity}: ${message}`,
      );
      recordVoiceCounter("translation_fallbacks");
      await this.transport.emitData(opts.targetIdentity, {
        type: "translation-fallback",
        payload: buildTranslationFailedEvent({
          sourceIdentity: opts.pipeline.identity,
          targetIdentity: opts.targetIdentity,
          original: opts.transcript,
          reason: message,
          mode: opts.targetMode,
        }),
      });
    } finally {
      if (translationAbort && opts.channel.translationAbort === translationAbort) {
        opts.channel.translationAbort = null;
      }
    }
  }

  private enqueueTtsSegment(
    channel: OutputChannel,
    text: string,
    generation: number,
    turnId: string | null,
    queuedAt: number,
    pipeline: SpeakerPipeline,
    targetLanguage: string,
    targetMode: ListenerTranslationMode,
  ): void {
    if (this.shouldTripTtsBacklogWatchdog(channel)) {
      this.handleBacklogWatchdog(channel, targetMode, "tts-backlog");
      return;
    }
    channel.pendingTtsSegments += 1;
    if (channel.pendingTtsSegments > 1 && !channel.backlogSinceAt) {
      channel.backlogSinceAt = Date.now();
    }
    channel.ttsChain = channel.ttsChain
      .then(() => this.streamTtsSegment(channel, text, generation, turnId, queuedAt, pipeline, targetLanguage, targetMode))
      .catch((error) => {
        logger.warn("RealtimeCore", `[${this.callId}] TTS chain failed for ${channel.key}: ${String(error)}`);
      });
  }

  private async streamTtsSegment(
    channel: OutputChannel,
    text: string,
    generation: number,
    turnId: string | null,
    queuedAt: number,
    pipeline: SpeakerPipeline,
    targetLanguage: string,
    targetMode: ListenerTranslationMode,
  ): Promise<void> {
    if (this.closed || generation !== channel.currentGeneration) return;
    if (isTurnOrderMismatch(channel.currentTurnId, turnId)) {
      recordVoiceCounter("turn_order_mismatches");
      return;
    }
    const queueAgeMs = Math.max(0, Date.now() - queuedAt);
    if (queueAgeMs >= DEFAULT_MAX_TTS_BACKLOG_MS) {
      recordVoiceCounter("stale_tts_segments");
      logger.warn(
        "RealtimeCore",
        `[${this.callId}] dropped stale queued TTS segment for ${channel.key} after ${queueAgeMs}ms`,
      );
      return;
    }

    const ttsStartedAt = Date.now();
    if (pipeline.turn && !pipeline.turn.ttsStartedAt) {
      pipeline.turn.ttsStartedAt = ttsStartedAt;
    }

    channel.ttsAbort = new AbortController();
    channel.speaking = true;
    let firstByteObserved = false;
    let timeoutFallbackTriggered = false;
    const ttsReadyTimer = setTimeout(() => {
      if (firstByteObserved || timeoutFallbackTriggered || this.closed || generation !== channel.currentGeneration) {
        return;
      }
      timeoutFallbackTriggered = true;
      channel.ttsAbort?.abort();
      recordVoiceCounter("translation_fallbacks");
      void this.transport.emitData(channel.targetIdentity, {
        type: "translation-fallback",
        payload: buildTtsFailedEvent({
          sourceIdentity: channel.sourceIdentity,
          targetIdentity: channel.targetIdentity,
          translatedText: text,
          reason: `TTS readiness exceeded ${DEFAULT_TTS_READY_TIMEOUT_MS}ms`,
          translationMode: targetMode,
        }),
      });
    }, DEFAULT_TTS_READY_TIMEOUT_MS);

    try {
      for await (const frame of streamAzureTtsFrames(
        text,
        targetLanguage,
        channel.ttsAbort.signal,
        {
          onFirstByte: () => {
            firstByteObserved = true;
            const firstAudioAt = Date.now();
            if (pipeline.turn && !pipeline.turn.ttsLogged && pipeline.turn.ttsStartedAt) {
              pipeline.turn.ttsLogged = true;
              pipeline.turn.firstAudioAt = firstAudioAt;
              recordStageLatency(this.callId, "tts", firstAudioAt - pipeline.turn.ttsStartedAt);

              if (!pipeline.turn.totalLogged && pipeline.turn.speechStartedAt) {
                pipeline.turn.totalLogged = true;
                recordStageLatency(this.callId, "total", firstAudioAt - pipeline.turn.speechStartedAt);
                recordStageLatency(this.callId, "ultra", firstAudioAt - pipeline.turn.speechStartedAt);
              }

              void this.transport.emitData(channel.targetIdentity, {
                type: "translator-state",
                payload: {
                  sourceIdentity: channel.sourceIdentity,
                  targetIdentity: channel.targetIdentity,
                  targetLatencyMs: this.targetLatencyMs,
                  sttFirstPartialMs: diffMs(pipeline.turn.speechStartedAt, pipeline.turn.firstTranscriptAt),
                  translationMs: diffMs(pipeline.turn.firstTranscriptAt, pipeline.turn.translationCompletedAt),
                  ttsFirstAudioMs: diffMs(pipeline.turn.ttsStartedAt, pipeline.turn.firstAudioAt),
                  perceivedLatencyMs: diffMs(pipeline.turn.speechStartedAt, pipeline.turn.firstAudioAt),
                },
              });
              void this.transport.emitData(channel.targetIdentity, {
                type: "translation",
                payload: buildTtsReadyEvent({
                  sourceIdentity: channel.sourceIdentity,
                  targetIdentity: channel.targetIdentity,
                  sourceLanguage: pipeline.effectiveLanguage,
                  targetLanguage,
                  translatedText: text,
                  latencyMs: diffMs(pipeline.turn.speechStartedAt, pipeline.turn.firstAudioAt) ?? undefined,
                  deliveryMode: "remote_only",
                  replaceOriginalVoice: true,
                  translationMode: targetMode,
                }),
              });
            }
          },
          emotion: pipeline.latestEmotion,
          userAgent: "NeuraTalk/RealtimeCore",
        },
      )) {
        if (this.closed || generation !== channel.currentGeneration) break;
        await this.transport.emitAudioFrame(channel.targetIdentity, frame);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message !== "This operation was aborted") {
        logger.warn("RealtimeCore", `[${this.callId}] Azure TTS failed for ${channel.key}: ${message}`);
        recordVoiceCounter("translation_fallbacks");
        await this.transport.emitData(channel.targetIdentity, {
          type: "translation-fallback",
          payload: buildTtsFailedEvent({
            sourceIdentity: channel.sourceIdentity,
            targetIdentity: channel.targetIdentity,
            translatedText: text,
            reason: message,
            translationMode: targetMode,
          }),
        });
      }
    } finally {
      clearTimeout(ttsReadyTimer);
      channel.speaking = false;
      channel.pendingTtsSegments = Math.max(0, channel.pendingTtsSegments - 1);
      if (channel.pendingTtsSegments === 0) {
        channel.backlogSinceAt = null;
      }
      if (pipeline.turn) pipeline.turn.finalAudioAt = Date.now();
    }
  }

  // ─── Barge-in / reset helpers ────────────────────────────────────────────

  private interruptChannelsForSource(sourceIdentity: string, reason: string): void {
    for (const channel of Array.from(this.outputChannels.values())) {
      if (channel.sourceIdentity === sourceIdentity) this.interruptChannel(channel, reason);
    }
  }

  private interruptChannelsForTarget(targetIdentity: string, reason: string): void {
    for (const channel of Array.from(this.outputChannels.values())) {
      if (channel.targetIdentity === targetIdentity) this.interruptChannel(channel, reason);
    }
  }

  private interruptChannel(channel: OutputChannel, _reason: string): void {
    if (channel.speaking || channel.pendingTtsSegments > 0) {
      recordVoiceCounter("ghost_audio_drops");
    }
    channel.translationAbort?.abort();
    channel.translationAbort = null;
    channel.ttsAbort?.abort();
    channel.ttsAbort = null;
    channel.speaking = false;
    channel.pendingTtsSegments = 0;
    channel.backlogSinceAt = null;
    channel.lastRenderedTranslation = "";
    // Transport-side flush (Twilio clear event, LiveKit audioSource.clearQueue,
    // WebSocket {type:clear}, etc.) — fire-and-forget.
    void Promise.resolve(this.transport.clearListenerAudio(channel.targetIdentity)).catch(() => undefined);
  }

  private resetChannelStateForSource(sourceIdentity: string, turnId: string): void {
    for (const channel of Array.from(this.outputChannels.values())) {
      if (channel.sourceIdentity !== sourceIdentity) continue;
      channel.currentTurnId = turnId;
      channel.lastRenderedTranslation = "";
      channel.pendingTtsSegments = 0;
      channel.backlogSinceAt = null;
    }
  }

  private shouldTripTtsBacklogWatchdog(channel: OutputChannel): boolean {
    if (channel.pendingTtsSegments >= DEFAULT_MAX_TTS_BACKLOG_SEGMENTS) {
      return true;
    }
    return Boolean(channel.backlogSinceAt && Date.now() - channel.backlogSinceAt >= DEFAULT_MAX_TTS_BACKLOG_MS);
  }

  private handleBacklogWatchdog(channel: OutputChannel, targetMode: ListenerTranslationMode, reason: string): void {
    recordVoiceCounter("audio_backlog_events");
    recordVoiceCounter("translation_fallbacks");
    logger.warn(
      "RealtimeCore",
      `[${this.callId}] output backlog watchdog tripped for ${channel.key}: ${reason}`,
    );
    channel.currentGeneration += 1;
    this.interruptChannel(channel, reason);
    void this.transport.emitData(channel.targetIdentity, {
      type: "translation-fallback",
      payload: buildTtsFailedEvent({
        sourceIdentity: channel.sourceIdentity,
        targetIdentity: channel.targetIdentity,
        translatedText: channel.lastRenderedTranslation || undefined,
        reason: "Audio playback was reset to keep the conversation stable. Text translation remains available.",
        translationMode: targetMode,
      }),
    });
  }

  private async disposeSpeakerPipeline(pipeline: SpeakerPipeline): Promise<void> {
    await pipeline.deepgram?.close().catch(() => {});
    pipeline.deepgram = null;
  }

  // ─── Diagnostics ─────────────────────────────────────────────────────────

  getSnapshot(): {
    callId: string;
    speakers: number;
    channels: number;
    targetLatencyMs: number;
  } {
    return {
      callId: this.callId,
      speakers: this.speakerPipelines.size,
      channels: this.outputChannels.size,
      targetLatencyMs: this.targetLatencyMs,
    };
  }
}

function diffMs(start?: number, end?: number): number | null {
  if (!start || !end) {
    return null;
  }

  return Math.max(0, end - start);
}
