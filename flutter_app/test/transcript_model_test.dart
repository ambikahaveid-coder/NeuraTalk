import 'package:flutter_test/flutter_test.dart';
import 'package:neuratalk/models/transcript.dart';

void main() {
  group('TranscriptSearchPage', () {
    test('parses a page and computes hasMore correctly', () {
      final page = TranscriptSearchPage.fromJson({
        'results': [
          {'id': 1, 'callId': 10, 'originalText': 'hi', 'translatedText': 'hola'},
          {'id': 2, 'callId': 10, 'originalText': 'bye', 'translatedText': 'adios'},
        ],
        'total': 5,
        'limit': 2,
        'offset': 0,
      });

      expect(page.results, hasLength(2));
      expect(page.hasMore, isTrue);
    });

    test('hasMore is false once every result has been fetched', () {
      final page = TranscriptSearchPage.fromJson({
        'results': [
          {'id': 1, 'originalText': 'hi', 'translatedText': 'hola'},
        ],
        'total': 1,
        'limit': 20,
        'offset': 0,
      });

      expect(page.hasMore, isFalse);
    });

    test('defaults missing fields instead of throwing', () {
      final page = TranscriptSearchPage.fromJson({});
      expect(page.results, isEmpty);
      expect(page.total, 0);
    });
  });

  group('TranscriptSegment', () {
    test('parses a full segment', () {
      final segment = TranscriptSegment.fromJson({
        'id': 1,
        'smartCallId': 'call_abc',
        'speakerIdentity': 'user_1',
        'originalText': 'hello',
        'originalLanguage': 'en',
        'translatedText': 'hola',
        'translatedLanguage': 'es',
      });

      expect(segment.speakerIdentity, 'user_1');
      expect(segment.originalText, 'hello');
      expect(segment.translatedText, 'hola');
    });
  });
}
