import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../screens/business_messages_screen.dart' show formatBusinessTime;
import '../services/api_service.dart';
import '../theme/app_theme.dart';
import '../utils/money.dart';
import '../widgets/nt_ui.dart';
import 'business_account.dart';

/// Orders customers sent from the catalog. Each step (accept, ready,
/// delivered, cancel) is posted in that customer's chat, so they are
/// notified like any other message.
class BusinessOrdersScreen extends StatefulWidget {
  const BusinessOrdersScreen({super.key});

  @override
  State<BusinessOrdersScreen> createState() => _BusinessOrdersScreenState();
}

class _BusinessOrdersScreenState extends State<BusinessOrdersScreen> {
  List<Map<String, dynamic>> _orders = [];
  Map<String, dynamic> _counts = {};
  bool _openOnly = true;
  bool _loading = true;
  String? _error;
  final Set<int> _busy = {};

  String get _base => context.read<BusinessAccount>().base;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final res = await ApiService.get('$_base/orders${_openOnly ? '?status=open' : ''}');
      if (!mounted) return;
      setState(() {
        _orders = ((res['orders'] as List?) ?? const []).whereType<Map>().map((m) => Map<String, dynamic>.from(m)).toList();
        _counts = Map<String, dynamic>.from((res['counts'] as Map?) ?? const {});
        _loading = false;
        _error = null;
      });
    } catch (e) {
      if (mounted) {
        setState(() {
          _loading = false;
          _error = e is ApiException && e.statusCode == 403 ? 'You need chat access to see orders.' : "Couldn't load orders.";
        });
      }
    }
  }

  static String _rupees(num paise) => formatRupees(paise);

  static const _labels = {
    'placed': 'New',
    'accepted': 'Accepted',
    'ready': 'Ready',
    'delivered': 'Delivered',
    'cancelled': 'Cancelled',
  };
  static const _actions = {
    'accepted': 'Accept',
    'ready': 'Mark ready',
    'delivered': 'Delivered',
    'cancelled': 'Cancel',
  };

  Color _color(String status) => switch (status) {
        'placed' => AppColors.orange,
        'delivered' => AppColors.green,
        'cancelled' => AppColors.red,
        _ => AppColors.cyan,
      };

  Future<void> _set(Map<String, dynamic> order, String status) async {
    String? reason;
    if (status == 'cancelled') {
      final controller = TextEditingController();
      final ok = await showDialog<bool>(
        context: context,
        builder: (d) => AlertDialog(
          title: Text('Cancel order #${order['id']}?'),
          content: TextField(
            controller: controller,
            maxLength: 300,
            decoration: const InputDecoration(hintText: 'Reason the customer will see (e.g. out of stock)'),
          ),
          actions: [
            TextButton(onPressed: () => Navigator.pop(d, false), child: const Text('Keep')),
            TextButton(onPressed: () => Navigator.pop(d, true), child: Text('Cancel order', style: TextStyle(color: AppColors.red))),
          ],
        ),
      );
      if (ok != true) return;
      reason = controller.text.trim();
    }
    final id = (order['id'] as num).toInt();
    setState(() => _busy.add(id));
    try {
      await ApiService.patch('$_base/orders/$id', {'status': status, if (reason != null && reason.isNotEmpty) 'reason': reason});
      await _load();
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e is ApiException ? e.message : 'Could not update the order.')));
      await _load();
    } finally {
      if (mounted) setState(() => _busy.remove(id));
    }
  }

  Widget _card(Map<String, dynamic> o) {
    final id = (o['id'] as num).toInt();
    final status = o['status']?.toString() ?? 'placed';
    final items = ((o['items'] as List?) ?? const []).whereType<Map>().toList();
    final next = ((o['nextStatuses'] as List?) ?? const []).map((e) => e.toString()).toList();
    final busy = _busy.contains(id);
    return Card(
      color: AppColors.surface,
      margin: const EdgeInsets.fromLTRB(12, 6, 12, 6),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14), side: BorderSide(color: AppColors.border)),
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Row(children: [
            Expanded(
              child: Text('#$id · ${o['customerName'] ?? 'Customer'}',
                  maxLines: 1, overflow: TextOverflow.ellipsis, style: TextStyle(color: AppColors.ink, fontWeight: FontWeight.w700, fontSize: 15.5)),
            ),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
              decoration: BoxDecoration(color: _color(status).withValues(alpha: 0.12), borderRadius: BorderRadius.circular(10)),
              child: Text(_labels[status] ?? status, style: TextStyle(color: _color(status), fontSize: 12, fontWeight: FontWeight.w700)),
            ),
          ]),
          const SizedBox(height: 2),
          Text(formatBusinessTime(o['createdAt']), style: TextStyle(color: AppColors.textMuted, fontSize: 12)),
          const SizedBox(height: 8),
          for (final i in items)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 1),
              child: Row(children: [
                Expanded(child: Text('${i['quantity']} × ${i['name']}', style: TextStyle(color: AppColors.ink))),
                Text(i['pricePaise'] is num ? _rupees((i['pricePaise'] as num) * (i['quantity'] as num)) : 'Price?',
                    style: TextStyle(color: AppColors.textSecondary)),
              ]),
            ),
          Divider(color: AppColors.border, height: 16),
          Row(children: [
            Text('Total', style: TextStyle(color: AppColors.textSecondary)),
            const Spacer(),
            Text(_rupees((o['totalPaise'] as num?) ?? 0), style: TextStyle(color: AppColors.ink, fontWeight: FontWeight.w700)),
          ]),
          if (o['note'] != null) ...[
            const SizedBox(height: 6),
            Text('Note: ${o['note']}', style: TextStyle(color: AppColors.ink, fontStyle: FontStyle.italic)),
          ],
          if (o['cancelReason'] != null) ...[
            const SizedBox(height: 6),
            Text(o['cancelReason'].toString(), style: TextStyle(color: AppColors.red, fontSize: 13)),
          ],
          if (next.isNotEmpty) ...[
            const SizedBox(height: 10),
            Wrap(spacing: 8, runSpacing: 6, children: [
              for (final s in next)
                s == 'cancelled'
                    ? TextButton(onPressed: busy ? null : () => _set(o, s), child: Text(_actions[s]!, style: TextStyle(color: AppColors.red)))
                    : FilledButton(onPressed: busy ? null : () => _set(o, s), child: Text(_actions[s] ?? s)),
            ]),
          ],
        ]),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final openCount = ['placed', 'accepted', 'ready'].fold<int>(0, (sum, s) => sum + ((_counts[s] as num?)?.toInt() ?? 0));
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(title: const Text('Orders')),
      body: Column(children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(12, 10, 12, 4),
          child: Row(children: [
            ChoiceChip(
              label: Text('Open${openCount > 0 ? ' ($openCount)' : ''}'),
              selected: _openOnly,
              onSelected: (_) { setState(() { _openOnly = true; _loading = true; }); _load(); },
            ),
            const SizedBox(width: 8),
            ChoiceChip(
              label: const Text('All'),
              selected: !_openOnly,
              onSelected: (_) { setState(() { _openOnly = false; _loading = true; }); _load(); },
            ),
          ]),
        ),
        Expanded(
          child: _loading
              ? Center(child: CircularProgressIndicator(color: AppColors.cyan))
              : RefreshIndicator(
                  onRefresh: _load,
                  child: _error != null
                      ? ListView(children: [NtEmptyState(icon: Icons.receipt_long_outlined, title: _error!, message: 'Pull down to try again.', error: true)])
                      : _orders.isEmpty
                          ? ListView(children: [
                              NtEmptyState(
                                icon: Icons.receipt_long_outlined,
                                title: _openOnly ? 'No open orders' : 'No orders yet',
                                message: 'Customers order from your catalog in the chat. Add items in Tools → Catalog.',
                              ),
                            ])
                          : ListView(padding: const EdgeInsets.only(bottom: 24), children: [for (final o in _orders) _card(o)]),
                ),
        ),
      ]),
    );
  }
}
