import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart' show Clipboard, ClipboardData;
import 'package:provider/provider.dart';
import 'package:url_launcher/url_launcher.dart';

import '../services/api_service.dart';
import '../services/call_service.dart';
import '../services/media_store.dart';
import '../theme/app_theme.dart';
import '../utils/money.dart';
import '../widgets/attachment_picker.dart';
import '../widgets/chat_attachments.dart';
import '../widgets/nt_ui.dart';
import '../widgets/reactions.dart';
import '../widgets/link_preview.dart';
import '../widgets/business_chat_extras.dart';
import '../widgets/location_share.dart';
import 'call_screen.dart';

/// Messages from businesses (NeuraTalk's own business chat): order updates,
/// verification codes, offers and two-way chats, in your own language.
class BusinessMessagesScreen extends StatefulWidget {
  const BusinessMessagesScreen({super.key});

  @override
  State<BusinessMessagesScreen> createState() => _BusinessMessagesScreenState();
}

class _BusinessMessagesScreenState extends State<BusinessMessagesScreen> {
  List<Map<String, dynamic>> _threads = [];
  List<Map<String, dynamic>> _found = [];
  bool _loading = true;
  bool _searching = false;
  String? _error;
  String _query = '';
  Timer? _refresh;
  Timer? _debounce;

  @override
  void initState() {
    super.initState();
    _load();
    _refresh = Timer.periodic(const Duration(seconds: 15), (_) => _load(quiet: true));
  }

  @override
  void dispose() {
    _refresh?.cancel();
    _debounce?.cancel();
    super.dispose();
  }

  Future<void> _load({bool quiet = false}) async {
    if (!quiet) setState(() => _loading = _threads.isEmpty);
    try {
      final res = await ApiService.get('/api/messaging/business-threads');
      final list = (res is Map ? res['threads'] : null) as List? ?? const [];
      if (!mounted) return;
      setState(() {
        _threads = list.whereType<Map>().map((t) => Map<String, dynamic>.from(t)).toList();
        _error = null;
        _loading = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        if (!quiet || _threads.isEmpty) _error = e is ApiException ? e.message : "Check your connection and try again.";
      });
    }
  }

  void _onSearch(String value) {
    setState(() => _query = value);
    _debounce?.cancel();
    if (value.trim().length < 2) {
      setState(() => _found = []);
      return;
    }
    _debounce = Timer(const Duration(milliseconds: 350), () async {
      setState(() => _searching = true);
      try {
        final res = await ApiService.get('/api/messaging/businesses?q=${Uri.encodeQueryComponent(value.trim())}');
        final list = (res is Map ? res['businesses'] : null) as List? ?? const [];
        if (mounted) setState(() => _found = list.whereType<Map>().map((b) => Map<String, dynamic>.from(b)).toList());
      } catch (_) {
        if (mounted) setState(() => _found = []);
      } finally {
        if (mounted) setState(() => _searching = false);
      }
    });
  }

  Future<void> _open(int businessId, String name) async {
    await Navigator.push(context, MaterialPageRoute(builder: (_) => BusinessChatScreen(businessId: businessId, businessName: name)));
    _load(quiet: true);
  }

  @override
  Widget build(BuildContext context) {
    final searchingNow = _query.trim().length >= 2;
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(title: const Text('Business messages')),
      body: RefreshIndicator(
        onRefresh: _load,
        color: AppColors.cyan,
        child: ListView(
          padding: const EdgeInsets.only(bottom: 32),
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 8, 16, 8),
              child: TextField(
                onChanged: _onSearch,
                decoration: InputDecoration(
                  hintText: 'Search businesses',
                  prefixIcon: Icon(Icons.search, color: AppColors.textMuted),
                  isDense: true,
                  contentPadding: NtSearch.padding,
                  prefixIconConstraints: NtSearch.iconBox,
                  border: NtSearch.border(AppColors.border),
                  enabledBorder: NtSearch.border(AppColors.border),
                  focusedBorder: NtSearch.border(AppColors.cyan, 1.5),
                ),
              ),
            ),
            if (searchingNow) ...[
              if (_searching)
                Padding(padding: const EdgeInsets.all(16), child: Center(child: CircularProgressIndicator(color: AppColors.cyan)))
              else if (_found.isEmpty)
                Padding(
                  padding: const EdgeInsets.all(24),
                  child: Center(child: Text('No business found for "${_query.trim()}"', style: TextStyle(color: AppColors.textMuted))),
                )
              else
                for (final b in _found)
                  ListTile(
                    leading: NtAvatar(name: b['name']?.toString() ?? 'Business', avatarUrl: b['logoUrl'] as String?),
                    title: Row(children: [
                      Flexible(child: Text(b['name']?.toString() ?? '', overflow: TextOverflow.ellipsis, style: TextStyle(color: AppColors.ink, fontWeight: FontWeight.w600))),
                      if (b['verified'] == true) Padding(padding: const EdgeInsets.only(left: 4), child: Icon(Icons.verified, size: 16, color: AppColors.cyan)),
                    ]),
                    subtitle: Text([_cap(b['category']), b['city']].where((v) => v != null && '$v'.isNotEmpty).join(' · '),
                        style: TextStyle(color: AppColors.textSecondary)),
                    onTap: () => _open((b['id'] as num).toInt(), b['name']?.toString() ?? 'Business'),
                  ),
              Divider(color: AppColors.border),
            ],
            if (_loading)
              Padding(padding: const EdgeInsets.all(32), child: Center(child: CircularProgressIndicator(color: AppColors.cyan)))
            else if (_error != null)
              NtEmptyState(icon: Icons.wifi_off, title: "Couldn't load business messages", message: _error!, error: true, actionLabel: 'Try again', onAction: _load)
            else if (_threads.isEmpty && !searchingNow)
              const NtEmptyState(
                icon: Icons.storefront_outlined,
                title: 'No business messages yet',
                message: 'Order updates, verification codes and offers from businesses you use will show up here. Search above to message a business.',
              )
            else
              for (final t in _threads) _tile(t),
          ],
        ),
      ),
    );
  }

  Widget _tile(Map<String, dynamic> t) {
    final last = (t['lastMessage'] as Map?) ?? const {};
    final unread = (t['unreadCount'] as num?)?.toInt() ?? 0;
    final name = t['businessName']?.toString() ?? 'Business';
    final preview = '${last['fromBusiness'] == false ? 'You: ' : ''}${last['content'] ?? ''}';
    return ListTile(
      leading: NtAvatar(name: name, avatarUrl: t['logoUrl'] as String?),
      title: Row(children: [
        // The name takes all the room it needs; the tick stays right after it.
        Expanded(
          child: Row(children: [
            Flexible(child: Text(name, maxLines: 1, overflow: TextOverflow.ellipsis,
                style: TextStyle(color: AppColors.ink, fontWeight: unread > 0 ? FontWeight.w700 : FontWeight.w600))),
            if (t['verified'] == true) Padding(padding: const EdgeInsets.only(left: 4), child: Icon(Icons.verified, size: 16, color: AppColors.cyan)),
          ]),
        ),
        const SizedBox(width: 8),
        Text(formatBusinessTime(last['createdAt']), style: TextStyle(color: unread > 0 ? AppColors.cyan : AppColors.textMuted, fontSize: 12)),
      ]),
      subtitle: Row(children: [
        Expanded(child: Text(preview, maxLines: 1, overflow: TextOverflow.ellipsis,
            style: TextStyle(color: unread > 0 ? AppColors.ink : AppColors.textSecondary))),
        if (unread > 0)
          Container(
            margin: const EdgeInsets.only(left: 8),
            padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 2),
            decoration: BoxDecoration(color: AppColors.cyan, borderRadius: BorderRadius.circular(10)),
            child: Text('$unread', semanticsLabel: '$unread unread', style: const TextStyle(color: AppColors.onAccent, fontSize: 12, fontWeight: FontWeight.w700)),
          ),
      ]),
      onTap: () => _open((t['businessId'] as num).toInt(), name),
    );
  }
}

