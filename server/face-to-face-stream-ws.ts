import { randomUUID } from "crypto";
import type { IncomingMessage } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { eq } from "drizzle-orm";
import { db } from "./db";
import { users } from "@shared/schema";
import { checkOrgBillingStatus, checkUserBillingStatus } from "./usage-enforcement";
import { verifyWsToken } from "./signaling-server";
import { detectEmotionFast, type EmotionState } from "./emotion-engine";
import { createLatencyTrace, type LatencyTrace } from "./latency-audit";
import { logger } from "./observability";
import {
  recordTranscriptObservation,
  recordVoiceCounter,
  recordVoiceLatency,
} from "./modules/calls/metrics";
import { preWarmCacheForCall } from "./ultra-pipeline";
import {
  initCallLanguageTracking,
  registerParticipantTranscript,
  resolveDirectionalLanguages,
  setParticipantLanguagePreference,
} from "./universal-language-runtime";
import {
  PCM_FRAME_BYTES,
  applySpokenCorrections,
  bytesToInt16Frame,
  computeRms,
  encodePcmFrameBase64,
  normalizeLanguage,
  normalizePcmFrame,
  normalizeSpaces,
  normalizeTranscript,
  streamAzureTtsFrames,
  wordCount,
} from "./realtime-translation-core";
import {
  appendFinalTranscriptSegment,
  clearFinalizedTranscriptSegments,
  isStaleFinalTranscript,
  isTranscriptRegression,
  isTurnOrderMismatch,
  markStartedTranslation,
  isDuplicateFinalTranslation,
  recordDeliveredFinalTranslation,
  recordRenderedTranslation,
  resetTranscriptMemory,
  shouldStartTranslationFromTranscript,
} from "./conversation-engine";
import { shouldEmitStreamingPartial, streamTranslationTokens } from "./token-streaming-translation";
import { createManagedStreamingSttSession, getDefaultSttProviderName } from "./providers/stt-provider-registry";
import type { StreamingSttProviderSession, StreamingTranscriptEvent } from "./providers/voice-contracts";

const TARGET_LATENCY_MS = parsePositiveInt(process.env.FACE_TO_FACE_TARGET_LATENCY_MS, 900);
const PARTIAL_MIN_WORDS = parsePositiveInt(process.env.FACE_TO_FACE_MIN_PARTIAL_WORDS, 1);
const RESTART_MIN_CHAR_DELTA = parsePositiveInt(process.env.FACE_TO_FACE_RESTART_DELTA, 4);
const VAD_THRESHOLD = parsePositiveFloat(process.env.FACE_TO_FACE_VAD_THRESHOLD, 0.014);
const SILENCE_RESET_FRAMES = parsePositiveInt(process.env.FACE_TO_FACE_SILENCE_RESET_FRAMES, 8);
const FACE_TO_FACE_MAX_TTS_BACKLOG_SEGMENTS = 3;
const FACE_TO_FACE_MAX_TTS_BACKLOG_MS = 1_500;

type FaceToFaceSpeaker = "person1" | "person2";

interface FaceToFaceConfig {
  speaker: FaceToFaceSpeaker;
  sourceLanguage: string;
  targetLanguage: string;
}

interface TurnLatency {
  turnId: string;
  speechStartedAt?: number;
  firstTranscriptAt?: number;
  translationStartedAt?: number;
  translationCompletedAt?: number;
  ttsStartedAt?: number;
  firstAudioAt?: number;
  finalAudioAt?: number;
  trace?: LatencyTrace | null;
}

class FaceToFaceRealtimeSession {
  private readonly ws: WebSocket;
  private readonly sessionId: string;
  private readonly userId: number;

  private config: FaceToFaceConfig = {
    speaker: "person1",
    sourceLanguage: "auto",
    targetLanguage: "auto",
  };

