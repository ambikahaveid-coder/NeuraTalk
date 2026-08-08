import Foundation

private let retryableStatus: Set<Int> = [429, 500, 502, 503, 504]

/// Official NeuraTalk API client. Auth endpoints (`register`/`login`/
/// `requestOtp`/`verifyOtp`) don't require a token; everything else does —
/// pass one via the initializer or `withToken(_:)`.
public final class NeuraTalkClient {
    private let token: String?
    private let baseUrl: String
    private let maxRetries: Int
    private let retryBaseDelay: TimeInterval
    private let session: URLSession

    public init(
        token: String? = nil,
        baseUrl: String = "https://neuratalk.in",
        maxRetries: Int = 3,
        retryBaseDelay: TimeInterval = 0.3,
        session: URLSession = .shared
    ) {
        self.token = token
        self.baseUrl = baseUrl.hasSuffix("/") ? String(baseUrl.dropLast()) : baseUrl
        self.maxRetries = maxRetries
        self.retryBaseDelay = retryBaseDelay
        self.session = session
    }

    /// Returns a new client bound to the given session token, leaving this one unmodified.
    public func withToken(_ token: String) -> NeuraTalkClient {
        NeuraTalkClient(token: token, baseUrl: baseUrl, maxRetries: maxRetries, retryBaseDelay: retryBaseDelay, session: session)
    }

    // MARK: - Auth

    public func register(username: String, password: String, extra: [String: Any] = [:]) async throws -> [String: Any] {
        var body = extra
        body["username"] = username
        body["password"] = password
        return try await request("POST", "/api/auth/register", body: body, auth: false)
    }

    public func login(username: String, password: String) async throws -> [String: Any] {
        try await request("POST", "/api/auth/login", body: ["username": username, "password": password], auth: false)
    }

    public func requestOtp(identifier: String, channel: String) async throws -> [String: Any] {
        try await request("POST", "/api/auth/otp/request", body: ["identifier": identifier, "channel": channel], auth: false)
    }

    public func verifyOtp(identifier: String, channel: String, code: String, firebaseToken: String? = nil) async throws -> [String: Any] {
        var body: [String: Any] = ["identifier": identifier, "channel": channel, "code": code]
        if let firebaseToken { body["firebaseToken"] = firebaseToken }
        return try await request("POST", "/api/auth/otp/verify", body: body, auth: false)
    }

    public func me() async throws -> [String: Any] {
        try await request("GET", "/api/auth/me")
    }

    public func logout() async throws {
        _ = try await request("POST", "/api/auth/logout")
    }

    // MARK: - Calls

    public func createCall(
        calleeIdentifier: String,
        callType: String,
        myLanguage: String = "auto",
        theirLanguage: String = "auto"
    ) async throws -> [String: Any] {
        try await request("POST", "/api/calls/create", body: [
            "calleeIdentifier": calleeIdentifier,
            "callType": callType,
            "myLanguage": myLanguage,
            "theirLanguage": theirLanguage,
        ])
    }

    public func createConferenceCall(participantIds: [String], hostLanguage: String = "auto", title: String? = nil) async throws -> [String: Any] {
        var body: [String: Any] = ["participantIds": participantIds, "hostLanguage": hostLanguage]
        if let title { body["title"] = title }
        return try await request("POST", "/api/calls/conference", body: body)
    }

    public func connectCall(callId: String, receiverNumber: String? = nil) async throws -> [String: Any] {
        var body: [String: Any] = [:]
        if let receiverNumber { body["receiverNumber"] = receiverNumber }
        return try await request("POST", "/api/calls/\(encode(callId))/connect", body: body)
    }

    public func endCall(callId: String) async throws -> [String: Any] {
        try await request("POST", "/api/calls/\(encode(callId))/end")
    }

    public func holdCall(callId: String) async throws -> [String: Any] {
        try await request("POST", "/api/calls/\(encode(callId))/hold")
    }

    public func resumeCall(callId: String) async throws -> [String: Any] {
        try await request("DELETE", "/api/calls/\(encode(callId))/hold")
    }

    public func rejectCall(callId: String) async throws -> [String: Any] {
        try await request("POST", "/api/calls/\(encode(callId))/reject")
    }

