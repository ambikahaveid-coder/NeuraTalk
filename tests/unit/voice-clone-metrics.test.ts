import { describe, it, expect, beforeEach, vi } from "vitest";
import { recordVoiceCloneCounter, getVoiceCloneMetricsSnapshot, resetVoiceCloneMetrics } from "../../server/voice-clone-metrics";

vi.mock("../../server/observability", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

describe("voice-clone-metrics", () => {
  beforeEach(() => {
    resetVoiceCloneMetrics();
  });

  it("increments training counters independently", () => {
    recordVoiceCloneCounter("trainings_started", 2);
    recordVoiceCloneCounter("training_failed", 1);
    const snapshot = getVoiceCloneMetricsSnapshot();
    expect(snapshot.counters.trainings_started).toBe(2);
    expect(snapshot.counters.training_failed).toBe(1);
  });

  it("tracks moderation approve/reject separately", () => {
    recordVoiceCloneCounter("moderation_approved", 3);
    recordVoiceCloneCounter("moderation_rejected", 1);
    const snapshot = getVoiceCloneMetricsSnapshot();
    expect(snapshot.counters.moderation_approved).toBe(3);
    expect(snapshot.counters.moderation_rejected).toBe(1);
  });

  it("resets all counters to zero", () => {
    recordVoiceCloneCounter("samples_uploaded", 10);
    resetVoiceCloneMetrics();
    expect(getVoiceCloneMetricsSnapshot().counters.samples_uploaded).toBe(0);
  });
});
