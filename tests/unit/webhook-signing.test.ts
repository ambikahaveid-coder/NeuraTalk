import { describe, it, expect, vi } from "vitest";

// The functions under test are pure crypto and never touch the DB, but
// service.ts imports server/db.ts at module scope, which runs an
// environment-conflict check on import — mock it out so this file can be
// tested in isolation the same way tests/unit/payment-webhook-signature.test.ts
// already does for a similar pure-crypto function living next to DB code.
vi.mock("../../server/db", () => ({ db: {} }));
vi.mock("../../server/observability", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { signWebhookPayload, verifyWebhookSignature, isValidWebhookEventType } from "../../server/modules/webhooks/service";

/**
 * Verifies the HMAC-SHA256 signing/verification logic for outbound
 * webhooks — the security-critical piece a customer's server relies on to
 * confirm a webhook really came from NeuraTalk. Pure crypto, no DB/network.
 */
describe("outbound webhook signing", () => {
  it("produces a deterministic HMAC-SHA256 hex signature", () => {
    const secret = "test_secret_abc123";
    const body = JSON.stringify({ event: "call.ended", data: { callId: "call_1" } });
    const sig1 = signWebhookPayload(secret, body);
    const sig2 = signWebhookPayload(secret, body);
    expect(sig1).toBe(sig2);
    expect(sig1).toMatch(/^[0-9a-f]{64}$/); // SHA-256 hex digest length
  });

  it("verifies a signature generated with the correct secret", () => {
    const secret = "correct_secret";
    const body = JSON.stringify({ event: "call.initiated" });
    const sig = signWebhookPayload(secret, body);
    expect(verifyWebhookSignature(secret, body, sig)).toBe(true);
  });

  it("rejects a signature generated with the wrong secret", () => {
    const body = JSON.stringify({ event: "call.initiated" });
    const sig = signWebhookPayload("secret_a", body);
    expect(verifyWebhookSignature("secret_b", body, sig)).toBe(false);
  });

  it("rejects a tampered payload even with a valid-looking signature", () => {
    const secret = "shared_secret";
    const originalBody = JSON.stringify({ event: "call.ended", amount: 100 });
    const sig = signWebhookPayload(secret, originalBody);
    const tamperedBody = JSON.stringify({ event: "call.ended", amount: 1000000 });
    expect(verifyWebhookSignature(secret, tamperedBody, sig)).toBe(false);
  });

  it("rejects a malformed (non-hex) provided signature without throwing", () => {
    expect(() => verifyWebhookSignature("secret", "body", "not-hex-!!!")).not.toThrow();
    expect(verifyWebhookSignature("secret", "body", "not-hex-!!!")).toBe(false);
  });

  it("rejects an empty signature", () => {
    const secret = "secret";
    const body = "{}";
    expect(verifyWebhookSignature(secret, body, "")).toBe(false);
  });
});

describe("webhook event type validation", () => {
  it("accepts known event types", () => {
    expect(isValidWebhookEventType("call.initiated")).toBe(true);
    expect(isValidWebhookEventType("call.ended")).toBe(true);
    expect(isValidWebhookEventType("translation.started")).toBe(true);
    expect(isValidWebhookEventType("recording.ready")).toBe(true);
  });

  it("rejects unknown event types", () => {
    expect(isValidWebhookEventType("call.exploded")).toBe(false);
    expect(isValidWebhookEventType("")).toBe(false);
    expect(isValidWebhookEventType("CALL.ENDED")).toBe(false); // case-sensitive
  });
});
