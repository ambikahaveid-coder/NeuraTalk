import 'package:flutter/material.dart';
import '../services/api_service.dart';
import '../theme/app_theme.dart';
import '../utils/languages.dart';
import '../utils/phone_format.dart';
import '../widgets/chat_attachments.dart';
import '../widgets/nt_ui.dart';

/// What the person picked on the contact page; the chat screen carries it out
/// (it already owns calling, blocking, reporting and disappearing messages).
enum ContactInfoAction { call, video, disappearing, block, report }

/// The other person in a 1:1 chat: photo, name, number, language, the
/// chat's shared photos/videos/files, and the chat's settings.
class ContactInfoScreen extends StatefulWidget {
  final int threadId;
  final String name;
  final String? phone;
  final String? avatarUrl;
  final String? language;
  final String presence;
  final bool muted;
  final bool blockedByMe;
  final int? disappearingSeconds;
  final List<Map<String, dynamic>> messages;

  const ContactInfoScreen({
    super.key,
    required this.threadId,
    required this.name,
    required this.phone,
    required this.avatarUrl,
    required this.language,
    required this.presence,
    required this.muted,
    required this.blockedByMe,
    required this.disappearingSeconds,
    required this.messages,
  });

  @override
  State<ContactInfoScreen> createState() => _ContactInfoScreenState();
}

class _ContactInfoScreenState extends State<ContactInfoScreen> {
  late bool _muted = widget.muted;
  bool _savingMute = false;

  Future<void> _toggleMute(bool next) async {
    setState(() {
      _muted = next;
      _savingMute = true;
    });
    try {
      await ApiService.patch('/api/personal-chats/${widget.threadId}/state', {'muted': next});
    } catch (_) {
      if (mounted) {
        setState(() => _muted = !next);
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Could not change notifications.')));
      }
    } finally {
      if (mounted) setState(() => _savingMute = false);
    }
  }

  static String _disappearingLabel(int? seconds) {
    switch (seconds) {
      case 86400:
        return '24 hours';
      case 604800:
        return '7 days';
      case 7776000:
        return '90 days';
      default:
        return 'Off';
    }
  }

  @override
  Widget build(BuildContext context) {
    final media = widget.messages.where((m) {
      final type = m['messageType']?.toString();
      return m['isDeleted'] != true && m['attachmentUrl'] != null && (type == 'attachment' || type == 'file');
    }).toList().reversed.toList();
    final phone = widget.phone == null ? null : prettyPhone(widget.phone);

    Widget action(IconData icon, String label, ContactInfoAction a) => Expanded(
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 6),
            child: OutlinedButton(
              onPressed: () => Navigator.pop(context, a),
              style: OutlinedButton.styleFrom(
                padding: const EdgeInsets.symmetric(vertical: 12),
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
                side: BorderSide(color: AppColors.border),
              ),
              child: Column(children: [
                Icon(icon, color: AppColors.cyan),
                const SizedBox(height: 4),
                Text(label, style: TextStyle(color: AppColors.ink, fontWeight: FontWeight.w600)),
              ]),
            ),
          ),
        );

    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(title: const Text('Contact info')),
      body: ListView(
        padding: const EdgeInsets.only(bottom: 32),
        children: [
          const SizedBox(height: 8),
          Center(child: NtAvatar(name: widget.name, avatarUrl: widget.avatarUrl, size: 112, openOnTap: widget.avatarUrl != null)),
          const SizedBox(height: 12),
          Text(widget.name, textAlign: TextAlign.center, style: TextStyle(color: AppColors.ink, fontSize: 24, fontWeight: FontWeight.w800)),
          if (phone != null && phone.isNotEmpty && phone != widget.name)
            Padding(
              padding: const EdgeInsets.only(top: 4),
              child: Text(phone, textAlign: TextAlign.center, style: TextStyle(color: AppColors.textSecondary, fontSize: 16)),
            ),
          if (widget.presence.isNotEmpty)
            Padding(
              padding: const EdgeInsets.only(top: 2),
              child: Text(widget.presence, textAlign: TextAlign.center, style: TextStyle(color: AppColors.textMuted, fontSize: 13)),
            ),
          const SizedBox(height: 16),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16),
            child: Row(children: [
              action(Icons.call_outlined, 'Voice', ContactInfoAction.call),
              action(Icons.videocam_outlined, 'Video', ContactInfoAction.video),
            ]),
          ),
          if (widget.language != null)
            ListTile(
              leading: Icon(Icons.translate, color: AppColors.cyan),
              title: Text('Reads and hears ${Languages.name(widget.language)}', style: TextStyle(color: AppColors.ink)),
              subtitle: Text('Your messages and calls reach them in this language', style: TextStyle(color: AppColors.textSecondary)),
            ),
          const Divider(height: 24),
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
            child: Row(children: [
              Expanded(child: Text('Media and files', style: TextStyle(color: AppColors.ink, fontWeight: FontWeight.w700))),
              Text('${media.length}', style: TextStyle(color: AppColors.textSecondary)),
            ]),
          ),
          if (media.isEmpty)
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
              child: Text('Photos, videos and files you share will appear here.', style: TextStyle(color: AppColors.textMuted)),
            )
          else
            SizedBox(
              height: 112,
              child: ListView.separated(
                scrollDirection: Axis.horizontal,
                padding: const EdgeInsets.symmetric(horizontal: 16),
                itemCount: media.length,
                separatorBuilder: (_, __) => const SizedBox(width: 8),
                itemBuilder: (_, i) {
                  final m = media[i];
                  final url = m['attachmentUrl'].toString();
                  final title = m['attachmentTitle']?.toString() ?? 'file';
                  return ClipRRect(
                    borderRadius: BorderRadius.circular(12),
                    child: SizedBox(
                      width: 112,
                      child: m['messageType'] == 'attachment'
                          ? ChatImageAttachment(objectPath: url, name: title)
                          : ChatFileAttachment(objectPath: url, name: title, size: (m['attachmentSize'] as num?)?.toInt(), mime: m['attachmentMime']?.toString()),
                    ),
                  );
                },
              ),
            ),
          const Divider(height: 32),
          SwitchListTile(
            secondary: Icon(Icons.notifications_off_outlined, color: AppColors.cyan),
            title: Text('Mute notifications', style: TextStyle(color: AppColors.ink)),
            value: _muted,
            onChanged: _savingMute ? null : _toggleMute,
          ),
          ListTile(
            leading: Icon(Icons.timer_outlined, color: AppColors.cyan),
            title: Text('Disappearing messages', style: TextStyle(color: AppColors.ink)),
            subtitle: Text(_disappearingLabel(widget.disappearingSeconds), style: TextStyle(color: AppColors.textSecondary)),
            trailing: const Icon(Icons.chevron_right),
            onTap: () => Navigator.pop(context, ContactInfoAction.disappearing),
          ),
          const Divider(height: 24),
          ListTile(
            leading: Icon(Icons.block, color: widget.blockedByMe ? AppColors.ink : AppColors.red),
            title: Text(widget.blockedByMe ? 'Unblock ${widget.name}' : 'Block ${widget.name}',
                style: TextStyle(color: widget.blockedByMe ? AppColors.ink : AppColors.red)),
            onTap: () => Navigator.pop(context, ContactInfoAction.block),
          ),
          ListTile(
            leading: const Icon(Icons.flag_outlined, color: AppColors.red),
            title: Text('Report ${widget.name}', style: const TextStyle(color: AppColors.red)),
            onTap: () => Navigator.pop(context, ContactInfoAction.report),
          ),
        ],
      ),
    );
  }
}
