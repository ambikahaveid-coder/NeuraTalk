// Sample app: OTP login, place a call, fetch and export the transcript.
// Compile+run against the built SDK jar (see README's "Building from source").
// Requires NEURATALK_IDENTIFIER / NEURATALK_OTP env vars for a real run.
import com.neuratalk.sdk.NeuraTalkApiException
import com.neuratalk.sdk.NeuraTalkClient

fun main() {
    val client = NeuraTalkClient(baseUrl = System.getenv("NEURATALK_BASE_URL") ?: "https://neuratalk.in")

    val identifier = System.getenv("NEURATALK_IDENTIFIER")
    val otp = System.getenv("NEURATALK_OTP")
    if (identifier == null || otp == null) {
        println("Set NEURATALK_IDENTIFIER and NEURATALK_OTP to run this example against a real server.")
        return
    }

    val result = client.verifyOtp(identifier, "mobile", otp)
    val authed = client.withToken(result.getString("token"))

    try {
        val session = authed.createCall(
            calleeIdentifier = "+919876543210",
            callType = "voice",
            myLanguage = "en",
            theirLanguage = "hi",
        )
        println("Call created: ${session.getString("callId")}")

        val transcript = authed.getTranscript(session.getString("callId"))
        println("Transcript has ${transcript.length()} segments")

        val pdfBytes = authed.exportTranscript(session.getString("callId"), "pdf")
        println("Exported PDF: ${pdfBytes.size} bytes")
    } catch (e: NeuraTalkApiException) {
        println("API error ${e.status}: ${e.message}")
    }
}
