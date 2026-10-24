import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_contacts/flutter_contacts.dart';
import 'package:provider/provider.dart';
import 'package:share_plus/share_plus.dart';

import '../providers/auth_provider.dart';
import '../services/api_service.dart';
import '../services/call_readiness.dart';
import '../services/media_store.dart';
import '../theme/app_theme.dart';
import '../widgets/attachment_picker.dart';
import '../widgets/chat_attachments.dart';
import '../widgets/nt_ui.dart';
import 'business_account.dart';
import 'business_categories.dart';
import 'business_onboarding_screen.dart';
import 'business_profile_screen.dart';
import 'business_tools_screen.dart';

/// NeuraTalk Business: like WhatsApp Business, inside NeuraTalk. Chats with
/// customers (each in the agent's own language), business tools (profile,
/// catalog, automatic replies, link & QR, statistics) and settings.
class BusinessShell extends StatefulWidget {
  const BusinessShell({super.key});

  @override
  State<BusinessShell> createState() => _BusinessShellState();
}

class _BusinessShellState extends State<BusinessShell> {
  int _tab = 0;
  BusinessAccount? _account;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) unawaited(CallReadiness.ensure(context));
    });
  }

  @override
  void dispose() {
    _account?.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final user = context.watch<AuthProvider>().user ?? const {};
    final businessId = int.tryParse('${user['organizationId'] ?? (user['organization'] as Map?)?['id'] ?? ''}');
    // No business on this number yet: create it right here.
    if (businessId == null) return const BusinessOnboardingScreen();
    if (_account?.businessId != businessId) {
      _account?.dispose();
      _account = BusinessAccount(businessId)..load();
    }
    return ChangeNotifierProvider<BusinessAccount>.value(
      value: _account!,
      child: Scaffold(
        body: IndexedStack(index: _tab, children: [
          BusinessInboxScreen(businessId: businessId),
          const BusinessToolsScreen(),
          const _BusinessSettings(),
        ]),
        bottomNavigationBar: NavigationBar(
          selectedIndex: _tab,
          onDestinationSelected: (i) => setState(() => _tab = i),
          backgroundColor: AppColors.background,
          destinations: const [
            NavigationDestination(icon: Icon(Icons.forum_outlined), selectedIcon: Icon(Icons.forum), label: 'Chats'),
            NavigationDestination(icon: Icon(Icons.storefront_outlined), selectedIcon: Icon(Icons.storefront), label: 'Tools'),
            NavigationDestination(icon: Icon(Icons.settings_outlined), selectedIcon: Icon(Icons.settings), label: 'Settings'),
          ],
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
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(title: const Text('Settings')),
      body: ListView(children: [
        BusinessIdentityCard(
          onTap: () {
            final account = context.read<BusinessAccount>();
            Navigator.push(context, MaterialPageRoute(
              builder: (_) => ChangeNotifierProvider<BusinessAccount>.value(value: account, child: const BusinessProfileScreen()),
            ));
          },
        ),
        Divider(color: AppColors.border),
        ListTile(
          leading: const Icon(Icons.person_outline),
          title: Text('${user['displayName'] ?? user['username'] ?? ''}', style: TextStyle(color: AppColors.ink, fontWeight: FontWeight.w600)),
          subtitle: Text('${user['phone'] ?? ''} · ${user['role'] == 'company_admin' ? 'Admin' : 'Team member'}',
              style: TextStyle(color: AppColors.textSecondary)),
        ),
        ListTile(
          leading: const Icon(Icons.notifications_active_outlined),
          title: const Text('Make sure notifications and calls ring'),
          subtitle: const Text('Allow notifications, full-screen calls and no battery restriction'),
          onTap: () => CallReadiness.ensure(context, force: true),
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

/// "12:40 PM" today, then "Yesterday", weekday, date.
String businessWhen(Object? iso) {
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

/// The business's conversations with customers.
class BusinessInboxScreen extends StatefulWidget {
  const BusinessInboxScreen({super.key, required this.businessId});
  final int businessId;

  @override
  State<BusinessInboxScreen> createState() => _BusinessInboxScreenState();
}

class _BusinessInboxScreenState extends State<BusinessInboxScreen> {
  String _filter = 'all';
  String? _label;
  String _query = '';
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

  Future<void> _open(Map<String, dynamic> c) async {
    final account = context.read<BusinessAccount>();
    await Navigator.push(context, MaterialPageRoute(
      builder: (_) => ChangeNotifierProvider<BusinessAccount>.value(
        value: account,
        child: BusinessConversationScreen(businessId: widget.businessId, conversationId: (c['id'] as num).toInt(), summary: c),
      ),
    ));
    _load(quiet: true);
  }

  Future<void> _newChat() async {
    final started = await showModalBottomSheet<int>(
      context: context,
      isScrollControlled: true,
      backgroundColor: AppColors.surface,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(20))),
      builder: (_) => _NewChatSheet(base: _base),
    );
    await _load(quiet: true);
    if (started == null || !mounted) return;
    final matches = _conversations.where((x) => (x['id'] as num).toInt() == started);
    if (matches.isNotEmpty) _open(matches.first);
  }

  List<Map<String, dynamic>> get _visible {
    final q = _query.trim().toLowerCase();
    return _conversations.where((c) {
      final labels = (c['labels'] as List? ?? const []).map((e) => '$e').toList();
      if (_label != null && !labels.contains(_label)) return false;
      if (q.isEmpty) return true;
      return '${c['customerName'] ?? ''} ${c['customerPhone'] ?? ''} ${(c['lastMessage'] as Map?)?['content'] ?? ''}'.toLowerCase().contains(q);
    }).toList();
  }

  @override
  Widget build(BuildContext context) {
    final role = context.watch<AuthProvider>().user?['role'];
    final account = context.watch<BusinessAccount>();
    final usedLabels = {for (final c in _conversations) ...(c['labels'] as List? ?? const []).map((e) => '$e')}.toList();
    final visible = _visible;
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(
        titleSpacing: 16,
        title: Row(children: [
          NtAvatar(name: account.name, avatarUrl: account.logoUrl, size: 34),
          const SizedBox(width: 10),
          Flexible(child: Text(account.name, overflow: TextOverflow.ellipsis)),
          if (account.verified) Padding(padding: const EdgeInsets.only(left: 4), child: Icon(Icons.verified, size: 18, color: AppColors.cyan)),
        ]),
        bottom: PreferredSize(
          preferredSize: const Size.fromHeight(48),
          child: SizedBox(
            height: 48,
            child: ListView(
              scrollDirection: Axis.horizontal,
              padding: const EdgeInsets.fromLTRB(12, 0, 12, 8),
              children: [
                for (final f in const [('all', 'All'), ('mine', 'Mine'), ('unassigned', 'Unassigned')])
                  Padding(
                    padding: const EdgeInsets.only(right: 8),
                    child: ChoiceChip(
                      label: Text(f.$2),
                      selected: _filter == f.$1 && _label == null,
                      onSelected: (_) {
                        setState(() { _filter = f.$1; _label = null; _loading = true; });
                        _load();
                      },
                    ),
                  ),
                for (final l in usedLabels)
                  Padding(
                    padding: const EdgeInsets.only(right: 8),
                    child: ChoiceChip(
                      avatar: const Icon(Icons.label_outline, size: 16),
                      label: Text(l),
                      selected: _label == l,
                      onSelected: (on) => setState(() => _label = on ? l : null),
                    ),
                  ),
              ],
            ),
          ),
        ),
      ),
      floatingActionButton: _noAccess
          ? null
          : FloatingActionButton(
              heroTag: 'biz-new-chat',
              tooltip: 'New chat',
              onPressed: _newChat,
              backgroundColor: AppColors.cyan,
              foregroundColor: AppColors.onAccent,
              child: const Icon(Icons.add_comment_outlined),
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
                    ? ListView(children: [
                        NtEmptyState(icon: Icons.wifi_off, title: "Couldn't load your chats", message: _error!, error: true, actionLabel: 'Try again', onAction: _load),
                      ])
                    : _conversations.isEmpty
                        ? ListView(children: [
                            NtEmptyState(
                              icon: Icons.forum_outlined,
                              title: 'No chats yet',
                              message: 'Customers who message ${account.name} appear here. Start a chat with the + button, or share your link from Tools.',
                            ),
                          ])
                        : ListView(
                            padding: const EdgeInsets.only(bottom: 96),
                            children: [
                              Padding(
                                padding: const EdgeInsets.fromLTRB(16, 8, 16, 4),
                                child: TextField(
                                  onChanged: (v) => setState(() => _query = v),
                                  decoration: InputDecoration(
                                    hintText: 'Search chats',
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
                              if (visible.isEmpty)
                                Padding(padding: const EdgeInsets.all(32), child: Center(child: Text('No chats match', style: TextStyle(color: AppColors.textMuted)))),
                              for (final c in visible) _tile(c),
                            ],
                          ),
      ),
    );
  }

  Widget _tile(Map<String, dynamic> c) {
    final last = (c['lastMessage'] as Map?) ?? const {};
    final name = c['customerName']?.toString() ?? 'Customer';
    final labels = (c['labels'] as List? ?? const []).map((e) => '$e').toList();
    return ListTile(
      contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
      leading: NtAvatar(name: name, avatarUrl: c['customerAvatarUrl'] as String?, size: 50),
      title: Text(name, maxLines: 1, overflow: TextOverflow.ellipsis, style: TextStyle(color: AppColors.ink, fontWeight: FontWeight.w600)),
      subtitle: Column(crossAxisAlignment: CrossAxisAlignment.start, mainAxisSize: MainAxisSize.min, children: [
        Text('${last['content'] ?? ''}', maxLines: 1, overflow: TextOverflow.ellipsis, style: TextStyle(color: AppColors.textSecondary)),
        if (labels.isNotEmpty)
          Padding(
            padding: const EdgeInsets.only(top: 4),
            child: Wrap(spacing: 4, runSpacing: 4, children: [for (final l in labels) LabelChip(l)]),
          ),
      ]),
      trailing: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        crossAxisAlignment: CrossAxisAlignment.end,
        children: [
          Text(businessWhen(last['createdAt']), style: TextStyle(color: AppColors.textSecondary, fontSize: 12)),
          const SizedBox(height: 4),
          Text(c['assignedToUsername'] != null ? '${c['assignedToUsername']}' : 'Unassigned', style: TextStyle(color: AppColors.textMuted, fontSize: 11)),
        ],
      ),
      onTap: () => _open(c),
    );
  }
}

/// Small coloured label; the same label always has the same colour.
class LabelChip extends StatelessWidget {
  const LabelChip(this.label, {super.key});
  final String label;

  static const _colors = [Color(0xFF1E66F5), Color(0xFF16A34A), Color(0xFFEA580C), Color(0xFF7C3AED), Color(0xFF0891B2), Color(0xFFDB2777)];

  @override
  Widget build(BuildContext context) {
    final color = _colors[label.hashCode.abs() % _colors.length];
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 2),
      decoration: BoxDecoration(color: color.withValues(alpha: 0.12), borderRadius: BorderRadius.circular(8)),
      child: Text(label, style: TextStyle(color: color, fontSize: 11.5, fontWeight: FontWeight.w600)),
    );
  }
}

/// Message a customer first, by their mobile number (or pick from contacts).
class _NewChatSheet extends StatefulWidget {
  const _NewChatSheet({required this.base});
  final String base;

  @override
  State<_NewChatSheet> createState() => _NewChatSheetState();
}

class _NewChatSheetState extends State<_NewChatSheet> {
  final _phone = TextEditingController();
  final _name = TextEditingController();
  final _message = TextEditingController();
  bool _sending = false;
  String? _error;

  @override
  void dispose() {
    _phone.dispose();
    _name.dispose();
    _message.dispose();
    super.dispose();
  }

  Future<void> _pickContact() async {
    try {
      final picked = await FlutterContacts.openExternalPick();
      if (picked == null) return;
      final full = picked.phones.isEmpty ? await FlutterContacts.getContact(picked.id) : picked;
      final number = (full?.phones.isNotEmpty ?? false) ? full!.phones.first.number : '';
      setState(() {
        _phone.text = number;
        if (_name.text.trim().isEmpty) _name.text = picked.displayName;
      });
    } catch (_) {
      if (mounted) setState(() => _error = 'Could not open contacts. Type the number instead.');
    }
  }

  Future<void> _send() async {
    final digits = _phone.text.replaceAll(RegExp(r'\D'), '');
    if (digits.length < 10) {
      setState(() => _error = 'Enter a 10-digit mobile number');
      return;
    }
    if (_message.text.trim().isEmpty) {
      setState(() => _error = 'Write a message');
      return;
    }
    setState(() { _sending = true; _error = null; });
    try {
      final res = await ApiService.post('${widget.base}/chats', {
        'phone': _phone.text.trim(),
        if (_name.text.trim().isNotEmpty) 'name': _name.text.trim(),
        'message': _message.text.trim(),
      });
      if (!mounted) return;
      if (res['onNeuraTalk'] == false) {
        final invite = await showDialog<bool>(
          context: context,
          builder: (d) => AlertDialog(
            title: const Text('Not on NeuraTalk yet'),
            content: const Text('Your message is saved. They get it as soon as they join NeuraTalk with this number. Invite them now?'),
            actions: [
              TextButton(onPressed: () => Navigator.pop(d, false), child: const Text('Later')),
              TextButton(onPressed: () => Navigator.pop(d, true), child: const Text('Invite')),
            ],
          ),
        );
        if (invite == true) {
          await Share.share('Chat with us on NeuraTalk — messages and calls in your own language: https://neuratalk.in');
        }
      }
      if (mounted) Navigator.pop(context, (res['conversationId'] as num?)?.toInt());
    } catch (e) {
      if (mounted) setState(() => _error = e is ApiException ? e.message : 'Could not send. Try again.');
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.fromLTRB(20, 20, 20, MediaQuery.of(context).viewInsets.bottom + 20),
      child: SingleChildScrollView(
        child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          Text('New chat', style: TextStyle(color: AppColors.ink, fontSize: 20, fontWeight: FontWeight.w800)),
          const SizedBox(height: 4),
          Text('They see your business name and logo.', style: TextStyle(color: AppColors.textSecondary)),
          const SizedBox(height: 16),
          Row(children: [
            Expanded(
              child: TextField(
                controller: _phone,
                keyboardType: TextInputType.phone,
                decoration: const InputDecoration(labelText: 'Mobile number', prefixText: '+91 '),
              ),
            ),
            IconButton(tooltip: 'Pick from contacts', icon: Icon(Icons.contacts_outlined, color: AppColors.cyan), onPressed: _pickContact),
          ]),
          const SizedBox(height: 12),
          TextField(controller: _name, textCapitalization: TextCapitalization.words, decoration: const InputDecoration(labelText: 'Name (optional)')),
          const SizedBox(height: 12),
          TextField(
            controller: _message,
            minLines: 2,
            maxLines: 5,
            maxLength: 4096,
            textCapitalization: TextCapitalization.sentences,
            decoration: const InputDecoration(labelText: 'Message', counterText: ''),
          ),
          if (_error != null) Padding(padding: const EdgeInsets.only(top: 8), child: Text(_error!, style: TextStyle(color: AppColors.red))),
          const SizedBox(height: 16),
          SizedBox(
            height: 50,
            child: ElevatedButton.icon(
              onPressed: _sending ? null : _send,
              icon: _sending
                  ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2, color: AppColors.onAccent))
                  : const Icon(Icons.send),
              label: const Text('Send'),
            ),
          ),
        ]),
      ),
    );
  }
}

/// One customer conversation, for an agent.
class BusinessConversationScreen extends StatefulWidget {
  const BusinessConversationScreen({super.key, required this.businessId, required this.conversationId, this.summary, this.customerName});
  final int businessId;
  final int conversationId;
  /// The inbox row (name, photo, number, labels), when opened from the inbox.
  final Map<String, dynamic>? summary;
  final String? customerName;

  @override
  State<BusinessConversationScreen> createState() => _BusinessConversationScreenState();
}

class _BusinessConversationScreenState extends State<BusinessConversationScreen> {
  static const _ticks = {'queued': 'Sending', 'sent': 'Sent', 'delivered': 'Delivered', 'read': 'Seen', 'failed': 'Not delivered'};
  final _input = TextEditingController();
  List<Map<String, dynamic>> _messages = [];
  List<Map<String, dynamic>> _quickReplies = [];
  late Map<String, dynamic>? _summary = widget.summary;
  late List<String> _labels = (widget.summary?['labels'] as List? ?? const []).map((e) => '$e').toList();
  final Set<int> _showOriginal = {};
  bool _loading = true;
  bool _sending = false;
  String? _error;
  Timer? _poll;

  String get _base => '/api/business/${widget.businessId}';
  String get _name => _summary?['customerName']?.toString() ?? widget.customerName ?? 'Customer';
  String? get _phone => _summary?['customerPhone']?.toString();
  String? get _avatar => _summary?['customerAvatarUrl'] as String?;

  /// Opened from a notification: fetch this chat's row (name, photo, labels).
  Future<void> _loadSummary() async {
    try {
      final res = await ApiService.get('$_base/conversations?assignment=all');
      final rows = (res['conversations'] as List? ?? const []).whereType<Map>().map((c) => Map<String, dynamic>.from(c));
      final match = rows.where((c) => (c['id'] as num).toInt() == widget.conversationId);
      if (match.isNotEmpty && mounted) {
        setState(() {
          _summary = match.first;
          _labels = (match.first['labels'] as List? ?? const []).map((e) => '$e').toList();
        });
      }
    } catch (_) {}
  }

  @override
  void initState() {
    super.initState();
    _load();
    _loadQuickReplies();
    if (_summary == null) _loadSummary();
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

  Future<void> _editLabels() async {
    final chosen = {..._labels};
    final custom = TextEditingController();
    final result = await showModalBottomSheet<List<String>>(
      context: context,
      isScrollControlled: true,
      backgroundColor: AppColors.surface,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(20))),
      builder: (sheet) => StatefulBuilder(
        builder: (sheet, setSheet) => Padding(
          padding: EdgeInsets.fromLTRB(20, 20, 20, MediaQuery.of(sheet).viewInsets.bottom + 20),
          child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            Text('Labels', style: TextStyle(color: AppColors.ink, fontSize: 18, fontWeight: FontWeight.w700)),
            const SizedBox(height: 4),
            Text('Only your team sees labels. Up to 5.', style: TextStyle(color: AppColors.textSecondary)),
            const SizedBox(height: 12),
            Wrap(spacing: 8, runSpacing: 8, children: [
              for (final l in {...kChatLabels, ...chosen})
                FilterChip(
                  label: Text(l),
                  selected: chosen.contains(l),
                  onSelected: (on) => setSheet(() => on && chosen.length < 5 ? chosen.add(l) : chosen.remove(l)),
                ),
            ]),
            const SizedBox(height: 12),
            Row(children: [
              Expanded(child: TextField(controller: custom, maxLength: 24, decoration: const InputDecoration(labelText: 'New label', counterText: ''))),
              TextButton(
                onPressed: () {
                  final t = custom.text.trim();
                  if (t.isNotEmpty && chosen.length < 5) setSheet(() { chosen.add(t); custom.clear(); });
                },
                child: const Text('Add'),
              ),
            ]),
            const SizedBox(height: 12),
            ElevatedButton(onPressed: () => Navigator.pop(sheet, chosen.toList()), child: const Text('Save')),
          ]),
        ),
      ),
    );
    custom.dispose();
    if (result == null) return;
    try {
      final res = await ApiService.patch('$_base/conversations/${widget.conversationId}/labels', {'labels': result});
      if (mounted) setState(() => _labels = (res['labels'] as List? ?? const []).map((e) => '$e').toList());
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e is ApiException ? e.message : 'Could not save labels.')));
    }
  }

  void _customerInfo() {
    showModalBottomSheet(
      context: context,
      backgroundColor: AppColors.surface,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(20))),
      builder: (sheet) => SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(20),
          child: Column(mainAxisSize: MainAxisSize.min, children: [
            NtAvatar(name: _name, avatarUrl: _avatar, size: 88, openOnTap: _avatar != null),
            const SizedBox(height: 12),
            Text(_name, style: TextStyle(color: AppColors.ink, fontSize: 20, fontWeight: FontWeight.w800)),
            if (_phone != null) Text(_phone!, style: TextStyle(color: AppColors.textSecondary)),
            const SizedBox(height: 12),
            if (_labels.isNotEmpty) Wrap(spacing: 6, runSpacing: 6, children: [for (final l in _labels) LabelChip(l)]),
            const SizedBox(height: 8),
            ListTile(
              leading: Icon(Icons.label_outline, color: AppColors.cyan),
              title: const Text('Labels'),
              onTap: () { Navigator.pop(sheet); _editLabels(); },
            ),
            ListTile(
              leading: Icon(Icons.assignment_ind_outlined, color: AppColors.cyan),
              title: const Text('Take this chat'),
              onTap: () { Navigator.pop(sheet); _claim(); },
            ),
          ]),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final typed = _input.text;
    final matches = typed.startsWith('/')
        ? _quickReplies.where((q) => '${q['shortcut']}'.startsWith(typed.substring(1).toLowerCase())).take(5).toList()
        : const <Map<String, dynamic>>[];
    final ours = _messages.where((m) => m['deliveryToCustomer'] != null);
    final lastFailed = ours.isNotEmpty && ours.last['deliveryToCustomer'] == 'failed';
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(
        titleSpacing: 0,
        title: InkWell(
          onTap: _customerInfo,
          child: Row(children: [
            NtAvatar(name: _name, avatarUrl: _avatar, size: 38),
            const SizedBox(width: 10),
            Expanded(
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text(_name, overflow: TextOverflow.ellipsis),
                if (_phone != null && _phone != _name) Text(_phone!, style: TextStyle(color: AppColors.textSecondary, fontSize: 12)),
              ]),
            ),
          ]),
        ),
        actions: [
          IconButton(tooltip: 'Labels', icon: const Icon(Icons.label_outline), onPressed: _editLabels),
          IconButton(tooltip: 'Take this chat', icon: const Icon(Icons.assignment_ind_outlined), onPressed: _claim),
        ],
      ),
      body: Column(children: [
        if (_labels.isNotEmpty)
          Container(
            width: double.infinity,
            padding: const EdgeInsets.fromLTRB(12, 6, 12, 6),
            color: AppColors.surface,
            child: Wrap(spacing: 6, runSpacing: 4, children: [for (final l in _labels) LabelChip(l)]),
          ),
        if (lastFailed)
          Container(
            width: double.infinity,
            padding: const EdgeInsets.all(10),
            color: AppColors.orange.withValues(alpha: 0.12),
            child: Row(children: [
              Icon(Icons.info_outline, color: AppColors.orange, size: 18),
              const SizedBox(width: 8),
              Expanded(
                child: Text('Not delivered: this number is not on NeuraTalk yet, or they blocked you.',
                    style: TextStyle(color: AppColors.ink, fontSize: 13)),
              ),
              TextButton(
                onPressed: () => Share.share('Chat with us on NeuraTalk — messages and calls in your own language: https://neuratalk.in'),
                child: const Text('Invite'),
              ),
            ]),
          ),
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
                  textCapitalization: TextCapitalization.sentences,
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
                      : ChatFileAttachment(
                          objectPath: a['url'] as String,
                          name: original.replaceFirst(RegExp(r'^\S+\s'), ''),
                          size: (a['sizeBytes'] as num?)?.toInt(),
                          mime: a['mimeType'] as String?,
                        ),
            ),
          if (attachments.isEmpty || !RegExp(r'^(📷|🎬|🎤|📄) ').hasMatch(original))
            SelectableText(translated != null && !showOriginal ? translated : original, style: TextStyle(color: AppColors.ink, fontSize: 15)),
          if (translated != null)
            GestureDetector(
              onTap: () => setState(() => showOriginal ? _showOriginal.remove(id) : _showOriginal.add(id)),
              child: Text(showOriginal ? 'Show translation' : 'Translated · show original',
                  style: TextStyle(color: AppColors.cyan, fontSize: 11, fontWeight: FontWeight.w600)),
            ),
          Text(
            [_time(m['createdAt']), if (tick != null) tick].join(' · '),
            style: TextStyle(color: tick == 'Not delivered' ? AppColors.orange : AppColors.textMuted, fontSize: 11),
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
