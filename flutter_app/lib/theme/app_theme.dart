import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// One set of colours for light or dark mode. Token names are the ones the
/// screens already use (see [AppColors]).
class _Palette {
  final Color background, backgroundMid, surface, surfaceElevated, border, borderBright;
  final Color accent, accentDark, blueTint;
  final Color ink, textSecondary, textMuted;
  const _Palette({
    required this.background,
    required this.backgroundMid,
    required this.surface,
    required this.surfaceElevated,
    required this.border,
    required this.borderBright,
    required this.accent,
    required this.accentDark,
    required this.blueTint,
    required this.ink,
    required this.textSecondary,
    required this.textMuted,
  });
}

const _light = _Palette(
  background: Color(0xFFFFFFFF),
  backgroundMid: Color(0xFFF6F8FC),
  surface: Color(0xFFFFFFFF),
  surfaceElevated: Color(0xFFF1F4F9),
  border: Color(0xFFE3E8F0),
  borderBright: Color(0xFFCBD3E1),
  accent: Color(0xFF1E66F5),
  accentDark: Color(0xFF1550D0),
  blueTint: Color(0xFFEAF1FF),
  ink: Color(0xFF0F172A),
  textSecondary: Color(0xFF475569),
  textMuted: Color(0xFF64748B),
);

// Dark mode keeps the brand navy family instead of neutral grey, so it still
// feels like NeuraTalk. Accent is lifted a step so links and icons keep 4.5:1
// contrast on the dark surfaces.
const _dark = _Palette(
  background: Color(0xFF0A1128),
  backgroundMid: Color(0xFF0D1632),
  surface: Color(0xFF111C3B),
  surfaceElevated: Color(0xFF17244A),
  border: Color(0xFF223159),
  borderBright: Color(0xFF34477A),
  accent: Color(0xFF4F8DFF),
  accentDark: Color(0xFF3B78F0),
  blueTint: Color(0xFF1A326B),
  ink: Color(0xFFF1F5FF),
  textSecondary: Color(0xFFB4C0DA),
  textMuted: Color(0xFF8A98B8),
);

/// NeuraTalk colours. Most tokens follow light/dark mode (they are getters,
/// so widgets using them can't be `const`); brand colours that look the same
/// in both modes stay `const`.
///
/// `background`/`surface*` are page and card fills, `ink` is the main text
/// colour, `cyan` is the brand accent (NeuraTalk blue). Use `onAccent` for text
/// or icons drawn on an accent/red/green/navy fill.
class AppColors {
  static _Palette _p = _light;
  static bool get isDark => identical(_p, _dark);

  /// Called by [ThemeSync] when the effective brightness changes.
  static void setDark(bool dark) => _p = dark ? _dark : _light;

  static Color get background => _p.background;
  static Color get backgroundMid => _p.backgroundMid;
  static Color get surface => _p.surface;
  static Color get surfaceElevated => _p.surfaceElevated;
  static Color get border => _p.border;
  static Color get borderBright => _p.borderBright;

  /// Brand accent — NeuraTalk blue (buttons, links, selected tabs, icons).
  static Color get cyan => _p.accent;
  static Color get cyanDark => _p.accentDark;
  static Color get teal => _p.accent;
  static Color get blue => _p.accent;
  /// Light brand tint for own chat bubbles, selected chips and rows.
  static Color get blueTint => _p.blueTint;

  /// Main text / icon colour on page and card fills.
  static Color get ink => _p.ink;
  static Color get textPrimary => _p.ink;
  static Color get textSecondary => _p.textSecondary;
  static Color get textMuted => _p.textMuted;

  // Same in both modes.
  static const Color tealLight = Color(0xFF2AA8FF);
  /// Brand navy — splash, home, call screen, profile header, app icon.
  static const Color navy = Color(0xFF0B1530);
  static const Color navySoft = Color(0xFF16244A);
  static const Color onAccent = Color(0xFFFFFFFF);
  static const Color green = Color(0xFF16A34A);
  static const Color red = Color(0xFFE11D48);
  static const Color orange = Color(0xFFEA580C);
  static const Color purple = Color(0xFF6D4AFF);

