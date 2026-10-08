import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../theme/app_theme.dart';
import '../widgets/nt_ui.dart';
import '../providers/auth_provider.dart';
import '../services/api_service.dart';
import '../utils/languages.dart';

/// "Choose Your Language". Saves PATCH /api/auth/me { preferredLanguage } — the language
/// chats and calls are translated into for this user.
///
/// Shown once right after the first login ([firstRun]) and from Profile → Languages.
class LanguagePreferencesScreen extends StatefulWidget {
  final bool firstRun;
  const LanguagePreferencesScreen({super.key, this.firstRun = false});

  static const _chosenKey = 'language_chosen_v1';

  /// True when this device hasn't shown the first-run language step yet.
  static Future<bool> needsFirstRunChoice() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      return !(prefs.getBool(_chosenKey) ?? false);
    } catch (_) {
      return false;
    }
  }

  static Future<void> _markChosen() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setBool(_chosenKey, true);
    } catch (_) {}
  }

  @override
  State<LanguagePreferencesScreen> createState() => _LanguagePreferencesScreenState();
}

class _LanguagePreferencesScreenState extends State<LanguagePreferencesScreen> {
  List<String> _codes = [];
  bool _loading = true;
  bool _saving = false;
  String _query = '';
  String? _selected;

  @override
  void initState() {
    super.initState();
    _selected = context.read<AuthProvider>().user?['preferredLanguage']?.toString();
    _load();
  }

  Future<void> _load() async {
    try {
      final res = await ApiService.get('/api/group-chats/languages') as List;
      _codes = res.map((l) => (l as Map)['code'].toString()).toList();
    } catch (_) {
      // Fall back to the built-in list so the step never blocks the user.
      _codes = const ['en', 'hi', 'te', 'ta', 'kn', 'ml', 'mr', 'bn', 'gu', 'pa', 'ur', 'es', 'fr', 'de', 'ar', 'ja', 'ko', 'zh', 'pt', 'ru'];
    }
    if (mounted) setState(() => _loading = false);
  }

  Future<void> _continue() async {
    final code = _selected;
    if (code == null) return;
    setState(() => _saving = true);
    try {
      await ApiService.patch('/api/auth/me', {'preferredLanguage': code});
      if (!mounted) return;
      await context.read<AuthProvider>().fetchProfile();
      await LanguagePreferencesScreen._markChosen();
      // pop(), not maybePop(): on first run this screen blocks the back button
      // (PopScope canPop: false), which also blocks maybePop().
      if (mounted) Navigator.of(context).pop();
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Could not save your language. Please try again.')));
      }
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final q = _query.trim().toLowerCase();
    final visible = _codes.map(Languages.of).where((l) {
      return q.isEmpty || l.name.toLowerCase().contains(q) || l.native.toLowerCase().contains(q);
    }).toList();

    return PopScope(
      canPop: !widget.firstRun,
      child: Scaffold(
        backgroundColor: AppColors.background,
        appBar: AppBar(automaticallyImplyLeading: !widget.firstRun, toolbarHeight: widget.firstRun ? 24 : null),
        body: SafeArea(
          top: false,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Padding(
                padding: EdgeInsets.fromLTRB(24, 4, 24, 0),
                child: Text('Choose Your\nLanguage',
                    style: TextStyle(color: AppColors.ink, fontSize: 32, fontWeight: FontWeight.w800, height: 1.15, letterSpacing: -0.5)),
              ),
              Padding(
                padding: EdgeInsets.fromLTRB(24, 10, 24, 16),
                child: Text('Pick the language you want to read and hear. What you say is detected automatically, even when you mix languages.',
                    style: TextStyle(color: AppColors.textSecondary, fontSize: 15, height: 1.45)),
              ),
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 24),
                child: TextField(
                  onChanged: (v) => setState(() => _query = v),
                  decoration: InputDecoration(
                    prefixIcon: Icon(Icons.search, color: AppColors.textMuted),
                    isDense: true,
                    contentPadding: NtSearch.padding,
                    prefixIconConstraints: NtSearch.iconBox,
                    border: NtSearch.border(AppColors.border),
                    enabledBorder: NtSearch.border(AppColors.border),
                    focusedBorder: NtSearch.border(AppColors.cyan, 1.5),
                    hintText: 'Search languages...',
                  ),
                ),
              ),
              const SizedBox(height: 8),
              Expanded(
                child: _loading
                    ? Center(child: CircularProgressIndicator(color: AppColors.cyan))
                    : visible.isEmpty
                        ? Center(child: Text('No language matches your search', style: TextStyle(color: AppColors.textMuted)))
                        : ListView.separated(
                            padding: const EdgeInsets.fromLTRB(16, 4, 16, 16),
                            itemCount: visible.length,
                            separatorBuilder: (_, __) => const Divider(height: 1, indent: 72, endIndent: 8),
                            itemBuilder: (_, i) => _tile(visible[i]),
                          ),
              ),
              Padding(
                padding: const EdgeInsets.fromLTRB(24, 8, 24, 20),
                child: ElevatedButton(
                  onPressed: _selected == null || _saving ? null : _continue,
                  child: _saving
                      ? const SizedBox(width: 22, height: 22, child: CircularProgressIndicator(strokeWidth: 2.5, color: AppColors.onAccent))
                      : Text(widget.firstRun ? 'Continue' : 'Save'),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _tile(LanguageInfo lang) {
    final selected = lang.code == _selected;
    return InkWell(
      borderRadius: BorderRadius.circular(14),
      onTap: () => setState(() => _selected = lang.code),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 12),
        decoration: BoxDecoration(
          color: selected ? AppColors.blueTint : null,
          borderRadius: BorderRadius.circular(14),
        ),
        child: Row(
          children: [
            Container(
              width: 44,
              height: 44,
              alignment: Alignment.center,
              decoration: BoxDecoration(color: AppColors.surfaceElevated, shape: BoxShape.circle, border: Border.all(color: AppColors.border)),
              child: Text(lang.flag, style: const TextStyle(fontSize: 22)),
            ),
            const SizedBox(width: 16),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(lang.name, style: TextStyle(color: AppColors.ink, fontSize: 16, fontWeight: FontWeight.w600)),
                  if (lang.native != lang.name)
                    Text(lang.native, style: TextStyle(color: AppColors.textSecondary, fontSize: 14)),
                ],
              ),
            ),
            if (selected) ...[
              Text('Selected', style: TextStyle(color: AppColors.cyan, fontSize: 13, fontWeight: FontWeight.w600)),
              const SizedBox(width: 8),
              Icon(Icons.check_circle, color: AppColors.cyan, size: 24),
            ] else
              Icon(Icons.radio_button_unchecked, color: AppColors.borderBright, size: 24),
          ],
        ),
      ),
    );
  }
}
