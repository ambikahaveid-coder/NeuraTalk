import 'dart:async';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../theme/app_theme.dart';
import '../providers/group_chat_provider.dart';
import '../services/api_service.dart';
import '../widgets/nt_ui.dart';

/// Creates a real group (server/group-chats.ts) and adds selected members.
class CreateGroupScreen extends StatefulWidget {
  const CreateGroupScreen({super.key});

  @override
  State<CreateGroupScreen> createState() => _CreateGroupScreenState();
}

class _CreateGroupScreenState extends State<CreateGroupScreen> {
  final _nameCtrl = TextEditingController();
  final _searchCtrl = TextEditingController();
  Timer? _debounce;
  List<Map<String, dynamic>> _results = [];
  final Map<int, Map<String, dynamic>> _selected = {};
  bool _searching = false;
  bool _creating = false;
  String? _error;

  void _onSearchChanged(String query) {
    _debounce?.cancel();
    _debounce = Timer(const Duration(milliseconds: 400), () => _search(query));
  }

  Future<void> _search(String query) async {
    final trimmed = query.trim();
    if (trimmed.length < 2) {
      setState(() => _results = []);
      return;
    }
    setState(() => _searching = true);
    try {
      final res = await ApiService.get('/api/personal-chats/discover?q=${Uri.encodeQueryComponent(trimmed)}') as Map<String, dynamic>;
      if (!mounted) return;
      setState(() {
        _results = (res['results'] as List).cast<Map<String, dynamic>>();
        _searching = false;
      });
    } catch (_) {
      if (mounted) setState(() => _searching = false);
    }
  }

  void _toggleSelect(Map<String, dynamic> user) {
    final id = user['id'] as int;
    setState(() {
      if (_selected.containsKey(id)) {
        _selected.remove(id);
      } else {
        _selected[id] = user;
      }
    });
  }

  Future<void> _create() async {
    final name = _nameCtrl.text.trim();
    if (name.isEmpty) {
      setState(() => _error = 'Enter a group name.');
      return;
    }
    if (_creating) return;
    setState(() {
      _creating = true;
      _error = null;
    });
    try {
      final provider = context.read<GroupChatProvider>();
      final group = await provider.createGroup(name);
      final groupId = group?['id'] as int?;
      if (groupId != null) {
        for (final user in _selected.values) {
          try {
            await provider.addMember(groupId, user['id'] as int);
          } catch (_) {
            // Best-effort per member -- one failed add shouldn't block the rest.
          }
        }
      }
      if (mounted) Navigator.pop(context);
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    } catch (_) {
      if (mounted) setState(() => _error = 'Could not create the group. Please try again.');
    } finally {
      if (mounted) setState(() => _creating = false);
    }
  }