String formatBusinessTime(dynamic raw) {
  final dt = DateTime.tryParse(raw?.toString() ?? '')?.toLocal();
  if (dt == null) return '';
  final now = DateTime.now();
  if (dt.year == now.year && dt.month == now.month && dt.day == now.day) {
    final h = dt.hour % 12 == 0 ? 12 : dt.hour % 12;
    return '$h:${dt.minute.toString().padLeft(2, '0')} ${dt.hour < 12 ? 'AM' : 'PM'}';
  }
  return '${dt.day}/${dt.month}/${dt.year % 100}';
}

/// "12:48 PM" -- the time inside a message bubble.
String formatClockTime(dynamic raw) {
  final dt = DateTime.tryParse(raw?.toString() ?? '')?.toLocal();
  if (dt == null) return '';
  final h = dt.hour % 12 == 0 ? 12 : dt.hour % 12;
  return '$h:${dt.minute.toString().padLeft(2, '0')} ${dt.hour < 12 ? 'AM' : 'PM'}';
}

String _rupees(dynamic paise) => paise is num ? formatRupees(paise) : 'Price on request';

/// One business chat: messages in your language (tap to see the original),
/// photos and files, the business's catalog, and a translated call.
class BusinessChatScreen extends StatefulWidget {
  const BusinessChatScreen({super.key, required this.businessId, this.businessName});

  final int businessId;
  final String? businessName;

  @override
  State<BusinessChatScreen> createState() => _BusinessChatScreenState();
}

class _BusinessChatScreenState extends State<BusinessChatScreen> {
  static const _ticks = {'queued': 'Sending', 'sent': 'Sent', 'delivered': 'Delivered', 'read': 'Seen', 'failed': 'Not delivered'};

  final _input = TextEditingController();
  List<Map<String, dynamic>> _messages = [];
  List<Map<String, dynamic>> _catalog = [];
  Map<String, dynamic>? _profile;
  final Set<int> _showOriginal = {};
  int? _me;
  String? _name;
  bool _loading = true;
  bool _sending = false;
  bool _calling = false;
  String? _error;
  bool? _offers;
  bool _blocked = false;
  int? _lastReadId;
  Timer? _poll;

  @override
  void initState() {
    super.initState();
    _name = widget.businessName;
    _loadProfile();
    _load();
    _loadPreferences();
    _loadCatalog();
    // Live enough for a chat; push notifications cover the closed app.
    _poll = Timer.periodic(const Duration(seconds: 4), (_) => _load(quiet: true));
  }

  @override
  void dispose() {
    _poll?.cancel();
    _input.dispose();
    super.dispose();
  }

  String get _base => '/api/messaging/business/${widget.businessId}';

  Future<void> _loadProfile() async {
    try {
      final res = await ApiService.get('$_base/profile');
      final b = res['business'];
      if (mounted && b is Map) {
        setState(() {
          _profile = Map<String, dynamic>.from(b);
          _name ??= _profile!['name']?.toString();
        });
      }
    } catch (_) {
      if (_name != null) return;
      try {
        final res = await ApiService.get(_base);
        if (mounted) setState(() => _name = (res['business'] as Map?)?['name']?.toString());
      } catch (_) {}
    }
  }

  Future<void> _loadCatalog() async {
    try {
      final res = await ApiService.get('$_base/catalog');
      final list = (res['items'] as List? ?? const []).whereType<Map>().map((m) => Map<String, dynamic>.from(m)).toList();
      if (mounted) setState(() => _catalog = list);
    } catch (_) {}
  }

  Future<void> _loadPreferences() async {
    try {
      final res = await ApiService.get('$_base/preferences');
      if (mounted && res['known'] == true) {
        setState(() {
          _offers = res['promotions'] == true;
          _blocked = res['blocked'] == true;
        });
      }
    } catch (_) {}
  }

