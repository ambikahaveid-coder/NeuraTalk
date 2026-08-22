import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_callkit_incoming/entities/entities.dart';
import 'package:flutter_callkit_incoming/flutter_callkit_incoming.dart';
import '../main.dart' show navigatorKey;
import '../screens/call_screen.dart';
import 'call_service.dart';

/// Native OS-level incoming-call UI (a full-screen ringing activity + system
/// ringtone on Android, CallKit on iOS) so a call rings and shows a
/// lock-screen Accept/Decline UI even when the app is backgrounded or fully
/// killed. The in-app poll loop in [CallService] only ever worked while the
/// Flutter engine was alive (see its doc comment) -- this fills that gap.
/// Triggered by the FCM data push server/firebase-admin.ts's sendVoIPPush
/// sends on call creation (wired in push_service.dart and the background
/// handler registered in main.dart).
class CallKitService {
  static bool _listening = false;

  static Future<void> showIncomingCall({
    required String callId,
    required String callerName,
    required String callType,
  }) async {
    final params = CallKitParams(
      id: callId,
      nameCaller: callerName,
      appName: 'NeuraTalk',
      handle: callerName,
      type: callType == 'video' ? 1 : 0,
      duration: 45000,
      textAccept: 'Accept',
      textDecline: 'Decline',
      missedCallNotification: const NotificationParams(
        showNotification: true,
        isShowCallback: false,
        subtitle: 'Missed call',
      ),
      android: const AndroidParams(
        isCustomNotification: true,
        isShowLogo: false,
        ringtonePath: 'system_ringtone_default',
        backgroundColor: '#0A0E1A',
        actionColor: '#22C55E',
        incomingCallNotificationChannelName: 'Incoming Calls',
        isShowFullLockedScreen: true,
      ),
      ios: const IOSParams(
        iconName: 'CallKitLogo',
        handleType: 'generic',
        supportsVideo: true,
        ringtonePath: 'system_ringtone_default',
      ),
    );
    await FlutterCallkitIncoming.showCallkitIncoming(params);
  }

  static Future<void> endCall(String callId) async {
    await FlutterCallkitIncoming.endCall(callId);
  }

  /// Android 13+ requires runtime notification permission for the incoming
  /// call channel; Android 14+ additionally gates full-screen-intent (the
  /// lock-screen ringing UI) behind its own permission. Both are no-ops on
  /// iOS/older Android. Best-effort -- if denied, calls fall back to a plain
  /// heads-up notification instead of the full ringing screen.
  static Future<void> requestPermissions() async {
    try {
      await FlutterCallkitIncoming.requestNotificationPermission({
        'title': 'Incoming call permission',
        'rationaleMessagePermission': 'NeuraTalk needs notification access to show incoming calls.',
      });
      final canFullScreen = await FlutterCallkitIncoming.canUseFullScreenIntent();
      if (canFullScreen == false) {
        await FlutterCallkitIncoming.requestFullIntentPermission();
      }
    } catch (_) {
      // Best-effort permission priming -- not fatal if the platform/version
      // doesn't support one of these calls.
    }
  }

  /// Wires Accept/Decline actions from the native UI back into the real
  /// backend endpoints. Must be started once, early in main() (before
  /// runApp), so it also catches the event that resumes/cold-starts the app
  /// when the user taps Accept on the lock screen.
  static void startListening() {
    if (_listening) return;
    _listening = true;
    FlutterCallkitIncoming.onEvent.listen((event) async {
      if (event == null) return;
      final data = Map<String, dynamic>.from(event.body as Map? ?? {});
      final callId = data['id'] as String?;
      if (callId == null) return;
      final callService = CallService.instance;

      switch (event.event) {
        case Event.actionCallAccept:
          if (callService == null) break;
          callService.markHandledExternally(callId);
          try {
            final session = await callService.fetchAndAnswerIncoming(callId);
            if (session != null) {
              navigatorKey.currentState?.push(
                MaterialPageRoute(
                  builder: (_) => CallScreen(session: session, callService: callService),
                ),
              );
            }
          } catch (_) {
            // Best-effort -- the call may have already expired or been
            // answered/declined elsewhere; nothing more to do here.
          }
          break;
        case Event.actionCallDecline:
        case Event.actionCallTimeout:
          callService?.markHandledExternally(callId);
          if (callService != null) {
            unawaited(callService.rejectCall(callId));
            callService.clearIncomingCall();
          }
          break;
        default:
          break;
      }
    });
  }
}
