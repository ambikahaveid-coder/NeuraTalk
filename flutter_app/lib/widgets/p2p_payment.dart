import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';
import '../services/api_service.dart';
import '../theme/app_theme.dart';
import 'business_chat_extras.dart' show rupeesText;

/// Payments between friends in a 1:1 chat (server/personal-payments.ts).
/// Money goes bank to bank through each person's own UPI app; NeuraTalk
/// never holds it.

String _err(Object e, String fallback) => e is ApiException ? e.message : fallback;
void _toast(BuildContext context, String text) {
  if (context.mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(text)));
}

/// Ask for (or change) my UPI ID. Returns true when saved.
Future<bool> editMyUpi(BuildContext context, {Map? current}) async {
  final upi = TextEditingController(text: current?['upiId']?.toString() ?? '');
  final name = TextEditingController(text: current?['payeeName']?.toString() ?? '');
  String? error;
  final ok = await showDialog<bool>(
    context: context,
    builder: (d) => StatefulBuilder(builder: (d, setD) => AlertDialog(
      title: const Text('Your UPI ID'),
      content: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text('Friends pay you to this UPI ID from their own UPI app. It is shown only to people you chat with.',
            style: TextStyle(color: AppColors.textSecondary, fontSize: 13)),
        TextField(controller: upi, decoration: const InputDecoration(labelText: 'UPI ID', hintText: 'name@okaxis')),
        TextField(controller: name, decoration: const InputDecoration(labelText: 'Name on your bank account')),
        if (error != null) Padding(padding: const EdgeInsets.only(top: 8), child: Text(error!, style: const TextStyle(color: AppColors.red))),
      ]),
      actions: [
        TextButton(onPressed: () => Navigator.pop(d, false), child: const Text('Cancel')),
        FilledButton(
          onPressed: () async {
            try {
              await ApiService.put('/api/me/upi', {'upiId': upi.text.trim(), 'payeeName': name.text.trim()});
              if (d.mounted) Navigator.pop(d, true);
            } catch (e) {
              setD(() => error = _err(e, 'Could not save.'));
            }
          },
          child: const Text('Save'),
        ),
      ],
    )),
  );
  return ok == true;
}

/// "Request money" in a chat.
Future<void> requestMoney(BuildContext context, int threadId, String peerName, {VoidCallback? onSent}) async {
  try {
    final mine = ((await ApiService.get('/api/me/upi')) as Map)['upi'] as Map?;
    if (!context.mounted) return;
    if (mine == null && !await editMyUpi(context)) return;
  } catch (e) {
    return _toast(context, _err(e, 'Could not load your UPI ID.'));
  }
  if (!context.mounted) return;
  final amount = TextEditingController();
  final note = TextEditingController();
  final ok = await showDialog<bool>(
    context: context,
    builder: (d) => AlertDialog(
      title: Text('Request money from $peerName'),
      content: Column(mainAxisSize: MainAxisSize.min, children: [
        TextField(controller: amount, autofocus: true, keyboardType: const TextInputType.numberWithOptions(decimal: true), decoration: const InputDecoration(labelText: 'Amount (₹)', prefixText: '₹ ')),
        TextField(controller: note, maxLength: 80, decoration: const InputDecoration(labelText: 'For (optional)', hintText: 'e.g. dinner')),
      ]),
      actions: [
        TextButton(onPressed: () => Navigator.pop(d, false), child: const Text('Cancel')),
        FilledButton(onPressed: () => Navigator.pop(d, true), child: const Text('Request')),
      ],
    ),
  );
  if (ok != true || !context.mounted) return;
  final rupees = double.tryParse(amount.text.trim().replaceAll(',', ''));
  if (rupees == null || rupees < 1) return _toast(context, 'Enter an amount of ₹1 or more.');
  try {
    await ApiService.post('/api/personal-chats/$threadId/payment-request', {
      'amountPaise': (rupees * 100).round(),
      if (note.text.trim().isNotEmpty) 'note': note.text.trim(),
    });
    onSent?.call();
  } catch (e) {
    if (context.mounted) _toast(context, _err(e, 'Could not send the request.'));
  }
}

/// "Pay": opens my UPI app to the other person's UPI ID.
Future<void> payPeer(BuildContext context, int threadId, String peerName) async {
  Map? upi;
  try {
    upi = ((await ApiService.get('/api/personal-chats/$threadId/peer-upi')) as Map)['upi'] as Map?;
  } catch (e) {
    return _toast(context, _err(e, 'Could not load their UPI ID.'));
  }
  if (!context.mounted) return;
  if (upi == null) {
    return _toast(context, "$peerName hasn't added a UPI ID on NeuraTalk yet. Ask them to send a payment request.");
  }
  final amount = TextEditingController();
  final ok = await showDialog<bool>(
    context: context,
    builder: (d) => AlertDialog(
      title: Text('Pay $peerName'),
      content: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text('To ${upi!['payeeName']} · ${upi['upiId']}', style: TextStyle(color: AppColors.textSecondary)),
        TextField(controller: amount, autofocus: true, keyboardType: const TextInputType.numberWithOptions(decimal: true), decoration: const InputDecoration(labelText: 'Amount (₹)', prefixText: '₹ ')),
        const SizedBox(height: 8),
        Text('Your UPI app opens to finish the payment.', style: TextStyle(color: AppColors.textMuted, fontSize: 12.5)),
      ]),
      actions: [
        TextButton(onPressed: () => Navigator.pop(d, false), child: const Text('Cancel')),
        FilledButton(onPressed: () => Navigator.pop(d, true), child: const Text('Open UPI app')),
      ],
    ),
  );
  if (ok != true || !context.mounted) return;
  final rupees = double.tryParse(amount.text.trim().replaceAll(',', ''));
  if (rupees == null || rupees < 1) return _toast(context, 'Enter an amount of ₹1 or more.');
  final uri = Uri(scheme: 'upi', host: 'pay', queryParameters: {
    'pa': '${upi['upiId']}', 'pn': '${upi['payeeName']}', 'am': rupees.toStringAsFixed(2), 'cu': 'INR', 'tn': 'NeuraTalk',
  });
  var opened = false;
  try {
    opened = await launchUrl(uri, mode: LaunchMode.externalApplication);
  } catch (_) {}
  if (!opened && context.mounted) _toast(context, 'No UPI app found. Pay ${upi['upiId']} from any UPI app.');
}

