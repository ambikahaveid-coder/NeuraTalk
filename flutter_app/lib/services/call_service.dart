import 'dart:async';
import 'package:flutter/foundation.dart';
import 'package:connectivity_plus/connectivity_plus.dart';
import 'api_service.dart';
import '../models/call_session.dart';

/// Owns outbound/inbound call HTTP calls and the incoming-call poll loop.
///
/// Incoming calls are surfaced two ways: a native CallKit push (see
/// callkit_service.dart, works even backgrounded/killed) and this class's
/// own `GET /api/calls/incoming` poll every 4s as a foreground fallback.
class CallService extends ChangeNotifier {
  /// Set by the constructor so top-level handlers that live outside the
  /// widget tree (the CallKit accept/decline event listener in
  /// callkit_service.dart) can reach the single app-wide instance without
  /// a BuildContext.
  static CallService? instance;

  Timer? _pollTimer;
  CallSession? _incomingCall;
  bool _polling = false;
  bool _hasConnectivity = true;
  StreamSubscription<List<ConnectivityResult>>? _connectivitySub;

  // Calls already actioned via the native CallKit UI -- skips them in the
  // poll loop so it doesn't also pop up the in-app IncomingCallScreen for a
  // call the user already accepted/declined from the lock screen.
  final Set<String> _handledCallIds = {};

  // True for as long as a CallScreen route is on top -- lets the app tell a
  // genuinely new incoming call apart from "already on a call", so a second
  // caller gets a proper call-waiting prompt instead of a duplicate
  // full-screen IncomingCallScreen stacking on top of the active call.
  bool _inActiveCall = false;
  CallSession? _activeCallSession;

  CallService() {
    instance = this;
  }

  CallSession? get incomingCall => _incomingCall;
  bool get hasConnectivity => _hasConnectivity;
  bool get inActiveCall => _inActiveCall;
  CallSession? get activeCallSession => _activeCallSession;

  void markHandledExternally(String callId) => _handledCallIds.add(callId);

  void setActiveCall(CallSession? session) {
    _activeCallSession = session;
    _inActiveCall = session != null;
  }

  void startPolling() {
    if (_polling) return;
    _polling = true;
    _connectivitySub ??= Connectivity().onConnectivityChanged.listen(_onConnectivityChanged);
    _pollTimer = Timer.periodic(const Duration(seconds: 4), (_) => _pollOnce());
    unawaited(_pollOnce());
  }

  void stopPolling() {
    _polling = false;
    _pollTimer?.cancel();
    _pollTimer = null;
    _connectivitySub?.cancel();
    _connectivitySub = null;
  }

  void _onConnectivityChanged(List<ConnectivityResult> results) {
    final online = results.any((r) => r != ConnectivityResult.none);
    final wasOffline = !_hasConnectivity;
    _hasConnectivity = online;
    // Poll immediately on regaining connectivity rather than waiting up to
    // 4s — this is the moment a missed-call notification is most likely to
    // finally be reachable (e.g. coming back from a tunnel/elevator).
    if (online && wasOffline && _polling) {
      unawaited(_pollOnce());
    }
  }

  Future<void> _pollOnce() async {
    if (_incomingCall != null) return; // already showing one — don't overwrite
    if (!_hasConnectivity) return; // avoid spamming failed requests while offline
    try {
      final res = await ApiService.get('/api/calls/incoming') as Map<String, dynamic>;
      final incoming = res['incoming'];
      if (incoming is Map<String, dynamic>) {
        final id = incoming['callId'] as String?;
        if (id != null && _handledCallIds.contains(id)) return;
        _incomingCall = CallSession.fromIncomingPayload(incoming);
        notifyListeners();
      }
    } catch (_) {
      // Transient network errors shouldn't tear down the poll loop.
    }
  }

  /// Used by the CallKit accept action, which only has callId/callerName/
  /// callType from the push payload (see server/firebase-admin.ts's
  /// sendVoIPPush) -- resolves the queued call's real LiveKit join info
  /// (the same /api/calls/incoming payload the poll loop consumes) and marks
  /// it answered, mirroring IncomingCallScreen._accept(). Returns null if
  /// the call already expired or was handled elsewhere.
  Future<CallSession?> fetchAndAnswerIncoming(String callId) async {
    CallSession? session = _incomingCall?.callId == callId ? _incomingCall : null;
    if (session == null) {
      final res = await ApiService.get('/api/calls/incoming') as Map<String, dynamic>;
      final incoming = res['incoming'];
      if (incoming is Map<String, dynamic> && incoming['callId'] == callId) {
        session = CallSession.fromIncomingPayload(incoming);
      }
    }
    if (session == null) return null;
    await answerCall(callId);
    if (_incomingCall?.callId == callId) _incomingCall = null;
    notifyListeners();
    return session;
  }