  private deepgram: StreamingSttProviderSession | null = null;
  private recentSilenceFrames = 0;
  private turnId: string | null = null;
  private turn: TurnLatency | null = null;
  private firstSpeechFrameAt = 0;
  private finalizedSegments: string[] = [];
  private lastStartedTranscript = "";
  private lastFinalTranscript = "";
  private lastRenderedTranslation = "";
  private latestEmotion: EmotionState | null = null;
  private currentGeneration = 0;
  private translationAbort: AbortController | null = null;
  private ttsAbort: AbortController | null = null;
  private ttsChain: Promise<void> = Promise.resolve();
  private audioSequence = 0;
  private closed = false;
  private lastDeepgramSocketLatencyMs: number | null = null;
  private lastDeliveredFinalTranslation = "";
  private lastBargeInAt = 0;
  private pendingTtsSegments = 0;
  private backlogSinceAt: number | null = null;

  private transcriptMemoryView(): {
    finalizedSegments: string[];
    lastStartedTranscript: string;
    lastFinalTranscript: string;
  } {
    return this as unknown as {
      finalizedSegments: string[];
      lastStartedTranscript: string;
      lastFinalTranscript: string;
    };
  }

  private outputMemoryView(): {
    lastRenderedTranslation: string;
    lastDeliveredFinalTranslation: string;
  } {
    return this as unknown as {
      lastRenderedTranslation: string;
      lastDeliveredFinalTranslation: string;
    };
  }

  constructor(ws: WebSocket, opts: { sessionId: string; userId: number }) {
    this.ws = ws;
    this.sessionId = opts.sessionId;
    this.userId = opts.userId;
  }

  async handleMessage(data: WebSocket.RawData): Promise<void> {
    if (this.closed) return;

    if (typeof data === "string" || data instanceof Buffer && !looksLikePcmFrame(data)) {
      try {
        const raw = typeof data === "string" ? data : data.toString("utf8");
        const message = JSON.parse(raw) as Record<string, unknown>;
        await this.handleControlMessage(message);
      } catch (error) {
        this.sendJson({ type: "error", message: "Invalid realtime control message" });
        logger.debug("FaceToFaceWS", `Malformed control message ${this.sessionId}: ${String(error)}`);
      }
      return;
    }

    const buffer = data instanceof Buffer ? data : Buffer.from(data as ArrayBuffer);
    if (!looksLikePcmFrame(buffer)) {
      return;
    }

    await this.handleAudioFrame(buffer);
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.translationAbort?.abort();
    this.translationAbort = null;
    this.ttsAbort?.abort();
    this.ttsAbort = null;
    await this.deepgram?.close().catch(() => {});
    this.deepgram = null;
  }

  private async handleControlMessage(message: Record<string, unknown>): Promise<void> {
    switch (message.type) {
      case "config":
        await this.updateConfig({
          speaker: message.speaker === "person2" ? "person2" : "person1",
          sourceLanguage: normalizeLanguage(String(message.sourceLanguage || "auto")),
          targetLanguage: normalizeLanguage(String(message.targetLanguage || "auto")),
        });
        break;
      case "stop":
        this.interruptPlayback("client-stop");
        this.finalizedSegments = [];
        this.lastStartedTranscript = "";
        this.lastFinalTranscript = "";
        this.lastRenderedTranslation = "";
        this.turnId = null;
        this.turn = null;
        break;
      case "ping":
        this.sendJson({ type: "pong", ts: Date.now() });
        break;
      default:
        this.sendJson({ type: "error", message: "Unknown realtime control action" });
        break;
    }
  }

  private async updateConfig(next: FaceToFaceConfig): Promise<void> {
    const sourceLanguage = normalizeLanguage(next.sourceLanguage);
    const targetLanguage = normalizeLanguage(next.targetLanguage);

    this.config = {
      speaker: next.speaker,
      sourceLanguage,
      targetLanguage,
    };

    await setParticipantLanguagePreference(this.sessionId, next.speaker, sourceLanguage).catch(() => undefined);
    await setParticipantLanguagePreference(this.sessionId, getOtherSpeaker(next.speaker), targetLanguage).catch(() => undefined);

    this.finalizedSegments = [];
    this.lastStartedTranscript = "";
    this.lastRenderedTranslation = "";
    this.currentGeneration += 1;
    this.interruptPlayback("speaker-switch");

    if (this.deepgram) {
      await this.deepgram.close().catch(() => {});
      this.deepgram = null;
    }

    void preWarmCacheForCall(sourceLanguage, targetLanguage).catch(() => undefined);

    this.sendJson({
      type: "state",
      sessionId: this.sessionId,
      speaker: this.config.speaker,
      sourceLanguage,
      targetLanguage,
      targetLatencyMs: TARGET_LATENCY_MS,
    });
  }