  @override
  void dispose() {
    _debounce?.cancel();
    _nameCtrl.dispose();
    _searchCtrl.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(
        title: const Text('New group'),
        actions: [
          TextButton(
            onPressed: _creating ? null : _create,
            child: _creating
                ? SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2, color: AppColors.cyan))
                : Text('Create', style: TextStyle(color: AppColors.cyan, fontWeight: FontWeight.w700)),
          ),
        ],
      ),
      body: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 8, 16, 0),
            child: Row(children: [
              ListenableBuilder(
                listenable: _nameCtrl,
                builder: (_, __) => _nameCtrl.text.trim().isEmpty
                    ? Container(
                        width: 56,
                        height: 56,
                        decoration: BoxDecoration(color: AppColors.cyan.withValues(alpha: AppColors.isDark ? 0.22 : 0.12), shape: BoxShape.circle),
                        child: Icon(Icons.groups_outlined, color: AppColors.cyan, size: 28),
                      )
                    : NtAvatar(name: _nameCtrl.text, size: 56),
              ),
              const SizedBox(width: 14),
              Expanded(
                child: TextField(
                  controller: _nameCtrl,
                  textCapitalization: TextCapitalization.sentences,
                  style: TextStyle(color: AppColors.ink, fontSize: 17, fontWeight: FontWeight.w600),
                  decoration: const InputDecoration(hintText: 'Group name'),
                ),
              ),
            ]),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 12, 16, 4),
            child: Row(children: [
              Icon(Icons.translate, size: 16, color: AppColors.cyan),
              const SizedBox(width: 8),
              Expanded(
                child: Text('Everyone writes in their own language and reads every message in theirs.',
                    style: TextStyle(color: AppColors.textSecondary, fontSize: 13.5, height: 1.4)),
              ),
            ]),
          ),
          if (_error != null)
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 8, 16, 0),
              child: Text(_error!, style: const TextStyle(color: AppColors.red, fontSize: 14)),
            ),
          if (_selected.isNotEmpty)
            SizedBox(
              height: 92,
              child: ListView(
                scrollDirection: Axis.horizontal,
                padding: const EdgeInsets.fromLTRB(10, 14, 10, 0),
                children: _selected.values.map((u) {
                  final name = u['displayName']?.toString() ?? '';
                  return Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 6),
                    child: Column(mainAxisSize: MainAxisSize.min, children: [
                      Stack(clipBehavior: Clip.none, children: [
                        NtAvatar(name: name, avatarUrl: u['avatarUrl'] as String?, size: 48),
                        Positioned(
                          right: -4,
                          top: -4,
                          child: Semantics(
                            button: true,
                            label: 'Remove $name',
                            child: GestureDetector(
                              onTap: () => _toggleSelect(u),
                              child: Container(
                                width: 22,
                                height: 22,
                                decoration: BoxDecoration(
                                    color: AppColors.textSecondary, shape: BoxShape.circle, border: Border.all(color: AppColors.background, width: 2)),
                                child: Icon(Icons.close, size: 12, color: AppColors.background),
                              ),
                            ),
                          ),
                        ),
                      ]),
                      const SizedBox(height: 4),
                      SizedBox(
                        width: 60,
                        child: Text(name,
                            style: TextStyle(color: AppColors.textSecondary, fontSize: 12.5),
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            textAlign: TextAlign.center),
                      ),
                    ]),
                  );
                }).toList(),
              ),
            ),
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 16, 16, 4),
            child: Text(
              _selected.isEmpty ? 'ADD MEMBERS' : '${_selected.length} SELECTED',
              style: TextStyle(color: AppColors.textMuted, fontSize: 12, fontWeight: FontWeight.w700, letterSpacing: 0.6),
            ),
          ),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16),
            child: TextField(
              controller: _searchCtrl,
              onChanged: _onSearchChanged,
              style: TextStyle(color: AppColors.ink, fontSize: 16),
              decoration: InputDecoration(
                hintText: 'Search name or phone number',
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
          if (_searching) Padding(padding: const EdgeInsets.only(top: 8), child: LinearProgressIndicator(minHeight: 2, color: AppColors.cyan, backgroundColor: Colors.transparent)),
          Expanded(
            child: ListView.builder(
              padding: const EdgeInsets.only(top: 6),
              itemCount: _results.length,
              itemBuilder: (_, i) {
                final u = _results[i];
                final isSelected = _selected.containsKey(u['id']);
                final name = u['displayName']?.toString() ?? 'Unknown user';
                return ListTile(
                  contentPadding: const EdgeInsets.symmetric(horizontal: 20, vertical: 2),
                  leading: NtAvatar(name: name, avatarUrl: u['avatarUrl'] as String?, size: 46),
                  title: Text(name, style: TextStyle(color: AppColors.ink, fontSize: 16, fontWeight: FontWeight.w600)),
                  subtitle: Text(u['identifier']?.toString() ?? '', style: TextStyle(color: AppColors.textSecondary, fontSize: 14)),
                  trailing: Icon(isSelected ? Icons.check_circle : Icons.radio_button_unchecked,
                      color: isSelected ? AppColors.cyan : AppColors.textMuted),
                  onTap: () => _toggleSelect(u),
                );
              },
            ),
          ),
        ],
      ),
    );
  }
}
