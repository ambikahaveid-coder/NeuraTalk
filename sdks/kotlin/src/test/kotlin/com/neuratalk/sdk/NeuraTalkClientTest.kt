package com.neuratalk.sdk

import com.sun.net.httpserver.HttpServer
import java.net.InetSocketAddress
import java.util.concurrent.atomic.AtomicInteger
import kotlin.test.AfterTest
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertTrue

class NeuraTalkClientTest {
    private lateinit var server: HttpServer
    private lateinit var baseUrl: String

    @BeforeTest
    fun startServer() {
        server = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0)
        baseUrl = "http://127.0.0.1:${server.address.port}"
    }

    @AfterTest
    fun stopServer() {
        server.stop(0)
    }

    @Test
    fun `sends the Bearer token and parses a successful response`() {
        var capturedAuthHeader: String? = null
        server.createContext("/api/auth/me") { exchange ->
            capturedAuthHeader = exchange.requestHeaders.getFirst("Authorization")
            val body = """{"id":1,"username":"x","role":"consumer"}""".toByteArray()
            exchange.sendResponseHeaders(200, body.size.toLong())
            exchange.responseBody.use { it.write(body) }
        }
        server.start()

        val client = NeuraTalkClient(token = "sess_test", baseUrl = baseUrl)
        val user = client.me()

        assertEquals("x", user.getString("username"))
        assertEquals("Bearer sess_test", capturedAuthHeader)
    }

    @Test
    fun `throws NeuraTalkApiException with parsed error body on 4xx`() {
        server.createContext("/api/calls/123") { exchange ->
            val body = """{"error":"bad request"}""".toByteArray()
            exchange.sendResponseHeaders(400, body.size.toLong())
            exchange.responseBody.use { it.write(body) }
        }
        server.start()

        val client = NeuraTalkClient(baseUrl = baseUrl)
        val ex = assertFailsWith<NeuraTalkApiException> { client.getCall("123") }
        assertEquals(400, ex.status)
        assertEquals("bad request", ex.message)
    }

    @Test
    fun `retries once on 429 then succeeds`() {
        val callCount = AtomicInteger(0)
        server.createContext("/api/calls/1/end") { exchange ->
            if (callCount.incrementAndGet() == 1) {
                exchange.responseHeaders.add("Retry-After", "0")
                exchange.sendResponseHeaders(429, -1)
                exchange.close()
            } else {
                val body = "{}".toByteArray()
                exchange.sendResponseHeaders(200, body.size.toLong())
                exchange.responseBody.use { it.write(body) }
            }
        }
        server.start()

        val client = NeuraTalkClient(baseUrl = baseUrl, retryBaseDelayMs = 1)
        client.endCall("1")

        assertTrue(callCount.get() == 2)
    }
}
