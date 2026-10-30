import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../theme/app_theme.dart';
import '../widgets/nt_ui.dart';
import '../providers/personal_chat_provider.dart';
import '../providers/auth_provider.dart';
import 'conversation_screen.dart';
import 'user_discovery_screen.dart';
import 'chat_screen.dart';
import 'group_chat_list_screen.dart';
import 'business_messages_screen.dart';
import 'contacts_screen.dart';
import '../services/contact_resolver.dart';

/// Real human-to-human conversations (server/personal-chat-routes.ts).
/// This is the "Chat" bottom-nav tab. NEURA AI (the existing assistant,
/// unchanged, `/api/ai/chat`) is reachable from the app-bar action here —
/// the two conversation types are never mixed.
class HumanChatListScreen extends StatefulWidget {
  const HumanChatListScreen({super.key});

  @override
  State<HumanChatListScreen> createState() => _HumanChatListScreenState();
}

class _HumanChatListScreenState extends State<HumanChatListScreen> {
  bool _showArchived = false;
  String _query = '';

  @override
  void initState() {
    super.initState();
    final provider = context.read<PersonalChatProvider>();
    provider.loadThreads();
    provider.setSelfId(context.read<AuthProvider>().user?['id']?.toString());
    provider.connectStream();
    // Show saved contact names (as Home and Calls do) once contacts are read.
    ContactResolver.instance.ensureLoaded().then((_) {
      if (mounted) setState(() {});
    });
  }

