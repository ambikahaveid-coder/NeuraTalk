import WebSocket from "ws";
import { Agent as UndiciAgent, fetch as undiciFetch } from "undici";
import type { AudioFrame } from "@livekit/rtc-node";
import { getAzureVoice } from "./azure-service";
import { runWithResilience } from "./voice-resilience";

export const PCM_SAMPLE_RATE = 16_000;
export const PCM_CHANNELS = 1;
export const FRAME_DURATION_MS = 20;
export const BYTES_PER_SAMPLE = 2;
export const PCM_FRAME_BYTES = (PCM_SAMPLE_RATE * FRAME_DURATION_MS * BYTES_PER_SAMPLE) / 1000;

const DEEPGRAM_MODEL = process.env.DEEPGRAM_STT_MODEL || "nova-3";
const DEFAULT_DEEPGRAM_ENDPOINTING_MS = parsePositiveInt(process.env.DEEPGRAM_STT_ENDPOINTING_MS, 100);
const DEEPGRAM_CONNECT_TIMEOUT_MS = parsePositiveInt(process.env.DEEPGRAM_CONNECT_TIMEOUT_MS, 4_000);
const AZURE_TTS_TIMEOUT_MS = parsePositiveInt(process.env.AZURE_TTS_TIMEOUT_MS, 8_000);

const azureDispatcher = new UndiciAgent({
  keepAliveTimeout: 30_000,
  keepAliveMaxTimeout: 60_000,
  pipelining: 10,
  connections: 20,
  connect: { timeout: 3_000 },
});

export interface DeepgramTranscriptEvent {
  text: string;
  isFinal: boolean;
  speechFinal: boolean;
}

export interface ProsodyEmotionLike {
  emotion?: string | null;
}

function nowHrNs(): bigint {
  return process.hrtime.bigint();
}

function elapsedMsFrom(startNs: bigint): number {
  return Number(process.hrtime.bigint() - startNs) / 1_000_000;
}

export class DeepgramLiveTranscriber {
  private readonly language: string;
  private readonly onTranscript: (event: DeepgramTranscriptEvent) => void;
  private readonly onError: (error: Error) => void;
  private readonly onSocketOpen?: (latencyMs: number) => void;
  private readonly endpointingMs: number;
  private readonly utteranceEndMs: number;

  private socket: WebSocket | null = null;
  private connected = false;
  private closed = false;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private pendingFrames: Buffer[] = [];

  constructor(opts: {
    language: string;
    onTranscript: (event: DeepgramTranscriptEvent) => void;
    onError: (error: Error) => void;
    onSocketOpen?: (latencyMs: number) => void;
    endpointingMs?: number;
    utteranceEndMs?: number;
  }) {
    this.language = opts.language;
    this.onTranscript = opts.onTranscript;
    this.onError = opts.onError;
    this.onSocketOpen = opts.onSocketOpen;
    this.endpointingMs = opts.endpointingMs ?? DEFAULT_DEEPGRAM_ENDPOINTING_MS;
    this.utteranceEndMs = opts.utteranceEndMs ?? 160;
  }

