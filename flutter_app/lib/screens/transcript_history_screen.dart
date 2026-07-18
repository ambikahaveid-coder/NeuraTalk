import 'dart:async';
import 'package:flutter/material.dart';
import '../theme/app_theme.dart';
import '../models/transcript.dart';
import '../services/transcript_service.dart';
import '../services/api_service.dart';
import 'transcript_detail_screen.dart';

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
      final data = await ApiService.get('/api/calls/history') as List;
      if (!mounted) return;
      setState(() {
        _results = data.cast<Map<String, dynamic>>().map((c) {
          return TranscriptSearchResult(
            id: c['id'] as int? ?? 0,
            callId: c['id'] as int?,
            originalText: c['remoteIdentifier'] ?? c['toNumber'] ?? c['fromNumber'] ?? 'Unknown',
            translatedText: c['status'] == 'missed' ? 'Missed call' : 'Completed call',
            createdAt: c['createdAt'] as String? ?? c['startedAt'] as String?,
          );
        }).toList();
        _total = _results.length;
        _offset = 0;
        _loading = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = e is ApiException ? e.message : 'Failed to load call history. Please try again.';
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
        _error = e is ApiException ? e.message : 'Search failed. Please try again.';
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
      MaterialPageRoute(builder: (_) => TranscriptDetailScreen(callId: result.callId!.toString())),
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
              style: const TextStyle(color: AppColors.textPrimary),
              decoration: const InputDecoration(
                hintText: 'Search transcripts…',
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
            ElevatedButton(
              onPressed: () => _query.length >= 2 ? _runSearch(reset: true) : _loadCallHistoryAsTranscripts(),
              child: const Text('Retry'),
            ),
          ],
        ),
      );
    }
    if (_results.isEmpty) {
      return Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            const Icon(Icons.description_outlined, color: AppColors.textMuted, size: 48),
            const SizedBox(height: 12),
            Text(
              _query.length >= 2 ? 'No transcripts match "$_query"' : 'No calls yet',
              style: const TextStyle(color: AppColors.textMuted),
            ),
          ],
        ),
      );
    }
    return ListView.separated(
      controller: _scrollController,
      padding: const EdgeInsets.symmetric(vertical: 8),
      itemCount: _results.length + (_loadingMore ? 1 : 0),
      separatorBuilder: (_, __) => const Divider(color: AppColors.border, height: 1, indent: 16, endIndent: 16),
      itemBuilder: (_, i) {
        if (i >= _results.length) {
          return const Padding(
            padding: EdgeInsets.all(16),
            child: Center(child: CircularProgressIndicator(color: AppColors.cyan, strokeWidth: 2)),
          );
        }
        final result = _results[i];
        return ListTile(
          leading: const CircleAvatar(
            backgroundColor: AppColors.surfaceElevated,
            child: Icon(Icons.description_outlined, color: AppColors.cyan, size: 20),
          ),
          title: Text(
            result.originalText,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: const TextStyle(color: AppColors.textPrimary, fontWeight: FontWeight.w600),
          ),
          subtitle: Text(
            result.translatedText,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: const TextStyle(color: AppColors.textMuted, fontSize: 12),
          ),
          trailing: const Icon(Icons.chevron_right, color: AppColors.textMuted),
          onTap: () => _openTranscript(result),
        );
      },
    );
  }
}
