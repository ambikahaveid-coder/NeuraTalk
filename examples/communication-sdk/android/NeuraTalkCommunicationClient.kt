package com.neuratalk.communication

import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject

class NeuraTalkCommunicationClient(
    private val apiBaseUrl: String,
    private val apiKey: String,
    private val httpClient: OkHttpClient = OkHttpClient(),
) {
    fun createCallSession(payload: JSONObject): JSONObject {
        val request = Request.Builder()
            .url("$apiBaseUrl/api/communication/create-call-session")
            .addHeader("X-API-Key", apiKey)
            .post(payload.toString().toRequestBody("application/json".toMediaType()))
            .build()

        httpClient.newCall(request).execute().use { response ->
            if (!response.isSuccessful) {
                error("create-call-session failed: ${response.code}")
            }
            return JSONObject(response.body!!.string())
        }
    }

    fun updateStatus(sessionId: String, state: String, participantIdentity: String): JSONObject {
        val payload = JSONObject()
            .put("state", state)
            .put("participantIdentity", participantIdentity)

        val request = Request.Builder()
            .url("$apiBaseUrl/api/communication/call-status/$sessionId")
            .addHeader("X-API-Key", apiKey)
            .post(payload.toString().toRequestBody("application/json".toMediaType()))
            .build()

        httpClient.newCall(request).execute().use { response ->
            if (!response.isSuccessful) error("status update failed: ${response.code}")
            return JSONObject(response.body!!.string())
        }
    }

    fun activateFallback(sessionId: String): JSONObject {
        val request = Request.Builder()
            .url("$apiBaseUrl/api/communication/sessions/$sessionId/fallback")
            .addHeader("X-API-Key", apiKey)
            .post("{}".toRequestBody("application/json".toMediaType()))
            .build()

        httpClient.newCall(request).execute().use { response ->
            if (!response.isSuccessful) error("fallback failed: ${response.code}")
            return JSONObject(response.body!!.string())
        }
    }
}
