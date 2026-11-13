import 'dart:async';

import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

import '../services/api_service.dart';
import '../theme/app_theme.dart';

/// The message a reply quotes, shown at the top of the reply bubble.
class QuotedMessage extends StatelessWidget {
  const QuotedMessage({super.key, required this.quoted, required this.fromLabel, this.onTap});
  final Map quoted;
  final String fromLabel;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final type = quoted['messageType']?.toString();
    final icon = switch (type) {
      'image' => Icons.photo_outlined,
      'video' => Icons.videocam_outlined,
      'document' => Icons.description_outlined,
      'voice' => Icons.mic_none,
      'location' => Icons.location_on_outlined,
      _ => null,
    };
    return GestureDetector(
      onTap: onTap,
      child: Container(
        margin: const EdgeInsets.only(bottom: 6),
        padding: const EdgeInsets.fromLTRB(8, 6, 8, 6),
        decoration: BoxDecoration(
          color: AppColors.ink.withValues(alpha: 0.06),
          borderRadius: BorderRadius.circular(8),
          border: Border(left: BorderSide(color: AppColors.cyan, width: 3)),
        ),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, mainAxisSize: MainAxisSize.min, children: [
          Text(fromLabel, style: TextStyle(color: AppColors.cyan, fontSize: 12, fontWeight: FontWeight.w700)),
          const SizedBox(height: 2),
          Row(mainAxisSize: MainAxisSize.min, children: [
            if (icon != null) ...[Icon(icon, size: 14, color: AppColors.textSecondary), const SizedBox(width: 4)],
            Flexible(
              child: Text(quoted['content']?.toString() ?? '', maxLines: 2, overflow: TextOverflow.ellipsis,
                  style: TextStyle(color: AppColors.textSecondary, fontSize: 13)),
            ),
          ]),
        ]),
      ),
    );
  }
}

/// "Replying to …" strip above the message box.
class ReplyBar extends StatelessWidget {
  const ReplyBar({super.key, required this.message, required this.fromLabel, required this.onClose});
  final Map message;
  final String fromLabel;
  final VoidCallback onClose;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.fromLTRB(12, 8, 4, 8),
      decoration: BoxDecoration(color: AppColors.surface, border: Border(top: BorderSide(color: AppColors.border))),
      child: Row(children: [
        Icon(Icons.reply, color: AppColors.cyan, size: 20),
        const SizedBox(width: 8),
        Expanded(child: QuotedMessage(quoted: message, fromLabel: 'Replying to $fromLabel')),
        IconButton(tooltip: 'Cancel reply', icon: const Icon(Icons.close), onPressed: onClose),
      ]),
    );
  }
}

/// Tells the other side "typing…" at most every 3 seconds while typing.
class TypingPinger {
  TypingPinger(this.endpoint);
  final String endpoint;
  DateTime _last = DateTime.fromMillisecondsSinceEpoch(0);

  void onChanged(String text) {
    if (text.trim().isEmpty) return;
    final now = DateTime.now();
    if (now.difference(_last) < const Duration(seconds: 3)) return;
    _last = now;
    unawaited(ApiService.post(endpoint, {}).then<void>((_) {}).catchError((Object _) {}));
  }
}

/// Buttons under a business message (quick reply / website / call).
/// [onQuickReply] is null when the viewer can't tap them (the business itself).
class MessageButtonsView extends StatelessWidget {
  const MessageButtonsView({super.key, required this.buttons, this.onQuickReply, this.tappedId});
  final List buttons;
  final void Function(Map button)? onQuickReply;
  /// The quick reply this customer already chose, if any.
  final String? tappedId;

  Future<void> _open(BuildContext context, Map b) async {
    final type = b['type'];
    final uri = type == 'url' ? Uri.tryParse('${b['url']}') : type == 'call' ? Uri.tryParse('tel:${'${b['phone']}'.replaceAll(' ', '')}') : null;
    if (uri == null) return;
    if (!await launchUrl(uri, mode: LaunchMode.externalApplication) && context.mounted) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text("Couldn't open that.")));
    }
  }

  @override
  Widget build(BuildContext context) {
    final list = buttons.whereType<Map>().toList();
    if (list.isEmpty) return const SizedBox.shrink();
    return Padding(
      padding: const EdgeInsets.only(top: 6),
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        for (final b in list)
          Padding(
            padding: const EdgeInsets.only(top: 4),
            child: OutlinedButton.icon(
              style: OutlinedButton.styleFrom(
                foregroundColor: AppColors.cyan,
                side: BorderSide(color: tappedId != null && tappedId == b['id'] ? AppColors.cyan : AppColors.border),
                visualDensity: VisualDensity.compact,
              ),
              icon: Icon(
                b['type'] == 'url' ? Icons.open_in_new : b['type'] == 'call' ? Icons.call_outlined : Icons.reply,
                size: 16,
              ),
              label: Text('${b['title']}', overflow: TextOverflow.ellipsis),
              onPressed: b['type'] == 'quick_reply'
                  ? (onQuickReply == null || tappedId != null ? null : () => onQuickReply!(b))
                  : () => _open(context, b),
            ),
          ),
      ]),
    );
  }
}

