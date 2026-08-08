import 'dart:convert';
import 'package:http/http.dart' as http;
import 'errors.dart';

const _retryableStatus = {429, 500, 502, 503, 504};

/// Official NeuraTalk API client. Auth endpoints (`register`/`login`/
/// `requestOtp`/`verifyOtp`) don't require a token; everything else does —
/// pass one via the constructor or [withToken].
class NeuraTalkClient {
  final String? token;
  final String baseUrl;
  final int maxRetries;
  final Duration retryBaseDelay;
  final http.Client _http;

  NeuraTalkClient({
    this.token,
    this.baseUrl = 'https://neuratalk.in',
    this.maxRetries = 3,
    this.retryBaseDelay = const Duration(milliseconds: 300),
    http.Client? httpClient,
  }) : _http = httpClient ?? http.Client();

  /// Returns a new client bound to the given session token, leaving this one unmodified.
  NeuraTalkClient withToken(String token) => NeuraTalkClient(
        token: token,
        baseUrl: baseUrl,
        maxRetries: maxRetries,
        retryBaseDelay: retryBaseDelay,
        httpClient: _http,
      );

  // ---- Auth ----

  Future<Map<String, dynamic>> register({required String username, required String password, Map<String, dynamic>? extra}) {
    return _request('POST', '/api/auth/register', body: {'username': username, 'password': password, ...?extra}, auth: false);
  }

  Future<Map<String, dynamic>> login(String username, String password) {
    return _request('POST', '/api/auth/login', body: {'username': username, 'password': password}, auth: false);
  }

  Future<Map<String, dynamic>> requestOtp(String identifier, String channel) {
    return _request('POST', '/api/auth/otp/request', body: {'identifier': identifier, 'channel': channel}, auth: false);
  }

  Future<Map<String, dynamic>> verifyOtp(String identifier, String channel, String code, {String? firebaseToken}) {
    return _request('POST', '/api/auth/otp/verify', body: {
      'identifier': identifier,
      'channel': channel,
      'code': code,
      if (firebaseToken != null) 'firebaseToken': firebaseToken,
    }, auth: false);
  }

  Future<Map<String, dynamic>> me() => _request('GET', '/api/auth/me');

  Future<void> logout() async {
    await _request('POST', '/api/auth/logout');
  }

  // ---- Calls ----

  Future<Map<String, dynamic>> createCall({
    required String calleeIdentifier,
    required String callType,
    String myLanguage = 'auto',
    String theirLanguage = 'auto',
    Map<String, dynamic>? extra,
  }) {
    return _request('POST', '/api/calls/create', body: {
      'calleeIdentifier': calleeIdentifier,
      'callType': callType,
      'myLanguage': myLanguage,
      'theirLanguage': theirLanguage,
      ...?extra,
    });
  }

  Future<Map<String, dynamic>> createConferenceCall({
    required List<String> participantIds,
    String hostLanguage = 'auto',
    String? title,
  }) {
    return _request('POST', '/api/calls/conference', body: {
      'participantIds': participantIds,
      'hostLanguage': hostLanguage,
      if (title != null) 'title': title,
    });
  }

  Future<Map<String, dynamic>> connectCall(String callId, {String? receiverNumber}) {
    return _request('POST', '/api/calls/$callId/connect', body: {'receiverNumber': receiverNumber});
  }

  Future<Map<String, dynamic>> endCall(String callId) => _request('POST', '/api/calls/$callId/end');

  Future<Map<String, dynamic>> holdCall(String callId) => _request('POST', '/api/calls/$callId/hold');

  Future<Map<String, dynamic>> resumeCall(String callId) => _request('DELETE', '/api/calls/$callId/hold');

  Future<Map<String, dynamic>> rejectCall(String callId) => _request('POST', '/api/calls/$callId/reject');

  Future<Map<String, dynamic>?> getIncomingCall() async {
    final res = await _request('GET', '/api/calls/incoming');
    return res['incoming'] as Map<String, dynamic>?;
  }

