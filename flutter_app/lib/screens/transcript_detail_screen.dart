import 'dart:io';
import 'package:flutter/material.dart';
import 'package:path_provider/path_provider.dart';
import 'package:share_plus/share_plus.dart';
import '../theme/app_theme.dart';
import '../models/transcript.dart';
import '../services/transcript_service.dart';
import '../services/api_service.dart';
import '../services/contact_resolver.dart';
import '../providers/auth_provider.dart';
import '../utils/languages.dart';
import '../widgets/nt_ui.dart';
import 'package:provider/provider.dart';

class TranscriptDetailScreen extends StatefulWidget {
  final String callId;
  /// The call-history row, when opened from a list: name, type, time, duration.
  final Map<String, dynamic>? call;
  const TranscriptDetailScreen({super.key, required this.callId, this.call});

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
        title: Text('Delete transcript?', style: TextStyle(color: AppColors.textPrimary)),
        content: Text('This permanently deletes the transcript for this call. This cannot be undone.',
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
      return Center(child: CircularProgressIndicator(color: AppColors.cyan));
    }
    if (_error != null) {
      return Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            const Icon(Icons.error_outline, color: AppColors.red, size: 40),
            const SizedBox(height: 12),
            Text(_error!, style: TextStyle(color: AppColors.textSecondary), textAlign: TextAlign.center),
            const SizedBox(height: 16),
            ElevatedButton(onPressed: _load, child: const Text('Retry')),
          ],
        ),
      );
    }
    if (_segments.isEmpty) {
      return ListView(children: [
        if (widget.call != null) Padding(padding: const EdgeInsets.all(16), child: _header()),
        const NtEmptyState(
          icon: Icons.subtitles_off_outlined,
          title: 'No transcript for this call',
          message: 'Transcripts are saved when live translation runs during a call. Missed or very short calls have none.',
        ),
      ]);
    }
    final myId = context.read<AuthProvider>().user?['id']?.toString();
    final peer = _peerName();
    return Column(
      children: [
        Expanded(
          child: ListView.separated(
            padding: const EdgeInsets.all(16),
            itemCount: _segments.length + 1,
            separatorBuilder: (_, i) => SizedBox(height: i == 0 ? 20 : 12),
            itemBuilder: (_, i) {
              if (i == 0) return _header();
              final seg = _segments[i - 1];
              final mine = myId != null && seg.speakerIdentity == myId;
              return _SegmentTile(segment: seg, speaker: mine ? 'You' : peer, mine: mine);
            },
          ),
        ),
        _exportBar(),
      ],
    );
  }

  String _peerName() {
    final c = widget.call;
    final phone = c?['remotePhone']?.toString();
    return ContactResolver.instance.nameFor(phone) ?? c?['remoteName']?.toString() ?? phone ?? 'Other person';
  }

  /// Who, when, how long and which languages, above the lines.
  Widget _header() {
    final c = widget.call;
    final video = c?['callType'] == 'video';
    final when = _formatDate(c?['createdAt']?.toString());
    final secs = (c?['durationSeconds'] as num?)?.toInt();
    final duration = secs == null || secs <= 0 ? null : (secs < 60 ? '$secs sec' : '${secs ~/ 60} min ${secs % 60} sec');
    final langs = <String>{
      for (final s in _segments) ...[
        if (s.originalLanguage != null) s.originalLanguage!.split('-').first,
        if (s.translatedLanguage != null) s.translatedLanguage!.split('-').first,
      ]
    }.toList();
    return NtCard(
      padding: const EdgeInsets.all(16),
      child: Row(children: [
        NtAvatar(name: c == null ? '' : _peerName(), size: 52),
        const SizedBox(width: 14),
        Expanded(
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(c == null ? 'Call transcript' : _peerName(),
                maxLines: 1, overflow: TextOverflow.ellipsis, style: TextStyle(color: AppColors.ink, fontSize: 17, fontWeight: FontWeight.w700)),
            const SizedBox(height: 3),
            Row(children: [
              Icon(video ? Icons.videocam_outlined : Icons.call_outlined, size: 15, color: AppColors.textSecondary),
              const SizedBox(width: 4),
              Flexible(
                child: Text([video ? 'Video call' : 'Voice call', if (duration != null) duration].join(' · '),
                    maxLines: 1, overflow: TextOverflow.ellipsis, style: TextStyle(color: AppColors.textSecondary, fontSize: 13.5)),
              ),
            ]),
            if (when != null) ...[
              const SizedBox(height: 2),
              Text(when, style: TextStyle(color: AppColors.textMuted, fontSize: 13)),
            ],
            if (langs.length >= 2) ...[
              const SizedBox(height: 8),
              LanguagePairChip(mine: langs[0], theirs: langs[1], compact: true),
            ],
          ]),
        ),
      ]),
    );
  }

  static String? _formatDate(String? raw) {
    final dt = DateTime.tryParse(raw ?? '')?.toLocal();
    if (dt == null) return null;
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    final h = dt.hour % 12 == 0 ? 12 : dt.hour % 12;
    return '${dt.day} ${months[dt.month - 1]}, $h:${dt.minute.toString().padLeft(2, '0')} ${dt.hour < 12 ? 'AM' : 'PM'}';
  }

  Widget _exportBar() {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
      decoration: BoxDecoration(
        color: AppColors.backgroundMid,
        border: Border(top: BorderSide(color: AppColors.border, width: 0.5)),
      ),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceEvenly,
        children: [
          Text('Share as', style: TextStyle(color: AppColors.textSecondary, fontSize: 14)),
          _exportButton('txt', 'Text'),
          _exportButton('pdf', 'PDF'),
          _exportButton('docx', 'Word'),
        ],
      ),
    );
  }

  Widget _exportButton(String format, String label) {
    final busy = _exportingFormat == format;
    return TextButton.icon(
      onPressed: _exportingFormat == null ? () => _export(format) : null,
      icon: busy
          ? SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2, color: AppColors.cyan))
          : Icon(Icons.ios_share, color: AppColors.cyan, size: 18),
      label: Text(label, style: TextStyle(color: AppColors.cyan)),
    );
  }
}

