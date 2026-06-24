import * as SpeechSDK from "microsoft-cognitiveservices-speech-sdk";
import { logger } from "../observability";
import { computeRms, int16ArrayToBuffer, normalizeLanguage, normalizeSpaces, DeepgramLiveTranscriber } from "../realtime-translation-core";
import { runWithResilience } from "../voice-resilience";
import type {
  StreamingSttProvider,
  StreamingSttProviderSession,
  StreamingTranscriptEvent,
} from "./voice-contracts";

const DEFAULT_STT_PROVIDER = (process.env.STT_PROVIDER || "azure").trim().toLowerCase();
const ENABLE_DEEPGRAM_STT_FALLBACK = (process.env.ENABLE_DEEPGRAM_STT_FALLBACK || "true").trim().toLowerCase() === "true";
const PCM_SAMPLE_RATE = 16_000;
const PCM_CHANNELS = 1;
const PCM_BITS_PER_SAMPLE = 16;
const DEFAULT_AUDIO_LOCALE = "en-IN";
const AZURE_STT_CONNECT_TIMEOUT_MS = parsePositiveInt(process.env.AZURE_STREAMING_STT_CONNECT_TIMEOUT_MS, 8_000);
const AZURE_STT_SEGMENTATION_SILENCE_MS = parsePositiveInt(process.env.AZURE_STREAMING_STT_SEGMENTATION_SILENCE_MS, 250);
const AZURE_STT_INITIAL_SILENCE_MS = parsePositiveInt(process.env.AZURE_STREAMING_STT_INITIAL_SILENCE_MS, 2_000);
const AZURE_STT_RECONNECT_BASE_MS = parsePositiveInt(process.env.AZURE_STREAMING_STT_RECONNECT_BASE_MS, 750);
const AZURE_STT_RECONNECT_MAX_MS = parsePositiveInt(process.env.AZURE_STREAMING_STT_RECONNECT_MAX_MS, 8_000);
const AZURE_STT_MAX_RECONNECTS = parsePositiveInt(process.env.AZURE_STREAMING_STT_MAX_RECONNECTS, 4);
const AZURE_STT_INACTIVITY_TIMEOUT_MS = parsePositiveInt(process.env.AZURE_STREAMING_STT_INACTIVITY_TIMEOUT_MS, 12_000);
const AZURE_STT_INACTIVITY_CHECK_MS = parsePositiveInt(process.env.AZURE_STREAMING_STT_INACTIVITY_CHECK_MS, 3_000);
const AZURE_STT_MAX_PENDING_AUDIO_MS = parsePositiveInt(process.env.AZURE_STREAMING_STT_MAX_PENDING_AUDIO_MS, 4_000);
const AZURE_STT_VAD_THRESHOLD = parsePositiveFloat(process.env.AZURE_STREAMING_STT_VAD_THRESHOLD, 0.014);
const MAX_PENDING_AUDIO_BYTES = Math.round((PCM_SAMPLE_RATE * PCM_CHANNELS * (PCM_BITS_PER_SAMPLE / 8) * AZURE_STT_MAX_PENDING_AUDIO_MS) / 1000);

const AZURE_LOCALE_MAP: Record<string, string> = {
  en: "en-IN",
  hi: "hi-IN",
  te: "te-IN",
  ta: "ta-IN",
  kn: "kn-IN",
  ml: "ml-IN",
  mr: "mr-IN",
  bn: "bn-IN",
  gu: "gu-IN",
  pa: "pa-IN",
  ur: "ur-PK",
};

