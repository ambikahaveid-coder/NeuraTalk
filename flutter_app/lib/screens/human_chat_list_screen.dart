import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../theme/app_theme.dart';
import '../providers/personal_chat_provider.dart';
import '../providers/auth_provider.dart';
import '../services/api_service.dart';
import 'conversation_screen.dart';
import 'user_discovery_screen.dart';
import 'chat_screen.dart';
import 'group_chat_list_screen.dart';

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
      if (dt.year == now.year && dt.month == now.month && dt.day == now.day) {
        return '${dt.hour.toString().padLeft(2, '0')}:${dt.minute.toString().padLeft(2, '0')}';
      }
      if (now.difference(dt).inDays == 1) return 'Yesterday';
      const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
      return days[dt.weekday - 1];
    } catch (_) {
      return '';
    }
  }

  List<Map<String, dynamic>> _visibleThreads(PersonalChatProvider provider) {
    final filtered = provider.threads.where((t) => (t['isArchived'] == true) == _showArchived).toList();
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
              title: Text(isPinned ? 'Unpin' : 'Pin', style: const TextStyle(color: AppColors.white)),
              onTap: () {
                Navigator.pop(sheetContext);
                context.read<PersonalChatProvider>().updateThreadState(threadId, pinned: !isPinned);
              },
            ),
            ListTile(
              leading: Icon(isMuted ? Icons.notifications_off : Icons.notifications_off_outlined, color: AppColors.cyan),
              title: Text(isMuted ? 'Unmute' : 'Mute', style: const TextStyle(color: AppColors.white)),
              onTap: () {
                Navigator.pop(sheetContext);
                context.read<PersonalChatProvider>().updateThreadState(threadId, muted: !isMuted);
              },
            ),
            ListTile(
              leading: Icon(isArchived ? Icons.unarchive_outlined : Icons.archive_outlined, color: AppColors.cyan),
              title: Text(isArchived ? 'Unarchive' : 'Archive', style: const TextStyle(color: AppColors.white)),
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
        title: Text(_showArchived ? 'Archived' : 'Chat'),
        leading: _showArchived
            ? IconButton(icon: const Icon(Icons.arrow_back), onPressed: () => setState(() => _showArchived = false))
            : null,
        actions: [
          if (!_showArchived) ...[
            IconButton(
              icon: const Icon(Icons.archive_outlined, color: AppColors.cyan),
              tooltip: 'Archived',
              onPressed: () => setState(() => _showArchived = true),
            ),
            IconButton(
              icon: const Icon(Icons.auto_awesome, color: AppColors.cyan),
              tooltip: 'NEURA AI',
              onPressed: () => Navigator.push(context, MaterialPageRoute(builder: (_) => const ChatScreen())),
            ),
            IconButton(
              icon: const Icon(Icons.groups_outlined, color: AppColors.cyan),
              tooltip: 'Groups',
              onPressed: () => Navigator.push(context, MaterialPageRoute(builder: (_) => const GroupChatListScreen())),
            ),
            IconButton(
              icon: const Icon(Icons.person_add_alt_1, color: AppColors.cyan),
              tooltip: 'New chat',
              onPressed: () => Navigator.push(context, MaterialPageRoute(builder: (_) => const UserDiscoveryScreen())),
            ),
          ],
        ],
      ),
      body: RefreshIndicator(
        onRefresh: provider.loadThreads,
        color: AppColors.cyan,
        child: provider.loadingThreads && provider.threads.isEmpty
            ? const Center(child: CircularProgressIndicator(color: AppColors.cyan))
            : provider.threadsError != null
                ? Center(child: Text(provider.threadsError!, style: const TextStyle(color: AppColors.red)))
                : visible.isEmpty
                    ? (_showArchived
                        ? const Center(child: Text('No archived chats', style: TextStyle(color: AppColors.textMuted)))
                        : _emptyState())
                    : ListView.builder(
                        itemCount: visible.length,
                        itemBuilder: (_, i) => _threadTile(visible[i]),
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
                  decoration: BoxDecoration(color: AppColors.cyan.withOpacity(0.1), shape: BoxShape.circle),
                  child: const Icon(Icons.forum_outlined, color: AppColors.cyan, size: 40),
                ),
                const SizedBox(height: 20),
                const Text('No conversations yet', style: TextStyle(color: AppColors.white, fontSize: 18, fontWeight: FontWeight.w700)),
                const SizedBox(height: 8),
                const Text('Find someone on NeuraTalk to start chatting', style: TextStyle(color: AppColors.textSecondary, fontSize: 13)),
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
      leading: CircleAvatar(
        radius: 24,
        backgroundColor: AppColors.cyan.withOpacity(0.15),
        backgroundImage: avatarUrl != null ? NetworkImage('${ApiService.baseUrl}$avatarUrl') : null,
        child: avatarUrl == null ? const Icon(Icons.person, color: AppColors.cyan) : null,
      ),
      title: Row(
        children: [
          Flexible(
            child: Text(
              peer['displayName']?.toString() ?? 'Unknown user',
              style: TextStyle(color: AppColors.white, fontWeight: unread > 0 ? FontWeight.w700 : FontWeight.w600),
              overflow: TextOverflow.ellipsis,
            ),
          ),
          if (isPinned) const Padding(padding: EdgeInsets.only(left: 6), child: Icon(Icons.push_pin, size: 13, color: AppColors.textMuted)),
          if (isMuted) const Padding(padding: EdgeInsets.only(left: 4), child: Icon(Icons.notifications_off, size: 13, color: AppColors.textMuted)),
        ],
      ),
      subtitle: Text(
        thread['lastMessagePreview']?.toString() ?? 'Say hello 👋',
        style: TextStyle(color: unread > 0 ? AppColors.textPrimary : AppColors.textMuted, fontSize: 13),
        maxLines: 1,
        overflow: TextOverflow.ellipsis,
      ),
      trailing: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        crossAxisAlignment: CrossAxisAlignment.end,
        children: [
          Text(_formatTime(thread['lastMessageAt']), style: const TextStyle(color: AppColors.textMuted, fontSize: 11)),
          if (unread > 0) ...[
            const SizedBox(height: 6),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 2),
              decoration: const BoxDecoration(color: AppColors.cyan, shape: BoxShape.circle),
              child: Text('$unread', style: const TextStyle(color: AppColors.background, fontSize: 11, fontWeight: FontWeight.w700)),
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
