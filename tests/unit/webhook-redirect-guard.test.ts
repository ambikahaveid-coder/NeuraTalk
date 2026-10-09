import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Regression test: webhook delivery must treat a 3xx response as a failure
 * rather than following it to an unvalidated redirect destination.
 */

const httpsRequestMock = vi.hoisted(() => vi.fn());
let deliveryUpdateCalls: any[] = [];
let endpointRows: any[] = [];
let deliveryRows: any[] = [];

vi.mock("node:https", () => ({ request: httpsRequestMock }));
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
  lookup: vi.fn(async () => [{ address: "93.184.216.34", family: 4 }]),
}));

describe("webhook delivery — redirect guard", () => {
  beforeEach(() => {
    deliveryUpdateCalls = [];
    deliveryRows = [];
    httpsRequestMock.mockReset();
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
    httpsRequestMock.mockImplementation((_url, _options, onResponse) => {
      const request = {
        on: vi.fn().mockReturnThis(),
        end: vi.fn(() => onResponse({ statusCode: 302, resume: vi.fn() })),
      };
      return request;
    });

    const { dispatchEvent } = await import("../../server/modules/webhooks/service");
    await dispatchEvent(1, "call.ended", { callId: "call_1" });

    // Native HTTPS requests do not follow redirects; verify the single
    // outbound request uses the resolved, pinned destination.
    expect(httpsRequestMock).toHaveBeenCalledWith(
      new URL("https://example.com/hook"),
      expect.objectContaining({ method: "POST", lookup: expect.any(Function) }),
      expect.any(Function),
    );

    // And the delivery must be recorded as failed (not delivered), with a
    // message identifying the redirect as the reason.
    const failedUpdate = deliveryUpdateCalls.find((u) => u.status === "failed" || u.status === "exhausted");
    expect(failedUpdate).toBeTruthy();
    expect(failedUpdate.lastError).toMatch(/redirect/i);
    expect(failedUpdate.status).not.toBe("delivered");
  });
});
