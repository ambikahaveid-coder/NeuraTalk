import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';
import '../theme/app_theme.dart';
import '../widgets/nt_ui.dart';
import '../providers/group_chat_provider.dart';
import 'group_conversation_screen.dart';
import 'create_group_screen.dart';
import '../widgets/chat_lock.dart';

/// Real group chat list — server/group-chats.ts:my-groups. Separate from
/// 1:1 chat (personal_chat_provider.dart) and from NEURA AI.
class GroupChatListScreen extends StatefulWidget {
  const GroupChatListScreen({super.key});

  @override
  State<GroupChatListScreen> createState() => _GroupChatListScreenState();
}

class _GroupChatListScreenState extends State<GroupChatListScreen> {
  bool _showLocked = false;

  void _onLock() {
    if (!mounted) return;
    if (_showLocked && !ChatLock.instance.unlocked) _showLocked = false;
    setState(() {});
  }

  @override
  void initState() {
    super.initState();
    context.read<GroupChatProvider>().loadGroups();
    ChatLock.instance.addListener(_onLock);
    ChatLock.instance.load();
  }

  @override
  void dispose() {
    ChatLock.instance.removeListener(_onLock);
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final provider = context.watch<GroupChatProvider>();
    final groups = provider.groups.where((g) => ChatLock.instance.isLocked('g:${g['id']}') == _showLocked).toList();
    final lockedCount = provider.groups.where((g) => ChatLock.instance.isLocked('g:${g['id']}')).length;

    Future<void> createGroup() async {
      await Navigator.push(context, MaterialPageRoute(builder: (_) => const CreateGroupScreen()));
      if (mounted) context.read<GroupChatProvider>().loadGroups();
    }

    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(
        title: Text(_showLocked ? 'Locked groups' : 'Groups'),
        leading: _showLocked ? IconButton(icon: const Icon(Icons.arrow_back), onPressed: () => setState(() => _showLocked = false)) : null,
      ),
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
                    : ListView(
                        padding: const EdgeInsets.only(bottom: 96),
                        children: [
                          if (!_showLocked && lockedCount > 0)
                            ListTile(
                              leading: CircleAvatar(backgroundColor: AppColors.blueTint, child: Icon(Icons.lock_outline, color: AppColors.cyan)),
                              title: Text('Locked groups', style: TextStyle(color: AppColors.ink, fontWeight: FontWeight.w700)),
                              subtitle: Text('Open with your secret code', style: TextStyle(color: AppColors.textSecondary)),
                              onTap: () async {
                                if (await ChatLock.instance.verify(context) && mounted) setState(() => _showLocked = true);
                              },
                            ),
                          if (groups.isEmpty)
                            Padding(
                              padding: const EdgeInsets.all(32),
                              child: Center(child: Text(_showLocked ? 'No locked groups' : 'All your groups are locked', style: TextStyle(color: AppColors.textMuted))),
                            ),
                          for (var i = 0; i < groups.length; i++) ...[
                            _groupTile(groups[i]),
                            if (i < groups.length - 1) Divider(height: 1, indent: 84, color: AppColors.border),
                          ],
                        ],
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
