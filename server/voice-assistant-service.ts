import { randomUUID } from "crypto";
import OpenAI from "openai";
import {
  AudioFrame,
  AudioSource,
  AudioStream,
  LocalAudioTrack,
  RemoteAudioTrack,
  Room,
  RoomEvent,
  TrackPublishOptions,
  TrackSource,
  dispose as livekitDispose,
} from "@livekit/rtc-node";
import { createCallRoom, endCallRoom, getClientConfig, issueAccessToken, issueBotToken } from "./livekit-service";
import { logger } from "./observability";
import { detectEmotionFast, type EmotionState } from "./emotion-engine";
import {
  FRAME_DURATION_MS,
  PCM_CHANNELS,
  PCM_SAMPLE_RATE,
  applySpokenCorrections,
  computeRms,
  normalizeLanguage,
  normalizePcmFrame,
  normalizeSpaces,
  normalizeTranscript,
  streamAzureTtsFrames,
  wordCount,
} from "./realtime-translation-core";
import { createManagedStreamingSttSession } from "./providers/stt-provider-registry";
import type { StreamingSttProviderSession, StreamingTranscriptEvent } from "./providers/voice-contracts";
import { createLinkedAbortController, runWithResilience } from "./voice-resilience";

const DEFAULT_TARGET_LATENCY_MS = parsePositiveInt(process.env.VOICE_ASSISTANT_TARGET_LATENCY_MS, 900);
const MAX_CONTEXT_TURNS = parsePositiveInt(process.env.VOICE_ASSISTANT_MAX_CONTEXT_TURNS, 6);
const OPENAI_MODEL = process.env.OPENAI_VOICE_ASSISTANT_MODEL || "gpt-4.1-mini";
const DEEPGRAM_MODEL = process.env.DEEPGRAM_STT_MODEL || "nova-3";
const LLM_MAX_TOKENS = parsePositiveInt(process.env.OPENAI_VOICE_ASSISTANT_MAX_TOKENS, 96);
const LLM_STREAM_TIMEOUT_MS = parsePositiveInt(process.env.OPENAI_VOICE_ASSISTANT_TIMEOUT_MS, 8_000);
const LLM_START_MIN_WORDS = parsePositiveInt(process.env.VOICE_ASSISTANT_MIN_PARTIAL_WORDS, 1);
const LLM_RESTART_MIN_CHAR_DELTA = parsePositiveInt(process.env.VOICE_ASSISTANT_RESTART_DELTA, 4);
const PRECACHE_ENABLED = (process.env.VOICE_ASSISTANT_ENABLE_PRECACHE || "true") === "true";
const VOICE_ASSISTANT_IDLE_TIMEOUT_MS = parsePositiveInt(process.env.VOICE_ASSISTANT_IDLE_TIMEOUT_MS, 120_000);
const VOICE_ASSISTANT_WATCHDOG_INTERVAL_MS = parsePositiveInt(process.env.VOICE_ASSISTANT_WATCHDOG_INTERVAL_MS, 15_000);
const DEFAULT_SYSTEM_PROMPT =
  process.env.VOICE_ASSISTANT_SYSTEM_PROMPT ||
  "You are NeuraTalk Voice Assistant. Reply in short spoken sentences for live audio. Keep answers concise, helpful, and natural. Avoid bullet points, markdown, and long preambles. If the user interrupts, stop immediately and continue from the latest input.";

const openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY || process.env.OPENAI_API_KEY || "",
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});

const PREWARM_PHRASES = {
  greeting: "Hello, how can I help?",
  filler: "One moment.",
  ready: "I'm ready.",
} as const;

const assistantSessions = new Map<string, VoiceAssistantSessionRecord>();
let shutdownBound = false;
let watchdogBound = false;

export interface CreateVoiceAssistantSessionInput {
  userId: number;
  displayName: string;
  language: string;
  assistantName?: string;
  systemPrompt?: string;
}

export interface VoiceAssistantSessionResponse {
  sessionId: string;
  roomName: string;
  livekitUrl: string;
  livekitToken: string;
  assistantIdentity: string;
  targetLatencyMs: number;
  sampleRate: number;
  frameDurationMs: number;
  transport: "livekit-webrtc";
}

export interface VoiceAssistantHealth {
  configured: boolean;
  livekit: boolean;
  deepgramFallback: boolean;
  openai: boolean;
  azure: boolean;
  targetLatencyMs: number;
  model: {
    deepgram: string;
    openai: string;
    azureRegion: string;
  };
}

export interface VoiceAssistantSessionSummary {
  sessionId: string;
  roomName: string;
  userId: number;
  language: string;
  assistantIdentity: string;
  status: "starting" | "active" | "stopping" | "stopped" | "error";
  createdAt: string;
  lastActivityAt: string;
}

