import 'dart:convert';
import 'package:flutter_test/flutter_test.dart';
import 'package:neuratalk/services/e2e_crypto.dart';

void main() {
  test('round trip: both phones read it; the server-side copy is unreadable', () async {
    final ravi = E2eCrypto(store: MemoryKeyStore());
    final sarah = E2eCrypto(store: MemoryKeyStore());
    final msg = await ravi.encrypt('మా ఇంటి తాళం కోడ్ 4417', {'1': await ravi.publicKey(), '2': await sarah.publicKey()});
    expect(jsonEncode(msg).contains('4417'), isFalse);
    expect(await sarah.decrypt(msg, '2'), 'మా ఇంటి తాళం కోడ్ 4417');
    expect(await ravi.decrypt(msg, '1'), 'మా ఇంటి తాళం కోడ్ 4417');
  });

  test('a third phone, or a message sealed for an old phone, cannot read it', () async {
    final a = E2eCrypto(store: MemoryKeyStore());
    final b = E2eCrypto(store: MemoryKeyStore());
    final eve = E2eCrypto(store: MemoryKeyStore());
    final msg = await a.encrypt('secret', {'1': await a.publicKey(), '2': await b.publicKey()});
    expect(() => eve.decrypt(msg, '3'), throwsA(isA<E2eNotForThisPhone>()));
    // Eve pretends to be phone 2: the sealed key doesn't open with her key.
    await expectLater(eve.decrypt(msg, '2'), throwsA(anything));
  });

  test('a changed ciphertext is rejected', () async {
    final a = E2eCrypto(store: MemoryKeyStore());
    final msg = await a.encrypt('pay 100', {'1': await a.publicKey()});
    final bytes = base64Decode(msg['ciphertext'] as String);
    bytes[0] ^= 1;
    await expectLater(a.decrypt({...msg, 'ciphertext': base64Encode(bytes)}, '1'), throwsA(anything));
  });

  test('the key survives restarts (same stored key, same public key)', () async {
    final store = MemoryKeyStore();
    final first = await E2eCrypto(store: store).publicKey();
    expect(await E2eCrypto(store: store).publicKey(), first);
  });

  test('opens a message sealed by the server-side test code (Node crypto): same format on both sides', () async {
    final store = MemoryKeyStore()..value = 'AQIDBAUGBwgJCgsMDQ4PEBESExQVFhcYGRobHB0eHyA=';
    final phone = E2eCrypto(store: store);
    expect(await phone.publicKey(), 'B6N8vBQgk8i3VdwbEOhstCY3StFqqFPtC9/AsrhtHHw=');
    final fromNode = {
      'ciphertext': '/Kd7EQqmDhdaagoMmYoI0/zbCn82Rj7Ce+Cv4SefWh3iqSki9fpcNlFnKbPMkPmDylSzCkSqXTYfIFbbDwpfw2MBakcj0d4=',
      'nonce': 'xqOeCyhUirkUgfsx',
      'keys': {
        '7': {
          'ephemeralPublicKey': 'vcGKJ92E5ayUXtLvet7FkzN9FUzt7XUgR+Th32ugRCs=',
          'nonce': 'm0033RvNF4F2Rvsq',
          'wrapped': 'kki8BgLoUVYA0ecpvYAJCxkLIfAg6PcOWXiIhqAiKeTjSShr0Dxav+/EFtZmqCCs',
        },
      },
    };
    final body = jsonDecode(await phone.decrypt(fromNode, '7')) as Map;
    expect(body['body'], 'నమస్తే from Node 🔒');
  });
}
