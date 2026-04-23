class ShellConfig {
  static const String rawAppUrl = String.fromEnvironment(
    'NEURATALK_APP_URL',
    defaultValue: 'https://neuratalk.in/login',
  );

  static const String shellVersion = String.fromEnvironment(
    'NEURATALK_SHELL_VERSION',
    defaultValue: '1.0.0',
  );

  static const Map<String, String> noCacheHeaders = <String, String>{
    'Cache-Control': 'no-cache, no-store, must-revalidate',
    'Pragma': 'no-cache',
    'Expires': '0',
    'X-NeuraTalk-Shell': shellVersion,
  };

  static Uri? get initialUri {
    final Uri? uri = Uri.tryParse(rawAppUrl);
    if (uri == null) {
      return null;
    }

    if (!uri.hasScheme) {
      return null;
    }

    if (uri.scheme != 'https' && uri.scheme != 'http') {
      return null;
    }

    return uri;
  }
}
