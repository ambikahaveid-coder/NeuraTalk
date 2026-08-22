import 'dart:async';
import 'dart:convert';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

class ApiService {
  static const String baseUrl = 'https://neuratalk.in';
  static const String _secureTokenKey = 'auth_token';
  // Legacy plaintext key the token used to be stored under. Only ever read
  // once, during the one-time migration in init() — never written to again.
  static const String _legacyPrefsTokenKey = 'auth_token';

  // No AndroidOptions override needed — the current package version
  // auto-migrates to its own secure cipher storage on first access.
  static const _secureStorage = FlutterSecureStorage();

  static String? _token;

  static Future<void> init() async {
    _token = await _secureStorage.read(key: _secureTokenKey);
    if (_token != null) return;

    // One-time migration: earlier app versions stored the token in plain
    // SharedPreferences. Move it into secure storage and remove the
    // plaintext copy so it isn't left behind on-device.
    final prefs = await SharedPreferences.getInstance();
    final legacyToken = prefs.getString(_legacyPrefsTokenKey);
    if (legacyToken != null) {
      await _secureStorage.write(key: _secureTokenKey, value: legacyToken);
      await prefs.remove(_legacyPrefsTokenKey);
      _token = legacyToken;
    }
  }

  static Future<void> saveToken(String token) async {
    _token = token;
    await _secureStorage.write(key: _secureTokenKey, value: token);
  }

  static Future<void> clearToken() async {
    _token = null;
    await _secureStorage.delete(key: _secureTokenKey);
    // Defensive: also clear the legacy plaintext key in case this runs
    // before init() ever completed its migration (e.g. a crash-recovery
    // logout path), so no stale plaintext token can ever be left behind.
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove(_legacyPrefsTokenKey);
  }

  static String? get token => _token;
  static bool get isLoggedIn => _token != null;

  static Map<String, String> get _headers => {
    'Content-Type': 'application/json',
    if (_token != null) 'Authorization': 'Bearer $_token',
  };

  static Future<Map<String, dynamic>> post(String path, Map<String, dynamic> body) async {
    final res = await http.post(
      Uri.parse('$baseUrl$path'),
      headers: _headers,
      body: jsonEncode(body),
    ).timeout(const Duration(seconds: 15));
    return _parse(res);
  }

  static Future<dynamic> get(String path) async {
    final res = await http.get(
      Uri.parse('$baseUrl$path'),
      headers: _headers,
    ).timeout(const Duration(seconds: 15));
    return _parse(res);
  }

  static Future<Map<String, dynamic>> patch(String path, Map<String, dynamic> body) async {
    final res = await http.patch(
      Uri.parse('$baseUrl$path'),
      headers: _headers,
      body: jsonEncode(body),
    ).timeout(const Duration(seconds: 15));
    return _parse(res);
  }

  static Future<Map<String, dynamic>> delete(String path) async {
    final res = await http.delete(
      Uri.parse('$baseUrl$path'),
      headers: _headers,
    ).timeout(const Duration(seconds: 15));
    return _parse(res);
  }

  /// For endpoints that return a binary body (e.g. transcript exports)
  /// rather than JSON — [get]/[_parse] always `jsonDecode`s, which would
  /// throw on a PDF/DOCX payload.
  static Future<List<int>> getBytes(String path) async {
    final res = await http.get(
      Uri.parse('$baseUrl$path'),
      headers: _headers,
    ).timeout(const Duration(minutes: 5));
    if (res.statusCode >= 400) {
      String message = 'Request failed';
      try {
        final data = jsonDecode(res.body);
        message = (data is Map ? (data['message'] ?? data['error']) : null) ?? message;
      } catch (_) {}
      throw ApiException(message, res.statusCode);
    }
    return res.bodyBytes;
  }

  /// Uploads raw bytes directly to a presigned object-storage URL (not
  /// through baseUrl — the URL is already absolute and pre-authenticated).
  static Future<void> putBytes(String uploadUrl, List<int> bytes, String contentType) async {
    final res = await http.put(
      Uri.parse(uploadUrl),
      headers: {'Content-Type': contentType},
      body: bytes,
    ).timeout(const Duration(seconds: 30));
    if (res.statusCode >= 400) {
      throw ApiException('Upload failed', res.statusCode);
    }
  }

  /// Same upload, but streamed in chunks with a real progress callback and
  /// cooperative cancellation -- the plain putBytes above sends the whole
  /// body in one shot with no visibility into how much has actually gone
  /// out, which is fine for a small image but not for a real "upload
  /// progress" bar on a multi-MB file, and has no way to cancel mid-flight.
  /// The 30s flat timeout on putBytes is also unrealistic for large files on
  /// slow connections, so this uses a much longer cap instead.
  static Future<void> putBytesWithProgress(
    String uploadUrl,
    List<int> bytes,
    String contentType, {
    void Function(double progress)? onProgress,
    UploadCancelToken? cancelToken,
  }) async {
    final client = http.Client();
    try {
      final request = http.StreamedRequest('PUT', Uri.parse(uploadUrl));
      request.headers['Content-Type'] = contentType;
      request.contentLength = bytes.length;

      const chunkSize = 64 * 1024;
      unawaited(() async {
        for (var i = 0; i < bytes.length; i += chunkSize) {
          if (cancelToken?.cancelled == true) break;
          final end = (i + chunkSize < bytes.length) ? i + chunkSize : bytes.length;
          request.sink.add(bytes.sublist(i, end));
          onProgress?.call(end / bytes.length);
          // Yield so the progress callback's setState actually gets a frame
          // instead of the whole loop running synchronously to completion.
          await Future.delayed(Duration.zero);
        }
        await request.sink.close();
      }());

      if (cancelToken?.cancelled == true) {
        throw ApiException('Upload cancelled', 0);
      }

      final streamedResponse = await client.send(request).timeout(const Duration(minutes: 10));
      if (cancelToken?.cancelled == true) {
        throw ApiException('Upload cancelled', 0);
      }
      final res = await http.Response.fromStream(streamedResponse);
      if (res.statusCode >= 400) {
        throw ApiException('Upload failed', res.statusCode);
      }
    } finally {
      client.close();
    }
  }

  static dynamic _parse(http.Response res) {
    final data = jsonDecode(res.body);
    if (res.statusCode >= 400) {
      final message = (data is Map ? (data['message'] ?? data['error']) : null) ?? 'Request failed';
      final code = data is Map ? data['code'] as String? : null;
      throw ApiException(message, res.statusCode, code: code);
    }
    return data;
  }
}

/// Structured API error. Callers that need to branch on failure type should
/// check [statusCode]/[code] directly — never string-match [toString]/
/// [message], since the backend's machine-readable `code` field (e.g.
/// "LIVEKIT_UNAVAILABLE") is a separate JSON field from the human-readable
/// `message`, and the two are not guaranteed to contain the same text.
/// Cooperative cancellation for putBytesWithProgress -- set [cancelled] to
/// stop an in-flight upload; there's no lower-level abort on http's
/// StreamedRequest, so this is checked between chunks instead.
class UploadCancelToken {
  bool cancelled = false;
  void cancel() => cancelled = true;
}

class ApiException implements Exception {
  final String message;
  final int statusCode;
  final String? code;
  ApiException(this.message, this.statusCode, {this.code});

  @override
  String toString() => message;
}
