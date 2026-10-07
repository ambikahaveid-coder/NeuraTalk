/// Display info for the languages NeuraTalk supports (server/group-chats.ts SUPPORTED_LANGUAGES).
class LanguageInfo {
  final String code;
  final String name;
  final String native;
  final String flag;
  const LanguageInfo(this.code, this.name, this.native, this.flag);
}

const _all = [
  LanguageInfo('en', 'English', 'English', '🇬🇧'),
  LanguageInfo('hi', 'Hindi', 'हिन्दी', '🇮🇳'),
  LanguageInfo('te', 'Telugu', 'తెలుగు', '🇮🇳'),
  LanguageInfo('ta', 'Tamil', 'தமிழ்', '🇮🇳'),
  LanguageInfo('kn', 'Kannada', 'ಕನ್ನಡ', '🇮🇳'),
  LanguageInfo('ml', 'Malayalam', 'മലയാളം', '🇮🇳'),
  LanguageInfo('mr', 'Marathi', 'मराठी', '🇮🇳'),
  LanguageInfo('bn', 'Bengali', 'বাংলা', '🇮🇳'),
  LanguageInfo('gu', 'Gujarati', 'ગુજરાતી', '🇮🇳'),
  LanguageInfo('pa', 'Punjabi', 'ਪੰਜਾਬੀ', '🇮🇳'),
  LanguageInfo('or', 'Odia', 'ଓଡ଼ିଆ', '🇮🇳'),
  LanguageInfo('ur', 'Urdu', 'اردو', '🇵🇰'),
  LanguageInfo('es', 'Spanish', 'Español', '🇪🇸'),
  LanguageInfo('fr', 'French', 'Français', '🇫🇷'),
  LanguageInfo('de', 'German', 'Deutsch', '🇩🇪'),
  LanguageInfo('ar', 'Arabic', 'العربية', '🇸🇦'),
  LanguageInfo('ja', 'Japanese', '日本語', '🇯🇵'),
  LanguageInfo('ko', 'Korean', '한국어', '🇰🇷'),
  LanguageInfo('zh', 'Chinese', '中文', '🇨🇳'),
  LanguageInfo('pt', 'Portuguese', 'Português', '🇧🇷'),
  LanguageInfo('ru', 'Russian', 'Русский', '🇷🇺'),
];

class Languages {
  static final Map<String, LanguageInfo> _byCode = {for (final l in _all) l.code: l};

  /// Accepts "te", "te-IN" or "TE".
  static LanguageInfo of(String? code) {
    final base = (code ?? 'en').split(RegExp('[-_]')).first.toLowerCase();
    return _byCode[base] ?? LanguageInfo(base, base.toUpperCase(), base.toUpperCase(), '🌐');
  }

  static String name(String? code) => of(code).name;
}
