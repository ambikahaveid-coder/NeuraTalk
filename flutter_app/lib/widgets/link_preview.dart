import 'package:flutter/material.dart';
import '../services/api_service.dart';
import '../theme/app_theme.dart';
import '../utils/external_link.dart';

final _urlPattern = RegExp(r'https://[^\s<>"]+', caseSensitive: false);

/// The first https link in a message, if any (trailing punctuation removed).
String? firstLinkIn(String text) {
  final match = _urlPattern.firstMatch(text);
  if (match == null) return null;
  return match.group(0)!.replaceAll(RegExp(r'[).,!?;:]+$'), '');
}

/// Title, description and picture of a link in a message, fetched once by
/// the server (which keeps private network addresses out of reach) and
/// remembered for the rest of the session. Nothing shows if there is none.
class LinkPreviewCard extends StatelessWidget {
  final String url;
  const LinkPreviewCard({super.key, required this.url});

  static final Map<String, Future<Map<String, dynamic>?>> _cache = {};

  static Future<Map<String, dynamic>?> _load(String url) {
    return _cache.putIfAbsent(url, () async {
      try {
        final res = await ApiService.get('/api/link-preview?url=${Uri.encodeQueryComponent(url)}');
        final preview = res is Map ? res['preview'] : null;
        return preview is Map ? Map<String, dynamic>.from(preview) : null;
      } catch (_) {
        _cache.remove(url); // try again next time
        return null;
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    return FutureBuilder<Map<String, dynamic>?>(
      future: _load(url),
      builder: (context, snap) {
        final p = snap.data;
        if (p == null) return const SizedBox.shrink();
        final image = p['image']?.toString();
        final title = p['title']?.toString();
        final description = p['description']?.toString();
        final site = p['siteName']?.toString();
        return Padding(
          padding: const EdgeInsets.only(top: 6, bottom: 2),
          child: Material(
            color: AppColors.backgroundMid,
            borderRadius: BorderRadius.circular(10),
            clipBehavior: Clip.antiAlias,
            child: InkWell(
              onTap: () => ExternalLink.open(url),
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                if (image != null)
                  AspectRatio(
                    aspectRatio: 1.91,
                    child: Image.network(image, fit: BoxFit.cover, errorBuilder: (_, __, ___) => const SizedBox.shrink()),
                  ),
                Padding(
                  padding: const EdgeInsets.fromLTRB(10, 8, 10, 8),
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    if (title != null)
                      Text(title, maxLines: 2, overflow: TextOverflow.ellipsis,
                          style: TextStyle(color: AppColors.ink, fontWeight: FontWeight.w700, fontSize: 14)),
                    if (description != null)
                      Padding(
                        padding: const EdgeInsets.only(top: 2),
                        child: Text(description, maxLines: 2, overflow: TextOverflow.ellipsis,
                            style: TextStyle(color: AppColors.textSecondary, fontSize: 13)),
                      ),
                    if (site != null)
                      Padding(
                        padding: const EdgeInsets.only(top: 4),
                        child: Text(site, style: TextStyle(color: AppColors.textMuted, fontSize: 12)),
                      ),
                  ]),
                ),
              ]),
            ),
          ),
        );
      },
    );
  }
}
