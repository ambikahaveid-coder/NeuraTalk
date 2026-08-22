import 'dart:async';
import 'package:flutter/material.dart';
import '../theme/app_theme.dart';
import '../services/api_service.dart';

/// Real blocked-contacts management -- server/blocking.ts. Separate from the
/// per-conversation Block/Unblock menu item in conversation_screen.dart,
/// which only affects the person you're currently talking to; this is the
/// full list plus a way to block someone without opening a chat with them
/// first.
class BlockedContactsScreen extends StatefulWidget {
  const BlockedContactsScreen({super.key});

  @override
  State<BlockedContactsScreen> createState() => _BlockedContactsScreenState();
}

class _BlockedContactsScreenState extends State<BlockedContactsScreen> {
  List<Map<String, dynamic>> _blocked = [];
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
      final res = await ApiService.get('/api/users/blocked') as Map<String, dynamic>;
      if (!mounted) return;
      setState(() {
        _blocked = (res['blocked'] as List).cast<Map<String, dynamic>>();
        _loading = false;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _error = 'Could not load blocked contacts.';
        _loading = false;
      });
    }
  }

  Future<void> _confirmUnblock(Map<String, dynamic> contact) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        backgroundColor: AppColors.surfaceElevated,
        title: const Text('Unblock this contact?', style: TextStyle(color: AppColors.white)),
        content: const Text(
          'They will be able to call and message you again.',
          style: TextStyle(color: AppColors.textSecondary),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(dialogContext, false),
            child: const Text('Cancel', style: TextStyle(color: AppColors.textMuted)),
          ),
          TextButton(
            onPressed: () => Navigator.pop(dialogContext, true),
            child: const Text('Unblock', style: TextStyle(color: AppColors.cyan)),
          ),
        ],
      ),
    );
    if (confirmed != true) return;

    final id = contact['id'];
    setState(() => _blocked.removeWhere((c) => c['id'] == id));
    try {
      await ApiService.delete('/api/users/$id/block');
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Could not unblock. Please try again.')),
        );
      }
      _load();
    }
  }

  Future<void> _openBlockContact() async {
    final blocked = await Navigator.push<bool>(
      context,
      MaterialPageRoute(builder: (_) => const _BlockContactSearchScreen()),
    );
    if (blocked == true) _load();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(
        title: const Text('Blocked Contacts'),
        actions: [
          IconButton(
            icon: const Icon(Icons.person_add_alt_outlined),
            tooltip: 'Block Contact',
            onPressed: _openBlockContact,
          ),
        ],
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator(color: AppColors.cyan))
          : _error != null
              ? Center(child: Text(_error!, style: const TextStyle(color: AppColors.red)))
              : _blocked.isEmpty
                  ? _emptyState()
                  : ListView.separated(
                      padding: const EdgeInsets.symmetric(vertical: 8),
                      itemCount: _blocked.length,
                      separatorBuilder: (_, __) => const Divider(height: 1, color: AppColors.surfaceElevated),
                      itemBuilder: (_, i) {
                        final c = _blocked[i];
                        final avatarUrl = c['avatarUrl'] as String?;
                        return ListTile(
                          contentPadding: const EdgeInsets.symmetric(horizontal: 20, vertical: 4),
                          leading: CircleAvatar(
                            radius: 22,
                            backgroundColor: AppColors.surfaceElevated,
                            backgroundImage: avatarUrl != null ? NetworkImage('${ApiService.baseUrl}$avatarUrl') : null,
                            child: avatarUrl == null ? const Icon(Icons.person, color: AppColors.textMuted) : null,
                          ),
                          title: Text(
                            c['username']?.toString() ?? 'Unknown user',
                            style: const TextStyle(color: AppColors.white, fontWeight: FontWeight.w600, fontSize: 15),
                          ),
                          subtitle: c['phone'] != null
                              ? Text(c['phone'].toString(), style: const TextStyle(color: AppColors.textMuted, fontSize: 12.5))
                              : null,
                          trailing: TextButton(
                            onPressed: () => _confirmUnblock(c),
                            child: const Text('Unblock', style: TextStyle(color: AppColors.cyan, fontWeight: FontWeight.w600)),
                          ),
                        );
                      },
                    ),
    );
  }

  Widget _emptyState() {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(
              width: 72,
              height: 72,
              decoration: const BoxDecoration(color: AppColors.surfaceElevated, shape: BoxShape.circle),
              child: const Icon(Icons.block_outlined, color: AppColors.textMuted, size: 32),
            ),
            const SizedBox(height: 20),
            const Text('No blocked contacts', style: TextStyle(color: AppColors.white, fontSize: 17, fontWeight: FontWeight.w700)),
            const SizedBox(height: 8),
            const Text(
              "People you block won't be able to call or message you.",
              textAlign: TextAlign.center,
              style: TextStyle(color: AppColors.textMuted, fontSize: 13.5, height: 1.4),
            ),
            const SizedBox(height: 24),
            OutlinedButton.icon(
              onPressed: _openBlockContact,
              icon: const Icon(Icons.add, size: 18),
              label: const Text('Block Contact'),
              style: OutlinedButton.styleFrom(
                foregroundColor: AppColors.cyan,
                side: const BorderSide(color: AppColors.cyan),
                padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 12),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// Search-and-block flow, reachable from the empty state and the app-bar
/// action -- reuses the same user-discovery search the "New Chat" flow uses
/// (server/personal-chat-routes.ts's /discover), since blocking someone you
/// haven't messaged yet still needs a way to find their real account.
class _BlockContactSearchScreen extends StatefulWidget {
  const _BlockContactSearchScreen();

  @override
  State<_BlockContactSearchScreen> createState() => _BlockContactSearchScreenState();
}

class _BlockContactSearchScreenState extends State<_BlockContactSearchScreen> {
  final _searchCtrl = TextEditingController();
  Timer? _debounce;
  List<Map<String, dynamic>> _results = [];
  bool _loading = false;
  bool _blocking = false;

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

  Future<void> _confirmAndBlock(Map<String, dynamic> user) async {
    final name = user['displayName']?.toString() ?? 'this contact';
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        backgroundColor: AppColors.surfaceElevated,
        title: const Text('Block this contact?', style: TextStyle(color: AppColors.white)),
        content: const Text(
          "They won't be able to call or message you on NeuraTalk.",
          style: TextStyle(color: AppColors.textSecondary),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(dialogContext, false),
            child: const Text('Cancel', style: TextStyle(color: AppColors.textMuted)),
          ),
          TextButton(
            onPressed: () => Navigator.pop(dialogContext, true),
            child: const Text('Block', style: TextStyle(color: AppColors.red)),
          ),
        ],
      ),
    );
    if (confirmed != true || !mounted) return;

    setState(() => _blocking = true);
    try {
      await ApiService.post('/api/users/${user['id']}/block', {});
      if (mounted) Navigator.pop(context, true);
    } catch (_) {
      if (mounted) {
        setState(() => _blocking = false);
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Could not block $name. Please try again.')),
        );
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
      appBar: AppBar(title: const Text('Block Contact')),
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
          if (_loading)
            const Padding(padding: EdgeInsets.only(top: 24), child: CircularProgressIndicator(color: AppColors.cyan)),
          Expanded(
            child: ListView.builder(
              itemCount: _results.length,
              itemBuilder: (_, i) {
                final u = _results[i];
                final avatarUrl = u['avatarUrl'] as String?;
                return ListTile(
                  leading: CircleAvatar(
                    backgroundColor: AppColors.surfaceElevated,
                    backgroundImage: avatarUrl != null ? NetworkImage('${ApiService.baseUrl}$avatarUrl') : null,
                    child: avatarUrl == null ? const Icon(Icons.person, color: AppColors.textMuted) : null,
                  ),
                  title: Text(u['displayName']?.toString() ?? 'Unknown user', style: const TextStyle(color: AppColors.white, fontWeight: FontWeight.w600)),
                  subtitle: Text(u['identifier']?.toString() ?? '', style: const TextStyle(color: AppColors.textMuted, fontSize: 12)),
                  trailing: _blocking
                      ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2, color: AppColors.red))
                      : const Icon(Icons.block_outlined, color: AppColors.red),
                  onTap: _blocking ? null : () => _confirmAndBlock(u),
                );
              },
            ),
          ),
        ],
      ),
    );
  }
}
