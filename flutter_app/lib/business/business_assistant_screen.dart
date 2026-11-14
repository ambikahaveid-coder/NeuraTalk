import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../screens/assistant_screen.dart' show AssistantInboxScreen;
import '../services/api_service.dart';
import '../theme/app_theme.dart';
import '../widgets/business_chat_extras.dart' show rupeesText;
import '../widgets/nt_ui.dart';
import 'business_account.dart';

/// AI receptionist for the business (server/ai-assistant.ts): trained on the
/// business's profile, hours, catalog and the owner's FAQ; answers customers
/// in chat and on calls, takes requests, hands over to a person.
class BusinessAssistantScreen extends StatefulWidget {
  const BusinessAssistantScreen({super.key});

  @override
  State<BusinessAssistantScreen> createState() => _BusinessAssistantScreenState();
}

class _BusinessAssistantScreenState extends State<BusinessAssistantScreen> {
  Map<String, dynamic>? _data;
  String? _error;
  bool _saving = false;
  final _knowledge = TextEditingController();
  final _instructions = TextEditingController();
  final _name = TextEditingController();
  final _question = TextEditingController();
  String? _answer;
  bool _asking = false;

  String get _base => '${context.read<BusinessAccount>().base}/assistant';
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
    for (final c in [_knowledge, _instructions, _name, _question]) {
      c.dispose();
    }
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final res = await ApiService.get(_base) as Map<String, dynamic>;
      if (!mounted) return;
      final s = res['settings'] as Map;
      setState(() {
        _data = res;
        _error = null;
        _knowledge.text = '${s['knowledge'] ?? ''}';
        _instructions.text = '${s['instructions'] ?? ''}';
        _name.text = '${s['assistantName'] ?? ''}';
      });
    } catch (e) {
      if (mounted) setState(() => _error = e is ApiException ? e.message : 'Could not load.');
    }
  }

  Future<void> _save(Map<String, dynamic> change) async {
    setState(() => _saving = true);
    try {
      final res = await ApiService.put(_base, change);
      if (mounted) setState(() => _data = {..._data ?? {}, ...res});
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e is ApiException ? e.message : 'Could not save.')));
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  Future<void> _subscribe() async {
    final price = rupeesText((_plan['pricePaise'] as num?) ?? 99900);
    final ok = await showDialog<bool>(
      context: context,
      builder: (d) => AlertDialog(
        title: Text('Pay $price for 30 days?'),
        content: Text('$price is taken from your wallet. Includes ${_plan['voiceMinutes'] ?? 300} call minutes; extra minutes ${rupeesText((_plan['extraMinutePaise'] as num?) ?? 600)} each.'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(d, false), child: const Text('Cancel')),
          FilledButton(onPressed: () => Navigator.pop(d, true), child: const Text('Pay from wallet')),
        ],
      ),
    );
    if (ok != true) return;
    try {
      final res = await ApiService.post('$_base/subscribe', {});
      if (mounted) setState(() => _data = {..._data ?? {}, ...res});
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e is ApiException ? e.message : 'Could not pay.')));
    }
  }

  Future<void> _ask() async {
    final q = _question.text.trim();
    if (q.isEmpty) return;
    setState(() { _asking = true; _answer = null; });
    try {
      final res = await ApiService.post('$_base/test', {'message': q});
      final r = res['result'] as Map;
      if (mounted) setState(() => _answer = '${r['reply']}${r['handoff'] == true ? '\n(→ hands over to your team)' : ''}');
    } catch (e) {
      if (mounted) setState(() => _answer = e is ApiException ? e.message : 'Could not ask.');
    } finally {
      if (mounted) setState(() => _asking = false);
    }
  }

  String _planText() {
    String date(String k) {
      final d = DateTime.tryParse('${_access[k] ?? ''}')?.toLocal();
      return d == null ? '' : '${d.day}/${d.month}/${d.year}';
    }
    final left = ((_access['voiceSecondsLeft'] as num?) ?? 0) ~/ 60;
    final price = rupeesText((_plan['pricePaise'] as num?) ?? 99900);
    return switch ('${_access['status']}') {
      'trial' => 'Free trial until ${date('trialEndsAt')} · $left call minutes left',
      'active' => 'Paid until ${date('periodEnd')} · $left call minutes left this month',
      'expired' => 'Trial or plan ended. $price a month to keep it.',
      'paused' => 'Paused by NeuraTalk. Write to support@mindwhile.com.',
      _ => '${_plan['trialDays'] ?? 14} days free, then $price a month: unlimited chat answers and ${_plan['voiceMinutes'] ?? 300} call minutes.',
    };
  }

  @override
  Widget build(BuildContext context) {
    final enabled = _s['enabled'] == true;
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(title: const Text('AI receptionist')),
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
                        'Answers your customers in chat and on calls, in their language, using your profile, opening hours, catalog prices and the notes below. '
                        'It takes order and booking requests for your team and hands over to a person when needed. It always says it is an AI assistant.',
                        style: TextStyle(color: AppColors.textSecondary, fontSize: 13.5, height: 1.4),
                      ),
                    ),
                    ListTile(
                      contentPadding: const EdgeInsets.symmetric(horizontal: 20),
                      leading: Icon(Icons.workspace_premium_outlined, color: AppColors.cyan),
                      title: Text(_planText(), style: TextStyle(color: AppColors.ink, fontSize: 14)),
                      trailing: ['trial', 'expired', 'active'].contains(_access['status']) ? TextButton(onPressed: _subscribe, child: Text(_access['status'] == 'active' ? 'Renew' : 'Subscribe')) : null,
                    ),
                    SwitchListTile(
                      contentPadding: const EdgeInsets.symmetric(horizontal: 20),
                      value: enabled,
                      title: Text('AI receptionist on', style: TextStyle(color: AppColors.ink, fontWeight: FontWeight.w700)),
                      onChanged: _saving ? null : (v) => _save({'enabled': v}),
                    ),
                    if (enabled) ...[
                      RadioListTile<String>(value: 'always', groupValue: '${_s['chatMode']}', title: const Text('Answer chats any time'), subtitle: const Text('Stays quiet while someone from your team is talking'), onChanged: (v) => _save({'chatMode': v})),
                      RadioListTile<String>(value: 'outside_hours', groupValue: '${_s['chatMode']}', title: const Text('Only outside opening hours'), onChanged: (v) => _save({'chatMode': v})),
                      SwitchListTile(
                        contentPadding: const EdgeInsets.symmetric(horizontal: 20),
                        value: _s['callsEnabled'] != false,
                        title: Text('Answer calls nobody picks up', style: TextStyle(color: AppColors.ink)),
                        subtitle: Text('After ${_s['ringSeconds'] ?? 20} seconds of ringing', style: TextStyle(color: AppColors.textSecondary)),
                        onChanged: (v) => _save({'callsEnabled': v}),
                      ),
                      if (_s['callsEnabled'] != false)
                        Padding(
                          padding: const EdgeInsets.symmetric(horizontal: 12),
                          child: Slider(
                            value: ((_s['ringSeconds'] as num?) ?? 20).toDouble(), min: 5, max: 40, divisions: 7, label: '${_s['ringSeconds'] ?? 20} s', activeColor: AppColors.cyan,
                            onChanged: (v) => setState(() => (_data!['settings'] as Map)['ringSeconds'] = v.round()),
                            onChangeEnd: (v) => _save({'ringSeconds': v.round()}),
                          ),
                        ),
                      RadioListTile<String>(value: 'female', groupValue: '${_s['voiceGender']}', title: const Text('Voice on calls: woman'), onChanged: (v) => _save({'voiceGender': v})),
                      RadioListTile<String>(value: 'male', groupValue: '${_s['voiceGender']}', title: const Text('Voice on calls: man'), onChanged: (v) => _save({'voiceGender': v})),
                      const NtSectionHeader('Train it'),
                      Padding(
                        padding: const EdgeInsets.symmetric(horizontal: 20),
                        child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                          Text('It already knows your profile, opening hours and catalog with prices. Add anything else customers ask:',
                              style: TextStyle(color: AppColors.textSecondary, fontSize: 13)),
                          TextField(
                            controller: _knowledge, maxLength: 12000, minLines: 5, maxLines: 12,
                            decoration: const InputDecoration(hintText: 'e.g. Free delivery within 3 km. Bulk orders need 1 day notice. Payment by UPI or cash. Parking available.'),
                          ),
                          TextField(controller: _instructions, maxLength: 2000, minLines: 2, maxLines: 5, decoration: const InputDecoration(labelText: 'How it should talk', hintText: 'e.g. Warm and short. Offer today\'s special.')),
                          TextField(controller: _name, maxLength: 40, decoration: const InputDecoration(labelText: "Assistant's name (optional)")),
                          Align(
                            alignment: Alignment.centerRight,
                            child: FilledButton(
                              onPressed: _saving ? null : () => _save({
                                'knowledge': _knowledge.text.trim().isEmpty ? null : _knowledge.text.trim(),
                                'instructions': _instructions.text.trim().isEmpty ? null : _instructions.text.trim(),
                                'assistantName': _name.text.trim().isEmpty ? null : _name.text.trim(),
                              }),
                              child: const Text('Save'),
                            ),
                          ),
                        ]),
                      ),
                      const NtSectionHeader('Try it'),
                      Padding(
                        padding: const EdgeInsets.symmetric(horizontal: 20),
                        child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                          Row(children: [
                            Expanded(child: TextField(controller: _question, decoration: const InputDecoration(hintText: 'Ask like a customer: "Do you deliver?"'), onSubmitted: (_) => _ask())),
                            IconButton(onPressed: _asking ? null : _ask, icon: Icon(Icons.send, color: AppColors.cyan)),
                          ]),
                          if (_asking) Padding(padding: const EdgeInsets.all(8), child: Center(child: CircularProgressIndicator(color: AppColors.cyan))),
                          if (_answer != null)
                            Container(
                              margin: const EdgeInsets.only(top: 8),
                              padding: const EdgeInsets.all(12),
                              decoration: BoxDecoration(color: AppColors.blueTint, borderRadius: BorderRadius.circular(12)),
                              child: Text('🤖 $_answer', style: TextStyle(color: AppColors.ink)),
                            ),
                        ]),
                      ),
                    ],
                    ListTile(
                      contentPadding: const EdgeInsets.symmetric(horizontal: 20, vertical: 8),
                      leading: Icon(Icons.inbox_outlined, color: AppColors.cyan),
                      title: Text('Conversations it handled', style: TextStyle(color: AppColors.ink, fontWeight: FontWeight.w700)),
                      subtitle: Text('Requests, handovers, call summaries', style: TextStyle(color: AppColors.textSecondary)),
                      trailing: const Icon(Icons.chevron_right),
                      onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => AssistantInboxScreen(base: _base))),
                    ),
                  ]),
                ),
    );
  }
}