  private async ensureDeepgram(): Promise<void> {
    if (this.deepgram) return;

    this.deepgram = createManagedStreamingSttSession({
      language: this.config.sourceLanguage,
      endpointingMs: 90,
      utteranceEndMs: 240,
      onSocketOpen: (latencyMs) => {
        this.lastDeepgramSocketLatencyMs = latencyMs;
      },
      onProviderSwitch: (provider, reason) => {
        logger.warn("FaceToFaceWS", `STT provider switched to ${provider} in ${this.sessionId}: ${reason}`);
      },
      onTranscript: (event) => {
        void this.handleTranscript(event);
      },
      onError: (error) => {
        logger.warn("FaceToFaceWS", `STT error in ${this.sessionId}: ${error.message}`);
        this.sendJson({ type: "error", stage: "stt", message: "Speech recognition interrupted. Recovering..." });
      },
    });

    await this.deepgram.connect();
  }

  private async handleAudioFrame(buffer: Buffer): Promise<void> {
    await this.ensureDeepgram();

    const frame = bytesToInt16Frame(buffer);
    const normalized = normalizePcmFrame(frame);
    const rms = computeRms(normalized);
    const speaking = rms >= VAD_THRESHOLD;

    if (speaking) {
      if (!this.turnId || this.recentSilenceFrames > SILENCE_RESET_FRAMES) {
        this.turnId = randomUUID();
        this.firstSpeechFrameAt = Date.now();
        this.turn = {
          turnId: this.turnId,
          speechStartedAt: this.firstSpeechFrameAt,
          trace: this.createTraceForCurrentTurn(),
        };
        resetTranscriptMemory(this.transcriptMemoryView());
        this.lastRenderedTranslation = "";
      }

      this.recentSilenceFrames = 0;
      this.lastBargeInAt = Date.now();
      recordVoiceCounter("overlap_events");
      this.interruptPlayback("barge-in");
    } else {
      this.recentSilenceFrames += 1;
    }

    this.deepgram?.send(normalized);
  }

  private async handleTranscript(event: StreamingTranscriptEvent): Promise<void> {
    const corrected = applySpokenCorrections(event.text, this.config.sourceLanguage);
    const text = normalizeSpaces(corrected);
    if (!text) return;

    const staleTranscript = isStaleFinalTranscript(this.transcriptMemoryView(), text, event.isFinal);
    recordTranscriptObservation({
      isFinal: event.isFinal,
      confidence: event.confidence,
      stale: staleTranscript,
    });
    if (staleTranscript) {
      return;
    }
    if (isTranscriptRegression(this.transcriptMemoryView(), text, event.isFinal)) {
      recordVoiceCounter("transcript_regressions");
      return;
    }
    if (this.lastBargeInAt) {
      recordVoiceLatency("interruption_recovery_ms", Math.max(0, Date.now() - this.lastBargeInAt));
      this.lastBargeInAt = 0;
    }

    const resolvedLanguages = await resolveDirectionalLanguages(
      this.sessionId,
      this.config.speaker,
      getOtherSpeaker(this.config.speaker),
      {
        sourceLanguage: this.config.sourceLanguage,
        targetLanguage: this.config.targetLanguage,
      },
    ).catch(() => ({
      sourceLanguage: this.config.sourceLanguage === "auto" ? "en" : this.config.sourceLanguage,
      targetLanguage: this.config.targetLanguage === "auto" ? "en" : this.config.targetLanguage,
      translationActive: true,
    }));

    if (this.turn && !this.turn.firstTranscriptAt) {
      this.turn.firstTranscriptAt = Date.now();
      this.turn.trace?.mark("first_transcript", true);
    }

    this.sendJson({
      type: event.isFinal ? "transcript.final" : "transcript.partial",
      speaker: this.config.speaker,
      text,
      sourceLanguage: resolvedLanguages.sourceLanguage,
      targetLanguage: resolvedLanguages.targetLanguage,
      ts: Date.now(),
    });

    if (!event.isFinal) {
      if (wordCount(text) >= PARTIAL_MIN_WORDS) {
        await this.maybeStartTranslation(text, false);
      }
      return;
    }

    const finalizedText = appendFinalTranscriptSegment(this.transcriptMemoryView(), text);

    if (event.speechFinal && finalizedText) {
      this.latestEmotion = detectEmotionFast(finalizedText);
      clearFinalizedTranscriptSegments(this.transcriptMemoryView());
      await this.maybeStartTranslation(finalizedText, true);
      return;
    }

    if (finalizedText) {
      await this.maybeStartTranslation(finalizedText, false);
    }
  }