const AZURE_AUTO_DETECT_LOCALES = ["en-IN", "hi-IN", "te-IN"];

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parsePositiveFloat(value: string | undefined, fallback: number): number {
  const parsed = Number.parseFloat(String(value ?? ""));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function createTranscriptEvent(provider: string, event: Omit<StreamingTranscriptEvent, "provider">): StreamingTranscriptEvent {
  return {
    provider,
    receivedAt: event.receivedAt || new Date().toISOString(),
    ...event,
  };
}

function getAzureSpeechKey(): string {
  const value = process.env.AZURE_SPEECH_KEY?.trim();
  if (!value) {
    throw new Error("AZURE_SPEECH_KEY is required for azure-stt");
  }
  return value;
}

function getAzureSpeechRegion(): string {
  return process.env.AZURE_SPEECH_REGION?.trim() || "centralindia";
}

function resolveAzureLocales(language: string): string[] {
  const normalized = normalizeLanguage(language);
  if (normalized === "auto" || normalized === "mixed" || normalized === "multilingual") {
    return AZURE_AUTO_DETECT_LOCALES;
  }
  return [AZURE_LOCALE_MAP[normalized] || DEFAULT_AUDIO_LOCALE];
}

function isTelemetrySafeReconnectError(error: Error): boolean {
  const message = error.message.toLowerCase();
  return (
    message.includes("connection was closed") ||
    message.includes("websocket") ||
    message.includes("timeout") ||
    message.includes("network") ||
    message.includes("service unavailable")
  );
}

function toArrayBufferView(buffer: Buffer): ArrayBuffer {
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
}

function parseDetailedResult(result: SpeechSDK.SpeechRecognitionResult): {
  confidence: number | null;
  language: string | null;
  languageConfidence: string | null;
} {
  let confidence: number | null = null;
  let language: string | null = null;
  let languageConfidence: string | null = null;

  try {
    const jsonResult = result.properties.getProperty(SpeechSDK.PropertyId.SpeechServiceResponse_JsonResult);
    if (jsonResult) {
      const parsed = JSON.parse(jsonResult) as {
        NBest?: Array<{ Confidence?: number }>;
        PrimaryLanguage?: { Language?: string; Confidence?: string };
      };
      confidence = typeof parsed.NBest?.[0]?.Confidence === "number" ? parsed.NBest[0].Confidence : null;
      language = typeof parsed.PrimaryLanguage?.Language === "string" ? parsed.PrimaryLanguage.Language : null;
      languageConfidence = typeof parsed.PrimaryLanguage?.Confidence === "string" ? parsed.PrimaryLanguage.Confidence : null;
    }
  } catch {
    // Ignore malformed provider metadata but keep recognition results flowing.
  }

  if (!language && typeof result.language === "string") {
    language = result.language;
  }
  if (!languageConfidence && typeof result.languageDetectionConfidence === "string") {
    languageConfidence = result.languageDetectionConfidence;
  }

  return { confidence, language, languageConfidence };
}

class AzureStreamingSttSession implements StreamingSttProviderSession {
  readonly provider = "azure-stt";

  private readonly language: string;
  private readonly onTranscript: (event: StreamingTranscriptEvent) => void;
  private readonly onError: (error: Error) => void;
  private readonly onProviderSwitch?: (provider: string, reason: string) => void;
  private readonly onSocketOpen?: (latencyMs: number) => void;
  private readonly endpointingMs: number;

  private recognizer: SpeechSDK.SpeechRecognizer | null = null;
  private pushStream: SpeechSDK.PushAudioInputStream | null = null;
  private audioConfig: SpeechSDK.AudioConfig | null = null;
  private closed = false;
  private connected = false;
  private starting = false;
  private stopping = false;
  private reconnectAttempts = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private inactivityTimer: NodeJS.Timeout | null = null;
  private pendingAudio: Buffer[] = [];
  private pendingAudioBytes = 0;
  private sequenceId = 0;
  private lastAudioWriteAt = 0;
  private lastRecognitionAt = 0;
  private connectStartedAt = 0;
  private lastPartialText = "";
  private lastFinalText = "";
  private lastSpeechDetectedAt = 0;

  constructor(opts: {
    language: string;
    onTranscript: (event: StreamingTranscriptEvent) => void;
    onError: (error: Error) => void;
    onProviderSwitch?: (provider: string, reason: string) => void;
    onSocketOpen?: (latencyMs: number) => void;
    endpointingMs?: number;
  }) {
    this.language = normalizeLanguage(opts.language);
    this.onTranscript = opts.onTranscript;
    this.onError = opts.onError;
    this.onProviderSwitch = opts.onProviderSwitch;
    this.onSocketOpen = opts.onSocketOpen;
    this.endpointingMs = opts.endpointingMs ?? AZURE_STT_SEGMENTATION_SILENCE_MS;
  }

  async connect(): Promise<void> {
    if (this.closed || this.connected || this.starting) return;
    this.starting = true;
    this.connectStartedAt = Date.now();

    try {
      await runWithResilience(async () => {
        await this.startRecognizer();
      }, {
        provider: this.provider,
        operation: "connect",
        timeoutMs: AZURE_STT_CONNECT_TIMEOUT_MS,
        retries: 0,
        metadata: {
          language: this.language,
          reconnectAttempt: this.reconnectAttempts,
        },
      });
      this.connected = true;
      this.reconnectAttempts = 0;
      this.startInactivityWatchdog();
      this.flushPendingAudio();
    } finally {
      this.starting = false;
    }
  }

  send(frame: Buffer | Int16Array | { data: Int16Array }): void {
    if (this.closed) return;
    const normalized = frame instanceof Buffer
      ? frame
      : frame instanceof Int16Array
        ? int16ArrayToBuffer(frame)
        : int16ArrayToBuffer(frame.data);

    this.lastAudioWriteAt = Date.now();

    const rms = computeRms(new Int16Array(normalized.buffer, normalized.byteOffset, Math.floor(normalized.byteLength / 2)));
    if (rms >= AZURE_STT_VAD_THRESHOLD) {
      this.lastSpeechDetectedAt = this.lastAudioWriteAt;
    }

    if (!this.pushStream || !this.connected) {
      this.bufferPendingAudio(normalized);
      return;
    }

    try {
      this.pushStream.write(toArrayBufferView(normalized));
    } catch (error) {
      this.bufferPendingAudio(normalized);
      const normalizedError = error instanceof Error ? error : new Error(String(error));
      void this.handleRecognizerFailure(new Error(`azure-stt write failed: ${normalizedError.message}`));
    }
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.stopping = true;
    this.clearTimers();
    await this.stopRecognizer();
    this.cleanupRecognizer();
    this.pendingAudio = [];
    this.pendingAudioBytes = 0;
  }

  private async startRecognizer(): Promise<void> {
    this.cleanupRecognizer();

    const key = getAzureSpeechKey();
    const region = getAzureSpeechRegion();
    const locales = resolveAzureLocales(this.language);
    const speechConfig = SpeechSDK.SpeechConfig.fromSubscription(key, region);
    speechConfig.outputFormat = SpeechSDK.OutputFormat.Detailed;
    speechConfig.setProperty(SpeechSDK.PropertyId.Speech_SegmentationSilenceTimeoutMs, String(this.endpointingMs));
    speechConfig.setProperty(SpeechSDK.PropertyId.SpeechServiceConnection_InitialSilenceTimeoutMs, String(AZURE_STT_INITIAL_SILENCE_MS));
    speechConfig.setProperty(SpeechSDK.PropertyId.Speech_StartEventSensitivity, "high");
    speechConfig.setProperty(SpeechSDK.PropertyId.SpeechServiceConnection_EnableAudioLogging, "false");
    speechConfig.setProperty(SpeechSDK.PropertyId.SpeechServiceResponse_RequestDetailedResultTrueFalse, "true");
    speechConfig.speechRecognitionLanguage = locales[0] || DEFAULT_AUDIO_LOCALE;

    const streamFormat = SpeechSDK.AudioStreamFormat.getWaveFormatPCM(PCM_SAMPLE_RATE, PCM_BITS_PER_SAMPLE, PCM_CHANNELS);
    const pushStream = SpeechSDK.AudioInputStream.createPushStream(streamFormat);
    const audioConfig = SpeechSDK.AudioConfig.fromStreamInput(pushStream);

    const recognizer = locales.length > 1
      ? (() => {
          const autoConfig = SpeechSDK.AutoDetectSourceLanguageConfig.fromLanguages(locales);
          autoConfig.mode = SpeechSDK.LanguageIdMode.Continuous;
          return SpeechSDK.SpeechRecognizer.FromConfig(speechConfig, autoConfig, audioConfig);
        })()
      : new SpeechSDK.SpeechRecognizer(speechConfig, audioConfig);

    recognizer.sessionStarted = () => {
      this.lastRecognitionAt = Date.now();
      this.connected = true;
      this.onSocketOpen?.(Date.now() - this.connectStartedAt);
    };

    recognizer.recognizing = (_sender, event) => {
      this.handleRecognition(event.result, false);
    };

    recognizer.recognized = (_sender, event) => {
      this.handleRecognition(event.result, true);
    };

    recognizer.canceled = (_sender, event) => {
      if (this.closed || this.stopping) return;
      const details = event.errorDetails || event.reason?.toString() || "speech recognition canceled";
      void this.handleRecognizerFailure(new Error(`azure-stt canceled: ${details}`));
    };

    recognizer.sessionStopped = () => {
      if (this.closed || this.stopping) return;
      void this.handleRecognizerFailure(new Error("azure-stt session stopped"));
    };

    this.recognizer = recognizer;
    this.pushStream = pushStream;
    this.audioConfig = audioConfig;

    await new Promise<void>((resolve, reject) => {
      recognizer.startContinuousRecognitionAsync(resolve, (error) => reject(new Error(String(error))));
    });
  }

  private handleRecognition(result: SpeechSDK.SpeechRecognitionResult, isFinal: boolean): void {
    const text = normalizeSpaces(result.text || "");
    if (!text) return;

    const { confidence, language, languageConfidence } = parseDetailedResult(result);
    this.lastRecognitionAt = Date.now();

    if (isFinal) {
      if (text === this.lastFinalText) return;
      this.lastFinalText = text;
      this.lastPartialText = text;
    } else {
      if (text === this.lastPartialText) return;
      this.lastPartialText = text;
    }

    this.sequenceId += 1;

    this.onTranscript(createTranscriptEvent(this.provider, {
      text,
      isFinal,
      speechFinal: isFinal,
      confidence,
      language,
      languageConfidence,
      sequenceId: this.sequenceId,
      latencyMs: this.computeTranscriptLatencyMs(),
      offsetMs: typeof result.offset === "number" ? Math.round(result.offset / 10_000) : null,
      durationMs: typeof result.duration === "number" ? Math.round(result.duration / 10_000) : null,
    }));
  }

  private computeTranscriptLatencyMs(): number | null {
    if (!this.lastSpeechDetectedAt) return null;
    return Math.max(0, Date.now() - this.lastSpeechDetectedAt);
  }

  private bufferPendingAudio(chunk: Buffer): void {
    this.pendingAudio.push(chunk);
    this.pendingAudioBytes += chunk.byteLength;
    while (this.pendingAudioBytes > MAX_PENDING_AUDIO_BYTES && this.pendingAudio.length > 1) {
      const removed = this.pendingAudio.shift();
      this.pendingAudioBytes -= removed?.byteLength || 0;
    }
  }

  private flushPendingAudio(): void {
    if (!this.pushStream || !this.connected || this.pendingAudio.length === 0) return;
    for (const chunk of this.pendingAudio) {
      this.pushStream.write(toArrayBufferView(chunk));
    }
    this.pendingAudio = [];
    this.pendingAudioBytes = 0;
  }

  private startInactivityWatchdog(): void {
    if (this.inactivityTimer) return;
    this.inactivityTimer = setInterval(() => {
      if (this.closed || !this.connected || !this.lastAudioWriteAt) return;
      const silenceSinceRecognition = Date.now() - Math.max(this.lastRecognitionAt, this.connectStartedAt);
      const recentAudio = Date.now() - this.lastAudioWriteAt;
      if (recentAudio < AZURE_STT_INACTIVITY_TIMEOUT_MS) return;
      if (silenceSinceRecognition < AZURE_STT_INACTIVITY_TIMEOUT_MS) return;

      void this.handleRecognizerFailure(new Error("azure-stt inactivity timeout"));
    }, AZURE_STT_INACTIVITY_CHECK_MS);
    this.inactivityTimer.unref?.();
  }

  private async handleRecognizerFailure(error: Error): Promise<void> {
    if (this.closed || this.stopping) return;

    this.connected = false;
    this.cleanupRecognizer();
    this.onError(error);

    if (!isTelemetrySafeReconnectError(error) || this.reconnectAttempts >= AZURE_STT_MAX_RECONNECTS) {
      return;
    }

    this.reconnectAttempts += 1;
    const delayMs = Math.min(
      AZURE_STT_RECONNECT_MAX_MS,
      AZURE_STT_RECONNECT_BASE_MS * (2 ** Math.max(0, this.reconnectAttempts - 1)),
    );
    this.onProviderSwitch?.(this.provider, `reconnect-attempt-${this.reconnectAttempts}`);
    logger.warn("STTProviderRegistry", "Reconnecting azure-stt session after failure", {
      error: error.message,
      reconnectAttempts: this.reconnectAttempts,
      delayMs,
    });

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.connect().catch((reconnectError) => {
        this.onError(reconnectError instanceof Error ? reconnectError : new Error(String(reconnectError)));
      });
    }, delayMs);
    this.reconnectTimer.unref?.();
  }

  private async stopRecognizer(): Promise<void> {
    if (!this.recognizer) return;
    try {
      await new Promise<void>((resolve) => {
        this.recognizer?.stopContinuousRecognitionAsync(resolve, () => resolve());
      });
    } finally {
      this.connected = false;
    }
  }

  private cleanupRecognizer(): void {
    try {
      this.recognizer?.close();
    } catch {
      // Ignore recognizer close races.
    }
    try {
      this.audioConfig?.close();
    } catch {
      // Ignore audio config close races.
    }
    try {
      this.pushStream?.close();
    } catch {
      // Ignore stream close races.
    }

    this.recognizer = null;
    this.audioConfig = null;
    this.pushStream = null;
    this.connected = false;
  }

  private clearTimers(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.inactivityTimer) {
      clearInterval(this.inactivityTimer);
      this.inactivityTimer = null;
    }
  }
}