  async connect(): Promise<void> {
    if (this.closed || this.connected) return;

    const params = new URLSearchParams({
      model: DEEPGRAM_MODEL,
      encoding: "linear16",
      sample_rate: String(PCM_SAMPLE_RATE),
      channels: String(PCM_CHANNELS),
      interim_results: "true",
      endpointing: String(this.endpointingMs),
      punctuate: "true",
      smart_format: "true",
      vad_events: "true",
      utterance_end_ms: String(this.utteranceEndMs),
      language: this.language,
    });

    await runWithResilience(async (signal) => {
      await new Promise<void>((resolve, reject) => {
        const socketStartNs = nowHrNs();
        const socket = new WebSocket(`wss://api.deepgram.com/v1/listen?${params.toString()}`, {
          headers: {
            Authorization: `Token ${process.env.DEEPGRAM_API_KEY}`,
          },
        });

        const closeSocket = () => {
          try {
            socket.close();
          } catch {
            // ignore close race
          }
        };

        if (signal.aborted) {
          closeSocket();
          reject(signal.reason ?? new Error("Deepgram connect aborted"));
          return;
        }

        const onAbort = () => {
          closeSocket();
          reject(signal.reason ?? new Error("Deepgram connect aborted"));
        };
        signal.addEventListener("abort", onAbort, { once: true });

        socket.once("open", () => {
          signal.removeEventListener("abort", onAbort);
          this.socket = socket;
          this.connected = true;
          this.onSocketOpen?.(Number(elapsedMsFrom(socketStartNs).toFixed(3)));
          for (const packet of this.pendingFrames.splice(0)) {
            socket.send(packet);
          }
          resolve();
        });

        socket.on("message", (message) => {
          try {
            const payload = JSON.parse(String(message)) as any;
            if (payload.type !== "Results") return;
            const text = normalizeSpaces(payload.channel?.alternatives?.[0]?.transcript || "");
            if (!text) return;
            this.onTranscript({
              text,
              isFinal: Boolean(payload.is_final),
              speechFinal: Boolean(payload.speech_final),
            });
          } catch (error) {
            this.onError(error instanceof Error ? error : new Error(String(error)));
          }
        });

        socket.on("error", (error) => {
          signal.removeEventListener("abort", onAbort);
          this.connected = false;
          reject(error);
        });

        socket.on("close", () => {
          signal.removeEventListener("abort", onAbort);
          this.connected = false;
          this.socket = null;

          if (!this.closed) {
            this.reconnectTimer = setTimeout(() => {
              void this.connect().catch((error) => {
                this.onError(error instanceof Error ? error : new Error(String(error)));
              });
            }, 300);
          }
        });
      });
    }, {
      provider: "deepgram-stt",
      operation: "connect",
      timeoutMs: DEEPGRAM_CONNECT_TIMEOUT_MS,
      retries: 1,
      retryDelayMs: 250,
      metadata: { language: this.language },
    });
  }

  send(frame: AudioFrame | Int16Array | Buffer): void {
    const packet = frame instanceof Buffer
      ? frame
      : frame instanceof Int16Array
        ? int16ArrayToBuffer(frame)
        : Buffer.from(frame.data.buffer, frame.data.byteOffset, frame.data.byteLength);

    if (this.connected && this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(packet);
      return;
    }

    if (this.pendingFrames.length > 8) {
      this.pendingFrames.shift();
    }
    this.pendingFrames.push(packet);
  }

  async close(): Promise<void> {
    this.closed = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.socket?.readyState === WebSocket.OPEN) {
      try {
        this.socket.send(Buffer.alloc(0));
      } catch {}

      await new Promise<void>((resolve) => {
        this.socket?.once("close", () => resolve());
        this.socket?.close();
        setTimeout(() => resolve(), 500);
      });
    }

    this.connected = false;
    this.socket = null;
  }
}

