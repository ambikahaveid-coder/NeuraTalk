import 'package:flutter/foundation.dart';

class ShellConfig {
  static const String _configuredAppUrl = String.fromEnvironment(
    'NEURATALK_APP_URL',
    defaultValue: '',
  );

  static String get rawAppUrl {
    if (_configuredAppUrl.isNotEmpty) {
      return _configuredAppUrl;
    }

    if (kDebugMode) {
      if (defaultTargetPlatform == TargetPlatform.android) {
        return 'http://10.0.2.2:5000/login';
      }
      return 'http://localhost:5000/login';
    }

    return 'https://neuratalk.in/login';
  }

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