  Future<void> _load({bool quiet = false}) async {
    try {
      final res = await ApiService.get('$_base/messages?limit=100');
      final list = (res['messages'] as List? ?? const []).whereType<Map>().map((m) => Map<String, dynamic>.from(m)).toList();
      if (!mounted) return;
      setState(() {
        _messages = list.reversed.toList();
        _me = (res['viewerParticipantId'] as num?)?.toInt();
        _businessTyping = res['businessTyping'] == true;
        _loading = false;
        _error = null;
      });
      final newest = list.isEmpty ? null : (list.first['id'] as num?)?.toInt();
      if (newest != null && newest != _lastReadId) {
        _lastReadId = newest;
        unawaited(ApiService.post('$_base/read', {}).catchError((_) => <String, dynamic>{}));
        // Order status changes arrive as new messages from the shop.
        unawaited(_loadOrders());
      }
    } catch (e) {
      if (!mounted || quiet) return;
      setState(() {
        _loading = false;
        _error = e is ApiException ? e.message : "Check your connection and try again.";
      });
    }
  }

  /// The message being replied to, shown above the box until sent.
  Map<String, dynamic>? _replyTo;
  bool _businessTyping = false;
  late final TypingPinger _typing = TypingPinger('$_base/typing');

  bool _isMine(Map m) => _me != null && (m['senderParticipantId'] as num?)?.toInt() == _me;

  /// Which quick reply I already tapped on a business message (one per message).
  String? _tappedButton(int messageId) {
    for (final x in _messages) {
      final br = (x['metadata'] as Map?)?['buttonReply'] as Map?;
      if (br != null && (br['messageId'] as num?)?.toInt() == messageId && _isMine(x)) return br['buttonId']?.toString();
    }
    return null;
  }

