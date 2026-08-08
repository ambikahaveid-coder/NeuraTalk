// Sample app: OTP login, place a call, fetch and export the transcript.
// Requires NEURATALK_IDENTIFIER / NEURATALK_OTP env vars for a real run.
// NOTE: not build-verified in this environment — see README.md.
import Foundation
import NeuraTalkSDK

@main
struct BasicCall {
    static func main() async {
        let client = NeuraTalkClient(baseUrl: ProcessInfo.processInfo.environment["NEURATALK_BASE_URL"] ?? "https://neuratalk.in")

        guard let identifier = ProcessInfo.processInfo.environment["NEURATALK_IDENTIFIER"],
              let otp = ProcessInfo.processInfo.environment["NEURATALK_OTP"] else {
            print("Set NEURATALK_IDENTIFIER and NEURATALK_OTP to run this example against a real server.")
            return
        }

        do {
            let result = try await client.verifyOtp(identifier: identifier, channel: "mobile", code: otp)
            let authed = client.withToken(result["token"] as! String)

            let session = try await authed.createCall(
                calleeIdentifier: "+919876543210",
                callType: "voice",
                myLanguage: "en",
                theirLanguage: "hi"
            )
            print("Call created: \(session["callId"] ?? "")")

            let callId = session["callId"] as! String
            let transcript = try await authed.getTranscript(callId: callId)
            print("Transcript has \(transcript.count) segments")

            let pdfData = try await authed.exportTranscript(callId: callId, format: "pdf")
            print("Exported PDF: \(pdfData.count) bytes")
        } catch let error as NeuraTalkApiError {
            print("API error \(error.status): \(error.errorDescription ?? "unknown")")
        } catch {
            print("Error: \(error)")
        }
    }
}
