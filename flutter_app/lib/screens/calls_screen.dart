import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../theme/app_theme.dart';
import '../services/api_service.dart';
import '../services/call_service.dart';
import 'call_screen.dart';
import 'transcript_history_screen.dart';
import 'face_to_face_screen.dart';
import 'transcript_detail_screen.dart';
import '../services/contact_resolver.dart';

class CallsScreen extends StatefulWidget {
  const CallsScreen({super.key});

  @override
  State<CallsScreen> createState() => _CallsScreenState();
}

class _CallsScreenState extends State<CallsScreen> with SingleTickerProviderStateMixin {
  late TabController _tabs;
  List<Map<String, dynamic>> _calls = [];
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _tabs = TabController(length: 2, vsync: this);
    ContactResolver.instance.ensureLoaded().then((_) {
      if (mounted) setState(() {});
    });
    _loadCalls();
  }

  // GET /api/calls/history returns { calls: [...] } with direction, outcome
  // and the other person's name/number for each call.
  Future<void> _loadCalls() async {
    try {
      final data = await ApiService.get('/api/calls/history?limit=100');
      final list = data is Map<String, dynamic> ? (data['calls'] as List? ?? const []) : (data as List? ?? const []);
      if (!mounted) return;
      setState(() {
        _calls = list.cast<Map<String, dynamic>>();
        _loading = false;
        _error = null;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _error = 'Could not load your calls. Pull down to try again.';
      });
    }
  }

  List<Map<String, dynamic>> get _missed => _calls.where((c) => c['outcome'] == 'missed').toList();

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(
        title: const Text('Calls'),
        actions: [
          IconButton(
            icon: Icon(Icons.description_outlined, color: AppColors.textSecondary),
            tooltip: 'Transcripts',
            onPressed: () => Navigator.push(
              context,
              MaterialPageRoute(builder: (_) => const TranscriptHistoryScreen()),
            ),
          ),
        ],
        bottom: TabBar(
          controller: _tabs,
          indicatorColor: AppColors.cyan,
          labelColor: AppColors.cyan,
          unselectedLabelColor: AppColors.textMuted,
          tabs: [const Tab(text: 'All'), Tab(text: _missed.isEmpty ? 'Missed' : 'Missed (${_missed.length})')],
        ),
      ),
      body: TabBarView(
        controller: _tabs,
        children: [
          _callList(_calls, showFaceToFace: true),
          _callList(_missed),
        ],
      ),
      floatingActionButton: FloatingActionButton.extended(
        heroTag: 'new-call',
        onPressed: _showNewCall,
        backgroundColor: AppColors.cyan,
        foregroundColor: AppColors.onAccent,
        icon: const Icon(Icons.dialpad),
        label: const Text('New call', style: TextStyle(fontWeight: FontWeight.w700)),
      ),
    );
  }

  Widget _faceToFaceCard() {
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 12, 16, 4),
      child: Material(
        color: AppColors.orange.withValues(alpha: 0.08),
        borderRadius: BorderRadius.circular(16),
        child: InkWell(
          borderRadius: BorderRadius.circular(16),
          onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => const FaceToFaceScreen())),
          child: Padding(
            padding: EdgeInsets.all(14),
            child: Row(
              children: [
                CircleAvatar(
                  radius: 24,
                  backgroundColor: AppColors.orange,
                  child: Icon(Icons.record_voice_over, color: AppColors.onAccent),
                ),
                SizedBox(width: 14),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text('Face to face', style: TextStyle(color: AppColors.ink, fontSize: 17, fontWeight: FontWeight.w700)),
                      SizedBox(height: 2),
                      Text('Talk with someone next to you, each in your own language',
                          style: TextStyle(color: AppColors.textSecondary, fontSize: 14)),
                    ],
                  ),
                ),
                Icon(Icons.chevron_right, color: AppColors.textMuted),
              ],
            ),
          ),
        ),
      ),
    );
  }

  Widget _callList(List<Map<String, dynamic>> calls, {bool showFaceToFace = false}) {
    final Widget content;
    if (_loading) {
      content = Padding(
        padding: EdgeInsets.only(top: 80),
        child: Center(child: CircularProgressIndicator(color: AppColors.cyan)),
      );
    } else if (_error != null || calls.isEmpty) {
      content = Padding(
        padding: const EdgeInsets.only(top: 64, left: 32, right: 32),
        child: Column(
          children: [
            Icon(_error != null ? Icons.wifi_off : Icons.call_outlined, color: AppColors.textMuted, size: 48),
            const SizedBox(height: 12),
            Text(
              _error ?? (showFaceToFace ? 'No calls yet. Tap New call to talk to anyone in their language.' : 'No missed calls'),
              textAlign: TextAlign.center,
              style: TextStyle(color: AppColors.textSecondary, fontSize: 15),
            ),
          ],
        ),
      );
    } else {
      content = Column(
        children: [
          for (var i = 0; i < calls.length; i++) ...[
            _CallTile(
              call: calls[i],
              onOpen: () {
                final callId = calls[i]['callId'];
                if (callId == null) return;
                Navigator.push(
                  context,
                  MaterialPageRoute(builder: (_) => TranscriptDetailScreen(callId: callId.toString())),
                );
              },
              onCallBack: (video) => _callBack(calls[i], video: video),
            ),
            if (i < calls.length - 1) Divider(color: AppColors.border, height: 1, indent: 76),
          ],
        ],
      );
    }
    return RefreshIndicator(
      onRefresh: _loadCalls,
      color: AppColors.cyan,
      child: ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.only(bottom: 96),
        children: [if (showFaceToFace) _faceToFaceCard(), content],
      ),
    );
  }

  Future<void> _callBack(Map<String, dynamic> call, {required bool video}) async {
    final target = (call['remotePhone'] ?? (call['direction'] == 'outgoing' ? call['calleeIdentifier'] : null))?.toString();
    if (target == null || target.isEmpty) return;
    final navigator = Navigator.of(context);
    final messenger = ScaffoldMessenger.of(context);
    final callService = context.read<CallService>();
    try {
      final session = await callService.startCall(calleeIdentifier: target, callType: video ? 'video' : 'voice');
      await navigator.push(MaterialPageRoute(builder: (_) => CallScreen(session: session, callService: callService)));
      if (mounted) _loadCalls();
    } catch (e) {
      messenger.showSnackBar(SnackBar(content: Text(friendlyCallError(e))));
    }
  }

  void _showNewCall() {
    showModalBottomSheet(
      context: context,
      backgroundColor: AppColors.surface,
      isScrollControlled: true,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(24))),
      builder: (_) => const _DialPad(),
    ).then((_) {
      if (mounted) _loadCalls();
    });
  }

  @override
  void dispose() {
    _tabs.dispose();
    super.dispose();
  }
}

