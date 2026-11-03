import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';
import 'package:url_launcher/url_launcher.dart';

import '../services/api_service.dart';
import '../theme/app_theme.dart';
import '../widgets/nt_ui.dart';
import 'business_account.dart';

String _rs(num paise, {int digits = 2}) {
  final v = paise / 100;
  return '₹${digits == 0 && v == v.roundToDouble() ? v.toStringAsFixed(0) : v.toStringAsFixed(2)}';
}

const _category = {'marketing': 'Offers', 'utility': 'Order & account updates', 'authentication': 'Verification codes'};
const _methods = {'upi': 'UPI', 'bank_transfer': 'Bank transfer', 'cheque': 'Cheque', 'cash_deposit': 'Cash deposit'};

/// Message credits: balance, prices, buy credit (pay by UPI/bank, send the
/// UTR, NeuraTalk confirms and adds it), payments and spending.
class BusinessCreditsScreen extends StatefulWidget {
  const BusinessCreditsScreen({super.key});

  @override
  State<BusinessCreditsScreen> createState() => _BusinessCreditsScreenState();
}

class _BusinessCreditsScreenState extends State<BusinessCreditsScreen> {
  Map<String, dynamic>? _d;
  String? _error;

  String get _base => '${context.read<BusinessAccount>().base}/credits';

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _load());
  }

  Future<void> _load() async {
    try {
      final res = await ApiService.get(_base);
      if (mounted) setState(() { _d = Map<String, dynamic>.from(res as Map); _error = null; });
    } catch (e) {
      if (mounted) setState(() => _error = e is ApiException ? e.message : 'Check your connection and try again.');
    }
  }

  Future<void> _buy(Map<String, dynamic>? pack) async {
    final account = context.read<BusinessAccount>();
    final sent = await Navigator.push<bool>(context, MaterialPageRoute(
      builder: (_) => ChangeNotifierProvider<BusinessAccount>.value(
        value: account,
        child: _BuyScreen(pack: pack, payment: Map<String, dynamic>.from(_d!['payment'] as Map), minPaise: ((_d!['customAmount'] as Map)['minPaise'] as num).toInt()),
      ),
    ));
    if (sent == true) {
      await _load();
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Sent. NeuraTalk adds the credit after checking the payment, usually within a working day.')));
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final d = _d;
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(title: const Text('Message credits')),
      body: _error != null
          ? NtEmptyState(icon: Icons.wifi_off, title: "Couldn't load credits", message: _error!, error: true, actionLabel: 'Try again', onAction: _load)
          : d == null
              ? Center(child: CircularProgressIndicator(color: AppColors.cyan))
              : RefreshIndicator(onRefresh: _load, child: _body(d)),
    );
  }

  Widget _card({required Widget child, EdgeInsets margin = const EdgeInsets.fromLTRB(16, 12, 16, 0)}) => Container(
        margin: margin,
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(color: AppColors.surface, borderRadius: BorderRadius.circular(14), border: Border.all(color: AppColors.border)),
        child: child,
      );

  Widget _body(Map<String, dynamic> d) {
    final rates = Map<String, dynamic>.from(d['rates'] as Map);
    final packs = (d['packs'] as List? ?? const []).whereType<Map>().map((m) => Map<String, dynamic>.from(m)).toList();
    final requests = (d['requests'] as List? ?? const []).whereType<Map>().map((m) => Map<String, dynamic>.from(m)).toList();
    final usage = (d['usage'] as List? ?? const []).whereType<Map>().toList();
    final byCat = <String, (int, int)>{};
    for (final u in usage) {
      final c = '${u['category']}';
      final prev = byCat[c] ?? (0, 0);
      byCat[c] = (prev.$1 + ((u['messages'] as num?)?.toInt() ?? 0), prev.$2 + ((u['amountPaise'] as num?)?.toInt() ?? 0));
    }
    final paymentReady = (d['payment'] as Map?)?['ready'] == true;

    return ListView(padding: const EdgeInsets.only(bottom: 32), children: [
      if (d['isLow'] == true)
        Container(
          margin: const EdgeInsets.fromLTRB(16, 12, 16, 0),
          padding: const EdgeInsets.all(12),
          decoration: BoxDecoration(color: AppColors.orange.withValues(alpha: 0.12), borderRadius: BorderRadius.circular(12)),
          child: Text('Balance is low. When it runs out, offers, updates and codes stop sending. Replies to customers who wrote to you stay free.',
              style: TextStyle(color: AppColors.ink, fontWeight: FontWeight.w600)),
        ),
      _card(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text('Balance', style: TextStyle(color: AppColors.textSecondary)),
        const SizedBox(height: 4),
        Text(_rs(d['balancePaise'] as num), style: TextStyle(color: AppColors.ink, fontSize: 32, fontWeight: FontWeight.w800)),
        if (d['daysLeft'] != null) Text('About ${d['daysLeft']} days at your usual pace', style: TextStyle(color: AppColors.textSecondary, fontSize: 13)),
        const SizedBox(height: 4),
        Text('Spent in 30 days: ${_rs(d['spent30dPaise'] as num)}', style: TextStyle(color: AppColors.textSecondary, fontSize: 13)),
      ])),
      _card(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Row(children: [
          Expanded(child: Text('Price per delivered message', style: TextStyle(color: AppColors.ink, fontWeight: FontWeight.w700))),
          if (rates['special'] == true) Chip(label: const Text('Special rate'), visualDensity: VisualDensity.compact, backgroundColor: AppColors.blueTint),
        ]),
        const SizedBox(height: 6),
        _line('Offers', _rs(rates['marketingPaise'] as num)),
        _line('Order & account updates', _rs(rates['utilityPaise'] as num)),
        _line('Verification codes', _rs(rates['otpPaise'] as num)),
        const SizedBox(height: 6),
        Text('Replies to a customer who wrote in the last 24 hours: free. Customers not on NeuraTalk: never charged.',
            style: TextStyle(color: AppColors.textSecondary, fontSize: 12.5)),
      ])),
      Padding(
        padding: const EdgeInsets.fromLTRB(16, 20, 16, 4),
        child: Text('BUY CREDIT', style: TextStyle(color: AppColors.textMuted, fontSize: 12.5, fontWeight: FontWeight.w700, letterSpacing: 0.6)),
      ),
      if (!paymentReady)
        Padding(padding: const EdgeInsets.symmetric(horizontal: 16), child: Text('Payment details aren\'t set up yet. Write to support@neuratalk.in to buy credit.', style: TextStyle(color: AppColors.textSecondary)))
      else ...[
        for (final p in packs)
          ListTile(
            onTap: () => _buy(p),
            leading: CircleAvatar(backgroundColor: AppColors.blueTint, child: Icon(Icons.account_balance_wallet_outlined, color: AppColors.cyan)),
            title: Text('${p['name']} · ${_rs(p['pricePaise'] as num, digits: 0)}', style: TextStyle(color: AppColors.ink, fontWeight: FontWeight.w600)),
            subtitle: Text('You get ${_rs(p['creditPaise'] as num, digits: 0)} credit${((p['bonusPaise'] as num?) ?? 0) > 0 ? ' (+${_rs(p['bonusPaise'] as num, digits: 0)} bonus)' : ''}',
                style: TextStyle(color: AppColors.textSecondary)),
            trailing: const Icon(Icons.chevron_right),
          ),
        ListTile(
          onTap: () => _buy(null),
          leading: CircleAvatar(backgroundColor: AppColors.blueTint, child: Icon(Icons.edit_outlined, color: AppColors.cyan)),
          title: Text('Other amount', style: TextStyle(color: AppColors.ink, fontWeight: FontWeight.w600)),
          subtitle: Text('From ${_rs(((d['customAmount'] as Map)['minPaise'] as num), digits: 0)}', style: TextStyle(color: AppColors.textSecondary)),
          trailing: const Icon(Icons.chevron_right),
        ),
      ],
      if (requests.isNotEmpty) ...[
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 20, 16, 4),
          child: Text('YOUR PAYMENTS', style: TextStyle(color: AppColors.textMuted, fontSize: 12.5, fontWeight: FontWeight.w700, letterSpacing: 0.6)),
        ),
        for (final r in requests) _requestTile(r),
      ],
      Padding(
        padding: const EdgeInsets.fromLTRB(16, 20, 16, 4),
        child: Text('WHERE THE MONEY WENT (30 DAYS)', style: TextStyle(color: AppColors.textMuted, fontSize: 12.5, fontWeight: FontWeight.w700, letterSpacing: 0.6)),
      ),
      if (byCat.isEmpty)
        Padding(padding: const EdgeInsets.symmetric(horizontal: 16), child: Text('No paid messages yet.', style: TextStyle(color: AppColors.textSecondary)))
      else
        for (final e in byCat.entries)
          ListTile(
            dense: true,
            title: Text(_category[e.key] ?? e.key, style: TextStyle(color: AppColors.ink)),
            subtitle: Text('${e.value.$1} messages', style: TextStyle(color: AppColors.textSecondary)),
            trailing: Text(_rs(e.value.$2), style: TextStyle(color: AppColors.ink, fontWeight: FontWeight.w700)),
          ),
    ]);
  }

  Widget _line(String label, String value) => Padding(
        padding: const EdgeInsets.symmetric(vertical: 2),
        child: Row(children: [
          Expanded(child: Text(label, style: TextStyle(color: AppColors.textPrimary))),
          Text(value, style: TextStyle(color: AppColors.ink, fontWeight: FontWeight.w700)),
        ]),
      );

  Widget _requestTile(Map<String, dynamic> r) {
    final status = '${r['status']}';
    final (label, color, icon) = switch (status) {
      'approved' => ('Credit added', AppColors.green, Icons.check_circle),
      'rejected' => ('Not confirmed', AppColors.red, Icons.cancel),
      'cancelled' => ('Cancelled', AppColors.textMuted, Icons.cancel_outlined),
      _ => ('Waiting for NeuraTalk', AppColors.orange, Icons.schedule),
    };
    return ListTile(
      leading: Icon(icon, color: color),
      title: Text('Paid ${_rs(r['pricePaise'] as num)} → ${_rs(r['creditPaise'] as num)}', style: TextStyle(color: AppColors.ink, fontWeight: FontWeight.w600)),
      subtitle: Text(
        '${_methods[r['method']] ?? r['method']} · ${r['paymentReference']}\n$label${status == 'rejected' && r['decisionNote'] != null ? ': ${r['decisionNote']}' : ''}',
        style: TextStyle(color: status == 'rejected' ? AppColors.red : AppColors.textSecondary),
      ),
      isThreeLine: true,
      trailing: status == 'pending'
          ? TextButton(
              onPressed: () async {
                try {
                  await ApiService.post('$_base/requests/${r['id']}/cancel', {});
                  await _load();
                } catch (e) {
                  if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e is ApiException ? e.message : "Couldn't cancel.")));
                }
              },
              child: const Text('Cancel'),
            )
          : null,
    );
  }
}

