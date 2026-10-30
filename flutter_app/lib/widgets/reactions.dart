import 'package:flutter/material.dart';
import '../theme/app_theme.dart';

/// The six quick reactions offered on a long-press.
const kQuickReactions = ['👍', '❤️', '😂', '😮', '😢', '🙏'];

/// Row of quick reactions for the top of a message's long-press sheet.
/// [mine] is highlighted; tapping it again removes it.
class QuickReactionRow extends StatelessWidget {
  final String? mine;
  final void Function(String emoji) onPick;
  const QuickReactionRow({super.key, required this.mine, required this.onPick});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(12, 14, 12, 6),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceEvenly,
        children: [
          for (final emoji in kQuickReactions)
            Semantics(
              button: true,
              label: 'React $emoji',
              child: InkWell(
                customBorder: const CircleBorder(),
                onTap: () => onPick(emoji),
                child: Container(
                  width: 46,
                  height: 46,
                  alignment: Alignment.center,
                  decoration: BoxDecoration(shape: BoxShape.circle, color: mine == emoji ? AppColors.blueTint : Colors.transparent),
                  child: Text(emoji, style: const TextStyle(fontSize: 26)),
                ),
              ),
            ),
        ],
      ),
    );
  }
}

/// Puts the small reactions badge under a message bubble (nothing when none).
class WithReactions extends StatelessWidget {
  final Map? reactions;
  final bool alignEnd;
  final Widget child;
  final VoidCallback? onTap;
  const WithReactions({super.key, required this.reactions, required this.alignEnd, required this.child, this.onTap});

  @override
  Widget build(BuildContext context) {
    final counts = <String, int>{};
    for (final value in (reactions ?? const {}).values) {
      final emoji = value?.toString() ?? '';
      if (emoji.isNotEmpty) counts[emoji] = (counts[emoji] ?? 0) + 1;
    }
    if (counts.isEmpty) return child;
    final total = counts.values.fold<int>(0, (a, b) => a + b);
    return Column(
      crossAxisAlignment: alignEnd ? CrossAxisAlignment.end : CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: [
        child,
        Transform.translate(
          offset: const Offset(0, -9),
          child: GestureDetector(
            onTap: onTap,
            child: Container(
              margin: const EdgeInsets.symmetric(horizontal: 10),
              padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 2),
              decoration: BoxDecoration(
                color: AppColors.surface,
                borderRadius: BorderRadius.circular(12),
                border: Border.all(color: AppColors.border),
                boxShadow: [BoxShadow(color: Colors.black.withValues(alpha: 0.06), blurRadius: 4, offset: const Offset(0, 1))],
              ),
              child: Text(
                '${counts.keys.join()}${total > 1 ? ' $total' : ''}',
                semanticsLabel: 'Reactions: ${counts.keys.join(' ')}',
                style: TextStyle(fontSize: 14, color: AppColors.textSecondary, fontWeight: FontWeight.w600),
              ),
            ),
          ),
        ),
      ],
    );
  }
}

/// Message text with "@Name" of group members shown in bold accent.
class MentionText extends StatelessWidget {
  final String text;
  final List<String> names;
  final TextStyle style;
  const MentionText({super.key, required this.text, required this.names, required this.style});

  @override
  Widget build(BuildContext context) {
    final candidates = names.where((n) => n.trim().isNotEmpty).toList()..sort((a, b) => b.length.compareTo(a.length));
    if (candidates.isEmpty || !text.contains('@')) return Text(text, style: style);
    final spans = <TextSpan>[];
    var i = 0;
    while (i < text.length) {
      final at = text.indexOf('@', i);
      if (at < 0) break;
      String? hit;
      for (final name in candidates) {
        if (text.startsWith(name, at + 1)) {
          hit = name;
          break;
        }
      }
      if (hit == null) {
        spans.add(TextSpan(text: text.substring(i, at + 1)));
        i = at + 1;
        continue;
      }
      if (at > i) spans.add(TextSpan(text: text.substring(i, at)));
      spans.add(TextSpan(text: '@$hit', style: TextStyle(color: AppColors.cyan, fontWeight: FontWeight.w700)));
      i = at + 1 + hit.length;
    }
    if (i < text.length) spans.add(TextSpan(text: text.substring(i)));
    return Text.rich(TextSpan(style: style, children: spans));
  }
}
