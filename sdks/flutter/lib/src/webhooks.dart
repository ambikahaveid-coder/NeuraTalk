import 'dart:convert';
import 'package:crypto/crypto.dart';

/// Verifies a NeuraTalk-style webhook signature: HMAC-SHA256 over the raw
/// request body, hex-encoded, compared in constant time. Mirrors the signing
/// scheme NeuraTalk's own backend uses for its Razorpay and MSG91 webhook
/// receivers (server/payment-service.ts, server/modules/calls/controller.ts).
/// There is no dedicated public "register a webhook" API yet — this helper
/// is what you use inside your own webhook endpoint to verify payloads
/// NeuraTalk sends you.
///
/// [rawBody] must be the exact, unparsed request body — signing breaks if
/// you verify against a re-serialized copy of the parsed body.
/// [signature] is the signature header value; a leading "sha256=" prefix (as
/// MSG91's webhook sends) is stripped automatically.
bool verifyWebhookSignature(List<int> rawBody, String signature, String secret) {
  final expected = Hmac(sha256, utf8.encode(secret)).convert(rawBody).toString();
  final provided = signature.startsWith('sha256=') ? signature.substring('sha256='.length) : signature;
  return _constantTimeEquals(expected, provided);
}

bool _constantTimeEquals(String a, String b) {
  if (a.length != b.length) return false;
  var result = 0;
  for (var i = 0; i < a.length; i++) {
    result |= a.codeUnitAt(i) ^ b.codeUnitAt(i);
  }
  return result == 0;
}
