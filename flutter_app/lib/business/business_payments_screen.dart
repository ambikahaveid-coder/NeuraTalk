import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../screens/business_messages_screen.dart' show formatBusinessTime;
import '../services/api_service.dart';
import '../theme/app_theme.dart';
import '../widgets/business_chat_extras.dart' show rupeesText;
import '../widgets/nt_ui.dart';
import 'business_account.dart';

/// Your UPI ID for payment requests. Returns the saved settings, or null.
Future<Map?> showUpiSettingsDialog(BuildContext context, int businessId, {Map? current}) async {
  final upi = TextEditingController(text: current?['upiId']?.toString() ?? '');
  final name = TextEditingController(text: current?['payeeName']?.toString() ?? '');
  String? error;
  return showDialog<Map>(
    context: context,
    builder: (d) => StatefulBuilder(builder: (d, setD) => AlertDialog(
      title: const Text('Your UPI ID'),
      content: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text('Customers pay to this UPI ID from their own UPI app. The money goes straight to your bank; NeuraTalk never holds it.',
            style: TextStyle(color: AppColors.textSecondary, fontSize: 13)),
        const SizedBox(height: 12),
        TextField(controller: upi, decoration: const InputDecoration(labelText: 'UPI ID', hintText: 'shopname@okaxis')),
        TextField(controller: name, decoration: const InputDecoration(labelText: 'Name shown to customers', hintText: 'Sri Sai Tiffins')),
        if (error != null) Padding(padding: const EdgeInsets.only(top: 8), child: Text(error!, style: const TextStyle(color: AppColors.red))),
      ]),
      actions: [
        TextButton(onPressed: () => Navigator.pop(d), child: const Text('Cancel')),
        FilledButton(
          onPressed: () async {
            try {
              final res = await ApiService.put('/api/business/$businessId/payment-settings', {'upiId': upi.text.trim(), 'payeeName': name.text.trim()});
              if (d.mounted) Navigator.pop(d, res['settings'] as Map?);
            } catch (e) {
              setD(() => error = e is ApiException ? e.message : 'Could not save.');
            }
          },
          child: const Text('Save'),
        ),
      ],
    )),
  );
}

/// Payment requests sent in chats: confirm the ones customers say they paid.
class BusinessPaymentsScreen extends StatefulWidget {
  const BusinessPaymentsScreen({super.key});

  @override
  State<BusinessPaymentsScreen> createState() => _BusinessPaymentsScreenState();
}

class _BusinessPaymentsScreenState extends State<BusinessPaymentsScreen> {
  Map? _settings;
  List<Map<String, dynamic>> _requests = [];
  Map<String, dynamic> _totals = {};
  bool _loading = true;
  String? _error;

