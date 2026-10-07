import 'package:flutter/material.dart';
import 'package:smooth_page_indicator/smooth_page_indicator.dart';
import '../theme/app_theme.dart';
import 'package:provider/provider.dart';
import '../providers/auth_provider.dart';

class OnboardingSlide {
  final String title;
  final String highlight;
  final String trailing;
  final String subtitle;
  final IconData icon;
  const OnboardingSlide(this.title, this.highlight, this.trailing, this.subtitle, this.icon);
}

const _slides = [
  OnboardingSlide('Talk to\n', 'Anyone', '\nAnywhere',
      'Calls, video and chat translated live. You speak your language, they hear theirs.', Icons.public),
  OnboardingSlide('Speak the\n', 'way you speak', '',
      'Mix Telugu, Hindi and English in one sentence. NeuraTalk understands natural, everyday speech.', Icons.record_voice_over),
  OnboardingSlide('Face to face,\n', 'no barrier', '',
      'Hand over one phone and talk with someone next to you. Each person hears the other in their language.', Icons.people_alt),
];

class OnboardingScreen extends StatefulWidget {
  const OnboardingScreen({super.key});

  @override
  State<OnboardingScreen> createState() => _OnboardingScreenState();
}

class _OnboardingScreenState extends State<OnboardingScreen> {
  final PageController _controller = PageController();
  int _current = 0;

  void _next() {
    if (_current < _slides.length - 1) {
      _controller.nextPage(duration: const Duration(milliseconds: 350), curve: Curves.easeOutCubic);
    } else {
      _goToLogin();
    }
  }

  void _goToLogin() {
    // The app root (main.dart) switches to the login screen.
    context.read<AuthProvider>().markOnboardingDone();
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final last = _current == _slides.length - 1;
    return Scaffold(
      backgroundColor: AppColors.background,
      body: SafeArea(
        child: Column(
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 8, 8, 0),
              child: Row(
                children: [
                  const Spacer(),
                  TextButton(
                    onPressed: _goToLogin,
                    child: Text('Skip', style: TextStyle(color: AppColors.textSecondary, fontSize: 15)),
                  ),
                ],
              ),
            ),
            Expanded(
              child: PageView.builder(
                controller: _controller,
                onPageChanged: (i) => setState(() => _current = i),
                itemCount: _slides.length,
                itemBuilder: (_, i) => _SlidePage(slide: _slides[i], index: i),
              ),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(24, 8, 24, 24),
              child: Column(
                children: [
                  SmoothPageIndicator(
                    controller: _controller,
                    count: _slides.length,
                    effect: ExpandingDotsEffect(
                      activeDotColor: AppColors.cyan,
                      dotColor: AppColors.border,
                      dotHeight: 8,
                      dotWidth: 8,
                      expansionFactor: 3,
                    ),
                  ),
                  const SizedBox(height: 24),
                  ElevatedButton(
                    onPressed: _next,
                    style: ElevatedButton.styleFrom(backgroundColor: AppColors.isDark ? AppColors.cyan : AppColors.navy, foregroundColor: AppColors.onAccent),
                    child: Row(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        Text(last ? 'Get started' : 'Next'),
                        const SizedBox(width: 8),
                        const Icon(Icons.arrow_forward, size: 20),
                      ],
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _SlidePage extends StatelessWidget {
  final OnboardingSlide slide;
  final int index;
  const _SlidePage({required this.slide, required this.index});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 24),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const SizedBox(height: 12),
          Text.rich(
            TextSpan(children: [
              TextSpan(text: slide.title),
              TextSpan(text: slide.highlight, style: TextStyle(color: AppColors.cyan)),
              TextSpan(text: slide.trailing),
            ]),
            style: TextStyle(color: AppColors.ink, fontSize: 38, fontWeight: FontWeight.w800, height: 1.12, letterSpacing: -0.5),
          ),
          const SizedBox(height: 14),
          Text(slide.subtitle, style: TextStyle(color: AppColors.textSecondary, fontSize: 16, height: 1.5)),
          const SizedBox(height: 16),
          Expanded(child: Center(child: SingleChildScrollView(child: _Illustration(index: index)))),
        ],
      ),
    );
  }
}

/// Each slide shows the real product doing what the slide promises,
/// not decorative art: a translated chat, a code-mixed voice note, the
/// split face-to-face screen.
class _Illustration extends StatelessWidget {
  final int index;
  const _Illustration({required this.index});

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(24),
        border: Border.all(color: AppColors.border),
      ),
      child: switch (index) {
        0 => const _ChatDemo(),
        1 => const _VoiceDemo(),
        _ => const _FaceToFaceDemo(),
      },
    );
  }
}