export async function* streamAzureTtsFrames(
  text: string,
  language: string,
  signal: AbortSignal,
  opts: {
    onFirstByte?: () => void;
    onResponseHeaders?: (latencyMs: number) => void;
    emotion?: ProsodyEmotionLike | null;
    userAgent?: string;
  } = {},
): AsyncGenerator<Int16Array> {
  const key = process.env.AZURE_SPEECH_KEY;
  const region = process.env.AZURE_SPEECH_REGION || "centralindia";

  if (!key) {
    throw new Error("AZURE_SPEECH_KEY not configured");
  }

  const voice = getAzureVoice(language, "female");
  const locale = toAzureLocale(language);
  const prosody = toAzureProsody(opts.emotion);
  const ssml = `<speak version='1.0' xml:lang='${locale}'><voice name='${voice}'><prosody rate='${prosody.rate}' pitch='${prosody.pitch}' volume='${prosody.volume}'>${escapeXml(
    text,
  )}</prosody></voice></speak>`;

  const requestStartNs = nowHrNs();
  const response = await runWithResilience(
    async (deadlineSignal) => undiciFetch(`https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`, {
      method: "POST",
      headers: {
        "Ocp-Apim-Subscription-Key": key,
        "Content-Type": "application/ssml+xml",
        "X-Microsoft-OutputFormat": "raw-16khz-16bit-mono-pcm",
        "User-Agent": opts.userAgent || "NeuraTalk/Realtime",
      },
      body: ssml,
      signal: deadlineSignal,
      dispatcher: azureDispatcher,
    }),
    {
      provider: "azure-tts",
      operation: "stream",
      timeoutMs: AZURE_TTS_TIMEOUT_MS,
      signal,
      retries: 1,
      retryDelayMs: 200,
      metadata: { language },
    },
  );
  opts.onResponseHeaders?.(Number(elapsedMsFrom(requestStartNs).toFixed(3)));

  if (!response.ok) {
    throw new Error(`Azure TTS ${response.status}: ${await response.text()}`);
  }

  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error("Azure TTS did not return a readable body");
  }

  let carry = Buffer.alloc(0);
  let sawFirstByte = false;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value || value.length === 0) continue;

    if (!sawFirstByte) {
      sawFirstByte = true;
      opts.onFirstByte?.();
    }

    carry = Buffer.concat([carry, Buffer.from(value)]);
    let offset = 0;
    while (carry.length - offset >= PCM_FRAME_BYTES) {
      const slice = carry.subarray(offset, offset + PCM_FRAME_BYTES);
      offset += PCM_FRAME_BYTES;
      yield bytesToInt16Frame(slice);
    }
    carry = carry.subarray(offset);
  }

  if (carry.length >= 2) {
    const padded = Buffer.alloc(Math.ceil(carry.length / PCM_FRAME_BYTES) * PCM_FRAME_BYTES);
    carry.copy(padded);
    for (let offset = 0; offset < padded.length; offset += PCM_FRAME_BYTES) {
      yield bytesToInt16Frame(padded.subarray(offset, offset + PCM_FRAME_BYTES));
    }
  }
}

export function normalizeSpaces(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export function normalizeTranscript(value: string): string {
  return normalizeSpaces(value).toLowerCase().replace(/[^\w\s]/g, "");
}

export function normalizeLanguage(value: string): string {
  const normalized = value.trim().toLowerCase();
  return normalized || "en";
}

export function wordCount(value: string): number {
  const normalized = normalizeSpaces(value);
  return normalized ? normalized.split(" ").length : 0;
}

export function computeTextDelta(previous: string, next: string): string {
  const prev = normalizeSpaces(previous);
  const curr = normalizeSpaces(next);
  if (!prev) return curr;
  if (!curr) return "";
  if (curr.startsWith(prev)) {
    return normalizeSpaces(curr.slice(prev.length));
  }

  let index = 0;
  const lowerPrev = prev.toLowerCase();
  const lowerCurr = curr.toLowerCase();
  while (index < lowerPrev.length && index < lowerCurr.length && lowerPrev[index] === lowerCurr[index]) {
    index += 1;
  }

  const boundary = curr.lastIndexOf(" ", index);
  return normalizeSpaces(curr.slice(boundary > 0 ? boundary + 1 : index));
}

export function computeRms(samples: Int16Array): number {
  if (!samples.length) return 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i += 1) {
    const value = samples[i] / 32768;
    sum += value * value;
  }
  return Math.sqrt(sum / samples.length);
}

