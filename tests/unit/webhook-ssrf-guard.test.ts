import { describe, it, expect, vi } from "vitest";

vi.mock("../../server/db", () => ({ db: {} }));
vi.mock("../../server/observability", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

/**
 * Verifies the SSRF guard added to registerWebhookEndpoint/attemptDelivery
 * — without this, an org admin could register an internal/private URL and
 * this server would make an authenticated-looking outbound request to it
 * (e.g. a cloud metadata endpoint), a classic SSRF-via-webhook attack.
 */
describe("webhook URL SSRF guard", () => {
  it("rejects a non-HTTPS URL", async () => {
    const { assertWebhookUrlIsSafe } = await import("../../server/modules/webhooks/service");
    await expect(assertWebhookUrlIsSafe("http://example.com/hook")).rejects.toThrow("WEBHOOK_URL_MUST_BE_HTTPS");
  });

  it("rejects localhost", async () => {
    const { assertWebhookUrlIsSafe } = await import("../../server/modules/webhooks/service");
    await expect(assertWebhookUrlIsSafe("https://localhost/hook")).rejects.toThrow("WEBHOOK_URL_TARGETS_DISALLOWED_HOST");
  });

  it("rejects a literal loopback IP", async () => {
    const { assertWebhookUrlIsSafe } = await import("../../server/modules/webhooks/service");
    await expect(assertWebhookUrlIsSafe("https://127.0.0.1/hook")).rejects.toThrow("WEBHOOK_URL_TARGETS_DISALLOWED_HOST");
  });

  it("rejects the cloud metadata IP (169.254.169.254) — the classic SSRF target", async () => {
    const { assertWebhookUrlIsSafe } = await import("../../server/modules/webhooks/service");
    await expect(assertWebhookUrlIsSafe("https://169.254.169.254/latest/meta-data/")).rejects.toThrow("WEBHOOK_URL_TARGETS_DISALLOWED_HOST");
  });

  it("rejects RFC1918 private ranges (10.x, 172.16-31.x, 192.168.x)", async () => {
    const { assertWebhookUrlIsSafe } = await import("../../server/modules/webhooks/service");
    await expect(assertWebhookUrlIsSafe("https://10.0.0.5/hook")).rejects.toThrow("WEBHOOK_URL_TARGETS_DISALLOWED_HOST");
    await expect(assertWebhookUrlIsSafe("https://172.20.0.5/hook")).rejects.toThrow("WEBHOOK_URL_TARGETS_DISALLOWED_HOST");
    await expect(assertWebhookUrlIsSafe("https://192.168.1.5/hook")).rejects.toThrow("WEBHOOK_URL_TARGETS_DISALLOWED_HOST");
  });

  it("rejects IPv6 loopback (::1)", async () => {
    const { assertWebhookUrlIsSafe } = await import("../../server/modules/webhooks/service");
    await expect(assertWebhookUrlIsSafe("https://[::1]/hook")).rejects.toThrow("WEBHOOK_URL_TARGETS_DISALLOWED_HOST");
  });

  it("rejects an IPv4-mapped-IPv6 loopback address (::ffff:127.0.0.1) — a real bypass this suite caught: the plain IPv6 checks only look at leading bytes and never unwrap an embedded IPv4 address", async () => {
    const { assertWebhookUrlIsSafe } = await import("../../server/modules/webhooks/service");
    await expect(assertWebhookUrlIsSafe("https://[::ffff:127.0.0.1]/hook")).rejects.toThrow("WEBHOOK_URL_TARGETS_DISALLOWED_HOST");
  });

  it("rejects an IPv4-mapped-IPv6 cloud-metadata address (::ffff:169.254.169.254)", async () => {
    const { assertWebhookUrlIsSafe } = await import("../../server/modules/webhooks/service");
    await expect(assertWebhookUrlIsSafe("https://[::ffff:169.254.169.254]/hook")).rejects.toThrow("WEBHOOK_URL_TARGETS_DISALLOWED_HOST");
  });

  it("allows a normal-looking public IP literal", async () => {
    const { assertWebhookUrlIsSafe } = await import("../../server/modules/webhooks/service");
    // 8.8.8.8 (Google DNS) — a real, public, non-reserved IP used only as
    // a stand-in "this is not a private address" test vector.
    await expect(assertWebhookUrlIsSafe("https://8.8.8.8/hook")).resolves.toBeUndefined();
  });
});
