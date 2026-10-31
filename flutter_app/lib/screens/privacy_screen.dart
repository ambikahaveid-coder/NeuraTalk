import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:path_provider/path_provider.dart';
import 'package:provider/provider.dart';
import 'package:share_plus/share_plus.dart';
import 'package:url_launcher/url_launcher.dart';

import '../providers/auth_provider.dart';
import '../services/api_service.dart';
import '../theme/app_theme.dart';
import '../widgets/nt_ui.dart';
import 'blocked_contacts_screen.dart';
import '../widgets/chat_extras.dart';

/// Privacy hub. Only shows controls the backend actually enforces
/// (blocking, data export, account deletion); no switches that don't persist.
class PrivacyScreen extends StatefulWidget {
  const PrivacyScreen({super.key});

  @override
  State<PrivacyScreen> createState() => _PrivacyScreenState();
}

class _PrivacyScreenState extends State<PrivacyScreen> {
  bool _exporting = false;

  Future<void> _downloadData() async {
    setState(() => _exporting = true);
    try {
      final data = await ApiService.get('/api/gdpr/export');
      final dir = await getTemporaryDirectory();
      final file = File('${dir.path}/neuratalk-my-data-${DateTime.now().millisecondsSinceEpoch}.json');
      await file.writeAsString(const JsonEncoder.withIndent('  ').convert(data));
      await Share.shareXFiles([XFile(file.path, mimeType: 'application/json')], subject: 'My NeuraTalk data');
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e is ApiException ? e.message : 'Could not prepare your data. Try again.')));
      }
    } finally {
      if (mounted) setState(() => _exporting = false);
    }
  }

  Future<void> _deleteAccount() async {
    final typed = TextEditingController();
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialog) => StatefulBuilder(
        builder: (dialog, setDialog) => AlertDialog(
          title: const Text('Delete your account?'),
          content: SingleChildScrollView(
            child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
              const Text(
                'This permanently removes your number, name, photo and your cloned voice, signs you out everywhere, '
                'and businesses can no longer message you. Remaining minutes are lost.\n\n'
                'Messages you already sent stay with the people who received them.\n\n'
                'Type DELETE to confirm.',
              ),
              const SizedBox(height: 12),
              TextField(
                controller: typed,
                autofocus: true,
                textCapitalization: TextCapitalization.characters,
                onChanged: (_) => setDialog(() {}),
                decoration: const InputDecoration(hintText: 'DELETE'),
              ),
            ]),
          ),
          actions: [
            TextButton(onPressed: () => Navigator.pop(dialog, false), child: const Text('Cancel')),
            TextButton(
              onPressed: typed.text.trim() == 'DELETE' ? () => Navigator.pop(dialog, true) : null,
              child: Text('Delete account', style: TextStyle(color: typed.text.trim() == 'DELETE' ? AppColors.red : AppColors.textMuted)),
            ),
          ],
        ),
      ),
    );
    typed.dispose();
    if (confirmed != true || !mounted) return;
    final auth = context.read<AuthProvider>();
    try {
      await ApiService.post('/api/account/delete', {'confirm': 'DELETE'});
      await auth.logout();
      if (mounted) Navigator.of(context).popUntil((r) => r.isFirst);
    } catch (e) {
      if (mounted) {
        showDialog(
          context: context,
          builder: (d) => AlertDialog(
            title: const Text("Account not deleted"),
            content: Text(e is ApiException ? e.message : 'Something went wrong. Try again, or write to support@mindwhile.com.'),
            actions: [TextButton(onPressed: () => Navigator.pop(d), child: const Text('OK'))],
          ),
        );
      }
    }
  }

  Widget _tile({required IconData icon, required String title, required String subtitle, Color? color, VoidCallback? onTap, Widget? trailing}) {
    return NtCard(
      child: ListTile(
        contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
        leading: Icon(icon, color: color ?? AppColors.cyan),
        title: Text(title, style: TextStyle(color: color ?? AppColors.ink, fontWeight: FontWeight.w600, fontSize: 16)),
        subtitle: Text(subtitle, style: TextStyle(color: AppColors.textSecondary, fontSize: 14)),
        trailing: trailing ?? Icon(Icons.chevron_right, color: AppColors.textMuted),
        onTap: onTap,
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(title: const Text('Privacy')),
      body: ListView(
        padding: const EdgeInsets.all(NtSpace.l),
        children: [
          const NtSectionHeader('Who can see', inset: true),
          const NtCard(child: PrivacyToggles()),
          const SizedBox(height: NtSpace.m),
          _tile(
            icon: Icons.block_outlined,
            color: AppColors.red,
            title: 'Blocked contacts',
            subtitle: "People you block can't call or message you",
            onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => const BlockedContactsScreen())),
          ),
          const NtSectionHeader('What NeuraTalk keeps', inset: true),
          const NtInfoCard(
            icon: Icons.lock_outline,
            title: 'Encrypted in transit',
            body: 'Calls, messages and files travel over encrypted connections.',
          ),
          const SizedBox(height: NtSpace.m),
          const NtInfoCard(
            icon: Icons.mic_off_outlined,
            title: 'Call audio is never recorded',
            body: 'The translated text of a call stays in your call history for 30 days, then it is deleted.',
          ),
          const SizedBox(height: NtSpace.m),
          const NtInfoCard(
            icon: Icons.folder_shared_outlined,
            title: 'Files stay in the conversation',
            body: 'Photos, videos and documents you send can only be opened by the people in that chat or group.',
          ),
          const NtSectionHeader('Your data', inset: true),
          _tile(
            icon: Icons.download_outlined,
            title: 'Download my data',
            subtitle: 'Your profile, messages you sent, voice settings and plans, as a file',
            onTap: _exporting ? null : _downloadData,
            trailing: _exporting ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2)) : null,
          ),
          const SizedBox(height: NtSpace.m),
          _tile(
            icon: Icons.policy_outlined,
            title: 'Privacy Policy',
            subtitle: 'How we use and protect your data',
            onTap: () => launchUrl(Uri.parse('https://neuratalk.in/privacy'), mode: LaunchMode.externalApplication),
          ),
          const SizedBox(height: NtSpace.m),
          _tile(
            icon: Icons.delete_forever_outlined,
            color: AppColors.red,
            title: 'Delete my account',
            subtitle: 'Permanently remove your account and voice',
            onTap: _deleteAccount,
          ),
        ],
      ),
    );
  }
}
