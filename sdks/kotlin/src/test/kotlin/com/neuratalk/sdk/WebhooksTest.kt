package com.neuratalk.sdk

import java.nio.charset.StandardCharsets
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec
import kotlin.test.Test
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class WebhooksTest {
    private fun hmacHex(secret: String, body: String): String {
        val mac = Mac.getInstance("HmacSHA256")
        mac.init(SecretKeySpec(secret.toByteArray(StandardCharsets.UTF_8), "HmacSHA256"))
        return mac.doFinal(body.toByteArray(StandardCharsets.UTF_8)).joinToString("") { "%02x".format(it) }
    }

    @Test
    fun `accepts a valid signature`() {
        val secret = "topsecret"
        val body = """{"event":"call.completed"}"""
        val sig = hmacHex(secret, body)
        assertTrue(verifyWebhookSignature(body, sig, secret))
    }

    @Test
    fun `accepts a valid signature with sha256 prefix`() {
        val secret = "topsecret"
        val body = """{"event":"call.completed"}"""
        val sig = hmacHex(secret, body)
        assertTrue(verifyWebhookSignature(body, "sha256=$sig", secret))
    }

    @Test
    fun `rejects an invalid signature`() {
        assertFalse(verifyWebhookSignature("body", "deadbeef".repeat(8), "secret"))
    }

    @Test
    fun `rejects a tampered body`() {
        val secret = "topsecret"
        val sig = hmacHex(secret, "original")
        assertFalse(verifyWebhookSignature("tampered", sig, secret))
    }
}
