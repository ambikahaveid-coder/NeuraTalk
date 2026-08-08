package com.neuratalk.sdk

import java.nio.charset.StandardCharsets
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec

/**
 * Verifies a NeuraTalk-style webhook signature: HMAC-SHA256 over the raw
 * request body, hex-encoded, compared in constant time. Mirrors the signing
 * scheme NeuraTalk's own backend uses for its Razorpay and MSG91 webhook
 * receivers (server/payment-service.ts, server/modules/calls/controller.ts).
 * There is no dedicated public "register a webhook" API yet — this helper is
 * what you use inside your own webhook endpoint to verify payloads
 * NeuraTalk sends you.
 *
 * @param rawBody The exact, unparsed request body bytes — signing breaks if
 *   you verify against a re-serialized copy of the parsed body.
 * @param signature The signature header value. A leading "sha256=" prefix
 *   (as MSG91's webhook sends) is stripped automatically.
 * @param secret Your webhook signing secret.
 */
fun verifyWebhookSignature(rawBody: ByteArray, signature: String, secret: String): Boolean {
    val mac = Mac.getInstance("HmacSHA256")
    mac.init(SecretKeySpec(secret.toByteArray(StandardCharsets.UTF_8), "HmacSHA256"))
    val expected = mac.doFinal(rawBody).joinToString("") { "%02x".format(it) }
    val provided = if (signature.startsWith("sha256=")) signature.substring(7) else signature
    return constantTimeEquals(expected, provided)
}

fun verifyWebhookSignature(rawBody: String, signature: String, secret: String): Boolean =
    verifyWebhookSignature(rawBody.toByteArray(StandardCharsets.UTF_8), signature, secret)

private fun constantTimeEquals(a: String, b: String): Boolean {
    if (a.length != b.length) return false
    var result = 0
    for (i in a.indices) {
        result = result or (a[i].code xor b[i].code)
    }
    return result == 0
}