  Future<List<dynamic>> listCallHistory({int limit = 50}) async {
    final res = await _request('GET', '/api/calls/history?limit=$limit');
    return res['calls'] as List<dynamic>? ?? [];
  }

  Future<Map<String, dynamic>> getCall(String callId) => _request('GET', '/api/calls/$callId');

  // ---- Transcripts ----

  Future<Map<String, dynamic>> searchTranscripts(String query, {int? limit, int? offset}) {
    final params = {
      'q': query,
      if (limit != null) 'limit': '$limit',
      if (offset != null) 'offset': '$offset',
    };
    final qs = Uri(queryParameters: params).query;
    return _request('GET', '/api/transcripts/search?$qs');
  }

  Future<List<dynamic>> getTranscript(String callId) async {
    final res = await _request('GET', '/api/transcripts/$callId');
    return res['segments'] as List<dynamic>? ?? [];
  }

  Future<Map<String, dynamic>> deleteTranscript(String callId) => _request('DELETE', '/api/transcripts/$callId');

  /// Returns the raw exported file bytes — write them to disk or stream them as-is.
  Future<List<int>> exportTranscript(String callId, String format) async {
    final res = await _rawRequest('GET', '/api/transcripts/$callId/export/$format');
    return res.bodyBytes;
  }

  // ---- Internals ----

  Future<Map<String, dynamic>> _request(String method, String path, {Map<String, dynamic>? body, bool auth = true}) async {
    final res = await _rawRequest(method, path, body: body, auth: auth);
    if (res.body.isEmpty) return {};
    final decoded = jsonDecode(res.body);
    return decoded is Map<String, dynamic> ? decoded : {'value': decoded};
  }

  Future<http.Response> _rawRequest(String method, String path, {Map<String, dynamic>? body, bool auth = true}) async {
    final url = Uri.parse('$baseUrl$path');
    final headers = <String, String>{
      if (body != null) 'Content-Type': 'application/json',
      if (auth && token != null) 'Authorization': 'Bearer $token',
    };
    final encodedBody = body != null ? jsonEncode(body) : null;

    var attempt = 0;
    while (true) {
      attempt++;
      http.Response res;
      try {
        res = await _http.request(method, url, headers: headers, body: encodedBody);
      } catch (cause) {
        if (attempt > maxRetries) throw NeuraTalkNetworkException(cause);
        await _backoff(attempt);
        continue;
      }

      if (res.statusCode < 200 || res.statusCode >= 300) {
        if (_retryableStatus.contains(res.statusCode) && attempt <= maxRetries) {
          await _backoff(attempt, res.headers['retry-after']);
          continue;
        }
        dynamic errorBody;
        try {
          errorBody = res.body.isNotEmpty ? jsonDecode(res.body) : null;
        } catch (_) {
          errorBody = null;
        }
        throw NeuraTalkApiException(res.statusCode, errorBody);
      }
      return res;
    }
  }

  Future<void> _backoff(int attempt, [String? retryAfterHeader]) async {
    Duration delay;
    final retryAfterSeconds = retryAfterHeader != null ? num.tryParse(retryAfterHeader) : null;
    if (retryAfterSeconds != null) {
      delay = Duration(milliseconds: (retryAfterSeconds * 1000).round());
    } else {
      delay = retryBaseDelay * (1 << (attempt - 1));
    }
    await Future.delayed(delay);
  }

  void close() => _http.close();
}

extension on http.Client {
  Future<http.Response> request(String method, Uri url, {Map<String, String>? headers, String? body}) {
    switch (method) {
      case 'GET':
        return get(url, headers: headers);
      case 'POST':
        return post(url, headers: headers, body: body);
      case 'DELETE':
        return delete(url, headers: headers, body: body);
      case 'PATCH':
        return patch(url, headers: headers, body: body);
      default:
        throw ArgumentError('Unsupported method: $method');
    }
  }
}
