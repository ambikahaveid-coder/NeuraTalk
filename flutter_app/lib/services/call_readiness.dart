import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_callkit_incoming/flutter_callkit_incoming.dart';
import 'package:permission_handler/permission_handler.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../theme/app_theme.dart';

/// Calls must ring when the app is closed. On Android that needs three
/// things the person has to allow: notifications, the full-screen ringing
/// screen (Android 14+), and no battery restriction (phones like OnePlus,
/// Xiaomi, Vivo otherwise kill the app and the call never rings). Explained
/// once, in plain words, before the system dialogs appear.
class CallReadiness {
  static const _askedKey = 'call_readiness_asked_v1';

  /// Each check on its own: a phone where one of them throws must still get
  /// the question (that was why the prompt never appeared on a OnePlus).
  static Future<bool> _check(Future<bool> Function() check) async {
    try {
      return await check();
    } catch (_) {
      return false;
    }
  }

  static Future<bool> _ready() async {
    final notifications = await _check(() => Permission.notification.isGranted);
    final battery = await _check(() => Permission.ignoreBatteryOptimizations.isGranted);
    final fullScreen = await _check(() async => (await FlutterCallkitIncoming.canUseFullScreenIntent()) != false);
    return notifications && battery && fullScreen;
  }

  static Future<void> _step(Future<void> Function() action) async {
    try {
      await action();
    } catch (_) {
      // That screen isn't available on this phone; the other steps still run.
    }
  }

  static Future<void> ensure(BuildContext context, {bool force = false}) async {
    if (!Platform.isAndroid) return;
    final prefs = await SharedPreferences.getInstance();
    // Asked before but still not allowed (e.g. "Later"): ask again after a
    // week -- calls that never ring are worse than one more question.
    final askedAt = prefs.getInt('${_askedKey}_at') ?? 0;
    final recentlyAsked = DateTime.now().millisecondsSinceEpoch - askedAt < const Duration(days: 7).inMilliseconds;
    if (!force && prefs.getBool(_askedKey) == true && recentlyAsked) return;
    if (await _ready()) {
      await prefs.setBool(_askedKey, true);
      return;
    }
    if (!context.mounted) return;
    final go = await showDialog<bool>(
      context: context,
      barrierDismissible: false,
      builder: (dialogContext) => AlertDialog(
        backgroundColor: AppColors.surface,
        title: Text('Get calls even when NeuraTalk is closed', style: TextStyle(color: AppColors.ink)),
        content: Text(
          'So your phone rings for NeuraTalk calls like a normal call, please allow:\n\n'
          '• Notifications\n'
          '• Full-screen incoming calls (shows the call on the lock screen)\n'
          '• No battery restriction (otherwise your phone may stop NeuraTalk in the background and calls will not ring)',
          style: TextStyle(color: AppColors.textSecondary, height: 1.4),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(dialogContext, false), child: const Text('Later')),
          ElevatedButton(onPressed: () => Navigator.pop(dialogContext, true), child: const Text('Allow')),
        ],
      ),
    );
    await prefs.setBool(_askedKey, true);
    await prefs.setInt('${_askedKey}_at', DateTime.now().millisecondsSinceEpoch);
    if (go != true) return;
    await _step(() async { await Permission.notification.request(); });
    await _step(() async {
      if ((await FlutterCallkitIncoming.canUseFullScreenIntent()) == false) {
        await FlutterCallkitIncoming.requestFullIntentPermission();
      }
    });
    await _step(() async {
      if (!await Permission.ignoreBatteryOptimizations.isGranted) {
        await Permission.ignoreBatteryOptimizations.request();
      }
    });
  }
}
