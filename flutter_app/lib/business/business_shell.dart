import 'dart:async';

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../providers/auth_provider.dart';
import '../services/api_service.dart';
import '../services/call_readiness.dart';
import '../services/media_store.dart';
import '../theme/app_theme.dart';
import '../widgets/attachment_picker.dart';
import '../widgets/chat_attachments.dart';
import '../widgets/nt_ui.dart';

/// NeuraTalk Business: the team's inbox on the phone. Customers' messages
/// arrive here (with a notification), each in the agent's own language, and
/// agents reply with text, photos/files and quick replies.
class BusinessShell extends StatefulWidget {
  const BusinessShell({super.key});

  @override
  State<BusinessShell> createState() => _BusinessShellState();
}

class _BusinessShellState extends State<BusinessShell> {
  int _tab = 0;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) unawaited(CallReadiness.ensure(context));
    });
  }

  @override
  Widget build(BuildContext context) {
    final user = context.watch<AuthProvider>().user ?? const {};
    final businessId = int.tryParse('${user['organizationId'] ?? (user['organization'] as Map?)?['id'] ?? ''}');
    if (businessId == null) return const _NotABusinessAccount();
    return Scaffold(
      body: IndexedStack(index: _tab, children: [
        BusinessInboxScreen(businessId: businessId),
        const _BusinessSettings(),
      ]),
      bottomNavigationBar: NavigationBar(
        selectedIndex: _tab,
        onDestinationSelected: (i) => setState(() => _tab = i),
        backgroundColor: AppColors.background,
        destinations: const [
          NavigationDestination(icon: Icon(Icons.forum_outlined), selectedIcon: Icon(Icons.forum), label: 'Inbox'),
          NavigationDestination(icon: Icon(Icons.settings_outlined), selectedIcon: Icon(Icons.settings), label: 'Settings'),
        ],
      ),
    );
  }
}

class _NotABusinessAccount extends StatelessWidget {
  const _NotABusinessAccount();

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.background,
      body: SafeArea(
        child: NtEmptyState(
          icon: Icons.storefront_outlined,
          title: 'This app is for business teams',
          message: 'Your number is not part of a business on NeuraTalk. Ask your company admin to add you to the team, '
              'or use the NeuraTalk app for personal calls and chats.',
          actionLabel: 'Log out',
          onAction: () => context.read<AuthProvider>().logout(),
        ),
      ),
    );
  }
}

class _BusinessSettings extends StatelessWidget {
  const _BusinessSettings();

  @override
  Widget build(BuildContext context) {
    final user = context.watch<AuthProvider>().user ?? const {};
    final org = (user['organization'] as Map?) ?? const {};
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(title: const Text('Settings')),
      body: ListView(children: [
        ListTile(
          leading: const Icon(Icons.storefront_outlined),
          title: Text('${org['name'] ?? 'Your business'}', style: TextStyle(color: AppColors.ink, fontWeight: FontWeight.w700)),
          subtitle: Text('${user['displayName'] ?? user['username'] ?? ''}', style: TextStyle(color: AppColors.textSecondary)),
        ),
        ListTile(
          leading: const Icon(Icons.notifications_active_outlined),
          title: const Text('Make sure notifications and calls ring'),
          subtitle: const Text('Allow notifications, full-screen calls and no battery restriction'),
          onTap: () => CallReadiness.ensure(context, force: true),
        ),
        ListTile(
          leading: const Icon(Icons.web_outlined),
          title: const Text('Templates, campaigns, catalog'),
          subtitle: const Text('Manage these on neuratalk.in → Company dashboard → Messaging'),
        ),
        ListTile(
          leading: Icon(Icons.logout, color: AppColors.red),
          title: Text('Log out', style: TextStyle(color: AppColors.red)),
          onTap: () => context.read<AuthProvider>().logout(),
        ),
      ]),
    );
  }
}

/// The business's conversations with customers.
class BusinessInboxScreen extends StatefulWidget {
  const BusinessInboxScreen({super.key, required this.businessId});
  final int businessId;

  @override
  State<BusinessInboxScreen> createState() => _BusinessInboxScreenState();
}

