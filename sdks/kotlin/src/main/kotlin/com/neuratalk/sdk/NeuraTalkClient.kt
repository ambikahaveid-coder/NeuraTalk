package com.neuratalk.sdk

import org.json.JSONArray
import org.json.JSONObject
import java.net.URI
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.time.Duration
import java.net.URLEncoder
import java.nio.charset.StandardCharsets

private val RETRYABLE_STATUS = setOf(429, 500, 502, 503, 504)

/**
 * Official NeuraTalk API client. Auth endpoints (register/login/requestOtp/
 * verifyOtp) don't require a token; everything else does — pass one via the
 * constructor or [withToken].
 */
class NeuraTalkClient(
    private val token: String? = null,
    private val baseUrl: String = "https://neuratalk.in",
    private val maxRetries: Int = 3,
    private val retryBaseDelayMs: Long = 300,
    private val httpClient: HttpClient = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(30)).build(),
) {
    fun withToken(token: String): NeuraTalkClient =
        NeuraTalkClient(token, baseUrl, maxRetries, retryBaseDelayMs, httpClient)

    // ---- Auth ----

    fun register(username: String, password: String, extra: JSONObject = JSONObject()): JSONObject {
        val body = JSONObject(extra.toString()).put("username", username).put("password", password)
        return request("POST", "/api/auth/register", body = body, auth = false)
    }

    fun login(username: String, password: String): JSONObject =
        request("POST", "/api/auth/login", body = JSONObject().put("username", username).put("password", password), auth = false)

    fun requestOtp(identifier: String, channel: String): JSONObject =
        request("POST", "/api/auth/otp/request", body = JSONObject().put("identifier", identifier).put("channel", channel), auth = false)

    fun verifyOtp(identifier: String, channel: String, code: String, firebaseToken: String? = null): JSONObject {
        val body = JSONObject().put("identifier", identifier).put("channel", channel).put("code", code)
        if (firebaseToken != null) body.put("firebaseToken", firebaseToken)
        return request("POST", "/api/auth/otp/verify", body = body, auth = false)
    }

    fun me(): JSONObject = request("GET", "/api/auth/me")

    fun logout() {
        request("POST", "/api/auth/logout")
    }

    // ---- Calls ----

    fun createCall(
        calleeIdentifier: String,
        callType: String,
        myLanguage: String = "auto",
        theirLanguage: String = "auto",
    ): JSONObject {
        val body = JSONObject()
            .put("calleeIdentifier", calleeIdentifier)
            .put("callType", callType)
            .put("myLanguage", myLanguage)
            .put("theirLanguage", theirLanguage)
        return request("POST", "/api/calls/create", body = body)
    }

    fun createConferenceCall(participantIds: List<String>, hostLanguage: String = "auto", title: String? = null): JSONObject {
        val body = JSONObject().put("participantIds", JSONArray(participantIds)).put("hostLanguage", hostLanguage)
        if (title != null) body.put("title", title)
        return request("POST", "/api/calls/conference", body = body)
    }

    fun connectCall(callId: String, receiverNumber: String? = null): JSONObject {
        val body = JSONObject()
        if (receiverNumber != null) body.put("receiverNumber", receiverNumber)
        return request("POST", "/api/calls/${enc(callId)}/connect", body = body)
    }

    fun endCall(callId: String): JSONObject = request("POST", "/api/calls/${enc(callId)}/end")

    fun holdCall(callId: String): JSONObject = request("POST", "/api/calls/${enc(callId)}/hold")

    fun resumeCall(callId: String): JSONObject = request("DELETE", "/api/calls/${enc(callId)}/hold")

    fun rejectCall(callId: String): JSONObject = request("POST", "/api/calls/${enc(callId)}/reject")

    fun getIncomingCall(): JSONObject? {
        val res = request("GET", "/api/calls/incoming")
        return if (res.isNull("incoming") || !res.has("incoming")) null else res.optJSONObject("incoming")
    }

    fun listCallHistory(limit: Int = 50): JSONArray =
        request("GET", "/api/calls/history?limit=$limit").optJSONArray("calls") ?: JSONArray()

    fun getCall(callId: String): JSONObject = request("GET", "/api/calls/${enc(callId)}")

    // ---- Transcripts ----

    fun searchTranscripts(query: String, limit: Int? = null, offset: Int? = null): JSONObject {
        val params = StringBuilder("q=${enc(query)}")
        if (limit != null) params.append("&limit=$limit")
        if (offset != null) params.append("&offset=$offset")
        return request("GET", "/api/transcripts/search?$params")
    }

    fun getTranscript(callId: String): JSONArray =
        request("GET", "/api/transcripts/${enc(callId)}").optJSONArray("segments") ?: JSONArray()

    fun deleteTranscript(callId: String): JSONObject = request("DELETE", "/api/transcripts/${enc(callId)}")

    /** Returns the raw exported file bytes — write them to disk or stream them as-is. */
    fun exportTranscript(callId: String, format: String): ByteArray {
        val res = rawRequest("GET", "/api/transcripts/${enc(callId)}/export/$format", bodyBytes = null)
        return res.body()
    }

    // ---- Internals ----

    private fun enc(s: String): String = URLEncoder.encode(s, StandardCharsets.UTF_8)

    private fun request(method: String, path: String, body: JSONObject? = null, auth: Boolean = true): JSONObject {
        val bodyBytes = body?.toString()?.toByteArray(StandardCharsets.UTF_8)
        val res = rawRequest(method, path, bodyBytes, auth)
        val text = String(res.body(), StandardCharsets.UTF_8)
        return if (text.isBlank()) JSONObject() else JSONObject(text)
    }

    private fun rawRequest(method: String, path: String, bodyBytes: ByteArray?, auth: Boolean = true): HttpResponse<ByteArray> {
        val url = URI.create("$baseUrl$path")
        var attempt = 0
        while (true) {
            attempt++
            val builder = HttpRequest.newBuilder(url).timeout(Duration.ofSeconds(30))
            if (bodyBytes != null) builder.header("Content-Type", "application/json")
            if (auth && token != null) builder.header("Authorization", "Bearer $token")
            val publisher = if (bodyBytes != null) HttpRequest.BodyPublishers.ofByteArray(bodyBytes) else HttpRequest.BodyPublishers.noBody()
            builder.method(method, publisher)

            val res: HttpResponse<ByteArray>
            try {
                res = httpClient.send(builder.build(), HttpResponse.BodyHandlers.ofByteArray())
            } catch (cause: Exception) {
                if (attempt > maxRetries) throw NeuraTalkNetworkException(cause)
                backoff(attempt)
                continue
            }

            if (res.statusCode() !in 200..299) {
                if (res.statusCode() in RETRYABLE_STATUS && attempt <= maxRetries) {
                    backoff(attempt, res.headers().firstValue("Retry-After").orElse(null))
                    continue
                }
                val errorBody = try {
                    val text = String(res.body(), StandardCharsets.UTF_8)
                    if (text.isBlank()) null else JSONObject(text)
                } catch (_: Exception) {
                    null
                }
                throw NeuraTalkApiException(res.statusCode(), errorBody)
            }
            return res
        }
    }

    private fun backoff(attempt: Int, retryAfterHeader: String? = null) {
        val delayMs = retryAfterHeader?.toDoubleOrNull()?.let { (it * 1000).toLong() }
            ?: (retryBaseDelayMs * (1L shl (attempt - 1)))
        Thread.sleep(delayMs)
    }
}