Widget _pairRow(String a, String b) => Row(children: [
      Text(a, style: TextStyle(color: AppColors.ink, fontSize: 13.5, fontWeight: FontWeight.w600)),
      Padding(padding: const EdgeInsets.symmetric(horizontal: 6), child: Icon(Icons.swap_horiz, size: 16, color: AppColors.cyan)),
      Text(b, style: TextStyle(color: AppColors.ink, fontSize: 13.5, fontWeight: FontWeight.w600)),
      const Spacer(),
      Container(width: 7, height: 7, decoration: BoxDecoration(color: AppColors.green, shape: BoxShape.circle)),
      const SizedBox(width: 5),
      Text('Live', style: TextStyle(color: AppColors.textSecondary, fontSize: 12, fontWeight: FontWeight.w600)),
    ]);

class _DemoBubble extends StatelessWidget {
  final String shown;
  final String? original;
  final String? originalLabel;
  final bool own;
  const _DemoBubble({required this.shown, this.original, this.originalLabel, this.own = false});

  @override
  Widget build(BuildContext context) {
    return Align(
      alignment: own ? Alignment.centerRight : Alignment.centerLeft,
      child: Container(
        constraints: const BoxConstraints(maxWidth: 250),
        margin: const EdgeInsets.only(top: 10),
        padding: const EdgeInsets.fromLTRB(12, 9, 12, 9),
        decoration: BoxDecoration(
          color: own ? AppColors.blueTint : AppColors.background,
          border: own ? null : Border.all(color: AppColors.border),
          borderRadius: BorderRadius.only(
            topLeft: const Radius.circular(16),
            topRight: const Radius.circular(16),
            bottomLeft: Radius.circular(own ? 16 : 5),
            bottomRight: Radius.circular(own ? 5 : 16),
          ),
        ),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, mainAxisSize: MainAxisSize.min, children: [
          Text(shown, style: TextStyle(color: AppColors.textPrimary, fontSize: 15, height: 1.3, fontWeight: FontWeight.w500)),
          if (original != null) ...[
            const SizedBox(height: 5),
            Text(originalLabel ?? 'Original', style: TextStyle(color: AppColors.cyan, fontSize: 10.5, fontWeight: FontWeight.w700)),
            Text(original!, style: TextStyle(color: AppColors.textSecondary, fontSize: 13, height: 1.3)),
          ],
        ]),
      ),
    );
  }
}

class _ChatDemo extends StatelessWidget {
  const _ChatDemo();

  @override
  Widget build(BuildContext context) {
    return Column(mainAxisSize: MainAxisSize.min, children: [
      _pairRow('English', 'Telugu'),
      const SizedBox(height: 4),
      const _DemoBubble(shown: 'Shall we meet tomorrow?', original: 'రేపు కలుద్దామా?', originalLabel: 'Original · Telugu'),
      const _DemoBubble(own: true, shown: 'Yes, 5 pm at the cafe', original: 'అవును, సాయంత్రం 5కి కేఫ్‌లో', originalLabel: 'They read · Telugu'),
      const _DemoBubble(shown: 'Perfect, see you there!', original: 'సరే, అక్కడ కలుద్దాం!', originalLabel: 'Original · Telugu'),
    ]);
  }
}

