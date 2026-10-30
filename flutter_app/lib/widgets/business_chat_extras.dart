import 'dart:async';

import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

import '../services/api_service.dart';
import '../theme/app_theme.dart';

/// The message a reply quotes, shown at the top of the reply bubble.
class QuotedMessage extends StatelessWidget {
  const QuotedMessage({super.key, required this.quoted, required this.fromLabel, this.onTap});
  final Map quoted;
  final String fromLabel;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final type = quoted['messageType']?.toString();
    final icon = switch (type) {
      'image' => Icons.photo_outlined,
      'video' => Icons.videocam_outlined,
      'document' => Icons.description_outlined,
      'voice' => Icons.mic_none,
      'location' => Icons.location_on_outlined,
      _ => null,
    };
    return GestureDetector(
      onTap: onTap,
      child: Container(
        margin: const EdgeInsets.only(bottom: 6),
        padding: const EdgeInsets.fromLTRB(8, 6, 8, 6),
        decoration: BoxDecoration(
          color: AppColors.ink.withValues(alpha: 0.06),
          borderRadius: BorderRadius.circular(8),
          border: Border(left: BorderSide(color: AppColors.cyan, width: 3)),
        ),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, mainAxisSize: MainAxisSize.min, children: [
          Text(fromLabel, style: TextStyle(color: AppColors.cyan, fontSize: 12, fontWeight: FontWeight.w700)),
          const SizedBox(height: 2),
          Row(mainAxisSize: MainAxisSize.min, children: [
            if (icon != null) ...[Icon(icon, size: 14, color: AppColors.textSecondary), const SizedBox(width: 4)],
            Flexible(
              child: Text(quoted['content']?.toString() ?? '', maxLines: 2, overflow: TextOverflow.ellipsis,
                  style: TextStyle(color: AppColors.textSecondary, fontSize: 13)),
            ),
          ]),
        ]),
      ),
    );
  }
}

/// "Replying to …" strip above the message box.
class ReplyBar extends StatelessWidget {
  const ReplyBar({super.key, required this.message, required this.fromLabel, required this.onClose});
  final Map message;
  final String fromLabel;
  final VoidCallback onClose;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.fromLTRB(12, 8, 4, 8),
      decoration: BoxDecoration(color: AppColors.surface, border: Border(top: BorderSide(color: AppColors.border))),
      child: Row(children: [
        Icon(Icons.reply, color: AppColors.cyan, size: 20),
        const SizedBox(width: 8),
        Expanded(child: QuotedMessage(quoted: message, fromLabel: 'Replying to $fromLabel')),
        IconButton(tooltip: 'Cancel reply', icon: const Icon(Icons.close), onPressed: onClose),
      ]),
    );
  }
}

/// Tells the other side "typing…" at most every 3 seconds while typing.
class TypingPinger {
  TypingPinger(this.endpoint);
  final String endpoint;
  DateTime _last = DateTime.fromMillisecondsSinceEpoch(0);

  void onChanged(String text) {
    if (text.trim().isEmpty) return;
    final now = DateTime.now();
    if (now.difference(_last) < const Duration(seconds: 3)) return;
    _last = now;
    unawaited(ApiService.post(endpoint, {}).then<void>((_) {}).catchError((Object _) {}));
  }
}

/// Buttons under a business message (quick reply / website / call).
/// [onQuickReply] is null when the viewer can't tap them (the business itself).
class MessageButtonsView extends StatelessWidget {
  const MessageButtonsView({super.key, required this.buttons, this.onQuickReply, this.tappedId});
  final List buttons;
  final void Function(Map button)? onQuickReply;
  /// The quick reply this customer already chose, if any.
  final String? tappedId;

  Future<void> _open(BuildContext context, Map b) async {
    final type = b['type'];
    final uri = type == 'url' ? Uri.tryParse('${b['url']}') : type == 'call' ? Uri.tryParse('tel:${'${b['phone']}'.replaceAll(' ', '')}') : null;
    if (uri == null) return;
    if (!await launchUrl(uri, mode: LaunchMode.externalApplication) && context.mounted) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text("Couldn't open that.")));
    }
  }

  @override
  Widget build(BuildContext context) {
    final list = buttons.whereType<Map>().toList();
    if (list.isEmpty) return const SizedBox.shrink();
    return Padding(
      padding: const EdgeInsets.only(top: 6),
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        for (final b in list)
          Padding(
            padding: const EdgeInsets.only(top: 4),
            child: OutlinedButton.icon(
              style: OutlinedButton.styleFrom(
                foregroundColor: AppColors.cyan,
                side: BorderSide(color: tappedId != null && tappedId == b['id'] ? AppColors.cyan : AppColors.border),
                visualDensity: VisualDensity.compact,
              ),
              icon: Icon(
                b['type'] == 'url' ? Icons.open_in_new : b['type'] == 'call' ? Icons.call_outlined : Icons.reply,
                size: 16,
              ),
              label: Text('${b['title']}', overflow: TextOverflow.ellipsis),
              onPressed: b['type'] == 'quick_reply'
                  ? (onQuickReply == null || tappedId != null ? null : () => onQuickReply!(b))
                  : () => _open(context, b),
            ),
          ),
      ]),
    );
  }
}

/// "typing…" in the chat header.
class TypingLabel extends StatelessWidget {
  const TypingLabel({super.key});
  @override
  Widget build(BuildContext context) =>
      Text('typing…', style: TextStyle(color: AppColors.green, fontSize: 13, fontWeight: FontWeight.w600));
}