class AzureStreamingSttProvider implements StreamingSttProvider {
  readonly provider = "azure-stt";
  readonly mode = "primary" as const;

  createSession(opts: {
    language: string;
    onTranscript: (event: StreamingTranscriptEvent) => void;
    onError: (error: Error) => void;
    onProviderSwitch?: (provider: string, reason: string) => void;
    onSocketOpen?: (latencyMs: number) => void;
    endpointingMs?: number;
    utteranceEndMs?: number;
  }): StreamingSttProviderSession {
    return new AzureStreamingSttSession({
      language: opts.language,
      onTranscript: opts.onTranscript,
      onError: opts.onError,
      onProviderSwitch: opts.onProviderSwitch,
      onSocketOpen: opts.onSocketOpen,
      endpointingMs: opts.endpointingMs,
    });
  }
}

class DeepgramProviderSession implements StreamingSttProviderSession {
  readonly provider = "deepgram-stt";

  constructor(private readonly session: DeepgramLiveTranscriber) {}

  connect(): Promise<void> {
    return this.session.connect();
  }

  send(frame: Parameters<DeepgramLiveTranscriber["send"]>[0]): void {
    this.session.send(frame);
  }

  close(): Promise<void> {
    return this.session.close();
  }
}

class DeepgramStreamingSttProvider implements StreamingSttProvider {
  readonly provider = "deepgram-stt";
  readonly mode = "fallback" as const;

