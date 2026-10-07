import 'package:flutter/material.dart';
import '../theme/app_theme.dart';

/// The NeuraTalk "N + voice bars" mark (assets/brand/logo_mark.svg rendered to PNG).
class NeuraMark extends StatelessWidget {
  final double height;
  const NeuraMark({super.key, this.height = 40});

  @override
  Widget build(BuildContext context) {
    // The artwork is 132 x 100.
    return Image.asset(
      'assets/brand/logo_mark.png',
      height: height,
      width: height * 1.32,
      fit: BoxFit.contain,
      filterQuality: FilterQuality.medium,
      semanticLabel: 'NeuraTalk',
    );
  }
}

/// Mark + "NeuraTalk" wordmark, optionally with the "CONNECT BEYOND LIMITS" tagline.
/// Use [onDark] on navy backgrounds so "Neura" turns white.
class NeuraLogo extends StatelessWidget {
  final double size;
  final bool onDark;
  final bool tagline;
  final bool vertical;
  const NeuraLogo({super.key, this.size = 28, this.onDark = false, this.tagline = false, this.vertical = false});

  @override
  Widget build(BuildContext context) {
    final word = Text.rich(
      TextSpan(children: [
        TextSpan(text: 'Neura', style: TextStyle(color: onDark ? AppColors.onAccent : AppColors.ink)),
        TextSpan(text: 'Talk', style: TextStyle(color: AppColors.cyan)),
      ]),
      style: TextStyle(fontSize: size, fontWeight: FontWeight.w800, letterSpacing: -0.5, height: 1.1),
    );
    final text = Column(
      crossAxisAlignment: vertical ? CrossAxisAlignment.center : CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: [
        word,
        if (tagline) ...[
          SizedBox(height: size * 0.18),
          Text(
            'CONNECT BEYOND LIMITS',
            style: TextStyle(
              color: onDark ? AppColors.onAccent.withValues(alpha: 0.75) : AppColors.textSecondary,
              fontSize: (size * 0.32).clamp(9, 16).toDouble(),
              fontWeight: FontWeight.w600,
              letterSpacing: size * 0.12,
            ),
          ),
        ],
      ],
    );
    if (vertical) {
      return Column(mainAxisSize: MainAxisSize.min, children: [NeuraMark(height: size * 2.6), SizedBox(height: size * 0.5), text]);
    }
    return Row(mainAxisSize: MainAxisSize.min, children: [NeuraMark(height: size * 1.15), SizedBox(width: size * 0.3), text]);
  }
}

/// Full-screen brand splash shown while the saved session is checked.
class BrandSplash extends StatelessWidget {
  const BrandSplash({super.key});

  @override
  Widget build(BuildContext context) {
    return const Scaffold(
      backgroundColor: AppColors.navy,
      body: DecoratedBox(
        decoration: BoxDecoration(
          gradient: RadialGradient(
            center: Alignment(0, 0.9),
            radius: 1.1,
            colors: [Color(0xFF1B3A8C), AppColors.navy],
          ),
        ),
        child: SafeArea(
          child: Column(
            children: [
              Spacer(flex: 3),
              Center(child: NeuraLogo(size: 40, onDark: true, tagline: true, vertical: true)),
              Spacer(flex: 3),
              Text(
                'Real-time AI communication\nfor a borderless world.',
                textAlign: TextAlign.center,
                style: TextStyle(color: Color(0xCCFFFFFF), fontSize: 15, height: 1.5),
              ),
              SizedBox(height: 28),
              SizedBox(
                width: 120,
                child: LinearProgressIndicator(
                  minHeight: 3,
                  color: AppColors.tealLight,
                  backgroundColor: Color(0x33FFFFFF),
                  borderRadius: BorderRadius.all(Radius.circular(2)),
                ),
              ),
              SizedBox(height: 40),
            ],
          ),
        ),
      ),
    );
  }
}
