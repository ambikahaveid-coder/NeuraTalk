import 'dart:async';

import 'package:flutter/material.dart';

import '../services/api_service.dart';
import '../theme/app_theme.dart';
import '../widgets/nt_ui.dart';

/// Messages from businesses: order updates, verification codes, offers, and
/// two-way chats with a business's team (server/modules/messaging).
class BusinessMessagesScreen extends StatefulWidget {
  const BusinessMessagesScreen({super.key});

  @override
  State<BusinessMessagesScreen> createState() => _BusinessMessagesScreenState();
}

class _BusinessMessagesScreenState extends State<BusinessMessagesScreen> {
  List<Map<String, dynamic>> _threads = [];
  bool _loading = true;
  String? _error;
  Timer? _refresh;

  @override
  void initState() {
    super.initState();
    _load();
    _refresh = Timer.periodic(const Duration(seconds: 15), (_) => _load(quiet: true));
  }

  @override
  void dispose() {
    _refresh?.cancel();
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

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(title: const Text('Business messages')),
      body: RefreshIndicator(
        onRefresh: _load,
        color: AppColors.cyan,
        child: _loading
            ? Center(child: CircularProgressIndicator(color: AppColors.cyan))
            : _error != null
                ? ListView(children: [
                    NtEmptyState(icon: Icons.wifi_off, title: "Couldn't load business messages", message: _error!, error: true, actionLabel: 'Try again', onAction: _load),
                  ])
                : _threads.isEmpty
                    ? ListView(children: const [
                        NtEmptyState(
                          icon: Icons.storefront_outlined,
                          title: 'No business messages yet',
                          message: 'Order updates, verification codes and offers from businesses you use will show up here.',
                        ),
                      ])
                    : ListView.separated(
                        itemCount: _threads.length,
                        separatorBuilder: (_, __) => Divider(height: 1, color: AppColors.border),
                        itemBuilder: (_, i) => _tile(_threads[i]),
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
        Expanded(child: Text(name, maxLines: 1, overflow: TextOverflow.ellipsis,
            style: TextStyle(color: AppColors.ink, fontWeight: unread > 0 ? FontWeight.w700 : FontWeight.w600))),
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
      onTap: () async {
        await Navigator.push(context, MaterialPageRoute(builder: (_) => BusinessChatScreen(businessId: (t['businessId'] as num).toInt(), businessName: name)));
        _load(quiet: true);
      },
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

/// One business chat. Opening it marks the business's messages as seen;
/// your own messages show Sent / Delivered / Seen.
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
  int? _me;
  String? _name;
  bool _loading = true;
  bool _sending = false;
  String? _error;
  bool? _offers;
  int? _lastReadId;
  Timer? _poll;

  @override
  void initState() {
    super.initState();
    _name = widget.businessName;
    _loadIdentity();
    _load();
    _loadPreferences();
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

  Future<void> _loadIdentity() async {
    if (_name != null) return;
    try {
      final res = await ApiService.get(_base);
      if (mounted) setState(() => _name = (res['business'] as Map?)?['name']?.toString());
    } catch (_) {}
  }

  Future<void> _loadPreferences() async {
    try {
      final res = await ApiService.get('$_base/preferences');
      if (mounted && res['known'] == true) setState(() => _offers = res['promotions'] == true);
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
        _loading = false;
        _error = null;
      });
      final newest = list.isEmpty ? null : (list.first['id'] as num?)?.toInt();
      if (newest != null && newest != _lastReadId) {
        _lastReadId = newest;
        unawaited(ApiService.post('$_base/read', {}).catchError((_) => <String, dynamic>{}));
      }
    } catch (e) {
      if (!mounted || quiet) return;
      setState(() {
        _loading = false;
        _error = e is ApiException ? e.message : "Check your connection and try again.";
      });
    }
  }

  Future<void> _send() async {
    final text = _input.text.trim();
    if (text.isEmpty || _sending) return;
    setState(() => _sending = true);
    try {
      await ApiService.post('$_base/messages', {'content': text});
      _input.clear();
      await _load(quiet: true);
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e is ApiException ? e.message : "Message not sent. Try again.")));
      }
    } finally {
      if (mounted) setState(() => _sending = false);
    }
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
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(
        title: Text(_name ?? 'Business'),
        actions: [
          if (_offers != null)
            PopupMenuButton<String>(
              tooltip: 'More',
              onSelected: (_) => _setOffers(!(_offers ?? false)),
              itemBuilder: (_) => [
                CheckedPopupMenuItem(value: 'offers', checked: _offers ?? false, child: const Text('Receive offers')),
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
                      ? const NtEmptyState(icon: Icons.storefront_outlined, title: 'No messages yet', message: 'Say hello to get started.')
                      : ListView.builder(
                          reverse: true,
                          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                          itemCount: _messages.length,
                          itemBuilder: (_, i) => _bubble(_messages[_messages.length - 1 - i]),
                        ),
        ),
        SafeArea(
          top: false,
          child: Container(
            padding: const EdgeInsets.fromLTRB(12, 8, 8, 8),
            decoration: BoxDecoration(color: AppColors.surface, border: Border(top: BorderSide(color: AppColors.border))),
            child: Row(children: [
              Expanded(
                child: TextField(
                  controller: _input,
                  minLines: 1,
                  maxLines: 4,
                  maxLength: 8192,
                  textInputAction: TextInputAction.send,
                  onSubmitted: (_) => _send(),
                  decoration: const InputDecoration(hintText: 'Message', counterText: '', border: InputBorder.none),
                ),
              ),
              IconButton(
                tooltip: 'Send',
                onPressed: _sending ? null : _send,
                icon: _sending
                    ? SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2, color: AppColors.cyan))
                    : Icon(Icons.send, color: AppColors.cyan),
              ),
            ]),
          ),
        ),
      ]),
    );
  }

  Widget _bubble(Map<String, dynamic> m) {
    final mine = _me != null && (m['senderParticipantId'] as num?)?.toInt() == _me;
    final isCode = m['category'] == 'authentication';
    final tick = mine ? _ticks[m['deliveryToBusiness']] : null;
    final content = m['content']?.toString() ?? '';
    return Align(
      alignment: mine ? Alignment.centerRight : Alignment.centerLeft,
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
          SelectableText(content, style: TextStyle(color: AppColors.ink, fontSize: 15)),
          const SizedBox(height: 2),
          Text(
            [formatBusinessTime(m['createdAt']), if (tick != null) tick].join(' · '),
            style: TextStyle(color: AppColors.textMuted, fontSize: 11),
          ),
        ]),
      ),
    );
  }
}
