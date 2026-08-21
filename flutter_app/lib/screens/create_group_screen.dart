import 'dart:async';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../theme/app_theme.dart';
import '../providers/group_chat_provider.dart';
import '../services/api_service.dart';

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
        title: const Text('New Group'),
        actions: [
          TextButton(
            onPressed: _creating ? null : _create,
            child: _creating
                ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2, color: AppColors.cyan))
                : const Text('Create', style: TextStyle(color: AppColors.cyan, fontWeight: FontWeight.w700)),
          ),
        ],
      ),
      body: Column(
        children: [
          Padding(
            padding: const EdgeInsets.all(16),
            child: TextField(
              controller: _nameCtrl,
              style: const TextStyle(color: AppColors.white),
              decoration: InputDecoration(
                hintText: 'Group name',
                hintStyle: const TextStyle(color: AppColors.textMuted),
                filled: true,
                fillColor: AppColors.surface,
                border: OutlineInputBorder(borderRadius: BorderRadius.circular(14), borderSide: BorderSide.none),
              ),
            ),
          ),
          if (_error != null)
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16),
              child: Text(_error!, style: const TextStyle(color: AppColors.red, fontSize: 13)),
            ),
          if (_selected.isNotEmpty)
            SizedBox(
              height: 76,
              child: ListView(
                scrollDirection: Axis.horizontal,
                padding: const EdgeInsets.symmetric(horizontal: 12),
                children: _selected.values.map((u) => Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 6),
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Stack(
                        children: [
                          CircleAvatar(
                            radius: 22,
                            backgroundColor: AppColors.cyan.withOpacity(0.15),
                            child: const Icon(Icons.person, color: AppColors.cyan),
                          ),
                          Positioned(
                            right: 0,
                            top: 0,
                            child: GestureDetector(
                              onTap: () => _toggleSelect(u),
                              child: const CircleAvatar(radius: 9, backgroundColor: AppColors.red, child: Icon(Icons.close, size: 12, color: AppColors.white)),
                            ),
                          ),
                        ],
                      ),
                      const SizedBox(height: 4),
                      SizedBox(
                        width: 56,
                        child: Text(
                          u['displayName']?.toString() ?? '',
                          style: const TextStyle(color: AppColors.textMuted, fontSize: 10),
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          textAlign: TextAlign.center,
                        ),
                      ),
                    ],
                  ),
                )).toList(),
              ),
            ),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16),
            child: TextField(
              controller: _searchCtrl,
              onChanged: _onSearchChanged,
              style: const TextStyle(color: AppColors.white),
              decoration: InputDecoration(
                hintText: 'Add members by username, email, or phone',
                hintStyle: const TextStyle(color: AppColors.textMuted),
                prefixIcon: const Icon(Icons.search, color: AppColors.textMuted),
                filled: true,
                fillColor: AppColors.surface,
                border: OutlineInputBorder(borderRadius: BorderRadius.circular(14), borderSide: BorderSide.none),
              ),
            ),
          ),
          if (_searching) const Padding(padding: EdgeInsets.only(top: 16), child: CircularProgressIndicator(color: AppColors.cyan)),
          Expanded(
            child: ListView.builder(
              itemCount: _results.length,
              itemBuilder: (_, i) {
                final u = _results[i];
                final isSelected = _selected.containsKey(u['id']);
                return ListTile(
                  leading: CircleAvatar(
                    backgroundColor: AppColors.cyan.withOpacity(0.15),
                    child: const Icon(Icons.person, color: AppColors.cyan),
                  ),
                  title: Text(u['displayName']?.toString() ?? 'Unknown user', style: const TextStyle(color: AppColors.white)),
                  subtitle: Text(u['identifier']?.toString() ?? '', style: const TextStyle(color: AppColors.textMuted, fontSize: 12)),
                  trailing: Icon(isSelected ? Icons.check_circle : Icons.add_circle_outline, color: AppColors.cyan),
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
