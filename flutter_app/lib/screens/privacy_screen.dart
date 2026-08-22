import 'package:flutter/material.dart';
import '../theme/app_theme.dart';
import 'blocked_contacts_screen.dart';

/// Real privacy hub -- currently just the one control that's actually
/// implemented (blocking, server/blocking.ts). Deliberately doesn't show
/// last-seen/read-receipts/who-can-call toggles: none of those exist in the
/// backend schema yet, and a switch that doesn't persist anywhere is worse
/// than not offering it.
class PrivacyScreen extends StatelessWidget {
  const PrivacyScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(title: const Text('Privacy')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Container(
            decoration: BoxDecoration(color: AppColors.surface, borderRadius: BorderRadius.circular(14)),
            child: ListTile(
              leading: const Icon(Icons.block_outlined, color: AppColors.red),
              title: const Text('Blocked Contacts', style: TextStyle(color: AppColors.white, fontWeight: FontWeight.w600)),
              subtitle: const Text(
                "People you've blocked can't call or message you",
                style: TextStyle(color: AppColors.textMuted, fontSize: 12.5),
              ),
              trailing: const Icon(Icons.chevron_right, color: AppColors.textMuted),
              onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => const BlockedContactsScreen())),
            ),
          ),
          const SizedBox(height: 20),
          const Padding(
            padding: EdgeInsets.symmetric(horizontal: 4),
            child: Text(
              'More privacy controls -- like last-seen visibility and read receipts -- are on the way.',
              style: TextStyle(color: AppColors.textMuted, fontSize: 12.5, height: 1.5),
            ),
          ),
        ],
      ),
    );
  }
}
