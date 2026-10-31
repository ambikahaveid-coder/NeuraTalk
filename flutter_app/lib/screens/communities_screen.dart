import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:share_plus/share_plus.dart';

import '../providers/auth_provider.dart';
import '../services/api_service.dart';
import '../theme/app_theme.dart';
import '../widgets/nt_ui.dart';
import 'group_conversation_screen.dart';

/// My communities, plus create and join with an invite code.
class CommunitiesScreen extends StatefulWidget {
  const CommunitiesScreen({super.key});
  @override
  State<CommunitiesScreen> createState() => _CommunitiesScreenState();
}

class _CommunitiesScreenState extends State<CommunitiesScreen> {
  List<Map<String, dynamic>>? _list;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final res = await ApiService.get('/api/communities');
      if (mounted) setState(() => _list = ((res['communities'] as List?) ?? const []).whereType<Map>().map((e) => Map<String, dynamic>.from(e)).toList());
    } catch (_) {
      if (mounted) setState(() => _list = []);
    }
  }

  void _toast(String t) {
    if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(t)));
  }

  Future<String?> _ask(String title, String label, {int max = 60}) {
    final c = TextEditingController();
    return showDialog<String>(
      context: context,
      builder: (d) => AlertDialog(
        title: Text(title),
        content: TextField(controller: c, autofocus: true, maxLength: max, decoration: InputDecoration(labelText: label)),
        actions: [
          TextButton(onPressed: () => Navigator.pop(d), child: const Text('Cancel')),
          FilledButton(onPressed: () => Navigator.pop(d, c.text.trim()), child: const Text('OK')),
        ],
      ),
    );
  }

  Future<void> _create() async {
    final name = await _ask('New community', 'Community name');
    if (name == null || name.length < 3) return;
    try {
      final res = await ApiService.post('/api/communities', {'name': name});
      await _load();
      final id = (res['community'] as Map?)?['id'];
      if (id is int && mounted) await Navigator.push(context, MaterialPageRoute(builder: (_) => CommunityScreen(communityId: id)));
      _load();
    } on ApiException catch (e) {
      _toast(e.message);
    } catch (_) {
      _toast('Could not create the community.');
    }
  }

  Future<void> _join() async {
    final code = await _ask('Join a community', 'Invite code or link', max: 300);
    if (code == null || code.isEmpty) return;
    try {
      final res = await ApiService.post('/api/communities/join', {'code': code});
      _toast('Joined ${(res['community'] as Map?)?['name'] ?? 'the community'}');
      _load();
    } on ApiException catch (e) {
      _toast(e.message);
    } catch (_) {
      _toast('Could not join.');
    }
  }

  @override
  Widget build(BuildContext context) {
    final list = _list;
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(title: const Text('Communities')),
      body: RefreshIndicator(
        onRefresh: _load,
        child: ListView(padding: const EdgeInsets.all(16), children: [
          Text('Bring related groups together, with an announcement group that only admins can post in. Everyone reads in their own language.',
              style: TextStyle(color: AppColors.textSecondary)),
          const SizedBox(height: 12),
          Row(children: [
            Expanded(child: FilledButton.icon(onPressed: _create, icon: const Icon(Icons.add), label: const Text('New community'))),
            const SizedBox(width: 12),
            Expanded(child: OutlinedButton.icon(onPressed: _join, icon: const Icon(Icons.link), label: const Text('Join with code'))),
          ]),
          const SizedBox(height: 16),
          if (list == null) const Center(child: CircularProgressIndicator()),
          if (list != null && list.isEmpty) Padding(padding: const EdgeInsets.all(24), child: Center(child: Text('You are not in any community yet.', style: TextStyle(color: AppColors.textMuted)))),
          for (final c in list ?? const <Map<String, dynamic>>[])
            Card(
              color: AppColors.surface,
              child: ListTile(
                leading: CircleAvatar(backgroundColor: AppColors.blueTint, child: Icon(Icons.groups_2_outlined, color: AppColors.cyan)),
                title: Text(c['name']?.toString() ?? '', style: TextStyle(color: AppColors.ink, fontWeight: FontWeight.w700)),
                subtitle: Text('${c['members']} member${c['members'] == 1 ? '' : 's'}${c['role'] == 'admin' ? ' · admin' : ''}', style: TextStyle(color: AppColors.textSecondary)),
                onTap: () async {
                  await Navigator.push(context, MaterialPageRoute(builder: (_) => CommunityScreen(communityId: c['id'] as int)));
                  _load();
                },
              ),
            ),
        ]),
      ),
    );
  }
}

