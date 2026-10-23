import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../theme/app_theme.dart';
import 'api_service.dart';

/// "Speak my translations in my own voice": a one-time permission that lets
/// NeuraTalk learn the caller's voice from their own call speech
/// (server/voice-learning.ts). Asked once, on the first call; can be changed
/// any time on the "Your voice" screen.
class VoiceConsent {
  static const _askedKey = 'voice_learning_asked_v1';
  static const _path = '/api/voice-training/learning-consent';

  static Future<Map<String, dynamic>?> status() async {
    try {
      final res = await ApiService.get(_path);
      return res is Map<String, dynamic> ? res : null;
    } catch (_) {
      return null;
    }
  }

  static Future<bool> setAllowed(bool allow) async {
    try {
      await ApiService.put(_path, {'allow': allow});
      return true;
    } catch (_) {
      return false;
    }
  }

  /// Shows the question once, only to someone who has no voice of their own
  /// yet and hasn't allowed learning.
  static Future<void> askIfNeeded(BuildContext context) async {
    final prefs = await SharedPreferences.getInstance();
    if (prefs.getBool(_askedKey) == true) return;
    final current = await status();
    if (current == null) return; // offline: ask another time
    if (current['allowed'] == true || current['ownVoice'] != 'none') {
      await prefs.setBool(_askedKey, true);
      return;
    }
    if (!context.mounted) return;
    final allow = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        backgroundColor: AppColors.surface,
        title: Text('Speak in your own voice?', style: TextStyle(color: AppColors.ink)),
        content: Text(
          'When you talk with someone in another language, they hear your translated words in your own voice — not a robot.\n\n'
          'NeuraTalk learns your voice from the first half-minute you speak in a call. The recording itself is not kept. '
          'You can turn this off any time in Settings → Your voice.',
          style: TextStyle(color: AppColors.textSecondary, height: 1.4),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(dialogContext, false), child: const Text('Not now')),
          ElevatedButton(onPressed: () => Navigator.pop(dialogContext, true), child: const Text('Use my voice')),
        ],
      ),
    );
    await prefs.setBool(_askedKey, true);
    if (allow == true) await setAllowed(true);
  }
}
