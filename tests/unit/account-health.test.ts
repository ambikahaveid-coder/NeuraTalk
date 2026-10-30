import { describe, it, expect, vi } from "vitest";

vi.mock("../../server/db", () => ({ db: {} }));

describe("business messaging account health rules", () => {
  it("rates quality from blocks/opt-outs/reports per customer reached", async () => {
    const { qualityFor } = await import("../../server/modules/messaging/account-health");
    expect(qualityFor(10, 5)).toBe("new"); // too few customers to judge
    expect(qualityFor(100, 1)).toBe("high"); // 1%
    expect(qualityFor(100, 3)).toBe("medium"); // 3%
    expect(qualityFor(100, 5)).toBe("low"); // 5%
    expect(qualityFor(1000, 19)).toBe("high");
  });

  it("steps the daily limit up and down through the tiers, never past the ends", async () => {
    const { stepDown, nextTierFor, MESSAGING_TIERS } = await import("../../server/modules/messaging/account-health");
    expect(MESSAGING_TIERS).toEqual([250, 1000, 10000, 100000]);
    expect(nextTierFor(250)).toBe(1000);
    expect(nextTierFor(100000)).toBeNull();
    expect(stepDown(10000)).toBe(1000);
    expect(stepDown(250)).toBe(250);
  });

  it("reads the stored limit safely: unknown or missing values fall back to 250", async () => {
    const { readStoredLimit } = await import("../../server/modules/messaging/account-health");
    expect(readStoredLimit(null)).toEqual({ tier: 250, pinned: false, updatedAt: null });
    expect(readStoredLimit({ messagingLimit: { tier: 999999, pinned: "yes" } })).toEqual({ tier: 250, pinned: false, updatedAt: null });
    expect(readStoredLimit({ messagingLimit: { tier: 10000, pinned: true, updatedAt: "2026-10-29T00:00:00.000Z" } }))
      .toEqual({ tier: 10000, pinned: true, updatedAt: "2026-10-29T00:00:00.000Z" });
  });
});
