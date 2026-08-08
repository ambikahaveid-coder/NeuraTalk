import XCTest
import CryptoKit
@testable import NeuraTalkSDK

final class WebhooksTests: XCTestCase {
    private func hmacHex(secret: String, body: String) -> String {
        let key = SymmetricKey(data: Data(secret.utf8))
        let mac = HMAC<SHA256>.authenticationCode(for: Data(body.utf8), using: key)
        return mac.map { String(format: "%02x", $0) }.joined()
    }

    func testAcceptsValidSignature() {
        let secret = "topsecret"
        let body = "{\"event\":\"call.completed\"}"
        let sig = hmacHex(secret: secret, body: body)
        XCTAssertTrue(verifyWebhookSignature(rawBody: body, signature: sig, secret: secret))
    }

    func testAcceptsValidSignatureWithSha256Prefix() {
        let secret = "topsecret"
        let body = "{\"event\":\"call.completed\"}"
        let sig = hmacHex(secret: secret, body: body)
        XCTAssertTrue(verifyWebhookSignature(rawBody: body, signature: "sha256=\(sig)", secret: secret))
    }

    func testRejectsInvalidSignature() {
        XCTAssertFalse(verifyWebhookSignature(rawBody: "body", signature: String(repeating: "deadbeef", count: 8), secret: "secret"))
    }

    func testRejectsTamperedBody() {
        let secret = "topsecret"
        let sig = hmacHex(secret: secret, body: "original")
        XCTAssertFalse(verifyWebhookSignature(rawBody: "tampered", signature: sig, secret: secret))
    }
}
