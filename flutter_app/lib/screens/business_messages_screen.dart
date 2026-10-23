import 'dart:async';

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../services/api_service.dart';
import '../services/call_service.dart';
import '../services/media_store.dart';
import '../theme/app_theme.dart';
import '../widgets/attachment_picker.dart';
import '../widgets/chat_attachments.dart';
import '../widgets/nt_ui.dart';
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
                  hintText: 'Find a business by name, type or city',
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
                    subtitle: Text([b['category'], b['city']].where((v) => v != null && '$v'.isNotEmpty).join(' · '),
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

String _rupees(dynamic paise) => paise == null ? 'Price on request' : '₹${((paise as num) / 100).toStringAsFixed((paise % 100) == 0 ? 0 : 2)}';

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

  Future<void> _send({Map<String, dynamic>? attachment}) async {
    final text = _input.text.trim();
    if ((text.isEmpty && attachment == null) || _sending) return;
    setState(() => _sending = true);
    try {
      await ApiService.post('$_base/messages', {'content': text, if (attachment != null) 'attachment': attachment});
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

  Future<void> _attach() async {
    final picked = await AttachmentPicker.show(context);
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

  void _openCatalog() {
    showModalBottomSheet(
      context: context,
      backgroundColor: AppColors.surface,
      isScrollControlled: true,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(20))),
      builder: (sheet) => DraggableScrollableSheet(
        expand: false,
        initialChildSize: 0.6,
        builder: (_, controller) => ListView(
          controller: controller,
          padding: const EdgeInsets.all(16),
          children: [
            Text('${_name ?? 'Business'} — catalog', style: TextStyle(color: AppColors.ink, fontSize: 18, fontWeight: FontWeight.w700)),
            const SizedBox(height: 12),
            for (final item in _catalog)
              Card(
                color: AppColors.background,
                child: ListTile(
                  leading: item['imageUrl'] is String
                      ? SizedBox(width: 52, height: 52, child: ChatImageAttachment(objectPath: item['imageUrl'] as String, name: item['name']?.toString() ?? 'item'))
                      : Icon(Icons.shopping_bag_outlined, color: AppColors.cyan),
                  title: Text(item['name']?.toString() ?? '', style: TextStyle(color: AppColors.ink, fontWeight: FontWeight.w600)),
                  subtitle: Text([_rupees(item['pricePaise']), if (item['description'] != null) item['description']].join('\n'),
                      style: TextStyle(color: AppColors.textSecondary)),
                  isThreeLine: item['description'] != null,
                  trailing: TextButton(
                    onPressed: () {
                      _input.text = 'Hi, I am interested in ${item['name']} (${_rupees(item['pricePaise'])}).';
                      Navigator.pop(sheet);
                    },
                    child: const Text('Ask'),
                  ),
                ),
              ),
          ],
        ),
      ),
    );
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
    final subtitle = p == null ? null : [p['category'], p['city'], p['openNow'] == true ? 'Open now' : 'Closed now'].where((v) => v != null && '$v'.isNotEmpty).join(' · ');
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(
        titleSpacing: 0,
        title: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Row(mainAxisSize: MainAxisSize.min, children: [
            Flexible(child: Text(_name ?? 'Business', overflow: TextOverflow.ellipsis)),
            if (p?['verified'] == true) Padding(padding: const EdgeInsets.only(left: 4), child: Icon(Icons.verified, size: 16, color: AppColors.cyan, semanticLabel: 'Verified business')),
          ]),
          if (subtitle != null) Text(subtitle, style: TextStyle(color: AppColors.textSecondary, fontSize: 12)),
        ]),
        actions: [
          if (_catalog.isNotEmpty) IconButton(tooltip: 'Catalog', icon: const Icon(Icons.shopping_bag_outlined), onPressed: _openCatalog),
          IconButton(
            tooltip: 'Call',
            icon: _calling ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2)) : const Icon(Icons.call_outlined),
            onPressed: _calling ? null : _call,
          ),
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
                      ? NtEmptyState(icon: Icons.storefront_outlined, title: 'No messages yet',
                          message: (p?['description'] as String?)?.isNotEmpty == true ? p!['description'] as String : 'Say hello to get started.')
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
            padding: const EdgeInsets.fromLTRB(4, 8, 8, 8),
            decoration: BoxDecoration(color: AppColors.surface, border: Border(top: BorderSide(color: AppColors.border))),
            child: Row(children: [
              IconButton(tooltip: 'Attach a photo or file', onPressed: _sending ? null : _attach, icon: Icon(Icons.attach_file, color: AppColors.textSecondary)),
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
                onPressed: _sending ? null : () => _send(),
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
          for (final a in attachments) Padding(padding: const EdgeInsets.only(bottom: 6), child: _attachment(a, original)),
          if (attachments.isEmpty || !RegExp(r'^(📷|🎬|🎤|📄) ').hasMatch(original))
            SelectableText(shown, style: TextStyle(color: AppColors.ink, fontSize: 15)),
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
            [formatBusinessTime(m['createdAt']), if (tick != null) tick].join(' · '),
            style: TextStyle(color: AppColors.textMuted, fontSize: 11),
          ),
        ]),
      ),
    );
  }
}
