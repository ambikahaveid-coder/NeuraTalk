import Foundation

/// Raised for any non-2xx NeuraTalk API response. `body` is the parsed JSON
/// error payload (or nil if the body wasn't valid JSON) — its shape varies
/// by module (there is no single error envelope across the API: auth
/// returns {message}/{success, message}, calls/transcripts return {error}).
/// Check defensively rather than assuming one shape.
public struct NeuraTalkApiError: Error, LocalizedError {
    public let status: Int
    public let body: [String: Any]?

    public init(status: Int, body: [String: Any]?) {
        self.status = status
        self.body = body
    }

    public var errorDescription: String? {
        if let message = body?["message"] as? String { return message }
        if let error = body?["error"] as? String { return error }
        return "Request failed with status \(status)"
    }
}

public struct NeuraTalkNetworkError: Error, LocalizedError {
    public let cause: Error

    public init(cause: Error) {
        self.cause = cause
    }

    public var errorDescription: String? {
        "Network error while calling the NeuraTalk API: \(cause.localizedDescription)"
    }
}
