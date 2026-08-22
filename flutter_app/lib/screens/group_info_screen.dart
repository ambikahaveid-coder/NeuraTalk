import 'dart:async';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../theme/app_theme.dart';
import '../providers/group_chat_provider.dart';
import '../providers/auth_provider.dart';
import '../services/api_service.dart';

/// Real group member management -- server/group-chats.ts's member endpoints
/// already enforce admin/moderator permissions server-side (confirmed by
/// reading the actual route handlers, not assumed); this screen was the
/// missing piece -- there was previously no UI anywhere to add a member
/// after group creation, promote/demote, remove someone, or leave.
class GroupInfoScreen extends StatefulWidget {
  final int groupId;
  const GroupInfoScreen({super.key, required this.groupId});

  @override
  State<GroupInfoScreen> createState() => _GroupInfoScreenState();
}

class _GroupInfoScreenState extends State<GroupInfoScreen> {
  Map<String, dynamic>? _group;
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final group = await context.read<GroupChatProvider>().fetchGroupDetail(widget.groupId);
      if (!mounted) return;
      setState(() {
        _group = group;
        _loading = false;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _error = 'Could not load group info.';
        _loading = false;
      });
    }
  }

  int? get _selfId => context.read<AuthProvider>().user?['id'] as int?;

  bool get _selfIsAdmin {
    final members = (_group?['members'] as List?) ?? const [];
    for (final m in members) {
      if ((m as Map)['userId'] == _selfId) return m['role'] == 'admin';
    }
    return false;
  }

  bool get _selfCanAddMembers {
    final members = (_group?['members'] as List?) ?? const [];
    for (final m in members) {
      if ((m as Map)['userId'] == _selfId) return m['role'] == 'admin' || m['role'] == 'moderator';
    }
    return false;
  }

  Future<void> _openAddMember() async {
    final added = await Navigator.push<bool>(
      context,
      MaterialPageRoute(builder: (_) => _AddGroupMemberScreen(groupId: widget.groupId)),
    );
    if (added == true) _load();
  }

  Future<void> _showMemberActions(Map<String, dynamic> member) async {
    final userId = member['userId'];
    final username = (member['user'] as Map?)?['username']?.toString() ?? 'this member';
    final role = member['role']?.toString() ?? 'member';
    final isSelf = userId == _selfId;

    if (isSelf) {
      final leave = await showDialog<bool>(
        context: context,
        builder: (dialogContext) => AlertDialog(
          backgroundColor: AppColors.surfaceElevated,
          title: const Text('Leave this group?', style: TextStyle(color: AppColors.white)),
          content: const Text("You won't receive messages from this group anymore.", style: TextStyle(color: AppColors.textSecondary)),
          actions: [
            TextButton(onPressed: () => Navigator.pop(dialogContext, false), child: const Text('Cancel', style: TextStyle(color: AppColors.textMuted))),
            TextButton(onPressed: () => Navigator.pop(dialogContext, true), child: const Text('Leave', style: TextStyle(color: AppColors.red))),
          ],
        ),
      );
      if (leave == true) {
        try {
          await context.read<GroupChatProvider>().removeMember(widget.groupId, userId as int);
          if (mounted) Navigator.pop(context);
        } catch (_) {
          if (mounted) ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Could not leave the group.')));
        }
      }
      return;
    }

    if (!_selfIsAdmin) return;

    showModalBottomSheet(
      context: context,
      backgroundColor: AppColors.surface,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(20))),
      builder: (sheetContext) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            if (role != 'admin')
              ListTile(
                leading: const Icon(Icons.admin_panel_settings_outlined, color: AppColors.cyan),
                title: const Text('Make admin', style: TextStyle(color: AppColors.white)),
                onTap: () async {
                  Navigator.pop(sheetContext);
                  await _changeRole(userId as int, 'admin');
                },
              ),
            if (role == 'admin')
              ListTile(
                leading: const Icon(Icons.remove_moderator_outlined, color: AppColors.cyan),
                title: const Text('Remove as admin', style: TextStyle(color: AppColors.white)),
                onTap: () async {
                  Navigator.pop(sheetContext);
                  await _changeRole(userId as int, 'member');
                },
              ),
            ListTile(
              leading: const Icon(Icons.person_remove_outlined, color: AppColors.red),
              title: Text('Remove $username', style: const TextStyle(color: AppColors.red)),
              onTap: () async {
                Navigator.pop(sheetContext);
                await _removeMember(userId as int, username);
              },
            ),
          ],
        ),
      ),
    );
  }

  Future<void> _changeRole(int userId, String role) async {
    try {
      await context.read<GroupChatProvider>().setMemberRole(widget.groupId, userId, role);
      _load();
    } catch (_) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Could not update this member.')));
    }
  }

  Future<void> _removeMember(int userId, String username) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        backgroundColor: AppColors.surfaceElevated,
        title: Text('Remove $username?', style: const TextStyle(color: AppColors.white)),
        content: const Text('They will no longer see messages in this group.', style: TextStyle(color: AppColors.textSecondary)),
        actions: [
          TextButton(onPressed: () => Navigator.pop(dialogContext, false), child: const Text('Cancel', style: TextStyle(color: AppColors.textMuted))),
          TextButton(onPressed: () => Navigator.pop(dialogContext, true), child: const Text('Remove', style: TextStyle(color: AppColors.red))),
        ],
      ),
    );
    if (confirmed != true) return;
    try {
      await context.read<GroupChatProvider>().removeMember(widget.groupId, userId);
      _load();
    } catch (_) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Could not remove this member.')));
    }
  }

  @override
  Widget build(BuildContext context) {
    final members = (_group?['members'] as List?)?.cast<Map<String, dynamic>>() ?? const [];
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(title: const Text('Group Info')),
      body: _loading
          ? const Center(child: CircularProgressIndicator(color: AppColors.cyan))
          : _error != null
              ? Center(child: Text(_error!, style: const TextStyle(color: AppColors.red)))
              : ListView(
                  padding: const EdgeInsets.symmetric(vertical: 8),
                  children: [
                    Padding(
                      padding: const EdgeInsets.fromLTRB(20, 12, 20, 4),
                      child: Text(
                        _group?['name']?.toString() ?? 'Group',
                        style: const TextStyle(color: AppColors.white, fontSize: 20, fontWeight: FontWeight.w700),
                      ),
                    ),
                    Padding(
                      padding: const EdgeInsets.fromLTRB(20, 0, 20, 16),
                      child: Text('${members.length} member${members.length == 1 ? '' : 's'}', style: const TextStyle(color: AppColors.textMuted, fontSize: 13)),
                    ),
                    if (_selfCanAddMembers)
                      ListTile(
                        leading: const CircleAvatar(backgroundColor: AppColors.surfaceElevated, child: Icon(Icons.person_add_outlined, color: AppColors.cyan)),
                        title: const Text('Add member', style: TextStyle(color: AppColors.cyan, fontWeight: FontWeight.w600)),
                        onTap: _openAddMember,
                      ),
                    const Divider(height: 1, color: AppColors.surfaceElevated),
                    ...members.map((m) {
                      final user = m['user'] as Map?;
                      final username = user?['username']?.toString() ?? 'Unknown user';
                      final role = m['role']?.toString() ?? 'member';
                      final isSelf = m['userId'] == _selfId;
                      return ListTile(
                        leading: const CircleAvatar(backgroundColor: AppColors.surfaceElevated, child: Icon(Icons.person, color: AppColors.textMuted)),
                        title: Text(isSelf ? '$username (You)' : username, style: const TextStyle(color: AppColors.white)),
                        subtitle: role != 'member' ? Text(role[0].toUpperCase() + role.substring(1), style: const TextStyle(color: AppColors.cyan, fontSize: 12)) : null,
                        onTap: () => _showMemberActions(m),
                      );
                    }),
                  ],
                ),
    );
  }
}