export function normalizePcmFrame(
  samples: Int16Array,
  opts: {
    targetPeak?: number;
    noiseFloorRms?: number;
    gateFloor?: number;
  } = {},
): Int16Array {
  if (!samples.length) return samples;

  const targetPeak = Math.max(0.4, Math.min(0.98, opts.targetPeak ?? 0.82));
  const noiseFloorRms = Math.max(0.001, opts.noiseFloorRms ?? 0.006);
  const gateFloor = Math.max(0.0005, opts.gateFloor ?? 0.003);

  const rms = computeRms(samples);
  if (rms <= noiseFloorRms) {
    return new Int16Array(samples.length);
  }

  let peak = 0;
  for (let i = 0; i < samples.length; i += 1) {
    const magnitude = Math.abs(samples[i]);
    if (magnitude > peak) peak = magnitude;
  }

  if (peak === 0) {
    return new Int16Array(samples.length);
  }

  const gain = Math.min(2.4, (targetPeak * 32767) / peak);
  const gate = gateFloor * 32767;
  const normalized = new Int16Array(samples.length);

  for (let i = 0; i < samples.length; i += 1) {
    const scaled = samples[i] * gain;
    const clamped = Math.max(-32768, Math.min(32767, Math.round(scaled)));
    normalized[i] = Math.abs(clamped) < gate ? 0 : clamped;
  }

  return normalized;
}

export function bytesToInt16Frame(slice: Buffer): Int16Array {
  const arrayBuffer = slice.buffer.slice(slice.byteOffset, slice.byteOffset + slice.byteLength);
  return new Int16Array(arrayBuffer);
}

export function int16ArrayToBuffer(value: Int16Array): Buffer {
  return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
}

export function encodePcmFrameBase64(value: Int16Array): string {
  return int16ArrayToBuffer(value).toString("base64");
}

export function toDeepgramLanguage(language: string): string {
  const languageMap: Record<string, string> = {
    en: "en-US",
    hi: "hi",
    te: "te",
    ta: "ta",
    kn: "kn",
    ml: "ml",
    mr: "mr",
    bn: "bn",
    gu: "gu",
    pa: "pa",
    ur: "ur",
    es: "es",
    fr: "fr",
    de: "de",
    ja: "ja",
    ko: "ko",
    zh: "zh",
    ar: "ar",
    pt: "pt",
    ru: "ru",
    it: "it",
  };
  return languageMap[language] || "en-US";
}

export function toAzureLocale(language: string): string {
  const localeMap: Record<string, string> = {
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
    es: "es-ES",
    fr: "fr-FR",
    de: "de-DE",
    ja: "ja-JP",
    ko: "ko-KR",
    zh: "zh-CN",
    ar: "ar-SA",
    pt: "pt-BR",
    ru: "ru-RU",
    it: "it-IT",
  };
  return localeMap[language] || "en-IN";
}

export function toAzureProsody(emotion?: ProsodyEmotionLike | null): { rate: string; pitch: string; volume: string } {
  if (!emotion?.emotion) {
    return { rate: "0%", pitch: "0%", volume: "0%" };
  }

  switch (emotion.emotion) {
    case "happy":
      return { rate: "+6%", pitch: "+4%", volume: "+2%" };
    case "sad":
      return { rate: "-10%", pitch: "-4%", volume: "-2%" };
    case "angry":
      return { rate: "+3%", pitch: "-3%", volume: "+1%" };
    case "stressed":
      return { rate: "-4%", pitch: "+2%", volume: "0%" };
    case "calm":
      return { rate: "-5%", pitch: "-2%", volume: "-1%" };
    default:
      return { rate: "0%", pitch: "0%", volume: "0%" };
  }
}

export function applySpokenCorrections(text: string, language: string): string {
  let corrected = normalizeSpaces(text);
  if (!corrected) return corrected;

  corrected = corrected
    .replace(/\b(uh+|um+|erm+|hmm+)\b/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();

  if (language === "en") {
    corrected = corrected
      .replace(/\bgonna\b/gi, "going to")
      .replace(/\bwanna\b/gi, "want to")
      .replace(/\bgotta\b/gi, "have to")
      .replace(/\blemme\b/gi, "let me")
      .replace(/\bkinda\b/gi, "kind of")
      .replace(/\bsorta\b/gi, "sort of");
  }

  return corrected;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(String(value || ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