const _statusText = {
  'requested': 'Waiting for payment',
  'payer_paid': 'Paid · waiting for confirmation',
  'paid': 'Paid ✓',
  'declined': 'Declined',
  'cancelled': 'Cancelled',
};

/// The request card inside the chat, for both people.
class P2pPaymentCard extends StatefulWidget {
  const P2pPaymentCard({super.key, required this.payment, required this.myUserId, this.onChanged});
  final Map payment;
  final int? myUserId;
  final VoidCallback? onChanged;

  @override
  State<P2pPaymentCard> createState() => _P2pPaymentCardState();
}

class _P2pPaymentCardState extends State<P2pPaymentCard> {
  bool _busy = false;
  Map get p => widget.payment;
  bool get _iPay => widget.myUserId != null && p['payerId'] == widget.myUserId;
  bool get _iAsked => widget.myUserId != null && p['requesterId'] == widget.myUserId;

  Future<void> _run(Future<void> Function() action) async {
    setState(() => _busy = true);
    try {
      await action();
      widget.onChanged?.call();
    } catch (e) {
      if (mounted) _toast(context, _err(e, 'Could not update the payment.'));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _pay() async {
    var opened = false;
    try {
      opened = await launchUrl(Uri.parse('${p['upiLink']}'), mode: LaunchMode.externalApplication);
    } catch (_) {}
    if (!opened && mounted) _toast(context, 'No UPI app found. Pay ${p['upiId']} from any UPI app.');
  }

  Future<void> _paid() async {
    final ctrl = TextEditingController();
    final ref = await showDialog<String>(
      context: context,
      builder: (d) => AlertDialog(
        title: const Text("I've paid"),
        content: TextField(controller: ctrl, maxLength: 30, decoration: const InputDecoration(labelText: 'UTR / reference (optional)')),
        actions: [
          TextButton(onPressed: () => Navigator.pop(d), child: const Text('Cancel')),
          FilledButton(onPressed: () => Navigator.pop(d, ctrl.text.trim()), child: const Text('Done')),
        ],
      ),
    );
    if (ref == null) return;
    await _run(() => ApiService.post('/api/personal-payments/${p['requestId']}/paid', {if (ref.isNotEmpty) 'reference': ref}));
  }

  @override
  Widget build(BuildContext context) {
    final status = '${p['status']}';
    final color = status == 'paid' ? AppColors.green : (status == 'declined' || status == 'cancelled') ? AppColors.textMuted : AppColors.orange;
    final open = status == 'requested' || status == 'payer_paid';
    return Container(
      margin: const EdgeInsets.only(top: 4, bottom: 4),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(color: AppColors.surface, borderRadius: BorderRadius.circular(12), border: Border.all(color: AppColors.border)),
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        Text(_iAsked ? 'You requested' : 'Requested from you', style: TextStyle(color: AppColors.textSecondary, fontSize: 12.5)),
        Text(rupeesText(p['amountPaise'] as num), style: TextStyle(color: AppColors.ink, fontSize: 24, fontWeight: FontWeight.w800)),
        if ((p['note'] ?? '').toString().isNotEmpty) Text('${p['note']}', style: TextStyle(color: AppColors.textSecondary)),
        const SizedBox(height: 4),
        Text(_statusText[status] ?? status, style: TextStyle(color: color, fontWeight: FontWeight.w700, fontSize: 13)),
        if (_iPay && status == 'requested') ...[
          const SizedBox(height: 8),
          FilledButton.icon(onPressed: _busy ? null : _pay, icon: const Icon(Icons.payment), label: const Text('Pay with UPI app')),
          Row(children: [
            Expanded(child: TextButton(onPressed: _busy ? null : _paid, child: const Text("I've paid"))),
            Expanded(child: TextButton(onPressed: _busy ? null : () => _run(() => ApiService.post('/api/personal-payments/${p['requestId']}/decline', {})), child: const Text('Decline'))),
          ]),
        ],
        if (_iAsked && open) ...[
          const SizedBox(height: 8),
          Row(children: [
            Expanded(child: FilledButton(onPressed: _busy ? null : () => _run(() => ApiService.patch('/api/personal-payments/${p['requestId']}', {'status': 'paid'})), child: const Text('Money received'))),
            const SizedBox(width: 8),
            TextButton(onPressed: _busy ? null : () => _run(() => ApiService.patch('/api/personal-payments/${p['requestId']}', {'status': 'cancelled'})), child: const Text('Cancel')),
          ]),
        ],
      ]),
    );
  }
}