  BusinessAccount get _acct => context.read<BusinessAccount>();

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final s = await ApiService.get('${_acct.base}/payment-settings') as Map;
      final r = await ApiService.get('${_acct.base}/payment-requests') as Map;
      if (!mounted) return;
      setState(() {
        _settings = s['settings'] as Map?;
        _requests = (r['requests'] as List).cast<Map<String, dynamic>>();
        _totals = Map<String, dynamic>.from(r['totals'] as Map? ?? {});
        _loading = false;
        _error = null;
      });
    } catch (e) {
      if (mounted) setState(() { _error = e is ApiException ? e.message : 'Could not load payments.'; _loading = false; });
    }
  }

  Future<void> _settle(Map p, String status) async {
    try {
      await ApiService.patch('${_acct.base}/payment-requests/${p['id']}', {'status': status});
      _load();
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e is ApiException ? e.message : 'Could not update.')));
    }
  }

  static const _label = {'requested': 'Waiting', 'customer_paid': 'Customer says paid', 'paid': 'Paid', 'cancelled': 'Cancelled'};

  @override
  Widget build(BuildContext context) {
    final received = (_totals['paid'] as Map?)?['amountPaise'] as num? ?? 0;
    final toCheck = (_totals['customer_paid'] as Map?)?['count'] as num? ?? 0;
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(title: const Text('Payments (UPI)')),
      body: _loading
          ? Center(child: CircularProgressIndicator(color: AppColors.cyan))
          : _error != null
              ? NtEmptyState(icon: Icons.wifi_off, title: "Couldn't load", message: _error!, error: true)
              : RefreshIndicator(
                  onRefresh: _load,
                  child: ListView(padding: const EdgeInsets.only(bottom: 40), children: [
                    ListTile(
                      contentPadding: const EdgeInsets.symmetric(horizontal: 20, vertical: 8),
                      leading: CircleAvatar(backgroundColor: AppColors.blueTint, child: Icon(Icons.account_balance_outlined, color: AppColors.cyan)),
                      title: Text(_settings == null ? 'Add your UPI ID' : '${_settings!['upiId']}', style: TextStyle(color: AppColors.ink, fontWeight: FontWeight.w700)),
                      subtitle: Text(_settings == null ? 'Needed before you can ask customers to pay' : 'Shown as ${_settings!['payeeName']}', style: TextStyle(color: AppColors.textSecondary)),
                      trailing: Icon(Icons.edit_outlined, color: AppColors.textMuted),
                      onTap: () async {
                        final saved = await showUpiSettingsDialog(context, _acct.businessId, current: _settings);
                        if (saved != null) _load();
                      },
                    ),
                    Padding(
                      padding: const EdgeInsets.symmetric(horizontal: 20),
                      child: Text(
                        'In a chat, tap ₹ to ask for a payment. The customer pays from their own UPI app, then taps "I\'ve paid". '
                        'Check your bank or UPI app, then tap Money received.',
                        style: TextStyle(color: AppColors.textSecondary, fontSize: 13, height: 1.4),
                      ),
                    ),
                    const SizedBox(height: 12),
                    Padding(
                      padding: const EdgeInsets.symmetric(horizontal: 20),
                      child: Row(children: [
                        Expanded(child: NtCard(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                          Text('Received', style: TextStyle(color: AppColors.textSecondary, fontSize: 12.5)),
                          Text(rupeesText(received), style: TextStyle(color: AppColors.ink, fontSize: 20, fontWeight: FontWeight.w800)),
                        ]))),
                        const SizedBox(width: 12),
                        Expanded(child: NtCard(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                          Text('To check', style: TextStyle(color: AppColors.textSecondary, fontSize: 12.5)),
                          Text('$toCheck', style: TextStyle(color: toCheck > 0 ? AppColors.orange : AppColors.ink, fontSize: 20, fontWeight: FontWeight.w800)),
                        ]))),
                      ]),
                    ),
                    const NtSectionHeader('Requests'),
                    if (_requests.isEmpty)
                      Padding(padding: const EdgeInsets.all(20), child: Text('No payment requests yet.', style: TextStyle(color: AppColors.textSecondary))),
                    for (final p in _requests)
                      ListTile(
                        contentPadding: const EdgeInsets.symmetric(horizontal: 20, vertical: 4),
                        title: Text('${rupeesText(p['amountPaise'] as num)} · ${p['customerName'] ?? 'Customer'}', style: TextStyle(color: AppColors.ink, fontWeight: FontWeight.w700)),
                        subtitle: Text(
                          [
                            _label[p['status']] ?? p['status'],
                            if ((p['note'] ?? '').toString().isNotEmpty) p['note'],
                            if (p['customerReference'] != null) 'UTR ${p['customerReference']}',
                            formatBusinessTime(p['createdAt']),
                          ].join(' · '),
                          style: TextStyle(color: p['status'] == 'customer_paid' ? AppColors.orange : AppColors.textSecondary),
                        ),
                        trailing: p['status'] == 'requested' || p['status'] == 'customer_paid'
                            ? PopupMenuButton<String>(
                                onSelected: (s) => _settle(p, s),
                                itemBuilder: (_) => const [
                                  PopupMenuItem(value: 'paid', child: Text('Money received')),
                                  PopupMenuItem(value: 'cancelled', child: Text('Cancel request')),
                                ],
                              )
                            : null,
                      ),
                  ]),
                ),
    );
  }
}
