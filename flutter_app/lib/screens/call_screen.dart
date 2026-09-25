import 'dart:async';
import 'dart:convert';
import 'package:audioplayers/audioplayers.dart';
import 'package:flutter/material.dart';
import 'package:livekit_client/livekit_client.dart' as lk;
import 'package:permission_handler/permission_handler.dart';
import '../theme/app_theme.dart';
import '../models/call_session.dart';
import '../services/call_service.dart';
import '../services/contact_resolver.dart';

/// Real in-call screen — connects to the LiveKit room for [session] and
/// exposes mute/speaker/hold/video/end controls. There is no CallKit
/// integration; this is a plain in-app screen (see the mobile calling plan
/// for that scope boundary).
class CallScreen extends StatefulWidget {
  final CallSession session;
  final CallService callService;

  const CallScreen({super.key, required this.session, required this.callService});

  @override
  State<CallScreen> createState() => _CallScreenState();
}

class _CallScreenState extends State<CallScreen> {
  late final lk.Room _room;
  lk.EventsListener<lk.RoomEvent>? _listener;

  bool _connecting = true;
  bool _reconnecting = false;
  bool _muted = false;
  bool _speakerOn = true;
  bool _videoOn = false;
  bool _onHold = false;
  String? _error;
  bool _permissionPermanentlyDenied = false;
  DateTime? _connectedAt;
  Timer? _durationTimer;
  Duration _elapsed = Duration.zero;
  lk.VideoTrack? _remoteVideoTrack;

  // Live translated captions from the translator bot's data messages.
  String? _captionTranslated;
  String? _captionOriginal;
  Timer? _captionClearTimer;
  // Speakers whose original voice is muted locally because their translated
  // voice is currently playing for us (mirrors the web client, so a listener
  // doesn't hear the original and the translation on top of each other).
  final Set<String> _suppressedSpeakers = {};

  // Outbound-call waiting phase — the caller must not join the LiveKit room
  // (and therefore must not show "Connected") until the callee has actually
  // answered. See server/modules/calls/lifecycle.ts for the status machine.
  bool _waitingForAnswer = false;
  String _ringingLabel = 'Calling…';
  Timer? _ringingPollTimer;
  Timer? _ringingTimeoutTimer;
  // Caller-side ringback ("tring-tring") while waiting for the callee. The
  // caller hasn't joined the LiveKit room yet, so it never overlaps call audio.
  final AudioPlayer _ringback = AudioPlayer();

  static const _ringingTimeout = Duration(seconds: 45);

  Future<void> _startRingback() async {
    try {
      await _ringback.setAudioContext(AudioContext(
        android: const AudioContextAndroid(
          usageType: AndroidUsageType.voiceCommunicationSignalling,
          contentType: AndroidContentType.sonification,
          audioFocus: AndroidAudioFocus.gainTransient,
        ),
        iOS: AudioContextIOS(category: AVAudioSessionCategory.playback),
      ));
      await _ringback.setReleaseMode(ReleaseMode.loop);
      await _ringback.play(AssetSource('sounds/ringback.wav'), volume: 0.8);
    } catch (_) {
      // A missing ringback tone must never break the call itself.
    }
  }

  void _stopRingback() {
    unawaited(_ringback.stop().catchError((_) {}));
  }

  // Real P0 bug found from physical-device testing (same class as
  // incoming_call_screen.dart): PopScope(canPop: false) here paired its
  // onPopInvokedWithResult with a plain Navigator.maybePop() call inside
  // _endCall() itself -- since canPop stayed false forever, that pop was
  // permanently swallowed by Flutter's own popDisposition handling, which
  // re-invoked onPopInvokedWithResult, which called _endCall() again,
  // which tried to pop again... a self-triggering loop with no working
  // exit, each cycle firing a real network request. _allowPop flips to
  // true only immediately before this class's own deliberate pop, and
  // _ending makes the network/cleanup side of that a single logical
  // operation no matter how many times something tries to trigger it
  // (button tap, PopScope interception, remote disconnect, ringing
  // timeout/poll result all funnel through the same guarded path).
  bool _allowPop = false;
  bool _ending = false;

