# NeuraTalkSDK (Swift)

Official Swift SDK for the NeuraTalk API. Pure Foundation + CryptoKit, no third-party dependencies. Uses `async`/`await`.

> **Build verification status**: this package was written and carefully self-reviewed (including fixing a real `JSONSerialization`/optional-boxing bug found during review — see `NeuraTalkClient.connectCall`) but **could not be compiled with a real Swift toolchain in the environment this SDK was built in** (Windows, no Xcode/macOS, and the official Swift-for-Windows installer requires a Visual Studio Build Tools prerequisite that could not be safely verified or installed here). Treat this package as **not yet build-verified** until compiled with `swift build`/`swift test` on macOS, Linux, or Windows with a real Swift 5.9+ toolchain — unlike the other five SDKs in this repository, which were all genuinely compiled and tested.

## Install (Swift Package Manager)

```swift
dependencies: [
    .package(url: "https://github.com/neuratalk/neuratalk-swift.git", from: "1.0.0") // placeholder URL
]
```

## Authenticate

```swift
import NeuraTalkSDK

let client = NeuraTalkClient() // unauthenticated, for login/OTP endpoints

// Password login
let result = try await client.login(username: "myusername", password: "mypassword")

// Or OTP login (auto-registers new users)
try await client.requestOtp(identifier: "+919876543210", channel: "mobile")
let otpResult = try await client.verifyOtp(identifier: "+919876543210", channel: "mobile", code: "123456")

let authed = client.withToken(otpResult["token"] as! String)
```

## Make a call

```swift
let session = try await authed.createCall(
    calleeIdentifier: "+919876543210",
    callType: "voice",
    myLanguage: "en",
    theirLanguage: "es"
)
// session["livekitUrl"] / session["livekitToken"] — hand these to a LiveKit client SDK
```

## Search and export transcripts

```swift
let page = try await authed.searchTranscripts(query: "invoice", limit: 20)
if let results = page["results"] as? [[String: Any]] {
    for segment in results {
        print("\(segment["originalText"] ?? "") -> \(segment["translatedText"] ?? "")")
    }
}

let pdfData = try await authed.exportTranscript(callId: session["callId"] as! String, format: "pdf")
```

## Verify a webhook

```swift
import NeuraTalkSDK

let valid = verifyWebhookSignature(rawBody: requestBodyData, signature: signatureHeader, secret: webhookSecret)
if !valid {
    // reject
}
```

## Error handling

Every non-2xx response throws `NeuraTalkApiError` with `.status` and `.body` (the parsed `[String: Any]`, or nil if unparsable). Network failures throw `NeuraTalkNetworkError`.

## Retries

Network errors and `429`/`500`/`502`/`503`/`504` responses are retried automatically with exponential backoff (respecting a `Retry-After` header when present). Configure via `maxRetries`/`retryBaseDelay` in the initializer.

## Versioning

There is currently no URL-based API versioning on the NeuraTalk server — this SDK is versioned at the package level instead.

## Building from source

```bash
swift build
swift test
```

Requires Swift 5.9+, iOS 15+ / macOS 12+ (bounded by `URLSession.data(for:)` async support).
