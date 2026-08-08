import 'dart:convert';
import 'package:crypto/crypto.dart';
import 'package:test/test.dart';
import 'package:neuratalk_sdk/neuratalk_sdk.dart';

void main() {
  group('verifyWebhookSignature', () {
    test('accepts a valid signature', () {
      const secret = 'topsecret';
      final body = utf8.encode('{"event":"call.completed"}');
      final sig = Hmac(sha256, utf8.encode(secret)).convert(body).toString();
      expect(verifyWebhookSignature(body, sig, secret), isTrue);
    });

    test('accepts a valid signature with sha256= prefix', () {
      const secret = 'topsecret';
      final body = utf8.encode('{"event":"call.completed"}');
      final sig = Hmac(sha256, utf8.encode(secret)).convert(body).toString();
      expect(verifyWebhookSignature(body, 'sha256=$sig', secret), isTrue);
    });

    test('rejects an invalid signature', () {
      final body = utf8.encode('body');
      expect(verifyWebhookSignature(body, 'deadbeef' * 8, 'secret'), isFalse);
    });

    test('rejects a tampered body', () {
      const secret = 'topsecret';
      final sig = Hmac(sha256, utf8.encode(secret)).convert(utf8.encode('original')).toString();
      expect(verifyWebhookSignature(utf8.encode('tampered'), sig, secret), isFalse);
    });
  });
}