  createSession(opts: {
    language: string;
    onTranscript: (event: StreamingTranscriptEvent) => void;
    onError: (error: Error) => void;
    onProviderSwitch?: (provider: string, reason: string) => void;
    onSocketOpen?: (latencyMs: number) => void;
    endpointingMs?: number;
    utteranceEndMs?: number;
  }): StreamingSttProviderSession {
    return new DeepgramProviderSession(new DeepgramLiveTranscriber({
      language: opts.language,
      onTranscript: (event) => {
        opts.onTranscript(createTranscriptEvent(this.provider, {
          ...event,
          confidence: null,
        }));
      },
      onError: opts.onError,
      onSocketOpen: opts.onSocketOpen,
      endpointingMs: opts.endpointingMs,
      utteranceEndMs: opts.utteranceEndMs,
    }));
  }
}

class FailoverStreamingSttSession implements StreamingSttProviderSession {
  readonly provider = "managed-stt";
  private active: StreamingSttProviderSession;
  private fallbackActivated = false;

  constructor(
    private readonly primary: StreamingSttProvider,
    private readonly fallback: StreamingSttProvider | null,
    private readonly opts: Parameters<StreamingSttProvider["createSession"]>[0],
  ) {
    this.active = this.primary.createSession({
      ...opts,
      onError: (error) => {
        void this.handleProviderError(error);
      },
    });
  }

