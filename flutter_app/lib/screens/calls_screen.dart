import 'package:flutter/material.dart';
import '../theme/app_theme.dart';
import '../services/api_service.dart';

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
          IconButton(icon: const Icon(Icons.settings_outlined, color: AppColors.textSecondary), onPressed: () {}),
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
      itemBuilder: (_, i) => _CallTile(call: calls[i]),
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
  const _CallTile({required this.call});

  @override
  Widget build(BuildContext context) {
    final missed = call['status'] == 'missed';
    final number = call['remoteIdentifier'] ?? call['toNumber'] ?? call['fromNumber'] ?? 'Unknown';
    final time = _formatTime(call['createdAt'] ?? call['startedAt'] ?? '');
    final type = call['callType'] == 'video' ? 'video' : 'voice';
    return ListTile(
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
  String _number = '';

  void _press(String v) => setState(() => _number += v);
  void _delete() => setState(() => _number = _number.isNotEmpty ? _number.substring(0, _number.length - 1) : '');

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.all(24),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(_number.isEmpty ? 'Enter number' : _number, style: TextStyle(color: _number.isEmpty ? AppColors.textMuted : AppColors.white, fontSize: 28, fontWeight: FontWeight.w600)),
          const SizedBox(height: 24),
          for (final row in [['1','2','3'],['4','5','6'],['7','8','9'],['*','0','#']])
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceEvenly,
              children: row.map((d) => _DialButton(digit: d, onTap: () => _press(d))).toList(),
            ),
          const SizedBox(height: 16),
          Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              IconButton(icon: const Icon(Icons.backspace_outlined, color: AppColors.textMuted), onPressed: _delete),
              const SizedBox(width: 24),
              GestureDetector(
                onTap: () => Navigator.pop(context),
                child: Container(
                  padding: const EdgeInsets.all(18),
                  decoration: BoxDecoration(color: widget.video ? AppColors.blue : AppColors.cyan, shape: BoxShape.circle),
                  child: Icon(widget.video ? Icons.videocam : Icons.call, color: AppColors.background, size: 28),
                ),
              ),
            ],
          ),
          const SizedBox(height: 8),
        ],
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
