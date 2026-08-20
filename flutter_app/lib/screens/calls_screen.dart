import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../theme/app_theme.dart';
import '../services/api_service.dart';
import '../services/call_service.dart';
import 'call_screen.dart';
import 'transcript_history_screen.dart';
import 'transcript_detail_screen.dart';

class CallsScreen extends StatefulWidget {
  const CallsScreen({super.key});

  @override
  State<CallsScreen> createState() => _CallsScreenState();
}

class _CallsScreenState extends State<CallsScreen> with SingleTickerProviderStateMixin {
  late TabController _tabs;
  List<Map<String, dynamic>> _calls = [];
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _tabs = TabController(length: 2, vsync: this);
    _loadCalls();
  }

  Future<void> _loadCalls() async {
    try {
      final data = await ApiService.get('/api/calls/history') as List;
      setState(() {
        _calls = data.cast<Map<String, dynamic>>();
        _loading = false;
      });
    } catch (_) {
      setState(() => _loading = false);
    }
  }

  List<Map<String, dynamic>> get _missed => _calls.where((c) => c['status'] == 'missed').toList();

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(
        title: const Text('Call Translator'),
        actions: [
          IconButton(
            icon: const Icon(Icons.description_outlined, color: AppColors.textSecondary),
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
          tabs: const [Tab(text: 'All'), Tab(text: 'Missed')],
        ),
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator(color: AppColors.cyan))
          : TabBarView(
              controller: _tabs,
              children: [
                _callList(_calls),
                _callList(_missed),
              ],
            ),
      floatingActionButton: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          FloatingActionButton(
            heroTag: 'video',
            onPressed: _startVideoCall,
            backgroundColor: AppColors.blue,
            child: const Icon(Icons.videocam),
          ),
          const SizedBox(height: 12),
          FloatingActionButton(
            heroTag: 'voice',
            onPressed: _startVoiceCall,
            backgroundColor: AppColors.cyan,
            foregroundColor: AppColors.background,
            child: const Icon(Icons.grid_view),
          ),
        ],
      ),
    );
  }

  Widget _callList(List<Map<String, dynamic>> calls) {
    if (calls.isEmpty) {
      return const Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(Icons.call_outlined, color: AppColors.textMuted, size: 48),
            SizedBox(height: 12),
            Text('No calls yet', style: TextStyle(color: AppColors.textMuted)),
          ],
        ),
      );
    }
    return ListView.separated(
      itemCount: calls.length,
      separatorBuilder: (_, __) => const Divider(color: AppColors.border, height: 1, indent: 72),
      itemBuilder: (_, i) => _CallTile(
        call: calls[i],
        onTap: () {
          final callId = calls[i]['id'];
          if (callId == null) return;
          Navigator.push(
            context,
            MaterialPageRoute(builder: (_) => TranscriptDetailScreen(callId: callId.toString())),
          );
        },
      ),
    );
  }

  void _startVoiceCall() {
    _showDialPad();
  }

  void _startVideoCall() {
    _showDialPad(video: true);
  }

  void _showDialPad({bool video = false}) {
    showModalBottomSheet(
      context: context,
      backgroundColor: AppColors.surface,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(24))),
      builder: (_) => _DialPad(video: video),
    );
  }

  @override
  void dispose() {
    _tabs.dispose();
    super.dispose();
  }
}

class _CallTile extends StatelessWidget {
  final Map<String, dynamic> call;
  final VoidCallback? onTap;
  const _CallTile({required this.call, this.onTap});

  @override
  Widget build(BuildContext context) {
    final missed = call['status'] == 'missed';
    final number = call['remoteIdentifier'] ?? call['toNumber'] ?? call['fromNumber'] ?? 'Unknown';
    final time = _formatTime(call['createdAt'] ?? call['startedAt'] ?? '');
    final type = call['callType'] == 'video' ? 'video' : 'voice';
    return ListTile(
      onTap: onTap,
      leading: Container(
        width: 44,
        height: 44,
        decoration: BoxDecoration(
          color: missed ? AppColors.red.withOpacity(0.1) : AppColors.green.withOpacity(0.1),
          shape: BoxShape.circle,
        ),
        child: Icon(
          missed ? Icons.call_missed : Icons.call_made,
          color: missed ? AppColors.red : AppColors.green,
          size: 20,
        ),
      ),
      title: Text(number, style: const TextStyle(color: AppColors.textPrimary, fontWeight: FontWeight.w600)),
      subtitle: Text('${missed ? "missed" : "completed"} · $time', style: const TextStyle(color: AppColors.textMuted, fontSize: 12)),
      trailing: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(type == 'video' ? Icons.videocam_outlined : Icons.call_outlined, color: AppColors.textMuted, size: 18),
          const SizedBox(width: 4),
          const Icon(Icons.chevron_right, color: AppColors.textMuted),
        ],
      ),
    );
  }

  String _formatTime(String raw) {
    if (raw.isEmpty) return '';
    try {
      final dt = DateTime.parse(raw).toLocal();
      final now = DateTime.now();
      if (dt.day == now.day) return '${dt.hour.toString().padLeft(2, '0')}:${dt.minute.toString().padLeft(2, '0')} ${dt.hour < 12 ? 'AM' : 'PM'}';
      if (now.difference(dt).inDays == 1) return 'Yesterday';
      final days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
      return days[dt.weekday - 1];
    } catch (_) {
      return '';
    }
  }
}