/// One community: announcements, its groups (join/open), and admin tools.
class CommunityScreen extends StatefulWidget {
  final int communityId;
  const CommunityScreen({super.key, required this.communityId});
  @override
  State<CommunityScreen> createState() => _CommunityScreenState();
}

class _CommunityScreenState extends State<CommunityScreen> {
  Map<String, dynamic>? _community;
  List<Map<String, dynamic>> _groups = [];
  String get _base => '/api/communities/${widget.communityId}';

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final res = await ApiService.get(_base);
      if (!mounted) return;
      setState(() {
        _community = Map<String, dynamic>.from(res['community'] as Map);
        _groups = ((res['groups'] as List?) ?? const []).whereType<Map>().map((e) => Map<String, dynamic>.from(e)).toList();
      });
    } on ApiException catch (e) {
      _toast(e.message);
      if (mounted) Navigator.pop(context);
    } catch (_) {
      _toast('Could not load the community.');
    }
  }

  void _toast(String t) {
    if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(t)));
  }

  Future<void> _openGroup(int groupId) async {
    await Navigator.push(context, MaterialPageRoute(builder: (_) => GroupConversationScreen(groupId: groupId)));
    _load();
  }

  Future<void> _joinGroup(Map<String, dynamic> g) async {
    try {
      await ApiService.post('$_base/groups/${g['id']}/join', {});
      await _load();
      _openGroup(g['id'] as int);
    } on ApiException catch (e) {
      _toast(e.message);
    } catch (_) {
      _toast('Could not join the group.');
    }
  }

  Future<void> _addGroup() async {
    final selfId = context.read<AuthProvider>().user?['id'];
    try {
      final res = await ApiService.get('/api/group-chats/my-groups');
      final mine = (res is List ? res : const [])
          .whereType<Map>()
          .where((g) => g['communityId'] == null && ((g['members'] as List?) ?? const []).any((m) => m is Map && m['userId'] == selfId && m['role'] == 'admin'))
          .where((g) => !_groups.any((x) => x['id'] == g['id']))
          .toList();
      if (!mounted) return;
      if (mine.isEmpty) return _toast('You need to be an admin of a group that isn\'t in a community yet.');
      final picked = await showModalBottomSheet<int>(
        context: context,
        backgroundColor: AppColors.surface,
        builder: (s) => SafeArea(
          child: ListView(shrinkWrap: true, children: [
            Padding(padding: const EdgeInsets.all(16), child: Text('Add one of your groups', style: TextStyle(color: AppColors.ink, fontWeight: FontWeight.w800, fontSize: 18))),
            for (final g in mine)
              ListTile(
                leading: NtAvatar(name: g['name']?.toString() ?? 'Group', size: 40),
                title: Text(g['name']?.toString() ?? ''),
                onTap: () => Navigator.pop(s, g['id'] as int),
              ),
          ]),
        ),
      );
      if (picked == null) return;
      await ApiService.post('$_base/groups', {'groupId': picked});
      _load();
    } on ApiException catch (e) {
      _toast(e.message);
    } catch (_) {
      _toast('Could not add the group.');
    }
  }

  Future<void> _removeGroup(Map<String, dynamic> g) async {
    try {
      await ApiService.delete('$_base/groups/${g['id']}');
      _load();
    } catch (_) {
      _toast('Could not remove the group.');
    }
  }

  Future<void> _invite() async {
    final code = _community?['inviteCode']?.toString();
    if (code == null) return;
    await Share.share('Join "${_community?['name']}" on NeuraTalk: open the app → Chats → menu → Communities → Join with code, and enter: $code');
  }

  Future<void> _newCode() async {
    try {
      final res = await ApiService.post('$_base/invite-code', {});
      setState(() => _community?['inviteCode'] = res['inviteCode']);
      _toast('New invite code made. The old one no longer works.');
    } catch (_) {
      _toast('Could not make a new code.');
    }
  }

  Future<void> _leaveOrDelete({required bool delete}) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (d) => AlertDialog(
        title: Text(delete ? 'Delete this community?' : 'Leave this community?'),
        content: Text(delete
            ? 'The groups stay as normal groups. The announcement group is closed.'
            : 'You will also leave its announcement group and its groups.'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(d, false), child: const Text('Cancel')),
          TextButton(onPressed: () => Navigator.pop(d, true), child: Text(delete ? 'Delete' : 'Leave', style: const TextStyle(color: AppColors.red))),
        ],
      ),
    );
    if (ok != true) return;
    try {
      delete ? await ApiService.delete(_base) : await ApiService.post('$_base/leave', {});
      if (mounted) Navigator.pop(context);
    } on ApiException catch (e) {
      _toast(e.message);
    } catch (_) {
      _toast('Could not do that. Check your connection.');
    }
  }

  @override
  Widget build(BuildContext context) {
    final c = _community;
    final isAdmin = c?['role'] == 'admin';
    final isCreator = c?['isCreator'] == true;
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(
        title: Text(c?['name']?.toString() ?? 'Community'),
        actions: [
          PopupMenuButton<String>(
            onSelected: (v) {
              if (v == 'leave') _leaveOrDelete(delete: false);
              if (v == 'delete') _leaveOrDelete(delete: true);
              if (v == 'code') _newCode();
            },
            itemBuilder: (_) => [
              if (isAdmin) const PopupMenuItem(value: 'code', child: Text('New invite code')),
              if (!isCreator) const PopupMenuItem(value: 'leave', child: Text('Leave community')),
              if (isCreator) const PopupMenuItem(value: 'delete', child: Text('Delete community', style: TextStyle(color: AppColors.red))),
            ],
          ),
        ],
      ),
      body: c == null
          ? const Center(child: CircularProgressIndicator())
          : RefreshIndicator(
              onRefresh: _load,
              child: ListView(padding: const EdgeInsets.all(16), children: [
                Text('${c['members']} member${c['members'] == 1 ? '' : 's'}', style: TextStyle(color: AppColors.textSecondary)),
                if ((c['description'] ?? '').toString().isNotEmpty)
                  Padding(padding: const EdgeInsets.only(top: 6), child: Text(c['description'].toString(), style: TextStyle(color: AppColors.ink))),
                const SizedBox(height: 16),
                if (c['announcementGroupId'] is int)
                  Card(
                    color: AppColors.surface,
                    child: ListTile(
                      leading: CircleAvatar(backgroundColor: AppColors.blueTint, child: Icon(Icons.campaign_outlined, color: AppColors.cyan)),
                      title: Text('Announcements', style: TextStyle(color: AppColors.ink, fontWeight: FontWeight.w700)),
                      subtitle: Text(isAdmin ? 'Only admins post here' : 'Updates from the admins', style: TextStyle(color: AppColors.textSecondary)),
                      onTap: () => _openGroup(c['announcementGroupId'] as int),
                    ),
                  ),
                const SizedBox(height: 12),
                Row(children: [
                  Expanded(child: Text('GROUPS', style: TextStyle(color: AppColors.textMuted, fontSize: 12.5, fontWeight: FontWeight.w700, letterSpacing: 0.6))),
                  if (isAdmin) TextButton.icon(onPressed: _addGroup, icon: const Icon(Icons.add), label: const Text('Add group')),
                ]),
                if (_groups.isEmpty) Text(isAdmin ? 'Add the groups that belong to this community.' : 'No groups yet.', style: TextStyle(color: AppColors.textMuted)),
                for (final g in _groups)
                  ListTile(
                    contentPadding: EdgeInsets.zero,
                    leading: NtAvatar(name: g['name']?.toString() ?? 'Group', size: 44),
                    title: Text(g['name']?.toString() ?? '', style: TextStyle(color: AppColors.ink, fontWeight: FontWeight.w600)),
                    subtitle: Text('${g['members']} member${g['members'] == 1 ? '' : 's'}', style: TextStyle(color: AppColors.textSecondary)),
                    trailing: g['joined'] == true
                        ? (isAdmin ? IconButton(tooltip: 'Remove from community', icon: const Icon(Icons.remove_circle_outline), onPressed: () => _removeGroup(g)) : null)
                        : FilledButton(onPressed: () => _joinGroup(g), child: const Text('Join')),
                    onTap: g['joined'] == true ? () => _openGroup(g['id'] as int) : null,
                  ),
                if (isAdmin && c['inviteCode'] != null) ...[
                  const SizedBox(height: 16),
                  Card(
                    color: AppColors.surface,
                    child: ListTile(
                      leading: Icon(Icons.link, color: AppColors.cyan),
                      title: const Text('Invite people'),
                      subtitle: Text('Code: ${c['inviteCode']}', style: TextStyle(color: AppColors.textSecondary)),
                      trailing: const Icon(Icons.share),
                      onTap: _invite,
                    ),
                  ),
                ],
              ]),
            ),
    );
  }
}
