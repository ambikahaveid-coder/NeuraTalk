// Sample app: OTP login, place a call, fetch and export the transcript.
// Run with: dart run example/basic_call.dart
// (requires NEURATALK_IDENTIFIER / NEURATALK_OTP env vars for a real run)
import 'dart:io';
import 'package:neuratalk_sdk/neuratalk_sdk.dart';

Future<void> main() async {
  final client = NeuraTalkClient(baseUrl: Platform.environment['NEURATALK_BASE_URL'] ?? 'https://neuratalk.in');

  final identifier = Platform.environment['NEURATALK_IDENTIFIER'];
  final otp = Platform.environment['NEURATALK_OTP'];
  if (identifier == null || otp == null) {
    print('Set NEURATALK_IDENTIFIER and NEURATALK_OTP to run this example against a real server.');
    return;
  }

  final result = await client.verifyOtp(identifier, 'mobile', otp);
  final authed = client.withToken(result['token'] as String);

  try {
    final session = await authed.createCall(
      calleeIdentifier: '+919876543210',
      callType: 'voice',
      myLanguage: 'en',
      theirLanguage: 'hi',
    );
    print('Call created: ${session['callId']}');

    final transcript = await authed.getTranscript(session['callId'] as String);
    print('Transcript has ${transcript.length} segments');

    final pdfBytes = await authed.exportTranscript(session['callId'] as String, 'pdf');
    print('Exported PDF: ${pdfBytes.length} bytes');
  } on NeuraTalkApiException catch (e) {
    print('API error ${e.status}: ${e.message}');
  } finally {
    authed.close();
  }
}
