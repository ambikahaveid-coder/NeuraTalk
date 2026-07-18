import '../models/transcript.dart';
import 'api_service.dart';

class TranscriptService {
  static Future<List<TranscriptSegment>> getTranscript(String callId) async {
    final data = await ApiService.get('/api/transcripts/$callId') as Map<String, dynamic>;
    final segments = (data['segments'] as List? ?? []);
    return segments.map((s) => TranscriptSegment.fromJson(s as Map<String, dynamic>)).toList();
  }

  static Future<TranscriptSearchPage> search(String query, {int limit = 20, int offset = 0}) async {
    final q = Uri.encodeQueryComponent(query);
    final data = await ApiService.get('/api/transcripts/search?q=$q&limit=$limit&offset=$offset') as Map<String, dynamic>;
    return TranscriptSearchPage.fromJson(data);
  }

  static Future<List<int>> exportBytes(String callId, String format) {
    return ApiService.getBytes('/api/transcripts/$callId/export/$format');
  }

  static Future<int> delete(String callId) async {
    final data = await ApiService.delete('/api/transcripts/$callId');
    return data['deletedCount'] as int? ?? 0;
  }
}