  async connect(): Promise<void> {
    return this.active.connect();
  }

  send(frame: Buffer | Int16Array | { data: Int16Array }): void {
    this.active.send(frame as never);
  }

  async close(): Promise<void> {
    await this.active.close();
  }

  private async handleProviderError(error: Error): Promise<void> {
    if (!this.fallback || this.fallbackActivated) {
      this.opts.onError(error);
      return;
    }

    this.fallbackActivated = true;
    logger.warn("STTProviderRegistry", "Switching STT provider after primary failure", {
      from: this.primary.provider,
      to: this.fallback.provider,
      error: error.message,
    });
    this.opts.onProviderSwitch?.(this.fallback.provider, error.message);
    await this.active.close().catch(() => undefined);
    this.active = this.fallback.createSession(this.opts);
    await this.active.connect().catch((fallbackError) => {
      this.opts.onError(fallbackError instanceof Error ? fallbackError : new Error(String(fallbackError)));
    });
  }
}

const azureProvider = new AzureStreamingSttProvider();
const deepgramProvider = new DeepgramStreamingSttProvider();

export function createManagedStreamingSttSession(opts: Parameters<StreamingSttProvider["createSession"]>[0]): StreamingSttProviderSession {
  const primary = DEFAULT_STT_PROVIDER === "deepgram" ? deepgramProvider : azureProvider;
  const fallback = ENABLE_DEEPGRAM_STT_FALLBACK && primary.provider !== deepgramProvider.provider
    ? deepgramProvider
    : null;

  return new FailoverStreamingSttSession(primary, fallback, opts);
}

export function getDefaultSttProviderName(): string {
  return DEFAULT_STT_PROVIDER === "deepgram" ? "deepgram-stt" : "azure-stt";
}