/// "typing…" in the chat header.
class TypingLabel extends StatelessWidget {
  const TypingLabel({super.key});
  @override
  Widget build(BuildContext context) =>
      Text('typing…', style: TextStyle(color: AppColors.green, fontSize: 13, fontWeight: FontWeight.w600));
}

/// List menu from a business: one button opens the options; the chosen one
/// goes back as the customer's reply. [onPick] is null for the business itself.
class MessageListView extends StatelessWidget {
  const MessageListView({super.key, required this.list, this.onPick, this.pickedId});
  final Map list;
  final void Function(Map row)? onPick;
  final String? pickedId;

  List<Map> get _sections => (list['sections'] as List? ?? const []).whereType<Map>().toList();

  Future<void> _open(BuildContext context) async {
    final row = await showModalBottomSheet<Map>(
      context: context,
      isScrollControlled: true,
      backgroundColor: AppColors.surface,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(20))),
      builder: (sheet) => SafeArea(
        child: ConstrainedBox(
          constraints: BoxConstraints(maxHeight: MediaQuery.of(sheet).size.height * 0.75),
          child: ListView(shrinkWrap: true, padding: const EdgeInsets.symmetric(vertical: 12), children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 4, 20, 8),
              child: Text('${list['button']}', style: TextStyle(color: AppColors.ink, fontSize: 17, fontWeight: FontWeight.w800)),
            ),
            for (final s in _sections) ...[
              if ((s['title'] ?? '').toString().isNotEmpty)
                Padding(
                  padding: const EdgeInsets.fromLTRB(20, 12, 20, 4),
                  child: Text('${s['title']}'.toUpperCase(), style: TextStyle(color: AppColors.cyan, fontSize: 12.5, fontWeight: FontWeight.w700)),
                ),
              for (final r in (s['rows'] as List? ?? const []).whereType<Map>())
                ListTile(
                  title: Text('${r['title']}', style: TextStyle(color: AppColors.ink, fontWeight: FontWeight.w600)),
                  subtitle: (r['description'] ?? '').toString().isEmpty ? null : Text('${r['description']}', style: TextStyle(color: AppColors.textSecondary)),
                  trailing: Icon(pickedId == r['id'] ? Icons.radio_button_checked : Icons.radio_button_off, color: AppColors.cyan),
                  onTap: onPick == null || pickedId != null ? null : () => Navigator.pop(sheet, r),
                ),
            ],
          ]),
        ),
      ),
    );
    if (row != null) onPick?.call(row);
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(top: 6),
      child: OutlinedButton.icon(
        style: OutlinedButton.styleFrom(foregroundColor: AppColors.cyan, side: BorderSide(color: AppColors.border), visualDensity: VisualDensity.compact),
        icon: const Icon(Icons.list, size: 18),
        label: Text('${list['button']}', overflow: TextOverflow.ellipsis),
        onPressed: () => _open(context),
      ),
    );
  }
}

/// A contact card a business shared: call the number.
class ContactCardView extends StatelessWidget {
  const ContactCardView({super.key, required this.contact});
  final Map contact;

  @override
  Widget build(BuildContext context) {
    final phone = '${contact['phone'] ?? ''}';
    return Container(
      margin: const EdgeInsets.only(top: 4),
      padding: const EdgeInsets.all(10),
      decoration: BoxDecoration(color: AppColors.blueTint, borderRadius: BorderRadius.circular(12)),
      child: Row(children: [
        CircleAvatar(backgroundColor: AppColors.cyan, child: const Icon(Icons.person, color: AppColors.onAccent)),
        const SizedBox(width: 10),
        Expanded(
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text('${contact['name']}', maxLines: 2, overflow: TextOverflow.ellipsis, style: TextStyle(color: AppColors.ink, fontWeight: FontWeight.w700)),
            if ((contact['organization'] ?? '').toString().isNotEmpty)
              Text('${contact['organization']}', maxLines: 1, overflow: TextOverflow.ellipsis, style: TextStyle(color: AppColors.textSecondary, fontSize: 12.5)),
            Text(phone, style: TextStyle(color: AppColors.textSecondary, fontSize: 13)),
          ]),
        ),
        IconButton(
          tooltip: 'Call',
          icon: Icon(Icons.call_outlined, color: AppColors.cyan),
          onPressed: () => launchUrl(Uri.parse('tel:${phone.replaceAll(' ', '')}'), mode: LaunchMode.externalApplication),
        ),
      ]),
    );
  }
}

