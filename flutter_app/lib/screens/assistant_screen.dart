import 'package:flutter/material.dart';
import 'package:flutter/services.dart' show Clipboard, ClipboardData;
import 'package:url_launcher/url_launcher.dart';
import '../services/api_service.dart';
import '../theme/app_theme.dart';
import '../widgets/business_chat_extras.dart' show rupeesText;
import '../widgets/nt_ui.dart';
import 'voice_clone_screen.dart';

/// "My AI assistant" (server/ai-assistant.ts): answers chats and calls for you
/// when you are busy, says it is your assistant, takes the message.
class AssistantScreen extends StatefulWidget {
  const AssistantScreen({super.key});

  @override
  State<AssistantScreen> createState() => _AssistantScreenState();
}

class _AssistantScreenState extends State<AssistantScreen> {
  Map<String, dynamic>? _data;
  String? _error;
  bool _saving = false;
  final _name = TextEditingController();
  final _instructions = TextEditingController();

  Map get _s => (_data?['settings'] as Map?) ?? const {};
  Map get _access => (_data?['access'] as Map?) ?? const {};
  Map get _plan => (_data?['plan'] as Map?) ?? const {};

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _name.dispose();
    _instructions.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final res = await ApiService.get('/api/assistant') as Map<String, dynamic>;
      if (!mounted) return;
      setState(() {
        _data = res;
        _error = null;
        _name.text = '${(res['settings'] as Map)['assistantName'] ?? ''}';
        _instructions.text = '${(res['settings'] as Map)['instructions'] ?? ''}';
      });
    } catch (e) {
      if (mounted) setState(() => _error = e is ApiException ? e.message : 'Could not load your assistant.');
    }
  }

  Future<void> _save(Map<String, dynamic> change) async {
    setState(() => _saving = true);
    try {
      final res = await ApiService.put('/api/assistant', change);
      if (mounted) setState(() => _data = {..._data ?? {}, ...res});
    } catch (e) {
      if (!mounted) return;
      if (e is ApiException && e.code == 'NO_OWN_VOICE') {
        final go = await showDialog<bool>(
          context: context,
          builder: (d) => AlertDialog(
            title: const Text('Record your voice first'),
            content: const Text('Your assistant can speak in your own voice after you record it once.'),
            actions: [
              TextButton(onPressed: () => Navigator.pop(d, false), child: const Text('Not now')),
              FilledButton(onPressed: () => Navigator.pop(d, true), child: const Text('Record my voice')),
            ],
          ),
        );
        if (go == true && mounted) Navigator.push(context, MaterialPageRoute(builder: (_) => const VoiceCloneScreen()));
      } else {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e is ApiException ? e.message : 'Could not save.')));
      }
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  Future<void> _busy(int minutes) async {
    try {
      final res = await ApiService.post('/api/assistant/busy', {'minutes': minutes});
      if (mounted) setState(() => _data = {..._data ?? {}, ...res});
    } catch (_) {}
  }

  String _busyLabel() {
    final until = DateTime.tryParse('${_s['busyUntil'] ?? ''}')?.toLocal();
    if (until == null || until.isBefore(DateTime.now())) return 'Not busy';
    // Same day: "Busy until 14:30"; past midnight: "Busy until tomorrow 02:30".
    final now = DateTime.now();
    final day = until.day == now.day && until.month == now.month ? '' : 'tomorrow ';
    return 'Busy until $day${until.hour.toString().padLeft(2, '0')}:${until.minute.toString().padLeft(2, '0')}';
  }

  Future<void> _pay() async {
    final payTo = (_data?['payTo'] as Map?) ?? const {};
    final upi = '${payTo['upiId'] ?? ''}';
    final price = (_plan['pricePaise'] as num?) ?? 9900;
    final ref = TextEditingController();
    final ok = await showDialog<bool>(
      context: context,
      builder: (d) => AlertDialog(
        title: Text('Pay ${rupeesText(price)} for 30 days'),
        content: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
          if (upi.isNotEmpty) ...[
            Text('1. Pay ${rupeesText(price)} to NeuraTalk\'s UPI ID:', style: TextStyle(color: AppColors.textSecondary)),
            Row(children: [
              Expanded(child: SelectableText(upi, style: TextStyle(color: AppColors.ink, fontWeight: FontWeight.w700))),
              IconButton(icon: const Icon(Icons.copy, size: 18), tooltip: 'Copy', onPressed: () => Clipboard.setData(ClipboardData(text: upi))),
            ]),
            TextButton.icon(
              icon: const Icon(Icons.payment),
              label: const Text('Open UPI app'),
              onPressed: () => launchUrl(Uri(scheme: 'upi', host: 'pay', queryParameters: {'pa': upi, 'pn': '${payTo['payeeName'] ?? 'NeuraTalk'}', 'am': (price / 100).toStringAsFixed(2), 'cu': 'INR', 'tn': 'NeuraTalk Assistant'}), mode: LaunchMode.externalApplication),
            ),
            Text('2. Enter the UTR (12-digit number) from your UPI app:', style: TextStyle(color: AppColors.textSecondary)),
          ] else
            Text('NeuraTalk will share the UPI ID on the support page. Enter the UTR after paying.', style: TextStyle(color: AppColors.textSecondary)),
          TextField(controller: ref, decoration: const InputDecoration(labelText: 'UTR / reference')),
          const SizedBox(height: 6),
          Text('NeuraTalk checks the payment, usually within a few hours.', style: TextStyle(color: AppColors.textMuted, fontSize: 12.5)),
        ]),
        actions: [
          TextButton(onPressed: () => Navigator.pop(d, false), child: const Text('Cancel')),
          FilledButton(onPressed: () => Navigator.pop(d, true), child: const Text('Send')),
        ],
      ),
    );
    if (ok != true) return;
    try {
      await ApiService.post('/api/assistant/payments', {'reference': ref.text.trim()});
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Thanks! NeuraTalk will confirm your payment soon.')));
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e is ApiException ? e.message : 'Could not send.')));
    }
  }

  String _planText() {
    final st = '${_access['status']}';
    final left = ((_access['voiceSecondsLeft'] as num?) ?? 0) ~/ 60;
    final price = rupeesText((_plan['pricePaise'] as num?) ?? 9900);
    String date(String k) {
      final d = DateTime.tryParse('${_access[k] ?? ''}')?.toLocal();
      return d == null ? '' : '${d.day}/${d.month}/${d.year}';
    }
    return switch (st) {
      'trial' => 'Free trial until ${date('trialEndsAt')} · $left call minutes left',
      'active' => 'Paid until ${date('periodEnd')} · $left call minutes left this month',
      'expired' => 'Your free trial or plan has ended. $price a month to keep it.',
      'paused' => 'Paused by NeuraTalk. Write to support@mindwhile.com.',
      _ => '${_plan['trialDays'] ?? 7} days free, then $price a month: unlimited chat replies and ${_plan['voiceMinutes'] ?? 60} call minutes.',
    };
  }

  @override
  Widget build(BuildContext context) {
    final enabled = _s['enabled'] == true;
    final unread = (_data?['unread'] as num?)?.toInt() ?? 0;
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(title: const Text('My AI assistant')),
      body: _error != null
          ? NtEmptyState(icon: Icons.wifi_off, title: "Couldn't load", message: _error!, error: true)
          : _data == null
              ? Center(child: CircularProgressIndicator(color: AppColors.cyan))
              : RefreshIndicator(
                  onRefresh: _load,
                  child: ListView(padding: const EdgeInsets.only(bottom: 40), children: [
                    Padding(
                      padding: const EdgeInsets.fromLTRB(20, 16, 20, 4),
                      child: Text(
                        'When you are busy, your assistant answers messages and calls for you. It says it is your AI assistant (never pretends to be you), '
                        'asks what it is about and whether it is urgent, and tells you here.',
                        style: TextStyle(color: AppColors.textSecondary, fontSize: 13.5, height: 1.4),
                      ),
                    ),
                    ListTile(
                      contentPadding: const EdgeInsets.symmetric(horizontal: 20),
                      leading: Icon(Icons.workspace_premium_outlined, color: AppColors.cyan),
                      title: Text(_planText(), style: TextStyle(color: AppColors.ink, fontSize: 14)),
                      trailing: ['expired', 'trial', 'active'].contains(_access['status']) ? TextButton(onPressed: _pay, child: Text(_access['status'] == 'active' ? 'Renew' : 'Pay')) : null,
                    ),
                    SwitchListTile(
                      contentPadding: const EdgeInsets.symmetric(horizontal: 20),
                      value: enabled,
                      title: Text('Assistant on', style: TextStyle(color: AppColors.ink, fontWeight: FontWeight.w700)),
                      onChanged: _saving ? null : (v) => _save({'enabled': v}),
                    ),
                    if (enabled) ...[
                      NtSectionHeader(_busyLabel()),
                      Padding(
                        padding: const EdgeInsets.symmetric(horizontal: 16),
                        child: Wrap(spacing: 8, runSpacing: 8, children: [
                          for (final (label, mins) in [('30 min', 30), ('1 hour', 60), ('2 hours', 120), ('Until tonight', 8 * 60)])
                            ActionChip(label: Text(label), onPressed: () => _busy(mins)),
                          // Only while busy: "I'm back" means nothing when you aren't.
                          if (_busyLabel() != 'Not busy')
                            ActionChip(
                              avatar: Icon(Icons.check_circle_outline, size: 18, color: AppColors.green),
                              label: const Text("I'm back"),
                              onPressed: () => _busy(0),
                            ),
                        ]),
                      ),
                      SwitchListTile(
                        contentPadding: const EdgeInsets.symmetric(horizontal: 20),
                        value: _s['chatMode'] == 'always',
                        title: Text('Answer chats even when not busy', style: TextStyle(color: AppColors.ink)),
                        subtitle: Text('Off: only while you are busy', style: TextStyle(color: AppColors.textSecondary)),
                        onChanged: (v) => _save({'chatMode': v ? 'always' : 'busy'}),
                      ),
                      SwitchListTile(
                        contentPadding: const EdgeInsets.symmetric(horizontal: 20),
                        value: _s['callsEnabled'] != false,
                        title: Text('Answer calls I miss', style: TextStyle(color: AppColors.ink)),
                        subtitle: Text('After ${_s['ringSeconds'] ?? 20} seconds of ringing, or at once while you are busy', style: TextStyle(color: AppColors.textSecondary)),
                        onChanged: (v) => _save({'callsEnabled': v}),
                      ),
                      if (_s['callsEnabled'] != false)
                        Padding(
                          padding: const EdgeInsets.symmetric(horizontal: 12),
                          child: Slider(
                            value: ((_s['ringSeconds'] as num?) ?? 20).toDouble(), min: 5, max: 40, divisions: 7,
                            label: '${_s['ringSeconds'] ?? 20} s', activeColor: AppColors.cyan,
                            onChanged: (v) => setState(() => (_data!['settings'] as Map)['ringSeconds'] = v.round()),
                            onChangeEnd: (v) => _save({'ringSeconds': v.round()}),
                          ),
                        ),
                      const NtSectionHeader('Voice on calls'),
                      RadioListTile<String>(value: 'ai-female', groupValue: _voiceKey(), title: const Text('AI voice (woman)'), onChanged: (_) => _save({'voice': 'ai', 'voiceGender': 'female'})),
                      RadioListTile<String>(value: 'ai-male', groupValue: _voiceKey(), title: const Text('AI voice (man)'), onChanged: (_) => _save({'voice': 'ai', 'voiceGender': 'male'})),
                      RadioListTile<String>(value: 'own', groupValue: _voiceKey(), title: const Text('My own voice'), subtitle: const Text('It still says it is your assistant'), onChanged: (_) => _save({'voice': 'own'})),
                      const NtSectionHeader('What it should know'),
                      Padding(
                        padding: const EdgeInsets.symmetric(horizontal: 20),
                        child: Column(children: [
                          TextField(controller: _name, maxLength: 40, decoration: const InputDecoration(labelText: "Assistant's name", hintText: 'e.g. Neura')),
                          TextField(
                            controller: _instructions, maxLength: 2000, minLines: 3, maxLines: 6,
                            decoration: const InputDecoration(labelText: 'Instructions', hintText: "e.g. If it's family, say I'll call back by evening. Don't share my schedule."),
                          ),
                          Align(
                            alignment: Alignment.centerRight,
                            child: FilledButton(
                              onPressed: _saving ? null : () => _save({'assistantName': _name.text.trim().isEmpty ? null : _name.text.trim(), 'instructions': _instructions.text.trim().isEmpty ? null : _instructions.text.trim()}),
                              child: const Text('Save'),
                            ),
                          ),
                        ]),
                      ),
                    ],
                    ListTile(
                      contentPadding: const EdgeInsets.symmetric(horizontal: 20, vertical: 8),
                      leading: Badge(isLabelVisible: unread > 0, label: Text('$unread'), child: Icon(Icons.inbox_outlined, color: AppColors.cyan)),
                      title: Text('Messages taken', style: TextStyle(color: AppColors.ink, fontWeight: FontWeight.w700)),
                      subtitle: Text('Chats and calls your assistant answered', style: TextStyle(color: AppColors.textSecondary)),
                      trailing: const Icon(Icons.chevron_right),
                      onTap: () async {
                        await Navigator.push(context, MaterialPageRoute(builder: (_) => const AssistantInboxScreen(base: '/api/assistant')));
                        _load();
                      },
                    ),
                  ]),
                ),
    );
  }

  String _voiceKey() => _s['voice'] == 'own' ? 'own' : 'ai-${_s['voiceGender'] ?? 'female'}';
}