class _BusinessInboxScreenState extends State<BusinessInboxScreen> {
  /// Last message time: "12:40 PM" today, then "Yesterday", weekday, date.
  static String _when(Object? iso) {
    final dt = DateTime.tryParse('${iso ?? ''}')?.toLocal();
    if (dt == null) return '';
    final now = DateTime.now();
    final days = DateTime(now.year, now.month, now.day).difference(DateTime(dt.year, dt.month, dt.day)).inDays;
    if (days <= 0) {
      final h = dt.hour % 12 == 0 ? 12 : dt.hour % 12;
      return '$h:${dt.minute.toString().padLeft(2, '0')} ${dt.hour < 12 ? 'AM' : 'PM'}';
    }
    if (days == 1) return 'Yesterday';
    if (days < 7) return const ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][dt.weekday - 1];
    return '${dt.day}/${dt.month}/${dt.year % 100}';
  }

  String _filter = 'all';
  List<Map<String, dynamic>> _conversations = [];
  bool _loading = true;
  String? _error;
  bool _noAccess = false;
  Timer? _poll;

  @override
  void initState() {
    super.initState();
    _load();
    _poll = Timer.periodic(const Duration(seconds: 8), (_) => _load(quiet: true));
  }

  @override
  void dispose() {
    _poll?.cancel();
    super.dispose();
  }

  String get _base => '/api/business/${widget.businessId}';

  Future<void> _load({bool quiet = false}) async {
    try {
      final res = await ApiService.get('$_base/conversations?assignment=$_filter');
      final list = (res['conversations'] as List? ?? const []).whereType<Map>().map((c) => Map<String, dynamic>.from(c)).toList();
      if (mounted) setState(() { _conversations = list; _loading = false; _error = null; _noAccess = false; });
    } on ApiException catch (e) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _noAccess = e.statusCode == 403;
        if (!quiet || _conversations.isEmpty) _error = e.message;
      });
    } catch (_) {
      if (mounted && !quiet) setState(() { _loading = false; _error = 'Check your connection and try again.'; });
    }
  }

  Future<void> _turnOnAccess() async {
    try {
      final grantable = await ApiService.get('$_base/rbac/grantable-permissions');
      await ApiService.post('$_base/rbac/grant-business-access', {'permissions': grantable['permissions']});
      await _load();
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e is ApiException ? e.message : 'Could not turn it on.')));
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final role = context.watch<AuthProvider>().user?['role'];
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(
        title: const Text('Inbox'),
        bottom: PreferredSize(
          preferredSize: const Size.fromHeight(44),
          child: Padding(
            padding: const EdgeInsets.fromLTRB(12, 0, 12, 8),
            child: Row(children: [
              for (final f in const [('all', 'All'), ('mine', 'Mine'), ('unassigned', 'Unassigned')])
                Padding(
                  padding: const EdgeInsets.only(right: 8),
                  child: ChoiceChip(
                    label: Text(f.$2),
                    selected: _filter == f.$1,
                    onSelected: (_) { setState(() { _filter = f.$1; _loading = true; }); _load(); },
                  ),
                ),
            ]),
          ),
        ),
      ),
      body: RefreshIndicator(
        onRefresh: _load,
        color: AppColors.cyan,
        child: _loading
            ? ListView(children: [Padding(padding: const EdgeInsets.all(40), child: Center(child: CircularProgressIndicator(color: AppColors.cyan)))])
            : _noAccess
                ? ListView(children: [
                    NtEmptyState(
                      icon: Icons.lock_outline,
                      title: 'Business messaging is off for you',
                      message: role == 'company_admin'
                          ? 'Turn it on to see and answer your customers here.'
                          : 'Ask your company admin to give you access to customer messages.',
                      actionLabel: role == 'company_admin' ? 'Turn on' : null,
                      onAction: role == 'company_admin' ? _turnOnAccess : null,
                    ),
                  ])
                : _error != null
                    ? ListView(children: [NtEmptyState(icon: Icons.wifi_off, title: "Couldn't load the inbox", message: _error!, error: true, actionLabel: 'Try again', onAction: _load)])
                    : _conversations.isEmpty
                        ? ListView(children: const [NtEmptyState(icon: Icons.forum_outlined, title: 'No conversations', message: 'When customers message your business, their chats appear here.')])
                        : ListView.separated(
                            itemCount: _conversations.length,
                            separatorBuilder: (_, __) => Divider(height: 1, color: AppColors.border),
                            itemBuilder: (_, i) {
                              final c = _conversations[i];
                              final last = (c['lastMessage'] as Map?) ?? const {};
                              final name = c['customerName']?.toString() ?? 'Customer';
                              return ListTile(
                                leading: NtAvatar(name: name),
                                title: Text(name, maxLines: 1, overflow: TextOverflow.ellipsis, style: TextStyle(color: AppColors.ink, fontWeight: FontWeight.w600)),
                                subtitle: Text('${last['content'] ?? ''}', maxLines: 1, overflow: TextOverflow.ellipsis, style: TextStyle(color: AppColors.textSecondary)),
                                trailing: Column(
                                  mainAxisAlignment: MainAxisAlignment.center,
                                  crossAxisAlignment: CrossAxisAlignment.end,
                                  children: [
                                    Text(_when(last['createdAt']), style: TextStyle(color: AppColors.textSecondary, fontSize: 12)),
                                    const SizedBox(height: 4),
                                    Text(
                                      c['assignedToUsername'] != null ? '${c['assignedToUsername']}' : 'Unassigned',
                                      style: TextStyle(color: AppColors.textMuted, fontSize: 11),
                                    ),
                                  ],
                                ),
                                onTap: () async {
                                  await Navigator.push(context, MaterialPageRoute(
                                    builder: (_) => BusinessConversationScreen(businessId: widget.businessId, conversationId: (c['id'] as num).toInt(), customerName: name),
                                  ));
                                  _load(quiet: true);
                                },
                              );
                            },
                          ),
      ),
    );
  }
}