  String _formatTime(dynamic raw) {
    if (raw == null) return '';
    try {
      final dt = DateTime.parse(raw.toString()).toLocal();
      final now = DateTime.now();
      final diff = DateTime(now.year, now.month, now.day).difference(DateTime(dt.year, dt.month, dt.day)).inDays;
      if (diff == 0) {
        final hour12 = dt.hour % 12 == 0 ? 12 : dt.hour % 12;
        return '$hour12:${dt.minute.toString().padLeft(2, '0')} ${dt.hour < 12 ? 'AM' : 'PM'}';
      }
      if (diff == 1) return 'Yesterday';
      if (diff < 7) return const ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][dt.weekday - 1];
      return '${dt.day}/${dt.month}/${dt.year % 100}';
    } catch (_) {
      return '';
    }
  }

  List<Map<String, dynamic>> _visibleThreads(PersonalChatProvider provider) {
    final q = _query.trim().toLowerCase();
    final filtered = provider.threads.where((t) {
      if ((t['isArchived'] == true) != _showArchived) return false;
      if (q.isEmpty) return true;
      final peer = (t['peer'] as Map?) ?? const {};
      final saved = ContactResolver.instance.nameFor(peer['phone']?.toString()) ?? '';
      return '$saved ${peer['displayName'] ?? ''} ${peer['phone'] ?? ''} ${t['lastMessagePreview'] ?? ''}'.toLowerCase().contains(q);
    }).toList();
    filtered.sort((a, b) {
      final aPinned = a['isPinned'] == true;
      final bPinned = b['isPinned'] == true;
      if (aPinned != bPinned) return aPinned ? -1 : 1;
      final aTime = DateTime.tryParse(a['lastMessageAt']?.toString() ?? '') ?? DateTime(1970);
      final bTime = DateTime.tryParse(b['lastMessageAt']?.toString() ?? '') ?? DateTime(1970);
      return bTime.compareTo(aTime);
    });
    return filtered;
  }

  /// People and businesses in one list (like WhatsApp): pinned first, then newest.
  List<Map<String, dynamic>> _visibleItems(PersonalChatProvider provider) {
    final personal = _visibleThreads(provider);
    if (_showArchived) return personal;
    final q = _query.trim().toLowerCase();
    final business = provider.businessThreads
        .where((b) => q.isEmpty || '${b['businessName'] ?? ''} ${(b['lastMessage'] as Map?)?['content'] ?? ''}'.toLowerCase().contains(q))
        .map((b) => {...b, '_business': true});
    final all = [...personal, ...business];
    DateTime timeOf(Map<String, dynamic> t) {
      final last = t['lastMessage'] as Map?;
      final Object? raw;
      if (t['_business'] == true) {
        raw = last == null ? null : last['createdAt'];
      } else {
        raw = t['lastMessageAt'];
      }
      return DateTime.tryParse(raw?.toString() ?? '') ?? DateTime(1970);
    }
    all.sort((a, b) {
      final aPinned = a['isPinned'] == true;
      final bPinned = b['isPinned'] == true;
      if (aPinned != bPinned) return aPinned ? -1 : 1;
      return timeOf(b).compareTo(timeOf(a));
    });
    return all;
  }

  void _showThreadActions(Map<String, dynamic> thread) {
    final threadId = thread['id'] as int;
    final isPinned = thread['isPinned'] == true;
    final isArchived = thread['isArchived'] == true;
    final isMuted = thread['isMuted'] == true;
    showModalBottomSheet(
      context: context,
      backgroundColor: AppColors.surface,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(20))),
      builder: (sheetContext) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            ListTile(
              leading: Icon(isPinned ? Icons.push_pin : Icons.push_pin_outlined, color: AppColors.cyan),
              title: Text(isPinned ? 'Unpin' : 'Pin', style: TextStyle(color: AppColors.ink)),
              onTap: () {
                Navigator.pop(sheetContext);
                context.read<PersonalChatProvider>().updateThreadState(threadId, pinned: !isPinned);
              },
            ),
            ListTile(
              leading: Icon(isMuted ? Icons.notifications_off : Icons.notifications_off_outlined, color: AppColors.cyan),
              title: Text(isMuted ? 'Unmute' : 'Mute', style: TextStyle(color: AppColors.ink)),
              onTap: () {
                Navigator.pop(sheetContext);
                context.read<PersonalChatProvider>().updateThreadState(threadId, muted: !isMuted);
              },
            ),
            ListTile(
              leading: Icon(isArchived ? Icons.unarchive_outlined : Icons.archive_outlined, color: AppColors.cyan),
              title: Text(isArchived ? 'Unarchive' : 'Archive', style: TextStyle(color: AppColors.ink)),
              onTap: () {
                Navigator.pop(sheetContext);
                context.read<PersonalChatProvider>().updateThreadState(threadId, archived: !isArchived);
              },
            ),
          ],
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final provider = context.watch<PersonalChatProvider>();
    final visible = _visibleItems(provider);

    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(
        title: Text(_showArchived ? 'Archived' : 'Chats'),
        leading: _showArchived
            ? IconButton(icon: const Icon(Icons.arrow_back), onPressed: () => setState(() => _showArchived = false))
            : null,
        actions: [
          if (!_showArchived) ...[
            IconButton(
              icon: Icon(Icons.auto_awesome, color: AppColors.cyan),
              tooltip: 'NEURA AI',
              onPressed: () => Navigator.push(context, MaterialPageRoute(builder: (_) => const ChatScreen())),
            ),
            // Two icons and a menu: business chats already appear in this
            // list, so their full list lives in the menu.
            IconButton(
              icon: Icon(Icons.groups_outlined, color: AppColors.cyan),
              tooltip: 'Groups',
              onPressed: () => Navigator.push(context, MaterialPageRoute(builder: (_) => const GroupChatListScreen())),
            ),
            PopupMenuButton<String>(
              tooltip: 'More',
              icon: Icon(Icons.more_vert, color: AppColors.textSecondary),
              onSelected: (v) {
                if (v == 'contacts') {
                  Navigator.push(context, MaterialPageRoute(builder: (_) => const ContactsScreen()));
                } else if (v == 'business') {
                  Navigator.push(context, MaterialPageRoute(builder: (_) => const BusinessMessagesScreen()));
                } else if (v == 'archived') {
                  setState(() => _showArchived = true);
                }
              },
              itemBuilder: (_) => const [
                PopupMenuItem(value: 'business', child: ListTile(leading: Icon(Icons.storefront_outlined), title: Text('Business messages'), contentPadding: EdgeInsets.zero)),
                PopupMenuItem(value: 'contacts', child: ListTile(leading: Icon(Icons.contacts_outlined), title: Text('Contacts'), contentPadding: EdgeInsets.zero)),
                PopupMenuItem(value: 'archived', child: ListTile(leading: Icon(Icons.archive_outlined), title: Text('Archived chats'), contentPadding: EdgeInsets.zero)),
              ],
            ),
          ],
        ],
      ),
      floatingActionButton: _showArchived
          ? null
          // Compact, so it never sits on top of the last chat's preview.
          : FloatingActionButton(
              heroTag: 'new-chat',
              tooltip: 'New chat',
              onPressed: () => Navigator.push(context, MaterialPageRoute(builder: (_) => const UserDiscoveryScreen())),
              backgroundColor: AppColors.cyan,
              foregroundColor: AppColors.onAccent,
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
              child: const Icon(Icons.add_comment_outlined),
            ),
      body: RefreshIndicator(
        onRefresh: provider.loadThreads,
        color: AppColors.cyan,
        child: provider.loadingThreads && provider.threads.isEmpty
            ? Center(child: CircularProgressIndicator(color: AppColors.cyan))
            : provider.threadsError != null
                ? ListView(children: [
                    NtEmptyState(icon: Icons.wifi_off, title: "Couldn't load your chats", message: provider.threadsError!, error: true,
                        actionLabel: 'Try again', onAction: provider.loadThreads),
                  ])
                : provider.threads.isEmpty && provider.businessThreads.isEmpty && !_showArchived
                    ? _emptyState()
                    : ListView(
                        padding: const EdgeInsets.only(bottom: 96),
                        children: [
                          Padding(
                            padding: const EdgeInsets.fromLTRB(16, 4, 16, 8),
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
                            Padding(
                              padding: const EdgeInsets.all(32),
                              child: Center(
                                child: Text(_showArchived && _query.isEmpty ? 'No archived chats' : 'No chats match "$_query"',
                                    style: TextStyle(color: AppColors.textMuted, fontSize: 15)),
                              ),
                            ),
                          for (final t in visible) t['_business'] == true ? _businessTile(t) : _threadTile(t),
                        ],
                      ),
      ),
    );
  }

  Widget _emptyState() {
    return LayoutBuilder(
      builder: (_, constraints) => SingleChildScrollView(
        physics: const AlwaysScrollableScrollPhysics(),
        child: ConstrainedBox(
          constraints: BoxConstraints(minHeight: constraints.maxHeight),
          child: Center(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Container(
                  padding: const EdgeInsets.all(24),
                  decoration: BoxDecoration(color: AppColors.cyan.withValues(alpha: 0.1), shape: BoxShape.circle),
                  child: Icon(Icons.forum_outlined, color: AppColors.cyan, size: 40),
                ),
                const SizedBox(height: 20),
                Text('No conversations yet', style: TextStyle(color: AppColors.ink, fontSize: 18, fontWeight: FontWeight.w700)),
                const SizedBox(height: 8),
                Text('Find someone on NeuraTalk to start chatting', style: TextStyle(color: AppColors.textSecondary, fontSize: 15)),
                const SizedBox(height: 24),
                ElevatedButton.icon(
                  onPressed: () => Navigator.push(context, MaterialPageRoute(builder: (_) => const UserDiscoveryScreen())),
                  icon: const Icon(Icons.person_add_alt_1),
                  label: const Text('Find people'),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  /// A business chat: its logo, name and verified tick (never a bare number).
  Widget _businessTile(Map<String, dynamic> t) {
    final last = (t['lastMessage'] as Map?) ?? const {};
    final unread = (t['unreadCount'] as num?)?.toInt() ?? 0;
    final name = t['businessName']?.toString() ?? 'Business';
    final preview = '${last['fromBusiness'] == false ? 'You: ' : ''}${last['content'] ?? ''}';
    return ListTile(
      contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
      leading: NtAvatar(name: name, avatarUrl: t['logoUrl'] as String?, size: 50),
      title: Row(children: [
        Flexible(
          child: Text(name, overflow: TextOverflow.ellipsis,
              style: TextStyle(color: AppColors.ink, fontWeight: unread > 0 ? FontWeight.w700 : FontWeight.w600)),
        ),
        if (t['verified'] == true)
          Padding(padding: const EdgeInsets.only(left: 4), child: Icon(Icons.verified, size: 16, color: AppColors.cyan, semanticLabel: 'Verified business')),
      ]),
      subtitle: Column(crossAxisAlignment: CrossAxisAlignment.start, mainAxisSize: MainAxisSize.min, children: [
        Padding(
          padding: const EdgeInsets.only(top: 2, bottom: 2),
          child: Row(children: [
            Icon(Icons.storefront_outlined, size: 13, color: AppColors.textMuted),
            const SizedBox(width: 4),
            Text(t['blocked'] == true ? 'Business · blocked' : 'Business', style: TextStyle(color: AppColors.textMuted, fontSize: 12.5)),
          ]),
        ),
        Text(preview, maxLines: 1, overflow: TextOverflow.ellipsis,
            style: TextStyle(color: unread > 0 ? AppColors.textPrimary : AppColors.textSecondary, fontSize: 14.5)),
      ]),
      trailing: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        crossAxisAlignment: CrossAxisAlignment.end,
        children: [
          Text(_formatTime(last['createdAt']), style: TextStyle(color: unread > 0 ? AppColors.cyan : AppColors.textMuted, fontSize: 12, fontWeight: unread > 0 ? FontWeight.w600 : FontWeight.w400)),
          if (unread > 0) ...[
            const SizedBox(height: 6),
            Container(
              constraints: const BoxConstraints(minWidth: 20),
              padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
              decoration: BoxDecoration(color: AppColors.cyan, borderRadius: BorderRadius.circular(10)),
              child: Text(unread > 99 ? '99+' : '$unread', textAlign: TextAlign.center, style: const TextStyle(color: AppColors.onAccent, fontSize: 11, fontWeight: FontWeight.w700)),
            ),
          ],
        ],
      ),
      onTap: () async {
        await Navigator.push(context, MaterialPageRoute(
          builder: (_) => BusinessChatScreen(businessId: (t['businessId'] as num).toInt(), businessName: name),
        ));
        if (mounted) context.read<PersonalChatProvider>().loadBusinessThreads();
      },
    );
  }

  static bool _isTranslatedPair(Map<String, dynamic> thread) {
    String base(Object? v) => (v?.toString() ?? '').toLowerCase().split(RegExp(r'[-_]')).first;
    final mine = base(thread['viewerLanguage']);
    final theirs = base(thread['peerLanguage']);
    return mine.isNotEmpty && theirs.isNotEmpty && mine != theirs;
  }

  Widget _threadTile(Map<String, dynamic> thread) {
    final peer = (thread['peer'] as Map<String, dynamic>?) ?? const {};
    final avatarUrl = peer['avatarUrl'] as String?;
    final unread = (thread['unreadCount'] as int?) ?? 0;
    final isPinned = thread['isPinned'] == true;
    final isMuted = thread['isMuted'] == true;
    // Same name as everywhere else: the name saved in this phone's contacts.
    final name = ContactResolver.instance.nameFor(peer['phone']?.toString()) ?? peer['displayName']?.toString() ?? 'Unknown user';

    return ListTile(
      contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
      leading: NtAvatar(name: name, avatarUrl: avatarUrl, size: 50),
      title: Row(
        children: [
          Flexible(
            child: Text(
              name,
              style: TextStyle(color: AppColors.ink, fontWeight: unread > 0 ? FontWeight.w700 : FontWeight.w600),
              overflow: TextOverflow.ellipsis,
            ),
          ),
          if (isPinned) Padding(padding: EdgeInsets.only(left: 6), child: Icon(Icons.push_pin, size: 13, color: AppColors.textMuted)),
          if (isMuted) Padding(padding: EdgeInsets.only(left: 4), child: Icon(Icons.notifications_off, size: 13, color: AppColors.textMuted)),
        ],
      ),
      // Two lines like every messenger: name, then the last message. The
      // language pair lives in the chat itself; here a small translate mark
      // only says "this chat is translated" when the two languages differ.
      subtitle: Padding(
        padding: const EdgeInsets.only(top: 2),
        child: Row(children: [
          if (_isTranslatedPair(thread))
            Padding(
              padding: const EdgeInsets.only(right: 4),
              child: Icon(Icons.translate, size: 14, color: AppColors.cyan, semanticLabel: 'Translated chat'),
            ),
          Expanded(
            child: Text(
              thread['lastMessagePreview']?.toString() ?? 'Say hello 👋',
              style: TextStyle(color: unread > 0 ? AppColors.textPrimary : AppColors.textSecondary, fontSize: 14.5),
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
            ),
          ),
        ]),
      ),
      trailing: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        crossAxisAlignment: CrossAxisAlignment.end,
        children: [
          Text(_formatTime(thread['lastMessageAt']), style: TextStyle(color: unread > 0 ? AppColors.cyan : AppColors.textMuted, fontSize: 12, fontWeight: unread > 0 ? FontWeight.w600 : FontWeight.w400)),
          if (unread > 0) ...[
            const SizedBox(height: 6),
            Container(
              constraints: const BoxConstraints(minWidth: 20),
              padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
              decoration: BoxDecoration(color: isMuted ? AppColors.textMuted : AppColors.cyan, borderRadius: BorderRadius.circular(10)),
              child: Text(unread > 99 ? '99+' : '$unread', textAlign: TextAlign.center, style: const TextStyle(color: AppColors.onAccent, fontSize: 11, fontWeight: FontWeight.w700)),
            ),
          ],
        ],
      ),
      onTap: () async {
        await Navigator.push(context, MaterialPageRoute(builder: (_) => ConversationScreen(thread: thread)));
        if (mounted) context.read<PersonalChatProvider>().loadThreads();
      },
      onLongPress: () => _showThreadActions(thread),
    );
  }
}
