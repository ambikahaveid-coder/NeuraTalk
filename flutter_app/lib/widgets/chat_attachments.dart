import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';
import 'package:open_filex/open_filex.dart';
import 'package:share_plus/share_plus.dart';
import '../screens/media_viewer_screen.dart';
import '../screens/video_player_screen.dart';
import '../services/media_store.dart';
import '../theme/app_theme.dart';

/// Photo or GIF in a chat bubble. Loads with the user's session (attachments are
/// private) and is cached on the device; GIFs animate.
class ChatImageAttachment extends StatelessWidget {
  final String objectPath;
  final String name;
  const ChatImageAttachment({super.key, required this.objectPath, required this.name});

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: () => Navigator.push(
        context,
        MaterialPageRoute(builder: (_) => MediaViewerScreen(objectPath: objectPath, name: name)),
      ),
      child: Hero(
        tag: objectPath,
        child: ClipRRect(
          borderRadius: BorderRadius.circular(14),
          child: CachedNetworkImage(
            imageUrl: MediaStore.urlFor(objectPath),
            cacheKey: objectPath,
            httpHeaders: MediaStore.authHeaders,
            width: 240,
            height: 240,
            fit: BoxFit.cover,
            fadeInDuration: const Duration(milliseconds: 150),
            placeholder: (_, __) => Container(
              width: 240,
              height: 240,
              color: AppColors.surfaceElevated,
              alignment: Alignment.center,
              child: SizedBox(width: 26, height: 26, child: CircularProgressIndicator(strokeWidth: 2.5, color: AppColors.cyan)),
            ),
            // e.g. an iPhone HEIC photo this phone can't decode: still let them open/save it.
            errorWidget: (_, __, ___) => SizedBox(
              width: 240,
              child: ChatFileAttachment(objectPath: objectPath, name: name, mime: MediaStore.contentTypeFor(name)),
            ),
          ),
        ),
      ),
    );
  }
}

/// Shared "download once, then open" behaviour with a progress ring.
mixin _DownloadOnTap<T extends StatefulWidget> on State<T> {
  double? progress; // null = idle
  bool downloaded = false;

  String get objectPath;
  String get name;

  Future<void> checkCached() async {
    final f = await MediaStore.cached(objectPath, name);
    if (mounted && f != null) setState(() => downloaded = true);
  }

  Future<String?> fetch() async {
    if (progress != null) return null;
    setState(() => progress = 0);
    try {
      final file = await MediaStore.download(objectPath, name, onProgress: (p) {
        if (mounted) setState(() => progress = p);
      });
      if (mounted) setState(() => downloaded = true);
      return file.path;
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Could not download "$name". Check your internet and try again.')),
        );
      }
      return null;
    } finally {
      if (mounted) setState(() => progress = null);
    }
  }

  Future<void> share() async {
    final path = await fetch();
    if (path != null) await Share.shareXFiles([XFile(path)], text: name);
  }

  Widget progressRing(Color color, {double size = 22}) => SizedBox(
        width: size,
        height: size,
        child: CircularProgressIndicator(
          strokeWidth: 2.5,
          value: (progress ?? 0) > 0 ? progress : null,
          color: color,
        ),
      );
}

/// Video in a chat bubble: tap downloads it (like WhatsApp), then plays it in the app.
class ChatVideoAttachment extends StatefulWidget {
  final String objectPath;
  final String name;
  final int? size;
  const ChatVideoAttachment({super.key, required this.objectPath, required this.name, this.size});

  @override
  State<ChatVideoAttachment> createState() => _ChatVideoAttachmentState();
}

class _ChatVideoAttachmentState extends State<ChatVideoAttachment> with _DownloadOnTap {
  @override
  String get objectPath => widget.objectPath;
  @override
  String get name => widget.name;

  @override
  void initState() {
    super.initState();
    checkCached();
  }

  Future<void> _open() async {
    final path = await fetch();
    if (path == null || !mounted) return;
    Navigator.push(context, MaterialPageRoute(builder: (_) => VideoPlayerScreen(filePath: path, name: widget.name)));
  }

