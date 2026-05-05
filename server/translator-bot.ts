import { randomUUID } from "crypto";
import {
  AudioFrame,
  AudioSource,
  AudioStream,
  LocalAudioTrack,
  type Participant,
  RemoteAudioTrack,
  type RemoteParticipant,
  Room,
  RoomEvent,
  TrackPublishOptions,
  TrackSource,
  dispose as livekitDispose,
} from "@livekit/rtc-node";
import { azureTranslate } from "./azure-service";
import { detectEmotionFast, type EmotionState } from "./emotion-engine";
import { getClientConfig } from "./livekit-service";
import { createLatencyTrace, type LatencyTrace } from "./latency-audit";
import { recordStageLatency } from "./modules/calls/metrics";
import { recordSmartCallMediaActivity } from "./modules/calls/smart-router";
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
  DeepgramLiveTranscriber,
  type DeepgramTranscriptEvent,
  PCM_CHANNELS,
  PCM_SAMPLE_RATE,
  FRAME_DURATION_MS,
  applySpokenCorrections,
  computeRms,
  normalizeLanguage,
  normalizePcmFrame,
  normalizeSpaces,
  normalizeTranscript,
  streamAzureTtsFrames,
  toDeepgramLanguage,
  wordCount,
} from "./realtime-translation-core";
import {
  getCachedTranslation,
  getCachedTTS,
  preWarmCacheForCall,
  setCachedTranslation,
  setCachedTTS,
  ultraTTS,
  ultraTranslate,
} from "./ultra-pipeline";
import { shouldEmitStreamingPartial, streamTranslationTokens } from "./token-streaming-translation";
const BOT_DEFAULT_IDENTITY = "neuratalk-translator";

const TARGET_LATENCY_MS = parsePositiveInt(process.env.TRANSLATOR_BOT_TARGET_LATENCY_MS, 800);
const TTS_READY_TIMEOUT_MS = parsePositiveInt(process.env.TRANSLATOR_BOT_TTS_READY_TIMEOUT_MS, 3_000);
const PARTIAL_MIN_WORDS = parsePositiveInt(process.env.TRANSLATOR_BOT_MIN_PARTIAL_WORDS, 1);
const RESTART_MIN_CHAR_DELTA = parsePositiveInt(process.env.TRANSLATOR_BOT_RESTART_DELTA, 4);
const VAD_THRESHOLD = parsePositiveFloat(process.env.TRANSLATOR_BOT_VAD_THRESHOLD, 0.018);
const SILENCE_RESET_FRAMES = parsePositiveInt(process.env.TRANSLATOR_BOT_SILENCE_RESET_FRAMES, 6);
const AUTO_DETECT_ENABLED = (process.env.TRANSLATOR_BOT_ENABLE_LANGUAGE_DETECT || "true") === "true";
const PRECACHE_ENABLED = (process.env.TRANSLATOR_BOT_ENABLE_PRECACHE || "true") === "true";

interface BotSession {
  callId: string;
  startedAt: number;
  status: "starting" | "active" | "ending";
  worker: LiveKitRealtimeTranslatorBot;
}

interface SpeakerTurnLatency {
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
  traces?: Map<string, LatencyTrace>;
}

interface SpeakerPipeline {
  identity: string;
  name: string;
  preferredLanguage: string;
  translationMode: ListenerTranslationMode;
  effectiveLanguage: string;
  detectedLanguage: string | null;
  metadataVersion: string;
  deepgram: DeepgramLiveTranscriber | null;
  deepgramLanguage: string;
  audioTask: Promise<void> | null;
  currentTrackSid: string | null;
  recentSilenceFrames: number;
  turnId: string | null;
  turn: SpeakerTurnLatency | null;
  firstSpeechFrameAt: number;
  finalizedSegments: string[];
  lastStartedTranscript: string;
  lastFinalTranscript: string;
  latestEmotion: EmotionState | null;
  lastDeepgramSocketLatencyMs?: number;
  lastMediaHeartbeatAt?: number;
}

interface OutputChannel {
  key: string;
  sourceIdentity: string;
  targetIdentity: string;
  targetLanguage: string;
  audioSource: AudioSource;
  localTrack: LocalAudioTrack;
  currentGeneration: number;
  currentTurnId: string | null;
  translationAbort: AbortController | null;
  ttsAbort: AbortController | null;
  ttsChain: Promise<void>;
  speaking: boolean;
  lastRenderedTranslation: string;
}

interface TranslatorDataMessage {
  type: "translation" | "translation-fallback" | "translator-state";
  from: string;
  payload: Record<string, unknown>;
  ts: number;
}

const activeSessions = new Map<string, BotSession>();
const preWarmedPairs = new Set<string>();
let shutdownBound = false;

export async function startBotWorker(callId: string, botToken: string): Promise<void> {
  if (!callId || !botToken) {
    logger.warn("TranslatorBot", "startBotWorker called without callId or botToken");
    return;
  }

  if (activeSessions.has(callId)) {
    logger.info("TranslatorBot", `translator bot already active for ${callId}`);
    return;
  }

  const worker = new LiveKitRealtimeTranslatorBot({
    callId,
    botToken,
    botIdentity: decodeIdentityFromToken(botToken),
  });

  const session: BotSession = {
    callId,
    startedAt: Date.now(),
    status: "starting",
    worker,
  };

  activeSessions.set(callId, session);

  try {
    await worker.start();
    session.status = "active";
    logger.info("TranslatorBot", `translator bot active for ${callId}`);
  } catch (error) {
    activeSessions.delete(callId);
    logger.error("TranslatorBot", `translator bot failed for ${callId}: ${String(error)}`);
    throw error;
  }

  bindShutdown();
}

