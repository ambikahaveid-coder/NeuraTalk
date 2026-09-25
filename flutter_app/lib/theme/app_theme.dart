import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

/// Light, high-contrast palette. Token names are kept from the original dark
/// theme so every screen switched over without per-widget edits:
/// `background`/`surface*` are now light fills, `ink` is the main text colour
/// (dark), and `cyan` is the brand accent (teal). Use `onAccent` for text or
/// icons drawn on top of an accent/red/green fill.
class AppColors {
  static const Color background = Color(0xFFFFFFFF);
  static const Color backgroundMid = Color(0xFFF7F8FA);
  static const Color surface = Color(0xFFFFFFFF);
  static const Color surfaceElevated = Color(0xFFF0F2F5);
  static const Color border = Color(0xFFE3E6EA);
  static const Color borderBright = Color(0xFFCDD3D8);

  /// Brand accent (buttons, links, selected tabs, icons).
  static const Color cyan = Color(0xFF0F766E);
  static const Color cyanDark = Color(0xFF115E59);
  static const Color teal = Color(0xFF0F766E);
  static const Color tealLight = Color(0xFF5EEAD4);

  /// Main text / icon colour on light surfaces.
  static const Color ink = Color(0xFF111B21);
  /// Text / icons on top of accent, red or green fills.
  static const Color onAccent = Color(0xFFFFFFFF);
  static const Color textPrimary = Color(0xFF111B21);
  static const Color textSecondary = Color(0xFF4B5B66);
  static const Color textMuted = Color(0xFF6B7A85);

  static const Color green = Color(0xFF16A34A);
  static const Color red = Color(0xFFDC2626);
  static const Color blue = Color(0xFF2563EB);
  static const Color orange = Color(0xFFEA580C);
}

class AppTheme {
  static ThemeData get light {
    return ThemeData(
      brightness: Brightness.light,
      scaffoldBackgroundColor: AppColors.background,
      primaryColor: AppColors.cyan,
      colorScheme: const ColorScheme.light(
        primary: AppColors.cyan,
        onPrimary: AppColors.onAccent,
        secondary: AppColors.teal,
        onSecondary: AppColors.onAccent,
        surface: AppColors.surface,
        onSurface: AppColors.ink,
        error: AppColors.red,
      ),
      fontFamily: null,
      appBarTheme: const AppBarTheme(
        backgroundColor: AppColors.background,
        surfaceTintColor: Colors.transparent,
        elevation: 0,
        scrolledUnderElevation: 1,
        centerTitle: false,
        systemOverlayStyle: SystemUiOverlayStyle.dark,
        titleTextStyle: TextStyle(
          fontFamily: null,
          fontSize: 22,
          fontWeight: FontWeight.w700,
          color: AppColors.ink,
        ),
        iconTheme: IconThemeData(color: AppColors.ink, size: 26),
      ),
      bottomNavigationBarTheme: const BottomNavigationBarThemeData(
        backgroundColor: AppColors.background,
        selectedItemColor: AppColors.cyan,
        unselectedItemColor: AppColors.textMuted,
        selectedLabelStyle: TextStyle(fontSize: 13, fontWeight: FontWeight.w700),
        unselectedLabelStyle: TextStyle(fontSize: 13, fontWeight: FontWeight.w500),
        type: BottomNavigationBarType.fixed,
        elevation: 8,
      ),
      dividerTheme: const DividerThemeData(color: AppColors.border, thickness: 1),
      dialogTheme: const DialogThemeData(
        backgroundColor: AppColors.background,
        surfaceTintColor: Colors.transparent,
        titleTextStyle: TextStyle(color: AppColors.ink, fontSize: 20, fontWeight: FontWeight.w700),
        contentTextStyle: TextStyle(color: AppColors.textSecondary, fontSize: 16),
      ),
      bottomSheetTheme: const BottomSheetThemeData(
        backgroundColor: AppColors.background,
        surfaceTintColor: Colors.transparent,
      ),
      popupMenuTheme: const PopupMenuThemeData(
        color: AppColors.background,
        surfaceTintColor: Colors.transparent,
        textStyle: TextStyle(color: AppColors.ink, fontSize: 16),
      ),
      snackBarTheme: const SnackBarThemeData(
        backgroundColor: AppColors.ink,
        contentTextStyle: TextStyle(color: AppColors.onAccent, fontSize: 15),
        behavior: SnackBarBehavior.floating,
      ),
      listTileTheme: const ListTileThemeData(
        iconColor: AppColors.textSecondary,
        textColor: AppColors.ink,
        titleTextStyle: TextStyle(color: AppColors.ink, fontSize: 17, fontWeight: FontWeight.w600),
        subtitleTextStyle: TextStyle(color: AppColors.textSecondary, fontSize: 15),
      ),
      // Slightly larger than Material defaults for readability (elderly users).
      textTheme: const TextTheme(
        headlineLarge: TextStyle(color: AppColors.ink, fontWeight: FontWeight.w800, fontSize: 32),
        headlineMedium: TextStyle(color: AppColors.ink, fontWeight: FontWeight.w700, fontSize: 24),
        titleLarge: TextStyle(color: AppColors.textPrimary, fontWeight: FontWeight.w700, fontSize: 20),
        titleMedium: TextStyle(color: AppColors.textPrimary, fontWeight: FontWeight.w600, fontSize: 17),
        bodyLarge: TextStyle(color: AppColors.textPrimary, fontSize: 17),
        bodyMedium: TextStyle(color: AppColors.textSecondary, fontSize: 15),
        bodySmall: TextStyle(color: AppColors.textMuted, fontSize: 13),
      ),
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: AppColors.surfaceElevated,
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
          borderSide: const BorderSide(color: AppColors.cyan, width: 2),
        ),
        hintStyle: const TextStyle(color: AppColors.textMuted, fontSize: 16),
        labelStyle: const TextStyle(color: AppColors.textSecondary, fontSize: 16),
        contentPadding: const EdgeInsets.symmetric(horizontal: 18, vertical: 16),
      ),
      elevatedButtonTheme: ElevatedButtonThemeData(
        style: ElevatedButton.styleFrom(
          backgroundColor: AppColors.cyan,
          foregroundColor: AppColors.onAccent,
          minimumSize: const Size(double.infinity, 56),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(30)),
          textStyle: const TextStyle(fontSize: 17, fontWeight: FontWeight.w700),
          elevation: 0,
        ),
      ),
      textButtonTheme: TextButtonThemeData(
        style: TextButton.styleFrom(
          foregroundColor: AppColors.cyan,
          textStyle: const TextStyle(fontSize: 16, fontWeight: FontWeight.w600),
        ),
      ),
      progressIndicatorTheme: const ProgressIndicatorThemeData(color: AppColors.cyan),
      useMaterial3: true,
    );
  }
}