  private async maybeStartTranslation(transcript: string, isFinal: boolean): Promise<void> {
    const shouldRestart = shouldStartTranslationFromTranscript({
      transcript,
      isFinal,
      partialMinWords: PARTIAL_MIN_WORDS,
      restartMinCharDelta: RESTART_MIN_CHAR_DELTA,
      lastStartedTranscript: this.lastStartedTranscript,
    });
    if (!shouldRestart) return;

    markStartedTranslation(this.transcriptMemoryView(), transcript);
    const generation = ++this.currentGeneration;
    this.interruptPlayback(isFinal ? "new-final" : "new-partial");
    void this.translateAndSpeak(transcript, generation, this.turnId, isFinal);
  }

  private async translateAndSpeak(transcript: string, generation: number, turnId: string | null, isFinal: boolean): Promise<void> {
    let translationAbort: AbortController | null = null;
    try {
      const sourceState = await registerParticipantTranscript(
        this.sessionId,
        this.config.speaker,
        transcript,
        {
          preferredLanguage: this.config.sourceLanguage,
          isFinal,
        },
      ).catch(() => null);
      const resolvedLanguages = await resolveDirectionalLanguages(
        this.sessionId,
        this.config.speaker,
        getOtherSpeaker(this.config.speaker),
        {
          sourceLanguage: sourceState?.effectiveLanguage || this.config.sourceLanguage,
          targetLanguage: this.config.targetLanguage,
        },
      ).catch(() => ({
        sourceLanguage: sourceState?.effectiveLanguage || (this.config.sourceLanguage === "auto" ? "en" : this.config.sourceLanguage),
        targetLanguage: this.config.targetLanguage === "auto" ? "en" : this.config.targetLanguage,
        translationActive: true,
      }));
      const translationStartedAt = Date.now();
      if (this.turn && !this.turn.translationStartedAt) {
        this.turn.translationStartedAt = translationStartedAt;
      }
      this.turn?.trace?.mark("translation_request_start");

      if (!resolvedLanguages.translationActive) {
        this.turn?.trace?.addProvider("relay");
        this.sendJson({
          type: "translation.final",
          speaker: this.config.speaker,
          originalText: transcript,
          translatedText: transcript,
          sourceLanguage: resolvedLanguages.sourceLanguage,
          targetLanguage: resolvedLanguages.targetLanguage,
          emotion: this.latestEmotion?.emotion ?? null,
          ts: Date.now(),
        });
        return;
      }

      void preWarmCacheForCall(resolvedLanguages.sourceLanguage, resolvedLanguages.targetLanguage).catch(() => undefined);

      translationAbort = new AbortController();
      this.translationAbort = translationAbort;
      let lastPublishedTranslation = "";

      await streamTranslationTokens(
        transcript,
        resolvedLanguages.sourceLanguage,
        resolvedLanguages.targetLanguage,
        {
          signal: translationAbort.signal,
          onRequestStart: () => {
            this.turn?.trace?.mark("translation_request_start", true);
          },
          onStreamReady: (latencyMs) => {
            this.turn?.trace?.addObservedNetworkLatency("translation_stream_ready", latencyMs);
          },
          onProviderSelected: (provider, streamed) => {
            this.turn?.trace?.addProvider(provider);
            if (!streamed && provider === "fallback") {
              this.turn?.trace?.markBatch("translation");
            }
          },
          onFallback: (reason) => {
            this.turn?.trace?.markFallback(reason);
          },
          onFirstToken: () => {
            if (this.turn && !this.turn.translationCompletedAt) {
              this.turn.translationCompletedAt = Date.now();
            }
            this.turn?.trace?.mark("first_translated_token");
          },
          onPartial: (translatedText) => {
            if (this.closed || generation !== this.currentGeneration) return;
            if (isTurnOrderMismatch(this.turnId, turnId)) {
              recordVoiceCounter("turn_order_mismatches");
              return;
            }
            const translated = normalizeSpaces(translatedText);
            if (!translated || !shouldEmitStreamingPartial(lastPublishedTranslation, translated)) return;

            lastPublishedTranslation = translated;
            recordRenderedTranslation(this.outputMemoryView(), translated);
            this.sendJson({
              type: "translation.partial",
              speaker: this.config.speaker,
              originalText: transcript,
              translatedText: translated,
              sourceLanguage: resolvedLanguages.sourceLanguage,
              targetLanguage: resolvedLanguages.targetLanguage,
              emotion: this.latestEmotion?.emotion ?? null,
              ts: Date.now(),
            });
          },
          onSegment: (segment, fullTranslatedText) => {
            if (this.closed || generation !== this.currentGeneration) return;
            if (isTurnOrderMismatch(this.turnId, turnId)) {
              recordVoiceCounter("turn_order_mismatches");
              return;
            }
            recordRenderedTranslation(this.outputMemoryView(), fullTranslatedText);
            this.enqueueTtsSegment(segment, generation, turnId, Date.now(), resolvedLanguages.targetLanguage, this.turn?.trace || null);
          },
          onFinal: (translatedText) => {
            if (this.closed || generation !== this.currentGeneration) return;
            if (isTurnOrderMismatch(this.turnId, turnId)) {
              recordVoiceCounter("turn_order_mismatches");
              return;
            }
            const translated = normalizeSpaces(translatedText);
            if (!translated) return;

            if (
              isDuplicateFinalTranslation(this.outputMemoryView(), translated)
            ) {
              recordVoiceCounter("duplicate_turns");
            }

            recordDeliveredFinalTranslation(this.outputMemoryView(), translated);
            this.sendJson({
              type: "translation.final",
              speaker: this.config.speaker,
              originalText: transcript,
              translatedText: translated,
              sourceLanguage: resolvedLanguages.sourceLanguage,
              targetLanguage: resolvedLanguages.targetLanguage,
              emotion: this.latestEmotion?.emotion ?? null,
              ts: Date.now(),
            });
          },
        },
      );

      await this.ttsChain.catch(() => {});

      if (isFinal && this.turn) {
        this.turn.finalAudioAt = Date.now();
        this.turn.trace?.mark("final_playback_end", true);
        this.emitLatencySnapshot(true);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message === "This operation was aborted") {
        return;
      }
      if (message !== "This operation was aborted") {
        this.turn?.trace?.markFallback(`translation_runtime_failed:${message}`);
        logger.warn("FaceToFaceWS", `Streaming translation failed in ${this.sessionId}: ${message}`);
        recordVoiceCounter("translation_fallbacks");
        this.sendJson({
          type: "text-fallback",
          speaker: this.config.speaker,
          message: "Voice output is recovering. Text translation is still live.",
          ts: Date.now(),
        });
      }
      if (isFinal) {
        this.turn?.trace?.mark("final_playback_end", true);
        this.emitLatencySnapshot(true);
      }
    } finally {
      if (translationAbort && this.translationAbort === translationAbort) {
        this.translationAbort = null;
      }
    }
  }

