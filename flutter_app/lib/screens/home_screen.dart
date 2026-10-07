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

/// Home: answers "who can I talk to, and how?" in one glance.
///
/// Hierarchy: one primary action (start a translated conversation), three
/// secondary ways to talk, then the people you talked to recently with their
/// language pair and one-tap call.
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
                      style: TextStyle(color: AppColors.ink, fontSize: 26, fontWeight: FontWeight.w800, letterSpacing: -0.4)),
                  const SizedBox(height: 4),
                  Text('Speak ${myLang.name}. We\'ll handle the rest.',
                      style: TextStyle(color: AppColors.textSecondary, fontSize: 15)),
                ]),
              ),
              Padding(padding: const EdgeInsets.fromLTRB(NtSpace.l, NtSpace.xl, NtSpace.l, 0), child: _hero(myLang)),
              Padding(padding: const EdgeInsets.fromLTRB(NtSpace.l, NtSpace.m, NtSpace.l, 0), child: _secondaryActions()),
              NtSectionHeader('Recent conversations', action: recent.isEmpty ? null : 'View all', onAction: () => widget.onOpenTab(1)),
              if (recent.isEmpty)
                Padding(
                  padding: const EdgeInsets.symmetric(horizontal: NtSpace.l),
                  child: _card(
                    child: Padding(
                      padding: const EdgeInsets.all(NtSpace.l),
                      child: Row(children: [
                        Icon(Icons.forum_outlined, color: AppColors.cyan, size: 28),
                        const SizedBox(width: NtSpace.m),
                        Expanded(
                          child: Text('Your conversations will appear here, with each person\'s language.',
                              style: TextStyle(color: AppColors.textSecondary, fontSize: 14.5, height: 1.4)),
                        ),
                      ]),
                    ),
                  ),
                )
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

  /// The one primary action.
  Widget _hero(LanguageInfo myLang) {
    const deep = Color(0xFF1846C9);
    return Container(
      padding: const EdgeInsets.fromLTRB(NtSpace.xl, NtSpace.xl, NtSpace.xl, NtSpace.l),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(20),
        gradient: LinearGradient(begin: Alignment.topLeft, end: Alignment.bottomRight, colors: [AppColors.cyan, deep]),
      ),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        const LiveBadge(onDark: true, label: 'Live translation on'),
        const SizedBox(height: NtSpace.m),
        const Text('Talk to anyone,\nin their language',
            style: TextStyle(color: AppColors.onAccent, fontSize: 24, fontWeight: FontWeight.w800, height: 1.2, letterSpacing: -0.3)),
        const SizedBox(height: NtSpace.s),
        Text('You speak ${myLang.name}. They hear and read their own language, on calls and in chat.',
            style: const TextStyle(color: Color(0xE6FFFFFF), fontSize: 14.5, height: 1.4)),
        const SizedBox(height: NtSpace.l),
        Row(children: [
          Expanded(
            child: ElevatedButton.icon(
              onPressed: () => _push(const UserDiscoveryScreen()),
              icon: const Icon(Icons.add_comment_outlined, size: 20),
              label: const Text('Start a conversation'),
              style: ElevatedButton.styleFrom(
                backgroundColor: AppColors.onAccent,
                foregroundColor: deep,
                minimumSize: const Size(0, 50),
                textStyle: const TextStyle(fontFamily: 'Inter', fontSize: 15.5, fontWeight: FontWeight.w700),
              ),
            ),
          ),
          const SizedBox(width: NtSpace.s),
          IconButton.filled(
            tooltip: 'Call a number',
            onPressed: () => widget.onOpenTab(2),
            style: IconButton.styleFrom(backgroundColor: const Color(0x33FFFFFF), fixedSize: const Size(50, 50)),
            icon: const Icon(Icons.dialpad, color: AppColors.onAccent),
          ),
        ]),
      ]),
    );
  }

  /// Secondary ways to talk: smaller, one row.
  Widget _secondaryActions() {
    Widget tile(IconData icon, String label, String hint, Color color, VoidCallback onTap) => Expanded(
          child: _card(
            child: InkWell(
              onTap: onTap,
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: NtSpace.s, vertical: NtSpace.m),
                child: Column(children: [
                  Container(
                    width: 40,
                    height: 40,
                    decoration: BoxDecoration(color: color.withValues(alpha: AppColors.isDark ? 0.22 : 0.12), shape: BoxShape.circle),
                    child: Icon(icon, color: color, size: 21),
                  ),
                  const SizedBox(height: NtSpace.s),
                  Text(label, maxLines: 1, overflow: TextOverflow.ellipsis,
                      style: TextStyle(color: AppColors.ink, fontSize: 13.5, fontWeight: FontWeight.w700)),
                  Text(hint, maxLines: 1, overflow: TextOverflow.ellipsis, style: TextStyle(color: AppColors.textMuted, fontSize: 11.5)),
                ]),
              ),
            ),
          ),
        );
    return Row(children: [
      tile(Icons.record_voice_over, 'Face to face', 'One phone', AppColors.orange, () => _push(const FaceToFaceScreen())),
      const SizedBox(width: NtSpace.s),
      tile(Icons.groups, 'Groups', 'Many languages', AppColors.purple, () => _push(const GroupChatListScreen())),
      const SizedBox(width: NtSpace.s),
      tile(Icons.auto_awesome, 'Assistant', 'Write & translate', const Color(0xFF0891B2), () => _push(const ChatScreen())),
    ]);
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
