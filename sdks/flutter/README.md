# neuratalk_sdk

Official Dart/Flutter SDK for the NeuraTalk API. Pure Dart (uses `package:http`), so it works in Flutter apps, Dart CLI tools, and server-side Dart alike.

## Install

Add to `pubspec.yaml`:

```yaml
dependencies:
  neuratalk_sdk:
    path: ../path/to/sdks/flutter  # or a git/pub.dev reference once published
```

## Authenticate

```dart
import 'package:neuratalk_sdk/neuratalk_sdk.dart';

final client = NeuraTalkClient(); // unauthenticated, for login/OTP endpoints

// Password login
final result = await client.login('myusername', 'mypassword');

// Or OTP login (auto-registers new users)
await client.requestOtp('+919876543210', 'mobile');
final otpResult = await client.verifyOtp('+919876543210', 'mobile', '123456');

final authed = client.withToken(otpResult['token'] as String);
```

## Make a call

```dart
final session = await authed.createCall(
  calleeIdentifier: '+919876543210',
  callType: 'voice',
  myLanguage: 'en',
  theirLanguage: 'es',
);
// session['livekitUrl'] / session['livekitToken'] — hand these to livekit_client
```

## Search and export transcripts

```dart
final page = await authed.searchTranscripts('invoice', limit: 20);
for (final segment in page['results'] as List) {
  print('${segment['originalText']} -> ${segment['translatedText']}');
}

final pdfBytes = await authed.exportTranscript(session['callId'] as String, 'pdf');
```

## Verify a webhook

```dart
import 'package:neuratalk_sdk/neuratalk_sdk.dart';

final valid = verifyWebhookSignature(requestBodyBytes, request.headers['x-neuratalk-signature']!, webhookSecret);
if (!valid) {
  // reject
}
```

## Error handling

Every non-2xx response throws `NeuraTalkApiException` with `.status`, `.body`, and `.message`. Network failures throw `NeuraTalkNetworkException`.

## Retries

Network errors and `429`/`500`/`502`/`503`/`504` responses are retried automatically with exponential backoff (respecting a `retry-after` header when present). Configure via `maxRetries`/`retryBaseDelay` in the constructor.

## Versioning

There is currently no URL-based API versioning on the NeuraTalk server — this SDK is versioned at the package level instead.

## Development

```bash
dart pub get
dart analyze
dart test
```