/// One customer conversation, for an agent.
class BusinessConversationScreen extends StatefulWidget {
  const BusinessConversationScreen({super.key, required this.businessId, required this.conversationId, this.customerName});
  final int businessId;
  final int conversationId;
  final String? customerName;

  @override
  State<BusinessConversationScreen> createState() => _BusinessConversationScreenState();
}

class _BusinessConversationScreenState extends State<BusinessConversationScreen> {
  static const _ticks = {'queued': 'Sending', 'sent': 'Sent', 'delivered': 'Delivered', 'read': 'Seen', 'failed': 'Not delivered'};
  final _input = TextEditingController();
  List<Map<String, dynamic>> _messages = [];
  List<Map<String, dynamic>> _quickReplies = [];
  final Set<int> _showOriginal = {};
  bool _loading = true;
  bool _sending = false;
  String? _error;
  Timer? _poll;

  String get _base => '/api/business/${widget.businessId}';

  @override
  void initState() {
    super.initState();
    _load();
    _loadQuickReplies();
    _input.addListener(() => setState(() {}));
    _poll = Timer.periodic(const Duration(seconds: 4), (_) => _load(quiet: true));
  }

  @override
  void dispose() {
    _poll?.cancel();
    _input.dispose();
    super.dispose();
  }

  Future<void> _loadQuickReplies() async {
    try {
      final res = await ApiService.get('$_base/messaging-settings');
      final list = ((res['settings'] as Map?)?['quickReplies'] as List? ?? const []).whereType<Map>().map((q) => Map<String, dynamic>.from(q)).toList();
      if (mounted) setState(() => _quickReplies = list);
    } catch (_) {}
  }

  Future<void> _load({bool quiet = false}) async {
    try {
      final res = await ApiService.get('$_base/conversations/${widget.conversationId}/messages?limit=100');
      final list = (res['messages'] as List? ?? const []).whereType<Map>().map((m) => Map<String, dynamic>.from(m)).toList();
      if (mounted) setState(() { _messages = list.reversed.toList(); _loading = false; _error = null; });
    } catch (e) {
      if (mounted && !quiet) setState(() { _loading = false; _error = e is ApiException ? e.message : 'Check your connection and try again.'; });
    }
  }

