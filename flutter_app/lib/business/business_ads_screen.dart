import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../services/api_service.dart';
import '../theme/app_theme.dart';
import '../widgets/business_chat_extras.dart' show rupeesText;
import '../widgets/nt_ui.dart';
import 'business_account.dart';

/// Click-to-chat ads inside NeuraTalk (server/modules/messaging/business-ads.ts).
class BusinessAdsScreen extends StatefulWidget {
  const BusinessAdsScreen({super.key});

  @override
  State<BusinessAdsScreen> createState() => _BusinessAdsScreenState();
}

class _BusinessAdsScreenState extends State<BusinessAdsScreen> {
  List<Map<String, dynamic>> _ads = [];
  int _price = 200;
  bool _loading = true;
  String? _error;

  String get _base => context.read<BusinessAccount>().base;

  static const _statusText = {
    'pending': 'Waiting for NeuraTalk review',
    'approved': 'Running',
    'paused': 'Paused',
    'rejected': 'Not approved',
    'ended': 'Ended',
  };

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final res = await ApiService.get('$_base/ads') as Map;
      if (!mounted) return;
      setState(() {
        _ads = (res['ads'] as List).cast<Map<String, dynamic>>();
        _price = (res['pricePerChatPaise'] as num?)?.toInt() ?? 200;
        _loading = false;
        _error = null;
      });
    } catch (e) {
      if (mounted) setState(() { _loading = false; _error = e is ApiException ? e.message : 'Could not load your ads.'; });
    }
  }

  Future<void> _create() async {
    final headline = TextEditingController();
    final body = TextEditingController();
    final button = TextEditingController(text: 'Chat now');
    final budget = TextEditingController(text: '100');
    String? error;
    final ok = await showDialog<bool>(
      context: context,
      builder: (d) => StatefulBuilder(builder: (d, setD) => AlertDialog(
        title: const Text('New ad'),
        content: SingleChildScrollView(
          child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
            TextField(controller: headline, maxLength: 60, decoration: const InputDecoration(labelText: 'Headline', hintText: 'Fresh idli, 30-minute delivery')),
            TextField(controller: body, maxLength: 140, maxLines: 2, decoration: const InputDecoration(labelText: 'One line about it')),
            TextField(controller: button, maxLength: 20, decoration: const InputDecoration(labelText: 'Button')),
            TextField(controller: budget, keyboardType: TextInputType.number, decoration: const InputDecoration(labelText: 'Daily budget (₹)', prefixText: '₹ ')),
            const SizedBox(height: 8),
            Text('You pay ${rupeesText(_price)} for each new chat started from the ad (once per person a day), never more than your daily budget. Showing the ad is free. NeuraTalk reviews every ad first.',
                style: TextStyle(color: AppColors.textSecondary, fontSize: 12.5)),
            if (error != null) Padding(padding: const EdgeInsets.only(top: 8), child: Text(error!, style: const TextStyle(color: AppColors.red))),
          ]),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(d, false), child: const Text('Cancel')),
          FilledButton(
            onPressed: () async {
              try {
                await ApiService.post('$_base/ads', {
                  'headline': headline.text.trim(), 'body': body.text.trim(), 'button': button.text.trim().isEmpty ? 'Chat now' : button.text.trim(),
                  'dailyBudgetPaise': ((double.tryParse(budget.text.trim()) ?? 0) * 100).round(),
                });
                if (d.mounted) Navigator.pop(d, true);
              } catch (e) {
                setD(() => error = e is ApiException ? e.message : 'Could not create the ad.');
              }
            },
            child: const Text('Send for review'),
          ),
        ],
      )),
    );
    if (ok == true) _load();
  }

  Future<void> _act(Map ad, String action) async {
    try {
      await ApiService.patch('$_base/ads/${ad['id']}', {'action': action});
      _load();
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e is ApiException ? e.message : 'Could not update the ad.')));
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(title: const Text('Ads')),
      floatingActionButton: FloatingActionButton.extended(
        heroTag: 'new-ad',
        onPressed: _create,
        backgroundColor: AppColors.cyan,
        foregroundColor: AppColors.onAccent,
        icon: const Icon(Icons.add),
        label: const Text('New ad'),
      ),
      body: _loading
          ? Center(child: CircularProgressIndicator(color: AppColors.cyan))
          : _error != null
              ? NtEmptyState(icon: Icons.wifi_off, title: "Couldn't load", message: _error!, error: true)
              : RefreshIndicator(
                  onRefresh: _load,
                  child: ListView(padding: const EdgeInsets.only(bottom: 96), children: [
                    Padding(
                      padding: const EdgeInsets.fromLTRB(20, 16, 20, 8),
                      child: Text(
                        'Your ad shows as "Sponsored" to NeuraTalk users in Business messages. Tapping it starts a chat with you. '
                        'You pay ${rupeesText(_price)} per new chat from your wallet, within your daily budget.',
                        style: TextStyle(color: AppColors.textSecondary, fontSize: 13.5, height: 1.4),
                      ),
                    ),
                    if (_ads.isEmpty)
                      const Padding(padding: EdgeInsets.only(top: 40), child: NtEmptyState(icon: Icons.campaign_outlined, title: 'No ads yet', message: 'Tap New ad to reach new customers.')),
                    for (final a in _ads)
                      NtCard(
                        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                          Row(children: [
                            Expanded(child: Text('${a['headline']}', style: TextStyle(color: AppColors.ink, fontWeight: FontWeight.w700, fontSize: 15.5))),
                            Text(_statusText[a['status']] ?? '${a['status']}',
                                style: TextStyle(color: a['status'] == 'approved' ? AppColors.green : a['status'] == 'rejected' ? AppColors.red : AppColors.textSecondary, fontSize: 12.5, fontWeight: FontWeight.w600)),
                          ]),
                          Text('${a['body']}', style: TextStyle(color: AppColors.textSecondary)),
                          if (a['status'] == 'rejected' && a['reviewNote'] != null)
                            Padding(padding: const EdgeInsets.only(top: 4), child: Text('NeuraTalk: ${a['reviewNote']}', style: const TextStyle(color: AppColors.red, fontSize: 13))),
                          const SizedBox(height: 8),
                          Text('${a['views']} saw it · ${a['chats']} chats · ${rupeesText(a['spentPaise'] as num)} spent · today ${rupeesText(a['spentTodayPaise'] as num)} of ${rupeesText(a['dailyBudgetPaise'] as num)}',
                              style: TextStyle(color: AppColors.textMuted, fontSize: 12.5)),
                          if (a['status'] == 'approved' || a['status'] == 'paused' || a['status'] == 'pending')
                            Row(children: [
                              if (a['status'] == 'approved') TextButton(onPressed: () => _act(a, 'pause'), child: const Text('Pause')),
                              if (a['status'] == 'paused') TextButton(onPressed: () => _act(a, 'resume'), child: const Text('Resume')),
                              TextButton(onPressed: () => _act(a, 'end'), child: const Text('End', style: TextStyle(color: AppColors.red))),
                            ]),
                        ]),
                      ),
                  ]),
                ),
    );
  }
}
