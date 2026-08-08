import 'dart:convert';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:test/test.dart';
import 'package:neuratalk_sdk/neuratalk_sdk.dart';

void main() {
  group('NeuraTalkClient', () {
    test('sends the Bearer token and parses a successful response', () async {
      late http.Request captured;
      final mock = MockClient((req) async {
        captured = req;
        return http.Response(jsonEncode({'id': 1, 'username': 'x', 'role': 'consumer'}), 200);
      });
      final client = NeuraTalkClient(token: 'sess_test', httpClient: mock);

      final user = await client.me();

      expect(user['username'], 'x');
      expect(captured.headers['Authorization'], 'Bearer sess_test');
    });

    test('throws NeuraTalkApiException with parsed error body on 4xx', () async {
      final mock = MockClient((req) async => http.Response(jsonEncode({'error': 'bad request'}), 400));
      final client = NeuraTalkClient(httpClient: mock);

      expect(
        () => client.getCall('123'),
        throwsA(isA<NeuraTalkApiException>().having((e) => e.status, 'status', 400).having((e) => e.message, 'message', 'bad request')),
      );
    });

    test('retries once on 429 then succeeds', () async {
      var callCount = 0;
      final mock = MockClient((req) async {
        callCount++;
        if (callCount == 1) {
          return http.Response('', 429, headers: {'retry-after': '0'});
        }
        return http.Response('{}', 200);
      });
      final client = NeuraTalkClient(httpClient: mock, retryBaseDelay: const Duration(milliseconds: 1));

      await client.endCall('1');

      expect(callCount, 2);
    });
  });
}