  Future<void> _send({Map<String, dynamic>? attachment, Map<String, dynamic>? location, Map<String, dynamic>? buttonReply}) async {
    final text = _input.text.trim();
    if ((text.isEmpty && attachment == null && location == null && buttonReply == null) || _sending) return;
    setState(() => _sending = true);
    try {
      await ApiService.post('$_base/messages', {
        'content': location == null && buttonReply == null ? text : '',
        if (attachment != null) 'attachment': attachment,
        if (location != null) 'location': location,
        if (buttonReply != null) 'buttonReply': buttonReply,
        if (_replyTo != null && buttonReply == null) 'replyToMessageId': _replyTo!['id'],
      });
      if (location == null && buttonReply == null) _input.clear();
      _replyTo = null;
      await _load(quiet: true);
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e is ApiException ? e.message : "Message not sent. Try again.")));
      }
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  Future<void> _shareLocation() async {
    await showShareLocationSheet(context, onSend: (lat, lng, address) async {
      await _send(location: {'latitude': lat, 'longitude': lng, if (address != null && address.isNotEmpty) 'address': address});
    });
  }

  Future<void> _attach() async {
    final picked = await AttachmentPicker.show(context, onLocation: _shareLocation);
    for (final (file, name) in picked.take(5)) {
      try {
        setState(() => _sending = true);
        final path = await MediaStore.upload(file, name);
        final size = await file.length();
        if (mounted) setState(() => _sending = false);
        await _send(attachment: {'url': path, 'mimeType': MediaStore.contentTypeFor(name), 'sizeBytes': size, 'title': name});
      } catch (_) {
        if (mounted) {
          setState(() => _sending = false);
          ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Could not send that file. Try again.')));
        }
      }
    }
  }

  Future<void> _call() async {
    if (_calling) return;
    setState(() => _calling = true);
    final callService = context.read<CallService>();
    try {
      final target = await ApiService.get('$_base/call-target');
      final session = await callService.startCall(calleeIdentifier: target['calleeIdentifier'].toString(), callType: 'voice');
      if (!mounted) return;
      Navigator.push(context, MaterialPageRoute(builder: (_) => CallScreen(session: session, callService: callService)));
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(
            content: Text(e is ApiException ? e.message : "Can't call right now. Send a message instead.")));
      }
    } finally {
      if (mounted) setState(() => _calling = false);
    }
  }

  /// Orders I placed here, by the chat message that carries each one.
  Map<int, Map<String, dynamic>> _orders = {};
  final Map<int, int> _cart = {};

  Future<void> _loadOrders() async {
    try {
      final res = await ApiService.get('$_base/orders');
      final byMessage = <int, Map<String, dynamic>>{};
      for (final o in (res['orders'] as List? ?? const []).whereType<Map>()) {
        final messageId = (o['messageId'] as num?)?.toInt();
        if (messageId != null) byMessage[messageId] = Map<String, dynamic>.from(o);
      }
      if (mounted) setState(() => _orders = byMessage);
    } catch (_) {}
  }

  int get _cartCount => _cart.values.fold(0, (a, b) => a + b);
  int get _cartTotal => _cart.entries.fold(0, (sum, e) {
        final item = _catalog.firstWhere((c) => (c['id'] as num?)?.toInt() == e.key, orElse: () => const {});
        return sum + ((item['pricePaise'] as num?)?.toInt() ?? 0) * e.value;
      });

  Future<void> _placeOrder(String note) async {
    if (_cart.isEmpty || _sending) return;
    setState(() => _sending = true);
    try {
      await ApiService.post('$_base/orders', {
        'items': [for (final e in _cart.entries) {'itemId': e.key, 'quantity': e.value}],
        if (note.trim().isNotEmpty) 'note': note.trim(),
      });
      _cart.clear();
      await _load(quiet: true);
      await _loadOrders();
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Order sent. The shop will confirm it here.')));
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e is ApiException ? e.message : 'Order not sent. Try again.')));
      _loadCatalog();
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  Future<void> _cancelOrder(Map<String, dynamic> order) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (d) => AlertDialog(
        title: Text('Cancel order #${order['id']}?'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(d, false), child: const Text('Keep')),
          TextButton(onPressed: () => Navigator.pop(d, true), child: Text('Cancel order', style: TextStyle(color: AppColors.red))),
        ],
      ),
    );
    if (ok != true) return;
    try {
      await ApiService.post('$_base/orders/${order['id']}/cancel', {});
      await _load(quiet: true);
      await _loadOrders();
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e is ApiException ? e.message : 'Could not cancel.')));
    }
  }

  static const _orderStatus = {
    'placed': ('Waiting for the shop', Icons.schedule),
    'accepted': ('Accepted', Icons.thumb_up_alt_outlined),
    'ready': ('Ready', Icons.inventory_2_outlined),
    'delivered': ('Delivered', Icons.check_circle_outline),
    'cancelled': ('Cancelled', Icons.cancel_outlined),
  };

  Widget _orderStrip(Map<String, dynamic> order) {
    final status = order['status']?.toString() ?? 'placed';
    final (label, icon) = _orderStatus[status] ?? ('Order', Icons.receipt_long_outlined);
    final color = status == 'cancelled' ? AppColors.red : status == 'delivered' ? AppColors.green : AppColors.cyan;
    return Padding(
      padding: const EdgeInsets.only(top: 6),
      child: Row(mainAxisSize: MainAxisSize.min, children: [
        Icon(icon, size: 16, color: color),
        const SizedBox(width: 4),
        Text('Order #${order['id']} · $label', style: TextStyle(color: color, fontSize: 12.5, fontWeight: FontWeight.w600)),
        if (status == 'placed') ...[
          const SizedBox(width: 8),
          GestureDetector(
            onTap: () => _cancelOrder(order),
            child: Text('Cancel', style: TextStyle(color: AppColors.red, fontSize: 12.5, decoration: TextDecoration.underline)),
          ),
        ],
      ]),
    );
  }

  void _openCatalog() {
    final note = TextEditingController();
    showModalBottomSheet(
      context: context,
      backgroundColor: AppColors.surface,
      isScrollControlled: true,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(20))),
      builder: (sheet) => StatefulBuilder(
        builder: (sheetContext, setSheet) {
          void change(int itemId, int delta) {
            final q = (_cart[itemId] ?? 0) + delta;
            setSheet(() => q <= 0 ? _cart.remove(itemId) : _cart[itemId] = q.clamp(1, 99));
            setState(() {});
          }

          return DraggableScrollableSheet(
            expand: false,
            initialChildSize: 0.7,
            maxChildSize: 0.95,
            builder: (_, controller) => Column(children: [
              Expanded(
                child: ListView(
                  controller: controller,
                  padding: const EdgeInsets.all(16),
                  children: [
                    Text('${_name ?? 'Business'} — catalog', style: TextStyle(color: AppColors.ink, fontSize: 18, fontWeight: FontWeight.w700)),
                    const SizedBox(height: 4),
                    Text('Add items and send an order. You pay the shop directly.', style: TextStyle(color: AppColors.textSecondary, fontSize: 13)),
                    const SizedBox(height: 12),
                    for (final item in _catalog)
                      Builder(builder: (_) {
                        final itemId = (item['id'] as num).toInt();
                        final qty = _cart[itemId] ?? 0;
                        return Card(
                          color: AppColors.background,
                          child: ListTile(
                            leading: item['imageUrl'] is String
                                ? SizedBox(width: 52, height: 52, child: ChatImageAttachment(objectPath: item['imageUrl'] as String, name: item['name']?.toString() ?? 'item'))
                                : Icon(Icons.shopping_bag_outlined, color: AppColors.cyan),
                            title: Text(item['name']?.toString() ?? '', style: TextStyle(color: AppColors.ink, fontWeight: FontWeight.w600)),
                            subtitle: Text([_rupees(item['pricePaise']), if (item['description'] != null) item['description']].join('\n'),
                                maxLines: 3, overflow: TextOverflow.ellipsis, style: TextStyle(color: AppColors.textSecondary)),
                            isThreeLine: item['description'] != null,
                            trailing: qty == 0
                                ? Row(mainAxisSize: MainAxisSize.min, children: [
                                    IconButton(
                                      tooltip: 'Ask about this',
                                      icon: Icon(Icons.chat_bubble_outline, color: AppColors.textSecondary, size: 20),
                                      onPressed: () {
                                        _input.text = 'Hi, I am interested in ${item['name']} (${_rupees(item['pricePaise'])}).';
                                        Navigator.pop(sheet);
                                      },
                                    ),
                                    FilledButton(onPressed: () => change(itemId, 1), child: const Text('Add')),
                                  ])
                                : Row(mainAxisSize: MainAxisSize.min, children: [
                                    IconButton(tooltip: 'Less', icon: const Icon(Icons.remove_circle_outline), onPressed: () => change(itemId, -1)),
                                    Text('$qty', style: TextStyle(color: AppColors.ink, fontWeight: FontWeight.w700, fontSize: 16)),
                                    IconButton(tooltip: 'More', icon: Icon(Icons.add_circle_outline, color: AppColors.cyan), onPressed: () => change(itemId, 1)),
                                  ]),
                          ),
                        );
                      }),
                  ],
                ),
              ),
              if (_cart.isNotEmpty)
                Container(
                  padding: EdgeInsets.fromLTRB(16, 8, 16, 12 + MediaQuery.of(sheetContext).viewInsets.bottom),
                  decoration: BoxDecoration(color: AppColors.surface, border: Border(top: BorderSide(color: AppColors.border))),
                  child: Column(mainAxisSize: MainAxisSize.min, children: [
                    TextField(
                      controller: note,
                      maxLength: 500,
                      decoration: const InputDecoration(hintText: 'Note for the shop (address, time…)', counterText: '', isDense: true),
                    ),
                    const SizedBox(height: 8),
                    SizedBox(
                      width: double.infinity,
                      child: FilledButton.icon(
                        icon: const Icon(Icons.shopping_cart_checkout),
                        onPressed: _sending
                            ? null
                            : () {
                                final text = note.text;
                                Navigator.pop(sheet);
                                _placeOrder(text);
                              },
                        label: Text('Send order · $_cartCount ${_cartCount == 1 ? 'item' : 'items'} · ${_rupees(_cartTotal)}'),
                      ),
                    ),
                  ]),
                ),
            ]),
          );
        },
      ),
    );
  }

  Future<void> _setBlocked(bool value) async {
    if (value) {
      final ok = await showDialog<bool>(
        context: context,
        builder: (d) => AlertDialog(
          title: Text('Block ${_name ?? 'this business'}?'),
          content: const Text('They will not be able to send you messages, offers or codes. You can unblock any time.'),
          actions: [
            TextButton(onPressed: () => Navigator.pop(d, false), child: const Text('Cancel')),
            TextButton(onPressed: () => Navigator.pop(d, true), child: Text('Block', style: TextStyle(color: AppColors.red))),
          ],
        ),
      );
      if (ok != true) return;
    }
    try {
      await ApiService.put('$_base/block', {'blocked': value});
      if (mounted) {
        setState(() => _blocked = value);
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(value ? 'Blocked' : 'Unblocked')));
      }
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e is ApiException ? e.message : 'Could not change that. Try again.')));
    }
  }

  /// Reports this business to NeuraTalk (Admin → Abuse Reports). It also
  /// counts against the business's quality rating.
  Future<void> _report() async {
    const reasons = ['Spam or too many messages', 'Scam or fraud', 'Offensive or abusive', 'Pretending to be someone else', 'Other'];
    String? reason;
    final details = TextEditingController();
    bool alsoBlock = !_blocked;
    final send = await showDialog<bool>(
      context: context,
      builder: (d) => StatefulBuilder(
        builder: (d, setLocal) => AlertDialog(
          title: Text('Report ${_name ?? 'this business'}'),
          content: SingleChildScrollView(
            child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
              for (final r in reasons)
                RadioListTile<String>(
                  contentPadding: EdgeInsets.zero,
                  dense: true,
                  value: r,
                  groupValue: reason,
                  onChanged: (v) => setLocal(() => reason = v),
                  title: Text(r),
                ),
              TextField(controller: details, maxLines: 3, maxLength: 1000, decoration: const InputDecoration(hintText: 'What happened? (optional)')),
              if (!_blocked)
                CheckboxListTile(
                  contentPadding: EdgeInsets.zero,
                  value: alsoBlock,
                  onChanged: (v) => setLocal(() => alsoBlock = v ?? false),
                  title: const Text('Also block this business'),
                ),
              Text('NeuraTalk reviews every report. The business is not told who reported it.', style: TextStyle(color: AppColors.textMuted, fontSize: 12)),
            ]),
          ),
          actions: [
            TextButton(onPressed: () => Navigator.pop(d, false), child: const Text('Cancel')),
            TextButton(onPressed: reason == null ? null : () => Navigator.pop(d, true), child: Text('Report', style: TextStyle(color: AppColors.red))),
          ],
        ),
      ),
    );
    if (send != true || reason == null) return;
    try {
      await ApiService.post('/api/abuse/report', {
        'reportedEntityType': 'business',
        'reportedEntityId': widget.businessId,
        'category': reason,
        if (details.text.trim().isNotEmpty) 'description': details.text.trim(),
      });
      if (alsoBlock && !_blocked) {
        await ApiService.put('$_base/block', {'blocked': true});
        if (mounted) setState(() => _blocked = true);
      }
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Report sent. Thank you.')));
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e is ApiException ? e.message : 'Could not send the report.')));
    }
  }

  void _openInfo() {
    Navigator.push(context, MaterialPageRoute(
      builder: (_) => BusinessInfoScreen(
        businessId: widget.businessId,
        profile: _profile,
        name: _name,
        catalogCount: _catalog.length,
        onCatalog: _catalog.isEmpty ? null : _openCatalog,
        onCall: _call,
        offers: _offers,
        onOffers: _offers == null ? null : _setOffers,
        blocked: _blocked,
        onBlock: _offers == null ? null : _setBlocked,
        onReport: _report,
      ),
    ));
  }

  Future<void> _setOffers(bool value) async {
    setState(() => _offers = value);
    try {
      await ApiService.put('$_base/preferences', {'promotions': value});
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(value
            ? 'Offers turned on.'
            : "Offers turned off. Order updates and codes still arrive.")));
      }
    } catch (_) {
      if (mounted) setState(() => _offers = !value);
    }
  }

  @override
  Widget build(BuildContext context) {
    final p = _profile;
    final subtitle = p == null ? null : [_cap(p['category']), p['city'], p['openNow'] == true ? 'Open now' : 'Closed now'].where((v) => v != null && '$v'.isNotEmpty).join(' · ');
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(
        titleSpacing: 0,
        title: InkWell(
          onTap: _openInfo,
          child: Row(children: [
            NtAvatar(name: _name ?? 'Business', avatarUrl: p?['logoUrl'] as String?, size: 38),
            const SizedBox(width: 10),
            Expanded(
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Row(mainAxisSize: MainAxisSize.min, children: [
                  Flexible(child: Text(_name ?? 'Business', overflow: TextOverflow.ellipsis)),
                  if (p?['verified'] == true)
                    Padding(padding: const EdgeInsets.only(left: 4), child: Icon(Icons.verified, size: 16, color: AppColors.cyan, semanticLabel: 'Verified business')),
                ]),
                if (_businessTyping)
                  const TypingLabel()
                else if (subtitle != null)
                  Text(subtitle, maxLines: 1, overflow: TextOverflow.ellipsis, style: TextStyle(color: AppColors.textSecondary, fontSize: 12)),
              ]),
            ),
          ]),
        ),
        actions: [
          if (_catalog.isNotEmpty) IconButton(tooltip: 'Catalog', icon: const Icon(Icons.shopping_bag_outlined), onPressed: _openCatalog),
          IconButton(
            tooltip: 'Call',
            icon: _calling ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2)) : const Icon(Icons.call_outlined),
            onPressed: _calling ? null : _call,
          ),
          PopupMenuButton<String>(
            tooltip: 'More',
            onSelected: (v) {
              if (v == 'info') _openInfo();
              if (v == 'offers') _setOffers(!(_offers ?? false));
              if (v == 'block') _setBlocked(!_blocked);
              if (v == 'report') _report();
            },
            itemBuilder: (_) => [
              const PopupMenuItem(value: 'info', child: Text('Business info')),
              if (_offers != null) CheckedPopupMenuItem(value: 'offers', checked: _offers ?? false, child: const Text('Receive offers')),
              if (_offers != null)
                PopupMenuItem(value: 'block', child: Text(_blocked ? 'Unblock' : 'Block', style: TextStyle(color: _blocked ? null : AppColors.red))),
              PopupMenuItem(value: 'report', child: Text('Report', style: TextStyle(color: AppColors.red))),
            ],
          ),
        ],
      ),
      body: Column(children: [
        Expanded(
          child: _loading
              ? Center(child: CircularProgressIndicator(color: AppColors.cyan))
              : _error != null
                  ? NtEmptyState(icon: Icons.wifi_off, title: "Couldn't load this chat", message: _error!, error: true, actionLabel: 'Try again', onAction: _load)
                  : _messages.isEmpty
                      ? NtEmptyState(icon: Icons.storefront_outlined, title: 'No messages yet',
                          message: (p?['description'] as String?)?.isNotEmpty == true ? p!['description'] as String : 'Say hello to get started.')
                      : ListView.builder(
                          reverse: true,
                          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                          itemCount: _messages.length,
                          itemBuilder: (_, i) {
                            final k = _messages.length - 1 - i;
                            final divider = ntDayDivider(k > 0 ? _messages[k - 1]['createdAt'] : null, _messages[k]['createdAt']);
                            final bubble = _bubble(_messages[k]);
                            return divider == null ? bubble : Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [divider, bubble]);
                          },
                        ),
        ),
        if (_blocked)
          SafeArea(
            top: false,
            child: Material(
              color: AppColors.surface,
              child: InkWell(
                onTap: () => _setBlocked(false),
                child: Padding(
                  padding: const EdgeInsets.all(16),
                  child: Text('You blocked this business. Tap to unblock.', textAlign: TextAlign.center,
                      style: TextStyle(color: AppColors.textSecondary, fontWeight: FontWeight.w600)),
                ),
              ),
            ),
          )
        else ...[
        if (_replyTo != null)
          ReplyBar(
            message: _replyTo!,
            fromLabel: _isMine(_replyTo!) ? 'yourself' : (_name ?? 'business'),
            onClose: () => setState(() => _replyTo = null),
          ),
        SafeArea(
          top: false,
          child: Container(
            padding: const EdgeInsets.fromLTRB(4, 8, 8, 8),
            decoration: BoxDecoration(color: AppColors.surface, border: Border(top: BorderSide(color: AppColors.border))),
            child: Row(children: [
              IconButton(tooltip: 'Attach a photo, file or location', onPressed: _sending ? null : _attach, icon: Icon(Icons.attach_file, color: AppColors.textSecondary)),
              Expanded(
                child: TextField(
                  controller: _input,
                  minLines: 1,
                  maxLines: 4,
                  maxLength: 8192,
                  textInputAction: TextInputAction.send,
                  onChanged: _typing.onChanged,
                  onSubmitted: (_) => _send(),
                  decoration: const InputDecoration(hintText: 'Message', counterText: '', border: InputBorder.none),
                ),
              ),
              IconButton(
                tooltip: 'Send',
                onPressed: _sending ? null : () => _send(),
                icon: _sending
                    ? SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2, color: AppColors.cyan))
                    : Icon(Icons.send, color: AppColors.cyan),
              ),
            ]),
          ),
        ),
        ],
      ]),
    );
  }

  Widget _attachment(Map<String, dynamic> a, String label) {
    final path = a['url'] as String;
    final mime = a['mimeType'] as String?;
    final size = (a['sizeBytes'] as num?)?.toInt();
    final type = a['type'] as String?;
    if (type == 'image' || (mime?.startsWith('image/') ?? false)) {
      return ChatImageAttachment(objectPath: path, name: label);
    }
    if (type == 'video' || (mime?.startsWith('video/') ?? false)) {
      return ChatVideoAttachment(objectPath: path, name: label, size: size);
    }
    return ChatFileAttachment(objectPath: path, name: label.replaceFirst(RegExp(r'^\S+\s'), ''), size: size, mime: mime);
  }

  Widget _bubble(Map<String, dynamic> m) {
    final id = (m['id'] as num).toInt();
    final mine = _me != null && (m['senderParticipantId'] as num?)?.toInt() == _me;
    final isCode = m['category'] == 'authentication';
    final tick = mine ? _ticks[m['deliveryToBusiness']] : null;
    final original = m['content']?.toString() ?? '';
    final translated = m['translatedContent'] as String?;
    final showingOriginal = _showOriginal.contains(id);
    final shown = translated != null && !showingOriginal ? translated : original;
    final attachments = (m['attachments'] as List? ?? const []).whereType<Map>().map((a) => Map<String, dynamic>.from(a)).toList();
    final location = m['messageType'] == 'location' ? ((m['metadata'] as Map?)?['location'] as Map?) : null;
    final link = attachments.isEmpty && location == null ? firstLinkIn(shown) : null;
    return Align(
      alignment: mine ? Alignment.centerRight : Alignment.centerLeft,
      child: GestureDetector(
        onLongPress: () => _messageActions(m, mine),
        child: WithReactions(
        reactions: m['reactions'] as Map?,
        alignEnd: mine,
        onTap: () => _messageActions(m, mine),
        child: Container(
        constraints: BoxConstraints(maxWidth: MediaQuery.of(context).size.width * 0.78),
        margin: const EdgeInsets.symmetric(vertical: 4),
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
        decoration: BoxDecoration(
          color: mine ? AppColors.cyan.withValues(alpha: 0.18) : AppColors.surface,
          borderRadius: BorderRadius.circular(16),
          border: Border.all(color: isCode ? AppColors.cyan : AppColors.border),
        ),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          if (isCode)
            Padding(
              padding: const EdgeInsets.only(bottom: 4),
              child: Row(mainAxisSize: MainAxisSize.min, children: [
                Icon(Icons.lock_outline, size: 14, color: AppColors.cyan),
                const SizedBox(width: 4),
                Text('Verification code — never share it', style: TextStyle(color: AppColors.cyan, fontSize: 12, fontWeight: FontWeight.w600)),
              ]),
            ),
          if (m['replyTo'] is Map)
            QuotedMessage(
              quoted: m['replyTo'] as Map,
              fromLabel: _isMine(m['replyTo'] as Map) ? 'You' : (_name ?? 'Business'),
            ),
          for (final a in attachments) Padding(padding: const EdgeInsets.only(bottom: 6), child: _attachment(a, original)),
          if (location != null)
            ChatLocationAttachment(
              geo: 'geo:${location['latitude']},${location['longitude']}',
              title: (location['name'] ?? location['address'])?.toString(),
            )
          else if (attachments.isEmpty || !RegExp(r'^(📷|🎬|🎤|📄) ').hasMatch(original))
            Text(shown, style: TextStyle(color: AppColors.ink, fontSize: 15)),
          if (link != null) LinkPreviewCard(url: link),
          if (!mine && (m['metadata'] as Map?)?['buttons'] is List)
            MessageButtonsView(
              buttons: (m['metadata'] as Map)['buttons'] as List,
              tappedId: _tappedButton(id),
              onQuickReply: _blocked ? null : (b) => _send(buttonReply: {'messageId': id, 'buttonId': b['id']}),
            ),
          if (_orders[id] != null) _orderStrip(_orders[id]!),
          if (translated != null)
            GestureDetector(
              onTap: () => setState(() => showingOriginal ? _showOriginal.remove(id) : _showOriginal.add(id)),
              child: Padding(
                padding: const EdgeInsets.only(top: 2),
                child: Text(showingOriginal ? 'Show translation' : 'Translated · show original',
                    style: TextStyle(color: AppColors.cyan, fontSize: 11, fontWeight: FontWeight.w600)),
              ),
            ),
          const SizedBox(height: 2),
          Text(
            // Time of day, like personal chats; the day dividers show the date.
            [if (m['editedAt'] != null) 'Edited', formatClockTime(m['createdAt']), if (tick != null) tick].join(' · '),
            style: TextStyle(color: AppColors.textMuted, fontSize: 11),
          ),
        ]),
      ),
      ),
      ),
    );
  }

  /// React, copy, or edit (my own text message, 15 minutes).
  void _messageActions(Map<String, dynamic> m, bool mine) {
    final id = (m['id'] as num?)?.toInt();
    if (id == null) return;
    final myReaction = ((m['reactions'] as Map?) ?? const {})['$_me']?.toString();
    final sent = DateTime.tryParse(m['createdAt']?.toString() ?? '');
    final canEdit = mine && m['messageType'] == 'text' && m['category'] == 'conversational'
        && !_orders.containsKey(id) && sent != null && DateTime.now().difference(sent.toLocal()) < const Duration(minutes: 15);
    showModalBottomSheet(
      context: context,
      backgroundColor: AppColors.surface,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(20))),
      builder: (sheet) => SafeArea(
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          QuickReactionRow(mine: myReaction, onPick: (emoji) {
            Navigator.pop(sheet);
            _react(id, myReaction == emoji ? null : emoji);
          }),
          Divider(height: 1, color: AppColors.border),
          if (!_blocked)
            ListTile(
              leading: Icon(Icons.reply, color: AppColors.cyan),
              title: const Text('Reply'),
              onTap: () {
                Navigator.pop(sheet);
                setState(() => _replyTo = m);
              },
            ),
          ListTile(
            leading: Icon(Icons.copy_outlined, color: AppColors.cyan),
            title: const Text('Copy'),
            onTap: () {
              Navigator.pop(sheet);
              Clipboard.setData(ClipboardData(text: (m['translatedContent'] ?? m['content'] ?? '').toString()));
            },
          ),
          if (canEdit)
            ListTile(
              leading: Icon(Icons.edit_outlined, color: AppColors.cyan),
              title: const Text('Edit'),
              onTap: () {
                Navigator.pop(sheet);
                _edit(id, m['content']?.toString() ?? '');
              },
            ),
        ]),
      ),
    );
  }

  Future<void> _react(int messageId, String? emoji) async {
    try {
      await ApiService.post('$_base/messages/$messageId/reaction', {'emoji': emoji});
      await _load(quiet: true);
    } catch (_) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Could not react. Try again.')));
    }
  }

  Future<void> _edit(int messageId, String current) async {
    final ctrl = TextEditingController(text: current);
    final next = await showDialog<String>(
      context: context,
      builder: (d) => AlertDialog(
        title: const Text('Edit message'),
        content: TextField(controller: ctrl, autofocus: true, maxLines: 5, minLines: 1),
        actions: [
          TextButton(onPressed: () => Navigator.pop(d), child: const Text('Cancel')),
          FilledButton(onPressed: () => Navigator.pop(d, ctrl.text.trim()), child: const Text('Save')),
        ],
      ),
    );
    ctrl.dispose();
    if (next == null || next.isEmpty || next == current) return;
    try {
      await ApiService.patch('$_base/messages/$messageId', {'content': next});
      await _load(quiet: true);
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e is ApiException ? e.message : 'Could not edit.')));
    }
  }
}

