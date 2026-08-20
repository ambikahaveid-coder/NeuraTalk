import 'dart:async';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../theme/app_theme.dart';
import '../providers/personal_chat_provider.dart';
import '../services/api_service.dart';
import 'conversation_screen.dart';

/// Find a real NeuraTalk user by username/email/phone (server/personal-chat-
/// routes.ts:discover). No hardcoded or mock results.
class UserDiscoveryScreen extends StatefulWidget {
  const UserDiscoveryScreen({super.key});

  @override
  State<UserDiscoveryScreen> createState() => _UserDiscoveryScreenState();
}

class _UserDiscoveryScreenState extends State<UserDiscoveryScreen> {
  final _searchCtrl = TextEditingController();
  Timer? _debounce;
  List<Map<String, dynamic>> _results = [];
  bool _loading = false;
  bool _starting = false;
  String? _error;

  void _onChanged(String query) {
    _debounce?.cancel();
    _debounce = Timer(const Duration(milliseconds: 400), () => _search(query));
  }

  Future<void> _search(String query) async {
    final trimmed = query.trim();
    if (trimmed.length < 2) {
      setState(() {
        _results = [];
        _loading = false;
        _error = null;
      });
      return;
    }
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final res = await ApiService.get('/api/personal-chats/discover?q=${Uri.encodeQueryComponent(trimmed)}') as Map<String, dynamic>;
      if (!mounted) return;
      setState(() {
        _results = (res['results'] as List).cast<Map<String, dynamic>>();
        _loading = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = 'Could not search right now.';
        _loading = false;
      });
    }
  }

  Future<void> _startChat(Map<String, dynamic> user) async {
    if (_starting) return;
    setState(() => _starting = true);
    try {
      final thread = await context.read<PersonalChatProvider>().startThread(userId: user['id'] as int);
      if (!mounted || thread == null) return;
      Navigator.pushReplacement(context, MaterialPageRoute(builder: (_) => ConversationScreen(thread: thread)));
    } on ApiException catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.message)));
    } finally {
      if (mounted) setState(() => _starting = false);
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
      appBar: AppBar(title: const Text('New Chat')),
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
          if (_loading) const Padding(
            padding: EdgeInsets.only(top: 24),
            child: CircularProgressIndicator(color: AppColors.cyan),
          ),
          if (_error != null) Padding(
            padding: const EdgeInsets.all(16),
            child: Text(_error!, style: const TextStyle(color: AppColors.red)),
          ),
          if (!_loading && _error == null && _searchCtrl.text.trim().length >= 2 && _results.isEmpty)
            const Padding(
              padding: EdgeInsets.only(top: 24),
              child: Text('No users found.', style: TextStyle(color: AppColors.textMuted)),
            ),
          Expanded(
            child: ListView.builder(
              itemCount: _results.length,
              itemBuilder: (_, i) {
                final u = _results[i];
                final avatarUrl = u['avatarUrl'] as String?;
                return ListTile(
                  leading: CircleAvatar(
                    backgroundColor: AppColors.cyan.withOpacity(0.15),
                    backgroundImage: avatarUrl != null ? NetworkImage('${ApiService.baseUrl}$avatarUrl') : null,
                    child: avatarUrl == null ? const Icon(Icons.person, color: AppColors.cyan) : null,
                  ),
                  title: Text(u['displayName']?.toString() ?? 'Unknown user', style: const TextStyle(color: AppColors.white, fontWeight: FontWeight.w600)),
                  subtitle: Text(u['identifier']?.toString() ?? '', style: const TextStyle(color: AppColors.textMuted, fontSize: 12)),
                  trailing: _starting ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2, color: AppColors.cyan)) : const Icon(Icons.chat_bubble_outline, color: AppColors.cyan),
                  onTap: () => _startChat(u),
                );
              },
            ),
          ),
        ],
      ),
    );
  }
}