interface VoiceAssistantSessionRecord {
  sessionId: string;
  roomName: string;
  userId: number;
  language: string;
  assistantIdentity: string;
  createdAt: Date;
  lastActivityAt: Date;
  status: "starting" | "active" | "stopping" | "stopped" | "error";
  worker: UltraLowLatencyVoiceAssistantWorker;
}

interface VoiceAssistantDataEvent {
  type:
    | "assistant.ready"
    | "assistant.partial"
    | "assistant.final"
    | "assistant.interrupted"
    | "emotion.update"
    | "transcript.partial"
    | "transcript.final"
    | "latency.turn"
    | "network.state"
    | "error";
  text?: string;
  reason?: string;
  generation?: number;
  state?: string;
  stage?: string;
  metrics?: TurnLatencySnapshot;
  emotion?: {
    source: "user" | "assistant";
    emotion: EmotionState["emotion"];
    intensity: number;
  };
  ts: string;
}

interface TurnLatency {
  turnId: string;
  speechStartedAt?: number;
  firstTranscriptAt?: number;
  finalTranscriptAt?: number;
  llmStartedAt?: number;
  firstTokenAt?: number;
  ttsStartedAt?: number;
  firstAudioAt?: number;
  finalAudioAt?: number;
  lastUserText?: string;
  lastAssistantText?: string;
}

interface TurnLatencySnapshot {
  turnId: string;
  sttFirstPartialMs: number | null;
  sttFinalMs: number | null;
  llmFirstTokenMs: number | null;
  ttsFirstAudioMs: number | null;
  perceivedLatencyMs: number | null;
  totalTurnMs: number | null;
  targetLatencyMs: number;
}

export function getVoiceAssistantHealth(): VoiceAssistantHealth {
  return {
    configured:
      Boolean(process.env.LIVEKIT_URL && process.env.LIVEKIT_API_KEY && process.env.LIVEKIT_API_SECRET) &&
      Boolean(process.env.AI_INTEGRATIONS_OPENAI_API_KEY || process.env.OPENAI_API_KEY) &&
      Boolean(process.env.AZURE_SPEECH_KEY && process.env.AZURE_SPEECH_REGION),
    livekit: Boolean(process.env.LIVEKIT_URL && process.env.LIVEKIT_API_KEY && process.env.LIVEKIT_API_SECRET),
    deepgramFallback: Boolean(process.env.DEEPGRAM_API_KEY),
    openai: Boolean(process.env.AI_INTEGRATIONS_OPENAI_API_KEY || process.env.OPENAI_API_KEY),
    azure: Boolean(process.env.AZURE_SPEECH_KEY && process.env.AZURE_SPEECH_REGION),
    targetLatencyMs: DEFAULT_TARGET_LATENCY_MS,
    model: {
      deepgram: DEEPGRAM_MODEL,
      openai: OPENAI_MODEL,
      azureRegion: process.env.AZURE_SPEECH_REGION || "centralindia",
    },
  };
}

export function listVoiceAssistantSessions(): VoiceAssistantSessionSummary[] {
  return Array.from(assistantSessions.values()).map((session) => ({
    sessionId: session.sessionId,
    roomName: session.roomName,
    userId: session.userId,
    language: session.language,
    assistantIdentity: session.assistantIdentity,
    status: session.status,
    createdAt: session.createdAt.toISOString(),
    lastActivityAt: session.lastActivityAt.toISOString(),
  }));
}

export function getVoiceAssistantSession(sessionId: string): VoiceAssistantSessionSummary | null {
  const session = assistantSessions.get(sessionId);
  if (!session) return null;
  return {
    sessionId: session.sessionId,
    roomName: session.roomName,
    userId: session.userId,
    language: session.language,
    assistantIdentity: session.assistantIdentity,
    status: session.status,
    createdAt: session.createdAt.toISOString(),
    lastActivityAt: session.lastActivityAt.toISOString(),
  };
}

