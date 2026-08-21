import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../theme/app_theme.dart';
import '../providers/group_chat_provider.dart';
import 'group_conversation_screen.dart';
import 'create_group_screen.dart';

/// Real group chat list — server/group-chats.ts:my-groups. Separate from
/// 1:1 chat (personal_chat_provider.dart) and from NEURA AI.
class GroupChatListScreen extends StatefulWidget {
  const GroupChatListScreen({super.key});

  @override
  State<GroupChatListScreen> createState() => _GroupChatListScreenState();
}

class _GroupChatListScreenState extends State<GroupChatListScreen> {
  @override
  void initState() {
    super.initState();
    context.read<GroupChatProvider>().loadGroups();
  }

  @override
  Widget build(BuildContext context) {
    final provider = context.watch<GroupChatProvider>();

    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(
        title: const Text('Groups'),
        actions: [
          IconButton(
            icon: const Icon(Icons.group_add_outlined, color: AppColors.cyan),
            tooltip: 'New group',
            onPressed: () async {
              await Navigator.push(context, MaterialPageRoute(builder: (_) => const CreateGroupScreen()));
              if (mounted) context.read<GroupChatProvider>().loadGroups();
            },
          ),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: provider.loadGroups,
        color: AppColors.cyan,
        child: provider.loadingGroups && provider.groups.isEmpty
            ? const Center(child: CircularProgressIndicator(color: AppColors.cyan))
            : provider.groupsError != null
                ? Center(child: Text(provider.groupsError!, style: const TextStyle(color: AppColors.red)))
                : provider.groups.isEmpty
                    ? _emptyState()
                    : ListView.builder(
                        itemCount: provider.groups.length,
                        itemBuilder: (_, i) => _groupTile(provider.groups[i]),
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
                  child: const Icon(Icons.groups_outlined, color: AppColors.cyan, size: 40),
                ),
                const SizedBox(height: 20),
                const Text('No groups yet', style: TextStyle(color: AppColors.white, fontSize: 18, fontWeight: FontWeight.w700)),
                const SizedBox(height: 8),
                const Text('Create a group to chat with multiple people at once', style: TextStyle(color: AppColors.textSecondary, fontSize: 13), textAlign: TextAlign.center),
                const SizedBox(height: 24),
                ElevatedButton.icon(
                  onPressed: () async {
                    await Navigator.push(context, MaterialPageRoute(builder: (_) => const CreateGroupScreen()));
                    if (mounted) context.read<GroupChatProvider>().loadGroups();
                  },
                  icon: const Icon(Icons.group_add_outlined),
                  label: const Text('Create group'),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  Widget _groupTile(Map<String, dynamic> group) {
    final memberCount = (group['members'] as List?)?.length ?? 0;
    return ListTile(
      leading: const CircleAvatar(
        radius: 24,
        backgroundColor: AppColors.cyan,
        child: Icon(Icons.groups, color: AppColors.background),
      ),
      title: Text(group['name']?.toString() ?? 'Group', style: const TextStyle(color: AppColors.white, fontWeight: FontWeight.w600)),
      subtitle: Text('$memberCount member${memberCount == 1 ? '' : 's'}', style: const TextStyle(color: AppColors.textMuted, fontSize: 13)),
      onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => GroupConversationScreen(groupId: group['id'] as int))),
    );
  }
}
