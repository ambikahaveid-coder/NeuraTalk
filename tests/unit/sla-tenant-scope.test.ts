import { beforeEach, describe, expect, it, vi } from "vitest";

const selectMock = vi.fn();
vi.mock("../../server/db", () => ({ db: { select: selectMock } }));
vi.mock("../../server/role-middleware", () => ({
  requireRole: () => (_req: unknown, _res: unknown, next: () => void) => next(),
  requireAuth: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

describe("organization SLA telemetry scope", () => {
  beforeEach(() => {
    vi.resetModules();
    selectMock.mockReturnValue({ from: () => ({ limit: async () => [{ id: 1 }] }) });
  });

  it("does not expose a global telemetry sample count for an organization", async () => {
    const { getSLAMetrics } = await import("../../server/sla-management");
    const metrics = await getSLAMetrics(7, 30);
    expect(metrics.totalCalls).toBeNull();
    expect(metrics.uptime).toBeNull();
    expect(metrics.successRate).toBeNull();
  });
});
