import 'package:flutter_test/flutter_test.dart';
import 'package:neuratalk/models/push_target.dart';

void main() {
  group('PushTarget.fromData', () {
    test('parses personal chat notification payloads', () {
      final target = PushTarget.fromData({
        'type': 'personal_chat_message',
        'threadId': '42',
      });

      expect(target?.type, PushTargetType.personalChat);
      expect(target?.id, 42);
    });

    test('parses group chat notification payloads', () {
      final target = PushTarget.fromData({
        'type': 'group_chat_message',
        'groupId': 17,
      });

      expect(target?.type, PushTargetType.groupChat);
      expect(target?.id, 17);
    });

    test('rejects unsupported or invalid destinations', () {
      expect(PushTarget.fromData({'type': 'incoming_call', 'callId': 'call_1'}),
          isNull);
      expect(
          PushTarget.fromData(
              {'type': 'personal_chat_message', 'threadId': 'abc'}),
          isNull);
      expect(
          PushTarget.fromData({'type': 'group_chat_message', 'groupId': '0'}),
          isNull);
    });
  });
}
