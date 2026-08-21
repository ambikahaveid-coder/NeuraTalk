import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../theme/app_theme.dart';
import '../providers/auth_provider.dart';
import 'language_preferences_screen.dart';

/// Explains the real translation behavior rather than exposing a fake
/// on/off toggle -- translation in chats and calls is always automatic,
/// driven per-conversation by each participant's own language.
class TranslationSettingsScreen extends StatelessWidget {
  const TranslationSettingsScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final preferredLanguage = context.watch<AuthProvider>().user?['preferredLanguage']?.toString() ?? 'en';

    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(title: const Text('Translation Settings')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          const Text(
            'NeuraTalk automatically translates chat messages and call audio between you and the other person, based on each person\'s own language — there\'s nothing to turn on or off.',
            style: TextStyle(color: AppColors.textSecondary, fontSize: 13, height: 1.5),
          ),
          const SizedBox(height: 20),
          Container(
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(color: AppColors.surface, borderRadius: BorderRadius.circular(14)),
            child: Row(
              children: [
                const Icon(Icons.translate, color: AppColors.cyan),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Text('Your language', style: TextStyle(color: AppColors.white, fontWeight: FontWeight.w600)),
                      Text(preferredLanguage.toUpperCase(), style: const TextStyle(color: AppColors.textMuted, fontSize: 12)),
                    ],
                  ),
                ),
                TextButton(
                  onPressed: () => Navigator.push(context, MaterialPageRoute(builder: (_) => const LanguagePreferencesScreen())),
                  child: const Text('Change', style: TextStyle(color: AppColors.cyan)),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