/// What the assistant handled: summary, how urgent, the conversation.
/// Used for personal ("/api/assistant") and business ("/api/business/:id/assistant").
class AssistantInboxScreen extends StatefulWidget {
  const AssistantInboxScreen({super.key, required this.base});
  final String base;

  @override
  State<AssistantInboxScreen> createState() => _AssistantInboxScreenState();
}

class _AssistantInboxScreenState extends State<AssistantInboxScreen> {
  List<Map<String, dynamic>>? _items;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final res = await ApiService.get('${widget.base}/inbox') as Map;
      if (!mounted) return;
      setState(() => _items = (res['items'] as List).cast<Map<String, dynamic>>());
      if (widget.base == '/api/assistant') ApiService.post('/api/assistant/inbox/read', {}).catchError((_) => <String, dynamic>{});
    } catch (e) {
      if (mounted) setState(() => _error = e is ApiException ? e.message : 'Could not load.');
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(title: const Text('Messages taken')),
      body: _error != null
          ? NtEmptyState(icon: Icons.wifi_off, title: "Couldn't load", message: _error!, error: true)
          : _items == null
              ? Center(child: CircularProgressIndicator(color: AppColors.cyan))
              : _items!.isEmpty
                  ? const NtEmptyState(icon: Icons.inbox_outlined, title: 'Nothing yet', message: 'When your assistant answers a chat or a call, it shows up here.')
                  : RefreshIndicator(
                      onRefresh: _load,
                      child: ListView(children: [
                        for (final it in _items!)
                          ExpansionTile(
                            leading: Icon(
                              it['channel'] == 'call' ? Icons.call_outlined : Icons.chat_bubble_outline,
                              color: it['importance'] == 'urgent' ? AppColors.red : AppColors.cyan,
                            ),
                            title: Text(
                              '${it['importance'] == 'urgent' ? '🚨 ' : ''}${it['counterpartName'] ?? 'Someone'}${it['handoff'] == true ? ' · needs a person' : ''}',
                              style: TextStyle(color: AppColors.ink, fontWeight: it['readAt'] == null ? FontWeight.w800 : FontWeight.w600),
                            ),
                            subtitle: Text('${it['summary'] ?? 'Still talking…'}', style: TextStyle(color: AppColors.textSecondary)),
                            childrenPadding: const EdgeInsets.fromLTRB(20, 0, 20, 12),
                            children: [
                              if (it['lead'] is Map)
                                Container(
                                  width: double.infinity,
                                  margin: const EdgeInsets.only(bottom: 8),
                                  padding: const EdgeInsets.all(10),
                                  decoration: BoxDecoration(color: AppColors.blueTint, borderRadius: BorderRadius.circular(10)),
                                  child: Text('Request: ${(it['lead'] as Map).entries.map((e) => '${e.key}: ${e.value}').join(' · ')}', style: TextStyle(color: AppColors.ink)),
                                ),
                              for (final t in (it['history'] as List? ?? const []).cast<Map>())
                                Align(
                                  alignment: t['role'] == 'assistant' ? Alignment.centerRight : Alignment.centerLeft,
                                  child: Container(
                                    margin: const EdgeInsets.symmetric(vertical: 3),
                                    padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                                    constraints: BoxConstraints(maxWidth: MediaQuery.of(context).size.width * 0.75),
                                    decoration: BoxDecoration(
                                      color: t['role'] == 'assistant' ? AppColors.cyan.withValues(alpha: 0.15) : AppColors.surface,
                                      borderRadius: BorderRadius.circular(12),
                                    ),
                                    child: Text('${t['role'] == 'assistant' ? '🤖 ' : ''}${t['text']}', style: TextStyle(color: AppColors.ink, fontSize: 14)),
                                  ),
                                ),
                            ],
                          ),
                      ]),
                    ),
    );
  }
}