class _DialPad extends StatefulWidget {
  final bool video;
  const _DialPad({this.video = false});

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

  Future<void> _call() async {
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
        callType: widget.video ? 'video' : 'voice',
      );
      navigator.pop();
      navigator.push(MaterialPageRoute(
        builder: (_) => CallScreen(session: session, callService: callService),
      ));
    } catch (e) {
      if (!mounted) return;
      setState(() => _calling = false);
      messenger.showSnackBar(SnackBar(content: Text(_friendlyCallError(e))));
    }
  }

  String _friendlyCallError(Object e) {
    if (e is CallServiceException) return e.message;
    if (e is! ApiException) return 'Could not start the call. Please try again.';

    switch (e.code) {
      case 'LIVEKIT_UNAVAILABLE':
        return 'Calling is temporarily unavailable. Please try again shortly.';
      case 'PSTN_NOT_CONFIGURED':
        return 'Calling mobile numbers is not available right now.';
    }

    // No dedicated error code for balance/subscription failures — the
    // backend returns the raw reason string as `message` in that case
    // (server/modules/calls/controller.ts respondWithInitiateError,
    // generic 500 fallback branch).
    final reason = e.message.toUpperCase();
    if (reason.contains('BALANCE') || reason.contains('SUBSCRIPTION') || reason.contains('CREDIT_LIMIT') || reason.contains('PAYMENT_REQUIRED')) {
      return 'Insufficient balance or subscription to place this call.';
    }

    return 'Could not start the call. Please try again.';
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
                  icon: const Icon(Icons.close, color: AppColors.textMuted),
                  tooltip: 'Close',
                  onPressed: _calling ? null : () => Navigator.of(context).maybePop(),
                ),
                Expanded(
                  child: Text(
                    widget.video ? 'New video call' : 'New voice call',
                    textAlign: TextAlign.center,
                    style: const TextStyle(color: AppColors.textSecondary, fontSize: 13, fontWeight: FontWeight.w600),
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
                    style: TextStyle(color: _digits.isEmpty ? AppColors.textMuted : AppColors.white, fontSize: 26, fontWeight: FontWeight.w600),
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
                if (_digits.isNotEmpty)
                  GestureDetector(
                    onTap: _delete,
                    onLongPress: _clear,
                    child: const Padding(
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
            GestureDetector(
              onTap: _call,
              child: Container(
                padding: const EdgeInsets.all(20),
                decoration: BoxDecoration(color: widget.video ? AppColors.blue : AppColors.cyan, shape: BoxShape.circle),
                child: _calling
                    ? const SizedBox(
                        width: 28,
                        height: 28,
                        child: CircularProgressIndicator(strokeWidth: 2.5, color: AppColors.background),
                      )
                    : Icon(widget.video ? Icons.videocam : Icons.call, color: AppColors.background, size: 30),
              ),
            ),
            const SizedBox(height: 4),
          ],
        ),
      ),
    );
  }
}

class _DialButton extends StatelessWidget {
  final String digit;
  final VoidCallback onTap;
  const _DialButton({required this.digit, required this.onTap});

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: Container(
        margin: const EdgeInsets.symmetric(vertical: 8, horizontal: 8),
        width: 72,
        height: 72,
        decoration: BoxDecoration(color: AppColors.surfaceElevated, shape: BoxShape.circle),
        alignment: Alignment.center,
        child: Text(digit, style: const TextStyle(color: AppColors.white, fontSize: 24, fontWeight: FontWeight.w500)),
      ),
    );
  }
}