export async function stopBotWorker(callId: string): Promise<void> {
  const session = activeSessions.get(callId);
  if (!session) return;

  session.status = "ending";
  try {
    await session.worker.stop();
  } catch (error) {
    logger.warn("TranslatorBot", `translator bot stop error for ${callId}: ${String(error)}`);
  } finally {
    activeSessions.delete(callId);
  }
}

export function listActiveBots(): Array<{ callId: string; status: string; uptimeMs: number }> {
  const now = Date.now();
  return Array.from(activeSessions.values()).map((session) => ({
    callId: session.callId,
    status: session.status,
    uptimeMs: now - session.startedAt,
  }));
}

export async function translateUtterance(
  text: string,
  fromLang: string,
  toLang: string,
  opts: { synthesizeAudio?: boolean } = {},
): Promise<{ translated: string; audio?: Buffer; latencyMs: number }> {
  const started = Date.now();
  const normalizedFrom = normalizeLanguage(fromLang);
  const normalizedTo = normalizeLanguage(toLang);

  if (!text || normalizedFrom === normalizedTo) {
    return { translated: text, latencyMs: 0 };
  }

  let translated = getCachedTranslation(text, normalizedFrom, normalizedTo);
  if (!translated) {
    try {
      translated = await translateTextLowLatency(text, normalizedFrom, normalizedTo);
      if (translated && translated !== text) {
        setCachedTranslation(text, normalizedFrom, normalizedTo, translated);
      }
    } catch (error) {
      logger.warn("TranslatorBot", `translateUtterance failed: ${String(error)}`);
      return { translated: text, latencyMs: Date.now() - started };
    }
  }

  let audio: Buffer | undefined;
  if (opts.synthesizeAudio && translated) {
    audio = getCachedTTS(translated, normalizedTo);
    if (!audio) {
      try {
        audio = await ultraTTS(translated, normalizedTo);
        if (audio) setCachedTTS(translated, normalizedTo, audio);
      } catch (error) {
        logger.warn("TranslatorBot", `translateUtterance TTS failed: ${String(error)}`);
      }
    }
  }

  return {
    translated: translated ?? text,
    audio,
    latencyMs: Date.now() - started,
  };
}

class LiveKitRealtimeTranslatorBot {
  private readonly callId: string;
  private readonly botToken: string;
  private readonly botIdentity: string;

  private room: Room | null = null;
  private closed = false;
  private readonly speakerPipelines = new Map<string, SpeakerPipeline>();
  private readonly outputChannels = new Map<string, OutputChannel>();

  constructor(opts: { callId: string; botToken: string; botIdentity: string }) {
    this.callId = opts.callId;
    this.botToken = opts.botToken;
    this.botIdentity = opts.botIdentity || BOT_DEFAULT_IDENTITY;
  }

  async start(): Promise<void> {
    if (PRECACHE_ENABLED) {
      await Promise.allSettled([
        preWarmPair("en", "hi"),
        preWarmPair("hi", "en"),
        preWarmPair("en", "te"),
        preWarmPair("te", "en"),
      ]);
    }

    const room = new Room();

    room
      .on(RoomEvent.Connected, () => {
        logger.info("TranslatorBot", `[${this.callId}] bot connected to LiveKit room`);
        void this.publishState("ready");
      })
      .on(RoomEvent.Reconnecting, () => {
        logger.warn("TranslatorBot", `[${this.callId}] LiveKit reconnecting`);
        void this.publishState("reconnecting");
      })
      .on(RoomEvent.Reconnected, () => {
        logger.info("TranslatorBot", `[${this.callId}] LiveKit reconnected`);
        void this.publishState("reconnected");
      })
      .on(RoomEvent.Disconnected, () => {
        if (!this.closed) {
          logger.warn("TranslatorBot", `[${this.callId}] LiveKit disconnected unexpectedly`);
        }
      })
      .on(RoomEvent.ParticipantMetadataChanged, (metadata, participant) => {
        this.applyParticipantMetadata(participant.identity, metadata);
      })
      .on(RoomEvent.ParticipantDisconnected, (participant) => {
        void this.cleanupParticipant(participant.identity);
      })
      .on(RoomEvent.DataReceived, (payload, participant, _kind, topic) => {
        if (topic && topic !== "translation-control") return;
        if (!participant) return;
        this.handleParticipantData(participant.identity, payload);
      })
      .on(RoomEvent.TrackSubscribed, (track, publication, participant) => {
        if (participant.identity === this.botIdentity || isBotParticipant(participant)) return;
        if (!(track instanceof RemoteAudioTrack)) return;
        logger.info(
          "TranslatorBot",
          `[${this.callId}] subscribed to ${participant.identity} audio track ${publication.name || publication.sid || "unknown"}`,
        );
        void this.consumeRemoteAudio(participant, track);
      });

    const livekitConfig = getClientConfig();
    if (!livekitConfig.url) {
      throw new Error("LiveKit is not configured");
    }

    await room.connect(livekitConfig.url, this.botToken, {
      autoSubscribe: true,
      dynacast: true,
    });

    this.room = room;
  }

