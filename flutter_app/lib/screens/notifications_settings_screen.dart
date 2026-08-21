import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../theme/app_theme.dart';
import '../providers/auth_provider.dart';
import '../services/api_service.dart';

/// Real toggle -- PATCH /api/auth/me { pushNotificationsEnabled }. Gates
/// server/firebase-admin.ts:sendPushNotification (message pushes only;
/// call alerts always ring regardless of this setting).
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
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Could not update this setting.')));
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
        children: [
          SwitchListTile(
            value: enabled,
            onChanged: _saving ? null : _toggle,
            activeColor: AppColors.cyan,
            title: const Text('Message notifications', style: TextStyle(color: AppColors.white)),
            subtitle: const Text(
              'Get notified about new chat messages when the app is closed or in the background.',
              style: TextStyle(color: AppColors.textMuted, fontSize: 12),
            ),
          ),
          const Padding(
            padding: EdgeInsets.fromLTRB(16, 8, 16, 0),
            child: Text(
              'Call notifications always ring, regardless of this setting.',
              style: TextStyle(color: AppColors.textMuted, fontSize: 12),
            ),
          ),
        ],
      ),
    );
  }
}