  /// Forces an immediate poll outside the regular 4s cadence — used on app
  /// resume so a call that arrived while backgrounded surfaces right away.
  void pollNow() {
    if (!_polling) return;
    unawaited(_pollOnce());
  }

  void clearIncomingCall() {
    _incomingCall = null;
    notifyListeners();
  }

  Future<CallSession> startCall({
    required String calleeIdentifier,
    required String callType,
    String myLanguage = 'auto',
    String theirLanguage = 'auto',
  }) async {
    final connectivity = await Connectivity().checkConnectivity();
    if (connectivity.every((r) => r == ConnectivityResult.none)) {
      throw const CallServiceException('No network connection. Check your Wi-Fi or mobile data and try again.');
    }
    final res = await ApiService.post('/api/calls/create', {
      'calleeIdentifier': calleeIdentifier,
      'callType': callType,
      'myLanguage': myLanguage,
      'theirLanguage': theirLanguage,
    });
    return CallSession.fromCreateResponse(res, callType: callType, remoteName: calleeIdentifier);
  }

  Future<CallSession> startConferenceCall({
    required List<String> participantIds,
    String? title,
    String hostLanguage = 'auto',
  }) async {
    final res = await ApiService.post('/api/calls/conference', {
      'hostLanguage': hostLanguage,
      'participantIds': participantIds,
      if (title != null) 'title': title,
    });
    return CallSession.fromCreateResponse(res, callType: 'voice', remoteName: title ?? 'Group call');
  }

  /// Polls the real call record so the caller can show Calling/Ringing/
  /// Busy/Declined/No-answer instead of joining the LiveKit room blind —
  /// server/modules/calls/lifecycle.ts is the source of truth for these
  /// status strings.
  Future<String> getCallStatus(String callId) async {
    final res = await ApiService.get('/api/calls/$callId') as Map<String, dynamic>;
    return (res['status'] as String?) ?? 'unknown';
  }

  Future<void> answerCall(String callId) async {
    await ApiService.post('/api/calls/$callId/connect', {});
  }

  Future<void> rejectCall(String callId) async {
    await ApiService.post('/api/calls/$callId/reject', {});
  }

  Future<void> endCall(String callId) async {
    try {
      await ApiService.post('/api/calls/$callId/end', {});
    } catch (_) {
      // Best-effort — the LiveKit room disconnect already happened locally.
    }
  }

  Future<void> setHold(String callId, bool onHold) async {
    if (onHold) {
      await ApiService.post('/api/calls/$callId/hold', {});
    } else {
      await ApiService.delete('/api/calls/$callId/hold');
    }
  }

  @override
  void dispose() {
    stopPolling();
    super.dispose();
  }
}

class CallServiceException implements Exception {
  final String message;
  const CallServiceException(this.message);

  @override
  String toString() => message;
}

/// Maps a call-start failure to real user-facing copy. Previously only
/// calls_screen.dart had this mapping -- conversation_screen.dart (the most
/// commonly used call-start path, from inside a chat) and teams_screen.dart
/// showed the raw backend error `message` directly instead, which meant a
/// server-side error code like "CONCURRENT_CALL_RESTRICTED" (see
/// smart-router.ts) was shown to the user verbatim rather than translated
/// into something a real user could understand.
String friendlyCallError(Object e) {
  if (e is CallServiceException) return e.message;
  if (e is! ApiException) return 'Could not start the call. Please try again.';

  switch (e.code) {
    case 'LIVEKIT_UNAVAILABLE':
      return 'Calling is temporarily unavailable. Please try again shortly.';
    case 'PSTN_NOT_CONFIGURED':
      return 'Calling mobile numbers is not available right now.';
    case 'BLOCKED':
      return "This call can't be completed.";
  }

  final reason = e.message.toUpperCase();
  if (reason.contains('BALANCE') || reason.contains('SUBSCRIPTION') || reason.contains('CREDIT_LIMIT') || reason.contains('PAYMENT_REQUIRED')) {
    return 'Insufficient balance or subscription to place this call.';
  }
  if (reason.contains('CONCURRENT_CALL') || reason.contains('RESTRICTED')) {
    return "You're already on a call, or your last call is still wrapping up. Please try again in a moment.";
  }

  return 'Could not start the call. Please try again.';
}
