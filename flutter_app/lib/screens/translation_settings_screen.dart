import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../theme/app_theme.dart';
import '../utils/languages.dart';
import '../providers/auth_provider.dart';
import '../services/api_service.dart';
import 'language_preferences_screen.dart';

/// Real settings -- PATCH /api/auth/me. `translationEnabled` gates both
/// server/personal-chat-routes.ts (chat translation) and
/// server/modules/calls/smart-router.ts (call translation) -- see the
/// comments at each of those call sites for exactly how the flag is used.
class TranslationSettingsScreen extends StatefulWidget {
  const TranslationSettingsScreen({super.key});

  @override
  State<TranslationSettingsScreen> createState() => _TranslationSettingsScreenState();
}

class _TranslationSettingsScreenState extends State<TranslationSettingsScreen> {
  bool _saving = false;

  Future<void> _toggleTranslation(bool value) async {
    setState(() => _saving = true);
    try {
      await ApiService.patch('/api/auth/me', {'translationEnabled': value});
      if (mounted) await context.read<AuthProvider>().fetchProfile();
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Could not update this setting.')),
        );
      }
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final user = context.watch<AuthProvider>().user;
    final preferredLanguage = user?['preferredLanguage']?.toString() ?? 'en';
    final translationEnabled = user?['translationEnabled'] != false;

    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(title: const Text('Translation Settings')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Text(
            'NeuraTalk translates chat messages and call audio between you and the other person automatically, based on each person\'s own language.',
            style: TextStyle(color: AppColors.textSecondary, fontSize: 15, height: 1.5),
          ),
          const SizedBox(height: 20),
          Container(
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(color: AppColors.surface, borderRadius: BorderRadius.circular(14), border: Border.all(color: AppColors.border)),
            child: Row(
              children: [
                Icon(Icons.translate, color: AppColors.cyan),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text('Your language', style: TextStyle(color: AppColors.ink, fontWeight: FontWeight.w600)),
                      Text(Languages.name(preferredLanguage), style: TextStyle(color: AppColors.textSecondary, fontSize: 14)),
                    ],
                  ),
                ),
                TextButton(
                  onPressed: () => Navigator.push(context, MaterialPageRoute(builder: (_) => const LanguagePreferencesScreen())),
                  child: Text('Change', style: TextStyle(color: AppColors.cyan)),
                ),
              ],
            ),
          ),
          const SizedBox(height: 12),
          Container(
            decoration: BoxDecoration(color: AppColors.surface, borderRadius: BorderRadius.circular(14), border: Border.all(color: AppColors.border)),
            child: SwitchListTile(
              value: translationEnabled,
              onChanged: _saving ? null : _toggleTranslation,
              title: Text('Auto-translate my chats and calls', style: TextStyle(color: AppColors.ink)),
              subtitle: Text(
                'When off, your messages stay in your own language and your calls run without live translation, even if the other person speaks a different language.',
                style: TextStyle(color: AppColors.textSecondary, fontSize: 14),
              ),
            ),
          ),
          const SizedBox(height: 16),
          Padding(
            padding: EdgeInsets.symmetric(horizontal: 4),
            child: Text(
              'The other person chooses their own language in their app. You hear and read your language, they hear and read theirs. For example, Telugu for you and English for them.',
              style: TextStyle(color: AppColors.textSecondary, fontSize: 14, height: 1.5),
            ),
          ),
        ],
      ),
    );
  }
}
