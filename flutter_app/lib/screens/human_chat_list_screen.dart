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
import 'contacts_screen.dart';

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
      return '${peer['displayName'] ?? ''} ${peer['phone'] ?? ''} ${t['lastMessagePreview'] ?? ''}'.toLowerCase().contains(q);
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
    final visible = _visibleThreads(provider);

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
                } else if (v == 'archived') {
                  setState(() => _showArchived = true);
                }
              },
              itemBuilder: (_) => const [
                PopupMenuItem(value: 'contacts', child: ListTile(leading: Icon(Icons.contacts_outlined), title: Text('Contacts'), contentPadding: EdgeInsets.zero)),
                PopupMenuItem(value: 'archived', child: ListTile(leading: Icon(Icons.archive_outlined), title: Text('Archived chats'), contentPadding: EdgeInsets.zero)),
              ],
            ),
          ],
        ],
      ),
      floatingActionButton: _showArchived
          ? null
          : FloatingActionButton.extended(
              heroTag: 'new-chat',
              onPressed: () => Navigator.push(context, MaterialPageRoute(builder: (_) => const UserDiscoveryScreen())),
              backgroundColor: AppColors.cyan,
              foregroundColor: AppColors.onAccent,
              icon: const Icon(Icons.chat_outlined),
              label: const Text('New chat', style: TextStyle(fontWeight: FontWeight.w700)),
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
                : provider.threads.isEmpty && !_showArchived
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
                          for (final t in visible) _threadTile(t),
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

  Widget _threadTile(Map<String, dynamic> thread) {
    final peer = (thread['peer'] as Map<String, dynamic>?) ?? const {};
    final avatarUrl = peer['avatarUrl'] as String?;
    final unread = (thread['unreadCount'] as int?) ?? 0;
    final isPinned = thread['isPinned'] == true;
    final isMuted = thread['isMuted'] == true;

    return ListTile(
      contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
      leading: NtAvatar(name: peer['displayName']?.toString() ?? '', avatarUrl: avatarUrl, size: 50),
      title: Row(
        children: [
          Flexible(
            child: Text(
              peer['displayName']?.toString() ?? 'Unknown user',
              style: TextStyle(color: AppColors.ink, fontWeight: unread > 0 ? FontWeight.w700 : FontWeight.w600),
              overflow: TextOverflow.ellipsis,
            ),
          ),
          if (isPinned) Padding(padding: EdgeInsets.only(left: 6), child: Icon(Icons.push_pin, size: 13, color: AppColors.textMuted)),
          if (isMuted) Padding(padding: EdgeInsets.only(left: 4), child: Icon(Icons.notifications_off, size: 13, color: AppColors.textMuted)),
        ],
      ),
      subtitle: Column(crossAxisAlignment: CrossAxisAlignment.start, mainAxisSize: MainAxisSize.min, children: [
        Padding(
          padding: const EdgeInsets.only(top: 2, bottom: 2),
          child: LanguagePairChip(mine: thread['viewerLanguage']?.toString(), theirs: thread['peerLanguage']?.toString(), compact: true),
        ),
        Text(
        thread['lastMessagePreview']?.toString() ?? 'Say hello 👋',
        style: TextStyle(color: unread > 0 ? AppColors.textPrimary : AppColors.textSecondary, fontSize: 14.5),
        maxLines: 1,
        overflow: TextOverflow.ellipsis,
      ),
      ]),
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