    public func getIncomingCall() async throws -> [String: Any]? {
        let res = try await request("GET", "/api/calls/incoming")
        return res["incoming"] as? [String: Any]
    }

    public func listCallHistory(limit: Int = 50) async throws -> [[String: Any]] {
        let res = try await request("GET", "/api/calls/history?limit=\(limit)")
        return res["calls"] as? [[String: Any]] ?? []
    }

    public func getCall(callId: String) async throws -> [String: Any] {
        try await request("GET", "/api/calls/\(encode(callId))")
    }

    // MARK: - Transcripts

    public func searchTranscripts(query: String, limit: Int? = nil, offset: Int? = nil) async throws -> [String: Any] {
        var items = [URLQueryItem(name: "q", value: query)]
        if let limit { items.append(URLQueryItem(name: "limit", value: String(limit))) }
        if let offset { items.append(URLQueryItem(name: "offset", value: String(offset))) }
        var components = URLComponents()
        components.queryItems = items
        // URLComponents percent-encodes "+" as a literal plus, which some
        // servers misread as a space in query strings — encode it explicitly.
        let query = (components.percentEncodedQuery ?? "").replacingOccurrences(of: "+", with: "%2B")
        return try await request("GET", "/api/transcripts/search?\(query)")
    }

    public func getTranscript(callId: String) async throws -> [[String: Any]] {
        let res = try await request("GET", "/api/transcripts/\(encode(callId))")
        return res["segments"] as? [[String: Any]] ?? []
    }

    public func deleteTranscript(callId: String) async throws -> [String: Any] {
        try await request("DELETE", "/api/transcripts/\(encode(callId))")
    }

    /// Returns the raw exported file bytes — write them to disk or stream them as-is.
    public func exportTranscript(callId: String, format: String) async throws -> Data {
        try await rawRequest("GET", "/api/transcripts/\(encode(callId))/export/\(format)").0
    }

    // MARK: - Internals

    private func encode(_ s: String) -> String {
        s.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? s
    }

    private func request(_ method: String, _ path: String, body: [String: Any]? = nil, auth: Bool = true) async throws -> [String: Any] {
        let (data, _) = try await rawRequest(method, path, body: body, auth: auth)
        guard !data.isEmpty else { return [:] }
        let parsed = try? JSONSerialization.jsonObject(with: data)
        return parsed as? [String: Any] ?? [:]
    }

    private func rawRequest(_ method: String, _ path: String, body: [String: Any]? = nil, auth: Bool = true) async throws -> (Data, HTTPURLResponse) {
        guard let url = URL(string: "\(baseUrl)\(path)") else {
            throw NeuraTalkApiError(status: 0, body: ["error": "Invalid URL: \(path)"])
        }

        var attempt = 0
        while true {
            attempt += 1
            var req = URLRequest(url: url)
            req.httpMethod = method
            if auth, let token { req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
            if let body {
                req.setValue("application/json", forHTTPHeaderField: "Content-Type")
                req.httpBody = try? JSONSerialization.data(withJSONObject: body)
            }

            let data: Data
            let response: URLResponse
            do {
                (data, response) = try await session.data(for: req)
            } catch {
                if attempt > maxRetries { throw NeuraTalkNetworkError(cause: error) }
                await backoff(attempt)
                continue
            }

            guard let http = response as? HTTPURLResponse else {
                throw NeuraTalkNetworkError(cause: URLError(.badServerResponse))
            }

            if !(200..<300).contains(http.statusCode) {
                if retryableStatus.contains(http.statusCode) && attempt <= maxRetries {
                    let retryAfter = http.value(forHTTPHeaderField: "Retry-After")
                    await backoff(attempt, retryAfterHeader: retryAfter)
                    continue
                }
                let errorBody = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
                throw NeuraTalkApiError(status: http.statusCode, body: errorBody)
            }
            return (data, http)
        }
    }

    private func backoff(_ attempt: Int, retryAfterHeader: String? = nil) async {
        let delay: TimeInterval
        if let retryAfterHeader, let seconds = Double(retryAfterHeader) {
            delay = seconds
        } else {
            delay = retryBaseDelay * pow(2, Double(attempt - 1))
        }
        try? await Task.sleep(nanoseconds: UInt64(delay * 1_000_000_000))
    }
}