class _VoiceDemo extends StatelessWidget {
  const _VoiceDemo();

  @override
  Widget build(BuildContext context) {
    const bars = <double>[8, 14, 22, 12, 26, 18, 30, 16, 10, 24, 20, 12, 28, 14, 8, 18, 22, 10];
    return Column(crossAxisAlignment: CrossAxisAlignment.start, mainAxisSize: MainAxisSize.min, children: [
      _pairRow('Hindi + English', 'Telugu'),
      const SizedBox(height: 14),
      Row(children: [
        Container(
          width: 40,
          height: 40,
          decoration: BoxDecoration(color: AppColors.cyan, shape: BoxShape.circle),
          child: Icon(Icons.mic, color: AppColors.onAccent, size: 22),
        ),
        const SizedBox(width: 12),
        for (final h in bars)
          Container(
            width: 4,
            height: h,
            margin: const EdgeInsets.symmetric(horizontal: 1.5),
            decoration: BoxDecoration(color: AppColors.cyan.withValues(alpha: 0.75), borderRadius: BorderRadius.circular(2)),
          ),
      ]),
      const SizedBox(height: 14),
      Text('YOU SAID', style: TextStyle(color: AppColors.textMuted, fontSize: 10.5, fontWeight: FontWeight.w700, letterSpacing: 0.6)),
      const SizedBox(height: 3),
      Text('Kal meeting hai, but I will call you after lunch.',
          style: TextStyle(color: AppColors.textSecondary, fontSize: 14.5, height: 1.35)),
      const SizedBox(height: 12),
      Text('THEY HEAR · TELUGU', style: TextStyle(color: AppColors.cyan, fontSize: 10.5, fontWeight: FontWeight.w700, letterSpacing: 0.6)),
      const SizedBox(height: 3),
      Text('రేపు మీటింగ్ ఉంది, కానీ లంచ్ తర్వాత మీకు కాల్ చేస్తాను.',
          style: TextStyle(color: AppColors.ink, fontSize: 16, height: 1.4, fontWeight: FontWeight.w600)),
    ]);
  }
}

class _FaceToFaceDemo extends StatelessWidget {
  const _FaceToFaceDemo();

  @override
  Widget build(BuildContext context) {
    Widget half(String label, String text, {required bool flipped, required bool dark}) {
      final panel = Container(
        width: double.infinity,
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(
          color: dark ? AppColors.navy : AppColors.background,
          borderRadius: BorderRadius.circular(16),
          border: dark ? null : Border.all(color: AppColors.border),
        ),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(label,
              style: TextStyle(
                  color: dark ? const Color(0xFF7CC4FF) : AppColors.cyan, fontSize: 11, fontWeight: FontWeight.w700, letterSpacing: 0.5)),
          const SizedBox(height: 6),
          Text(text, style: TextStyle(color: dark ? Colors.white : AppColors.ink, fontSize: 16, height: 1.35, fontWeight: FontWeight.w600)),
        ]),
      );
      // The guest's half faces the other way, as on the real split screen.
      return flipped ? RotatedBox(quarterTurns: 2, child: panel) : panel;
    }

    return Column(mainAxisSize: MainAxisSize.min, children: [
      half('GUEST · ENGLISH', 'Where is the nearest metro station?', flipped: true, dark: false),
      Padding(
        padding: const EdgeInsets.symmetric(vertical: 10),
        child: Row(children: [
          Expanded(child: Divider(color: AppColors.border)),
          Padding(padding: const EdgeInsets.symmetric(horizontal: 10), child: Icon(Icons.swap_vert, color: AppColors.cyan, size: 20)),
          Expanded(child: Divider(color: AppColors.border)),
        ]),
      ),
      half('YOU · HINDI', 'सबसे नज़दीकी मेट्रो स्टेशन कहाँ है?', flipped: false, dark: true),
    ]);
  }
}
