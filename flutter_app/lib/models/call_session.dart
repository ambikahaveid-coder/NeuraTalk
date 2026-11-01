/// A live or about-to-connect LiveKit call. Built either from
/// `POST /api/calls/create` / `/api/calls/conference` (outbound), or from the
/// `incoming` payload returned by `GET /api/calls/incoming` (inbound).
class CallSession {
  final String callId;
  final String livekitUrl;
  final String livekitToken;
  final String callType; // "voice" | "video"
  final String remoteName;
  final String? remoteId;
  final bool isIncoming;
  final DateTime? expiresAt;
  /// Group call: everyone joins one room; the caller doesn't wait for a
  /// single "answer" and the screen shows everyone in a grid.
  final bool isGroup;
  /// Why AI translation is off on this call although the languages differ
  /// (e.g. the free AI minutes are used up). Null when nothing to say.
  final String? translationNotice;

  const CallSession({
    required this.callId,
    required this.livekitUrl,
    required this.livekitToken,
    required this.callType,
    required this.remoteName,
    this.remoteId,
    this.isIncoming = false,
    this.expiresAt,
    this.isGroup = false,
    this.translationNotice,
  });

  factory CallSession.fromCreateResponse(
    Map<String, dynamic> json, {
    required String callType,
    required String remoteName,
    String? remoteId,
    bool isGroup = false,
  }) {
    final callId = json['callId'] as String;
    return CallSession(
      callId: callId,
      livekitUrl: json['livekitUrl'] as String? ?? '',
      livekitToken: json['livekitToken'] as String? ?? '',
      callType: callType,
      remoteName: remoteName,
      remoteId: remoteId,
      isGroup: isGroup || callId.startsWith('conf_'),
      translationNotice: json['translationUnavailableReason'] == 'NO_AI_MINUTES'
          ? 'Your AI translation minutes are used up, so this call is without translation. Get a plan to turn it back on.'
          : null,
    );
  }

  factory CallSession.fromIncomingPayload(Map<String, dynamic> json) {
    final expiresAtMs = json['expiresAt'];
    final callId = json['callId'] as String;
    return CallSession(
      callId: callId,
      isGroup: callId.startsWith('conf_'),
      livekitUrl: json['livekitUrl'] as String? ?? '',
      livekitToken: json['livekitToken'] as String? ?? '',
      callType: json['callType'] as String? ?? 'voice',
      remoteName: json['callerName'] as String? ?? json['callerId'] as String? ?? 'Unknown',
      remoteId: json['callerId'] as String?,
      isIncoming: true,
      expiresAt: expiresAtMs is int ? DateTime.fromMillisecondsSinceEpoch(expiresAtMs) : null,
    );
  }

  bool get isVideo => callType == 'video';
  bool get hasLiveKitDetails => livekitUrl.isNotEmpty && livekitToken.isNotEmpty;
}