  private enqueueTtsSegment(
    text: string,
    generation: number,
    turnId: string | null,
    queuedAt: number,
    targetLanguage: string,
    trace: LatencyTrace | null,
  ): void {
    const clean = normalizeSpaces(text);
    if (!clean) return;
    if (this.shouldTripTtsBacklogWatchdog()) {
      this.handleBacklogWatchdog("tts-backlog");
      return;
    }
    this.pendingTtsSegments += 1;
    if (this.pendingTtsSegments > 1 && !this.backlogSinceAt) {
      this.backlogSinceAt = Date.now();
    }

    this.ttsChain = this.ttsChain
      .then(() => this.streamTtsSegment(clean, generation, turnId, queuedAt, targetLanguage, trace))
      .catch((error) => {
        logger.warn("FaceToFaceWS", `TTS chain failed in ${this.sessionId}: ${String(error)}`);
      });
  }

  private async streamTtsSegment(
    text: string,
    generation: number,
    turnId: string | null,
    queuedAt: number,
    targetLanguage: string,
    trace: LatencyTrace | null,
  ): Promise<void> {
    if (this.closed || generation !== this.currentGeneration) return;
    if (isTurnOrderMismatch(this.turnId, turnId)) {
      recordVoiceCounter("turn_order_mismatches");
      return;
    }
    const queueAgeMs = Math.max(0, Date.now() - queuedAt);
    if (queueAgeMs >= FACE_TO_FACE_MAX_TTS_BACKLOG_MS) {
      recordVoiceCounter("stale_tts_segments");
      trace?.markFallback(`stale_tts_segment:${queueAgeMs}`);
      logger.warn("FaceToFaceWS", `Dropped stale queued TTS segment in ${this.sessionId} after ${queueAgeMs}ms`);
      return;
    }

    this.ttsAbort = new AbortController();
    if (this.turn && !this.turn.ttsStartedAt) {
      this.turn.ttsStartedAt = Date.now();
    }
    trace?.mark("tts_request_start");
    let playbackMarked = false;

    try {
      for await (const frame of streamAzureTtsFrames(
        text,
        targetLanguage,
        this.ttsAbort.signal,
        {
          emotion: this.latestEmotion,
          userAgent: "NeuraTalk/FaceToFace",
          onResponseHeaders: (latencyMs) => {
            trace?.addObservedNetworkLatency("azure_tts_headers", latencyMs);
          },
          onFirstByte: () => {
            if (this.turn && !this.turn.firstAudioAt) {
              this.turn.firstAudioAt = Date.now();
              trace?.addProvider("azure-tts");
              trace?.mark("first_audio_frame");
              this.emitLatencySnapshot(false);
            }
          },
        },
      )) {
        if (this.closed || generation !== this.currentGeneration) break;
        if (!playbackMarked) {
          playbackMarked = true;
          trace?.mark("playback_start");
        }
        this.sendJson({
          type: "audio",
          seq: this.audioSequence++,
          data: encodePcmFrameBase64(frame),
        });
      }
    } finally {
      this.pendingTtsSegments = Math.max(0, this.pendingTtsSegments - 1);
      if (this.pendingTtsSegments === 0) {
        this.backlogSinceAt = null;
      }
      if (this.turn) {
        this.turn.finalAudioAt = Date.now();
      }
    }
  }

