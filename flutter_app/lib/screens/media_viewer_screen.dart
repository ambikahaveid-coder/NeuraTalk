import 'package:flutter/material.dart';

/// Full-screen viewer for a chat image attachment. Loads through the
/// authenticated object-storage URL already carried by the message.
class MediaViewerScreen extends StatelessWidget {
  final String imageUrl;
  const MediaViewerScreen({super.key, required this.imageUrl});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.black,
      appBar: AppBar(
        backgroundColor: Colors.black,
        iconTheme: const IconThemeData(color: Colors.white),
      ),
      body: Center(
        child: InteractiveViewer(
          minScale: 1,
          maxScale: 4,
          child: Image.network(
            imageUrl,
            errorBuilder: (ctx, err, st) => const Icon(Icons.broken_image, color: Colors.white54, size: 64),
          ),
        ),
      ),
    );
  }
}
