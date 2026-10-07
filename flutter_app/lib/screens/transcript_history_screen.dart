import 'dart:async';
import 'package:flutter/material.dart';
import '../theme/app_theme.dart';
import '../models/transcript.dart';
import '../services/transcript_service.dart';
import '../services/api_service.dart';
import 'transcript_detail_screen.dart';
import '../services/contact_resolver.dart';
import '../widgets/nt_ui.dart';

class TranscriptHistoryScreen extends StatefulWidget {
  const TranscriptHistoryScreen({super.key});

  @override
  State<TranscriptHistoryScreen> createState() => _TranscriptHistoryScreenState();
}

class _TranscriptHistoryScreenState extends State<TranscriptHistoryScreen> {
  static const int _pageSize = 20;

  final _controller = TextEditingController();
  final _scrollController = ScrollController();
  Timer? _debounce;

  bool _loading = true;
  bool _loadingMore = false;
  String? _error;
  List<TranscriptSearchResult> _results = [];
  int _total = 0;
  int _offset = 0;
  String _query = '';
  /// Call-history rows by callId, so tiles and the detail header can show who/when.
  final Map<String, Map<String, dynamic>> _calls = {};

  @override
  void initState() {
    super.initState();
    _loadCallHistoryAsTranscripts();
    _scrollController.addListener(_onScroll);
  }

  @override
  void dispose() {
    _debounce?.cancel();
    _controller.dispose();
    _scrollController.dispose();
    super.dispose();
  }

  void _onScroll() {
    if (_query.length < 2) return; // pagination only applies to search results
    if (!_loadingMore && _scrollController.position.pixels > _scrollController.position.maxScrollExtent - 200) {
      _loadMore();
    }
  }

  void _onSearchChanged(String value) {
    _debounce?.cancel();
    _debounce = Timer(const Duration(milliseconds: 400), () {
      setState(() => _query = value.trim());
      if (_query.length >= 2) {
        _runSearch(reset: true);
      } else {
        _loadCallHistoryAsTranscripts();
      }
    });
  }

