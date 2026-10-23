import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';
import 'package:share_plus/share_plus.dart';
import '../services/media_store.dart';

/// Full-screen photo (chat photo, GIF, profile photo, catalog item):
/// pinch or double-tap to zoom, drag to pan, swipe down to close, Share/Save.
class MediaViewerScreen extends StatefulWidget {
  final String objectPath;
  final String name;
  /// Shown in the top bar (e.g. the person's name for a profile photo).
  final String? title;
  const MediaViewerScreen({super.key, required this.objectPath, required this.name, this.title});

  @override
  State<MediaViewerScreen> createState() => _MediaViewerScreenState();
}

class _MediaViewerScreenState extends State<MediaViewerScreen> with SingleTickerProviderStateMixin {
  final _transform = TransformationController();
  late final AnimationController _zoomAnimation = AnimationController(vsync: this, duration: const Duration(milliseconds: 220))
    ..addListener(() {
      if (_zoomTween != null) _transform.value = _zoomTween!.evaluate(CurvedAnimation(parent: _zoomAnimation, curve: Curves.easeOut));
    });
  Matrix4Tween? _zoomTween;
  TapDownDetails? _doubleTapAt;
  bool _saving = false;
  double _dragY = 0;

  bool get _zoomed => _transform.value.getMaxScaleOnAxis() > 1.01;

  @override
  void dispose() {
    _zoomAnimation.dispose();
    _transform.dispose();
    super.dispose();
  }

  void _toggleZoom() {
    final end = _zoomed
        ? Matrix4.identity()
        : (() {
            // Zoom 2.5x around the point that was double-tapped.
            final p = _doubleTapAt?.localPosition ?? Offset.zero;
            const scale = 2.5;
            return Matrix4.identity()
              ..translateByDouble(-p.dx * (scale - 1), -p.dy * (scale - 1), 0, 1)
              ..scaleByDouble(scale, scale, 1, 1);
          })();
    _zoomTween = Matrix4Tween(begin: _transform.value, end: end);
    _zoomAnimation.forward(from: 0);
  }

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
    final fade = (1 - (_dragY.abs() / 400)).clamp(0.3, 1.0);
    return Scaffold(
      backgroundColor: Colors.black.withValues(alpha: fade),
      appBar: AppBar(
        backgroundColor: Colors.transparent,
        foregroundColor: Colors.white,
        iconTheme: const IconThemeData(color: Colors.white),
        title: widget.title == null ? null : Text(widget.title!, style: const TextStyle(color: Colors.white)),
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
      extendBodyBehindAppBar: true,
      body: GestureDetector(
        onDoubleTapDown: (d) => _doubleTapAt = d,
        onDoubleTap: _toggleZoom,
        // Swipe down (or up) to close, only when not zoomed in.
        onVerticalDragUpdate: _zoomed ? null : (d) => setState(() => _dragY += d.delta.dy),
        onVerticalDragEnd: _zoomed
            ? null
            : (d) {
                if (_dragY.abs() > 120 || (d.primaryVelocity ?? 0).abs() > 900) {
                  Navigator.of(context).maybePop();
                } else {
                  setState(() => _dragY = 0);
                }
              },
        child: Transform.translate(
          offset: Offset(0, _dragY),
          // The viewer fills the screen, so a zoomed photo uses the whole
          // screen (not just the photo's original box) and the double-tap
          // point lines up with what was tapped.
          child: SizedBox.expand(
            child: InteractiveViewer(
              transformationController: _transform,
              minScale: 1,
              maxScale: 6,
              clipBehavior: Clip.none,
              onInteractionEnd: (_) => setState(() {}),
              child: Center(
                child: Hero(
                  tag: widget.objectPath,
                  child: CachedNetworkImage(
                    imageUrl: MediaStore.urlFor(widget.objectPath),
                    cacheKey: widget.objectPath,
                    httpHeaders: MediaStore.authHeaders,
                    fit: BoxFit.contain,
                    placeholder: (_, __) => const Center(child: CircularProgressIndicator(color: Colors.white)),
                    errorWidget: (_, __, ___) => const Padding(
                      padding: EdgeInsets.all(32),
                      child: Text('This photo can\'t be shown on this phone. Use Share to open it in another app.',
                          textAlign: TextAlign.center, style: TextStyle(color: Colors.white70, fontSize: 16)),
                    ),
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
