import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';
import 'package:share_plus/share_plus.dart';
import '../services/media_store.dart';

/// Full-screen, zoomable view of a chat photo/GIF, with Share / Save.
class MediaViewerScreen extends StatefulWidget {
  final String objectPath;
  final String name;
  const MediaViewerScreen({super.key, required this.objectPath, required this.name});

  @override
  State<MediaViewerScreen> createState() => _MediaViewerScreenState();
}

class _MediaViewerScreenState extends State<MediaViewerScreen> {
  bool _saving = false;

  Future<void> _share() async {
    if (_saving) return;
    setState(() => _saving = true);
    try {
      final file = await MediaStore.download(widget.objectPath, widget.name);
      await Share.shareXFiles([XFile(file.path)]);
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Could not save this photo.')));
      }
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.black,
      appBar: AppBar(
        backgroundColor: Colors.black,
        foregroundColor: Colors.white,
        iconTheme: const IconThemeData(color: Colors.white),
        actions: [
          IconButton(
            icon: _saving
                ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                : const Icon(Icons.ios_share),
            onPressed: _saving ? null : _share,
            tooltip: 'Share or save',
          ),
        ],
      ),
      body: Center(
        child: InteractiveViewer(
          minScale: 1,
          maxScale: 5,
          child: Hero(
            tag: widget.objectPath,
            child: CachedNetworkImage(
              imageUrl: MediaStore.urlFor(widget.objectPath),
              cacheKey: widget.objectPath,
              httpHeaders: MediaStore.authHeaders,
              fit: BoxFit.contain,
              placeholder: (_, __) => const CircularProgressIndicator(color: Colors.white),
              errorWidget: (_, __, ___) => const Padding(
                padding: EdgeInsets.all(32),
                child: Text('This photo can\'t be shown on this phone. Use Share to open it in another app.',
                    textAlign: TextAlign.center, style: TextStyle(color: Colors.white70, fontSize: 16)),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
