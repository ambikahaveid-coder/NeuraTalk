import 'dart:async';

import 'package:flutter/material.dart';

import '../screens/assistant_screen.dart';
import '../services/api_service.dart';
import '../theme/app_theme.dart';
import 'business_chat_extras.dart' show rupeesText;

/// "My AI assistant" at the top of Chats, so people find it without digging in
/// Settings: try it free, switch it on/off, mark yourself busy, see what it took
/// for you, and renew when the trial ends. Taps open the full assistant screen.
class AssistantChatCard extends StatefulWidget {
  const AssistantChatCard({super.key});

  @override
  State<AssistantChatCard> createState() => AssistantChatCardState();
}

class AssistantChatCardState extends State<AssistantChatCard> {
  Map<String, dynamic>? _data;
  bool _busy = false;

  Map get _s => (_data?['settings'] as Map?) ?? const {};
  Map get _access => (_data?['access'] as Map?) ?? const {};
  Map get _plan => (_data?['plan'] as Map?) ?? const {};

  @override
  void initState() {
    super.initState();
    reload();
  }

  Future<void> reload() async {
    try {
      final res = await ApiService.get('/api/assistant');
      if (mounted && res is Map) setState(() => _data = Map<String, dynamic>.from(res));
    } catch (_) {
      // Quietly hidden if it can't load; Settings still has it.
    }
  }

  Future<void> _open() async {
    await Navigator.push(context, MaterialPageRoute(builder: (_) => const AssistantScreen()));
    unawaited(reload());
  }

  Future<void> _set(Map<String, dynamic> body, {String? path, bool put = true}) async {
    if (_busy) return;
    setState(() => _busy = true);
    try {
      if (put) {
        await ApiService.put(path ?? '/api/assistant', body);
      } else {
        await ApiService.post(path!, body);
      }
      await reload();
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e is ApiException ? e.message : 'Could not change it. Try again.')));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  DateTime? _date(Object? raw) => DateTime.tryParse('${raw ?? ''}')?.toLocal();

  String _clock(DateTime d) => '${d.hour.toString().padLeft(2, '0')}:${d.minute.toString().padLeft(2, '0')}';

  @override
  Widget build(BuildContext context) {
    if (_data == null) return const SizedBox.shrink();
    final enabled = _s['enabled'] == true;
    final status = '${_access['status'] ?? ''}';
    final price = rupeesText((_plan['pricePaise'] as num?) ?? 9900);
    final trialDays = (_plan['trialDays'] as num?)?.toInt() ?? 7;
    final unread = (_data?['unread'] as num?)?.toInt() ?? 0;
    final busyUntil = _date(_s['busyUntil']);
    final isBusy = enabled && busyUntil != null && busyUntil.isAfter(DateTime.now());
    final expired = status == 'expired';
    final started = status == 'trial' || status == 'active' || expired || status == 'paused';

    // One clear line about where things stand.
    String line;
    Color lineColor = AppColors.textSecondary;
    if (status == 'paused') {
      line = 'Paused by NeuraTalk · tap for details';
    } else if (expired) {
      line = 'Free trial ended · renew for $price a month';
      lineColor = AppColors.orange;
    } else if (!enabled) {
      line = started ? 'Off · answers chats and calls when you are busy' : 'Answers chats and calls when you are busy · $trialDays days free';
    } else if (isBusy) {
      line = 'Answering for you until ${_clock(busyUntil)}';
      lineColor = AppColors.green;
    } else if (status == 'trial') {
      final end = _date(_access['trialEndsAt']);
      final left = end == null ? null : (end.difference(DateTime.now()).inHours / 24).ceil().clamp(0, 99);
      line = left == null ? 'On · free trial' : 'On · free trial, $left day${left == 1 ? '' : 's'} left';
      lineColor = AppColors.green;
    } else {
      line = 'On · takes calls you miss';
      lineColor = AppColors.green;
    }

    Widget action;
    if (!started && !enabled) {
      action = FilledButton(
        onPressed: _busy ? null : () => _set({'enabled': true, 'chatEnabled': true, 'callsEnabled': true}),
        style: FilledButton.styleFrom(backgroundColor: AppColors.cyan, visualDensity: VisualDensity.compact),
        child: const Text('Try free'),
      );
    } else if (expired) {
      action = FilledButton(
        onPressed: _open,
        style: FilledButton.styleFrom(backgroundColor: AppColors.orange, visualDensity: VisualDensity.compact),
        child: const Text('Renew'),
      );
    } else if (status == 'paused') {
      action = const SizedBox.shrink();
    } else {
      action = Switch(
        value: enabled,
        activeTrackColor: AppColors.cyan,
        onChanged: _busy ? null : (v) => _set({'enabled': v}),
      );
    }

    return Padding(
      padding: const EdgeInsets.fromLTRB(12, 2, 12, 8),
      child: Material(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(18),
        child: InkWell(
          borderRadius: BorderRadius.circular(18),
          onTap: _open,
          child: Container(
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(18),
              border: Border.all(color: enabled ? AppColors.cyan.withValues(alpha: 0.35) : AppColors.border),
            ),
            padding: const EdgeInsets.fromLTRB(12, 10, 8, 10),
            child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
              Row(children: [
                _RobotAvatar(active: enabled && !expired, badge: unread),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Row(children: [
                      Flexible(
                        child: Text('My AI assistant', maxLines: 1, overflow: TextOverflow.ellipsis,
                            style: TextStyle(color: AppColors.ink, fontWeight: FontWeight.w700, fontSize: 15.5)),
                      ),
                      const SizedBox(width: 6),
                      Container(
                        padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 1),
                        decoration: BoxDecoration(color: AppColors.blueTint, borderRadius: BorderRadius.circular(6)),
                        child: Text('AI', style: TextStyle(color: AppColors.cyan, fontSize: 10.5, fontWeight: FontWeight.w800)),
                      ),
                    ]),
                    const SizedBox(height: 2),
                    Text(line, maxLines: 2, overflow: TextOverflow.ellipsis, style: TextStyle(color: lineColor, fontSize: 13)),
                  ]),
                ),
                action,
              ]),
              // Quick "I'm busy" while it's on (the main reason to open it).
              if (enabled && !expired && status != 'paused')
                Padding(
                  padding: const EdgeInsets.only(left: 56, top: 6),
                  child: SingleChildScrollView(
                    scrollDirection: Axis.horizontal,
                    child: Row(children: [
                      if (isBusy)
                        _Chip(icon: Icons.check_circle_outline, label: "I'm back", onTap: _busy ? null : () => _set({'minutes': 0}, path: '/api/assistant/busy', put: false))
                      else ...[
                        _Chip(icon: Icons.do_not_disturb_on_outlined, label: 'Busy 1 hour', onTap: _busy ? null : () => _set({'minutes': 60}, path: '/api/assistant/busy', put: false)),
                        _Chip(icon: Icons.nightlight_outlined, label: 'Until tonight', onTap: _busy ? null : () => _set({'minutes': 8 * 60}, path: '/api/assistant/busy', put: false)),
                      ],
                      if (unread > 0) _Chip(icon: Icons.mark_chat_unread_outlined, label: '$unread message${unread == 1 ? '' : 's'} taken', onTap: _open, strong: true),
                    ]),
                  ),
                ),
            ]),
          ),
        ),
      ),
    );
  }
}

