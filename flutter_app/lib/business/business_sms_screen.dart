import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../services/api_service.dart';
import '../theme/app_theme.dart';
import '../widgets/business_chat_extras.dart' show rupeesText;
import '../widgets/nt_ui.dart';
import 'business_account.dart';

/// SMS for customers who don't have NeuraTalk (server/modules/messaging/sms-fallback.ts).
class BusinessSmsScreen extends StatefulWidget {
  const BusinessSmsScreen({super.key});

  @override
  State<BusinessSmsScreen> createState() => _BusinessSmsScreenState();
}

class _BusinessSmsScreenState extends State<BusinessSmsScreen> {
  Map<String, dynamic>? _data;
  List<Map<String, dynamic>> _log = [];
  bool _saving = false;
  String? _error;

  String get _base => context.read<BusinessAccount>().base;

  static const _kinds = {
    'utility': ('Order and account updates', 'Delivery, booking, payment updates'),
    'authentication': ('Login codes', 'One-time codes (OTP)'),
    'marketing': ('Offers', 'Only to customers who agreed to offers'),
  };

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final s = await ApiService.get('$_base/sms-settings') as Map<String, dynamic>;
      final l = await ApiService.get('$_base/sms-messages') as Map;
      if (mounted) setState(() { _data = s; _log = (l['messages'] as List).cast<Map<String, dynamic>>(); _error = null; });
    } catch (e) {
      if (mounted) setState(() => _error = e is ApiException ? e.message : 'Could not load.');
    }
  }

  Future<void> _save(bool enabled, List<String> categories) async {
    setState(() => _saving = true);
    try {
      await ApiService.put('$_base/sms-settings', {'enabled': enabled, 'categories': categories});
      await _load();
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e is ApiException ? e.message : 'Could not save.')));
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final d = _data;
    final settings = (d?['settings'] as Map?) ?? const {};
    final enabled = settings['enabled'] == true;
    final cats = ((settings['categories'] as List?) ?? const []).map((e) => '$e').toList();
    final available = d?['available'] == true;
    final price = (d?['pricePaise'] as num?) ?? 25;
    final last = (d?['last30Days'] as Map?) ?? const {};
    final sent = ((last['sent'] as Map?)?['count'] as num? ?? 0) + ((last['test'] as Map?)?['count'] as num? ?? 0);
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(title: const Text('SMS for customers without NeuraTalk')),
      body: _error != null
          ? NtEmptyState(icon: Icons.wifi_off, title: "Couldn't load", message: _error!, error: true)
          : d == null
              ? Center(child: CircularProgressIndicator(color: AppColors.cyan))
              : RefreshIndicator(
                  onRefresh: _load,
                  child: ListView(padding: const EdgeInsets.only(bottom: 40), children: [
                    Padding(
                      padding: const EdgeInsets.fromLTRB(20, 16, 20, 8),
                      child: Text(
                        'When a customer isn\'t on NeuraTalk, your message can go as one SMS: "<Your business> sent you a message on NeuraTalk. Read it: neuratalk.in/m/…". '
                        'The link shows your full message in a browser, and they can reply by installing NeuraTalk. '
                        'Each SMS costs ${rupeesText(price)} from your wallet; if it can\'t be sent, you get it back.',
                        style: TextStyle(color: AppColors.textSecondary, fontSize: 13.5, height: 1.4),
                      ),
                    ),
                    if (!available)
                      Container(
                        margin: const EdgeInsets.symmetric(horizontal: 20, vertical: 8),
                        padding: const EdgeInsets.all(12),
                        decoration: BoxDecoration(color: AppColors.orange.withValues(alpha: 0.12), borderRadius: BorderRadius.circular(12)),
                        child: Text('NeuraTalk is still getting SMS approved by the telecom regulator (DLT). You can choose your settings now; SMS starts once it is approved.',
                            style: TextStyle(color: AppColors.ink, fontSize: 13)),
                      ),
                    if (d['testMode'] == true)
                      Padding(
                        padding: const EdgeInsets.symmetric(horizontal: 20),
                        child: Text('Test mode: SMS are recorded but not really sent.', style: TextStyle(color: AppColors.orange, fontSize: 12.5)),
                      ),
                    SwitchListTile(
                      contentPadding: const EdgeInsets.symmetric(horizontal: 20),
                      value: enabled,
                      title: Text('Send SMS when the customer isn\'t on NeuraTalk', style: TextStyle(color: AppColors.ink, fontWeight: FontWeight.w600)),
                      onChanged: _saving ? null : (v) => _save(v, cats.isEmpty ? ['utility', 'authentication'] : cats),
                    ),
                    const NtSectionHeader('Which messages'),
                    for (final k in _kinds.entries)
                      CheckboxListTile(
                        contentPadding: const EdgeInsets.symmetric(horizontal: 20),
                        value: cats.contains(k.key),
                        title: Text(k.value.$1, style: TextStyle(color: AppColors.ink)),
                        subtitle: Text(k.value.$2, style: TextStyle(color: AppColors.textSecondary)),
                        activeColor: AppColors.cyan,
                        onChanged: _saving || !enabled
                            ? null
                            : (v) => _save(enabled, v == true ? [...cats, k.key] : cats.where((c) => c != k.key).toList()),
                      ),
                    NtSectionHeader('Last 30 days: $sent sent · ${last['opened'] ?? 0} opened'),
                    if (_log.isEmpty)
                      Padding(padding: const EdgeInsets.all(20), child: Text('No SMS yet.', style: TextStyle(color: AppColors.textSecondary))),
                    for (final s in _log.take(30))
                      ListTile(
                        contentPadding: const EdgeInsets.symmetric(horizontal: 20),
                        title: Text('${s['customerName'] ?? 'Customer'} · ${s['phone']}', style: TextStyle(color: AppColors.ink)),
                        subtitle: Text(
                          '${s['status'] == 'no_credit' ? 'Not sent: wallet empty' : s['status'] == 'failed' ? 'Not sent (refunded)' : s['openedAt'] != null ? 'Opened' : 'Sent'} · ${rupeesText((s['costPaise'] as num?) ?? 0)}',
                          style: TextStyle(color: AppColors.textSecondary),
                        ),
                      ),
                  ]),
                ),
    );
  }
}