  @override
  void initState() {
    super.initState();
    _room = lk.Room();
    _videoOn = widget.session.isVideo;
    widget.callService.setActiveCall(widget.session);
    if (widget.session.isIncoming) {
      _connect();
    } else {
      _waitForAnswer();
    }
  }

  Future<void> _waitForAnswer() async {
    setState(() {
      _waitingForAnswer = true;
      _connecting = false;
      _ringingLabel = 'Calling…';
    });
    unawaited(_startRingback());

    _ringingTimeoutTimer = Timer(_ringingTimeout, () {
      if (!mounted || !_waitingForAnswer) return;
      _endWaitingWithMessage('No answer.');
    });

    _ringingPollTimer = Timer.periodic(const Duration(milliseconds: 1500), (_) async {
      if (!mounted) return;
      try {
        final status = await widget.callService.getCallStatus(widget.session.callId);
        if (!mounted || !_waitingForAnswer) return;
        switch (status) {
          case 'ringing':
            setState(() => _ringingLabel = 'Ringing…');
            break;
          case 'answered':
          case 'active':
            _ringingPollTimer?.cancel();
            _ringingTimeoutTimer?.cancel();
            _stopRingback();
            setState(() {
              _waitingForAnswer = false;
              _connecting = true;
            });
            _connect();
            break;
          case 'busy':
            _endWaitingWithMessage('Line busy.');
            break;
          case 'missed':
            _endWaitingWithMessage('No answer.');
            break;
          case 'cancelled':
            _endWaitingWithMessage('Call declined.');
            break;
          case 'failed':
            _endWaitingWithMessage('Call could not be connected.');
            break;
        }
      } catch (_) {
        // Transient — keep polling until the timeout fires.
      }
    });
  }

  /// Single owner of the network/cleanup side of ending this call --
  /// idempotent regardless of how many call sites try to trigger it.
  Future<void> _performEndCallNetwork({String? reason}) async {
    if (_ending) return;
    _ending = true;
    _ringingPollTimer?.cancel();
    _ringingTimeoutTimer?.cancel();
    _stopRingback();
    _durationTimer?.cancel();
    try {
      await _room.disconnect().timeout(const Duration(seconds: 3), onTimeout: () {});
    } catch (_) {
      // Best-effort -- leaving the call locally must never get stuck here.
    }
    try {
      await widget.callService.endCall(widget.session.callId, reason: reason).timeout(const Duration(seconds: 3), onTimeout: () {});
    } catch (_) {
      // endCall() already swallows its own errors, but guard regardless.
    }
  }

