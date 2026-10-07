import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../theme/app_theme.dart';
import '../providers/auth_provider.dart';
import '../providers/personal_chat_provider.dart';
import '../services/call_service.dart';
import '../services/contact_resolver.dart';
import '../utils/languages.dart';
import '../widgets/brand_logo.dart';
import '../widgets/nt_ui.dart';
import 'call_screen.dart';
import 'chat_screen.dart';
import 'conversation_screen.dart';
import 'face_to_face_screen.dart';
import 'group_chat_list_screen.dart';
import 'language_preferences_screen.dart';
import 'user_discovery_screen.dart';

/// Home: calm and quick. A search bar to reach anyone, one row of ways to
/// talk, then your recent people. Translation status is a quiet line, not a
/// banner: it is always on, so it doesn't need to shout.
class HomeScreen extends StatefulWidget {
  /// Switches the bottom-nav tab (1 Chats, 2 Calls, 3 Contacts, 4 More).
  final ValueChanged<int> onOpenTab;
  const HomeScreen({super.key, required this.onOpenTab});

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  String? _callingThread;

  String get _greeting {
    final h = DateTime.now().hour;
    if (h < 12) return 'Good morning';
    if (h < 17) return 'Good afternoon';
    return 'Good evening';
  }

  void _push(Widget screen) => Navigator.push(context, MaterialPageRoute(builder: (_) => screen));

