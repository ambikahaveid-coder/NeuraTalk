import 'dart:async';
import 'package:flutter/material.dart';
import '../theme/app_theme.dart';
import '../services/api_service.dart';
import '../widgets/nt_ui.dart';

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
        _error = 'Check your connection and try again.';
        _loading = false;
      });
    }
  }

  Future<void> _confirmUnblock(Map<String, dynamic> contact) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        backgroundColor: AppColors.surfaceElevated,
        title: Text('Unblock ${contact['username'] ?? 'this person'}?', style: TextStyle(color: AppColors.ink)),
        content: Text(
          'They will be able to call and message you again.',
          style: TextStyle(color: AppColors.textSecondary),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(dialogContext, false),
            child: Text('Cancel', style: TextStyle(color: AppColors.textMuted)),
          ),
          TextButton(
            onPressed: () => Navigator.pop(dialogContext, true),
            child: Text('Unblock', style: TextStyle(color: AppColors.cyan)),
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
          const SnackBar(content: Text("Couldn't unblock. Try again.")),
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
        title: const Text('Blocked contacts'),
        actions: [
          IconButton(
            icon: const Icon(Icons.person_add_alt_outlined),
            tooltip: 'Block someone',
            onPressed: _openBlockContact,
          ),
        ],
      ),
      body: _loading
          ? Center(child: CircularProgressIndicator(color: AppColors.cyan))
          : _error != null
              ? NtEmptyState(icon: Icons.wifi_off, title: "Couldn't load", message: _error!, error: true, actionLabel: 'Try again', onAction: _load)
              : _blocked.isEmpty
                  ? NtEmptyState(
                      icon: Icons.block_outlined,
                      title: 'No one is blocked',
                      message: "People you block can't call or message you. They aren't told that you blocked them.",
                      actionLabel: 'Block someone',
                      onAction: _openBlockContact,
                    )
                  : ListView.separated(
                      padding: const EdgeInsets.symmetric(vertical: 8),
                      itemCount: _blocked.length,
                      separatorBuilder: (_, __) => Divider(height: 1, indent: 82, color: AppColors.border),
                      itemBuilder: (_, i) {
                        final c = _blocked[i];
                        final name = c['username']?.toString() ?? 'Unknown user';
                        return ListTile(
                          contentPadding: const EdgeInsets.fromLTRB(20, 4, 16, 4),
                          leading: NtAvatar(name: name, avatarUrl: c['avatarUrl'] as String?, size: 46),
                          title: Text(name, style: TextStyle(color: AppColors.ink, fontWeight: FontWeight.w600, fontSize: 16)),
                          subtitle: c['phone'] != null
                              ? Text(c['phone'].toString(), style: TextStyle(color: AppColors.textSecondary, fontSize: 14))
                              : null,
                          trailing: OutlinedButton(
                            onPressed: () => _confirmUnblock(c),
                            style: OutlinedButton.styleFrom(
                              minimumSize: const Size(0, 36),
                              padding: const EdgeInsets.symmetric(horizontal: 14),
                              foregroundColor: AppColors.cyan,
                              side: BorderSide(color: AppColors.border),
                            ),
                            child: const Text('Unblock'),
                          ),
                        );
                      },
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
        title: Text('Block $name?', style: TextStyle(color: AppColors.ink)),
        content: Text(
          "They won't be able to call or message you on NeuraTalk.",
          style: TextStyle(color: AppColors.textSecondary),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(dialogContext, false),
            child: Text('Cancel', style: TextStyle(color: AppColors.textMuted)),
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
          SnackBar(content: Text("Couldn't block $name. Try again.")),
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
    final query = _searchCtrl.text.trim();
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(title: const Text('Block someone')),
      body: Column(
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 4, 16, 8),
            child: TextField(
              controller: _searchCtrl,
              autofocus: true,
              onChanged: (v) {
                setState(() {});
                _onChanged(v);
              },
              style: TextStyle(color: AppColors.ink, fontSize: 16),
              decoration: InputDecoration(
                hintText: 'Name or phone number',
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
          if (_loading) LinearProgressIndicator(minHeight: 2, color: AppColors.cyan, backgroundColor: Colors.transparent),
          Expanded(
            child: !_loading && query.length >= 2 && _results.isEmpty
                ? NtEmptyState(icon: Icons.person_search_outlined, title: 'No one found', message: 'Check the name or number and try again.')
                : ListView.builder(
                    itemCount: _results.length,
                    itemBuilder: (_, i) {
                      final u = _results[i];
                      final name = u['displayName']?.toString() ?? 'Unknown user';
                      return ListTile(
                        contentPadding: const EdgeInsets.symmetric(horizontal: 20, vertical: 2),
                        leading: NtAvatar(name: name, avatarUrl: u['avatarUrl'] as String?, size: 46),
                        title: Text(name, style: TextStyle(color: AppColors.ink, fontWeight: FontWeight.w600, fontSize: 16)),
                        subtitle: Text(u['identifier']?.toString() ?? '', style: TextStyle(color: AppColors.textSecondary, fontSize: 14)),
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
