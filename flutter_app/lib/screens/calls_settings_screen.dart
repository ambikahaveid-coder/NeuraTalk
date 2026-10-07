import 'package:flutter/material.dart';
import '../theme/app_theme.dart';
import '../widgets/nt_ui.dart';
import 'microphone_settings_screen.dart';

/// Calls hub. Audio processing and call waiting are always on
/// (call_screen.dart / smart-router.ts), so they're shown as information,
/// not as switches that wouldn't change anything.
class CallsSettingsScreen extends StatelessWidget {
  const CallsSettingsScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(title: const Text('Calls')),
      body: ListView(
        padding: const EdgeInsets.all(NtSpace.l),
        children: [
          NtCard(
            child: ListTile(
              contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
              leading: Icon(Icons.mic_outlined, color: AppColors.cyan),
              title: Text('Microphone', style: TextStyle(color: AppColors.ink, fontWeight: FontWeight.w600, fontSize: 16)),
              subtitle: Text('Check or allow microphone access', style: TextStyle(color: AppColors.textSecondary, fontSize: 14)),
              trailing: Icon(Icons.chevron_right, color: AppColors.textMuted),
              onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => const MicrophoneSettingsScreen())),
            ),
          ),
          const NtSectionHeader('Always on', inset: true),
          const NtInfoCard(
            icon: Icons.graphic_eq,
            title: 'Clear audio',
            body: 'Echo cancellation, noise suppression and automatic volume are on for every call. Nothing to set up.',
          ),
          const SizedBox(height: NtSpace.m),
          const NtInfoCard(
            icon: Icons.translate,
            title: 'Live translation',
            body: 'Each person hears the other in their own language. You can change yours during a call with the Language button.',
          ),
          const SizedBox(height: NtSpace.m),
          const NtInfoCard(
            icon: Icons.call_split,
            title: 'Call waiting',
            body: "If someone calls while you're on a call, you can end the current call and answer, or decline the new one.",
          ),
        ],
      ),
    );
  }
}