  /// Logo gradient (sky → brand blue → indigo).
  static const LinearGradient brandGradient = LinearGradient(
    begin: Alignment.topLeft,
    end: Alignment.bottomRight,
    colors: [Color(0xFF2AA8FF), Color(0xFF1E66F5), Color(0xFF4338CA)],
  );
}

/// The user's Appearance choice (Light / Dark / System), saved on the device.
class ThemeController extends ChangeNotifier {
  static const _key = 'appearance_v1';
  ThemeMode _mode = ThemeMode.system;
  ThemeMode get mode => _mode;

  Future<void> load() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      _mode = switch (prefs.getString(_key)) { 'light' => ThemeMode.light, 'dark' => ThemeMode.dark, _ => ThemeMode.system };
      notifyListeners();
    } catch (_) {}
  }

  Future<void> setMode(ThemeMode mode) async {
    _mode = mode;
    notifyListeners();
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString(_key, mode.name);
    } catch (_) {}
  }
}

/// Keeps [AppColors] in step with the theme MaterialApp is showing, and
/// rebuilds every screen when light/dark changes (screens read AppColors
/// directly, so they don't rebuild on a Theme change by themselves).
class ThemeSync extends StatefulWidget {
  final Widget child;
  const ThemeSync({super.key, required this.child});

  @override
  State<ThemeSync> createState() => _ThemeSyncState();
}

class _ThemeSyncState extends State<ThemeSync> {
  bool? _dark;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final dark = Theme.of(context).brightness == Brightness.dark;
    if (_dark == dark) return;
    final changed = _dark != null;
    _dark = dark;
    AppColors.setDark(dark);
    if (changed) {
      void rebuild(Element e) {
        e.markNeedsBuild();
        e.visitChildren(rebuild);
      }
      (context as Element).visitChildren(rebuild);
    }
  }

  @override
  Widget build(BuildContext context) => widget.child;
}

class AppTheme {
  static ThemeData get light => _build(_light, Brightness.light);
  static ThemeData get dark => _build(_dark, Brightness.dark);