class _SegmentTile extends StatelessWidget {
  final TranscriptSegment segment;
  final String speaker;
  final bool mine;
  const _SegmentTile({required this.segment, required this.speaker, required this.mine});

  @override
  Widget build(BuildContext context) {
    final fromLang = segment.originalLanguage?.split('-').first;
    final toLang = segment.translatedLanguage?.split('-').first;
    final hasTranslation = segment.translatedText.isNotEmpty && segment.translatedText != segment.originalText;
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: mine ? AppColors.blueTint : AppColors.surface,
        borderRadius: BorderRadius.circular(14),
        border: mine ? null : Border.all(color: AppColors.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Text(speaker, style: TextStyle(color: mine ? AppColors.cyan : AppColors.ink, fontSize: 13.5, fontWeight: FontWeight.w700)),
              const Spacer(),
              if (segment.createdAt != null)
                Text(_formatTime(segment.createdAt!), style: TextStyle(color: AppColors.textMuted, fontSize: 12.5)),
            ],
          ),
          const SizedBox(height: 8),
          if (fromLang != null)
            Text('Said · ${Languages.name(fromLang)}',
                style: TextStyle(color: AppColors.textMuted, fontSize: 11.5, fontWeight: FontWeight.w700, letterSpacing: 0.2)),
          Text(segment.originalText,
              style: TextStyle(
                  color: hasTranslation ? AppColors.textSecondary : AppColors.ink, fontSize: hasTranslation ? 14.5 : 16, height: 1.4)),
          if (hasTranslation) ...[
            const SizedBox(height: 8),
            if (toLang != null)
              Text('Heard · ${Languages.name(toLang)}',
                  style: TextStyle(color: AppColors.cyan, fontSize: 11.5, fontWeight: FontWeight.w700, letterSpacing: 0.2)),
            Text(segment.translatedText, style: TextStyle(color: AppColors.ink, fontSize: 16, height: 1.4, fontWeight: FontWeight.w500)),
          ],
        ],
      ),
    );
  }

  String _formatTime(String raw) {
    final dt = DateTime.tryParse(raw)?.toLocal();
    if (dt == null) return '';
    final h = dt.hour % 12 == 0 ? 12 : dt.hour % 12;
    return '$h:${dt.minute.toString().padLeft(2, '0')} ${dt.hour < 12 ? 'AM' : 'PM'}';
  }
}
