import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import '../theme/app_theme.dart';
import '../models/call_session.dart';
import '../services/call_service.dart';
import '../services/callkit_service.dart';
import '../services/contact_resolver.dart';
import '../widgets/nt_ui.dart';
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

  // Real P0 bug found from physical-device testing: this screen used
  // PopScope(canPop: false) with no onPopInvokedWithResult, and every
  // internal dismissal path (_dismiss/_reject/error-path in _accept) called
  // Navigator.maybePop(). Per Flutter's own Navigator.maybePop() source,
  // when canPop is false and there's no override handler, that pop is
  // permanently swallowed -- the route is NEVER actually removed. Reject,
  // remote cancellation, and expiry-timeout all silently failed to close
  // this screen; only Accept worked, because it uses pushReplacement, which
  // doesn't go through the canPop gate at all. _allowPop flips to true only
  // immediately before a deliberate, code-initiated exit, so the OS back
  // button/gesture is still intercepted at all other times.
  bool _allowPop = false;

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

  /// Single owner of "actually leave this screen". PopScope's canPop is
  /// backed by a ValueNotifier that only picks up a new widget value inside
  /// didUpdateWidget -- i.e. on the *next rebuild*, not synchronously right
  /// after setState(). Popping in the same call stack as the setState()
  /// that flips _allowPop would still read the stale `false` and get
  /// swallowed again, same as the original bug. Waiting a frame first is
  /// what actually makes canPop's new value visible to the pop request.
  void _exitScreen() {
    _expiryTimer?.cancel();
    if (!mounted) return;
    if (ModalRoute.of(context)?.isCurrent != true) return;
    setState(() => _allowPop = true);
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) Navigator.of(context).pop();
    });
  }

  void _dismiss() {
    widget.callService.clearIncomingCall();
    _exitScreen();
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
          }
          _exitScreen();
          return;
        }
      } catch (_) {
        // Fall through to the error below.
      }
      if (mounted) {
        setState(() => _busy = false);
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(friendlyCallError(e))),
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
    _exitScreen();
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
    final initial = displayName.isNotEmpty && !displayName.startsWith('+') ? displayName.characters.first.toUpperCase() : null;
    return PopScope(
      canPop: _allowPop,
      child: AnnotatedRegion<SystemUiOverlayStyle>(
        value: SystemUiOverlayStyle.light,
        child: Scaffold(
          backgroundColor: AppColors.navy,
          body: DecoratedBox(
            decoration: const BoxDecoration(
              gradient: RadialGradient(center: Alignment(0, -0.35), radius: 1.1, colors: [Color(0xFF1B3A8C), AppColors.navy]),
            ),
            child: SafeArea(
              child: Column(
                children: [
                  const SizedBox(height: 24),
                  Row(mainAxisAlignment: MainAxisAlignment.center, children: [
                    Icon(session.isVideo ? Icons.videocam : Icons.call, color: const Color(0xB3FFFFFF), size: 16),
                    const SizedBox(width: 6),
                    Text(session.isVideo ? 'NeuraTalk video call' : 'NeuraTalk voice call',
                        style: const TextStyle(color: Color(0xB3FFFFFF), fontSize: 14, fontWeight: FontWeight.w500)),
                  ]),
                  const Spacer(flex: 2),
                  _PulseRing(
                    child: Container(
                      padding: const EdgeInsets.all(5),
                      decoration: const BoxDecoration(gradient: AppColors.brandGradient, shape: BoxShape.circle),
                      child: Container(
                        width: 128,
                        height: 128,
                        alignment: Alignment.center,
                        decoration: const BoxDecoration(color: AppColors.navySoft, shape: BoxShape.circle),
                        child: initial != null
                            ? Text(initial, style: const TextStyle(color: AppColors.onAccent, fontSize: 52, fontWeight: FontWeight.w700))
                            : const Icon(Icons.person, color: AppColors.onAccent, size: 60),
                      ),
                    ),
                  ),
                  const SizedBox(height: 28),
                  Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 24),
                    child: Text(displayName, textAlign: TextAlign.center, maxLines: 2,
                        style: const TextStyle(color: AppColors.onAccent, fontSize: 30, fontWeight: FontWeight.w800, letterSpacing: -0.3)),
                  ),
                  const SizedBox(height: 10),
                  const LiveBadge(onDark: true, label: 'Live translation on'),
                  const Spacer(flex: 3),
                  Padding(
                    padding: const EdgeInsets.fromLTRB(48, 0, 48, 40),
                    child: Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        _ActionButton(icon: Icons.call_end, color: AppColors.red, label: 'Decline', onTap: _busy ? null : _reject),
                        _ActionButton(
                          icon: session.isVideo ? Icons.videocam : Icons.call,
                          color: AppColors.green,
                          label: 'Accept',
                          busy: _busy,
                          onTap: _busy ? null : _accept,
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// Soft expanding rings behind the caller, so the screen reads as "ringing".
class _PulseRing extends StatefulWidget {
  final Widget child;
  const _PulseRing({required this.child});

  @override
  State<_PulseRing> createState() => _PulseRingState();
}

class _PulseRingState extends State<_PulseRing> with SingleTickerProviderStateMixin {
  late final AnimationController _c = AnimationController(vsync: this, duration: const Duration(milliseconds: 1800))..repeat();

  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: _c,
      child: widget.child,
      builder: (_, child) => Stack(alignment: Alignment.center, children: [
        for (final offset in [0.0, 0.5])
          Builder(builder: (_) {
            final t = (_c.value + offset) % 1;
            return Container(
              width: 138 + 90 * t,
              height: 138 + 90 * t,
              decoration: BoxDecoration(shape: BoxShape.circle, color: const Color(0xFF4F8DFF).withValues(alpha: 0.18 * (1 - t))),
            );
          }),
        child!,
      ]),
    );
  }
}

class _ActionButton extends StatelessWidget {
  final IconData icon;
  final Color color;
  final String label;
  final bool busy;
  final VoidCallback? onTap;
  const _ActionButton({required this.icon, required this.color, required this.label, required this.onTap, this.busy = false});

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        Material(
          color: color,
          shape: const CircleBorder(),
          child: InkWell(
            customBorder: const CircleBorder(),
            onTap: onTap,
            child: SizedBox(
              width: 76,
              height: 76,
              child: busy
                  ? const Padding(padding: EdgeInsets.all(24), child: CircularProgressIndicator(strokeWidth: 3, color: AppColors.onAccent))
                  : Icon(icon, color: AppColors.onAccent, size: 34, semanticLabel: label),
            ),
          ),
        ),
        const SizedBox(height: 10),
        Text(label, style: const TextStyle(color: Color(0xD9FFFFFF), fontSize: 15, fontWeight: FontWeight.w600)),
      ],
    );
  }
}