  @override
  Widget build(BuildContext context) {
    final size = MediaStore.formatSize(widget.size);
    return GestureDetector(
      onTap: _open,
      onLongPress: share,
      child: Container(
        width: 240,
        height: 160,
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(14),
          gradient: const LinearGradient(colors: [Color(0xFF16244A), Color(0xFF0B1530)], begin: Alignment.topLeft, end: Alignment.bottomRight),
        ),
        child: Stack(
          children: [
            Center(
              child: Container(
                width: 56,
                height: 56,
                decoration: const BoxDecoration(color: Color(0x33FFFFFF), shape: BoxShape.circle),
                alignment: Alignment.center,
                child: progress != null
                    ? progressRing(AppColors.onAccent, size: 30)
                    : Icon(downloaded ? Icons.play_arrow_rounded : Icons.download_rounded, color: AppColors.onAccent, size: 34,
                        semanticLabel: downloaded ? 'Play video' : 'Download video'),
              ),
            ),
            Positioned(
              left: 10,
              right: 10,
              bottom: 8,
              child: Row(
                children: [
                  const Icon(Icons.videocam, color: Color(0xCCFFFFFF), size: 16),
                  const SizedBox(width: 6),
                  Expanded(
                    child: Text(widget.name, maxLines: 1, overflow: TextOverflow.ellipsis,
                        style: const TextStyle(color: Color(0xE6FFFFFF), fontSize: 12.5)),
                  ),
                  if (size.isNotEmpty) Text(size, style: const TextStyle(color: Color(0xB3FFFFFF), fontSize: 12)),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// Any other file (PDF, Word, Excel, PowerPoint, ZIP, music...). Tap downloads
/// it once and opens it in the phone's own app; the side button shares/saves it.
class ChatFileAttachment extends StatefulWidget {
  final String objectPath;
  final String name;
  final int? size;
  final String? mime;
  const ChatFileAttachment({super.key, required this.objectPath, required this.name, this.size, this.mime});

  @override
  State<ChatFileAttachment> createState() => _ChatFileAttachmentState();
}

class _ChatFileAttachmentState extends State<ChatFileAttachment> with _DownloadOnTap {
  @override
  String get objectPath => widget.objectPath;
  @override
  String get name => widget.name;

  @override
  void initState() {
    super.initState();
    checkCached();
  }

  (IconData, Color, String) get _style {
    final ext = MediaStore.extensionOf(widget.name);
    switch (ext) {
      case 'pdf':
        return (Icons.picture_as_pdf, const Color(0xFFE5484D), 'PDF');
      case 'doc' || 'docx' || 'odt' || 'rtf':
        return (Icons.description, const Color(0xFF2B6CEE), 'Word');
      case 'xls' || 'xlsx' || 'ods' || 'csv':
        return (Icons.grid_on, const Color(0xFF1F9D55), ext == 'csv' ? 'CSV' : 'Excel');
      case 'ppt' || 'pptx' || 'odp':
        return (Icons.slideshow, const Color(0xFFE8590C), 'PowerPoint');
      case 'zip' || 'rar' || '7z' || 'gz' || 'tar':
        return (Icons.folder_zip, const Color(0xFF8B5CF6), ext.toUpperCase());
      case 'txt' || 'json':
        return (Icons.article, const Color(0xFF64748B), ext.toUpperCase());
    }
    if (MediaStore.kindOf(widget.name, mime: widget.mime) == MediaKind.audio) {
      return (Icons.music_note, const Color(0xFFDB2777), 'Audio');
    }
    if (MediaStore.kindOf(widget.name, mime: widget.mime) == MediaKind.image) {
      return (Icons.image, const Color(0xFF0EA5E9), ext.toUpperCase());
    }
    return (Icons.insert_drive_file, const Color(0xFF64748B), ext.isEmpty ? 'File' : ext.toUpperCase());
  }

  Future<void> _open() async {
    final path = await fetch();
    if (path == null || !mounted) return;
    final result = await OpenFilex.open(path, type: widget.mime ?? MediaStore.contentTypeFor(widget.name));
    if (!mounted) return;
    if (result.type == ResultType.noAppToOpen) {
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(
        content: Text('No app on this phone can open ${_style.$3} files.'),
        action: SnackBarAction(label: 'Share', onPressed: share),
      ));
    } else if (result.type != ResultType.done) {
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Could not open "${widget.name}".')));
    }
  }

  @override
  Widget build(BuildContext context) {
    final (icon, color, label) = _style;
    final size = MediaStore.formatSize(widget.size);
    return Material(
      color: AppColors.surface,
      borderRadius: BorderRadius.circular(12),
      child: InkWell(
        borderRadius: BorderRadius.circular(12),
        onTap: _open,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(10, 10, 4, 10),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Container(
                width: 42,
                height: 42,
                decoration: BoxDecoration(color: color.withValues(alpha: 0.14), borderRadius: BorderRadius.circular(10)),
                child: Icon(icon, color: color, size: 24),
              ),
              const SizedBox(width: 10),
              Flexible(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text(widget.name, maxLines: 2, overflow: TextOverflow.ellipsis,
                        style: TextStyle(color: AppColors.ink, fontSize: 14.5, fontWeight: FontWeight.w600)),
                    const SizedBox(height: 2),
                    Text([label, if (size.isNotEmpty) size].join(' · '),
                        style: TextStyle(color: AppColors.textSecondary, fontSize: 12.5)),
                  ],
                ),
              ),
              IconButton(
                tooltip: downloaded ? 'Share or save' : 'Download',
                onPressed: progress != null ? null : (downloaded ? share : fetch),
                icon: progress != null
                    ? progressRing(AppColors.cyan)
                    : Icon(downloaded ? Icons.ios_share : Icons.download_rounded, color: AppColors.cyan),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