  async stop(): Promise<void> {
    if (this.closed) return;
    this.closed = true;

    await Promise.allSettled(Array.from(this.speakerPipelines.values()).map((pipeline) => this.disposeSpeakerPipeline(pipeline)));
    this.speakerPipelines.clear();

    await Promise.allSettled(Array.from(this.outputChannels.values()).map((channel) => this.closeOutputChannel(channel)));
    this.outputChannels.clear();

    if (this.room) {
      await this.room.disconnect().catch(() => {});
      this.room = null;
    }
  }

  private async consumeRemoteAudio(participant: RemoteParticipant, track: RemoteAudioTrack): Promise<void> {
    const pipeline = await this.ensureSpeakerPipeline(participant);
    if (pipeline.audioTask) return;

    pipeline.currentTrackSid = track.sid || participant.identity;

    const task = (async () => {
      const audioStream = new AudioStream(track, {
        sampleRate: PCM_SAMPLE_RATE,
        numChannels: PCM_CHANNELS,
        frameSizeMs: FRAME_DURATION_MS,
      });

      try {
        for await (const frame of audioStream as unknown as AsyncIterable<AudioFrame>) {
          if (this.closed) break;
          const now = Date.now();
          if (!pipeline.lastMediaHeartbeatAt || now - pipeline.lastMediaHeartbeatAt >= 1_000) {
            pipeline.lastMediaHeartbeatAt = now;
            void recordSmartCallMediaActivity(this.callId, participant.identity);
          }
          this.observeVad(pipeline, frame);
          await this.ensureDeepgramForPipeline(pipeline);
          pipeline.deepgram?.send(normalizePcmFrame(frame.data));
        }
      } catch (error) {
        logger.warn("TranslatorBot", `[${this.callId}] audio stream ended for ${participant.identity}: ${String(error)}`);
      }
    })();

    pipeline.audioTask = task;

    try {
      await task;
    } finally {
      if (pipeline.audioTask === task) {
        pipeline.audioTask = null;
      }
    }
  }

  private observeVad(pipeline: SpeakerPipeline, frame: AudioFrame): void {
    const rms = computeRms(frame.data);
    const speaking = rms >= VAD_THRESHOLD;

    if (speaking) {
      if (!pipeline.turnId || pipeline.recentSilenceFrames > SILENCE_RESET_FRAMES) {
        pipeline.turnId = randomUUID();
        pipeline.firstSpeechFrameAt = Date.now();
        pipeline.turn = {
          turnId: pipeline.turnId,
          speechStartedAt: pipeline.firstSpeechFrameAt,
          traces: new Map(),
        };
        pipeline.finalizedSegments = [];
        pipeline.lastStartedTranscript = "";
        pipeline.lastFinalTranscript = "";
        this.resetChannelStateForSource(pipeline.identity, pipeline.turnId);
      }

      pipeline.recentSilenceFrames = 0;
      this.interruptChannelsForSource(pipeline.identity, "speaker-restarted");
      this.interruptChannelsForTarget(pipeline.identity, "barge-in");
      return;
    }

    pipeline.recentSilenceFrames += 1;
  }

  private async ensureSpeakerPipeline(participant: RemoteParticipant): Promise<SpeakerPipeline> {
    const metadata = readParticipantMetadata(participant);
    const preferredLanguage = normalizeLanguage(String(metadata.language || participant.attributes?.language || "auto"));
    const translationMode = resolveListenerTranslationMode(metadata.translationMode);
    const existing = this.speakerPipelines.get(participant.identity);

    if (existing) {
      if (existing.metadataVersion !== participant.metadata) {
        existing.metadataVersion = participant.metadata;
        existing.preferredLanguage = preferredLanguage;
        existing.translationMode = translationMode;
        void setParticipantLanguagePreference(this.callId, participant.identity, preferredLanguage).catch(() => undefined);
        if (preferredLanguage !== "auto") {
          existing.effectiveLanguage = preferredLanguage;
          await this.reconnectDeepgram(existing, preferredLanguage);
        }
      }
      return existing;
    }

    const initialLanguage = preferredLanguage === "auto" ? "en" : preferredLanguage;
    const pipeline: SpeakerPipeline = {
      identity: participant.identity,
      name: participant.name || participant.identity,
      preferredLanguage,
      translationMode,
      effectiveLanguage: initialLanguage,
      detectedLanguage: null,
      metadataVersion: participant.metadata,
      deepgram: null,
      deepgramLanguage: toDeepgramLanguage(initialLanguage),
      audioTask: null,
      currentTrackSid: null,
      recentSilenceFrames: 0,
      turnId: null,
      turn: null,
      firstSpeechFrameAt: 0,
      finalizedSegments: [],
      lastStartedTranscript: "",
      lastFinalTranscript: "",
      latestEmotion: null,
      lastMediaHeartbeatAt: 0,
    };

    this.speakerPipelines.set(participant.identity, pipeline);
    await setParticipantLanguagePreference(this.callId, participant.identity, preferredLanguage).catch(() => undefined);
    return pipeline;
  }