String rupeesText(num paise) {
  final r = paise / 100;
  return '₹${r == r.roundToDouble() ? r.toStringAsFixed(0) : r.toStringAsFixed(2)}';
}

const _paymentStatusText = {
  'requested': 'Waiting for payment',
  'customer_paid': 'You said you paid · the business is checking',
  'paid': 'Paid ✓',
  'cancelled': 'Cancelled',
};

/// UPI payment request in a business chat. The customer pays straight to the
/// business's UPI ID in their own UPI app; NeuraTalk never touches the money.
class PaymentCardView extends StatefulWidget {
  const PaymentCardView({super.key, required this.payment, this.businessId, this.onChanged, this.businessView = false, this.onSettle});
  final Map payment;
  /// The business the customer is chatting with (customer view).
  final int? businessId;
  final VoidCallback? onChanged;
  /// The business itself is looking at the card.
  final bool businessView;
  /// Business view: mark "paid" or "cancelled".
  final void Function(String status)? onSettle;

  @override
  State<PaymentCardView> createState() => _PaymentCardViewState();
}

class _PaymentCardViewState extends State<PaymentCardView> {
  bool _busy = false;

  Map get p => widget.payment;

  Future<void> _pay() async {
    final uri = Uri.tryParse('${p['upiLink']}');
    var opened = false;
    if (uri != null) {
      try {
        opened = await launchUrl(uri, mode: LaunchMode.externalApplication);
      } catch (_) {}
    }
    if (!mounted || opened) return;
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('No UPI app found. Pay ${rupeesText(p['amountPaise'] as num)} to ${p['upiId']} from any UPI app.')));
  }

  Future<void> _paid() async {
    final ctrl = TextEditingController();
    final ref = await showDialog<String>(
      context: context,
      builder: (d) => AlertDialog(
        title: const Text("I've paid"),
        content: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text('The business will check that ${rupeesText(p['amountPaise'] as num)} reached them.'),
          const SizedBox(height: 12),
          TextField(
            controller: ctrl,
            maxLength: 30,
            decoration: const InputDecoration(labelText: 'UTR / reference (optional)', hintText: '12-digit number from your UPI app'),
          ),
        ]),
        actions: [
          TextButton(onPressed: () => Navigator.pop(d), child: const Text('Cancel')),
          FilledButton(onPressed: () => Navigator.pop(d, ctrl.text.trim()), child: const Text('Tell the business')),
        ],
      ),
    );
    if (ref == null || !mounted) return;
    setState(() => _busy = true);
    try {
      await ApiService.post('/api/messaging/business/${widget.businessId}/payment-requests/${p['requestId']}/paid', {if (ref.isNotEmpty) 'reference': ref});
      widget.onChanged?.call();
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e is ApiException ? e.message : 'Could not send. Try again.')));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final status = '${p['status']}';
    final color = status == 'paid' ? AppColors.green : status == 'cancelled' ? AppColors.textMuted : AppColors.orange;
    final canPay = !widget.businessView && widget.businessId != null && status == 'requested';
    final open = status == 'requested' || status == 'customer_paid';
    return Container(
      margin: const EdgeInsets.only(top: 6),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: AppColors.border),
      ),
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        Row(children: [
          Icon(Icons.currency_rupee, color: AppColors.cyan, size: 20),
          const SizedBox(width: 4),
          Expanded(child: Text(rupeesText(p['amountPaise'] as num), style: TextStyle(color: AppColors.ink, fontSize: 22, fontWeight: FontWeight.w800))),
        ]),
        if ((p['note'] ?? '').toString().isNotEmpty) Text('${p['note']}', style: TextStyle(color: AppColors.textSecondary)),
        const SizedBox(height: 4),
        Text('To ${p['payeeName']} · ${p['upiId']}', style: TextStyle(color: AppColors.textMuted, fontSize: 12.5)),
        const SizedBox(height: 6),
        Text(
          widget.businessView && status == 'customer_paid' ? 'Customer says they paid · check your bank' : widget.businessView && status == 'requested' ? 'Waiting for the customer' : (_paymentStatusText[status] ?? status),
          style: TextStyle(color: color, fontWeight: FontWeight.w700, fontSize: 13),
        ),
        if (canPay) ...[
          const SizedBox(height: 8),
          FilledButton.icon(onPressed: _busy ? null : _pay, icon: const Icon(Icons.payment), label: const Text('Pay with UPI app')),
          TextButton(onPressed: _busy ? null : _paid, child: const Text("I've paid")),
        ],
        if (widget.businessView && widget.onSettle != null && open) ...[
          const SizedBox(height: 8),
          Row(children: [
            Expanded(child: FilledButton(onPressed: () => widget.onSettle!('paid'), child: const Text('Money received'))),
            const SizedBox(width: 8),
            TextButton(onPressed: () => widget.onSettle!('cancelled'), child: const Text('Cancel')),
          ]),
        ],
      ]),
    );
  }
}
