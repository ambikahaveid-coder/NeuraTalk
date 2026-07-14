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

  static dynamic _parse(http.Response res) {
    final data = jsonDecode(res.body);
    if (res.statusCode >= 400) {
      throw ApiException(data['message'] ?? 'Request failed', res.statusCode);
    }
    return data;
  }
}

class ApiException implements Exception {
  final String message;
  final int statusCode;
  ApiException(this.message, this.statusCode);

  @override
  String toString() => message;
}
