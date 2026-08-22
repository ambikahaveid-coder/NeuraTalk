import 'package:flutter/material.dart';
import '../theme/app_theme.dart';
import 'microphone_settings_screen.dart';

/// Real calls hub. The audio-processing and call-waiting behavior described
/// here are always-on (call_screen.dart / smart-router.ts) -- shown as
/// status info rather than toggles, since there's no per-user override for
/// them and a switch that always does the same thing either way isn't a
/// real setting.
class CallsSettingsScreen extends StatelessWidget {
  const CallsSettingsScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(title: const Text('Calls & Calling')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Container(
            decoration: BoxDecoration(color: AppColors.surface, borderRadius: BorderRadius.circular(14)),
            child: ListTile(
              leading: const Icon(Icons.mic_outlined, color: AppColors.cyan),
              title: const Text('Microphone', style: TextStyle(color: AppColors.white, fontWeight: FontWeight.w600)),
              subtitle: const Text('Permission status and access', style: TextStyle(color: AppColors.textMuted, fontSize: 12.5)),
              trailing: const Icon(Icons.chevron_right, color: AppColors.textMuted),
              onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => const MicrophoneSettingsScreen())),
            ),
          ),
          const SizedBox(height: 16),
          _statusCard(
            icon: Icons.graphic_eq,
            title: 'Audio processing',
            body: 'Echo cancellation, noise suppression, and automatic volume leveling are on for every call -- there\'s nothing to configure.',
          ),
          const SizedBox(height: 12),
          _statusCard(
            icon: Icons.call_split,
            title: 'Call waiting',
            body: "If you're already on a call and someone else calls you, you'll get a prompt to end your current call and accept, or reject the new one.",
          ),
        ],
      ),
    );
  }

  Widget _statusCard({required IconData icon, required String title, required String body}) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(color: AppColors.surface, borderRadius: BorderRadius.circular(14)),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(icon, color: AppColors.textSecondary, size: 22),
          const SizedBox(width: 14),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(title, style: const TextStyle(color: AppColors.white, fontWeight: FontWeight.w600, fontSize: 14)),
                const SizedBox(height: 4),
                Text(body, style: const TextStyle(color: AppColors.textMuted, fontSize: 12.5, height: 1.4)),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
