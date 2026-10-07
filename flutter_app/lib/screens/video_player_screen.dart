import 'dart:io';
import 'package:flutter/material.dart';
import 'package:share_plus/share_plus.dart';
import 'package:video_player/video_player.dart';

/// Plays a downloaded chat video full screen.
class VideoPlayerScreen extends StatefulWidget {
  final String filePath;
  final String name;
  const VideoPlayerScreen({super.key, required this.filePath, required this.name});

  @override
  State<VideoPlayerScreen> createState() => _VideoPlayerScreenState();
}

class _VideoPlayerScreenState extends State<VideoPlayerScreen> {
  late final VideoPlayerController _controller = VideoPlayerController.file(File(widget.filePath));
  bool _failed = false;
  bool _showControls = true;

  @override
  void initState() {
    super.initState();
    _controller.addListener(_onTick);
    _controller.initialize().then((_) {
      if (mounted) {
        setState(() {});
        _controller.play();
      }
    }).catchError((_) {
      if (mounted) setState(() => _failed = true);
    });
  }

  void _onTick() {
    if (mounted) setState(() {});
  }

  @override
  void dispose() {
    _controller.removeListener(_onTick);
    _controller.dispose();
    super.dispose();
  }

  String _fmt(Duration d) {
    final m = d.inMinutes.remainder(60).toString().padLeft(2, '0');
    final s = d.inSeconds.remainder(60).toString().padLeft(2, '0');
    return d.inHours > 0 ? '${d.inHours}:$m:$s' : '$m:$s';
  }

  @override
  Widget build(BuildContext context) {
    final v = _controller.value;
    return Scaffold(
      backgroundColor: Colors.black,
      appBar: AppBar(
        backgroundColor: Colors.black,
        foregroundColor: Colors.white,
        title: Text(widget.name, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(color: Colors.white, fontSize: 16)),
        actions: [
          IconButton(
            tooltip: 'Share or save',
            icon: const Icon(Icons.ios_share),
            onPressed: () => Share.shareXFiles([XFile(widget.filePath)], text: widget.name),
          ),
        ],
      ),
      body: _failed
          ? const Center(
              child: Padding(
                padding: EdgeInsets.all(32),
                child: Text('This video format can\'t be played on this phone. Use Share to open it in another app.',
                    textAlign: TextAlign.center, style: TextStyle(color: Colors.white70, fontSize: 16)),
              ),
            )
          : !v.isInitialized
              ? const Center(child: CircularProgressIndicator(color: Colors.white))
              : GestureDetector(
                  onTap: () => setState(() => _showControls = !_showControls),
                  child: Stack(
                    children: [
                      Center(child: AspectRatio(aspectRatio: v.aspectRatio, child: VideoPlayer(_controller))),
                      if (_showControls) ...[
                        Center(
                          child: IconButton.filled(
                            iconSize: 44,
                            style: IconButton.styleFrom(backgroundColor: Colors.black45),
                            onPressed: () => v.isPlaying ? _controller.pause() : _controller.play(),
                            icon: Icon(v.isPlaying ? Icons.pause : Icons.play_arrow, color: Colors.white,
                                semanticLabel: v.isPlaying ? 'Pause' : 'Play'),
                          ),
                        ),
                        Positioned(
                          left: 16,
                          right: 16,
                          bottom: 24,
                          child: SafeArea(
                            child: Row(
                              children: [
                                Text(_fmt(v.position), style: const TextStyle(color: Colors.white, fontSize: 13)),
                                const SizedBox(width: 10),
                                Expanded(
                                  child: VideoProgressIndicator(
                                    _controller,
                                    allowScrubbing: true,
                                    padding: const EdgeInsets.symmetric(vertical: 12),
                                    colors: const VideoProgressColors(playedColor: Color(0xFF4F8DFF), bufferedColor: Colors.white38, backgroundColor: Colors.white12),
                                  ),
                                ),
                                const SizedBox(width: 10),
                                Text(_fmt(v.duration), style: const TextStyle(color: Colors.white, fontSize: 13)),
                              ],
                            ),
                          ),
                        ),
                      ],
                    ],
                  ),
                ),
    );
  }
}