/// Search-and-add flow for an existing group -- mirrors
/// blocked_contacts_screen.dart's _BlockContactSearchScreen pattern, reusing
/// the same real discover endpoint.
class _AddGroupMemberScreen extends StatefulWidget {
  final int groupId;
  const _AddGroupMemberScreen({required this.groupId});

  @override
  State<_AddGroupMemberScreen> createState() => _AddGroupMemberScreenState();
}

class _AddGroupMemberScreenState extends State<_AddGroupMemberScreen> {
  final _searchCtrl = TextEditingController();
  Timer? _debounce;
  List<Map<String, dynamic>> _results = [];
  bool _loading = false;
  bool _adding = false;

  void _onChanged(String query) {
    _debounce?.cancel();
    _debounce = Timer(const Duration(milliseconds: 400), () => _search(query));
  }

  Future<void> _search(String query) async {
    final trimmed = query.trim();
    if (trimmed.length < 2) {
      setState(() => _results = []);
      return;
    }
    setState(() => _loading = true);
    try {
      final res = await ApiService.get('/api/personal-chats/discover?q=${Uri.encodeQueryComponent(trimmed)}') as Map<String, dynamic>;
      if (!mounted) return;
      setState(() {
        _results = (res['results'] as List).cast<Map<String, dynamic>>();
        _loading = false;
      });
    } catch (_) {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _add(Map<String, dynamic> user) async {
    setState(() => _adding = true);
    try {
      await context.read<GroupChatProvider>().addMember(widget.groupId, user['id'] as int);
      if (mounted) Navigator.pop(context, true);
    } catch (e) {
      if (mounted) {
        setState(() => _adding = false);
        final message = e is ApiException ? e.message : 'Could not add this member.';
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(message)));
      }
    }
  }

  @override
  void dispose() {
    _debounce?.cancel();
    _searchCtrl.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(title: const Text('Add Member')),
      body: Column(
        children: [
          Padding(
            padding: const EdgeInsets.all(16),
            child: TextField(
              controller: _searchCtrl,
              autofocus: true,
              onChanged: _onChanged,
              style: const TextStyle(color: AppColors.white),
              decoration: InputDecoration(
                hintText: 'Search by username, email, or phone',
                hintStyle: const TextStyle(color: AppColors.textMuted),
                prefixIcon: const Icon(Icons.search, color: AppColors.textMuted),
                filled: true,
                fillColor: AppColors.surface,
                border: OutlineInputBorder(borderRadius: BorderRadius.circular(14), borderSide: BorderSide.none),
              ),
            ),
          ),
          if (_loading) const Padding(padding: EdgeInsets.only(top: 24), child: CircularProgressIndicator(color: AppColors.cyan)),
          Expanded(
            child: ListView.builder(
              itemCount: _results.length,
              itemBuilder: (_, i) {
                final u = _results[i];
                return ListTile(
                  leading: const CircleAvatar(backgroundColor: AppColors.surfaceElevated, child: Icon(Icons.person, color: AppColors.textMuted)),
                  title: Text(u['displayName']?.toString() ?? 'Unknown user', style: const TextStyle(color: AppColors.white, fontWeight: FontWeight.w600)),
                  subtitle: Text(u['identifier']?.toString() ?? '', style: const TextStyle(color: AppColors.textMuted, fontSize: 12)),
                  trailing: _adding
                      ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2, color: AppColors.cyan))
                      : const Icon(Icons.add_circle_outline, color: AppColors.cyan),
                  onTap: _adding ? null : () => _add(u),
                );
              },
            ),
          ),
        ],
      ),
    );
  }
}