  private interruptPlayback(reason: string): void {
    if (this.pendingTtsSegments > 0 || this.ttsAbort) {
      recordVoiceCounter("ghost_audio_drops");
    }
    this.translationAbort?.abort();
    this.translationAbort = null;
    if (this.ttsAbort) {
      this.ttsAbort.abort();
      this.ttsAbort = null;
    }
    this.pendingTtsSegments = 0;
    this.backlogSinceAt = null;

    this.sendJson({ type: "interrupt", reason, ts: Date.now() });
  }

  private shouldTripTtsBacklogWatchdog(): boolean {
    if (this.pendingTtsSegments >= FACE_TO_FACE_MAX_TTS_BACKLOG_SEGMENTS) {
      return true;
    }
    return Boolean(this.backlogSinceAt && Date.now() - this.backlogSinceAt >= FACE_TO_FACE_MAX_TTS_BACKLOG_MS);
  }

  private handleBacklogWatchdog(reason: string): void {
    recordVoiceCounter("audio_backlog_events");
    recordVoiceCounter("translation_fallbacks");
    logger.warn("FaceToFaceWS", `Playback backlog watchdog tripped in ${this.sessionId}: ${reason}`);
    this.currentGeneration += 1;
    this.interruptPlayback(reason);
    this.sendJson({
      type: "text-fallback",
      speaker: this.config.speaker,
      message: "Audio playback was reset to keep the conversation stable. Text translation is still live.",
      ts: Date.now(),
    });
  }

