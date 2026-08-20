import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../theme/app_theme.dart';
import '../providers/personal_chat_provider.dart';
import '../providers/auth_provider.dart';
import '../services/api_service.dart';
import 'conversation_screen.dart';
import 'user_discovery_screen.dart';
import 'chat_screen.dart';

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

  @override
  Widget build(BuildContext context) {
    final provider = context.watch<PersonalChatProvider>();

    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(
        title: const Text('Chat'),
        actions: [
          IconButton(
            icon: const Icon(Icons.auto_awesome, color: AppColors.cyan),
            tooltip: 'NEURA AI',
            onPressed: () => Navigator.push(context, MaterialPageRoute(builder: (_) => const ChatScreen())),
          ),
          IconButton(
            icon: const Icon(Icons.person_add_alt_1, color: AppColors.cyan),
            tooltip: 'New chat',
            onPressed: () => Navigator.push(context, MaterialPageRoute(builder: (_) => const UserDiscoveryScreen())),
          ),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: provider.loadThreads,
        color: AppColors.cyan,
        child: provider.loadingThreads && provider.threads.isEmpty
            ? const Center(child: CircularProgressIndicator(color: AppColors.cyan))
            : provider.threadsError != null
                ? Center(child: Text(provider.threadsError!, style: const TextStyle(color: AppColors.red)))
                : provider.threads.isEmpty
                    ? _emptyState()
                    : ListView.builder(
                        itemCount: provider.threads.length,
                        itemBuilder: (_, i) => _threadTile(provider.threads[i]),
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

    return ListTile(
      leading: CircleAvatar(
        radius: 24,
        backgroundColor: AppColors.cyan.withOpacity(0.15),
        backgroundImage: avatarUrl != null ? NetworkImage('${ApiService.baseUrl}$avatarUrl') : null,
        child: avatarUrl == null ? const Icon(Icons.person, color: AppColors.cyan) : null,
      ),
      title: Text(
        peer['displayName']?.toString() ?? 'Unknown user',
        style: TextStyle(color: AppColors.white, fontWeight: unread > 0 ? FontWeight.w700 : FontWeight.w600),
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
    );
  }
}