export async function createVoiceAssistantSession(
  input: CreateVoiceAssistantSessionInput,
): Promise<VoiceAssistantSessionResponse> {
  const health = getVoiceAssistantHealth();
  if (!health.configured) {
    throw new Error("Voice assistant dependencies are not configured");
  }

  const sessionId = randomUUID();
  const roomName = `voice-assistant-${sessionId}`;
  const assistantIdentity = `assistant-${sessionId}`;

  await createCallRoom({
    callId: roomName,
    maxParticipants: 4,
    emptyTimeoutSec: 120,
    metadata: {
      kind: "voice-assistant",
      sessionId,
      language: input.language,
      assistantIdentity,
    },
  });

  const userToken = await issueAccessToken(
    roomName,
    {
      userId: String(input.userId),
      displayName: input.displayName,
      language: input.language,
      role: "caller",
    },
    60 * 60,
  );

  const botToken = await issueBotToken(roomName, assistantIdentity);
  const worker = new UltraLowLatencyVoiceAssistantWorker({
    roomName,
    botToken,
    assistantIdentity,
    language: input.language,
    assistantName: input.assistantName,
    systemPrompt: input.systemPrompt,
    onActivity: () => {
      const session = assistantSessions.get(sessionId);
      if (session) session.lastActivityAt = new Date();
    },
    onStatusChange: (status) => {
      const session = assistantSessions.get(sessionId);
      if (session) session.status = status;
    },
  });

  assistantSessions.set(sessionId, {
    sessionId,
    roomName,
    userId: input.userId,
    language: input.language,
    assistantIdentity,
    createdAt: new Date(),
    lastActivityAt: new Date(),
    status: "starting",
    worker,
  });

  try {
    await worker.start();
    const session = assistantSessions.get(sessionId);
    if (session) session.status = "active";
  } catch (error) {
    assistantSessions.delete(sessionId);
    await safeEndRoom(roomName);
    throw error;
  }

  bindVoiceAssistantShutdown();
  ensureVoiceAssistantWatchdog();
  const livekitConfig = getClientConfig();
  if (!livekitConfig.url) {
    throw new Error("LiveKit is not configured");
  }

  return {
    sessionId,
    roomName,
    livekitUrl: livekitConfig.url,
    livekitToken: userToken,
    assistantIdentity,
    targetLatencyMs: DEFAULT_TARGET_LATENCY_MS,
    sampleRate: PCM_SAMPLE_RATE,
    frameDurationMs: FRAME_DURATION_MS,
    transport: "livekit-webrtc",
  };
}

export async function endVoiceAssistantSession(sessionId: string): Promise<boolean> {
  const session = assistantSessions.get(sessionId);
  if (!session) return false;

  session.status = "stopping";
  try {
    await session.worker.stop();
  } finally {
    session.status = "stopped";
    assistantSessions.delete(sessionId);
    await safeEndRoom(session.roomName);
  }

  return true;
}

class UltraLowLatencyVoiceAssistantWorker {
  private readonly roomName: string;
  private readonly botToken: string;
  private readonly assistantIdentity: string;
  private readonly language: string;
  private readonly assistantName: string;
  private readonly systemPrompt: string;
  private readonly onActivity: () => void;
  private readonly onStatusChange: (status: VoiceAssistantSessionRecord["status"]) => void;
  private readonly conversation = new ConversationMemory(MAX_CONTEXT_TURNS);
  private readonly preCachedPhrases = new Map<string, Int16Array[]>();
  private readonly audioConsumers = new Map<string, Promise<void>>();

  private room: Room | null = null;
  private audioSource: AudioSource | null = null;
  private localTrack: LocalAudioTrack | null = null;
  private deepgram: StreamingSttProviderSession | null = null;
  private llmAbort: AbortController | null = null;
  private ttsAbort: AbortController | null = null;
  private ttsChain: Promise<void> = Promise.resolve();
  private currentGeneration = 0;
  private lastStartedTranscript = "";
  private lastFinalTranscript = "";
  private draftTranscript = "";
  private finalizedSegments: string[] = [];
  private closed = false;
  private agentSpeaking = false;
  private recentSilenceFrames = 0;
  private currentTurn: TurnLatency | null = null;
  private firstSpeechFrameAt = 0;
  private latestUserEmotion: EmotionState | null = null;

  constructor(opts: {
    roomName: string;
    botToken: string;
    assistantIdentity: string;
    language: string;
    assistantName?: string;
    systemPrompt?: string;
    onActivity: () => void;
    onStatusChange: (status: VoiceAssistantSessionRecord["status"]) => void;
  }) {
    this.roomName = opts.roomName;
    this.botToken = opts.botToken;
    this.assistantIdentity = opts.assistantIdentity;
    this.language = normalizeLanguage(opts.language);
    this.assistantName = opts.assistantName || "NeuraTalk Assistant";
    this.systemPrompt = buildSystemPrompt(this.language, this.assistantName, opts.systemPrompt);
    this.onActivity = opts.onActivity;
    this.onStatusChange = opts.onStatusChange;
  }

