package com.neuratalk.sdk

import org.json.JSONObject

/**
 * Raised for any non-2xx NeuraTalk API response. [body] is the parsed JSON
 * error payload (or null if the body wasn't valid JSON) — its shape varies
 * by module (there is no single error envelope across the API: auth returns
 * {message}/{success, message}, calls/transcripts return {error}). Check
 * defensively rather than assuming one shape.
 */
class NeuraTalkApiException(val status: Int, val body: JSONObject?) :
    Exception(extractMessage(body) ?: "Request failed with status $status") {

    companion object {
        private fun extractMessage(body: JSONObject?): String? {
            if (body == null) return null
            if (body.has("message") && body.get("message") is String) return body.getString("message")
            if (body.has("error") && body.get("error") is String) return body.getString("error")
            return null
        }
    }
}

class NeuraTalkNetworkException(cause: Throwable) :
    Exception("Network error while calling the NeuraTalk API: ${cause.message}", cause)