  static ThemeData _build(_Palette p, Brightness brightness) {
    final isDark = brightness == Brightness.dark;
    TextStyle t(double size, FontWeight weight, Color color) =>
        TextStyle(fontFamily: 'Inter', fontSize: size, fontWeight: weight, color: color);
    return ThemeData(
      brightness: brightness,
      scaffoldBackgroundColor: p.background,
      primaryColor: p.accent,
      colorScheme: ColorScheme.fromSeed(
        seedColor: p.accent,
        brightness: brightness,
        primary: p.accent,
        onPrimary: AppColors.onAccent,
        secondary: p.accent,
        onSecondary: AppColors.onAccent,
        surface: p.surface,
        onSurface: p.ink,
        error: AppColors.red,
        outline: p.border,
      ),
      fontFamily: 'Inter',
      appBarTheme: AppBarTheme(
        backgroundColor: p.background,
        foregroundColor: p.ink,
        surfaceTintColor: Colors.transparent,
        elevation: 0,
        scrolledUnderElevation: 1,
        centerTitle: false,
        systemOverlayStyle: isDark ? SystemUiOverlayStyle.light : SystemUiOverlayStyle.dark,
        titleTextStyle: t(22, FontWeight.w700, p.ink),
        iconTheme: IconThemeData(color: p.ink, size: 26),
      ),
      dividerTheme: DividerThemeData(color: p.border, thickness: 1),
      dialogTheme: DialogThemeData(
        backgroundColor: p.surface,
        surfaceTintColor: Colors.transparent,
        titleTextStyle: t(20, FontWeight.w700, p.ink),
        contentTextStyle: t(16, FontWeight.w400, p.textSecondary),
      ),
      bottomSheetTheme: BottomSheetThemeData(
        backgroundColor: p.surface,
        surfaceTintColor: Colors.transparent,
        dragHandleColor: p.borderBright,
      ),
      popupMenuTheme: PopupMenuThemeData(
        color: p.surface,
        surfaceTintColor: Colors.transparent,
        textStyle: t(16, FontWeight.w400, p.ink),
      ),
      snackBarTheme: SnackBarThemeData(
        backgroundColor: isDark ? p.surfaceElevated : p.ink,
        contentTextStyle: t(15, FontWeight.w400, isDark ? p.ink : AppColors.onAccent),
        behavior: SnackBarBehavior.floating,
      ),
      listTileTheme: ListTileThemeData(
        iconColor: p.textSecondary,
        textColor: p.ink,
        titleTextStyle: t(17, FontWeight.w600, p.ink),
        subtitleTextStyle: t(15, FontWeight.w400, p.textSecondary),
      ),
      // Slightly larger than Material defaults for readability (elderly users).
      textTheme: TextTheme(
        headlineLarge: t(32, FontWeight.w800, p.ink),
        headlineMedium: t(24, FontWeight.w700, p.ink),
        titleLarge: t(20, FontWeight.w700, p.ink),
        titleMedium: t(17, FontWeight.w600, p.ink),
        bodyLarge: t(17, FontWeight.w400, p.ink),
        bodyMedium: t(15, FontWeight.w400, p.textSecondary),
        bodySmall: t(13, FontWeight.w400, p.textMuted),
        labelLarge: t(16, FontWeight.w600, p.ink),
      ),
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: p.surfaceElevated,
        border: OutlineInputBorder(borderRadius: BorderRadius.circular(14), borderSide: BorderSide(color: p.border)),
        enabledBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(14), borderSide: BorderSide(color: p.border)),
        focusedBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(14), borderSide: BorderSide(color: p.accent, width: 2)),
        hintStyle: t(16, FontWeight.w400, p.textMuted),
        labelStyle: t(16, FontWeight.w400, p.textSecondary),
        prefixIconColor: p.textMuted,
        suffixIconColor: p.textMuted,
        contentPadding: const EdgeInsets.symmetric(horizontal: 18, vertical: 16),
      ),
      elevatedButtonTheme: ElevatedButtonThemeData(
        style: ElevatedButton.styleFrom(
          backgroundColor: p.accent,
          foregroundColor: AppColors.onAccent,
          disabledBackgroundColor: p.surfaceElevated,
          disabledForegroundColor: p.textMuted,
          minimumSize: const Size(double.infinity, 56),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
          textStyle: const TextStyle(fontFamily: 'Inter', fontSize: 17, fontWeight: FontWeight.w700),
          elevation: 0,
        ),
      ),
      outlinedButtonTheme: OutlinedButtonThemeData(
        style: OutlinedButton.styleFrom(
          foregroundColor: p.accent,
          side: BorderSide(color: p.borderBright),
          textStyle: const TextStyle(fontFamily: 'Inter', fontSize: 16, fontWeight: FontWeight.w600),
        ),
      ),
      textButtonTheme: TextButtonThemeData(
        style: TextButton.styleFrom(
          foregroundColor: p.accent,
          textStyle: const TextStyle(fontFamily: 'Inter', fontSize: 16, fontWeight: FontWeight.w600),
        ),
      ),
      chipTheme: ChipThemeData(
        backgroundColor: p.surface,
        selectedColor: p.blueTint,
        side: BorderSide(color: p.border),
        labelStyle: t(14, FontWeight.w500, p.textSecondary),
      ),
      switchTheme: SwitchThemeData(
        thumbColor: WidgetStateProperty.resolveWith((s) => s.contains(WidgetState.selected) ? AppColors.onAccent : p.textMuted),
        trackColor: WidgetStateProperty.resolveWith((s) => s.contains(WidgetState.selected) ? p.accent : p.surfaceElevated),
      ),
      progressIndicatorTheme: ProgressIndicatorThemeData(color: p.accent),
      useMaterial3: true,
    );
  }
}
