import 'package:flutter/services.dart';
import '../main.dart' show navigatorKey;
import '../screens/chat_parity_screens.dart';

/// Opens the join sheet when the app is launched (or brought back) from a
/// group invite link: https://neuratalk.in/g/<code> or neuratalk://g/<code>.
/// The Android side (MainActivity) hands the link over on "neuratalk/links".
class InviteLinks {
  InviteLinks._();
  static final InviteLinks instance = InviteLinks._();
  static const _channel = MethodChannel('neuratalk/links');
  bool _started = false;

  Future<void> start() async {
    if (_started) return;
    _started = true;
    _channel.setMethodCallHandler((call) async {
      if (call.method == 'link') _open('${call.arguments}');
    });
    try {
      final first = await _channel.invokeMethod<String>('initialLink');
      if (first != null) _open(first);
    } catch (_) {/* no native side (tests, iOS) */}
  }

  void _open(String link) {
    final code = inviteCodeFrom(link);
    final context = navigatorKey.currentContext;
    if (code == null || context == null) return;
    showGroupInvite(context, code);
  }
}
