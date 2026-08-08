# neuratalk-sdk (Kotlin)

Official Kotlin/JVM SDK for the NeuraTalk API. Zero heavyweight dependencies — uses `java.net.http.HttpClient` (JDK 11+) and `org.json` (a single small library) for JSON.

## Install (Gradle)

```kotlin
dependencies {
    implementation("com.neuratalk:neuratalk-sdk:1.0.0")
}
```

## Authenticate

```kotlin
import com.neuratalk.sdk.NeuraTalkClient

val client = NeuraTalkClient() // unauthenticated, for login/OTP endpoints

// Password login
val result = client.login("myusername", "mypassword")

// Or OTP login (auto-registers new users)
client.requestOtp("+919876543210", "mobile")
val otpResult = client.verifyOtp("+919876543210", "mobile", "123456")

val authed = client.withToken(otpResult.getString("token"))
```

## Make a call

```kotlin
val session = authed.createCall(
    calleeIdentifier = "+919876543210",
    callType = "voice",
    myLanguage = "en",
    theirLanguage = "es",
)
// session.getString("livekitUrl") / session.getString("livekitToken")
```

## Search and export transcripts

```kotlin
val page = authed.searchTranscripts("invoice", limit = 20)
for (i in 0 until page.getJSONArray("results").length()) {
    val segment = page.getJSONArray("results").getJSONObject(i)
    println("${segment.getString("originalText")} -> ${segment.getString("translatedText")}")
}

val pdfBytes = authed.exportTranscript(session.getString("callId"), "pdf")
```

## Verify a webhook

```kotlin
import com.neuratalk.sdk.verifyWebhookSignature

val valid = verifyWebhookSignature(rawRequestBodyBytes, signatureHeader, webhookSecret)
if (!valid) {
    // reject
}
```

## Error handling

Every non-2xx response throws `NeuraTalkApiException` with `.status` and `.body` (the parsed `org.json.JSONObject`, or null if unparsable). Network failures throw `NeuraTalkNetworkException`.

## Retries

Network errors and `429`/`500`/`502`/`503`/`504` responses are retried automatically with exponential backoff (respecting a `Retry-After` header when present). Configure via `maxRetries`/`retryBaseDelayMs` in the constructor.

## Versioning

There is currently no URL-based API versioning on the NeuraTalk server — this SDK is versioned at the package level instead.

## Building from source

```bash
./gradlew build   # compiles, runs tests, produces build/libs/neuratalk-sdk-1.0.0.jar
```

Verified in this repository with Gradle 8.10 + Kotlin 2.0.21 + JDK 17: `BUILD SUCCESSFUL`, 7/7 tests passing.
