import 'dart:io';
import 'package:flutter/material.dart';
import 'package:path_provider/path_provider.dart';
import 'package:share_plus/share_plus.dart';
import '../theme/app_theme.dart';
import '../models/transcript.dart';
import '../services/transcript_service.dart';
import '../services/api_service.dart';

class TranscriptDetailScreen extends StatefulWidget {
  final String callId;
  const TranscriptDetailScreen({super.key, required this.callId});

  @override
  State<TranscriptDetailScreen> createState() => _TranscriptDetailScreenState();
}

class _TranscriptDetailScreenState extends State<TranscriptDetailScreen> {
  bool _loading = true;
  String? _error;
  List<TranscriptSegment> _segments = [];
  String? _exportingFormat;
  bool _deleting = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final segments = await TranscriptService.getTranscript(widget.callId);
      if (!mounted) return;
      setState(() {
        _segments = segments;
        _loading = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = e is ApiException ? e.message : 'Failed to load transcript. Please try again.';
        _loading = false;
      });
    }
  }

  Future<void> _export(String format) async {
    if (_exportingFormat != null) return;
    setState(() => _exportingFormat = format);
    final messenger = ScaffoldMessenger.of(context);
    try {
      final bytes = await TranscriptService.exportBytes(widget.callId, format);
      final dir = await getTemporaryDirectory();
      final file = File('${dir.path}/transcript-${widget.callId}.$format');
      await file.writeAsBytes(bytes);
      await Share.shareXFiles([XFile(file.path)], text: 'Call transcript');
    } catch (e) {
      final message = e is ApiException ? e.message : 'Export failed. Please try again.';
      messenger.showSnackBar(SnackBar(content: Text(message)));
    } finally {
      if (mounted) setState(() => _exportingFormat = null);
    }
  }

  Future<void> _delete() async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (_) => AlertDialog(
        backgroundColor: AppColors.surface,
        title: const Text('Delete transcript?', style: TextStyle(color: AppColors.textPrimary)),
        content: const Text('This permanently deletes the transcript for this call. This cannot be undone.',
            style: TextStyle(color: AppColors.textSecondary)),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Cancel')),
          TextButton(
            onPressed: () => Navigator.pop(context, true),
            child: const Text('Delete', style: TextStyle(color: AppColors.red)),
          ),
        ],
      ),
    );
    if (confirmed != true) return;

    setState(() => _deleting = true);
    final navigator = Navigator.of(context);
    final messenger = ScaffoldMessenger.of(context);
    try {
      await TranscriptService.delete(widget.callId);
      if (!mounted) return;
      navigator.pop(true);
    } catch (e) {
      if (!mounted) return;
      setState(() => _deleting = false);
      final message = e is ApiException ? e.message : 'Failed to delete transcript. Please try again.';
      messenger.showSnackBar(SnackBar(content: Text(message)));
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(
        title: const Text('Transcript'),
        actions: [
          if (!_loading && _error == null && _segments.isNotEmpty)
            IconButton(
              icon: _deleting
                  ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2, color: AppColors.red))
                  : const Icon(Icons.delete_outline, color: AppColors.red),
              onPressed: _deleting ? null : _delete,
            ),
        ],
      ),
      body: _buildBody(),
    );
  }

  Widget _buildBody() {
    if (_loading) {
      return const Center(child: CircularProgressIndicator(color: AppColors.cyan));
    }
    if (_error != null) {
      return Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            const Icon(Icons.error_outline, color: AppColors.red, size: 40),
            const SizedBox(height: 12),
            Text(_error!, style: const TextStyle(color: AppColors.textSecondary), textAlign: TextAlign.center),
            const SizedBox(height: 16),
            ElevatedButton(onPressed: _load, child: const Text('Retry')),
          ],
        ),
      );
    }
    if (_segments.isEmpty) {
      return const Center(
        child: Text('No transcript available for this call', style: TextStyle(color: AppColors.textMuted)),
      );
    }
    return Column(
      children: [
        Expanded(
          child: ListView.separated(
            padding: const EdgeInsets.all(16),
            itemCount: _segments.length,
            separatorBuilder: (_, __) => const SizedBox(height: 12),
            itemBuilder: (_, i) => _SegmentTile(segment: _segments[i]),
          ),
        ),
        _exportBar(),
      ],
    );
  }

  Widget _exportBar() {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
      decoration: const BoxDecoration(
        color: AppColors.backgroundMid,
        border: Border(top: BorderSide(color: AppColors.border, width: 0.5)),
      ),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceEvenly,
        children: [
          _exportButton('txt', 'TXT'),
          _exportButton('pdf', 'PDF'),
          _exportButton('docx', 'DOCX'),
        ],
      ),
    );
  }

  Widget _exportButton(String format, String label) {
    final busy = _exportingFormat == format;
    return TextButton.icon(
      onPressed: _exportingFormat == null ? () => _export(format) : null,
      icon: busy
          ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2, color: AppColors.cyan))
          : const Icon(Icons.ios_share, color: AppColors.cyan, size: 18),
      label: Text(label, style: const TextStyle(color: AppColors.cyan)),
    );
  }
}

class _SegmentTile extends StatelessWidget {
  final TranscriptSegment segment;
  const _SegmentTile({required this.segment});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: AppColors.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              if (segment.speakerIdentity != null)
                Text(segment.speakerIdentity!, style: const TextStyle(color: AppColors.textMuted, fontSize: 11, fontWeight: FontWeight.w600)),
              const Spacer(),
              if (segment.createdAt != null)
                Text(_formatTime(segment.createdAt!), style: const TextStyle(color: AppColors.textMuted, fontSize: 11)),
            ],
          ),
          const SizedBox(height: 6),
          Text(segment.originalText, style: const TextStyle(color: AppColors.textSecondary, fontSize: 13)),
          const SizedBox(height: 4),
          Text(segment.translatedText, style: const TextStyle(color: AppColors.textPrimary, fontSize: 15, fontWeight: FontWeight.w500)),
        ],
      ),
    );
  }

  String _formatTime(String raw) {
    try {
      final dt = DateTime.parse(raw).toLocal();
      return '${dt.hour.toString().padLeft(2, '0')}:${dt.minute.toString().padLeft(2, '0')}';
    } catch (_) {
      return '';
    }
  }
}