class _CallTile extends StatelessWidget {
  final Map<String, dynamic> call;
  final VoidCallback onOpen;
  final void Function(bool video) onCallBack;
  const _CallTile({required this.call, required this.onOpen, required this.onCallBack});

  @override
  Widget build(BuildContext context) {
    final outcome = call['outcome']?.toString() ?? 'answered';
    final outgoing = call['direction'] == 'outgoing';
    final missed = outcome == 'missed';
    final video = call['callType'] == 'video';
    final phone = call['remotePhone']?.toString();
    final name = ContactResolver.instance.nameFor(phone) ?? call['remoteName']?.toString() ?? phone ?? 'Unknown';
    final IconData directionIcon = missed ? Icons.call_missed : outgoing ? Icons.call_made : Icons.call_received;
    final Color directionColor = missed || outcome == 'not_answered' ? AppColors.red : AppColors.green;
    final String label = missed
        ? 'Missed'
        : outcome == 'not_answered'
            ? 'No answer'
            : outgoing
                ? 'Outgoing'
                : 'Incoming';
    final duration = _formatDuration(call['durationSeconds']);
    final time = _formatTime(call['createdAt']?.toString() ?? '');
    final initial = name.trim().isEmpty || name.startsWith('+') || RegExp(r'^\d').hasMatch(name)
        ? null
        : name.trim().characters.first.toUpperCase();

    return ListTile(
      onTap: onOpen,
      contentPadding: const EdgeInsets.fromLTRB(16, 4, 8, 4),
      leading: CircleAvatar(
        radius: 24,
        backgroundColor: AppColors.cyan.withValues(alpha: 0.12),
        child: initial != null
            ? Text(initial, style: TextStyle(color: AppColors.cyan, fontSize: 18, fontWeight: FontWeight.w700))
            : Icon(Icons.person, color: AppColors.cyan),
      ),
      title: Text(
        name,
        maxLines: 1,
        overflow: TextOverflow.ellipsis,
        style: TextStyle(color: missed ? AppColors.red : AppColors.ink, fontWeight: FontWeight.w600),
      ),
      subtitle: Row(
        children: [
          Icon(directionIcon, size: 16, color: directionColor),
          const SizedBox(width: 4),
          Flexible(
            child: Text(
              [label, if (duration != null) duration, time].join(' · '),
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: TextStyle(color: AppColors.textSecondary, fontSize: 14),
            ),
          ),
        ],
      ),
      trailing: IconButton(
        tooltip: video ? 'Video call back' : 'Call back',
        icon: Icon(video ? Icons.videocam_outlined : Icons.call_outlined, color: AppColors.cyan),
        onPressed: () => onCallBack(video),
      ),
    );
  }

