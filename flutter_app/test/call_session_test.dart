import 'package:flutter_test/flutter_test.dart';
import 'package:neuratalk/models/call_session.dart';

void main() {
  group('CallSession.fromCreateResponse', () {
    test('parses a voice call response', () {
      final session = CallSession.fromCreateResponse(
        {'callId': 'call_abc', 'livekitUrl': 'wss://lk.example', 'livekitToken': 'tok'},
        callType: 'voice',
        remoteName: '+911234567890',
      );

      expect(session.callId, 'call_abc');
      expect(session.isVideo, isFalse);
      expect(session.isIncoming, isFalse);
      expect(session.hasLiveKitDetails, isTrue);
    });

    test('flags missing LiveKit details rather than crashing', () {
      final session = CallSession.fromCreateResponse(
        {'callId': 'call_abc'},
        callType: 'voice',
        remoteName: 'someone',
      );

      expect(session.hasLiveKitDetails, isFalse);
    });
  });

  group('CallSession.fromIncomingPayload', () {
    test('parses an incoming call with expiry', () {
      final expiresAtMs = DateTime.now().add(const Duration(seconds: 45)).millisecondsSinceEpoch;
      final session = CallSession.fromIncomingPayload({
        'callId': 'call_xyz',
        'livekitUrl': 'wss://lk.example',
        'livekitToken': 'tok',
        'callType': 'video',
        'callerName': 'Jane',
        'callerId': 'user_9',
        'expiresAt': expiresAtMs,
      });

      expect(session.isIncoming, isTrue);
      expect(session.isVideo, isTrue);
      expect(session.remoteName, 'Jane');
      expect(session.expiresAt, isNotNull);
    });

    test('falls back to callerId when callerName is absent', () {
      final session = CallSession.fromIncomingPayload({
        'callId': 'call_xyz',
        'callerId': 'user_9',
      });

      expect(session.remoteName, 'user_9');
      expect(session.callType, 'voice');
    });

    test('falls back to Unknown when neither callerName nor callerId is present', () {
      final session = CallSession.fromIncomingPayload({'callId': 'call_xyz'});
      expect(session.remoteName, 'Unknown');
    });
  });
}