  private emitLatencySnapshot(finalize = false): void {
    if (!this.turn?.speechStartedAt) return;

    const finalized = finalize ? this.turn.trace?.finalize() : null;

    this.sendJson({
      type: "latency",
      targetLatencyMs: TARGET_LATENCY_MS,
      sttFirstPartialMs: finalized?.metrics.sttLatencyMs ?? diff(this.turn.speechStartedAt, this.turn.firstTranscriptAt),
      translationMs: finalized?.metrics.translationLatencyMs ?? diff(this.turn.firstTranscriptAt, this.turn.translationCompletedAt),
      ttsFirstAudioMs: finalized?.metrics.ttsLatencyMs ?? diff(this.turn.ttsStartedAt, this.turn.firstAudioAt),
      perceivedLatencyMs: finalized?.metrics.timeToFirstAudioMs ?? diff(this.turn.speechStartedAt, this.turn.firstAudioAt),
      networkLatencyMs: finalized?.metrics.networkLatencyMs ?? null,
      totalTurnMs: finalized?.metrics.totalPipelineLatencyMs ?? diff(this.turn.speechStartedAt, this.turn.finalAudioAt),
      ts: Date.now(),
    });
  }

  private createTraceForCurrentTurn(): LatencyTrace {
    const trace = createLatencyTrace({
      mode: "FACE_TO_FACE",
      callId: this.sessionId,
      direction: `${this.config.speaker}->${getOtherSpeaker(this.config.speaker)}`,
    });
    trace.mark("speech_start", true);
    trace.addProvider(`${getDefaultSttProviderName()}-stream`);
    if (this.lastDeepgramSocketLatencyMs != null) {
      trace.addObservedNetworkLatency("stt_socket_open", this.lastDeepgramSocketLatencyMs);
    }
    return trace;
  }

  private sendJson(payload: Record<string, unknown>): void {
    if (this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify(payload));
  }
}

export function setupFaceToFaceRealtimeWebSocket(wss: WebSocketServer): void {
  wss.on("connection", (ws, request) => {
    void handleConnection(ws, request);
  });
}

async function handleConnection(ws: WebSocket, request: IncomingMessage): Promise<void> {
  const url = new URL(request.url || "", `http://${request.headers.host || "localhost"}`);
  const token = url.searchParams.get("token");
  const claims = token ? await verifyWsToken(token) : null;

  if (!claims?.userId) {
    ws.close(4401, "Unauthorized");
    return;
  }

  const user = await db.query.users.findFirst({
    where: eq(users.id, claims.userId),
  });

  if (!user?.isActive) {
    ws.close(4403, "User unavailable");
    return;
  }

  const billing = user.organizationId
    ? await checkOrgBillingStatus(user.organizationId)
    : await checkUserBillingStatus(user.id);

  if (!billing.allowed) {
    ws.send(JSON.stringify({
      type: "error",
      code: billing.reason || "PAYMENT_REQUIRED",
      message: billing.warningMessage || "Active billing is required for face-to-face translation",
    }));
    ws.close(4402, "Billing required");
    return;
  }

  const sessionId = url.searchParams.get("sessionId") || randomUUID();
  const session = new FaceToFaceRealtimeSession(ws, {
    sessionId,
    userId: user.id,
  });
  await initCallLanguageTracking(sessionId, [
    { speakerId: "person1", preferredLanguage: "auto" },
    { speakerId: "person2", preferredLanguage: "auto" },
  ]).catch(() => undefined);

  ws.send(JSON.stringify({
    type: "state",
    sessionId,
    ready: true,
    targetLatencyMs: TARGET_LATENCY_MS,
  }));

  ws.on("message", (data) => {
    void session.handleMessage(data);
  });

  ws.on("close", () => {
    void session.close();
  });

  ws.on("error", (error) => {
    logger.warn("FaceToFaceWS", `Socket error for user ${user.id}: ${String(error)}`);
    void session.close();
  });
}

function diff(start?: number, end?: number): number | null {
  if (!start || !end) return null;
  return Math.max(0, end - start);
}

function looksLikePcmFrame(buffer: Buffer): boolean {
  return buffer.length > 0 && buffer.length <= PCM_FRAME_BYTES * 2 && buffer.length % 2 === 0;
}

function getOtherSpeaker(speaker: FaceToFaceSpeaker): FaceToFaceSpeaker {
  return speaker === "person1" ? "person2" : "person1";
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(String(value || ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parsePositiveFloat(value: string | undefined, fallback: number): number {
  const parsed = Number.parseFloat(String(value || ""));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