  async start(): Promise<void> {
    this.onStatusChange("starting");

    if (PRECACHE_ENABLED) {
      await Promise.allSettled(
        Object.entries(PREWARM_PHRASES).map(async ([key, text]) => {
          const frames = await synthesizeTextToFrames(text, this.language);
          this.preCachedPhrases.set(key, frames);
        }),
      );
    }

    const room = new Room();
    room
      .on(RoomEvent.Connected, () => {
        this.onStatusChange("active");
        void this.publishEvent({ type: "assistant.ready", ts: new Date().toISOString() });
      })
      .on(RoomEvent.Reconnecting, () => {
        void this.publishEvent({
          type: "network.state",
          ts: new Date().toISOString(),
          state: "reconnecting",
        });
      })
      .on(RoomEvent.Reconnected, () => {
        void this.publishEvent({
          type: "network.state",
          ts: new Date().toISOString(),
          state: "reconnected",
        });
      })
      .on(RoomEvent.Disconnected, () => {
        if (!this.closed) {
          this.onStatusChange("error");
        }
      })
      .on(RoomEvent.TrackSubscribed, (track, _publication, participant) => {
        if (participant.identity === this.assistantIdentity) return;
        if (!(track instanceof RemoteAudioTrack)) return;
        void this.consumeRemoteAudio(participant.identity, track);
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
    this.audioSource = new AudioSource(PCM_SAMPLE_RATE, PCM_CHANNELS, 120);
    this.localTrack = LocalAudioTrack.createAudioTrack("assistant-audio", this.audioSource);

    const publishOptions = new TrackPublishOptions();
    publishOptions.source = TrackSource.SOURCE_MICROPHONE;

    if (!room.localParticipant || !this.localTrack) {
      throw new Error("LiveKit participant is not ready");
    }

    await room.localParticipant.publishTrack(this.localTrack, publishOptions);
    await this.ensureDeepgram();
  }

  async stop(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.onStatusChange("stopping");

    this.interruptCurrentSpeech("session-ended");
    await this.deepgram?.close();
    this.deepgram = null;

    await Promise.allSettled(Array.from(this.audioConsumers.values()));
    this.audioConsumers.clear();

    if (this.localTrack) {
      await this.localTrack.close(true).catch(() => {});
      this.localTrack = null;
    }

    if (this.audioSource) {
      await this.audioSource.close().catch(() => {});
      this.audioSource = null;
    }

    if (this.room) {
      await this.room.disconnect().catch(() => {});
      this.room = null;
    }
  }

  private async ensureDeepgram(): Promise<void> {
    if (this.deepgram) return;
    this.deepgram = createManagedStreamingSttSession({
      language: this.language,
      endpointingMs: 90,
      utteranceEndMs: 240,
      onTranscript: (event) => void this.handleTranscript(event),
      onProviderSwitch: (provider, reason) => {
        logger.warn("VoiceAssistant", `STT provider switched to ${provider} in ${this.roomName}: ${reason}`);
      },
      onError: (error) => {
        logger.warn("VoiceAssistant", `STT error in ${this.roomName}: ${error.message}`);
        void this.publishEvent({
          type: "error",
          ts: new Date().toISOString(),
          stage: "stt",
          reason: error.message,
        });
      },
    });
    await this.deepgram.connect();
  }

  private async consumeRemoteAudio(identity: string, track: RemoteAudioTrack): Promise<void> {
    if (this.audioConsumers.has(identity) || this.closed) return;

    const task = (async () => {
      const audioStream = new AudioStream(track, {
        sampleRate: PCM_SAMPLE_RATE,
        numChannels: PCM_CHANNELS,
        frameSizeMs: FRAME_DURATION_MS,
      });

      try {
        for await (const frame of audioStream as unknown as AsyncIterable<AudioFrame>) {
          if (this.closed) break;
          this.onActivity();
          await this.ensureDeepgram();
          this.observeVad(frame);
          this.deepgram?.send(normalizePcmFrame(frame.data));
        }
      } catch (error) {
        logger.warn("VoiceAssistant", `Audio stream closed for ${identity}: ${String(error)}`);
      }
    })();

    this.audioConsumers.set(identity, task);
    try {
      await task;
    } finally {
      this.audioConsumers.delete(identity);
    }
  }

  private observeVad(frame: AudioFrame): void {
    const rms = computeRms(frame.data);
    const speaking = rms > 0.018;

    if (speaking) {
      if (!this.firstSpeechFrameAt || this.recentSilenceFrames > 6) {
        this.firstSpeechFrameAt = Date.now();
        this.currentTurn = {
          turnId: randomUUID(),
          speechStartedAt: this.firstSpeechFrameAt,
        };
      }
      this.recentSilenceFrames = 0;
      if (this.agentSpeaking) {
        this.interruptCurrentSpeech("barge-in");
      }
      return;
    }

    this.recentSilenceFrames += 1;
  }

  private async handleTranscript(event: StreamingTranscriptEvent): Promise<void> {
    const text = normalizeSpaces(applySpokenCorrections(event.text, this.language));
    if (!text) return;

    if (this.currentTurn && !this.currentTurn.firstTranscriptAt) {
      this.currentTurn.firstTranscriptAt = Date.now();
    }

    if (!event.isFinal) {
      this.draftTranscript = text;
      void this.publishEvent({
        type: "transcript.partial",
        text,
        ts: new Date().toISOString(),
      });
      if (wordCount(text) >= LLM_START_MIN_WORDS) {
        this.maybeStartAssistantResponse(text, false);
      }
      return;
    }

    this.finalizedSegments.push(text);
    const finalizedText = normalizeSpaces(this.finalizedSegments.join(" "));
    if (finalizedText) {
      this.lastFinalTranscript = finalizedText;
    }

    if (event.speechFinal && finalizedText) {
      if (this.currentTurn) {
        this.currentTurn.finalTranscriptAt = Date.now();
        this.currentTurn.lastUserText = finalizedText;
      }
      this.latestUserEmotion = detectEmotionFast(finalizedText);
      void this.publishEvent({
        type: "emotion.update",
        ts: new Date().toISOString(),
        emotion: {
          source: "user",
          emotion: this.latestUserEmotion.emotion,
          intensity: this.latestUserEmotion.intensity,
        },
      });
      this.finalizedSegments = [];
      this.draftTranscript = "";
      void this.publishEvent({
        type: "transcript.final",
        text: finalizedText,
        ts: new Date().toISOString(),
      });

      if (isQuickGreeting(finalizedText) && this.preCachedPhrases.has("greeting")) {
        const generation = this.currentGeneration + 1;
        this.interruptCurrentSpeech("quick-reply");
        this.currentGeneration = generation;
        const greetingText = PREWARM_PHRASES.greeting;
        if (this.currentTurn) {
          this.currentTurn.lastAssistantText = greetingText;
        }
        await this.playCachedPhrase("greeting", generation);
        this.conversation.appendTurn(finalizedText, greetingText);
        void this.publishEvent({
          type: "assistant.final",
          text: greetingText,
          generation,
          ts: new Date().toISOString(),
        });
        this.finishTurnMetrics();
        return;
      }

      this.maybeStartAssistantResponse(finalizedText, true);
      return;
    }

    if (finalizedText) {
      this.maybeStartAssistantResponse(finalizedText, false);
    }
  }

  private maybeStartAssistantResponse(transcript: string, isFinal: boolean): void {
    const normalized = normalizeTranscript(transcript);
    if (!normalized) return;

    const lastNormalized = normalizeTranscript(this.lastStartedTranscript);
    const shouldRestart = isFinal
      ? normalized !== lastNormalized &&
        (!lastNormalized || !normalized.startsWith(lastNormalized) || normalized.length - lastNormalized.length >= LLM_RESTART_MIN_CHAR_DELTA)
      : (!lastNormalized && wordCount(transcript) >= LLM_START_MIN_WORDS) ||
        (lastNormalized &&
          normalized !== lastNormalized &&
          (!normalized.startsWith(lastNormalized) || normalized.length - lastNormalized.length >= LLM_RESTART_MIN_CHAR_DELTA));

    if (!shouldRestart) return;
    void this.startAssistantResponse(transcript, isFinal);
  }

  private async startAssistantResponse(transcript: string, isFinal: boolean): Promise<void> {
    const generation = this.currentGeneration + 1;
    this.interruptCurrentSpeech(isFinal ? "new-final" : "new-partial");

    this.currentGeneration = generation;
    this.lastStartedTranscript = transcript;
    this.llmAbort = new AbortController();
    this.ttsAbort = new AbortController();

    if (this.currentTurn && !this.currentTurn.llmStartedAt) {
      this.currentTurn.llmStartedAt = Date.now();
    }

    const fillerTimer = setTimeout(() => {
      if (!this.closed && generation === this.currentGeneration && this.preCachedPhrases.has("filler")) {
        void this.playCachedPhrase("filler", generation);
      }
    }, 350);

    const responseBuffer: string[] = [];
    const chunker = new SpeakableChunker();
    const linkedAbort = createLinkedAbortController({
      signal: this.llmAbort.signal,
      timeoutMs: LLM_STREAM_TIMEOUT_MS,
      label: `voice-assistant ${this.roomName}`,
    });

    try {
      const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
        { role: "system", content: this.systemPrompt },
        ...(this.latestUserEmotion ? [{ role: "system" as const, content: buildEmotionGuidance(this.latestUserEmotion) }] : []),
        ...this.conversation.toMessages(),
        { role: "user", content: transcript },
      ];

      const stream = await runWithResilience(
        async (signal) => openai.chat.completions.create(
          {
            model: OPENAI_MODEL,
            stream: true,
            temperature: 0.2,
            max_tokens: LLM_MAX_TOKENS,
            messages,
          },
          {
            signal,
          } as any,
        ),
        {
          provider: "openai-voice-assistant",
          operation: "respond",
          timeoutMs: LLM_STREAM_TIMEOUT_MS,
          retries: 1,
          retryDelayMs: 200,
          signal: linkedAbort.controller.signal,
          metadata: {
            roomName: this.roomName,
            language: this.language,
          },
        },
      );

      for await (const chunk of stream) {
        if (this.closed || generation !== this.currentGeneration) break;

        const token = chunk.choices?.[0]?.delta?.content || "";
        if (!token) continue;

        clearTimeout(fillerTimer);
        responseBuffer.push(token);

        if (this.currentTurn && !this.currentTurn.firstTokenAt) {
          this.currentTurn.firstTokenAt = Date.now();
        }

        const partialText = responseBuffer.join("");
        void this.publishEvent({
          type: "assistant.partial",
          text: partialText,
          generation,
          ts: new Date().toISOString(),
        });

        const readySegments = chunker.feed(token);
        for (const segment of readySegments) {
          this.enqueueTtsSegment(segment, generation);
        }
      }

      clearTimeout(fillerTimer);
      const tail = chunker.flush();
      if (tail) {
        this.enqueueTtsSegment(tail, generation);
      }

      await this.ttsChain.catch(() => {});

      if (generation === this.currentGeneration) {
        const finalText = normalizeSpaces(responseBuffer.join(""));
        if (finalText) {
          if (this.currentTurn) {
            this.currentTurn.lastAssistantText = finalText;
          }
          this.conversation.appendTurn(this.lastFinalTranscript || transcript, finalText);
          void this.publishEvent({
            type: "assistant.final",
            text: finalText,
            generation,
            ts: new Date().toISOString(),
          });
          this.finishTurnMetrics();
        }
      }
    } catch (error) {
      clearTimeout(fillerTimer);
      const message = error instanceof Error ? error.message : String(error);
      if (generation === this.currentGeneration && !this.closed && message !== "This operation was aborted") {
        logger.warn("VoiceAssistant", `OpenAI stream failed in ${this.roomName}: ${message}`);
        void this.publishEvent({
          type: "error",
          stage: "llm",
          reason: message,
          ts: new Date().toISOString(),
        });
      }
    } finally {
      linkedAbort.cleanup();
    }
  }

  private enqueueTtsSegment(segment: string, generation: number): void {
    const clean = normalizeSpaces(segment);
    if (!clean) return;

    this.ttsChain = this.ttsChain
      .then(() => this.streamTtsSegment(clean, generation))
      .catch((error) => {
        logger.warn("VoiceAssistant", `TTS chain error in ${this.roomName}: ${String(error)}`);
      });
  }

  private async streamTtsSegment(text: string, generation: number): Promise<void> {
    if (this.closed || generation !== this.currentGeneration || !this.audioSource || !this.ttsAbort) return;

    if (this.currentTurn && !this.currentTurn.ttsStartedAt) {
      this.currentTurn.ttsStartedAt = Date.now();
    }

    this.agentSpeaking = true;
    const assistantEmotion = detectEmotionFast(text);
    void this.publishEvent({
      type: "emotion.update",
      ts: new Date().toISOString(),
      emotion: {
        source: "assistant",
        emotion: assistantEmotion.emotion,
        intensity: assistantEmotion.intensity,
      },
    });

    try {
      for await (const frame of streamAzureTtsFrames(text, this.language, this.ttsAbort.signal, {
        onFirstByte: () => {
          if (this.currentTurn && !this.currentTurn.firstAudioAt) {
            this.currentTurn.firstAudioAt = Date.now();
          }
        },
        emotion: assistantEmotion,
        userAgent: "NeuraTalk/VoiceAssistant",
      })) {
        if (this.closed || generation !== this.currentGeneration || !this.audioSource) break;
        await this.audioSource.captureFrame(new AudioFrame(frame, PCM_SAMPLE_RATE, PCM_CHANNELS, frame.length));
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message !== "This operation was aborted") {
        void this.publishEvent({
          type: "error",
          stage: "tts",
          reason: message,
          ts: new Date().toISOString(),
        });
      }
    } finally {
      if (generation === this.currentGeneration) {
        this.agentSpeaking = false;
      }
      if (this.currentTurn) {
        this.currentTurn.finalAudioAt = Date.now();
      }
    }
  }

  private interruptCurrentSpeech(reason: string): void {
    this.llmAbort?.abort();
    this.ttsAbort?.abort();
    this.llmAbort = null;
    this.ttsAbort = null;
    this.agentSpeaking = false;
    this.lastStartedTranscript = "";

    if (this.audioSource) {
      this.audioSource.clearQueue();
    }

    void this.publishEvent({
      type: "assistant.interrupted",
      reason,
      generation: this.currentGeneration,
      ts: new Date().toISOString(),
    });
  }

  private async playCachedPhrase(key: keyof typeof PREWARM_PHRASES, generation: number): Promise<void> {
    const frames = this.preCachedPhrases.get(key);
    if (!frames || !this.audioSource || this.closed) return;

    this.agentSpeaking = true;
    try {
      for (const frame of frames) {
        if (this.closed || generation !== this.currentGeneration) break;
        await this.audioSource.captureFrame(new AudioFrame(frame, PCM_SAMPLE_RATE, PCM_CHANNELS, frame.length));
      }
    } catch (error) {
      logger.warn("VoiceAssistant", `Cached phrase playback failed: ${String(error)}`);
    } finally {
      if (generation === this.currentGeneration) {
        this.agentSpeaking = false;
      }
    }
  }

  private finishTurnMetrics(): void {
    if (!this.currentTurn) return;

    const snapshot = buildTurnLatencySnapshot(this.currentTurn);
    logger.info(
      "VoiceAssistant",
      `[${this.roomName}] turn=${snapshot.turnId} sttFirst=${snapshot.sttFirstPartialMs ?? "n/a"}ms llmFirst=${snapshot.llmFirstTokenMs ?? "n/a"}ms ttsFirst=${snapshot.ttsFirstAudioMs ?? "n/a"}ms perceived=${snapshot.perceivedLatencyMs ?? "n/a"}ms total=${snapshot.totalTurnMs ?? "n/a"}ms`,
      {
        userText: this.currentTurn.lastUserText,
        assistantText: this.currentTurn.lastAssistantText,
      },
    );

    void this.publishEvent({
      type: "latency.turn",
      metrics: snapshot,
      ts: new Date().toISOString(),
    });
    this.currentTurn = null;
  }

  private async publishEvent(event: VoiceAssistantDataEvent): Promise<void> {
    if (!this.room?.localParticipant) return;
    try {
      await this.room.localParticipant.publishData(
        new TextEncoder().encode(JSON.stringify(event)),
        {
          reliable: !event.type.endsWith(".partial"),
          topic: "voice-assistant",
        },
      );
    } catch (error) {
      logger.debug("VoiceAssistant", `publishEvent skipped: ${String(error)}`);
    }
  }
}

class ConversationMemory {
  private readonly turns: Array<{ role: "user" | "assistant"; content: string }> = [];

