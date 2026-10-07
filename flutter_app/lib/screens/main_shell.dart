import 'package:flutter/material.dart';
import '../theme/app_theme.dart';
import 'home_screen.dart';
import 'human_chat_list_screen.dart';
import 'calls_screen.dart';
import 'contacts_screen.dart';
import 'settings_screen.dart';
import 'language_preferences_screen.dart';

class MainShell extends StatefulWidget {
  const MainShell({super.key});

  @override
  State<MainShell> createState() => _MainShellState();
}

class _MainShellState extends State<MainShell> {
  int _index = 0;
  final Set<int> _visited = {0};

  late final List<Widget> _screens = [
    HomeScreen(onOpenTab: (i) => setState(() {
      _index = i;
      _visited.add(i);
    })),
    const HumanChatListScreen(),
    const CallsScreen(),
    // Built on first visit: it asks for contacts permission, which should not pop up at app start.
    const _LazyTab(index: 3, child: ContactsScreen()),
    const SettingsScreen(),
  ];

  @override
  void initState() {
    super.initState();
    // First login on this device: ask which language to translate into (brand mockup 03).
    WidgetsBinding.instance.addPostFrameCallback((_) async {
      if (!await LanguagePreferencesScreen.needsFirstRunChoice() || !mounted) return;
      Navigator.of(context).push(MaterialPageRoute(
        fullscreenDialog: true,
        builder: (_) => const LanguagePreferencesScreen(firstRun: true),
      ));
    });
  }

  @override
  Widget build(BuildContext context) {
    final selected = AppColors.cyan;
    final unselected = AppColors.textSecondary;
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
            destinations: const [
              NavigationDestination(icon: Icon(Icons.home_outlined), selectedIcon: Icon(Icons.home_rounded), label: 'Home'),
              NavigationDestination(icon: Icon(Icons.chat_bubble_outline), selectedIcon: Icon(Icons.chat_bubble), label: 'Chats'),
              NavigationDestination(icon: Icon(Icons.call_outlined), selectedIcon: Icon(Icons.call), label: 'Calls'),
              NavigationDestination(icon: Icon(Icons.person_outline), selectedIcon: Icon(Icons.person), label: 'Contacts'),
              NavigationDestination(icon: Icon(Icons.more_horiz), selectedIcon: Icon(Icons.more_horiz), label: 'More'),
            ],
          ),
        ),
      ),
    );
  }
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
