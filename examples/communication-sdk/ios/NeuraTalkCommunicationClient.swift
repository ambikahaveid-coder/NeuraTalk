import Foundation

final class NeuraTalkCommunicationClient {
    private let apiBaseURL: URL
    private let apiKey: String
    private let session: URLSession

    init(apiBaseURL: URL, apiKey: String, session: URLSession = .shared) {
        self.apiBaseURL = apiBaseURL
        self.apiKey = apiKey
        self.session = session
    }

    func createCallSession(payload: [String: Any]) async throws -> [String: Any] {
        try await postJSON(path: "/api/communication/create-call-session", payload: payload)
    }

    func updateStatus(sessionId: String, state: String, participantIdentity: String) async throws -> [String: Any] {
        try await postJSON(
            path: "/api/communication/call-status/\(sessionId)",
            payload: [
                "state": state,
                "participantIdentity": participantIdentity
            ]
        )
    }

    func activateFallback(sessionId: String) async throws -> [String: Any] {
        try await postJSON(path: "/api/communication/sessions/\(sessionId)/fallback", payload: [:])
    }

    private func postJSON(path: String, payload: [String: Any]) async throws -> [String: Any] {
        var request = URLRequest(url: apiBaseURL.appendingPathComponent(path))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue(apiKey, forHTTPHeaderField: "X-API-Key")
        request.httpBody = try JSONSerialization.data(withJSONObject: payload)

        let (data, response) = try await session.data(for: request)
        guard let httpResponse = response as? HTTPURLResponse, 200..<300 ~= httpResponse.statusCode else {
            throw NSError(domain: "NeuraTalkCommunication", code: 1, userInfo: [NSLocalizedDescriptionKey: "Request failed"])
        }

        return (try JSONSerialization.jsonObject(with: data) as? [String: Any]) ?? [:]
    }
}