  /// Single owner of "actually leave this screen". PopScope's canPop is
  /// backed by a ValueNotifier that only picks up a new widget value inside
  /// didUpdateWidget -- i.e. on the *next rebuild*, not synchronously right
  /// after setState(). Popping in the same call stack as the setState()
  /// that flips _allowPop would still read the stale `false` and get
  /// swallowed again, same as the original bug. Waiting a frame first is
  /// what actually makes canPop's new value visible to the pop request.
  void _exitScreen() {
    if (!mounted) return;
    if (ModalRoute.of(context)?.isCurrent != true) return;
    setState(() => _allowPop = true);
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) Navigator.of(context).pop();
    });
  }

  void _endWaitingWithMessage(String message) {
    _ringingPollTimer?.cancel();
    _ringingTimeoutTimer?.cancel();
    _stopRingback();
    if (mounted) {
      setState(() {
        _waitingForAnswer = false;
        _error = message;
      });
    }
    unawaited(_performEndCallNetwork());
    Future.delayed(const Duration(seconds: 2), _exitScreen);
  }

  Future<void> _connect() async {
    if (!widget.session.hasLiveKitDetails) {
      setState(() {
        _connecting = false;
        _error = 'Call service is not available right now.';
      });
      return;
    }

    final micGranted = await Permission.microphone.request();
    if (!micGranted.isGranted) {
      setState(() {
        _connecting = false;
        _error = 'Microphone permission is required to make calls.';
        _permissionPermanentlyDenied = micGranted.isPermanentlyDenied;
      });
      unawaited(_performEndCallNetwork());
      return;
    }
    bool cameraGrantedForVideo = false;
    if (widget.session.isVideo) {
      final cameraStatus = await Permission.camera.request();
      cameraGrantedForVideo = cameraStatus.isGranted;
    }

    try {
      await _room.connect(widget.session.livekitUrl, widget.session.livekitToken);
      _listener = _room.createListener()
        ..on<lk.RoomDisconnectedEvent>(_onRoomDisconnected)
        ..on<lk.RoomReconnectingEvent>((_) {
          if (mounted) setState(() => _reconnecting = true);
        })
        ..on<lk.RoomReconnectedEvent>((_) {
          if (mounted) setState(() => _reconnecting = false);
        })
        ..on<lk.TrackSubscribedEvent>(_onTrackSubscribed)
        ..on<lk.TrackUnsubscribedEvent>(_onTrackUnsubscribed)
        ..on<lk.DataReceivedEvent>(_onDataReceived);

      // Tell the translator we want translated *voice* (not only text), both
      // via metadata (read whenever the bot sets up this speaker) and a data
      // message (applied immediately if the bot is already listening).
      unawaited(_announceTranslationMode());

      // A translated track may already have been subscribed before the
      // listener above was attached.
      for (final participant in _room.remoteParticipants.values) {
        for (final pub in participant.audioTrackPublications) {
          if (pub.subscribed) _applyTranslatedTrack(pub.name, subscribed: true);
        }
      }

      // The other participant may have joined and already published video
      // before this side's room.connect() resolved and the listener above
      // was attached -- a TrackSubscribedEvent that already fired before
      // the listener existed is never redelivered, so without this the
      // remote video silently never appears even though the connection and
      // audio work fine. Sync any already-subscribed video track directly
      // off room state rather than relying purely on future events.
      for (final participant in _room.remoteParticipants.values) {
        for (final pub in participant.videoTrackPublications) {
          if (pub.subscribed && pub.track != null) {
            _remoteVideoTrack = pub.track;
            break;
          }
        }
        if (_remoteVideoTrack != null) break;
      }

      // Explicit rather than relying on the SDK/WebRTC defaults -- some
      // Android OEM audio stacks don't apply the standard WebRTC defaults
      // consistently, so asking for these outright is the safer bet for
      // reducing background noise, echo and volume jumps on real devices.
      await _room.localParticipant?.setMicrophoneEnabled(
        true,
        audioCaptureOptions: const lk.AudioCaptureOptions(
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        ),
      );
      if (widget.session.isVideo && cameraGrantedForVideo) {
        await _room.localParticipant?.setCameraEnabled(true);
      } else if (widget.session.isVideo) {
        _videoOn = false;
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(content: Text('Camera permission denied — continuing as voice only.')),
          );
        }
      }
      await _room.setSpeakerOn(_speakerOn);

      if (!mounted) return;
      setState(() {
        _connecting = false;
        _connectedAt = DateTime.now();
      });
      _durationTimer = Timer.periodic(const Duration(seconds: 1), (_) {
        if (!mounted || _connectedAt == null) return;
        setState(() => _elapsed = DateTime.now().difference(_connectedAt!));
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _connecting = false;
        _error = 'Could not connect the call. Please try again.';
      });
    }
  }

  void _onTrackSubscribed(lk.TrackSubscribedEvent event) {
    if (event.track is lk.VideoTrack) {
      setState(() => _remoteVideoTrack = event.track as lk.VideoTrack);
      return;
    }
    _applyTranslatedTrack(event.publication.name, subscribed: true);
    // A speaker whose translation is already playing may (re)publish their mic.
    final identity = event.participant.identity;
    if (_suppressedSpeakers.contains(identity)) {
      unawaited(event.publication.disable());
    }
  }

  void _onTrackUnsubscribed(lk.TrackUnsubscribedEvent event) {
    if (event.track == _remoteVideoTrack) {
      setState(() => _remoteVideoTrack = null);
      return;
    }
    _applyTranslatedTrack(event.publication.name, subscribed: false);
  }

  Future<void> _announceTranslationMode() async {
    final local = _room.localParticipant;
    if (local == null) return;
    try {
      Map<String, dynamic> meta = {};
      try {
        final parsed = jsonDecode(local.metadata ?? '');
        if (parsed is Map<String, dynamic>) meta = parsed;
      } catch (_) {}
      meta['translationMode'] = 'voice';
      local.setMetadata(jsonEncode(meta));
      await local.publishData(
        utf8.encode(jsonEncode({'type': 'translation-mode', 'payload': {'translationMode': 'voice'}})),
        reliable: true,
        topic: 'translation-control',
      );
    } catch (_) {
      // Best-effort; the server already defaults app calls to voice mode.
    }
  }

  /// Track names look like `translated-for-<me>-from-<speaker>` (URL-encoded).
  /// When our translated track for a speaker arrives, mute that speaker's
  /// original voice for us; when it goes away, restore it so the call never
  /// goes silent if translation stops.
  void _applyTranslatedTrack(String? trackName, {required bool subscribed}) {
    final me = _room.localParticipant?.identity;
    if (trackName == null || me == null) return;
    final prefix = 'translated-for-${Uri.encodeComponent(me)}-from-';
    if (!trackName.startsWith(prefix)) return;
    final speaker = Uri.decodeComponent(trackName.substring(prefix.length));
    final participant = _room.remoteParticipants.values
        .where((p) => p.identity == speaker)
        .firstOrNull;
    if (subscribed) {
      _suppressedSpeakers.add(speaker);
    } else {
      _suppressedSpeakers.remove(speaker);
    }
    if (participant == null) return;
    for (final pub in participant.audioTrackPublications) {
      unawaited(subscribed ? pub.disable() : pub.enable());
    }
  }

  void _onDataReceived(lk.DataReceivedEvent event) {
    if (event.topic != null && event.topic != 'translation') return;
    try {
      final msg = jsonDecode(utf8.decode(event.data));
      if (msg is! Map || msg['type'] != 'translation') return;
      final payload = msg['payload'];
      if (payload is! Map) return;
      final type = payload['type'];
      final me = _room.localParticipant?.identity;
      if (payload['targetIdentity'] != null && payload['targetIdentity'] != me) return;

      if (type == 'translation.partial' || type == 'translation.ready' || type == 'translation_failed' || type == 'tts_failed') {
        final translated = (payload['translatedText'] as String?)?.trim();
        if (translated == null || translated.isEmpty) return;
        final original = (payload['originalText'] as String?)?.trim();
        if (!mounted) return;
        setState(() {
          _captionTranslated = translated;
          _captionOriginal = (original != null && original.isNotEmpty) ? original : _captionOriginal;
        });
        // If speech synthesis failed, the text caption is all the listener
        // gets for that sentence — let them hear the original voice again.
        if (type == 'tts_failed') {
          final speaker = payload['sourceIdentity'];
          if (speaker is String) {
            final participant = _room.remoteParticipants.values
                .where((p) => p.identity == speaker)
                .firstOrNull;
            participant?.audioTrackPublications.forEach((pub) => unawaited(pub.enable()));
            _suppressedSpeakers.remove(speaker);
          }
        }
        _captionClearTimer?.cancel();
        _captionClearTimer = Timer(const Duration(seconds: 7), () {
          if (mounted) setState(() { _captionTranslated = null; _captionOriginal = null; });
        });
      }
    } catch (_) {
      // Ignore malformed or unrelated data messages.
    }
  }

  void _onRoomDisconnected(lk.RoomDisconnectedEvent event) {
    // clientInitiated/roomDeleted are the normal outcome of someone tapping
    // End Call, which already reports a reason via _performEndCallNetwork().
    // Anything else here is a real, previously-silent connection failure --
    // report it so a real cause is visible next time this happens, instead
    // of guessing from duration numbers alone. _performEndCallNetwork's own
    // _ending guard makes this safe to call even if a manual End Call tap
    // is already in flight.
    if (event.reason != lk.DisconnectReason.clientInitiated &&
        event.reason != lk.DisconnectReason.roomDeleted) {
      unawaited(_performEndCallNetwork(reason: 'client_disconnect_${event.reason?.name ?? "unknown"}'));
    }
    if (!mounted) return;
    final message = switch (event.reason) {
      lk.DisconnectReason.clientInitiated => null,
      lk.DisconnectReason.participantRemoved => 'You were removed from the call.',
      lk.DisconnectReason.roomDeleted => 'The call has ended.',
      lk.DisconnectReason.reconnectAttemptsExceeded ||
      lk.DisconnectReason.signalingConnectionFailure => 'Connection lost. The call has ended.',
      _ => null,
    };
    if (message != null) {
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(message)));
    }
    _exitScreen();
  }

  Future<void> _toggleMute() async {
    final next = !_muted;
    await _room.localParticipant?.setMicrophoneEnabled(!next);
    if (mounted) setState(() => _muted = next);
  }

  Future<void> _toggleSpeaker() async {
    final next = !_speakerOn;
    await _room.setSpeakerOn(next);
    if (mounted) setState(() => _speakerOn = next);
  }

  Future<void> _toggleVideo() async {
    final next = !_videoOn;
    await _room.localParticipant?.setCameraEnabled(next);
    if (mounted) setState(() => _videoOn = next);
  }

  Future<void> _switchCamera() async {
    try {
      final devices = await lk.Hardware.instance.videoInputs();
      if (devices.length < 2) return;
      final current = lk.Hardware.instance.selectedVideoInput;
      final next = devices.firstWhere((d) => d.deviceId != current?.deviceId, orElse: () => devices.first);
      await _room.setVideoInputDevice(next);
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Could not switch camera.')),
        );
      }
    }
  }

  Future<void> _toggleHold() async {
    final next = !_onHold;
    try {
      await widget.callService.setHold(widget.session.callId, next);
      await _room.localParticipant?.setMicrophoneEnabled(!next && !_muted);
      if (mounted) setState(() => _onHold = next);
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Could not update hold state')),
        );
      }
    }
  }

  Future<void> _endCall() async {
    await _performEndCallNetwork();
    _exitScreen();
  }

  @override
  void dispose() {
    _durationTimer?.cancel();
    _ringingPollTimer?.cancel();
    _ringingTimeoutTimer?.cancel();
    _ringback.dispose();
    _captionClearTimer?.cancel();
    _listener?.dispose();
    _room.disconnect();
    if (widget.callService.activeCallSession?.callId == widget.session.callId) {
      widget.callService.setActiveCall(null);
    }
    super.dispose();
  }

  String _formatElapsed(Duration d) {
    final minutes = d.inMinutes.remainder(60).toString().padLeft(2, '0');
    final seconds = d.inSeconds.remainder(60).toString().padLeft(2, '0');
    return d.inHours > 0 ? '${d.inHours}:$minutes:$seconds' : '$minutes:$seconds';
  }

  @override
  Widget build(BuildContext context) {
    return PopScope(
      canPop: _allowPop,
      onPopInvokedWithResult: (didPop, _) async {
        if (didPop) return;
        await _endCall();
      },
      child: Scaffold(
        backgroundColor: AppColors.background,
        body: SafeArea(
          child: Column(
            children: [
              Expanded(
                child: Stack(
                  fit: StackFit.expand,
                  children: [
                    if (_remoteVideoTrack != null)
                      lk.VideoTrackRenderer(_remoteVideoTrack!)
                    else
                      _RemotePlaceholder(
                        name: ContactResolver.instance.displayNameFor(widget.session.remoteName),
                        connecting: _connecting,
                        error: _error,
                        statusLabel: _waitingForAnswer ? _ringingLabel : null,
                        showOpenSettings: _permissionPermanentlyDenied,
                      ),
                    if (_reconnecting)
                      Positioned(
                        top: 12,
                        left: 0,
                        right: 0,
                        child: Center(
                          child: Container(
                            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 6),
                            decoration: BoxDecoration(
                              color: AppColors.orange.withValues(alpha: 0.85),
                              borderRadius: BorderRadius.circular(20),
                            ),
                            child: const Text(
                              'Reconnecting…',
                              style: TextStyle(color: AppColors.background, fontSize: 13, fontWeight: FontWeight.w700),
                            ),
                          ),
                        ),
                      ),
                    if (_connectedAt != null)
                      Positioned(
                        top: 12,
                        left: 0,
                        right: 0,
                        child: Center(
                          child: Container(
                            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 6),
                            decoration: BoxDecoration(
                              color: AppColors.background.withValues(alpha: 0.55),
                              borderRadius: BorderRadius.circular(20),
                            ),
                            child: Text(
                              _formatElapsed(_elapsed),
                              style: const TextStyle(color: AppColors.textSecondary, fontSize: 13, fontWeight: FontWeight.w600),
                            ),
                          ),
                        ),
                      ),
                    if (_captionTranslated != null)
                      Positioned(
                        left: 12,
                        right: 12,
                        bottom: 16,
                        child: _CaptionBox(translated: _captionTranslated!, original: _captionOriginal),
                      ),
                    if (_videoOn && _room.localParticipant?.videoTrackPublications.isNotEmpty == true)
                      Positioned(
                        top: 16,
                        right: 16,
                        width: 110,
                        height: 150,
                        child: ClipRRect(
                          borderRadius: BorderRadius.circular(12),
                          child: lk.VideoTrackRenderer(
                            _room.localParticipant!.videoTrackPublications.first.track as lk.VideoTrack,
                          ),
                        ),
                      ),
                  ],
                ),
              ),
              _ControlBar(
                muted: _muted,
                speakerOn: _speakerOn,
                videoOn: _videoOn,
                onHold: _onHold,
                isVideoCall: widget.session.isVideo,
                enabled: !_connecting && !_waitingForAnswer && _error == null,
                onMute: _toggleMute,
                onSpeaker: _toggleSpeaker,
                onVideo: _toggleVideo,
                onSwitchCamera: _switchCamera,
                onHoldToggle: _toggleHold,
                onEnd: _endCall,
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// Large, high-contrast live caption — readable for elderly users and in
/// noisy places. Translated text first; the original in smaller text below.
class _CaptionBox extends StatelessWidget {
  final String translated;
  final String? original;
  const _CaptionBox({required this.translated, this.original});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
      decoration: BoxDecoration(
        color: Colors.black.withValues(alpha: 0.78),
        borderRadius: BorderRadius.circular(14),
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            translated,
            maxLines: 4,
            overflow: TextOverflow.ellipsis,
            style: const TextStyle(color: Colors.white, fontSize: 22, height: 1.3, fontWeight: FontWeight.w700),
          ),
          if (original != null && original != translated) ...[
            const SizedBox(height: 6),
            Text(
              original!,
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(color: Color(0xFFCFD8DC), fontSize: 15, height: 1.3),
            ),
          ],
        ],
      ),
    );
  }
}

class _RemotePlaceholder extends StatelessWidget {
  final String name;
  final bool connecting;
  final String? error;
  final String? statusLabel;
  final bool showOpenSettings;
  const _RemotePlaceholder({required this.name, required this.connecting, this.error, this.statusLabel, this.showOpenSettings = false});

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Container(
            width: 96,
            height: 96,
            decoration: const BoxDecoration(color: AppColors.surfaceElevated, shape: BoxShape.circle),
            alignment: Alignment.center,
            child: Text(
              name.isNotEmpty ? name[0].toUpperCase() : '?',
              style: const TextStyle(color: AppColors.cyan, fontSize: 36, fontWeight: FontWeight.w700),
            ),
          ),
          const SizedBox(height: 16),
          Text(name, style: const TextStyle(color: AppColors.ink, fontSize: 22, fontWeight: FontWeight.w700)),
          const SizedBox(height: 8),
          if (error != null) ...[
            Text(error!, style: const TextStyle(color: AppColors.red), textAlign: TextAlign.center),
            if (showOpenSettings) ...[
              const SizedBox(height: 12),
              TextButton(
                onPressed: openAppSettings,
                child: const Text('Open Settings', style: TextStyle(color: AppColors.cyan)),
              ),
            ],
          ] else if (statusLabel != null)
            Text(statusLabel!, style: const TextStyle(color: AppColors.textSecondary))
          else
            Text(connecting ? 'Connecting…' : 'Connected', style: const TextStyle(color: AppColors.textSecondary)),
        ],
      ),
    );
  }
}