  static String? _formatDuration(dynamic raw) {
    final seconds = raw is num ? raw.toInt() : int.tryParse(raw?.toString() ?? '');
    if (seconds == null || seconds <= 0) return null;
    final m = seconds ~/ 60, s = seconds % 60;
    return m > 0 ? '${m}m ${s.toString().padLeft(2, '0')}s' : '${s}s';
  }

  static String _formatTime(String raw) {
    if (raw.isEmpty) return '';
    final dt = DateTime.tryParse(raw)?.toLocal();
    if (dt == null) return '';
    final now = DateTime.now();
    final today = DateTime(now.year, now.month, now.day);
    final day = DateTime(dt.year, dt.month, dt.day);
    final hour12 = dt.hour % 12 == 0 ? 12 : dt.hour % 12;
    final clock = '$hour12:${dt.minute.toString().padLeft(2, '0')} ${dt.hour < 12 ? 'AM' : 'PM'}';
    final diff = today.difference(day).inDays;
    if (diff == 0) return clock;
    if (diff == 1) return 'Yesterday';
    if (diff < 7) return const ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][dt.weekday - 1];
    return '${dt.day}/${dt.month}/${dt.year % 100}';
  }
}

class _DialPad extends StatefulWidget {
  const _DialPad();

  @override
  State<_DialPad> createState() => _DialPadState();
}

class _DialPadState extends State<_DialPad> {
  String _digits = ''; // raw digits only, no formatting/country code
  bool _calling = false;
  String? _validationError;

  void _press(String v) {
    if (_calling) return;
    setState(() {
      _digits += v;
      _validationError = null;
    });
  }

  void _delete() {
    if (_calling || _digits.isEmpty) return;
    setState(() {
      _digits = _digits.substring(0, _digits.length - 1);
      _validationError = null;
    });
  }

  void _clear() {
    if (_calling) return;
    setState(() {
      _digits = '';
      _validationError = null;
    });
  }

  /// Formats raw digits as a readable Indian-style number with a +91
  /// prefix once it's at least a national-length number, e.g.
  /// "8143752025" -> "+91 81437 52025". Not a strict E.164 validator —
  /// just a display aid; validation happens separately in [_validate].
  String get _displayNumber {
    if (_digits.isEmpty) return '';
    var d = _digits;
    var prefix = '+91 ';
    if (d.startsWith('91') && d.length > 10) {
      d = d.substring(2);
    } else if (d.startsWith('0') && d.length > 10) {
      d = d.substring(1);
    }
    if (d.length <= 10) {
      if (d.length > 5) return '$prefix${d.substring(0, 5)} ${d.substring(5)}';
      return '$prefix$d';
    }
    return '+$d';
  }

  /// True if this looks like a phone number (digits only) rather than a
  /// username/identifier — usernames go through search, not the dial pad.
  String? _validate() {
    if (_digits.isEmpty) return 'Enter a number to call.';
    if (_digits.length < 6) return 'Invalid phone number.';
    if (_digits.length > 15) return 'Invalid phone number.';
    return null;
  }

