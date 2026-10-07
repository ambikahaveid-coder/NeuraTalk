import 'package:flutter/material.dart';
import '../theme/app_theme.dart';
import '../widgets/nt_ui.dart';
import 'blocked_contacts_screen.dart';

/// Privacy hub. Only shows controls the backend actually enforces
/// (blocking, server/blocking.ts); no switches that don't persist.
class PrivacyScreen extends StatelessWidget {
  const PrivacyScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(title: const Text('Privacy')),
      body: ListView(
        padding: const EdgeInsets.all(NtSpace.l),
        children: [
          NtCard(
            child: ListTile(
              contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
              leading: Icon(Icons.block_outlined, color: AppColors.red),
              title: Text('Blocked contacts', style: TextStyle(color: AppColors.ink, fontWeight: FontWeight.w600, fontSize: 16)),
              subtitle: Text("People you block can't call or message you", style: TextStyle(color: AppColors.textSecondary, fontSize: 14)),
              trailing: Icon(Icons.chevron_right, color: AppColors.textMuted),
              onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => const BlockedContactsScreen())),
            ),
          ),
          const NtSectionHeader('Your data', inset: true),
          const NtInfoCard(
            icon: Icons.lock_outline,
            title: 'Encrypted in transit',
            body: 'Calls, messages and files travel over encrypted connections.',
          ),
          const SizedBox(height: NtSpace.m),
          const NtInfoCard(
            icon: Icons.folder_shared_outlined,
            title: 'Files stay in the conversation',
            body: 'Photos, videos and documents you send can only be opened by the people in that chat or group.',
          ),
        ],
      ),
    );
  }
}