/// "retail" -> "Retail" for display.
String? _cap(Object? v) {
  final t = v?.toString().trim() ?? '';
  return t.isEmpty ? null : t[0].toUpperCase() + t.substring(1);
}

/// Business info (tap the chat header): logo, verified tick, about, address,
/// hours, website, catalog, call, offers and block -- like WhatsApp.
class BusinessInfoScreen extends StatelessWidget {
  const BusinessInfoScreen({
    super.key,
    required this.businessId,
    this.profile,
    this.name,
    this.catalogCount = 0,
    this.onCatalog,
    this.onCall,
    this.offers,
    this.onOffers,
    this.blocked = false,
    this.onBlock,
    this.onReport,
  });

  final VoidCallback? onReport;

  final int businessId;
  final Map<String, dynamic>? profile;
  final String? name;
  final int catalogCount;
  final VoidCallback? onCatalog;
  final VoidCallback? onCall;
  final bool? offers;
  final ValueChanged<bool>? onOffers;
  final bool blocked;
  final ValueChanged<bool>? onBlock;

  static const _days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  String _hhmm(Object? v) {
    final p = '${v ?? ''}'.split(':');
    final h = int.tryParse(p.first) ?? 0;
    return '${h % 12 == 0 ? 12 : h % 12}:${p.length > 1 ? p[1] : '00'} ${h < 12 ? 'AM' : 'PM'}';
  }