  Future<void> _call(Map<String, dynamic> thread) async {
    final peer = (thread['peer'] as Map<String, dynamic>?) ?? const {};
    final target = (peer['phone'] ?? peer['identifier'] ?? peer['username'])?.toString();
    if (target == null || _callingThread != null) return;
    setState(() => _callingThread = '${thread['id']}');
    final callService = context.read<CallService>();
    try {
      final session = await callService.startCall(calleeIdentifier: target, callType: 'voice');
      if (!mounted) return;
      await Navigator.push(context, MaterialPageRoute(builder: (_) => CallScreen(session: session, callService: callService)));
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(friendlyCallError(e))));
    } finally {
      if (mounted) setState(() => _callingThread = null);
    }
  }

  @override
  Widget build(BuildContext context) {
    final user = context.watch<AuthProvider>().user;
    final chats = context.watch<PersonalChatProvider>();
    final phone = (user?['phone'] ?? '').toString();
    final username = (user?['username'] ?? '').toString();
    final firstName = username.isNotEmpty && username != phone ? username.split(' ').first : null;
    final myLang = Languages.of(user?['preferredLanguage']?.toString());
    final recent = [...chats.threads.where((t) => t['isArchived'] != true)]
      ..sort((a, b) => (b['lastMessageAt']?.toString() ?? '').compareTo(a['lastMessageAt']?.toString() ?? ''));

    return Scaffold(
      backgroundColor: AppColors.backgroundMid,
      body: SafeArea(
        bottom: false,
        child: RefreshIndicator(
          color: AppColors.cyan,
          onRefresh: chats.loadThreads,
          child: ListView(
            padding: const EdgeInsets.only(bottom: NtSpace.xxl),
            children: [
              // Top bar: brand, my language, me.
              Padding(
                padding: const EdgeInsets.fromLTRB(NtSpace.xl, NtSpace.m, NtSpace.l, 0),
                child: Row(children: [
                  const NeuraLogo(size: 20),
                  const Spacer(),
                  Material(
                    color: AppColors.surface,
                    shape: StadiumBorder(side: BorderSide(color: AppColors.border)),
                    child: InkWell(
                      customBorder: const StadiumBorder(),
                      onTap: () => _push(const LanguagePreferencesScreen()),
                      child: Padding(
                        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                        child: Row(mainAxisSize: MainAxisSize.min, children: [
                          Text(myLang.flag, style: const TextStyle(fontSize: 15)),
                          const SizedBox(width: 6),
                          Text(myLang.name, style: TextStyle(color: AppColors.ink, fontSize: 13.5, fontWeight: FontWeight.w600)),
                          Icon(Icons.expand_more, size: 18, color: AppColors.textMuted),
                        ]),
                      ),
                    ),
                  ),
                  const SizedBox(width: NtSpace.s),
                  GestureDetector(
                    onTap: () => widget.onOpenTab(4),
                    child: NtAvatar(name: firstName ?? '', avatarUrl: user?['avatarUrl']?.toString(), size: 40),
                  ),
                ]),
              ),
              Padding(
                padding: const EdgeInsets.fromLTRB(NtSpace.xl, NtSpace.xl, NtSpace.xl, 0),
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Text(firstName != null ? '$_greeting, $firstName' : _greeting,
                      style: TextStyle(color: AppColors.ink, fontSize: 24, fontWeight: FontWeight.w800, letterSpacing: -0.4)),
                  const SizedBox(height: 6),
                  InkWell(
                    borderRadius: BorderRadius.circular(8),
                    onTap: () => _push(const LanguagePreferencesScreen()),
                    child: Row(mainAxisSize: MainAxisSize.min, children: [
                      Container(width: 8, height: 8, decoration: BoxDecoration(color: AppColors.green, shape: BoxShape.circle)),
                      const SizedBox(width: 8),
                      Text('Everything is translated into ${myLang.name}',
                          style: TextStyle(color: AppColors.textSecondary, fontSize: 14.5)),
                    ]),
                  ),
                ]),
              ),
              Padding(padding: const EdgeInsets.fromLTRB(NtSpace.l, NtSpace.xl, NtSpace.l, 0), child: _searchBar()),
              Padding(padding: const EdgeInsets.fromLTRB(NtSpace.s, NtSpace.xl, NtSpace.s, 0), child: _quickActions()),
              NtSectionHeader(recent.isEmpty ? 'How it works' : 'Recent', action: recent.isEmpty ? null : 'View all', onAction: () => widget.onOpenTab(1)),
              if (recent.isEmpty)
                Padding(padding: const EdgeInsets.symmetric(horizontal: NtSpace.l), child: _howItWorks(myLang))
              else
                Padding(
                  padding: const EdgeInsets.symmetric(horizontal: NtSpace.l),
                  child: _card(
                    child: Column(children: [
                      for (var i = 0; i < recent.length && i < 5; i++) ...[
                        _recentRow(recent[i]),
                        if (i < recent.length - 1 && i < 4) Divider(height: 1, indent: 76, color: AppColors.border),
                      ],
                    ]),
                  ),
                ),
            ],
          ),
        ),
      ),
    );
  }

  /// Looks like search, because that's what people expect: find a person, start talking.
  Widget _searchBar() {
    return Material(
      color: AppColors.surface,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16), side: BorderSide(color: AppColors.border)),
      child: InkWell(
        customBorder: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
        onTap: () => _push(const UserDiscoveryScreen()),
        child: Padding(
          padding: const EdgeInsets.fromLTRB(16, 15, 16, 15),
          child: Row(children: [
            Icon(Icons.search, color: AppColors.textMuted),
            const SizedBox(width: 12),
            Expanded(
              child: Text('Search people or a phone number',
                  style: TextStyle(color: AppColors.textMuted, fontSize: 15.5)),
            ),
            Icon(Icons.add_comment_outlined, color: AppColors.cyan, size: 22),
          ]),
        ),
      ),
    );
  }

  /// Ways to talk, as one row of round buttons (like a payments app: big
  /// targets, one word each, easy for everyone).
  Widget _quickActions() {
    Widget action(IconData icon, String label, Color color, VoidCallback onTap) => Expanded(
          child: InkWell(
            borderRadius: BorderRadius.circular(16),
            onTap: onTap,
            child: Padding(
              padding: const EdgeInsets.symmetric(vertical: 6),
              child: Column(children: [
                Container(
                  width: 54,
                  height: 54,
                  decoration: BoxDecoration(
                    color: color.withValues(alpha: AppColors.isDark ? 0.22 : 0.11),
                    borderRadius: BorderRadius.circular(18),
                  ),
                  child: Icon(icon, color: color, size: 25),
                ),
                const SizedBox(height: 8),
                Text(label, maxLines: 1, overflow: TextOverflow.ellipsis,
                    style: TextStyle(color: AppColors.ink, fontSize: 12.5, fontWeight: FontWeight.w600)),
              ]),
            ),
          ),
        );
    return Row(children: [
      action(Icons.chat_bubble_outline, 'New chat', AppColors.cyan, () => _push(const UserDiscoveryScreen())),
      action(Icons.call_outlined, 'Call', AppColors.green, () => widget.onOpenTab(2)),
      action(Icons.record_voice_over_outlined, 'In person', AppColors.orange, () => _push(const FaceToFaceScreen())),
      action(Icons.groups_outlined, 'Groups', AppColors.purple, () => _push(const GroupChatListScreen())),
      action(Icons.auto_awesome_outlined, 'Assistant', const Color(0xFF0891B2), () => _push(const ChatScreen())),
    ]);
  }

  /// First-run guide: three honest steps, no marketing.
  Widget _howItWorks(LanguageInfo myLang) {
    Widget step(int n, String title, String body) => Padding(
          padding: const EdgeInsets.fromLTRB(NtSpace.l, NtSpace.m, NtSpace.l, NtSpace.m),
          child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Container(
              width: 28,
              height: 28,
              alignment: Alignment.center,
              decoration: BoxDecoration(color: AppColors.cyan.withValues(alpha: 0.12), shape: BoxShape.circle),
              child: Text('$n', style: TextStyle(color: AppColors.cyan, fontWeight: FontWeight.w800, fontSize: 13.5)),
            ),
            const SizedBox(width: NtSpace.m),
            Expanded(
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text(title, style: TextStyle(color: AppColors.ink, fontSize: 15, fontWeight: FontWeight.w700)),
                const SizedBox(height: 2),
                Text(body, style: TextStyle(color: AppColors.textSecondary, fontSize: 14, height: 1.4)),
              ]),
            ),
          ]),
        );
    return _card(
      child: Column(children: [
        step(1, 'You speak ${myLang.name}', 'Type, talk or send voice notes in your own language.'),
        Divider(height: 1, indent: 56, color: AppColors.border),
        step(2, 'They get their language', 'Chats, calls and voice notes reach them already translated.'),
        Divider(height: 1, indent: 56, color: AppColors.border),
        step(3, 'Start with anyone', 'Search a name or number above, or invite a friend.'),
      ]),
    );
  }

  static String _when(dynamic raw) {
    final dt = DateTime.tryParse(raw?.toString() ?? '')?.toLocal();
    if (dt == null) return '';
    final now = DateTime.now();
    final days = DateTime(now.year, now.month, now.day).difference(DateTime(dt.year, dt.month, dt.day)).inDays;
    if (days == 0) {
      final h = dt.hour % 12 == 0 ? 12 : dt.hour % 12;
      return '$h:${dt.minute.toString().padLeft(2, '0')} ${dt.hour < 12 ? 'AM' : 'PM'}';
    }
    if (days == 1) return 'Yesterday';
    if (days < 7) return const ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][dt.weekday - 1];
    return '${dt.day}/${dt.month}';
  }

  Widget _recentRow(Map<String, dynamic> thread) {
    final peer = (thread['peer'] as Map<String, dynamic>?) ?? const {};
    final name = ContactResolver.instance.nameFor(peer['phone']?.toString()) ?? peer['displayName']?.toString() ?? 'Unknown';
    final unread = (thread['unreadCount'] as int?) ?? 0;
    final calling = _callingThread == '${thread['id']}';
    return InkWell(
      onTap: () async {
        await Navigator.push(context, MaterialPageRoute(builder: (_) => ConversationScreen(thread: thread)));
        if (mounted) context.read<PersonalChatProvider>().loadThreads();
      },
      child: Padding(
        padding: const EdgeInsets.fromLTRB(NtSpace.l, NtSpace.m, NtSpace.xs, NtSpace.m),
        child: Row(children: [
          NtAvatar(name: name, avatarUrl: peer['avatarUrl']?.toString(), size: 46),
          const SizedBox(width: NtSpace.m),
          Expanded(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Row(children: [
                Expanded(
                  child: Text(name, maxLines: 1, overflow: TextOverflow.ellipsis,
                      style: TextStyle(color: AppColors.ink, fontSize: 16, fontWeight: unread > 0 ? FontWeight.w800 : FontWeight.w600)),
                ),
                Text(_when(thread['lastMessageAt']),
                    style: TextStyle(color: unread > 0 ? AppColors.cyan : AppColors.textMuted, fontSize: 12, fontWeight: FontWeight.w600)),
              ]),
              const SizedBox(height: 3),
              LanguagePairChip(mine: thread['viewerLanguage']?.toString(), theirs: thread['peerLanguage']?.toString(), compact: true),
              const SizedBox(height: 3),
              Text(thread['lastMessagePreview']?.toString() ?? 'Say hello 👋', maxLines: 1, overflow: TextOverflow.ellipsis,
                  style: TextStyle(color: unread > 0 ? AppColors.ink : AppColors.textSecondary, fontSize: 14)),
            ]),
          ),
          calling
              ? Padding(
                  padding: const EdgeInsets.all(14),
                  child: SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2, color: AppColors.cyan)),
                )
              : IconButton(
                  tooltip: 'Call $name',
                  icon: Icon(Icons.call_outlined, color: AppColors.cyan),
                  onPressed: _callingThread != null ? null : () => _call(thread),
                ),
        ]),
      ),
    );
  }

  Widget _card({required Widget child}) => Material(
        color: AppColors.surface,
        clipBehavior: Clip.antiAlias,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16), side: BorderSide(color: AppColors.border)),
        child: child,
      );
}
