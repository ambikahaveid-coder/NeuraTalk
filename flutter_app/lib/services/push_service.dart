import 'dart:async';
import 'dart:io';
import 'dart:math';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'api_service.dart';

/// FCM registration for real background/terminated push -- message and call
/// notifications shown by the OS while the app isn't in the foreground.
/// Registers against the existing server/modules/calls device endpoints
/// (POST /api/devices/register), which server/firebase-admin.ts already
/// sends real pushes through (sendVoIPPush for calls, sendPushNotification
/// for messages) -- only the client-side token registration was missing.
class PushService {
  static const _deviceIdKey = 'push_device_id';

  static Future<void> init() async {
    if (!ApiService.isLoggedIn) return;

    final settings = await FirebaseMessaging.instance.requestPermission(
      alert: true,
      badge: true,
      sound: true,
    );
    if (settings.authorizationStatus == AuthorizationStatus.denied) {
      return;
    }

    final token = await FirebaseMessaging.instance.getToken();
    if (token == null) return;
    await _register(token);

    FirebaseMessaging.instance.onTokenRefresh.listen((newToken) {
      unawaited(_register(newToken));
    });
  }

  static Future<void> _register(String pushToken) async {
    try {
      final deviceId = await _stableDeviceId();
      await ApiService.post('/api/devices/register', {
        'deviceId': deviceId,
        'platform': Platform.isIOS ? 'ios' : 'android',
        'pushToken': pushToken,
      });
    } catch (_) {
      // Best-effort -- a failed registration just means this device won't
      // get background pushes; the app remains fully usable in-foreground.
    }
  }

  static Future<String> _stableDeviceId() async {
    final prefs = await SharedPreferences.getInstance();
    final existing = prefs.getString(_deviceIdKey);
    if (existing != null) return existing;
    final generated = List.generate(24, (_) => Random.secure().nextInt(16).toRadixString(16)).join();
    await prefs.setString(_deviceIdKey, generated);
    return generated;
  }
}
