import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Verifies a NeuraTalk-style webhook signature: HMAC-SHA256 over the raw
 * request body, hex-encoded, compared in constant time. This mirrors the
 * signing scheme NeuraTalk's own backend already uses for its Razorpay and
 * MSG91 webhook receivers (server/payment-service.ts, server/modules/calls/
 * controller.ts) — there is no dedicated public "register a webhook" API
 * yet, so this helper is what you use inside your own webhook endpoint to
 * verify payloads NeuraTalk sends you.
 *
 * @param rawBody   The exact, unparsed request body bytes/string as received
 *                  — signing breaks if you verify against a re-serialized
 *                  JSON.stringify(parsedBody) instead of the original bytes.
 * @param signature The signature header value. A leading "sha256=" prefix
 *                  (as MSG91's webhook sends) is stripped automatically.
 * @param secret    Your webhook signing secret.
 */
export function verifyWebhookSignature(rawBody: string | Buffer, signature: string, secret: string): boolean {
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  const provided = signature.startsWith("sha256=") ? signature.slice("sha256=".length) : signature;

  const expectedBuf = Buffer.from(expected, "hex");
  const providedBuf = Buffer.from(provided, "hex");
  if (expectedBuf.length !== providedBuf.length) return false;
  return timingSafeEqual(expectedBuf, providedBuf);
}
