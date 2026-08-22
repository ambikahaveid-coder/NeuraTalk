import 'dart:async';
import 'package:flutter/material.dart';
import '../theme/app_theme.dart';
import '../models/call_session.dart';
import '../services/call_service.dart';
import '../services/callkit_service.dart';
import 'call_screen.dart';

/// Full-screen accept/reject UI, pushed by the top-level incoming-call
/// listener (see main.dart) when the poll loop detects a call. Auto-dismisses
/// if the offer expires (mirrors the ~45s TTL used by the incoming-call queue
/// on the backend, per server/modules/calls/service.ts).
class IncomingCallScreen extends StatefulWidget {
  final CallSession session;
  final CallService callService;

  const IncomingCallScreen({
    super.key,
    required this.session,
    required this.callService,
  });

  @override
  State<IncomingCallScreen> createState() => _IncomingCallScreenState();
}

class _IncomingCallScreenState extends State<IncomingCallScreen> {
  Timer? _expiryTimer;
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    final expiresAt = widget.session.expiresAt;
    if (expiresAt != null) {
      final remaining = expiresAt.difference(DateTime.now());
      if (remaining.isNegative) {
        WidgetsBinding.instance.addPostFrameCallback((_) => _dismiss());
      } else {
        _expiryTimer = Timer(remaining, _dismiss);
      }
    }
  }

  void _dismiss() {
    widget.callService.clearIncomingCall();
    if (mounted) Navigator.of(context).maybePop();
  }

  Future<void> _accept() async {
    if (_busy) return;
    setState(() => _busy = true);
    try {
      widget.callService.markHandledExternally(widget.session.callId);
      unawaited(CallKitService.endCall(widget.session.callId));
      await widget.callService.answerCall(widget.session.callId);
      widget.callService.clearIncomingCall();
      if (!mounted) return;
      Navigator.of(context).pushReplacement(
        MaterialPageRoute(builder: (_) => CallScreen(session: widget.session, callService: widget.callService)),
      );
    } catch (_) {
      if (mounted) {
        setState(() => _busy = false);
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Could not answer the call')),
        );
      }
    }
  }

  Future<void> _reject() async {
    if (_busy) return;
    setState(() => _busy = true);
    widget.callService.markHandledExternally(widget.session.callId);
    unawaited(CallKitService.endCall(widget.session.callId));
    try {
      await widget.callService.rejectCall(widget.session.callId);
    } catch (_) {
      // Best-effort — dismiss locally regardless.
    }
    widget.callService.clearIncomingCall();
    if (mounted) Navigator.of(context).maybePop();
  }

  @override
  void dispose() {
    _expiryTimer?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final session = widget.session;
    return PopScope(
      canPop: false,
      child: Scaffold(
        backgroundColor: AppColors.background,
        body: SafeArea(
          child: Column(
            children: [
              const Spacer(flex: 2),
              Container(
                width: 120,
                height: 120,
                decoration: const BoxDecoration(color: AppColors.surfaceElevated, shape: BoxShape.circle),
                alignment: Alignment.center,
                child: Text(
                  session.remoteName.isNotEmpty ? session.remoteName[0].toUpperCase() : '?',
                  style: const TextStyle(color: AppColors.cyan, fontSize: 44, fontWeight: FontWeight.w700),
                ),
              ),
              const SizedBox(height: 24),
              Text(session.remoteName, style: const TextStyle(color: AppColors.white, fontSize: 26, fontWeight: FontWeight.w700)),
              const SizedBox(height: 8),
              Text(
                session.isVideo ? 'Incoming video call' : 'Incoming voice call',
                style: const TextStyle(color: AppColors.textSecondary, fontSize: 15),
              ),
              const Spacer(flex: 3),
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 48, vertical: 32),
                child: Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    _ActionButton(
                      icon: Icons.call_end,
                      color: AppColors.red,
                      label: 'Decline',
                      onTap: _busy ? null : _reject,
                    ),
                    _ActionButton(
                      icon: session.isVideo ? Icons.videocam : Icons.call,
                      color: AppColors.green,
                      label: 'Accept',
                      onTap: _busy ? null : _accept,
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _ActionButton extends StatelessWidget {
  final IconData icon;
  final Color color;
  final String label;
  final VoidCallback? onTap;
  const _ActionButton({required this.icon, required this.color, required this.label, required this.onTap});

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        GestureDetector(
          onTap: onTap,
          child: Container(
            width: 72,
            height: 72,
            decoration: BoxDecoration(color: color, shape: BoxShape.circle),
            child: Icon(icon, color: AppColors.white, size: 32),
          ),
        ),
        const SizedBox(height: 8),
        Text(label, style: const TextStyle(color: AppColors.textSecondary, fontSize: 13)),
      ],
    );
  }
}
