import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Regression test for a real, independently-confirmed bug: the webhook
 * delivery fetch() previously had no `redirect: "manual"`, so a webhook
 * endpoint that passed the SSRF safety check at registration time could
 * respond with an HTTP 3xx pointing at an internal/private address, and
 * fetch's default "follow" behavior would silently chase it there — with
 * our signed payload attached — without ever re-validating the redirect
 * target. This test proves a 3xx response is now treated as a delivery
 * failure, not silently followed.
 */

let deliveryUpdateCalls: any[] = [];
let endpointRows: any[] = [];
let deliveryRows: any[] = [];

vi.mock("../../server/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => Promise.resolve(endpointRows),
      }),
    }),
    insert: () => ({
      values: (row: any) => ({
        returning: () => {
          const withId = { id: deliveryRows.length + 1, attempts: 0, ...row };
          deliveryRows.push(withId);
          return Promise.resolve([withId]);
        },
      }),
    }),
    update: () => ({
      set: (row: any) => ({
        where: () => {
          deliveryUpdateCalls.push(row);
          return Promise.resolve([]);
        },
      }),
    }),
  },
}));

vi.mock("../../server/observability", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// assertWebhookUrlIsSafe does a real dns.lookup() — mock it so this test
// doesn't depend on real network access, and so the fixed URL resolves to
// an uncontroversial public address regardless of the test environment's
// actual DNS.
vi.mock("dns/promises", () => ({
  lookup: vi.fn(async () => ({ address: "93.184.216.34", family: 4 })),
}));

describe("webhook delivery — redirect guard", () => {
  beforeEach(() => {
    deliveryUpdateCalls = [];
    deliveryRows = [];
    endpointRows = [
      {
        id: 1,
        organizationId: 1,
        url: "https://example.com/hook",
        secret: "test-secret",
        subscribedEvents: ["call.ended"],
        isActive: true,
      },
    ];
    // Re-mock select().from() to distinguish webhookEndpoints vs webhookDeliveries
    // by returning endpointRows for any select — this test only needs the
    // endpoint lookup path (dispatchEvent reads endpoints, not deliveries).
  });

  it("treats an HTTP 3xx response as a delivery failure instead of following it", async () => {
    const mockFetch = vi.fn(async () => ({
      status: 302,
      ok: false,
    } as Response));
    vi.stubGlobal("fetch", mockFetch);

    const { dispatchEvent } = await import("../../server/modules/webhooks/service");
    await dispatchEvent(1, "call.ended", { callId: "call_1" });

    // The actual outbound fetch must have been made with redirect: "manual"
    expect(mockFetch).toHaveBeenCalledWith(
      "https://example.com/hook",
      expect.objectContaining({ redirect: "manual" }),
    );

    // And the delivery must be recorded as failed (not delivered), with a
    // message identifying the redirect as the reason.
    const failedUpdate = deliveryUpdateCalls.find((u) => u.status === "failed" || u.status === "exhausted");
    expect(failedUpdate).toBeTruthy();
    expect(failedUpdate.lastError).toMatch(/redirect/i);
    expect(failedUpdate.status).not.toBe("delivered");

    vi.unstubAllGlobals();
  });
});