  private async ensureDeepgramForPipeline(pipeline: SpeakerPipeline): Promise<void> {
    if (pipeline.deepgram) return;

    pipeline.deepgram = new DeepgramLiveTranscriber({
      language: pipeline.deepgramLanguage,
      onTranscript: (event) => void this.handleTranscript(pipeline.identity, event),
      onSocketOpen: (latencyMs) => {
        pipeline.lastDeepgramSocketLatencyMs = latencyMs;
      },
      onError: (error) => {
        logger.warn("TranslatorBot", `[${this.callId}] Deepgram error for ${pipeline.identity}: ${error.message}`);
      },
    });

    await pipeline.deepgram.connect();
  }

  private async reconnectDeepgram(pipeline: SpeakerPipeline, language: string): Promise<void> {
    const targetLanguage = normalizeLanguage(language === "auto" ? pipeline.effectiveLanguage : language);
    const deepgramLanguage = toDeepgramLanguage(targetLanguage);
    if (deepgramLanguage === pipeline.deepgramLanguage) return;

    pipeline.deepgramLanguage = deepgramLanguage;
    pipeline.effectiveLanguage = targetLanguage;

    if (!pipeline.deepgram) return;

    await pipeline.deepgram.close().catch(() => {});
    pipeline.deepgram = null;
    await this.ensureDeepgramForPipeline(pipeline);
  }