  constructor(private readonly maxTurns: number) {}

  appendTurn(userText: string, assistantText: string): void {
    if (userText) {
      this.turns.push({ role: "user", content: userText });
    }
    if (assistantText) {
      this.turns.push({ role: "assistant", content: assistantText });
    }
    while (this.turns.length > this.maxTurns * 2) {
      this.turns.shift();
    }
  }

  toMessages(): OpenAI.Chat.Completions.ChatCompletionMessageParam[] {
    return this.turns.map((turn) => ({
      role: turn.role,
      content: turn.content,
    }));
  }
}

class SpeakableChunker {
  private buffer = "";

  feed(token: string): string[] {
    this.buffer += token;
    const ready: string[] = [];
    let boundary = findSpeakBoundary(this.buffer);

    while (boundary > 0) {
      const chunk = normalizeSpaces(this.buffer.slice(0, boundary));
      if (chunk) ready.push(chunk);
      this.buffer = this.buffer.slice(boundary);
      boundary = findSpeakBoundary(this.buffer);
    }

    return ready;
  }

  flush(): string {
    const tail = normalizeSpaces(this.buffer);
    this.buffer = "";
    return tail;
  }
}

async function synthesizeTextToFrames(text: string, language: string): Promise<Int16Array[]> {
  const abort = new AbortController();
  const frames: Int16Array[] = [];
  for await (const frame of streamAzureTtsFrames(text, language, abort.signal, {
    userAgent: "NeuraTalk/VoiceAssistant",
  })) {
    frames.push(new Int16Array(frame));
  }
  return frames;
}

function buildSystemPrompt(language: string, assistantName: string, override?: string): string {
  if (override?.trim()) return override.trim();
  return `${DEFAULT_SYSTEM_PROMPT} Your name is ${assistantName}. Reply in ${languageLabel(language)}.`;
}

function buildTurnLatencySnapshot(turn: TurnLatency): TurnLatencySnapshot {
  return {
    turnId: turn.turnId,
    sttFirstPartialMs: diff(turn.speechStartedAt, turn.firstTranscriptAt),
    sttFinalMs: diff(turn.speechStartedAt, turn.finalTranscriptAt),
    llmFirstTokenMs: diff(turn.llmStartedAt, turn.firstTokenAt),
    ttsFirstAudioMs: diff(turn.ttsStartedAt, turn.firstAudioAt),
    perceivedLatencyMs: diff(turn.finalTranscriptAt || turn.speechStartedAt, turn.firstAudioAt),
    totalTurnMs: diff(turn.speechStartedAt, turn.finalAudioAt),
    targetLatencyMs: DEFAULT_TARGET_LATENCY_MS,
  };
}

function diff(start?: number, end?: number): number | null {
  if (!start || !end) return null;
  return Math.max(0, end - start);
}

function findSpeakBoundary(text: string): number {
  const punctuationMatch = text.match(/.*?[.!?;:](?:\s|$)/);
  if (punctuationMatch?.[0]) {
    return punctuationMatch[0].length;
  }

  const words = text.trim().split(/\s+/);
  if (words.length >= 12) {
    const splitIndex = nthWordBoundary(text, 10);
    return splitIndex > 0 ? splitIndex : 0;
  }

  return 0;
}

function nthWordBoundary(text: string, wordIndex: number): number {
  let wordsSeen = 0;
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === " ") {
      wordsSeen += 1;
      if (wordsSeen >= wordIndex) return i + 1;
    }
  }
  return 0;
}