  String _dayLine(Map hours, int day) {
    final h = hours['$day'];
    return '${_days[day]}: ${h is Map ? '${_hhmm(h['open'])} – ${_hhmm(h['close'])}' : 'Closed'}';
  }

  @override
  Widget build(BuildContext context) {
    final p = profile ?? const {};
    final title = name ?? p['name']?.toString() ?? 'Business';
    final verified = p['verified'] == true;
    final hours = (p['hours'] as Map?) ?? const {};
    final openNow = p['openNow'] == true || hours.isEmpty;
    final website = p['website']?.toString();
    final address = (p['address'] ?? p['city'])?.toString();
    final about = p['description']?.toString();
    final category = _cap(p['category']);
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(title: const Text('Business info')),
      body: ListView(padding: const EdgeInsets.only(bottom: 32), children: [
        const SizedBox(height: 12),
        Center(child: NtAvatar(name: title, avatarUrl: p['logoUrl'] as String?, size: 112, openOnTap: p['logoUrl'] != null)),
        const SizedBox(height: 12),
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 20),
          child: Row(mainAxisAlignment: MainAxisAlignment.center, children: [
            Flexible(child: Text(title, textAlign: TextAlign.center, style: TextStyle(color: AppColors.ink, fontSize: 22, fontWeight: FontWeight.w800))),
            if (verified) Padding(padding: const EdgeInsets.only(left: 6), child: Icon(Icons.verified, color: AppColors.cyan)),
          ]),
        ),
        if (category != null) Center(child: Text(category, style: TextStyle(color: AppColors.textSecondary))),
        const SizedBox(height: 4),
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 20),
          child: Text(
            verified ? 'Verified business — NeuraTalk checked this business' : 'Business account — not verified by NeuraTalk yet',
            textAlign: TextAlign.center,
            style: TextStyle(color: verified ? AppColors.cyan : AppColors.textMuted, fontSize: 12.5),
          ),
        ),
        const SizedBox(height: 16),
        Wrap(alignment: WrapAlignment.center, children: [
          if (onCall != null) _action(Icons.call_outlined, 'Call', () { Navigator.pop(context); onCall!(); }),
          if (onCatalog != null) _action(Icons.shopping_bag_outlined, 'Catalog', () { Navigator.pop(context); onCatalog!(); }),
          _action(Icons.chat_outlined, 'Message', () => Navigator.pop(context)),
        ]),
        Divider(color: AppColors.border, height: 32),
        if (about != null && about.isNotEmpty)
          ListTile(leading: const Icon(Icons.info_outline), title: Text(about, style: TextStyle(color: AppColors.ink))),
        if (address != null && address.isNotEmpty)
          ListTile(
            leading: const Icon(Icons.location_on_outlined),
            title: Text(address, style: TextStyle(color: AppColors.ink)),
            onTap: () => launchUrl(
              Uri.parse('https://www.google.com/maps/search/?api=1&query=${Uri.encodeComponent('$title $address')}'),
              mode: LaunchMode.externalApplication,
            ),
          ),
        ListTile(
          leading: const Icon(Icons.schedule),
          title: Text(openNow ? 'Open now' : 'Closed now',
              style: TextStyle(color: openNow ? AppColors.green : AppColors.orange, fontWeight: FontWeight.w600)),
          subtitle: hours.isEmpty
              ? null
              : Text([for (var d = 1; d <= 7; d++) _dayLine(hours, d % 7)].join('\n'),
                  style: TextStyle(color: AppColors.textSecondary, height: 1.5)),
        ),
        if (website != null && website.isNotEmpty)
          ListTile(
            leading: const Icon(Icons.language),
            title: Text(website, style: TextStyle(color: AppColors.cyan)),
            onTap: () => launchUrl(Uri.parse(website), mode: LaunchMode.externalApplication),
          ),
        if (onCatalog != null)
          ListTile(
            leading: const Icon(Icons.shopping_bag_outlined),
            title: Text('Catalog · $catalogCount ${catalogCount == 1 ? 'item' : 'items'}'),
            trailing: const Icon(Icons.chevron_right),
            onTap: () { Navigator.pop(context); onCatalog!(); },
          ),
        Divider(color: AppColors.border, height: 24),
        if (onOffers != null && offers != null)
          SwitchListTile(
            secondary: const Icon(Icons.local_offer_outlined),
            value: offers!,
            onChanged: (v) { onOffers!(v); Navigator.pop(context); },
            title: const Text('Receive offers'),
            subtitle: const Text('Order updates and codes always arrive'),
          ),
        if (onBlock != null)
          ListTile(
            leading: Icon(Icons.block, color: blocked ? AppColors.textSecondary : AppColors.red),
            title: Text(blocked ? 'Unblock $title' : 'Block $title', style: TextStyle(color: blocked ? AppColors.ink : AppColors.red)),
            onTap: () { Navigator.pop(context); onBlock!(!blocked); },
          ),
        if (onReport != null)
          ListTile(
            leading: const Icon(Icons.flag_outlined, color: AppColors.red),
            title: Text('Report $title', style: const TextStyle(color: AppColors.red)),
            onTap: () { Navigator.pop(context); onReport!(); },
          ),
        Padding(
          padding: const EdgeInsets.fromLTRB(20, 12, 20, 0),
          child: Text('Messages with this business are translated into your language. The business sees your name and profile photo.',
              style: TextStyle(color: AppColors.textMuted, fontSize: 12.5)),
        ),
      ]),
    );
  }

  Widget _action(IconData icon, String label, VoidCallback onTap) => Padding(
        padding: const EdgeInsets.symmetric(horizontal: 8),
        child: InkWell(
          borderRadius: BorderRadius.circular(16),
          onTap: onTap,
          child: Container(
            width: 88,
            padding: const EdgeInsets.symmetric(vertical: 12),
            decoration: BoxDecoration(border: Border.all(color: AppColors.border), borderRadius: BorderRadius.circular(16)),
            child: Column(children: [
              Icon(icon, color: AppColors.cyan),
              const SizedBox(height: 4),
              Text(label, style: TextStyle(color: AppColors.cyan, fontWeight: FontWeight.w600)),
            ]),
          ),
        ),
      );
}