  Future<void> _call({required bool video}) async {
    if (_calling) return;
    final error = _validate();
    if (error != null) {
      setState(() => _validationError = error);
      return;
    }
    setState(() {
      _calling = true;
      _validationError = null;
    });

    final navigator = Navigator.of(context);
    final messenger = ScaffoldMessenger.of(context);
    final callService = context.read<CallService>();

    try {
      final session = await callService.startCall(
        calleeIdentifier: _digits,
        callType: video ? 'video' : 'voice',
      );
      navigator.pop();
      navigator.push(MaterialPageRoute(
        builder: (_) => CallScreen(session: session, callService: callService),
      ));
    } catch (e) {
      if (!mounted) return;
      setState(() => _calling = false);
      messenger.showSnackBar(SnackBar(content: Text(friendlyCallError(e))));
    }
  }

  @override
  Widget build(BuildContext context) {
    return SafeArea(
      top: false,
      child: Padding(
        padding: const EdgeInsets.fromLTRB(24, 12, 24, 24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Row(
              children: [
                IconButton(
                  icon: Icon(Icons.close, color: AppColors.textMuted),
                  tooltip: 'Close',
                  onPressed: _calling ? null : () => Navigator.of(context).maybePop(),
                ),
                Expanded(
                  child: Text(
                    'New call',
                    textAlign: TextAlign.center,
                    style: TextStyle(color: AppColors.textSecondary, fontSize: 13, fontWeight: FontWeight.w600),
                  ),
                ),
                const SizedBox(width: 48), // balances the close icon so the title stays centered
              ],
            ),
            const SizedBox(height: 8),
            Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Flexible(
                  child: Text(
                    _digits.isEmpty ? 'Enter number' : _displayNumber,
                    style: TextStyle(color: _digits.isEmpty ? AppColors.textMuted : AppColors.ink, fontSize: 26, fontWeight: FontWeight.w600),
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
                if (_digits.isNotEmpty)
                  GestureDetector(
                    onTap: _delete,
                    onLongPress: _clear,
                    child: Padding(
                      padding: EdgeInsets.only(left: 10),
                      child: Icon(Icons.backspace_outlined, color: AppColors.textMuted, size: 20),
                    ),
                  ),
              ],
            ),
            if (_validationError != null) ...[
              const SizedBox(height: 6),
              Text(_validationError!, style: const TextStyle(color: AppColors.red, fontSize: 12)),
            ],
            const SizedBox(height: 20),
            for (final row in [['1','2','3'],['4','5','6'],['7','8','9'],['*','0','#']])
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceEvenly,
                children: row.map((d) => _DialButton(digit: d, onTap: () => _press(d))).toList(),
              ),
            const SizedBox(height: 20),
            if (_calling)
              Padding(
                padding: EdgeInsets.all(18),
                child: SizedBox(width: 32, height: 32, child: CircularProgressIndicator(strokeWidth: 3, color: AppColors.cyan)),
              )
            else
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceEvenly,
                children: [
                  _CallButton(icon: Icons.call, label: 'Voice', color: AppColors.cyan, onTap: () => _call(video: false)),
                  _CallButton(icon: Icons.videocam, label: 'Video', color: AppColors.blue, onTap: () => _call(video: true)),
                ],
              ),
            const SizedBox(height: 4),
          ],
        ),
      ),
    );
  }
}

class _CallButton extends StatelessWidget {
  final IconData icon;
  final String label;
  final Color color;
  final VoidCallback onTap;
  const _CallButton({required this.icon, required this.label, required this.color, required this.onTap});

  @override
  Widget build(BuildContext context) {
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        Material(
          color: color,
          shape: const CircleBorder(),
          child: InkWell(
            customBorder: const CircleBorder(),
            onTap: onTap,
            child: Padding(padding: const EdgeInsets.all(18), child: Icon(icon, color: AppColors.onAccent, size: 30)),
          ),
        ),
        const SizedBox(height: 6),
        Text(label, style: TextStyle(color: AppColors.textSecondary, fontSize: 14, fontWeight: FontWeight.w600)),
      ],
    );
  }
}

class _DialButton extends StatelessWidget {
  final String digit;
  final VoidCallback onTap;
  const _DialButton({required this.digit, required this.onTap});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6, horizontal: 8),
      child: Material(
        color: AppColors.surfaceElevated,
        shape: const CircleBorder(),
        child: InkWell(
          customBorder: const CircleBorder(),
          onTap: onTap,
          child: SizedBox(
            width: 72,
            height: 72,
            child: Center(child: Text(digit, style: TextStyle(color: AppColors.ink, fontSize: 26, fontWeight: FontWeight.w500))),
          ),
        ),
      ),
    );
  }
}
