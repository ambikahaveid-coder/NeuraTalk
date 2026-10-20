import { describe, it, expect, beforeEach } from "vitest";
import {
  getMetricsSnapshot,
  getVoiceMetricsSnapshot,
  recordStageLatency,
  recordVoiceCounter,
  resetMetrics,
} from "../../server/modules/calls/metrics";

describe("call pipeline metrics", () => {
  beforeEach(() => resetMetrics());

  it("tracks the after-speech delay separately from start-of-speech totals", () => {
    for (const ms of [200, 300, 400, 500, 1500]) recordStageLatency("c1", "response", ms);
    recordStageLatency("c1", "total", 4000);

    const snap = getMetricsSnapshot();
    expect(snap.response.count).toBe(5);
    expect(snap.response.p50).toBe(400);
    expect(snap.response.p95).toBe(1500);
    expect(snap.total.count).toBe(1);
  });

  it("ignores negative or invalid samples", () => {
    recordStageLatency("c1", "response", -5);
    recordStageLatency("c1", "response", Number.NaN);
    expect(getMetricsSnapshot().response.count).toBe(0);
  });

  it("counts own-voice and standard-voice turns", () => {
    recordVoiceCounter("own_voice_turns");
    recordVoiceCounter("own_voice_turns");
    recordVoiceCounter("fallback_voice_turns");
    const counters = getVoiceMetricsSnapshot().counters;
    expect(counters.own_voice_turns).toBe(2);
    expect(counters.fallback_voice_turns).toBe(1);
  });
});
