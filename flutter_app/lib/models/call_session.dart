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

  const CallSession({
    required this.callId,
    required this.livekitUrl,
    required this.livekitToken,
    required this.callType,
    required this.remoteName,
    this.remoteId,
    this.isIncoming = false,
    this.expiresAt,
  });

  factory CallSession.fromCreateResponse(
    Map<String, dynamic> json, {
    required String callType,
    required String remoteName,
    String? remoteId,
  }) {
    return CallSession(
      callId: json['callId'] as String,
      livekitUrl: json['livekitUrl'] as String? ?? '',
      livekitToken: json['livekitToken'] as String? ?? '',
      callType: callType,
      remoteName: remoteName,
      remoteId: remoteId,
    );
  }

  factory CallSession.fromIncomingPayload(Map<String, dynamic> json) {
    final expiresAtMs = json['expiresAt'];
    return CallSession(
      callId: json['callId'] as String,
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
