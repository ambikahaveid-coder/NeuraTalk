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
      'Real-time voice, video and chat translation powered by advanced AI.', Icons.public),
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
                itemBuilder: (_, i) => _SlidePage(slide: _slides[i], showGreetings: i == 0),
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
                        Text(last ? 'Get Started' : 'Next'),
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
  final bool showGreetings;
  const _SlidePage({required this.slide, required this.showGreetings});

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
          Expanded(child: _Illustration(icon: slide.icon, showGreetings: showGreetings)),
        ],
      ),
    );
  }
}

class _Illustration extends StatelessWidget {
  final IconData icon;
  final bool showGreetings;
  const _Illustration({required this.icon, required this.showGreetings});

  @override
  Widget build(BuildContext context) {
    if (!showGreetings) {
      return Center(
        child: Container(
          width: 200,
          height: 200,
          decoration: BoxDecoration(
            shape: BoxShape.circle,
            gradient: RadialGradient(colors: [AppColors.cyan.withValues(alpha: 0.16), AppColors.cyan.withValues(alpha: 0.02)]),
          ),
          child: Center(
            child: Container(
              width: 120,
              height: 120,
              decoration: const BoxDecoration(gradient: AppColors.brandGradient, shape: BoxShape.circle),
              child: Icon(icon, size: 56, color: AppColors.onAccent),
            ),
          ),
        ),
      );
    }
    // People collage from the brand onboarding: four speakers, each greeting in their language.
    return LayoutBuilder(builder: (_, c) {
      final w = c.maxWidth;
      final h = c.maxHeight;
      Widget person(String emoji, Color bg, double size) => Container(
            width: size,
            height: size,
            alignment: Alignment.center,
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              gradient: LinearGradient(colors: [bg.withValues(alpha: 0.35), bg.withValues(alpha: 0.12)], begin: Alignment.topLeft, end: Alignment.bottomRight),
              border: Border.all(color: AppColors.background, width: 4),
              boxShadow: [BoxShadow(color: AppColors.navy.withValues(alpha: 0.10), blurRadius: 16, offset: const Offset(0, 6))],
            ),
            child: Text(emoji, style: TextStyle(fontSize: size * 0.5)),
          );
      Widget bubble(String text, {bool blue = false}) => Container(
            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
            decoration: BoxDecoration(
              color: blue ? AppColors.cyan : AppColors.background,
              borderRadius: BorderRadius.circular(14),
              border: blue ? null : Border.all(color: AppColors.border),
              boxShadow: [BoxShadow(color: AppColors.navy.withValues(alpha: 0.08), blurRadius: 10, offset: const Offset(0, 3))],
            ),
            child: Text(text, style: TextStyle(color: blue ? AppColors.onAccent : AppColors.ink, fontSize: 16, fontWeight: FontWeight.w600)),
          );
      final s = (w * 0.34).clamp(90.0, 140.0);
      return Stack(
        clipBehavior: Clip.none,
        children: [
          Positioned(left: 0, top: h * 0.02, child: person('🧑🏽', const Color(0xFF1E66F5), s)),
          Positioned(right: 0, top: 0, child: person('👩🏻', const Color(0xFFEA580C), s * 0.92)),
          Positioned(left: w * 0.02, top: h * 0.50, child: person('👴🏾', const Color(0xFF16A34A), s * 0.95)),
          Positioned(right: w * 0.04, top: h * 0.46, child: person('🧕🏽', const Color(0xFF6D4AFF), s)),
          Positioned(left: w * 0.36, top: h * 0.10, child: bubble('Hello', blue: true)),
          Positioned(left: w * 0.40, top: h * 0.27, child: bubble('नमस्ते')),
          Positioned(left: w * 0.30, top: h * 0.44, child: bubble('Hola')),
          Positioned(left: w * 0.42, top: h * 0.60, child: bubble('నమస్తే', blue: true)),
          Positioned(left: w * 0.36, top: h * 0.78, child: bubble('مرحبا')),
        ],
      );
    });
  }
}
