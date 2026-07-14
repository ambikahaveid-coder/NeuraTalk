import 'package:url_launcher/url_launcher.dart';

/// Shared helper for opening a URL in the device's external browser.
/// Used by screens that link out to already-live web pages (billing
/// checkout, legal/support pages) instead of duplicating a native screen
/// for content that already exists and works on the web.
class ExternalLink {
  /// Returns true if the URL was launched, false if it couldn't be
  /// (no handler available, malformed URL, etc.) — callers should show
  /// their own fallback message on false rather than fail silently.
  static Future<bool> open(String url) async {
    try {
      final uri = Uri.parse(url);
      return await launchUrl(uri, mode: LaunchMode.externalApplication);
    } catch (_) {
      return false;
    }
  }
}
