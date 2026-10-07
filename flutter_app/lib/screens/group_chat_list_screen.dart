import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';
import '../theme/app_theme.dart';
import '../widgets/nt_ui.dart';
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

    Future<void> createGroup() async {
      await Navigator.push(context, MaterialPageRoute(builder: (_) => const CreateGroupScreen()));
      if (mounted) context.read<GroupChatProvider>().loadGroups();
    }

    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(title: const Text('Groups')),
      floatingActionButton: provider.groups.isEmpty
          ? null
          : FloatingActionButton.extended(
              heroTag: 'new-group',
              onPressed: createGroup,
              backgroundColor: AppColors.cyan,
              foregroundColor: AppColors.onAccent,
              icon: const Icon(Icons.group_add_outlined),
              label: const Text('New group', style: TextStyle(fontWeight: FontWeight.w700)),
            ),
      body: RefreshIndicator(
        onRefresh: provider.loadGroups,
        color: AppColors.cyan,
        child: provider.loadingGroups && provider.groups.isEmpty
            ? Center(child: CircularProgressIndicator(color: AppColors.cyan))
            : provider.groupsError != null
                ? ListView(children: [
                    NtEmptyState(icon: Icons.wifi_off, title: 'Couldn\'t load your groups', message: provider.groupsError!, error: true,
                        actionLabel: 'Try again', onAction: provider.loadGroups),
                  ])
                : provider.groups.isEmpty
                    ? ListView(children: [
                        NtEmptyState(
                          icon: Icons.groups_outlined,
                          title: 'Talk to many people at once',
                          message: 'Everyone writes in their own language, and everyone reads every message in theirs.',
                          actionLabel: 'Create a group',
                          onAction: createGroup,
                        ),
                      ])
                    : ListView.separated(
                        padding: const EdgeInsets.only(bottom: 96),
                        itemCount: provider.groups.length,
                        separatorBuilder: (_, __) => Divider(height: 1, indent: 84, color: AppColors.border),
                        itemBuilder: (_, i) => _groupTile(provider.groups[i]),
                      ),
      ),
    );
  }

  Widget _groupTile(Map<String, dynamic> group) {
    final name = group['name']?.toString() ?? 'Group';
    final memberCount = (group['members'] as List?)?.length ?? 0;
    return ListTile(
      contentPadding: const EdgeInsets.symmetric(horizontal: 20, vertical: 6),
      leading: NtAvatar(name: name, size: 50),
      title: Text(name, maxLines: 1, overflow: TextOverflow.ellipsis, style: TextStyle(color: AppColors.ink, fontSize: 16.5, fontWeight: FontWeight.w600)),
      subtitle: Row(children: [
        Icon(Icons.people_outline, size: 15, color: AppColors.textMuted),
        const SizedBox(width: 4),
        Text('$memberCount member${memberCount == 1 ? '' : 's'}', style: TextStyle(color: AppColors.textSecondary, fontSize: 14)),
        const SizedBox(width: 10),
        Icon(Icons.translate, size: 14, color: AppColors.cyan),
        const SizedBox(width: 4),
        Text('Translated', style: TextStyle(color: AppColors.cyan, fontSize: 13, fontWeight: FontWeight.w600)),
      ]),
      trailing: Icon(Icons.chevron_right, color: AppColors.textMuted),
      onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => GroupConversationScreen(groupId: group['id'] as int))),
    );
  }
}
