import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:neuratalk/services/api_service.dart';

// Verifies the P1 fix: auth tokens move from plaintext SharedPreferences to
// flutter_secure_storage, with a one-time migration for anyone upgrading
// from an older app version that still has the old plaintext value.
void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  const secureChannel = MethodChannel('plugins.it_nomads.com/flutter_secure_storage');
  final Map<String, String> fakeSecureStore = {};

  setUp(() {
    fakeSecureStore.clear();
    SharedPreferences.setMockInitialValues({});

    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(secureChannel, (MethodCall call) async {
      switch (call.method) {
        case 'read':
          final key = (call.arguments as Map)['key'] as String;
          return fakeSecureStore[key];
        case 'write':
          final args = call.arguments as Map;
          fakeSecureStore[args['key'] as String] = args['value'] as String;
          return null;
        case 'delete':
          final key = (call.arguments as Map)['key'] as String;
          fakeSecureStore.remove(key);
          return null;
        case 'readAll':
          return fakeSecureStore;
        case 'deleteAll':
          fakeSecureStore.clear();
          return null;
        case 'containsKey':
          final key = (call.arguments as Map)['key'] as String;
          return fakeSecureStore.containsKey(key);
        default:
          return null;
      }
    });
  });

  tearDown(() {
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(secureChannel, null);
  });

  test('a fresh install with no stored token starts logged out', () async {
    await ApiService.init();
    expect(ApiService.isLoggedIn, isFalse);
    expect(ApiService.token, isNull);
  });

  test('saveToken writes to secure storage, not plaintext SharedPreferences', () async {
    await ApiService.init();
    await ApiService.saveToken('secret-token-123');

    expect(ApiService.token, 'secret-token-123');
    expect(fakeSecureStore['auth_token'], 'secret-token-123');

    final prefs = await SharedPreferences.getInstance();
    expect(prefs.getString('auth_token'), isNull, reason: 'token must never be written to plaintext SharedPreferences');
  });

  test('migrates a legacy plaintext token into secure storage on init, then erases the plaintext copy', () async {
    // Simulate a user upgrading from an older app version that stored the
    // token in plain SharedPreferences.
    SharedPreferences.setMockInitialValues({'auth_token': 'legacy-plaintext-token'});

    await ApiService.init();

    expect(ApiService.token, 'legacy-plaintext-token', reason: 'legacy token should still be picked up on this launch');
    expect(fakeSecureStore['auth_token'], 'legacy-plaintext-token', reason: 'legacy token should be migrated into secure storage');

    final prefs = await SharedPreferences.getInstance();
    expect(prefs.getString('auth_token'), isNull, reason: 'plaintext copy must be erased once migrated');
  });

  test('logout clears the token from both secure storage and any leftover plaintext value', () async {
    SharedPreferences.setMockInitialValues({'auth_token': 'legacy-plaintext-token'});
    await ApiService.init(); // migrates
    await ApiService.saveToken('fresh-token');

    await ApiService.clearToken();

    expect(ApiService.isLoggedIn, isFalse);
    expect(fakeSecureStore.containsKey('auth_token'), isFalse);
    final prefs = await SharedPreferences.getInstance();
    expect(prefs.getString('auth_token'), isNull);
  });

  test('token refresh (re-login) overwrites the previously stored token', () async {
    await ApiService.init();
    await ApiService.saveToken('old-token');
    expect(ApiService.token, 'old-token');

    await ApiService.saveToken('refreshed-token');

    expect(ApiService.token, 'refreshed-token');
    expect(fakeSecureStore['auth_token'], 'refreshed-token');
  });
}
