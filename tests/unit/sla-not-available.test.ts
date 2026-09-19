import { beforeEach, describe, expect, it, vi } from "vitest";

const selectMock = vi.fn();

vi.mock("../../server/db", () => ({
  db: {
    select: selectMock,
  },
}));

vi.mock("../../server/role-middleware", () => ({
  requireRole: () => (_req: unknown, _res: unknown, next: () => void) => next(),
  requireAuth: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

describe("Phase A SLA truthfulness", () => {
  beforeEach(() => {
    vi.resetModules();
    selectMock.mockReturnValue({
      from: () => ({
        limit: async () => [],
      }),
    });
  });

  it("returns NOT_AVAILABLE values instead of fabricated SLA metrics", async () => {
    const { getSLAMetrics } = await import("../../server/sla-management");
    const metrics = await getSLAMetrics(7, 30);

    expect(metrics.totalCalls).toBeNull();
    expect(metrics.uptime).toBeNull();
    expect(metrics.avgResponseTime).toBeNull();
    expect(metrics.avgCallQuality).toBeNull();
    expect(metrics.failedCalls).toBeNull();
    expect(metrics.successRate).toBeNull();
  });
});
