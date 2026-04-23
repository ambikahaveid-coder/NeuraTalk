import { randomUUID } from "crypto";

export type LatencyMode = "APP_TO_APP" | "PSTN" | "FACE_TO_FACE";
export type BatchStage = "stt" | "translation" | "tts";

export interface LatencySnapshot {
  traceId: string;
  mode: LatencyMode;
  callId: string;
  direction: string;
  emittedAt: number;
  metrics: {
    timeToFirstAudioMs: number | null;
    sttLatencyMs: number | null;
    translationLatencyMs: number | null;
    ttsLatencyMs: number | null;
    networkLatencyMs: number | null;
    totalPipelineLatencyMs: number | null;
  };
  batchStages: BatchStage[];
  fallbackReasons: string[];
  providers: string[];
  networkBreakdown: Array<{ label: string; latencyMs: number }>;
  marks: Record<string, number>;
}

const MAX_SNAPSHOTS = 400;
const snapshots: LatencySnapshot[] = [];

function nowNs(): bigint {
  return process.hrtime.bigint();
}

function nsToMs(value: bigint): number {
  return Number(value) / 1_000_000;
}

function roundMs(value: number | null): number | null {
  if (value == null || !Number.isFinite(value) || value < 0) {
    return null;
  }

  return Number(value.toFixed(3));
}

export function nowMsPrecise(): number {
  return roundMs(nsToMs(nowNs())) ?? 0;
}

export class LatencyTrace {
  readonly traceId: string;
  readonly mode: LatencyMode;
  readonly callId: string;
  readonly direction: string;

  private readonly originNs = nowNs();
  private readonly marksNs = new Map<string, bigint>();
  private readonly batchStages = new Set<BatchStage>();
  private readonly fallbackReasons = new Set<string>();
  private readonly providers = new Set<string>();
  private readonly networkBreakdown = new Map<string, number>();
  private finalized = false;

  constructor(opts: {
    mode: LatencyMode;
    callId: string | number;
    direction: string;
    traceId?: string;
  }) {
    this.traceId = opts.traceId || randomUUID();
    this.mode = opts.mode;
    this.callId = String(opts.callId);
    this.direction = opts.direction;
  }

  mark(name: string, force = false): void {
    if (!force && this.marksNs.has(name)) {
      return;
    }

    this.marksNs.set(name, nowNs());
  }

  hasMark(name: string): boolean {
    return this.marksNs.has(name);
  }

  addProvider(provider: string): void {
    if (provider.trim()) {
      this.providers.add(provider.trim());
    }
  }

  markBatch(stage: BatchStage): void {
    this.batchStages.add(stage);
  }

  markFallback(reason: string): void {
    if (reason.trim()) {
      this.fallbackReasons.add(reason.trim());
    }
  }

  addObservedNetworkLatency(label: string, latencyMs: number): void {
    if (!label.trim() || !Number.isFinite(latencyMs) || latencyMs < 0) {
      return;
    }

    this.networkBreakdown.set(label.trim(), Number(latencyMs.toFixed(3)));
  }

  finalize(): LatencySnapshot {
    if (this.finalized) {
      const existing = snapshots.find((snapshot) => snapshot.traceId === this.traceId);
      if (existing) {
        return existing;
      }
    }

    this.finalized = true;
    const marks = Object.fromEntries(
      Array.from(this.marksNs.entries()).map(([key, value]) => [key, roundMs(nsToMs(value - this.originNs)) ?? 0]),
    );

    const playbackStart = this.elapsedBetween("speech_start", "playback_start")
      ?? this.elapsedBetween("speech_start", "first_audio_frame");
    const totalPipeline = this.elapsedBetween("speech_start", "final_playback_end")
      ?? this.elapsedBetween("speech_start", "first_audio_frame");

    const snapshot: LatencySnapshot = {
      traceId: this.traceId,
      mode: this.mode,
      callId: this.callId,
      direction: this.direction,
      emittedAt: Date.now(),
      metrics: {
        timeToFirstAudioMs: roundMs(playbackStart),
        sttLatencyMs: roundMs(this.elapsedBetween("speech_start", "first_transcript")),
        translationLatencyMs: roundMs(this.elapsedBetween("first_transcript", "first_translated_token")),
        ttsLatencyMs: roundMs(this.elapsedBetween("first_translated_token", "first_audio_frame")),
        networkLatencyMs: roundMs(this.getNetworkLatencyTotal()),
        totalPipelineLatencyMs: roundMs(totalPipeline),
      },
      batchStages: Array.from(this.batchStages),
      fallbackReasons: Array.from(this.fallbackReasons),
      providers: Array.from(this.providers),
      networkBreakdown: Array.from(this.networkBreakdown.entries()).map(([label, value]) => ({
        label,
        latencyMs: value,
      })),
      marks,
    };

    snapshots.push(snapshot);
    if (snapshots.length > MAX_SNAPSHOTS) {
      snapshots.shift();
    }

    try {
      console.log(JSON.stringify({ type: "latency_audit_trace", ...snapshot }));
    } catch {
      // Never fail the real-time path on audit logging.
    }

    return snapshot;
  }

  private elapsedBetween(startName: string, endName: string): number | null {
    const start = this.marksNs.get(startName);
    const end = this.marksNs.get(endName);
    if (!start || !end || end < start) {
      return null;
    }

    return nsToMs(end - start);
  }

  private getNetworkLatencyTotal(): number | null {
    if (this.networkBreakdown.size === 0) {
      return null;
    }

    let total = 0;
    for (const value of Array.from(this.networkBreakdown.values())) {
      total += value;
    }
    return total;
  }
}

export function createLatencyTrace(opts: {
  mode: LatencyMode;
  callId: string | number;
  direction: string;
  traceId?: string;
}): LatencyTrace {
  return new LatencyTrace(opts);
}

export function getLatencySnapshots(mode?: LatencyMode): LatencySnapshot[] {
  return mode ? snapshots.filter((snapshot) => snapshot.mode === mode) : snapshots.slice();
}

export function resetLatencySnapshots(): void {
  snapshots.length = 0;
}
