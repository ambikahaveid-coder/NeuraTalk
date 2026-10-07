import 'dart:async';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../theme/app_theme.dart';
import '../providers/personal_chat_provider.dart';
import '../services/api_service.dart';
import 'conversation_screen.dart';
import 'contacts_screen.dart';
import 'create_group_screen.dart';
import 'package:share_plus/share_plus.dart';
import '../widgets/nt_ui.dart';

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
    final query = _searchCtrl.text.trim();
    void go(Widget screen) => Navigator.push(context, MaterialPageRoute(builder: (_) => screen));
    void invite() => Share.share("Let's talk on NeuraTalk: calls and chat translated live into your language. https://neuratalk.in");

    Widget shortcut(IconData icon, Color color, String title, String subtitle, VoidCallback onTap) => ListTile(
          contentPadding: const EdgeInsets.symmetric(horizontal: 20, vertical: 2),
          leading: CircleAvatar(radius: 22, backgroundColor: color.withValues(alpha: AppColors.isDark ? 0.22 : 0.12), child: Icon(icon, color: color)),
          title: Text(title, style: TextStyle(color: AppColors.ink, fontSize: 16, fontWeight: FontWeight.w600)),
          subtitle: Text(subtitle, style: TextStyle(color: AppColors.textSecondary, fontSize: 13.5)),
          onTap: onTap,
        );

    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(title: const Text('New conversation')),
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
                suffixIcon: query.isEmpty
                    ? null
                    : IconButton(
                        tooltip: 'Clear',
                        icon: const Icon(Icons.close),
                        onPressed: () => setState(() {
                          _searchCtrl.clear();
                          _results = [];
                        }),
                      ),
              ),
            ),
          ),
          if (_loading) LinearProgressIndicator(minHeight: 2, color: AppColors.cyan, backgroundColor: Colors.transparent),
          Expanded(
            child: _error != null
                ? NtEmptyState(icon: Icons.wifi_off, title: "Couldn't search right now", message: _error!, error: true)
                : query.length < 2
                    ? ListView(children: [
                        shortcut(Icons.contacts_outlined, AppColors.green, 'From your contacts', 'See who already uses NeuraTalk',
                            () => go(const ContactsScreen())),
                        shortcut(Icons.group_add_outlined, AppColors.purple, 'New group', 'Everyone reads in their own language',
                            () => go(const CreateGroupScreen())),
                        shortcut(Icons.share_outlined, AppColors.orange, 'Invite a friend', 'Send them a link to NeuraTalk', invite),
                        Padding(
                          padding: const EdgeInsets.fromLTRB(20, 20, 20, 0),
                          child: Text('Tip: search by their name on NeuraTalk or their phone number.',
                              style: TextStyle(color: AppColors.textMuted, fontSize: 13.5, height: 1.4)),
                        ),
                      ])
                    : !_loading && _results.isEmpty
                        ? NtEmptyState(
                            icon: Icons.person_search_outlined,
                            title: 'No one found for "$query"',
                            message: 'They may not be on NeuraTalk yet. Invite them and you can talk in your own languages.',
                            actionLabel: 'Invite them',
                            onAction: invite,
                          )
                        : ListView.builder(
                            itemCount: _results.length,
                            itemBuilder: (_, i) {
                              final u = _results[i];
                              final name = u['displayName']?.toString() ?? 'Unknown user';
                              return ListTile(
                                contentPadding: const EdgeInsets.symmetric(horizontal: 20, vertical: 2),
                                leading: NtAvatar(name: name, avatarUrl: u['avatarUrl'] as String?, size: 46),
                                title: Text(name, style: TextStyle(color: AppColors.ink, fontSize: 16, fontWeight: FontWeight.w600)),
                                subtitle: Text(u['identifier']?.toString() ?? '', style: TextStyle(color: AppColors.textSecondary, fontSize: 13.5)),
                                trailing: _starting
                                    ? SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2, color: AppColors.cyan))
                                    : Icon(Icons.chat_bubble_outline, color: AppColors.cyan),
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