  private async handleTranscript(identity: string, event: DeepgramTranscriptEvent): Promise<void> {
    const pipeline = this.speakerPipelines.get(identity);
    if (!pipeline || this.closed) return;

    const text = applySpokenCorrections(event.text, pipeline.effectiveLanguage);
    if (!text) return;

    await this.publishTranslationMessage({
      type: "translation",
      from: this.botIdentity,
      payload: buildTranscriptSignalEvent({
        sourceIdentity: pipeline.identity,
        text,
        sourceLanguage: pipeline.effectiveLanguage,
        turnId: pipeline.turnId,
        isFinal: event.isFinal,
        speechFinal: Boolean(event.speechFinal),
      }),
      ts: Date.now(),
    });

    if (pipeline.turn && !pipeline.turn.firstTranscriptAt) {
      pipeline.turn.firstTranscriptAt = Date.now();
      for (const trace of Array.from(pipeline.turn.traces?.values() || [])) {
        trace.mark("first_transcript", true);
      }
      if (!pipeline.turn.sttLogged && pipeline.turn.speechStartedAt) {
        pipeline.turn.sttLogged = true;
        recordStageLatency(this.callId, "stt", pipeline.turn.firstTranscriptAt - pipeline.turn.speechStartedAt);
      }
    }

    if (!event.isFinal) {
      if (wordCount(text) >= PARTIAL_MIN_WORDS) {
        await this.maybeStartTranslation(pipeline, text, false);
      }
      return;
    }

    pipeline.finalizedSegments.push(text);
    const finalizedText = normalizeSpaces(pipeline.finalizedSegments.join(" "));
    if (finalizedText) {
      pipeline.lastFinalTranscript = finalizedText;
    }

    if (event.speechFinal && finalizedText) {
      pipeline.latestEmotion = detectEmotionFast(finalizedText);
      if (pipeline.turn) {
        pipeline.turn.userText = finalizedText;
      }
      pipeline.finalizedSegments = [];
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
    const normalized = normalizeTranscript(transcript);
    if (!normalized) return;

    const lastNormalized = normalizeTranscript(pipeline.lastStartedTranscript);
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

    pipeline.lastStartedTranscript = transcript;
    const sourceLanguage = await this.resolveSourceLanguage(pipeline, transcript, isFinal);
    const targets = await this.listTargetsForSpeaker(pipeline.identity, sourceLanguage);
    if (targets.length === 0) return;

    for (const target of targets) {
      const channel = await this.ensureOutputChannel(pipeline.identity, target.identity, target.language);
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
        sourceLanguage,
        targetLanguage: target.language,
        targetIdentity: target.identity,
        targetMode: target.mode,
        generation,
        isFinal,
      });
    }
  }

  private async listTargetsForSpeaker(sourceIdentity: string, sourceLanguage: string): Promise<Array<{ identity: string; language: string; mode: ListenerTranslationMode }>> {
    if (!this.room) return [];

    const targets: Array<{ identity: string; language: string; mode: ListenerTranslationMode }> = [];

    for (const participant of Array.from(this.room.remoteParticipants.values())) {
      if (participant.identity === sourceIdentity || isBotParticipant(participant)) {
        continue;
      }

      const pipeline = this.speakerPipelines.get(participant.identity);
      const mode = resolveListenerTranslationMode(
        pipeline?.translationMode || readParticipantMetadata(participant).translationMode,
      );
      if (!shouldTranslateForListener(mode)) {
        continue;
      }
      const preferredLanguage = normalizeLanguage(
        String(pipeline?.preferredLanguage || readParticipantMetadata(participant).language || participant.attributes?.language || "auto"),
      );
      const resolved = await resolveDirectionalLanguages(this.callId, sourceIdentity, participant.identity, {
        sourceLanguage,
        targetLanguage: preferredLanguage,
      }).catch(() => ({
        sourceLanguage,
        targetLanguage: preferredLanguage === "auto" ? pipeline?.effectiveLanguage || "en" : preferredLanguage,
        translationActive: preferredLanguage !== sourceLanguage,
      }));

      if (!resolved.translationActive) {
        continue;
      }

      targets.push({
        identity: participant.identity,
        language: resolved.targetLanguage,
        mode,
      });
    }

    return targets;
  }

  private async translateAndSpeak(opts: {
    pipeline: SpeakerPipeline;
    channel: OutputChannel;
    transcript: string;
    sourceLanguage: string;
    targetLanguage: string;
    targetIdentity: string;
    targetMode: ListenerTranslationMode;
    generation: number;
    isFinal: boolean;
  }): Promise<void> {
    const translationStartedAt = Date.now();
    let translationAbort: AbortController | null = null;
    const trace = this.getOrCreateLatencyTrace(opts.pipeline, opts.channel);

    try {
      if (this.closed || opts.generation !== opts.channel.currentGeneration) return;

      if (opts.pipeline.turn && !opts.pipeline.turn.translationStartedAt) {
        opts.pipeline.turn.translationStartedAt = translationStartedAt;
      }
      trace?.mark("translation_request_start");

      void preWarmPair(opts.sourceLanguage, opts.targetLanguage);

      translationAbort = new AbortController();
      opts.channel.translationAbort = translationAbort;
      let lastPublishedTranslation = "";

      await streamTranslationTokens(
        opts.transcript,
        opts.sourceLanguage,
        opts.targetLanguage,
        {
          signal: translationAbort.signal,
          onRequestStart: () => {
            trace?.mark("translation_request_start", true);
          },
          onStreamReady: (latencyMs) => {
            trace?.addObservedNetworkLatency("translation_stream_ready", latencyMs);
          },
          onProviderSelected: (provider, streamed) => {
            trace?.addProvider(provider);
            if (!streamed && provider === "fallback") {
              trace?.markBatch("translation");
            }
          },
          onFallback: (reason) => {
            trace?.markFallback(reason);
          },
          onFirstToken: () => {
            const translationCompletedAt = Date.now();
            trace?.mark("first_translated_token");
            if (opts.pipeline.turn && !opts.pipeline.turn.translationLogged && opts.pipeline.turn.firstTranscriptAt) {
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
            const translated = normalizeSpaces(translatedText);
            if (!translated || !shouldEmitStreamingPartial(lastPublishedTranslation, translated)) return;

            lastPublishedTranslation = translated;
            opts.channel.lastRenderedTranslation = translated;
            if (opts.pipeline.turn) {
              opts.pipeline.turn.translatedText = translated;
            }

            void this.publishTranslationMessage({
              type: "translation",
              from: this.botIdentity,
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
              ts: Date.now(),
            }, [opts.targetIdentity]);
          },
          onSegment: (segment, fullTranslatedText) => {
            if (this.closed || opts.generation !== opts.channel.currentGeneration) return;
            const translated = normalizeSpaces(fullTranslatedText);
            if (translated) {
              opts.channel.lastRenderedTranslation = translated;
              if (opts.pipeline.turn) {
                opts.pipeline.turn.translatedText = translated;
              }
            }

            if (shouldDeliverVoiceTranslation(opts.targetMode)) {
              this.enqueueTtsSegment(
                opts.channel,
                segment,
                opts.generation,
                opts.pipeline,
                opts.targetLanguage,
                opts.targetMode,
                trace,
              );
            }
          },
          onFinal: (translatedText) => {
            if (this.closed || opts.generation !== opts.channel.currentGeneration) return;
            const translated = normalizeSpaces(translatedText);
            if (!translated) return;

            opts.channel.lastRenderedTranslation = translated;
            if (opts.pipeline.turn) {
              opts.pipeline.turn.translatedText = translated;
            }

            void this.publishTranslationMessage({
              type: "translation",
              from: this.botIdentity,
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
              ts: Date.now(),
            }, [opts.targetIdentity]);
          },
        },
      );

      await opts.channel.ttsChain.catch(() => {});
      if (opts.isFinal) {
        trace?.mark("final_playback_end", true);
        trace?.finalize();
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message === "This operation was aborted") {
        return;
      }
      trace?.markFallback(`translation_runtime_failed:${message}`);
      logger.warn(
        "TranslatorBot",
        `[${this.callId}] translation failed ${opts.pipeline.identity} -> ${opts.targetIdentity}: ${message}`,
      );
      await this.publishTranslationMessage({
        type: "translation-fallback",
        from: this.botIdentity,
        payload: buildTranslationFailedEvent({
          sourceIdentity: opts.pipeline.identity,
          targetIdentity: opts.targetIdentity,
          original: opts.transcript,
          reason: message,
          mode: opts.targetMode,
        }),
        ts: Date.now(),
      }, [opts.targetIdentity]);
      if (opts.isFinal) {
        trace?.mark("final_playback_end", true);
        trace?.finalize();
      }
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
    pipeline: SpeakerPipeline,
    targetLanguage: string,
    targetMode: ListenerTranslationMode,
    trace: LatencyTrace | null,
  ): void {
    channel.ttsChain = channel.ttsChain
      .then(() => this.streamTtsSegment(channel, text, generation, pipeline, targetLanguage, targetMode, trace))
      .catch((error) => {
        logger.warn("TranslatorBot", `[${this.callId}] TTS chain failed for ${channel.key}: ${String(error)}`);
      });
  }

  private async streamTtsSegment(
    channel: OutputChannel,
    text: string,
    generation: number,
    pipeline: SpeakerPipeline,
    targetLanguage: string,
    targetMode: ListenerTranslationMode,
    trace: LatencyTrace | null,
  ): Promise<void> {
    if (this.closed || generation !== channel.currentGeneration) return;

    const ttsStartedAt = Date.now();
    if (pipeline.turn && !pipeline.turn.ttsStartedAt) {
      pipeline.turn.ttsStartedAt = ttsStartedAt;
    }
    trace?.mark("tts_request_start");

    channel.ttsAbort = new AbortController();
    channel.speaking = true;
    let playbackMarked = false;
    let firstByteObserved = false;
    let timeoutFallbackTriggered = false;
    const ttsReadyTimer = setTimeout(() => {
      if (firstByteObserved || timeoutFallbackTriggered || this.closed || generation !== channel.currentGeneration) {
        return;
      }
      timeoutFallbackTriggered = true;
      trace?.markFallback(`tts_ready_timeout:${TTS_READY_TIMEOUT_MS}`);
      logger.warn("TranslatorBot", `[${this.callId}] TTS readiness timeout for ${channel.key} after ${TTS_READY_TIMEOUT_MS}ms`);
      channel.ttsAbort?.abort();
      void this.publishTranslationMessage({
        type: "translation-fallback",
        from: this.botIdentity,
        payload: buildTtsFailedEvent({
          sourceIdentity: channel.sourceIdentity,
          targetIdentity: channel.targetIdentity,
          translatedText: text,
          reason: `TTS readiness exceeded ${TTS_READY_TIMEOUT_MS}ms`,
          translationMode: targetMode,
        }),
        ts: Date.now(),
      }, [channel.targetIdentity]);
    }, TTS_READY_TIMEOUT_MS);

    try {
      for await (const frame of streamAzureTtsFrames(
        text,
        targetLanguage,
        channel.ttsAbort.signal,
        {
          onResponseHeaders: (latencyMs) => {
            trace?.addObservedNetworkLatency("azure_tts_headers", latencyMs);
          },
          onFirstByte: () => {
            firstByteObserved = true;
            const firstAudioAt = Date.now();
            trace?.addProvider("azure-tts");
            trace?.mark("first_audio_frame");
            if (pipeline.turn && !pipeline.turn.ttsLogged && pipeline.turn.ttsStartedAt) {
              pipeline.turn.ttsLogged = true;
              pipeline.turn.firstAudioAt = firstAudioAt;
              recordStageLatency(this.callId, "tts", firstAudioAt - pipeline.turn.ttsStartedAt);

              if (!pipeline.turn.totalLogged && pipeline.turn.speechStartedAt) {
                pipeline.turn.totalLogged = true;
                recordStageLatency(this.callId, "total", firstAudioAt - pipeline.turn.speechStartedAt);
                recordStageLatency(this.callId, "ultra", firstAudioAt - pipeline.turn.speechStartedAt);
              }
            }
            void this.publishTranslationMessage({
              type: "translation",
              from: this.botIdentity,
              payload: buildTtsReadyEvent({
                sourceIdentity: channel.sourceIdentity,
                targetIdentity: channel.targetIdentity,
                sourceLanguage: pipeline.effectiveLanguage,
                targetLanguage,
                translatedText: text,
                latencyMs: pipeline.turn?.speechStartedAt ? Math.max(0, firstAudioAt - pipeline.turn.speechStartedAt) : undefined,
                deliveryMode: "session_injected",
                replaceOriginalVoice: true,
                translationMode: targetMode,
              }),
              ts: Date.now(),
            }, [channel.targetIdentity]);
          },
          emotion: pipeline.latestEmotion,
          userAgent: "NeuraTalk/TranslatorBot",
        },
      )) {
        if (this.closed || generation !== channel.currentGeneration) break;
        await channel.audioSource.captureFrame(new AudioFrame(frame, PCM_SAMPLE_RATE, PCM_CHANNELS, frame.length));
        if (!playbackMarked) {
          playbackMarked = true;
          trace?.mark("playback_start");
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message !== "This operation was aborted") {
        trace?.markFallback(`tts_failed:${message}`);
        logger.warn("TranslatorBot", `[${this.callId}] Azure TTS failed for ${channel.key}: ${message}`);
        await this.publishTranslationMessage({
          type: "translation-fallback",
          from: this.botIdentity,
          payload: buildTtsFailedEvent({
            sourceIdentity: channel.sourceIdentity,
            targetIdentity: channel.targetIdentity,
            translatedText: text,
            reason: message,
            translationMode: targetMode,
          }),
          ts: Date.now(),
        }, [channel.targetIdentity]);
      } else if (!timeoutFallbackTriggered && !firstByteObserved) {
        trace?.markFallback("tts_aborted_before_audio");
      }
    } finally {
      clearTimeout(ttsReadyTimer);
      channel.speaking = false;
      if (pipeline.turn) {
        pipeline.turn.finalAudioAt = Date.now();
      }
    }
  }

  private async ensureOutputChannel(
    sourceIdentity: string,
    targetIdentity: string,
    targetLanguage: string,
  ): Promise<OutputChannel> {
    if (!this.room?.localParticipant) {
      throw new Error("Translator bot is not connected to a LiveKit room");
    }

    const key = `${sourceIdentity}=>${targetIdentity}`;
    const existing = this.outputChannels.get(key);
    if (existing) {
      existing.targetLanguage = targetLanguage;
      return existing;
    }

    const audioSource = new AudioSource(PCM_SAMPLE_RATE, PCM_CHANNELS, 120);
    const trackName = buildTranslatedTrackName(sourceIdentity, targetIdentity);
    const localTrack = LocalAudioTrack.createAudioTrack(trackName, audioSource);
    const options = new TrackPublishOptions();
    options.source = TrackSource.SOURCE_MICROPHONE;

    await this.room.localParticipant.publishTrack(localTrack, options);

    const channel: OutputChannel = {
      key,
      sourceIdentity,
      targetIdentity,
      targetLanguage,
      audioSource,
      localTrack,
      currentGeneration: 0,
      currentTurnId: null,
      translationAbort: null,
      ttsAbort: null,
      ttsChain: Promise.resolve(),
      speaking: false,
      lastRenderedTranslation: "",
    };

    this.outputChannels.set(key, channel);
    return channel;
  }

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

    if (!AUTO_DETECT_ENABLED) {
      return pipeline.effectiveLanguage;
    }

    const shouldDetect = isFinal || transcript.length >= 12;
    if (!shouldDetect) {
      return pipeline.effectiveLanguage;
    }

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
      logger.debug("TranslatorBot", `[${this.callId}] language detect skipped for ${pipeline.identity}: ${String(error)}`);
    }

    return pipeline.effectiveLanguage;
  }

  private interruptChannelsForSource(sourceIdentity: string, reason: string): void {
    for (const channel of Array.from(this.outputChannels.values())) {
      if (channel.sourceIdentity === sourceIdentity) {
        this.interruptChannel(channel, reason);
      }
    }
  }

  private interruptChannelsForTarget(targetIdentity: string, reason: string): void {
    for (const channel of Array.from(this.outputChannels.values())) {
      if (channel.targetIdentity === targetIdentity) {
        this.interruptChannel(channel, reason);
      }
    }
  }

  private interruptChannel(channel: OutputChannel, _reason: string): void {
    channel.translationAbort?.abort();
    channel.translationAbort = null;
    channel.ttsAbort?.abort();
    channel.ttsAbort = null;
    channel.speaking = false;
    channel.lastRenderedTranslation = "";
    channel.audioSource.clearQueue();
  }

  private resetChannelStateForSource(sourceIdentity: string, turnId: string): void {
    for (const channel of Array.from(this.outputChannels.values())) {
      if (channel.sourceIdentity !== sourceIdentity) continue;
      channel.currentTurnId = turnId;
      channel.lastRenderedTranslation = "";
    }
  }

  private getOrCreateLatencyTrace(pipeline: SpeakerPipeline, channel: OutputChannel): LatencyTrace | null {
    if (!pipeline.turn?.speechStartedAt) {
      return null;
    }

    if (!pipeline.turn.traces) {
      pipeline.turn.traces = new Map();
    }

    const existing = pipeline.turn.traces.get(channel.key);
    if (existing) {
      return existing;
    }

    const trace = createLatencyTrace({
      mode: "APP_TO_APP",
      callId: this.callId,
      direction: `${pipeline.identity}->${channel.targetIdentity}`,
    });
    trace.mark("speech_start", true);
    trace.addProvider("deepgram-stream");
    if (pipeline.lastDeepgramSocketLatencyMs != null) {
      trace.addObservedNetworkLatency("deepgram_socket_open", pipeline.lastDeepgramSocketLatencyMs);
    }
    if (pipeline.turn.firstTranscriptAt) {
      trace.mark("first_transcript", true);
    }
    pipeline.turn.traces.set(channel.key, trace);
    return trace;
  }

  private async cleanupParticipant(identity: string): Promise<void> {
    const pipeline = this.speakerPipelines.get(identity);
    if (pipeline) {
      await this.disposeSpeakerPipeline(pipeline);
      this.speakerPipelines.delete(identity);
    }

    const relatedChannels = Array.from(this.outputChannels.values()).filter(
      (channel) => channel.sourceIdentity === identity || channel.targetIdentity === identity,
    );

    await Promise.allSettled(relatedChannels.map((channel) => this.closeOutputChannel(channel)));
    for (const channel of relatedChannels) {
      this.outputChannels.delete(channel.key);
    }
  }

  private async disposeSpeakerPipeline(pipeline: SpeakerPipeline): Promise<void> {
    await pipeline.deepgram?.close().catch(() => {});
    pipeline.deepgram = null;

    if (pipeline.audioTask) {
      await pipeline.audioTask.catch(() => {});
      pipeline.audioTask = null;
    }
  }

  private async closeOutputChannel(channel: OutputChannel): Promise<void> {
    this.interruptChannel(channel, "channel-close");
    await channel.localTrack.close(true).catch(() => {});
    await channel.audioSource.close().catch(() => {});
  }

  private applyParticipantMetadata(identity: string, metadata: string | undefined): void {
    const parsed = safeJsonParse<Record<string, unknown>>(metadata);
    const language = normalizeLanguage(String(parsed?.language || "auto"));
    const translationMode = resolveListenerTranslationMode(parsed?.translationMode);
    const pipeline = this.speakerPipelines.get(identity);
    if (!pipeline) return;

    pipeline.metadataVersion = metadata || "";
    pipeline.preferredLanguage = language;
    pipeline.translationMode = translationMode;
    void setParticipantLanguagePreference(this.callId, identity, language).catch(() => undefined);
    if (language !== "auto") {
      pipeline.effectiveLanguage = language;
      void this.reconnectDeepgram(pipeline, language);
    }
  }

  private handleParticipantData(identity: string, payload: Uint8Array): void {
    try {
      const text = new TextDecoder().decode(payload);
      const data = JSON.parse(text) as {
        type?: string;
        payload?: { language?: string; translationMode?: ListenerTranslationMode };
      };
      if (data.type === "language-change" && data.payload?.language) {
        this.applyParticipantMetadata(identity, JSON.stringify({
          language: data.payload.language,
          translationMode: this.speakerPipelines.get(identity)?.translationMode,
        }));
        return;
      }
      if (data.type === "translation-mode" && data.payload?.translationMode) {
        this.applyParticipantMetadata(identity, JSON.stringify({
          language: this.speakerPipelines.get(identity)?.preferredLanguage || "auto",
          translationMode: data.payload.translationMode,
        }));
      }
    } catch {
      // ignore malformed data messages
    }
  }

  private async publishTranslationMessage(
    message: TranslatorDataMessage,
    destinationIdentities?: string[],
  ): Promise<void> {
    if (!this.room?.localParticipant) return;

    try {
      await this.room.localParticipant.publishData(
        new TextEncoder().encode(JSON.stringify(message)),
        {
          reliable: message.type !== "translation",
          topic: message.type === "translator-state" ? "translation-control" : "translation",
          destination_identities: destinationIdentities,
        },
      );
    } catch (error) {
      logger.debug("TranslatorBot", `[${this.callId}] publishData skipped: ${String(error)}`);
    }
  }

  private async publishState(state: string): Promise<void> {
    await this.publishTranslationMessage({
      type: "translator-state",
      from: this.botIdentity,
      payload: { state, targetLatencyMs: TARGET_LATENCY_MS },
      ts: Date.now(),
    });
  }
}

