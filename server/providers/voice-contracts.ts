import type { AudioFrame } from "@livekit/rtc-node";

export interface StreamingTranscriptEvent {
  text: string;
  isFinal: boolean;
  speechFinal: boolean;
  confidence?: number | null;
  provider: string;
  language?: string | null;
  languageConfidence?: string | null;
  sequenceId?: number;
  latencyMs?: number | null;
  offsetMs?: number | null;
  durationMs?: number | null;
  receivedAt?: string;
}

export interface StreamingSttProviderSession {
  readonly provider: string;
  connect(): Promise<void>;
  send(frame: AudioFrame | Int16Array | Buffer): void;
  close(): Promise<void>;
}

export interface StreamingSttProvider {
  readonly provider: string;
  readonly mode: "primary" | "fallback";
  createSession(opts: {
    language: string;
    onTranscript: (event: StreamingTranscriptEvent) => void;
    onError: (error: Error) => void;
    onProviderSwitch?: (provider: string, reason: string) => void;
    onSocketOpen?: (latencyMs: number) => void;
    endpointingMs?: number;
    utteranceEndMs?: number;
  }): StreamingSttProviderSession;
}

export interface StreamingTtsProvider {
  readonly provider: string;
  streamText(
    text: string,
    language: string,
    signal: AbortSignal,
    opts?: {
      onFirstByte?: () => void;
      onResponseHeaders?: (latencyMs: number) => void;
      emotion?: { emotion?: string | null } | null;
      userAgent?: string;
    },
  ): AsyncGenerator<Int16Array>;
}

export interface RealtimeLlmProvider {
  readonly provider: string;
  streamResponse<T>(
    input: T,
    opts: {
      signal?: AbortSignal;
      timeoutMs?: number;
    },
  ): Promise<AsyncIterable<unknown>>;
}