class _RobotAvatar extends StatelessWidget {
  const _RobotAvatar({required this.active, required this.badge});
  final bool active;
  final int badge;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: 46,
      height: 46,
      child: Stack(clipBehavior: Clip.none, children: [
        Container(
          width: 46,
          height: 46,
          decoration: BoxDecoration(
            shape: BoxShape.circle,
            gradient: active
                ? AppColors.brandGradient
                : LinearGradient(colors: [AppColors.textMuted.withValues(alpha: 0.5), AppColors.textMuted.withValues(alpha: 0.3)]),
          ),
          alignment: Alignment.center,
          child: const Icon(Icons.smart_toy_outlined, color: AppColors.onAccent, size: 26),
        ),
        if (active)
          Positioned(
            right: 0,
            bottom: 0,
            child: Container(
              width: 13,
              height: 13,
              decoration: BoxDecoration(color: AppColors.green, shape: BoxShape.circle, border: Border.all(color: AppColors.surface, width: 2)),
            ),
          ),
        if (badge > 0)
          Positioned(
            right: -4,
            top: -4,
            child: Container(
              padding: const EdgeInsets.symmetric(horizontal: 5, vertical: 1),
              constraints: const BoxConstraints(minWidth: 18),
              decoration: BoxDecoration(color: AppColors.red, borderRadius: BorderRadius.circular(9)),
              child: Text(badge > 99 ? '99+' : '$badge', textAlign: TextAlign.center,
                  style: const TextStyle(color: Colors.white, fontSize: 10.5, fontWeight: FontWeight.w700)),
            ),
          ),
      ]),
    );
  }
}

class _Chip extends StatelessWidget {
  const _Chip({required this.icon, required this.label, this.onTap, this.strong = false});
  final IconData icon;
  final String label;
  final VoidCallback? onTap;
  final bool strong;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(right: 6),
      child: ActionChip(
        visualDensity: VisualDensity.compact,
        avatar: Icon(icon, size: 16, color: strong ? AppColors.onAccent : AppColors.cyan),
        label: Text(label, style: TextStyle(fontSize: 12.5, color: strong ? AppColors.onAccent : AppColors.ink)),
        backgroundColor: strong ? AppColors.cyan : AppColors.background,
        side: BorderSide(color: strong ? AppColors.cyan : AppColors.border),
        onPressed: onTap,
      ),
    );
  }
}
