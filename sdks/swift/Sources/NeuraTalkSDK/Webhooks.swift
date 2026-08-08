import Foundation
import CryptoKit

/// Verifies a NeuraTalk-style webhook signature: HMAC-SHA256 over the raw
/// request body, hex-encoded, compared in constant time. Mirrors the
/// signing scheme NeuraTalk's own backend uses for its Razorpay and MSG91
/// webhook receivers (server/payment-service.ts, server/modules/calls/
/// controller.ts). There is no dedicated public "register a webhook" API
/// yet — this helper is what you use inside your own webhook endpoint to
/// verify payloads NeuraTalk sends you.
///
/// - Parameters:
///   - rawBody: The exact, unparsed request body bytes — signing breaks if
///     you verify against a re-serialized copy of the parsed body.
///   - signature: The signature header value. A leading "sha256=" prefix
///     (as MSG91's webhook sends) is stripped automatically.
///   - secret: Your webhook signing secret.
public func verifyWebhookSignature(rawBody: Data, signature: String, secret: String) -> Bool {
    let key = SymmetricKey(data: Data(secret.utf8))
    let mac = HMAC<SHA256>.authenticationCode(for: rawBody, using: key)
    let expected = mac.map { String(format: "%02x", $0) }.joined()

    let provided = signature.hasPrefix("sha256=") ? String(signature.dropFirst("sha256=".count)) : signature
    return constantTimeEquals(expected, provided)
}

public func verifyWebhookSignature(rawBody: String, signature: String, secret: String) -> Bool {
    verifyWebhookSignature(rawBody: Data(rawBody.utf8), signature: signature, secret: secret)
}

private func constantTimeEquals(_ a: String, _ b: String) -> Bool {
    guard a.utf8.count == b.utf8.count else { return false }
    var result: UInt8 = 0
    for (x, y) in zip(a.utf8, b.utf8) {
        result |= x ^ y
    }
    return result == 0
}
