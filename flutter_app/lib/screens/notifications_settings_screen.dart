import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../theme/app_theme.dart';
import '../providers/auth_provider.dart';
import '../services/api_service.dart';
import '../widgets/nt_ui.dart';

/// PATCH /api/auth/me { pushNotificationsEnabled }. Gates message pushes in
/// server/firebase-admin.ts:sendPushNotification; call alerts always ring.
class NotificationsSettingsScreen extends StatefulWidget {
  const NotificationsSettingsScreen({super.key});

  @override
  State<NotificationsSettingsScreen> createState() => _NotificationsSettingsScreenState();
}

class _NotificationsSettingsScreenState extends State<NotificationsSettingsScreen> {
  bool _saving = false;

  Future<void> _toggle(bool value) async {
    setState(() => _saving = true);
    try {
      await ApiService.patch('/api/auth/me', {'pushNotificationsEnabled': value});
      if (mounted) await context.read<AuthProvider>().fetchProfile();
    } catch (_) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text("Couldn't save. Check your connection and try again.")));
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final user = context.watch<AuthProvider>().user;
    final enabled = user?['pushNotificationsEnabled'] != false;

    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(title: const Text('Notifications')),
      body: ListView(
        padding: const EdgeInsets.all(NtSpace.l),
        children: [
          NtCard(
            child: SwitchListTile(
              contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
              value: enabled,
              onChanged: _saving ? null : _toggle,
              secondary: Icon(Icons.chat_bubble_outline, color: AppColors.cyan),
              title: Text('Message notifications', style: TextStyle(color: AppColors.ink, fontWeight: FontWeight.w600, fontSize: 16)),
              subtitle: Text('New chat and group messages when the app is closed',
                  style: TextStyle(color: AppColors.textSecondary, fontSize: 14)),
            ),
          ),
          const SizedBox(height: NtSpace.m),
          const NtInfoCard(
            icon: Icons.ring_volume_outlined,
            title: 'Calls always ring',
            body: 'So you never miss a call, incoming calls ring even when message notifications are off.',
          ),
        ],
      ),
    );
  }
}
