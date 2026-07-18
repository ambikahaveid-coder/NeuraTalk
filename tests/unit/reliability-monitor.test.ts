import { describe, it, expect, vi } from "vitest";

const loggerMock = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
vi.mock("../../server/observability", () => ({ logger: loggerMock }));

describe("reliability-monitor", () => {
  it("timedDbQuery returns the wrapped function's result on success", async () => {
    const { timedDbQuery } = await import("../../server/reliability-monitor");
    const result = await timedDbQuery("test-query", async () => 42);
    expect(result).toBe(42);
  });

  it("timedDbQuery records latency samples visible in the snapshot", async () => {
    const { timedDbQuery, getDbLatencySnapshot } = await import("../../server/reliability-monitor");
    await timedDbQuery("q1", async () => "ok");
    await timedDbQuery("q2", async () => "ok");
    const snapshot = getDbLatencySnapshot();
    expect(snapshot.count).toBeGreaterThanOrEqual(2);
  });

  it("timedDbQuery logs and re-throws on failure, and counts it as a failure", async () => {
    const { timedDbQuery, getDbLatencySnapshot } = await import("../../server/reliability-monitor");
    const before = getDbLatencySnapshot().failures;

    await expect(timedDbQuery("failing-query", async () => {
      throw new Error("connection refused");
    })).rejects.toThrow("connection refused");

    expect(loggerMock.error).toHaveBeenCalledWith(
      "ReliabilityMonitor",
      expect.stringContaining("failing-query"),
      expect.any(Error),
    );
    expect(getDbLatencySnapshot().failures).toBe(before + 1);
  });

  it("getResourceSnapshot returns a well-formed memory/CPU snapshot", async () => {
    const { getResourceSnapshot } = await import("../../server/reliability-monitor");
    const snapshot = getResourceSnapshot();
    expect(snapshot.memory.heapUsedMb).toBeGreaterThan(0);
    expect(snapshot.memory.heapTotalMb).toBeGreaterThan(0);
    expect(typeof snapshot.cpuPercent).toBe("number");
    expect(Array.isArray(snapshot.loadAverage)).toBe(true);
  });
});