async function translateTextLowLatency(text: string, fromLang: string, toLang: string): Promise<string> {
  const normalizedText = normalizeSpaces(text);
  if (!normalizedText || fromLang === toLang) {
    return normalizedText;
  }

  const cached = getCachedTranslation(normalizedText, fromLang, toLang);
  if (cached) return cached;

  try {
    const translated = await azureTranslate(normalizedText, fromLang, toLang);
    if (translated) {
      setCachedTranslation(normalizedText, fromLang, toLang, translated);
      return translated;
    }
  } catch (error) {
    logger.debug("TranslatorBot", `azureTranslate fallback for ${fromLang}->${toLang}: ${String(error)}`);
  }

  const translated = await ultraTranslate(normalizedText, fromLang, toLang);
  if (translated) {
    setCachedTranslation(normalizedText, fromLang, toLang, translated);
  }
  return translated || normalizedText;
}

function buildTranslatedTrackName(sourceIdentity: string, targetIdentity: string): string {
  return `translated-for-${encodeURIComponent(targetIdentity)}-from-${encodeURIComponent(sourceIdentity)}`;
}

function readParticipantMetadata(participant: Participant): Record<string, unknown> {
  return safeJsonParse<Record<string, unknown>>(participant.metadata) || {};
}

function isBotParticipant(participant: Participant): boolean {
  const metadata = readParticipantMetadata(participant);
  const role = typeof metadata.role === "string" ? metadata.role : "";
  return role === "bot" || participant.identity === BOT_DEFAULT_IDENTITY || participant.identity.startsWith("assistant-");
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(String(value || ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parsePositiveFloat(value: string | undefined, fallback: number): number {
  const parsed = Number.parseFloat(String(value || ""));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function safeJsonParse<T>(value?: string): T | null {
  try {
    return value ? (JSON.parse(value) as T) : null;
  } catch {
    return null;
  }
}

function decodeIdentityFromToken(token: string): string {
  try {
    const payload = token.split(".")[1];
    if (!payload) return BOT_DEFAULT_IDENTITY;
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const json = JSON.parse(Buffer.from(normalized, "base64").toString("utf8")) as Record<string, unknown>;
    return String(json.sub || json.identity || BOT_DEFAULT_IDENTITY);
  } catch {
    return BOT_DEFAULT_IDENTITY;
  }
}

async function preWarmPair(from: string, to: string): Promise<void> {
  const key = `${from}:${to}`;
  if (preWarmedPairs.has(key)) return;
  preWarmedPairs.add(key);
  try {
    await preWarmCacheForCall(from, to);
  } catch (error) {
    logger.debug("TranslatorBot", `prewarm skipped for ${key}: ${String(error)}`);
  }
}

function bindShutdown(): void {
  if (shutdownBound) return;
  shutdownBound = true;

  const shutdown = async () => {
    await Promise.allSettled(Array.from(activeSessions.keys()).map((callId) => stopBotWorker(callId)));
    await livekitDispose().catch(() => {});
  };

  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}