class _ControlBar extends StatelessWidget {
  final bool muted;
  final bool speakerOn;
  final bool videoOn;
  final bool onHold;
  final bool isVideoCall;
  final bool enabled;
  final VoidCallback onMute;
  final VoidCallback onSpeaker;
  final VoidCallback onVideo;
  final VoidCallback onSwitchCamera;
  final VoidCallback onHoldToggle;
  final VoidCallback onEnd;

  const _ControlBar({
    required this.muted,
    required this.speakerOn,
    required this.videoOn,
    required this.onHold,
    required this.isVideoCall,
    required this.enabled,
    required this.onMute,
    required this.onSpeaker,
    required this.onVideo,
    required this.onSwitchCamera,
    required this.onHoldToggle,
    required this.onEnd,
  });

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 24),
      child: Column(
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              _CallControlButton(icon: muted ? Icons.mic_off : Icons.mic, active: muted, onTap: enabled ? onMute : null),
              const SizedBox(width: 20),
              _CallControlButton(icon: speakerOn ? Icons.volume_up : Icons.hearing, active: speakerOn, onTap: enabled ? onSpeaker : null),
              const SizedBox(width: 20),
              _CallControlButton(icon: onHold ? Icons.play_arrow : Icons.pause, active: onHold, onTap: enabled ? onHoldToggle : null),
              if (isVideoCall) ...[
                const SizedBox(width: 20),
                _CallControlButton(icon: videoOn ? Icons.videocam : Icons.videocam_off, active: !videoOn, onTap: enabled ? onVideo : null),
                if (videoOn) ...[
                  const SizedBox(width: 20),
                  _CallControlButton(icon: Icons.cameraswitch, active: false, onTap: enabled ? onSwitchCamera : null),
                ],
              ],
            ],
          ),
          const SizedBox(height: 24),
          GestureDetector(
            onTap: onEnd,
            child: Container(
              width: 64,
              height: 64,
              decoration: const BoxDecoration(color: AppColors.red, shape: BoxShape.circle),
              child: const Icon(Icons.call_end, color: AppColors.onAccent, size: 28),
            ),
          ),
        ],
      ),
    );
  }
}

class _CallControlButton extends StatelessWidget {
  final IconData icon;
  final bool active;
  final VoidCallback? onTap;
  const _CallControlButton({required this.icon, required this.active, required this.onTap});

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: Container(
        width: 56,
        height: 56,
        decoration: BoxDecoration(
          color: active ? AppColors.cyan : AppColors.surfaceElevated,
          shape: BoxShape.circle,
        ),
        child: Icon(icon, color: active ? AppColors.background : AppColors.textPrimary, size: 24),
      ),
    );
  }
}
