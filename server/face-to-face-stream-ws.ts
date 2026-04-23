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
import { preWarmCacheForCall } from "./ultra-pipeline";
import {
  initCallLanguageTracking,
  registerParticipantTranscript,
  resolveDirectionalLanguages,
  setParticipantLanguagePreference,
} from "./universal-language-runtime";
import {
  DeepgramLiveTranscriber,
  type DeepgramTranscriptEvent,
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
  toDeepgramLanguage,
  wordCount,
} from "./realtime-translation-core";
import { shouldEmitStreamingPartial, streamTranslationTokens } from "./token-streaming-translation";

const TARGET_LATENCY_MS = parsePositiveInt(process.env.FACE_TO_FACE_TARGET_LATENCY_MS, 900);
const PARTIAL_MIN_WORDS = parsePositiveInt(process.env.FACE_TO_FACE_MIN_PARTIAL_WORDS, 1);
const RESTART_MIN_CHAR_DELTA = parsePositiveInt(process.env.FACE_TO_FACE_RESTART_DELTA, 4);
const VAD_THRESHOLD = parsePositiveFloat(process.env.FACE_TO_FACE_VAD_THRESHOLD, 0.014);
const SILENCE_RESET_FRAMES = parsePositiveInt(process.env.FACE_TO_FACE_SILENCE_RESET_FRAMES, 8);

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

  private deepgram: DeepgramLiveTranscriber | null = null;
  private deepgramLanguage = toDeepgramLanguage("en");
  private recentSilenceFrames = 0;
  private turnId: string | null = null;
  private turn: TurnLatency | null = null;
  private firstSpeechFrameAt = 0;
  private finalizedSegments: string[] = [];
  private lastStartedTranscript = "";
  private lastRenderedTranslation = "";
  private latestEmotion: EmotionState | null = null;
  private currentGeneration = 0;
  private translationAbort: AbortController | null = null;
  private ttsAbort: AbortController | null = null;
  private ttsChain: Promise<void> = Promise.resolve();
  private audioSequence = 0;
  private closed = false;
  private lastDeepgramSocketLatencyMs: number | null = null;

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

    const nextDeepgramLanguage = toDeepgramLanguage(sourceLanguage);
    if (this.deepgram && nextDeepgramLanguage !== this.deepgramLanguage) {
      await this.deepgram.close().catch(() => {});
      this.deepgram = null;
    }
    this.deepgramLanguage = nextDeepgramLanguage;

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

    this.deepgram = new DeepgramLiveTranscriber({
      language: this.deepgramLanguage,
      endpointingMs: 90,
      utteranceEndMs: 240,
      onSocketOpen: (latencyMs) => {
        this.lastDeepgramSocketLatencyMs = latencyMs;
      },
      onTranscript: (event) => {
        void this.handleTranscript(event);
      },
      onError: (error) => {
        logger.warn("FaceToFaceWS", `Deepgram error in ${this.sessionId}: ${error.message}`);
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
        this.finalizedSegments = [];
        this.lastStartedTranscript = "";
        this.lastRenderedTranslation = "";
      }

      this.recentSilenceFrames = 0;
      this.interruptPlayback("barge-in");
    } else {
      this.recentSilenceFrames += 1;
    }

    this.deepgram?.send(normalized);
  }

  private async handleTranscript(event: DeepgramTranscriptEvent): Promise<void> {
    const corrected = applySpokenCorrections(event.text, this.config.sourceLanguage);
    const text = normalizeSpaces(corrected);
    if (!text) return;

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

    this.finalizedSegments.push(text);
    const finalizedText = normalizeSpaces(this.finalizedSegments.join(" "));

    if (event.speechFinal && finalizedText) {
      this.latestEmotion = detectEmotionFast(finalizedText);
      this.finalizedSegments = [];
      await this.maybeStartTranslation(finalizedText, true);
      return;
    }

    if (finalizedText) {
      await this.maybeStartTranslation(finalizedText, false);
    }
  }

  private async maybeStartTranslation(transcript: string, isFinal: boolean): Promise<void> {
    const normalized = normalizeTranscript(transcript);
    if (!normalized) return;

    const lastNormalized = normalizeTranscript(this.lastStartedTranscript);
    const shouldRestart = isFinal
      ? normalized !== lastNormalized &&
        (!lastNormalized ||
          !normalized.startsWith(lastNormalized) ||
          normalized.length - lastNormalized.length >= RESTART_MIN_CHAR_DELTA)
      : (!lastNormalized && wordCount(transcript) >= PARTIAL_MIN_WORDS) ||
        (lastNormalized &&
          normalized !== lastNormalized &&
          (!normalized.startsWith(lastNormalized) ||
            normalized.length - lastNormalized.length >= RESTART_MIN_CHAR_DELTA));

    if (!shouldRestart) return;

    this.lastStartedTranscript = transcript;
    const generation = ++this.currentGeneration;
    this.interruptPlayback(isFinal ? "new-final" : "new-partial");
    void this.translateAndSpeak(transcript, generation, isFinal);
  }

  private async translateAndSpeak(transcript: string, generation: number, isFinal: boolean): Promise<void> {
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
            const translated = normalizeSpaces(translatedText);
            if (!translated || !shouldEmitStreamingPartial(lastPublishedTranslation, translated)) return;

            lastPublishedTranslation = translated;
            this.lastRenderedTranslation = translated;
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
            this.lastRenderedTranslation = normalizeSpaces(fullTranslatedText);
            this.enqueueTtsSegment(segment, generation, resolvedLanguages.targetLanguage, this.turn?.trace || null);
          },
          onFinal: (translatedText) => {
            if (this.closed || generation !== this.currentGeneration) return;
            const translated = normalizeSpaces(translatedText);
            if (!translated) return;

            this.lastRenderedTranslation = translated;
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
    targetLanguage: string,
    trace: LatencyTrace | null,
  ): void {
    const clean = normalizeSpaces(text);
    if (!clean) return;

    this.ttsChain = this.ttsChain
      .then(() => this.streamTtsSegment(clean, generation, targetLanguage, trace))
      .catch((error) => {
        logger.warn("FaceToFaceWS", `TTS chain failed in ${this.sessionId}: ${String(error)}`);
      });
  }

  private async streamTtsSegment(
    text: string,
    generation: number,
    targetLanguage: string,
    trace: LatencyTrace | null,
  ): Promise<void> {
    if (this.closed || generation !== this.currentGeneration) return;

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
      if (this.turn) {
        this.turn.finalAudioAt = Date.now();
      }
    }
  }

  private interruptPlayback(reason: string): void {
    this.translationAbort?.abort();
    this.translationAbort = null;
    if (this.ttsAbort) {
      this.ttsAbort.abort();
      this.ttsAbort = null;
    }

    this.sendJson({ type: "interrupt", reason, ts: Date.now() });
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
    trace.addProvider("deepgram-stream");
    if (this.lastDeepgramSocketLatencyMs != null) {
      trace.addObservedNetworkLatency("deepgram_socket_open", this.lastDeepgramSocketLatencyMs);
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
  const claims = token ? verifyWsToken(token) : null;

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
