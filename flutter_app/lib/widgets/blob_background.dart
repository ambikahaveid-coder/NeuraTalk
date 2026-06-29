import 'package:flutter/material.dart';
import '../theme/app_theme.dart';

class BlobBackground extends StatelessWidget {
  final Widget child;
  const BlobBackground({super.key, required this.child});

  @override
  Widget build(BuildContext context) {
    return Stack(
      children: [
        Container(color: AppColors.background),
        Positioned(
          top: -80,
          right: -60,
          child: _blob(220, AppColors.teal.withOpacity(0.35)),
        ),
        Positioned(
          bottom: -100,
          left: -80,
          child: _blob(260, AppColors.teal.withOpacity(0.28)),
        ),
        Positioned(
          bottom: 120,
          right: -40,
          child: _blob(160, AppColors.tealLight.withOpacity(0.2)),
        ),
        child,
      ],
    );
  }

  Widget _blob(double size, Color color) {
    return Container(
      width: size,
      height: size,
      decoration: BoxDecoration(
        color: color,
        shape: BoxShape.circle,
      ),
    );
  }
}
