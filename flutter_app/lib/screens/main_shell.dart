import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../providers/personal_chat_provider.dart';
import '../theme/app_theme.dart';
import 'home_screen.dart';
import 'human_chat_list_screen.dart';
import 'calls_screen.dart';
import 'updates_screen.dart';
import 'settings_screen.dart';
import 'language_preferences_screen.dart';
import '../services/call_readiness.dart';

class MainShell extends StatefulWidget {
  const MainShell({super.key});

  @override
  State<MainShell> createState() => _MainShellState();
}

class _MainShellState extends State<MainShell> {
  // A messenger opens on its conversations; Home stays one tap away.
  int _index = 1;
  final Set<int> _visited = {0, 1};

  late final List<Widget> _screens = [
    HomeScreen(onOpenTab: (i) => setState(() {
      _index = i;
      _visited.add(i);
    })),
    const HumanChatListScreen(),
    // Built on first visit, so opening the app doesn't load updates first.
    const _LazyTab(index: 2, child: UpdatesScreen()),
    const CallsScreen(),
    const SettingsScreen(),
  ];

  @override
  void initState() {
    super.initState();
    // First login on this device: ask which language to translate into (brand mockup 03).
    WidgetsBinding.instance.addPostFrameCallback((_) async {
      final needsLanguage = await LanguagePreferencesScreen.needsFirstRunChoice().catchError((_) => false);
      if (needsLanguage && mounted) {
        await Navigator.of(context).push(MaterialPageRoute(
          fullscreenDialog: true,
          builder: (_) => const LanguagePreferencesScreen(firstRun: true),
        ));
      }
      // Then make sure calls can ring while the app is closed.
      if (mounted) await CallReadiness.ensure(context);
    });
  }

  @override
  Widget build(BuildContext context) {
    final selected = AppColors.cyan;
    final unselected = AppColors.textSecondary;
    final unread = context.select<PersonalChatProvider, int>((p) => p.totalUnread);
    return Scaffold(
      body: _VisitedTabs(
        visited: _visited,
        child: IndexedStack(index: _index, children: _screens),
      ),
      bottomNavigationBar: NavigationBarTheme(
        data: NavigationBarThemeData(
          backgroundColor: AppColors.background,
          indicatorColor: AppColors.blueTint,
          surfaceTintColor: Colors.transparent,
          elevation: 0,
          height: 70,
          labelTextStyle: WidgetStateProperty.resolveWith(
            (states) => TextStyle(
              fontFamily: 'Inter',
              fontSize: 12.5,
              fontWeight: states.contains(WidgetState.selected) ? FontWeight.w700 : FontWeight.w500,
              color: states.contains(WidgetState.selected) ? selected : unselected,
            ),
          ),
          iconTheme: WidgetStateProperty.resolveWith(
            (states) => IconThemeData(
              size: 24,
              color: states.contains(WidgetState.selected) ? selected : unselected,
            ),
          ),
        ),
        child: DecoratedBox(
          decoration: BoxDecoration(
            border: Border(top: BorderSide(color: AppColors.border)),
          ),
          child: NavigationBar(
            selectedIndex: _index,
            onDestinationSelected: (i) => setState(() {
              _index = i;
              _visited.add(i);
            }),
            destinations: [
              const NavigationDestination(icon: Icon(Icons.home_outlined), selectedIcon: Icon(Icons.home_rounded), label: 'Home'),
              NavigationDestination(
                icon: _withUnread(unread, const Icon(Icons.chat_bubble_outline)),
                selectedIcon: _withUnread(unread, const Icon(Icons.chat_bubble)),
                label: 'Chats',
              ),
              const NavigationDestination(icon: Icon(Icons.amp_stories_outlined), selectedIcon: Icon(Icons.amp_stories), label: 'Updates'),
              const NavigationDestination(icon: Icon(Icons.call_outlined), selectedIcon: Icon(Icons.call), label: 'Calls'),
              const NavigationDestination(icon: Icon(Icons.more_horiz), selectedIcon: Icon(Icons.more_horiz), label: 'More'),
            ],
          ),
        ),
      ),
    );
  }
}

/// Unread count on the Chats tab ("99+" past 99); nothing when all read.
Widget _withUnread(int unread, Widget icon) {
  if (unread <= 0) return icon;
  return Badge(
    label: Text(unread > 99 ? '99+' : '$unread', style: const TextStyle(fontWeight: FontWeight.w700)),
    backgroundColor: AppColors.cyan,
    textColor: AppColors.onAccent,
    child: icon,
  );
}

/// Shares which tabs have been opened with [_LazyTab]s below it.
class _VisitedTabs extends InheritedWidget {
  final Set<int> visited;
  const _VisitedTabs({required this.visited, required super.child});

  static Set<int> of(BuildContext context) =>
      context.dependOnInheritedWidgetOfExactType<_VisitedTabs>()?.visited ?? const {};

  @override
  bool updateShouldNotify(_VisitedTabs oldWidget) => true;
}

class _LazyTab extends StatelessWidget {
  final int index;
  final Widget child;
  const _LazyTab({required this.index, required this.child});

  @override
  Widget build(BuildContext context) =>
      _VisitedTabs.of(context).contains(index) ? child : const SizedBox.shrink();
}