  Future<void> _send({Map<String, dynamic>? attachment}) async {
    final text = _input.text.trim();
    if ((text.isEmpty && attachment == null) || _sending) return;
    setState(() => _sending = true);
    try {
      await ApiService.post('$_base/conversations/${widget.conversationId}/messages', {'content': text, if (attachment != null) 'attachment': attachment});
      _input.clear();
      await _load(quiet: true);
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e is ApiException ? e.message : 'Reply not sent. Try again.')));
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
          ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Could not send that file.')));
        }
      }
    }
  }

  Future<void> _claim() async {
    try {
      await ApiService.post('$_base/conversations/${widget.conversationId}/claim', {});
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('This chat is now yours.')));
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e is ApiException ? e.message : 'Could not take this chat.')));
    }
  }

  @override
  Widget build(BuildContext context) {
    final typed = _input.text;
    final matches = typed.startsWith('/')
        ? _quickReplies.where((q) => '${q['shortcut']}'.startsWith(typed.substring(1).toLowerCase())).take(5).toList()
        : const <Map<String, dynamic>>[];
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(
        title: Text(widget.customerName ?? 'Customer'),
        actions: [IconButton(tooltip: 'Take this chat', icon: const Icon(Icons.assignment_ind_outlined), onPressed: _claim)],
      ),
      body: Column(children: [
        Expanded(
          child: _loading
              ? Center(child: CircularProgressIndicator(color: AppColors.cyan))
              : _error != null
                  ? NtEmptyState(icon: Icons.wifi_off, title: "Couldn't load this chat", message: _error!, error: true, actionLabel: 'Try again', onAction: _load)
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
        if (matches.isNotEmpty)
          Container(
            color: AppColors.surface,
            child: Column(children: [
              for (final q in matches)
                ListTile(
                  dense: true,
                  title: Text('/${q['shortcut']}', style: TextStyle(color: AppColors.cyan, fontWeight: FontWeight.w700)),
                  subtitle: Text('${q['text']}', maxLines: 2, overflow: TextOverflow.ellipsis),
                  onTap: () => _input.text = '${q['text']}',
                ),
            ]),
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
                  decoration: const InputDecoration(hintText: 'Reply  ·  / for quick replies', hintMaxLines: 1, counterText: '', border: InputBorder.none),
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

  Widget _bubble(Map<String, dynamic> m) {
    final id = (m['id'] as num).toInt();
    // Business side = messages delivered to the customer (agents, campaigns, codes).
    final ours = m['deliveryToCustomer'] != null;
    final original = '${m['content'] ?? ''}';
    final translated = m['translatedContent'] as String?;
    final showOriginal = _showOriginal.contains(id);
    final attachments = (m['attachments'] as List? ?? const []).whereType<Map>().map((a) => Map<String, dynamic>.from(a)).toList();
    final tick = ours ? _ticks[m['deliveryToCustomer']] : null;
    return Align(
      alignment: ours ? Alignment.centerRight : Alignment.centerLeft,
      child: Container(
        constraints: BoxConstraints(maxWidth: MediaQuery.of(context).size.width * 0.78),
        margin: const EdgeInsets.symmetric(vertical: 4),
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
        decoration: BoxDecoration(
          color: ours ? AppColors.cyan.withValues(alpha: 0.18) : AppColors.surface,
          borderRadius: BorderRadius.circular(16),
          border: Border.all(color: AppColors.border),
        ),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          for (final a in attachments)
            Padding(
              padding: const EdgeInsets.only(bottom: 6),
              child: (a['type'] == 'image' || '${a['mimeType']}'.startsWith('image/'))
                  ? ChatImageAttachment(objectPath: a['url'] as String, name: original)
                  : (a['type'] == 'video' || '${a['mimeType']}'.startsWith('video/'))
                      ? ChatVideoAttachment(objectPath: a['url'] as String, name: original, size: (a['sizeBytes'] as num?)?.toInt())
                      : ChatFileAttachment(objectPath: a['url'] as String, name: original.replaceFirst(RegExp(r'^\S+\s'), ''), size: (a['sizeBytes'] as num?)?.toInt(), mime: a['mimeType'] as String?),
            ),
          if (attachments.isEmpty || !RegExp(r'^(📷|🎬|🎤|📄) ').hasMatch(original))
            SelectableText(translated != null && !showOriginal ? translated : original, style: TextStyle(color: AppColors.ink, fontSize: 15)),
          if (translated != null)
            GestureDetector(
              onTap: () => setState(() => showOriginal ? _showOriginal.remove(id) : _showOriginal.add(id)),
              child: Text(showOriginal ? 'Show translation' : 'Translated · show original', style: TextStyle(color: AppColors.cyan, fontSize: 11, fontWeight: FontWeight.w600)),
            ),
          Text(
            [_time(m['createdAt']), if (tick != null) tick].join(' · '),
            style: TextStyle(color: AppColors.textMuted, fontSize: 11),
          ),
        ]),
      ),
    );
  }

  String _time(dynamic raw) {
    final dt = DateTime.tryParse('$raw')?.toLocal();
    if (dt == null) return '';
    final h = dt.hour % 12 == 0 ? 12 : dt.hour % 12;
    return '$h:${dt.minute.toString().padLeft(2, '0')} ${dt.hour < 12 ? 'AM' : 'PM'}';
  }
}
