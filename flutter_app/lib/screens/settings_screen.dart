import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../theme/app_theme.dart';
import '../providers/auth_provider.dart';
import '../services/api_service.dart';
import '../utils/external_link.dart';
import '../utils/languages.dart';
import 'profile_screen.dart';
import 'notifications_settings_screen.dart';
import 'language_preferences_screen.dart';
import 'translation_settings_screen.dart';
import 'calls_settings_screen.dart';
import 'blocked_contacts_screen.dart';
import 'teams_screen.dart';
import 'wallet_screen.dart';

/// "More" tab — Settings (brand mockup 12).
class SettingsScreen extends StatelessWidget {
  const SettingsScreen({super.key});

  Future<void> _openWebPage(BuildContext context, String path) async {
    final opened = await ExternalLink.open('${ApiService.baseUrl}$path');
    if (!opened && context.mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Could not open this page. Visit neuratalk.in$path instead.')),
      );
    }
  }

  void _go(BuildContext context, Widget screen) => Navigator.push(context, MaterialPageRoute(builder: (_) => screen));

  static bool isBusiness(Map<String, dynamic>? user) {
    final role = user?['role']?.toString() ?? '';
    return role == 'company_admin' || role == 'super_admin' || role == 'agent' || user?['organizationId'] != null;
  }

  @override
  Widget build(BuildContext context) {
    final user = context.watch<AuthProvider>().user;
    final lang = Languages.of(user?['preferredLanguage']?.toString());
    final rows = <_Row>[
      _Row(Icons.person_outline, 'Account', 'Profile, plan and minutes', () => _go(context, const ProfileScreen())),
      _Row(Icons.language, 'Languages', 'You speak ${lang.name}', () => _go(context, const LanguagePreferencesScreen())),
      _Row(Icons.translate, 'Translation Settings', 'Auto-translate chats and calls', () => _go(context, const TranslationSettingsScreen())),
      _Row(Icons.workspace_premium_outlined, 'Subscription', 'Plans and minutes', () => _go(context, const WalletScreen())),
      _Row(Icons.dark_mode_outlined, 'Appearance', _appearanceLabel(context.watch<ThemeController>().mode), () => _pickAppearance(context)),
      _Row(Icons.notifications_none, 'Notifications', 'Messages and calls', () => _go(context, const NotificationsSettingsScreen())),
      _Row(Icons.call_outlined, 'Calls', 'Microphone access', () => _go(context, const CallsSettingsScreen())),
      _Row(Icons.shield_outlined, 'Privacy & Security', 'Blocked contacts', () => _go(context, const BlockedContactsScreen())),
      _Row(Icons.record_voice_over_outlined, 'Voice Clone', 'Translated calls in your own voice', () => _openWebPage(context, '/settings/voice-clone')),
      if (isBusiness(user)) _Row(Icons.groups_outlined, 'Teams', 'Your organisation\'s teams', () => _go(context, const TeamsScreen())),
      _Row(Icons.help_outline, 'Help & Support', 'FAQs, contact us', () => _openWebPage(context, '/help')),
      _Row(Icons.description_outlined, 'Terms & Privacy Policy', 'How we handle your data', () => _openWebPage(context, '/privacy')),
    ];

    return Scaffold(
      backgroundColor: AppColors.background,
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.only(bottom: 24),
          children: [
            Padding(
              padding: EdgeInsets.fromLTRB(20, 16, 20, 12),
              child: Text('Settings', style: TextStyle(color: AppColors.ink, fontSize: 30, fontWeight: FontWeight.w800, letterSpacing: -0.5)),
            ),
            for (var i = 0; i < rows.length; i++) ...[
              ListTile(
                contentPadding: const EdgeInsets.symmetric(horizontal: 20, vertical: 4),
                leading: Container(
                  width: 44,
                  height: 44,
                  decoration: BoxDecoration(shape: BoxShape.circle, border: Border.all(color: AppColors.border), color: AppColors.background),
                  child: Icon(rows[i].icon, color: AppColors.ink, size: 22),
                ),
                title: Text(rows[i].title, style: TextStyle(color: AppColors.ink, fontSize: 16, fontWeight: FontWeight.w600)),
                subtitle: Text(rows[i].subtitle, style: TextStyle(color: AppColors.textSecondary, fontSize: 13.5)),
                trailing: Icon(Icons.chevron_right, color: AppColors.textMuted),
                onTap: rows[i].onTap,
              ),
              if (i < rows.length - 1) const Divider(height: 1, indent: 84, endIndent: 20),
            ],
            const SizedBox(height: 12),
            ListTile(
              contentPadding: const EdgeInsets.symmetric(horizontal: 20, vertical: 4),
              leading: Container(
                width: 44,
                height: 44,
                decoration: BoxDecoration(shape: BoxShape.circle, color: AppColors.red.withValues(alpha: 0.08)),
                child: const Icon(Icons.logout, color: AppColors.red, size: 22),
              ),
              title: const Text('Logout', style: TextStyle(color: AppColors.red, fontSize: 16, fontWeight: FontWeight.w700)),
              onTap: () => confirmLogout(context),
            ),
            const SizedBox(height: 12),
            Center(child: Text('NeuraTalk v2.0.0 · Mindwhile IT Solutions', style: TextStyle(color: AppColors.textMuted, fontSize: 13))),
          ],
        ),
      ),
    );
  }

  static String _appearanceLabel(ThemeMode mode) => switch (mode) {
        ThemeMode.light => 'Light',
        ThemeMode.dark => 'Dark',
        ThemeMode.system => 'Same as phone (System)',
      };

  Future<void> _pickAppearance(BuildContext context) async {
    final controller = context.read<ThemeController>();
    await showModalBottomSheet<void>(
      context: context,
      showDragHandle: true,
      builder: (sheet) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 0, 20, 8),
              child: Text('Appearance', style: TextStyle(color: AppColors.ink, fontSize: 18, fontWeight: FontWeight.w700)),
            ),
            for (final (mode, icon) in const [
              (ThemeMode.light, Icons.light_mode_outlined),
              (ThemeMode.dark, Icons.dark_mode_outlined),
              (ThemeMode.system, Icons.settings_suggest_outlined),
            ])
              ListTile(
                leading: Icon(icon, color: AppColors.ink),
                title: Text(_appearanceLabel(mode)),
                trailing: controller.mode == mode ? Icon(Icons.check_circle, color: AppColors.cyan) : null,
                onTap: () {
                  controller.setMode(mode);
                  Navigator.pop(sheet);
                },
              ),
            const SizedBox(height: 8),
          ],
        ),
      ),
    );
  }

  static Future<void> confirmLogout(BuildContext context) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (d) => AlertDialog(
        title: const Text('Log out?'),
        content: const Text('You will need your phone number and a new code to log back in.'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(d, false), child: const Text('Cancel')),
          TextButton(onPressed: () => Navigator.pop(d, true), child: const Text('Log out', style: TextStyle(color: AppColors.red))),
        ],
      ),
    );
    if (ok != true || !context.mounted) return;
    await context.read<AuthProvider>().logout();
    if (!context.mounted) return;
    // Logged out: the app root (main.dart) now shows the login screen.
    Navigator.of(context, rootNavigator: true).popUntil((route) => route.isFirst);
  }
}

class _Row {
  final IconData icon;
  final String title;
  final String subtitle;
  final VoidCallback onTap;
  const _Row(this.icon, this.title, this.subtitle, this.onTap);
}
