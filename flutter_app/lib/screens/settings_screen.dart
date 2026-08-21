import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../theme/app_theme.dart';
import '../providers/auth_provider.dart';
import '../services/api_service.dart';
import '../utils/external_link.dart';
import 'login_screen.dart';
import 'edit_profile_screen.dart';
import 'notifications_settings_screen.dart';
import 'language_preferences_screen.dart';
import 'microphone_settings_screen.dart';
import 'translation_settings_screen.dart';

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

  void _openEditProfile(BuildContext context) {
    Navigator.push(context, MaterialPageRoute(builder: (_) => const EditProfileScreen()));
  }

  @override
  Widget build(BuildContext context) {
    final user = context.watch<AuthProvider>().user;
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(title: const Text('Settings')),
      body: SingleChildScrollView(
        child: Column(
          children: [
            _profileCard(context, user),
            const SizedBox(height: 8),
            _section('Account', [
              _tile(Icons.person_outline, 'Profile', () => _openEditProfile(context)),
              _tile(Icons.notifications_outlined, 'Notifications', () => Navigator.push(context, MaterialPageRoute(builder: (_) => const NotificationsSettingsScreen()))),
              _tile(Icons.language_outlined, 'Language Preferences', () => Navigator.push(context, MaterialPageRoute(builder: (_) => const LanguagePreferencesScreen()))),
            ]),
            const SizedBox(height: 8),
            _section('Calls', [
              _tile(Icons.mic_outlined, 'Microphone Settings', () => Navigator.push(context, MaterialPageRoute(builder: (_) => const MicrophoneSettingsScreen()))),
              _tile(Icons.translate_outlined, 'Translation Settings', () => Navigator.push(context, MaterialPageRoute(builder: (_) => const TranslationSettingsScreen()))),
              _tile(Icons.record_voice_over_outlined, 'Voice Clone', () => _openWebPage(context, '/settings/voice-clone')),
            ]),
            const SizedBox(height: 8),
            _section('Privacy & Legal', [
              _tile(Icons.privacy_tip_outlined, 'Privacy Policy', () => _openWebPage(context, '/privacy')),
              _tile(Icons.description_outlined, 'Terms of Service', () => _openWebPage(context, '/terms')),
              _tile(Icons.security_outlined, 'Data & Privacy', () => _openWebPage(context, '/data-retention')),
            ]),
            const SizedBox(height: 8),
            _section('Support', [
              _tile(Icons.help_outline, 'Help Center', () => _openWebPage(context, '/help')),
              _tile(Icons.mail_outline, 'Contact Support', () => _openWebPage(context, '/contact')),
              _tile(Icons.info_outline, 'About NeuraTalk', () => _openWebPage(context, '/about')),
            ]),
            const SizedBox(height: 24),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16),
              child: SizedBox(
                width: double.infinity,
                child: OutlinedButton.icon(
                  onPressed: () => _logout(context),
                  icon: const Icon(Icons.logout, color: AppColors.red),
                  label: const Text('Logout', style: TextStyle(color: AppColors.red, fontWeight: FontWeight.w700, fontSize: 16)),
                  style: OutlinedButton.styleFrom(
                    side: const BorderSide(color: AppColors.red),
                    padding: const EdgeInsets.symmetric(vertical: 16),
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
                  ),
                ),
              ),
            ),
            const SizedBox(height: 32),
            const Text('NeuraTalk v2.0.0', style: TextStyle(color: AppColors.textMuted, fontSize: 12)),
            const SizedBox(height: 8),
            const Text('neuratalk.in', style: TextStyle(color: AppColors.textMuted, fontSize: 12)),
            const SizedBox(height: 32),
          ],
        ),
      ),
    );
  }

  Widget _profileCard(BuildContext context, Map<String, dynamic>? user) {
    final avatarUrl = user?['avatarUrl'] as String?;
    return InkWell(
      onTap: () => _openEditProfile(context),
      borderRadius: BorderRadius.circular(20),
      child: Container(
      margin: const EdgeInsets.all(16),
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: AppColors.border),
      ),
      child: Row(
        children: [
          CircleAvatar(
            radius: 28,
            backgroundColor: AppColors.cyan.withOpacity(0.15),
            backgroundImage: avatarUrl != null
                ? NetworkImage('${ApiService.baseUrl}$avatarUrl')
                : null,
            child: avatarUrl == null
                ? const Icon(Icons.person, color: AppColors.cyan, size: 28)
                : null,
          ),
          const SizedBox(width: 16),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(user?['username'] ?? 'User', style: const TextStyle(color: AppColors.white, fontSize: 18, fontWeight: FontWeight.w700)),
                const SizedBox(height: 2),
                Text(user?['phone'] ?? user?['email'] ?? '', style: const TextStyle(color: AppColors.textMuted, fontSize: 13)),
                const SizedBox(height: 4),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                  decoration: BoxDecoration(color: AppColors.cyan.withOpacity(0.12), borderRadius: BorderRadius.circular(8)),
                  child: Text(user?['role'] ?? 'user', style: const TextStyle(color: AppColors.cyan, fontSize: 11, fontWeight: FontWeight.w600)),
                ),
              ],
            ),
          ),
          const Icon(Icons.chevron_right, color: AppColors.textMuted),
        ],
      ),
      ),
    );
  }

  Widget _section(String title, List<Widget> tiles) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 16, 16, 8),
          child: Text(title, style: const TextStyle(color: AppColors.textMuted, fontSize: 12, fontWeight: FontWeight.w600, letterSpacing: 0.8)),
        ),
        Container(
          color: AppColors.surface,
          child: Column(children: tiles),
        ),
      ],
    );
  }

  Widget _tile(IconData icon, String title, VoidCallback onTap) {
    return ListTile(
      leading: Icon(icon, color: AppColors.textSecondary, size: 22),
      title: Text(title, style: const TextStyle(color: AppColors.textPrimary, fontSize: 15)),
      trailing: const Icon(Icons.chevron_right, color: AppColors.textMuted, size: 18),
      onTap: onTap,
    );
  }

  void _logout(BuildContext context) async {
    await context.read<AuthProvider>().logout();
    if (!context.mounted) return;
    Navigator.pushAndRemoveUntil(context, MaterialPageRoute(builder: (_) => const LoginScreen()), (_) => false);
  }
}