function isQuickGreeting(value: string): boolean {
  const normalized = normalizeTranscript(value);
  return ["hi", "hello", "hey", "good morning", "good afternoon", "good evening"].includes(normalized);
}

function languageLabel(language: string): string {
  const labels: Record<string, string> = {
    en: "English",
    hi: "Hindi",
    te: "Telugu",
    ta: "Tamil",
    kn: "Kannada",
    ml: "Malayalam",
    mr: "Marathi",
    bn: "Bengali",
    gu: "Gujarati",
    pa: "Punjabi",
    ur: "Urdu",
  };
  return labels[language] || "English";
}

function buildEmotionGuidance(emotion: EmotionState): string {
  switch (emotion.emotion) {
    case "happy":
      return "The user sounds happy. Match that warmth with concise, upbeat spoken replies.";
    case "sad":
      return "The user sounds sad. Reply gently, use shorter sentences, and prioritize empathy over speed.";
    case "angry":
      return "The user sounds frustrated. Stay calm, acknowledge the frustration first, and avoid sounding defensive.";
    case "stressed":
      return "The user sounds stressed. Slow the pace slightly, reduce information density, and reassure them.";
    case "calm":
      return "The user sounds calm. Keep your tone steady, warm, and natural.";
    default:
      return "Keep the tone balanced, warm, and concise for spoken audio.";
  }
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(String(value || ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

async function safeEndRoom(roomName: string): Promise<void> {
  try {
    await endCallRoom(roomName);
  } catch (error) {
    logger.warn("VoiceAssistant", `Failed to end room ${roomName}: ${String(error)}`);
  }
}

function bindVoiceAssistantShutdown(): void {
  if (shutdownBound) return;
  shutdownBound = true;

  const shutdown = async () => {
    await Promise.allSettled(Array.from(assistantSessions.keys()).map((sessionId) => endVoiceAssistantSession(sessionId)));
    await livekitDispose().catch(() => {});
  };

  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

function ensureVoiceAssistantWatchdog(): void {
  if (watchdogBound) return;
  watchdogBound = true;

  setInterval(() => {
    const now = Date.now();
    for (const [sessionId, session] of Array.from(assistantSessions.entries())) {
      if (session.status === "stopping" || session.status === "stopped") {
        continue;
      }
      if (now - session.lastActivityAt.getTime() < VOICE_ASSISTANT_IDLE_TIMEOUT_MS) {
        continue;
      }
      logger.warn("VoiceAssistant", `Ending stale assistant session ${sessionId} after inactivity`, {
        roomName: session.roomName,
        idleMs: now - session.lastActivityAt.getTime(),
      });
      void endVoiceAssistantSession(sessionId).catch((error) => {
        logger.warn("VoiceAssistant", `Failed to end stale assistant session ${sessionId}: ${String(error)}`);
      });
    }
  }, VOICE_ASSISTANT_WATCHDOG_INTERVAL_MS).unref?.();
}
