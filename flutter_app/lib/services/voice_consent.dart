import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../theme/app_theme.dart';
import 'api_service.dart';

/// "Speak my translations in my own voice": a one-time permission that lets
/// NeuraTalk learn the caller's voice from their own call speech
/// (server/voice-learning.ts). Asked once, on the first call; can be changed
/// any time on the "Your voice" screen.
class VoiceConsent {
  // v2: asked again once, at app open, for people first asked mid-call (all said "Not now").
  static const _askedKey = 'voice_learning_asked_v2';
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
        title: Text('Talk in your own voice, in every language', style: TextStyle(color: AppColors.ink)),
        content: Text(
          'When you call someone who speaks another language, they hear your words in their language — in your own voice, never a robot.\n\n'
          'Nothing to record: NeuraTalk learns your voice from the first few seconds you talk in a call. The audio itself is not kept. '
          'Change this any time in Settings → Your voice.',
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
