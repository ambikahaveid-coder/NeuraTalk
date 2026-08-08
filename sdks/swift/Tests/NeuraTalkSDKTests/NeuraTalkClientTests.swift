import XCTest
@testable import NeuraTalkSDK

/// Minimal URLProtocol stub — the standard XCTest pattern for testing
/// URLSession-based code without a real network dependency.
final class StubURLProtocol: URLProtocol {
    static var handler: ((URLRequest) -> (Int, [String: String], Data))?

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        guard let handler = StubURLProtocol.handler else {
            XCTFail("No stub handler set")
            return
        }
        let (status, headers, data) = handler(request)
        let response = HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: "HTTP/1.1", headerFields: headers)!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: data)
        client?.urlProtocolDidFinishLoading(self)
    }

    override func stopLoading() {}
}

final class NeuraTalkClientTests: XCTestCase {
    private func makeSession() -> URLSession {
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [StubURLProtocol.self]
        return URLSession(configuration: config)
    }

    func testSendsBearerTokenAndParsesSuccessfulResponse() async throws {
        var capturedAuthHeader: String?
        StubURLProtocol.handler = { request in
            capturedAuthHeader = request.value(forHTTPHeaderField: "Authorization")
            let body = "{\"id\":1,\"username\":\"x\",\"role\":\"consumer\"}".data(using: .utf8)!
            return (200, [:], body)
        }

        let client = NeuraTalkClient(token: "sess_test", session: makeSession())
        let user = try await client.me()

        XCTAssertEqual(user["username"] as? String, "x")
        XCTAssertEqual(capturedAuthHeader, "Bearer sess_test")
    }

    func testThrowsApiErrorWithParsedBodyOn4xx() async throws {
        StubURLProtocol.handler = { _ in
            let body = "{\"error\":\"bad request\"}".data(using: .utf8)!
            return (400, [:], body)
        }

        let client = NeuraTalkClient(session: makeSession())
        do {
            _ = try await client.getCall(callId: "123")
            XCTFail("Expected NeuraTalkApiError")
        } catch let error as NeuraTalkApiError {
            XCTAssertEqual(error.status, 400)
            XCTAssertEqual(error.errorDescription, "bad request")
        }
    }

    func testRetriesOnceOn429ThenSucceeds() async throws {
        var callCount = 0
        StubURLProtocol.handler = { _ in
            callCount += 1
            if callCount == 1 {
                return (429, ["Retry-After": "0"], Data())
            }
            return (200, [:], "{}".data(using: .utf8)!)
        }

        let client = NeuraTalkClient(retryBaseDelay: 0.01, session: makeSession())
        _ = try await client.endCall(callId: "1")

        XCTAssertEqual(callCount, 2)
    }
}
