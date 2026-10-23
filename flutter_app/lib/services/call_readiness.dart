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

  static Future<bool> _ready() async {
    final notifications = await Permission.notification.isGranted;
    final battery = await Permission.ignoreBatteryOptimizations.isGranted;
    final fullScreen = (await FlutterCallkitIncoming.canUseFullScreenIntent()) != false;
    return notifications && battery && fullScreen;
  }

  static Future<void> ensure(BuildContext context, {bool force = false}) async {
    if (!Platform.isAndroid) return;
    final prefs = await SharedPreferences.getInstance();
    if (!force && prefs.getBool(_askedKey) == true) return;
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
    if (go != true) return;
    try {
      await Permission.notification.request();
      if ((await FlutterCallkitIncoming.canUseFullScreenIntent()) == false) {
        await FlutterCallkitIncoming.requestFullIntentPermission();
      }
      if (!await Permission.ignoreBatteryOptimizations.isGranted) {
        await Permission.ignoreBatteryOptimizations.request();
      }
    } catch (_) {
      // Best effort: some phones don't support one of these screens.
    }
  }
}
