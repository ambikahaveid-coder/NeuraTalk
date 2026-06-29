import 'package:flutter/material.dart';
import 'package:smooth_page_indicator/smooth_page_indicator.dart';
import '../theme/app_theme.dart';
import '../widgets/blob_background.dart';
import 'login_screen.dart';

class OnboardingSlide {
  final String title;
  final String highlight;
  final String subtitle;
  const OnboardingSlide(this.title, this.highlight, this.subtitle);
}

const _slides = [
  OnboardingSlide('Connect With Anyone', 'Anywhere', 'Talk naturally with people across the world in their own language.'),
  OnboardingSlide('Smart Translation', '20+ Languages', 'Context-aware translation in Telugu, Hindi, Tamil and more.'),
  OnboardingSlide('AI Understands You', 'Emotion Aware', 'Advanced AI captures your words and emotions accurately.'),
  OnboardingSlide('Break Language Barriers', 'Speak Freely', 'Real-time multilingual voice communication with emotion-aware translation.'),
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
      _controller.nextPage(duration: const Duration(milliseconds: 400), curve: Curves.easeInOut);
    } else {
      _goToLogin();
    }
  }

  void _goToLogin() {
    Navigator.pushReplacement(context, MaterialPageRoute(builder: (_) => const LoginScreen()));
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: BlobBackground(
        child: SafeArea(
          child: Column(
            children: [
              Align(
                alignment: Alignment.topRight,
                child: TextButton(
                  onPressed: _goToLogin,
                  child: Text('Skip', style: TextStyle(color: AppColors.textMuted, fontSize: 14)),
                ),
              ),
              Expanded(
                child: PageView.builder(
                  controller: _controller,
                  onPageChanged: (i) => setState(() => _current = i),
                  itemCount: _slides.length,
                  itemBuilder: (_, i) => _SlidePage(slide: _slides[i]),
                ),
              ),
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 32, vertical: 32),
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
                    const SizedBox(height: 32),
                    GestureDetector(
                      onTap: _next,
                      child: Container(
                        padding: const EdgeInsets.all(20),
                        decoration: BoxDecoration(
                          color: AppColors.cyan.withOpacity(0.15),
                          shape: BoxShape.circle,
                          border: Border.all(color: AppColors.cyan, width: 1.5),
                        ),
                        child: Icon(
                          _current == _slides.length - 1 ? Icons.arrow_forward : Icons.chevron_right,
                          color: AppColors.cyan,
                          size: 28,
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _SlidePage extends StatelessWidget {
  final OnboardingSlide slide;
  const _SlidePage({required this.slide});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 32),
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Text(
            slide.title,
            textAlign: TextAlign.center,
            style: const TextStyle(
              color: AppColors.white,
              fontSize: 36,
              fontWeight: FontWeight.w800,
              height: 1.15,
            ),
          ),
          const SizedBox(height: 8),
          Text(
            slide.highlight,
            textAlign: TextAlign.center,
            style: const TextStyle(
              color: AppColors.cyan,
              fontSize: 36,
              fontWeight: FontWeight.w800,
            ),
          ),
          const SizedBox(height: 24),
          Text(
            slide.subtitle,
            textAlign: TextAlign.center,
            style: const TextStyle(
              color: AppColors.textSecondary,
              fontSize: 16,
              height: 1.6,
            ),
          ),
        ],
      ),
    );
  }
}
