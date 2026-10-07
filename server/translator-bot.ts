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
import { VoiceGenderEstimator, type VoiceGender } from "./voice-gender";
import { persistTranslationSegment } from "./modules/transcripts/service";
import { detectEmotionFast, type EmotionState } from "./emotion-engine";
import { runWithTrace } from "./request-context";
import { getClientConfig, setParticipantTrackSubscriptions } from "./livekit-service";
import { createLatencyTrace, type LatencyTrace } from "./latency-audit";
import {
  recordStageLatency,
  recordTranscriptObservation,
  recordVoiceCounter,
  recordVoiceLatency,
} from "./modules/calls/metrics";
import { recordSmartCallMediaActivity } from "./modules/calls/smart-router";
import { logger } from "./observability";
import { buildTranscriptSignalEvent } from "./translation/stt-service";
import {
  buildTranslationFailedEvent,
  buildTranslationReadyEvent,
  resolveListenerTranslationMode,
  shouldDeliverVoiceTranslation,
  shouldTranslateForListener,
  computeNeedsTranslation,
  type ListenerTranslationMode,
} from "./translation/translation-service";
import { buildTtsFailedEvent, buildTtsReadyEvent } from "./translation/tts-service";
import { UtteranceAudioBuffer, refineCodemixTranscript, shouldRefineCodemix } from "./translation/codemix-stt-refiner";
import {
  registerParticipantTranscript,
  resolveDirectionalLanguages,
  setParticipantLanguagePreference,
} from "./universal-language-runtime";
import {
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
import { createManagedStreamingSttSession, getDefaultSttProviderName } from "./providers/stt-provider-registry";
import type { StreamingSttProviderSession, StreamingTranscriptEvent } from "./providers/voice-contracts";
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
const BOT_STOP_DEADLINE_MS = parsePositiveInt(process.env.TRANSLATOR_BOT_STOP_DEADLINE_MS, 3_000);
const TTS_READY_TIMEOUT_MS = parsePositiveInt(process.env.TRANSLATOR_BOT_TTS_READY_TIMEOUT_MS, 3_000);
// Partial transcripts only drive live captions (speech is synthesised from
// finished utterances), so waiting for a few words saves translation requests.
const PARTIAL_MIN_WORDS = parsePositiveInt(process.env.TRANSLATOR_BOT_MIN_PARTIAL_WORDS, 3);
const RESTART_MIN_CHAR_DELTA = parsePositiveInt(process.env.TRANSLATOR_BOT_RESTART_DELTA, 4);
const VAD_THRESHOLD = parsePositiveFloat(process.env.TRANSLATOR_BOT_VAD_THRESHOLD, 0.018);
const SILENCE_RESET_FRAMES = parsePositiveInt(process.env.TRANSLATOR_BOT_SILENCE_RESET_FRAMES, 6);
const AUTO_DETECT_ENABLED = (process.env.TRANSLATOR_BOT_ENABLE_LANGUAGE_DETECT || "true") === "true";
const PRECACHE_ENABLED = (process.env.TRANSLATOR_BOT_ENABLE_PRECACHE || "true") === "true";
const TRANSLATOR_BOT_IDLE_TIMEOUT_MS = parsePositiveInt(process.env.TRANSLATOR_BOT_IDLE_TIMEOUT_MS, 120_000);
const TRANSLATOR_BOT_WATCHDOG_INTERVAL_MS = parsePositiveInt(process.env.TRANSLATOR_BOT_WATCHDOG_INTERVAL_MS, 15_000);
// Translated sentences are spoken in order behind one another, so a
// speaker who talks for a while builds a queue; it is only cut when it
// grows this far behind.
const TRANSLATOR_BOT_MAX_TTS_BACKLOG_SEGMENTS = parsePositiveInt(process.env.TRANSLATOR_BOT_MAX_TTS_BACKLOG_SEGMENTS, 8);
const TRANSLATOR_BOT_MAX_TTS_BACKLOG_MS = parsePositiveInt(process.env.TRANSLATOR_BOT_MAX_TTS_BACKLOG_MS, 20_000);
// A listener must talk this long before their translated audio is stopped
// (barge-in); shorter bursts are usually noise or echo.
const BARGE_IN_MIN_MS = parsePositiveInt(process.env.TRANSLATOR_BOT_BARGE_IN_MS, 600);

interface BotSession {
  callId: string;
  startedAt: number;
  lastActivityAt: number;
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
  deepgram: StreamingSttProviderSession | null;
  audioTask: Promise<void> | null;
  currentTrackSid: string | null;
  recentSilenceFrames: number;
  /** Consecutive voiced frames, for barge-in detection. */
  speechRunFrames: number;
  turnId: string | null;
  turn: SpeakerTurnLatency | null;
  firstSpeechFrameAt: number;
  finalizedSegments: string[];
  lastStartedTranscript: string;
  lastFinalTranscript: string;
  /** Last finished utterance sent to speech, so a repeated final isn't spoken twice. */
  lastSpokenFinal: string;
  latestEmotion: EmotionState | null;
  /** Speaker's voice gender, locked on first use so the voice never flips. */
  voiceGender: VoiceGenderEstimator;
  /** Audio of the utterance in progress, re-recognised for code-mixed speech once it ends. */
  utteranceAudio: UtteranceAudioBuffer;
  lastDeepgramSocketLatencyMs?: number;
  lastMediaHeartbeatAt?: number;
  lastBargeInAt?: number;
  reconnectStartedAt?: number;
  /** Cached answer to "does anyone listening need this speaker translated?" */
  needsTranslation?: boolean;
  needsTranslationCheckedAt?: number;
}

interface OutputChannel {
  key: string;
  sourceIdentity: string;
  targetIdentity: string;
  targetLanguage: string;
  audioSource: AudioSource;
  localTrack: LocalAudioTrack;
  /** Published track SID, used to keep everyone except the target unsubscribed. */
  trackSid: string | null;
  /** Bumped by each new transcript; stale caption translations are dropped. */
  currentGeneration: number;
  /** Bumped only when queued speech must be discarded (barge-in, backlog, close). */
  speechGeneration: number;
  currentTurnId: string | null;
  /** In-flight translation of a partial transcript (captions only). */
  translationAbort: AbortController | null;
  /** In-flight translations of finished utterances; never cancelled by newer speech. */
  finalTranslationAborts: Set<AbortController>;
  ttsAbort: AbortController | null;
  ttsChain: Promise<void>;
  speaking: boolean;
  lastRenderedTranslation: string;
  lastDeliveredFinalTranslation: string;
  pendingTtsSegments: number;
  backlogSinceAt: number | null;
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
let watchdogBound = false;

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
    lastActivityAt: Date.now(),
    status: "starting",
    worker,
  };

  activeSessions.set(callId, session);

  try {
    logger.info("TranslatorBot", `[translator-diag] worker.start START`, { callId });
    await worker.start();
    logger.info("TranslatorBot", `[translator-diag] worker.start RESOLVED`, { callId });
    session.status = "active";
    logger.info("TranslatorBot", `translator bot active for ${callId}`);
  } catch (error) {
    // Only forget our own session: a retry may already have replaced it.
    if (activeSessions.get(callId) === session) activeSessions.delete(callId);
    logger.error("TranslatorBot", `translator bot failed for ${callId}: ${String(error)}`);
    throw error;
  }

  bindShutdown();
  ensureTranslatorBotWatchdog();
}

