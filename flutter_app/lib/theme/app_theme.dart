import 'package:flutter/material.dart';

class AppColors {
  static const Color background = Color(0xFF080C10);
  static const Color backgroundMid = Color(0xFF0D1317);
  static const Color surface = Color(0xFF121A1F);
  static const Color surfaceElevated = Color(0xFF1A2530);
  static const Color border = Color(0xFF1E2D38);
  static const Color borderBright = Color(0xFF2A3D4A);

  static const Color cyan = Color(0xFF00E5FF);
  static const Color cyanDark = Color(0xFF00B8CC);
  static const Color teal = Color(0xFF00695C);
  static const Color tealLight = Color(0xFF004D40);

  static const Color white = Color(0xFFFFFFFF);
  static const Color textPrimary = Color(0xFFEEF2F5);
  static const Color textSecondary = Color(0xFF8A9BB0);
  static const Color textMuted = Color(0xFF4A6070);

  static const Color green = Color(0xFF00C853);
  static const Color red = Color(0xFFFF3D57);
  static const Color blue = Color(0xFF2979FF);
  static const Color orange = Color(0xFFFF6D00);
}

class AppTheme {
  static ThemeData get dark {
    return ThemeData(
      brightness: Brightness.dark,
      scaffoldBackgroundColor: AppColors.background,
      primaryColor: AppColors.cyan,
      colorScheme: const ColorScheme.dark(
        primary: AppColors.cyan,
        secondary: AppColors.teal,
        surface: AppColors.surface,
        error: AppColors.red,
      ),
      fontFamily: null,
      appBarTheme: const AppBarTheme(
        backgroundColor: AppColors.background,
        elevation: 0,
        centerTitle: false,
        titleTextStyle: TextStyle(
          fontFamily: null,
          fontSize: 20,
          fontWeight: FontWeight.w700,
          color: AppColors.cyan,
        ),
        iconTheme: IconThemeData(color: AppColors.textPrimary),
      ),
      bottomNavigationBarTheme: const BottomNavigationBarThemeData(
        backgroundColor: AppColors.backgroundMid,
        selectedItemColor: AppColors.cyan,
        unselectedItemColor: AppColors.textMuted,
        type: BottomNavigationBarType.fixed,
        elevation: 0,
      ),
      textTheme: const TextTheme(
        headlineLarge: TextStyle(color: AppColors.white, fontWeight: FontWeight.w800, fontSize: 32),
        headlineMedium: TextStyle(color: AppColors.white, fontWeight: FontWeight.w700, fontSize: 24),
        titleLarge: TextStyle(color: AppColors.textPrimary, fontWeight: FontWeight.w700, fontSize: 18),
        titleMedium: TextStyle(color: AppColors.textPrimary, fontWeight: FontWeight.w600, fontSize: 16),
        bodyLarge: TextStyle(color: AppColors.textPrimary, fontSize: 15),
        bodyMedium: TextStyle(color: AppColors.textSecondary, fontSize: 14),
        bodySmall: TextStyle(color: AppColors.textMuted, fontSize: 12),
      ),
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: AppColors.surface,
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(14),
          borderSide: const BorderSide(color: AppColors.border),
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(14),
          borderSide: const BorderSide(color: AppColors.border),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(14),
          borderSide: const BorderSide(color: AppColors.cyan, width: 1.5),
        ),
        hintStyle: const TextStyle(color: AppColors.textMuted, fontSize: 15),
        contentPadding: const EdgeInsets.symmetric(horizontal: 18, vertical: 16),
      ),
      elevatedButtonTheme: ElevatedButtonThemeData(
        style: ElevatedButton.styleFrom(
          backgroundColor: AppColors.cyan,
          foregroundColor: AppColors.background,
          minimumSize: const Size(double.infinity, 54),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(30)),
          textStyle: const TextStyle(fontSize: 16, fontWeight: FontWeight.w800),
          elevation: 0,
        ),
      ),
      useMaterial3: true,
    );
  }
}
