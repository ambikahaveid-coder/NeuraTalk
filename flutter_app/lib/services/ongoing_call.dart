import 'dart:io' show Platform;

import 'package:flutter/services.dart';

/// Keeps the microphone (and camera, for video) working while a call is
/// connected and the phone is locked or another app is open. Android gives a
/// backgrounded app a silent microphone unless a foreground service runs --
/// see android/.../OngoingCallService.kt. Never throws: a failure here must
/// not stop the call itself.
class OngoingCall {
  OngoingCall._();

  static const MethodChannel _channel = MethodChannel('neuratalk/ongoing_call');
  static bool _running = false;

  static Future<void> start({required bool video, String? peer}) async {
    if (!Platform.isAndroid) return;
    try {
      await _channel.invokeMethod('start', {'video': video, 'peer': peer});
      _running = true;
    } catch (_) {
      // The call continues; only background audio is affected.
    }
  }

  static Future<void> stop() async {
    if (!Platform.isAndroid || !_running) return;
    _running = false;
    try {
      await _channel.invokeMethod('stop');
    } catch (_) {}
  }
}
