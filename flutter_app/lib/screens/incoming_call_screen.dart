import 'dart:async';
import 'package:flutter/material.dart';
import '../theme/app_theme.dart';
import '../models/call_session.dart';
import '../services/call_service.dart';
import '../services/callkit_service.dart';
import '../services/contact_resolver.dart';
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
    // Same wrong-screen-pop class of bug fixed elsewhere in the call flow:
    // this timer can fire after another screen (e.g. call-waiting) has
    // already been pushed on top, so an unguarded maybePop() would close
    // that screen instead of this stale one.
    if (mounted && ModalRoute.of(context)?.isCurrent == true) {
      Navigator.of(context).maybePop();
    }
  }

  void _goToCallScreen() {
    widget.callService.clearIncomingCall();
    if (!mounted) return;
    Navigator.of(context).pushReplacement(
      MaterialPageRoute(builder: (_) => CallScreen(session: widget.session, callService: widget.callService)),
    );
  }

  Future<void> _accept() async {
    if (_busy) return;
    setState(() => _busy = true);
    widget.callService.markHandledExternally(widget.session.callId);
    unawaited(CallKitService.endCall(widget.session.callId));
    try {
      await widget.callService.answerCall(widget.session.callId);
      _goToCallScreen();
    } catch (e) {
      // The native CallKit UI and this in-app screen can both be reachable
      // for the same call at once -- if CallKit's own accept already
      // answered it (e.g. the app was foregrounded right as the push
      // arrived), this connect call fails even though the call is genuinely
      // already answered. Check real status before declaring failure rather
      // than showing an error for a call that's actually fine.
      try {
        final status = await widget.callService.getCallStatus(widget.session.callId);
        if (status == 'answered' || status == 'active') {
          _goToCallScreen();
          return;
        }
        // The call is genuinely over (caller gave up, or it was declined
        // elsewhere) -- retrying Answer here can only ever fail again with
        // the same INVALID_CALL_STATE_TRANSITION. Dismiss with a real
        // explanation instead of leaving a dead-end error the user can tap
        // Answer on forever.
        const terminal = {'missed', 'cancelled', 'busy', 'failed', 'ended'};
        if (terminal.contains(status)) {
          widget.callService.clearIncomingCall();
          if (mounted) {
            ScaffoldMessenger.of(context).showSnackBar(
              const SnackBar(content: Text('This call has ended.')),
            );
            Navigator.of(context).maybePop();
          }
          return;
        }
      } catch (_) {
        // Fall through to the error below.
      }
      if (mounted) {
        setState(() => _busy = false);
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Could not answer the call ($e)')),
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
    if (mounted && ModalRoute.of(context)?.isCurrent == true) {
      Navigator.of(context).maybePop();
    }
  }

  @override
  void dispose() {
    _expiryTimer?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final session = widget.session;
    final displayName = ContactResolver.instance.displayNameFor(session.remoteName);
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
                  displayName.isNotEmpty ? displayName[0].toUpperCase() : '?',
                  style: const TextStyle(color: AppColors.cyan, fontSize: 44, fontWeight: FontWeight.w700),
                ),
              ),
              const SizedBox(height: 24),
              Text(displayName, style: const TextStyle(color: AppColors.white, fontSize: 26, fontWeight: FontWeight.w700)),
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
