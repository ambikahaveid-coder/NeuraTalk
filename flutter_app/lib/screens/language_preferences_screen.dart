import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../theme/app_theme.dart';
import '../providers/auth_provider.dart';
import '../services/api_service.dart';

/// Real preference -- PATCH /api/auth/me { preferredLanguage }. Used as the
/// default target language for new chats/calls where one wasn't already set
/// per-conversation.
class LanguagePreferencesScreen extends StatefulWidget {
  const LanguagePreferencesScreen({super.key});

  @override
  State<LanguagePreferencesScreen> createState() => _LanguagePreferencesScreenState();
}

class _LanguagePreferencesScreenState extends State<LanguagePreferencesScreen> {
  List<Map<String, dynamic>> _languages = [];
  bool _loading = true;
  String? _saving;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final res = await ApiService.get('/api/group-chats/languages') as List;
      if (mounted) setState(() => _languages = res.cast<Map<String, dynamic>>());
    } catch (_) {
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _select(String code) async {
    setState(() => _saving = code);
    try {
      await ApiService.patch('/api/auth/me', {'preferredLanguage': code});
      if (mounted) await context.read<AuthProvider>().fetchProfile();
    } catch (_) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Could not update language.')));
    } finally {
      if (mounted) setState(() => _saving = null);
    }
  }

  @override
  Widget build(BuildContext context) {
    final current = context.watch<AuthProvider>().user?['preferredLanguage']?.toString() ?? 'en';

    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(title: const Text('Language Preferences')),
      body: _loading
          ? const Center(child: CircularProgressIndicator(color: AppColors.cyan))
          : ListView(
              children: [
                const Padding(
                  padding: EdgeInsets.fromLTRB(16, 16, 16, 8),
                  child: Text(
                    'Your default language for new chats and calls. You can still change it per-conversation.',
                    style: TextStyle(color: AppColors.textMuted, fontSize: 12),
                  ),
                ),
                ..._languages.map((lang) {
                  final code = lang['code'].toString();
                  final isSelected = code == current;
                  return ListTile(
                    title: Text(lang['name'].toString(), style: const TextStyle(color: AppColors.white)),
                    trailing: _saving == code
                        ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2, color: AppColors.cyan))
                        : (isSelected ? const Icon(Icons.check_circle, color: AppColors.cyan) : null),
                    onTap: _saving != null ? null : () => _select(code),
                  );
                }),
              ],
            ),
    );
  }
}