  /// "History" mode (no active search) — reuses /api/calls/history, the
  /// same endpoint CallsScreen already uses, rather than duplicating a
  /// transcript-listing endpoint that doesn't otherwise exist server-side.
  Future<void> _loadCallHistoryAsTranscripts() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      // /api/calls/history returns { calls: [...] } (same shape CallsScreen reads).
      final data = await ApiService.get('/api/calls/history?limit=100');
      final list = data is Map<String, dynamic> ? (data['calls'] as List? ?? const []) : (data as List? ?? const []);
      if (!mounted) return;
      setState(() {
        var i = 0;
        _calls.clear();
        for (final c in list.cast<Map<String, dynamic>>()) {
          if (c['callId'] != null) _calls[c['callId'].toString()] = c;
        }
        _results = list.cast<Map<String, dynamic>>().map((c) {
          final phone = c['remotePhone']?.toString();
          final outcome = c['outcome']?.toString();
          return TranscriptSearchResult(
            id: i++,
            callId: c['callId']?.toString(),
            originalText: ContactResolver.instance.nameFor(phone) ?? c['remoteName']?.toString() ?? phone ?? 'Unknown',
            translatedText: outcome == 'missed'
                ? 'Missed call'
                : outcome == 'not_answered'
                    ? 'Not answered'
                    : (c['callType'] == 'video' ? 'Video call' : 'Voice call'),
            createdAt: c['createdAt'] as String?,
          );
        }).toList();
        _total = _results.length;
        _offset = 0;
        _loading = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = e is ApiException ? e.message : "Couldn't load your calls. Check your connection and try again.";
        _loading = false;
      });
    }
  }

  Future<void> _runSearch({required bool reset}) async {
    if (reset) {
      setState(() {
        _loading = true;
        _error = null;
        _results = [];
        _offset = 0;
      });
    }
    try {
      final page = await TranscriptService.search(_query, limit: _pageSize, offset: reset ? 0 : _offset);
      if (!mounted) return;
      setState(() {
        _results = reset ? page.results : [..._results, ...page.results];
        _total = page.total;
        _offset = page.offset + page.results.length;
        _loading = false;
        _loadingMore = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = e is ApiException ? e.message : "Couldn't search right now. Try again.";
        _loading = false;
        _loadingMore = false;
      });
    }
  }

  Future<void> _loadMore() async {
    if (_offset >= _total) return;
    setState(() => _loadingMore = true);
    await _runSearch(reset: false);
  }

  Future<void> _openTranscript(TranscriptSearchResult result) async {
    if (result.callId == null) return;
    final deleted = await Navigator.push<bool>(
      context,
      MaterialPageRoute(builder: (_) => TranscriptDetailScreen(callId: result.callId!, call: _calls[result.callId])),
    );
    if (deleted == true) {
      if (_query.length >= 2) {
        _runSearch(reset: true);
      } else {
        _loadCallHistoryAsTranscripts();
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(title: const Text('Transcripts')),
      body: Column(
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 12, 16, 8),
            child: TextField(
              controller: _controller,
              onChanged: _onSearchChanged,
              style: TextStyle(color: AppColors.ink, fontSize: 16),
              decoration: InputDecoration(
                hintText: 'Search words said in your calls',
                prefixIcon: Icon(Icons.search, color: AppColors.textMuted),
              ),
            ),
          ),
          Expanded(child: _buildBody()),
        ],
      ),
    );
  }

  Widget _buildBody() {
    final searching = _query.length >= 2;
    if (_loading) {
      return Center(child: CircularProgressIndicator(color: AppColors.cyan));
    }
    if (_error != null) {
      return NtEmptyState(
        icon: Icons.wifi_off,
        title: "Couldn't load transcripts",
        message: _error!,
        error: true,
        actionLabel: 'Try again',
        onAction: () => searching ? _runSearch(reset: true) : _loadCallHistoryAsTranscripts(),
      );
    }
    if (_results.isEmpty) {
      return searching
          ? NtEmptyState(
              icon: Icons.search_off,
              title: 'Nothing found for "$_query"',
              message: 'Try another word. Search looks through what was said in your translated calls.',
            )
          : const NtEmptyState(
              icon: Icons.subtitles_outlined,
              title: 'No call transcripts yet',
              message: 'After a translated call, you can read what was said here, in both languages, and share it.',
            );
    }
    return ListView.separated(
      controller: _scrollController,
      padding: const EdgeInsets.only(top: 4, bottom: 24),
      itemCount: _results.length + (_loadingMore ? 1 : 0),
      separatorBuilder: (_, __) => Divider(color: AppColors.border, height: 1, indent: searching ? 20 : 80),
      itemBuilder: (_, i) {
        if (i >= _results.length) {
          return Padding(
            padding: const EdgeInsets.all(16),
            child: Center(child: CircularProgressIndicator(color: AppColors.cyan, strokeWidth: 2)),
          );
        }
        final result = _results[i];
        return searching ? _searchTile(result) : _callTile(result);
      },
    );
  }

  Widget _callTile(TranscriptSearchResult result) {
    final call = _calls[result.callId];
    final missed = result.translatedText == 'Missed call' || result.translatedText == 'Not answered';
    final video = call?['callType'] == 'video';
    final name = result.originalText;
    final looksLikeNumber = name.startsWith('+') || RegExp(r'^\d').hasMatch(name);
    return ListTile(
      contentPadding: const EdgeInsets.fromLTRB(16, 4, 12, 4),
      leading: NtAvatar(name: looksLikeNumber ? '' : name, size: 48),
      title: Text(name,
          maxLines: 1, overflow: TextOverflow.ellipsis, style: TextStyle(color: AppColors.ink, fontSize: 16, fontWeight: FontWeight.w600)),
      subtitle: Row(children: [
        Icon(missed ? Icons.call_missed : (video ? Icons.videocam_outlined : Icons.call_outlined),
            size: 15, color: missed ? AppColors.red : AppColors.textSecondary),
        const SizedBox(width: 4),
        Flexible(
          child: Text([result.translatedText, if (_when(result.createdAt) != null) _when(result.createdAt)!].join(' · '),
              maxLines: 1, overflow: TextOverflow.ellipsis, style: TextStyle(color: AppColors.textSecondary, fontSize: 14)),
        ),
      ]),
      trailing: Icon(Icons.chevron_right, color: AppColors.textMuted),
      onTap: () => _openTranscript(result),
    );
  }

  Widget _searchTile(TranscriptSearchResult result) {
    return InkWell(
      onTap: () => _openTranscript(result),
      child: Padding(
        padding: const EdgeInsets.fromLTRB(20, 14, 16, 14),
        child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Container(width: 3, height: 40, margin: const EdgeInsets.only(top: 2, right: 14), color: AppColors.cyan),
          Expanded(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(result.translatedText,
                  maxLines: 2, overflow: TextOverflow.ellipsis, style: TextStyle(color: AppColors.ink, fontSize: 15.5, height: 1.35)),
              if (result.originalText.isNotEmpty && result.originalText != result.translatedText) ...[
                const SizedBox(height: 3),
                Text(result.originalText,
                    maxLines: 1, overflow: TextOverflow.ellipsis, style: TextStyle(color: AppColors.textSecondary, fontSize: 13.5)),
              ],
              if (_when(result.createdAt) != null) ...[
                const SizedBox(height: 4),
                Text(_when(result.createdAt)!, style: TextStyle(color: AppColors.textMuted, fontSize: 12.5)),
              ],
            ]),
          ),
          Icon(Icons.chevron_right, color: AppColors.textMuted),
        ]),
      ),
    );
  }

  /// "Today, 4:12 PM" · "Yesterday, 9:03 AM" · "3 Oct, 6:40 PM"
  static String? _when(String? raw) {
    final dt = DateTime.tryParse(raw ?? '')?.toLocal();
    if (dt == null) return null;
    final now = DateTime.now();
    final days = DateTime(now.year, now.month, now.day).difference(DateTime(dt.year, dt.month, dt.day)).inDays;
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    final h = dt.hour % 12 == 0 ? 12 : dt.hour % 12;
    final time = '$h:${dt.minute.toString().padLeft(2, '0')} ${dt.hour < 12 ? 'AM' : 'PM'}';
    final day = days == 0 ? 'Today' : days == 1 ? 'Yesterday' : '${dt.day} ${months[dt.month - 1]}';
    return '$day, $time';
  }
}
