class TranscriptSegment {
  final int id;
  final String? smartCallId;
  final int? callId;
  final String? speakerIdentity;
  final String? targetIdentity;
  final String originalText;
  final String? originalLanguage;
  final String translatedText;
  final String? translatedLanguage;
  final String? createdAt;

  TranscriptSegment({
    required this.id,
    this.smartCallId,
    this.callId,
    this.speakerIdentity,
    this.targetIdentity,
    required this.originalText,
    this.originalLanguage,
    required this.translatedText,
    this.translatedLanguage,
    this.createdAt,
  });

  factory TranscriptSegment.fromJson(Map<String, dynamic> json) {
    return TranscriptSegment(
      id: json['id'] as int,
      smartCallId: json['smartCallId'] as String?,
      callId: json['callId'] as int?,
      speakerIdentity: json['speakerIdentity'] as String?,
      targetIdentity: json['targetIdentity'] as String?,
      originalText: json['originalText'] as String? ?? '',
      originalLanguage: json['originalLanguage'] as String?,
      translatedText: json['translatedText'] as String? ?? '',
      translatedLanguage: json['translatedLanguage'] as String?,
      createdAt: json['createdAt'] as String?,
    );
  }
}

class TranscriptSearchResult {
  final int id;
  final int? callId;
  final String originalText;
  final String translatedText;
  final String? createdAt;

  TranscriptSearchResult({
    required this.id,
    this.callId,
    required this.originalText,
    required this.translatedText,
    this.createdAt,
  });

  factory TranscriptSearchResult.fromJson(Map<String, dynamic> json) {
    return TranscriptSearchResult(
      id: json['id'] as int,
      callId: json['callId'] as int?,
      originalText: json['originalText'] as String? ?? '',
      translatedText: json['translatedText'] as String? ?? '',
      createdAt: json['createdAt'] as String?,
    );
  }
}

class TranscriptSearchPage {
  final List<TranscriptSearchResult> results;
  final int total;
  final int limit;
  final int offset;

  TranscriptSearchPage({
    required this.results,
    required this.total,
    required this.limit,
    required this.offset,
  });

  bool get hasMore => offset + results.length < total;

  factory TranscriptSearchPage.fromJson(Map<String, dynamic> json) {
    final rawResults = (json['results'] as List? ?? []);
    return TranscriptSearchPage(
      results: rawResults.map((r) => TranscriptSearchResult.fromJson(r as Map<String, dynamic>)).toList(),
      total: json['total'] as int? ?? 0,
      limit: json['limit'] as int? ?? 50,
      offset: json['offset'] as int? ?? 0,
    );
  }
}