class _BuyScreen extends StatefulWidget {
  const _BuyScreen({required this.pack, required this.payment, required this.minPaise});
  final Map<String, dynamic>? pack;
  final Map<String, dynamic> payment;
  final int minPaise;

  @override
  State<_BuyScreen> createState() => _BuyScreenState();
}

class _BuyScreenState extends State<_BuyScreen> {
  final _amount = TextEditingController();
  final _ref = TextEditingController();
  String _method = 'upi';
  bool _sending = false;

  int get _payPaise => widget.pack != null ? (widget.pack!['pricePaise'] as num).toInt() : ((double.tryParse(_amount.text.trim()) ?? 0) * 100).round();

  @override
  void dispose() {
    _amount.dispose();
    _ref.dispose();
    super.dispose();
  }

  Future<void> _openUpi() async {
    final p = widget.payment;
    final uri = Uri(scheme: 'upi', host: 'pay', queryParameters: {
      'pa': '${p['upiId']}',
      if ('${p['payeeName']}'.isNotEmpty) 'pn': '${p['payeeName']}',
      'am': (_payPaise / 100).toStringAsFixed(2),
      'cu': 'INR',
      'tn': 'NeuraTalk message credit',
    });
    final ok = await launchUrl(uri, mode: LaunchMode.externalApplication).catchError((_) => false);
    if (!ok && mounted) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('No UPI app found. Pay to the UPI ID shown here from any app.')));
    }
  }

  Future<void> _send() async {
    setState(() => _sending = true);
    try {
      await ApiService.post('${context.read<BusinessAccount>().base}/credits/requests', {
        if (widget.pack != null) 'packId': widget.pack!['id'] else 'amountPaise': _payPaise,
        'method': _method,
        'paymentReference': _ref.text.trim(),
      });
      if (mounted) Navigator.pop(context, true);
    } catch (e) {
      if (mounted) {
        setState(() => _sending = false);
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e is ApiException ? e.message : "Couldn't send. Try again.")));
      }
    }
  }

  Widget _copy(String label, String value) {
    if (value.isEmpty) return const SizedBox.shrink();
    return ListTile(
      dense: true,
      contentPadding: EdgeInsets.zero,
      title: Text(label, style: TextStyle(color: AppColors.textSecondary)),
      subtitle: SelectableText(value, style: TextStyle(color: AppColors.ink, fontWeight: FontWeight.w600, fontSize: 15)),
      trailing: IconButton(
        tooltip: 'Copy $label',
        icon: const Icon(Icons.copy, size: 20),
        onPressed: () {
          Clipboard.setData(ClipboardData(text: value));
          ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('$label copied')));
        },
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final p = widget.payment;
    final amountOk = widget.pack != null || _payPaise >= widget.minPaise;
    final canSend = !_sending && amountOk && _ref.text.trim().length >= 6;
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(title: Text(widget.pack != null ? 'Buy ${widget.pack!['name']}' : 'Buy credit')),
      body: ListView(padding: const EdgeInsets.all(16), children: [
        Text('1. Pay NeuraTalk', style: TextStyle(color: AppColors.ink, fontWeight: FontWeight.w700, fontSize: 16)),
        const SizedBox(height: 8),
        if (widget.pack == null)
          TextField(
            controller: _amount,
            keyboardType: TextInputType.number,
            onChanged: (_) => setState(() {}),
            decoration: InputDecoration(labelText: 'Amount in ₹', helperText: 'At least ${_rs(widget.minPaise, digits: 0)}', prefixText: '₹ '),
          )
        else
          Text('Pay ${_rs(_payPaise)} · you get ${_rs(widget.pack!['creditPaise'] as num)} credit', style: TextStyle(color: AppColors.textPrimary, fontSize: 15)),
        const SizedBox(height: 8),
        if ('${p['upiId']}'.isNotEmpty) ...[
          FilledButton.icon(
            onPressed: amountOk ? _openUpi : null,
            icon: const Icon(Icons.qr_code_2),
            label: Text('Pay ${amountOk ? _rs(_payPaise) : ''} with a UPI app'),
          ),
          const SizedBox(height: 4),
        ],
        _copy('UPI ID', '${p['upiId'] ?? ''}'),
        _copy('Name', '${p['payeeName'] ?? ''}'),
        _copy('Bank', '${p['bankName'] ?? ''}'),
        _copy('Account number', '${p['accountNumber'] ?? ''}'),
        _copy('IFSC', '${p['ifsc'] ?? ''}'),
        if ('${p['note'] ?? ''}'.isNotEmpty) Text('${p['note']}', style: TextStyle(color: AppColors.textSecondary, fontSize: 13)),
        const SizedBox(height: 20),
        Text('2. Tell us how you paid', style: TextStyle(color: AppColors.ink, fontWeight: FontWeight.w700, fontSize: 16)),
        const SizedBox(height: 8),
        DropdownButtonFormField<String>(
          initialValue: _method,
          decoration: const InputDecoration(labelText: 'Paid by'),
          items: [for (final e in _methods.entries) DropdownMenuItem(value: e.key, child: Text(e.value))],
          onChanged: (v) => setState(() => _method = v ?? 'upi'),
        ),
        const SizedBox(height: 8),
        TextField(
          controller: _ref,
          maxLength: 40,
          onChanged: (_) => setState(() {}),
          decoration: const InputDecoration(labelText: 'UTR / transaction reference', helperText: 'In your UPI or bank app, under the payment details', helperMaxLines: 2),
        ),
        const SizedBox(height: 16),
        FilledButton(
          onPressed: canSend ? _send : null,
          child: _sending ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2)) : const Text("I've paid — send for confirmation"),
        ),
        const SizedBox(height: 8),
        Text('Credit is added after NeuraTalk confirms the payment with the bank. Each payment reference can be used once.',
            style: TextStyle(color: AppColors.textSecondary, fontSize: 12.5)),
      ]),
    );
  }
}
