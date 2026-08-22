import 'dart:io';
import 'package:flutter/material.dart';
import 'package:path_provider/path_provider.dart';
import 'package:share_plus/share_plus.dart';
import '../services/api_service.dart';

/// Full-screen viewer for a chat image attachment. Loads through the
/// authenticated object-storage URL already carried by the message.
class MediaViewerScreen extends StatefulWidget {
  final String imageUrl;
  const MediaViewerScreen({super.key, required this.imageUrl});

  @override
  State<MediaViewerScreen> createState() => _MediaViewerScreenState();
}

class _MediaViewerScreenState extends State<MediaViewerScreen> {
  bool _saving = false;

  Future<void> _save() async {
    if (_saving) return;
    setState(() => _saving = true);
    try {
      // imageUrl is already absolute (baseUrl + object path) -- getBytes
      // wants just the path so the request goes through the app's own
      // authenticated client (the object is ACL-gated, not public).
      final path = widget.imageUrl.startsWith(ApiService.baseUrl)
          ? widget.imageUrl.substring(ApiService.baseUrl.length)
          : widget.imageUrl;
      final bytes = await ApiService.getBytes(path);
      final dir = await getTemporaryDirectory();
      final name = 'neuratalk-${DateTime.now().millisecondsSinceEpoch}.jpg';
      final file = File('${dir.path}/$name');
      await file.writeAsBytes(bytes);
      await Share.shareXFiles([XFile(file.path)]);
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Could not save this image.')),
        );
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
        iconTheme: const IconThemeData(color: Colors.white),
        actions: [
          IconButton(
            icon: _saving
                ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                : const Icon(Icons.download_outlined),
            onPressed: _saving ? null : _save,
            tooltip: 'Save',
          ),
        ],
      ),
      body: Center(
        child: InteractiveViewer(
          minScale: 1,
          maxScale: 4,
          child: Image.network(
            widget.imageUrl,
            errorBuilder: (ctx, err, st) => const Icon(Icons.broken_image, color: Colors.white54, size: 64),
          ),
        ),
      ),
    );
  }
}