export async function stopBotWorker(callId: string): Promise<void> {
  const session = activeSessions.get(callId);
  if (!session) return;

  session.status = "ending";
  // Ending a call must not wait on media teardown: a stuck TTS playout or
  // room disconnect previously held the /end request open for minutes.
  // Cleanup carries on in the background after the deadline.
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const stopped = session.worker.stop().then(() => true);
    const finished = await Promise.race([
      stopped,
      new Promise<false>((resolve) => { timer = setTimeout(() => resolve(false), BOT_STOP_DEADLINE_MS); }),
    ]);
    if (!finished) {
      logger.warn("TranslatorBot", `translator bot stop for ${callId} exceeded ${BOT_STOP_DEADLINE_MS}ms; finishing in background`);
      stopped.catch((error) => logger.warn("TranslatorBot", `translator bot background stop error for ${callId}: ${String(error)}`));
    }
  } catch (error) {
    logger.warn("TranslatorBot", `translator bot stop error for ${callId}: ${String(error)}`);
  } finally {
    if (timer) clearTimeout(timer);
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
  /** Channels being published right now, so concurrent transcripts share one track. */
  private readonly pendingOutputChannels = new Map<string, Promise<OutputChannel>>();
  /** Publishes one track at a time: back-to-back publishes left the second track silent for everyone. */
  private publishQueue: Promise<unknown> = Promise.resolve();

  constructor(opts: { callId: string; botToken: string; botIdentity: string }) {
    this.callId = opts.callId;
    this.botToken = opts.botToken;
    this.botIdentity = opts.botIdentity || BOT_DEFAULT_IDENTITY;
  }

  async start(): Promise<void> {
    // Traces the LiveKit connection setup for this call — every log line
    // during room.connect() and its immediate synchronous continuation
    // carries traceId "livekit:<callId>". Event-listener callbacks
    // registered here (Reconnecting/Disconnected/etc.) fire later outside
    // this async chain and are NOT covered by this trace context — they
    // remain correlated the existing way, via `[${this.callId}]` in the
    // log message itself.
    return runWithTrace("livekit", this.callId, () => this.startTraced());
  }

  private async startTraced(): Promise<void> {
    if (PRECACHE_ENABLED) {
      // Pre-warming is a latency optimization for the first spoken phrase --
      // it must never gate call/room establishment. Each underlying
      // translate/TTS call already has its own timeout (3-8s), but running
      // several phrase-pair batches sequentially could still add up to tens
      // of seconds under a slow/degraded provider, which previously stalled
      // room.connect() for that whole time. Fire-and-forget instead, with an
      // explicit .catch() so a rejected pre-warm can never become an
      // unhandled rejection (Promise.allSettled itself never rejects today,
      // but this stays correct even if that changes).
      void Promise.allSettled([
        preWarmPair("en", "hi"),
        preWarmPair("hi", "en"),
        preWarmPair("en", "te"),
        preWarmPair("te", "en"),
      ]).catch((error) => {
        logger.debug("TranslatorBot", `[${this.callId}] background pre-warm failed: ${String(error)}`);
      });
    }

    const room = new Room();

    room
      .on(RoomEvent.Connected, () => {
        this.touchActivity();
        logger.info("TranslatorBot", `[${this.callId}] bot connected to LiveKit room`);
        void this.publishState("ready");
      })
      .on(RoomEvent.Reconnecting, () => {
        this.touchActivity();
        for (const pipeline of Array.from(this.speakerPipelines.values())) {
          pipeline.reconnectStartedAt = Date.now();
        }
        recordVoiceCounter("reconnect_started");
        this.invalidateAllOutputChannels("livekit-reconnecting");
        logger.warn("TranslatorBot", `[${this.callId}] LiveKit reconnecting`);
        void this.publishState("reconnecting");
      })
      .on(RoomEvent.Reconnected, () => {
        this.touchActivity();
        const now = Date.now();
        for (const pipeline of Array.from(this.speakerPipelines.values())) {
          if (pipeline.reconnectStartedAt) {
            recordVoiceLatency("reconnect_recovery_ms", Math.max(0, now - pipeline.reconnectStartedAt));
            pipeline.reconnectStartedAt = undefined;
          }
        }
        recordVoiceCounter("reconnect_recovered");
        this.invalidateAllOutputChannels("livekit-reconnected");
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
      .on(RoomEvent.ParticipantConnected, (participant) => {
        // Someone joining later must not hear other people's translations.
        // An unsubscribe before they've auto-subscribed is a no-op, so retry
        // as the subscriptions settle (same schedule as at publish time).
        for (const delayMs of [0, 500, 1_500, 4_000]) {
          setTimeout(() => {
            if (this.closed) return;
            for (const channel of Array.from(this.outputChannels.values())) {
              void this.restrictOutputTrack(channel, participant.identity);
            }
          }, delayMs);
        }
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
        this.touchActivity();
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

    logger.info("TranslatorBot", `[translator-diag] LiveKit CONNECT START`, { callId: this.callId });
    await room.connect(livekitConfig.url, this.botToken, {
      autoSubscribe: true,
      dynacast: true,
    });
    logger.info("TranslatorBot", `[translator-diag] LiveKit CONNECT RESOLVED`, { callId: this.callId });

    // Stopped while still connecting (startup timeout, call ended): leave at
    // once. Otherwise a closed bot sits in the room looking present while
    // translating nothing, and a retried bot can't take over.
    if (this.closed) {
      await room.disconnect().catch(() => {});
      throw new Error("TRANSLATOR_BOT_STOPPED_DURING_STARTUP");
    }

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
          this.touchActivity();
          if (!pipeline.lastMediaHeartbeatAt || now - pipeline.lastMediaHeartbeatAt >= 1_000) {
            pipeline.lastMediaHeartbeatAt = now;
            void recordSmartCallMediaActivity(this.callId, participant.identity);
          }
          // Same language for everyone listening: they already hear this
          // speaker directly, so skip speech-to-text entirely (no cost, no
          // delay). It starts again the moment someone with a different
          // language joins or switches language.
          if (!this.speakerNeedsTranslation(pipeline, now)) {
            if (pipeline.deepgram) {
              const stt = pipeline.deepgram;
              pipeline.deepgram = null;
              void stt.close().catch(() => {});
              logger.info("TranslatorBot", `[${this.callId}] ${pipeline.identity}: everyone shares their language, speech-to-text paused`);
            }
            continue;
          }
          this.observeVad(pipeline, frame);
          pipeline.voiceGender.push(frame.data);
          await this.ensureDeepgramForPipeline(pipeline);
          const pcm = normalizePcmFrame(frame.data);
          pipeline.utteranceAudio.push(pcm);
          pipeline.deepgram?.send(pcm);
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
      // After a real pause (long past the STT's 250 ms end-of-utterance
      // silence) drop the buffered silence, keeping a short pre-roll.
      if (!pipeline.turnId || pipeline.recentSilenceFrames * FRAME_DURATION_MS >= 1_000) {
        pipeline.utteranceAudio.keepLast(300);
      }
      if (!pipeline.turnId || pipeline.recentSilenceFrames > SILENCE_RESET_FRAMES) {
        pipeline.turnId = randomUUID();
        pipeline.firstSpeechFrameAt = Date.now();
        pipeline.turn = {
          turnId: pipeline.turnId,
          speechStartedAt: pipeline.firstSpeechFrameAt,
          traces: new Map(),
        };
        resetTranscriptMemory(pipeline);
        this.resetChannelStateForSource(pipeline.identity, pipeline.turnId);
      }

      pipeline.recentSilenceFrames = 0;
      pipeline.speechRunFrames += 1;
      // A speaker carrying on talking must not cut the translation of what
      // they already said (it used to be cancelled on every voiced frame, so
      // listeners heard almost nothing). Only a listener who really starts
      // talking over their translated audio stops it.
      if (pipeline.speechRunFrames === Math.ceil(BARGE_IN_MIN_MS / FRAME_DURATION_MS)) {
        pipeline.lastBargeInAt = Date.now();
        recordVoiceCounter("overlap_events");
        this.interruptChannelsForTarget(pipeline.identity, "barge-in");
      }
      return;
    }

    pipeline.recentSilenceFrames += 1;
    if (pipeline.recentSilenceFrames > SILENCE_RESET_FRAMES) {
      pipeline.speechRunFrames = 0;
    }
  }

  /**
   * True when at least one other person in the room wants translation and
   * uses a different language from this speaker (or a language is still
   * unknown, so we must listen to find out). Re-checked about once a second
   * so joins, leaves and in-call language switches take effect quickly.
   */
  private speakerNeedsTranslation(pipeline: SpeakerPipeline, now: number): boolean {
    if (pipeline.needsTranslation !== undefined && now - (pipeline.needsTranslationCheckedAt ?? 0) < 1_000) {
      return pipeline.needsTranslation;
    }
    pipeline.needsTranslation = computeNeedsTranslation(
      pipeline.preferredLanguage,
      this.room ? Array.from(this.room.remoteParticipants.values())
        .filter((p) => p.identity !== pipeline.identity && !isBotParticipant(p))
        .map((p) => {
          const meta = readParticipantMetadata(p);
          const own = this.speakerPipelines.get(p.identity);
          return {
            language: normalizeLanguage(String(own?.preferredLanguage || meta.language || p.attributes?.language || "auto")),
            mode: resolveListenerTranslationMode(own?.translationMode || meta.translationMode),
          };
        }) : [],
    );
    pipeline.needsTranslationCheckedAt = now;
    return pipeline.needsTranslation;
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
      audioTask: null,
      currentTrackSid: null,
      recentSilenceFrames: 0,
      speechRunFrames: 0,
      turnId: null,
      turn: null,
      firstSpeechFrameAt: 0,
      finalizedSegments: [],
      lastStartedTranscript: "",
      lastFinalTranscript: "",
      lastSpokenFinal: "",
      latestEmotion: null,
      voiceGender: new VoiceGenderEstimator(parseVoiceGender(metadata.voiceGender)),
      utteranceAudio: new UtteranceAudioBuffer(),
      lastMediaHeartbeatAt: 0,
      lastBargeInAt: undefined,
      reconnectStartedAt: undefined,
    };

    this.speakerPipelines.set(participant.identity, pipeline);
    await setParticipantLanguagePreference(this.callId, participant.identity, preferredLanguage).catch(() => undefined);
    return pipeline;
  }

  private async ensureDeepgramForPipeline(pipeline: SpeakerPipeline): Promise<void> {
    if (pipeline.deepgram) return;

    // "auto" speakers start on Azure's multi-language identification until a
    // language is detected; starting on "en" transcribed Telugu/Hindi speech
    // as English gibberish, which then defeated the text-based detection.
    const sttLanguage = pipeline.preferredLanguage === "auto" && !pipeline.detectedLanguage
      ? "auto"
      : pipeline.effectiveLanguage;
    pipeline.deepgram = createManagedStreamingSttSession({
      language: sttLanguage,
      onTranscript: (event) => void this.handleTranscript(pipeline.identity, event),
      onSocketOpen: (latencyMs) => {
        pipeline.lastDeepgramSocketLatencyMs = latencyMs;
      },
      onProviderSwitch: (provider, reason) => {
        logger.warn("TranslatorBot", `[${this.callId}] STT provider switched to ${provider} for ${pipeline.identity}: ${reason}`);
      },
      onError: (error) => {
        logger.warn("TranslatorBot", `[${this.callId}] STT error for ${pipeline.identity}: ${error.message}`);
      },
    });

    logger.info("TranslatorBot", `[${this.callId}] ${pipeline.identity}: speech-to-text started (${sttLanguage})`);
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

  private async handleTranscript(identity: string, event: StreamingTranscriptEvent): Promise<void> {
    const pipeline = this.speakerPipelines.get(identity);
    if (!pipeline || this.closed) return;

    // Until text detection settles, trust the language Azure identified from
    // the audio itself (e.g. "te-IN" -> "te") as the translation source.
    if (pipeline.preferredLanguage === "auto" && !pipeline.detectedLanguage && event.language) {
      const spoken = normalizeLanguage(event.language.split("-")[0]);
      if (spoken) pipeline.effectiveLanguage = spoken;
    }

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

    const finalizedText = appendFinalTranscriptSegment(pipeline, text);

    if (event.speechFinal && finalizedText) {
      clearFinalizedTranscriptSegments(pipeline);
      const spokenText = await this.refineCodemixFinal(pipeline, finalizedText);
      pipeline.latestEmotion = detectEmotionFast(spokenText);
      if (pipeline.turn) {
        pipeline.turn.userText = spokenText;
      }
      await this.maybeStartTranslation(pipeline, spokenText, true);
      return;
    }

    if (finalizedText) {
      await this.maybeStartTranslation(pipeline, finalizedText, false);
    }
  }

  /** Final transcript for one finished utterance, corrected for code-mixed speech when possible. */
  private async refineCodemixFinal(pipeline: SpeakerPipeline, streamingText: string): Promise<string> {
    const wav = pipeline.utteranceAudio.takeWav();
    const language = pipeline.effectiveLanguage;
    if (!shouldRefineCodemix(language)) return streamingText;
    const result = await refineCodemixTranscript(wav, language, streamingText);
    logger.debug("TranslatorBot", `[${this.callId}] codemix refine ${result.reason} in ${result.ms}ms for ${pipeline.identity}`);
    if (!result.refined) return streamingText;
    return applySpokenCorrections(result.text, language) || streamingText;
  }

  private async maybeStartTranslation(
    pipeline: SpeakerPipeline,
    transcript: string,
    isFinal: boolean,
  ): Promise<void> {
    // Every finished utterance is spoken once. It used to be skipped when it
    // matched the last partial already sent for captions, so the last
    // sentence of a turn was often never voiced.
    const shouldRestart = isFinal
      ? normalizeTranscript(transcript) !== normalizeTranscript(pipeline.lastSpokenFinal)
      : shouldStartTranslationFromTranscript({
        transcript,
        isFinal,
        partialMinWords: PARTIAL_MIN_WORDS,
        restartMinCharDelta: RESTART_MIN_CHAR_DELTA,
        lastStartedTranscript: pipeline.lastStartedTranscript,
      });
    if (!shouldRestart) return;

    markStartedTranslation(pipeline, transcript);
    if (isFinal) pipeline.lastSpokenFinal = transcript;
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
      // A newer transcript only supersedes the caption translation still in
      // flight. Speech already queued or playing for earlier finished
      // utterances keeps going.
      channel.translationAbort?.abort();
      channel.translationAbort = null;

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
    turnId: string | null;
    sourceLanguage: string;
    targetLanguage: string;
    targetIdentity: string;
    targetMode: ListenerTranslationMode;
    generation: number;
    isFinal: boolean;
  }): Promise<void> {
    // Every log line emitted during this translation turn (including from
    // awaited STT/translation/TTS provider calls) carries a consistent
    // traceId of "translation:<callId>" — see server/request-context.ts.
    return runWithTrace("translation", this.callId, () => this.translateAndSpeakTraced(opts));
  }

  private async translateAndSpeakTraced(opts: {
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
    const trace = this.getOrCreateLatencyTrace(opts.pipeline, opts.channel);
    // Finished utterances are always translated and spoken, in order, unless
    // queued speech is discarded (barge-in). Partial transcripts only feed
    // captions and give way to the next partial.
    const speechGeneration = opts.channel.speechGeneration;
    const isCurrent = (): boolean => {
      if (this.closed) return false;
      if (opts.isFinal) return opts.channel.speechGeneration === speechGeneration;
      if (opts.generation !== opts.channel.currentGeneration) return false;
      if (isTurnOrderMismatch(opts.channel.currentTurnId, opts.turnId)) {
        recordVoiceCounter("turn_order_mismatches");
        return false;
      }
      return true;
    };

    try {
      if (!isCurrent()) return;

      if (opts.pipeline.turn && !opts.pipeline.turn.translationStartedAt) {
        opts.pipeline.turn.translationStartedAt = translationStartedAt;
      }
      trace?.mark("translation_request_start");

      void preWarmPair(opts.sourceLanguage, opts.targetLanguage);

      translationAbort = new AbortController();
      if (opts.isFinal) {
        opts.channel.finalTranslationAborts.add(translationAbort);
      } else {
        opts.channel.translationAbort = translationAbort;
      }
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
            if (!isCurrent()) return;
            const translated = normalizeSpaces(translatedText);
            if (!translated || !shouldEmitStreamingPartial(lastPublishedTranslation, translated)) return;

            lastPublishedTranslation = translated;
            recordRenderedTranslation(opts.channel, translated);
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
            if (!isCurrent()) return;
            const translated = normalizeSpaces(fullTranslatedText);
            if (translated) {
              recordRenderedTranslation(opts.channel, translated);
              if (opts.pipeline.turn) {
                opts.pipeline.turn.translatedText = translated;
              }
            }

            if (opts.isFinal && shouldDeliverVoiceTranslation(opts.targetMode)) {
              this.enqueueTtsSegment(
                opts.channel,
                segment,
                speechGeneration,
                opts.turnId,
                Date.now(),
                opts.pipeline,
                opts.targetLanguage,
                opts.targetMode,
                trace,
              );
            }
          },
          onFinal: (translatedText) => {
            if (!isCurrent()) return;
            const translated = normalizeSpaces(translatedText);
            if (!translated) return;

            if (isDuplicateFinalTranslation(opts.channel, translated)) {
              recordVoiceCounter("duplicate_turns");
            }

            recordDeliveredFinalTranslation(opts.channel, translated);
            if (opts.pipeline.turn) {
              opts.pipeline.turn.translatedText = translated;
            }

            // Fire-and-forget — transcript persistence must never add
            // latency to the live translated-audio delivery path below.
            // Only finished utterances are stored; partials are provisional.
            if (opts.isFinal) void persistTranslationSegment({
              smartCallId: this.callId,
              direction: "caller_to_receiver",
              speakerIdentity: opts.pipeline.identity,
              targetIdentity: opts.targetIdentity,
              originalText: opts.transcript,
              originalLanguage: opts.sourceLanguage,
              translatedText: translated,
              translatedLanguage: opts.targetLanguage,
            }).catch((err) => {
              logger.debug("TranslatorBot", `transcript persistence failed: ${String(err)}`);
            });

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
                // A partial transcript's translation is still provisional;
                // marking it final made captions show each sentence twice.
                partial: !opts.isFinal,
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
      if (translationAbort?.signal.aborted || message === "This operation was aborted") {
        return;
      }
      trace?.markFallback(`translation_runtime_failed:${message}`);
      logger.warn(
        "TranslatorBot",
        `[${this.callId}] translation failed ${opts.pipeline.identity} -> ${opts.targetIdentity}: ${message}`,
      );
      recordVoiceCounter("translation_fallbacks");
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
      if (translationAbort) {
        opts.channel.finalTranslationAborts.delete(translationAbort);
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
    trace: LatencyTrace | null,
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
      .then(() => this.streamTtsSegment(channel, text, generation, turnId, queuedAt, pipeline, targetLanguage, targetMode, trace))
      .catch((error) => {
        logger.warn("TranslatorBot", `[${this.callId}] TTS chain failed for ${channel.key}: ${String(error)}`);
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
    trace: LatencyTrace | null,
  ): Promise<void> {
    // generation is the channel speechGeneration captured when this sentence
    // was queued; a barge-in or backlog reset discards it.
    if (this.closed || generation !== channel.speechGeneration) return;
    const queueAgeMs = Math.max(0, Date.now() - queuedAt);
    if (queueAgeMs >= TRANSLATOR_BOT_MAX_TTS_BACKLOG_MS) {
      recordVoiceCounter("stale_tts_segments");
      trace?.markFallback(`stale_tts_segment:${queueAgeMs}`);
      logger.warn("TranslatorBot", `[${this.callId}] dropped stale queued TTS segment for ${channel.key} after ${queueAgeMs}ms`);
      return;
    }

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
      if (firstByteObserved || timeoutFallbackTriggered || this.closed || generation !== channel.speechGeneration) {
        return;
      }
      timeoutFallbackTriggered = true;
      trace?.markFallback(`tts_ready_timeout:${TTS_READY_TIMEOUT_MS}`);
      logger.warn("TranslatorBot", `[${this.callId}] TTS readiness timeout for ${channel.key} after ${TTS_READY_TIMEOUT_MS}ms`);
      channel.ttsAbort?.abort();
      recordVoiceCounter("translation_fallbacks");
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
      const speakerGender = (this.speakerPipelines.get(channel.sourceIdentity) ?? pipeline).voiceGender.resolve();
      for await (const frame of streamAzureTtsFrames(
        text,
        targetLanguage,
        channel.ttsAbort.signal,
        {
          gender: speakerGender,
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
        if (this.closed || generation !== channel.speechGeneration) break;
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
        recordVoiceCounter("translation_fallbacks");
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
      channel.pendingTtsSegments = Math.max(0, channel.pendingTtsSegments - 1);
      if (channel.pendingTtsSegments === 0) {
        channel.backlogSinceAt = null;
      }
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
    // Two transcripts arriving together used to publish the same track twice
    // (seen in a real group call: two "translated-for-X-from-Y" tracks). The
    // orphan copy was never restricted, so other people heard it.
    const pending = this.pendingOutputChannels.get(key);
    if (pending) {
      const channel = await pending;
      channel.targetLanguage = targetLanguage;
      return channel;
    }
    const creating = this.createOutputChannel(key, sourceIdentity, targetIdentity, targetLanguage);
    this.pendingOutputChannels.set(key, creating);
    try {
      return await creating;
    } finally {
      this.pendingOutputChannels.delete(key);
    }
  }

  private async createOutputChannel(
    key: string,
    sourceIdentity: string,
    targetIdentity: string,
    targetLanguage: string,
  ): Promise<OutputChannel> {
    if (!this.room?.localParticipant) {
      throw new Error("Translator bot is not connected to a LiveKit room");
    }
    const audioSource = new AudioSource(PCM_SAMPLE_RATE, PCM_CHANNELS, 120);
    const trackName = buildTranslatedTrackName(sourceIdentity, targetIdentity);
    const localTrack = LocalAudioTrack.createAudioTrack(trackName, audioSource);
    const options = new TrackPublishOptions();
    // Not MICROPHONE: one participant publishing several microphone tracks
    // (one per listener in a group call) confuses subscriptions.
    options.source = TrackSource.SOURCE_UNKNOWN;

    const room = this.room;
    const publishing = this.publishQueue.then(async () => {
      const pub = await room.localParticipant!.publishTrack(localTrack, options);
      // Let the new track finish negotiating before the next one starts.
      await new Promise((resolve) => setTimeout(resolve, PUBLISH_SETTLE_MS));
      return pub;
    });
    this.publishQueue = publishing.catch(() => undefined);
    const publication = await publishing;

    const channel: OutputChannel = {
      key,
      sourceIdentity,
      targetIdentity,
      targetLanguage,
      audioSource,
      localTrack,
      trackSid: publication?.sid ?? null,
      currentGeneration: 0,
      speechGeneration: 0,
      currentTurnId: null,
      translationAbort: null,
      finalTranslationAborts: new Set(),
      ttsAbort: null,
      ttsChain: Promise.resolve(),
      speaking: false,
      lastRenderedTranslation: "",
      lastDeliveredFinalTranslation: "",
      pendingTtsSegments: 0,
      backlogSinceAt: null,
    };

    this.outputChannels.set(key, channel);
    // An unsubscribe sent before a listener has auto-subscribed to the new
    // track is a no-op, so the restriction is re-applied as the publication
    // propagates (measured: the speaker was still receiving their own
    // translation when it was applied only once, at publish time).
    for (const delayMs of [0, 500, 1_500, 4_000]) {
      setTimeout(() => {
        if (this.closed || !this.room || this.outputChannels.get(key) !== channel) return;
        for (const participant of Array.from(this.room.remoteParticipants.values())) {
          void this.restrictOutputTrack(channel, participant.identity);
        }
      }, delayMs);
    }
    return channel;
  }

  /**
   * A translated track is meant for exactly one listener. Clients auto-
   * subscribe to every track, so without this the speaker would hear their
   * own words translated back and other listeners would hear translations in
   * languages they don't speak. The mobile app has no client-side filter.
   */
  private async restrictOutputTrack(channel: OutputChannel, identity: string): Promise<void> {
    if (!channel.trackSid || !this.room?.name) return;
    if (identity === channel.targetIdentity || identity === this.botIdentity) return;
    try {
      await setParticipantTrackSubscriptions(this.room.name, identity, [channel.trackSid], false);
      logger.info("TranslatorBot", `[${this.callId}] kept ${identity} off ${channel.key} (${channel.trackSid})`);
    } catch (error) {
      logger.warn("TranslatorBot", `[${this.callId}] could not unsubscribe ${identity} from ${channel.key}: ${String(error)}`);
    }
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

  private interruptChannelsForTarget(targetIdentity: string, reason: string): void {
    for (const channel of Array.from(this.outputChannels.values())) {
      if (channel.targetIdentity === targetIdentity) {
        this.interruptChannel(channel, reason);
      }
    }
  }

  private interruptChannel(channel: OutputChannel, _reason: string): void {
    if (channel.speaking || channel.pendingTtsSegments > 0) {
      recordVoiceCounter("ghost_audio_drops");
    }
    channel.speechGeneration += 1;
    channel.translationAbort?.abort();
    channel.translationAbort = null;
    for (const abort of Array.from(channel.finalTranslationAborts)) abort.abort();
    channel.finalTranslationAborts.clear();
    channel.ttsAbort?.abort();
    channel.ttsAbort = null;
    channel.speaking = false;
    channel.pendingTtsSegments = 0;
    channel.backlogSinceAt = null;
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

  private shouldTripTtsBacklogWatchdog(channel: OutputChannel): boolean {
    if (channel.pendingTtsSegments >= TRANSLATOR_BOT_MAX_TTS_BACKLOG_SEGMENTS) {
      return true;
    }
    return Boolean(channel.backlogSinceAt && Date.now() - channel.backlogSinceAt >= TRANSLATOR_BOT_MAX_TTS_BACKLOG_MS);
  }

  private handleBacklogWatchdog(channel: OutputChannel, targetMode: ListenerTranslationMode, reason: string): void {
    recordVoiceCounter("audio_backlog_events");
    recordVoiceCounter("translation_fallbacks");
    logger.warn("TranslatorBot", `[${this.callId}] output backlog watchdog tripped for ${channel.key}: ${reason}`);
    channel.currentGeneration += 1;
    this.interruptChannel(channel, reason);
    void this.publishTranslationMessage({
      type: "translation-fallback",
      from: this.botIdentity,
      payload: buildTtsFailedEvent({
        sourceIdentity: channel.sourceIdentity,
        targetIdentity: channel.targetIdentity,
        translatedText: channel.lastRenderedTranslation || undefined,
        reason: "Audio playback was reset to keep the conversation stable. Text translation remains available.",
        translationMode: targetMode,
      }),
      ts: Date.now(),
    }, [channel.targetIdentity]);
  }

  private invalidateAllOutputChannels(reason: string): void {
    for (const channel of Array.from(this.outputChannels.values())) {
      channel.currentGeneration += 1;
      channel.currentTurnId = null;
      this.interruptChannel(channel, reason);
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
    trace.addProvider(`${getDefaultSttProviderName()}-stream`);
    if (pipeline.lastDeepgramSocketLatencyMs != null) {
      trace.addObservedNetworkLatency("stt_socket_open", pipeline.lastDeepgramSocketLatencyMs);
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

  private touchActivity(): void {
    const session = activeSessions.get(this.callId);
    if (session) {
      session.lastActivityAt = Date.now();
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

const PUBLISH_SETTLE_MS = parsePositiveInt(process.env.TRANSLATOR_PUBLISH_SETTLE_MS, 400);

function buildTranslatedTrackName(sourceIdentity: string, targetIdentity: string): string {
  return `translated-for-${encodeURIComponent(targetIdentity)}-from-${encodeURIComponent(sourceIdentity)}`;
}

function parseVoiceGender(value: unknown): VoiceGender | null {
  return value === "male" || value === "female" ? value : null;
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

function ensureTranslatorBotWatchdog(): void {
  if (watchdogBound) return;
  watchdogBound = true;

  setInterval(() => {
    const now = Date.now();
    for (const [callId, session] of Array.from(activeSessions.entries())) {
      if (session.status === "ending") continue;
      if (now - session.lastActivityAt < TRANSLATOR_BOT_IDLE_TIMEOUT_MS) continue;
      logger.warn("TranslatorBot", `Stopping stale translator bot ${callId}`, {
        idleMs: now - session.lastActivityAt,
      });
      void stopBotWorker(callId).catch((error) => {
        logger.warn("TranslatorBot", `Failed to stop stale translator bot ${callId}: ${String(error)}`);
      });
    }
  }, TRANSLATOR_BOT_WATCHDOG_INTERVAL_MS).unref?.();
}
