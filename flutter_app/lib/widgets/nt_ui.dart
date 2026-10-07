import 'package:flutter/material.dart';
import '../services/api_service.dart';
import '../theme/app_theme.dart';
import '../utils/languages.dart';

/// NeuraTalk design system building blocks, shared by every screen.
///
/// Spacing scale: 4 · 8 · 12 · 16 · 20 · 24 · 32. Radius: 12 (controls),
/// 16 (cards), 20 (sheets/hero), full (chips, avatars).
class NtSpace {
  static const xs = 4.0, s = 8.0, m = 12.0, l = 16.0, xl = 20.0, xxl = 24.0, xxxl = 32.0;
}

/// "🇮🇳 Telugu ⇄ 🇬🇧 English" — the conversation's language pair.
/// [onTapMine] lets the user change their own language (the other person
/// always chooses theirs).
class LanguagePairChip extends StatelessWidget {
  final String? mine;
  final String? theirs;
  final VoidCallback? onTapMine;
  final bool compact;
  final bool onDark;
  const LanguagePairChip({super.key, required this.mine, required this.theirs, this.onTapMine, this.compact = false, this.onDark = false});

  @override
  Widget build(BuildContext context) {
    final a = Languages.of(mine);
    final b = Languages.of(theirs);
    final fg = onDark ? AppColors.onAccent : AppColors.ink;
    final style = TextStyle(color: fg, fontSize: compact ? 12.5 : 14, fontWeight: FontWeight.w600);
    Widget lang(LanguageInfo l) => Row(mainAxisSize: MainAxisSize.min, children: [
          Text(l.flag, style: TextStyle(fontSize: compact ? 13 : 16)),
          const SizedBox(width: 5),
          Text(l.name, style: style),
        ]);
    final content = Row(mainAxisSize: MainAxisSize.min, children: [
      lang(a),
      if (onTapMine != null) Icon(Icons.expand_more, size: compact ? 16 : 18, color: fg.withValues(alpha: 0.7)),
      Padding(
        padding: EdgeInsets.symmetric(horizontal: compact ? 6 : 8),
        child: Icon(Icons.swap_horiz, size: compact ? 15 : 18, color: onDark ? const Color(0xFF7CC4FF) : AppColors.cyan),
      ),
      lang(b),
    ]);
    if (compact) return content;
    return Material(
      color: onDark ? const Color(0x1FFFFFFF) : AppColors.surfaceElevated,
      shape: const StadiumBorder(),
      child: InkWell(
        customBorder: const StadiumBorder(),
        onTap: onTapMine,
        child: Padding(padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 7), child: content),
      ),
    );
  }
}

/// Small "● Live translation" status, green when on.
class LiveBadge extends StatelessWidget {
  final bool on;
  final String label;
  final bool onDark;
  const LiveBadge({super.key, this.on = true, this.label = 'Live translation', this.onDark = false});

  @override
  Widget build(BuildContext context) {
    final color = on ? AppColors.green : AppColors.textMuted;
    return Row(mainAxisSize: MainAxisSize.min, children: [
      Container(width: 8, height: 8, decoration: BoxDecoration(color: color, shape: BoxShape.circle)),
      const SizedBox(width: 6),
      Text(on ? label : '$label off',
          style: TextStyle(
              color: onDark ? const Color(0xD9FFFFFF) : AppColors.textSecondary, fontSize: 12.5, fontWeight: FontWeight.w600)),
    ]);
  }
}

/// Round avatar: photo, else the first letter on a calm per-person colour.
class NtAvatar extends StatelessWidget {
  final String name;
  final String? avatarUrl;
  final double size;
  final bool online;
  const NtAvatar({super.key, required this.name, this.avatarUrl, this.size = 48, this.online = false});

  static const _palette = [Color(0xFF1E66F5), Color(0xFF16A34A), Color(0xFFEA580C), Color(0xFF7C3AED), Color(0xFF0891B2), Color(0xFFDB2777)];

  @override
  Widget build(BuildContext context) {
    final trimmed = name.trim();
    final letter = trimmed.isNotEmpty && RegExp(r'\p{L}', unicode: true).hasMatch(trimmed.characters.first)
        ? trimmed.characters.first.toUpperCase()
        : null;
    final color = _palette[trimmed.hashCode.abs() % _palette.length];
    return SizedBox(
      width: size,
      height: size,
      child: Stack(children: [
        CircleAvatar(
          radius: size / 2,
          backgroundColor: color.withValues(alpha: AppColors.isDark ? 0.28 : 0.14),
          backgroundImage: avatarUrl != null ? NetworkImage('${ApiService.baseUrl}$avatarUrl') : null,
          child: avatarUrl == null
              ? (letter != null
                  ? Text(letter, style: TextStyle(color: color, fontSize: size * 0.4, fontWeight: FontWeight.w700))
                  : Icon(Icons.person, color: color, size: size * 0.5))
              : null,
        ),
        if (online)
          Positioned(
            right: 0,
            bottom: 0,
            child: Container(
              width: size * 0.28,
              height: size * 0.28,
              decoration: BoxDecoration(color: AppColors.green, shape: BoxShape.circle, border: Border.all(color: AppColors.background, width: 2)),
            ),
          ),
      ]),
    );
  }
}

/// Friendly empty / error / permission state with one clear next step.
class NtEmptyState extends StatelessWidget {
  final IconData icon;
  final String title;
  final String message;
  final String? actionLabel;
  final VoidCallback? onAction;
  final bool error;
  const NtEmptyState({
    super.key,
    required this.icon,
    required this.title,
    required this.message,
    this.actionLabel,
    this.onAction,
    this.error = false,
  });

  @override
  Widget build(BuildContext context) {
    final tint = error ? AppColors.red : AppColors.cyan;
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(NtSpace.xxxl),
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          Container(
            width: 72,
            height: 72,
            decoration: BoxDecoration(color: tint.withValues(alpha: 0.12), shape: BoxShape.circle),
            child: Icon(icon, color: tint, size: 34),
          ),
          const SizedBox(height: NtSpace.xl),
          Text(title, textAlign: TextAlign.center, style: TextStyle(color: AppColors.ink, fontSize: 19, fontWeight: FontWeight.w700)),
          const SizedBox(height: NtSpace.s),
          Text(message, textAlign: TextAlign.center, style: TextStyle(color: AppColors.textSecondary, fontSize: 15, height: 1.45)),
          if (actionLabel != null && onAction != null) ...[
            const SizedBox(height: NtSpace.xxl),
            SizedBox(width: 240, child: ElevatedButton(onPressed: onAction, child: Text(actionLabel!))),
          ],
        ]),
      ),
    );
  }
}

/// Section title with an optional trailing action ("View all").
class NtSectionHeader extends StatelessWidget {
  final String title;
  final String? action;
  final VoidCallback? onAction;
  const NtSectionHeader(this.title, {super.key, this.action, this.onAction});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(NtSpace.xl, NtSpace.xxl, NtSpace.s, NtSpace.s),
      child: Row(children: [
        Expanded(child: Text(title, style: TextStyle(color: AppColors.ink, fontSize: 18, fontWeight: FontWeight.w700))),
        if (action != null) TextButton(onPressed: onAction, child: Text(action!)),
      ]),
    );
  }
}
