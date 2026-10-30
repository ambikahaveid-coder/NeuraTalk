import 'dart:io';

import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';
import 'package:provider/provider.dart';

import '../screens/updates_screen.dart' show StatusViewer, TextStatusComposer, PhotoStatusComposer;
import '../services/api_service.dart';
import '../theme/app_theme.dart';
import '../widgets/nt_ui.dart';
import 'business_account.dart';

/// The business's Status: offers and news that last 24 hours, shown in the
/// Updates tab of customers who chat with the business, each in their own
/// language. The business sees how many customers viewed each one.
class BusinessStatusScreen extends StatefulWidget {
  const BusinessStatusScreen({super.key});

  @override
  State<BusinessStatusScreen> createState() => _BusinessStatusScreenState();
}

class _BusinessStatusScreenState extends State<BusinessStatusScreen> {
  List<Map<String, dynamic>> _updates = [];
  int _audience = 0;
  bool _loading = true;
  String? _error;

  BusinessAccount get _account => context.read<BusinessAccount>();

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final res = await ApiService.get('${_account.base}/status');
      if (!mounted) return;
      setState(() {
        _updates = ((res['updates'] as List?) ?? const []).whereType<Map>().map((m) => Map<String, dynamic>.from(m)).toList();
        _audience = (res['audienceSize'] as num?)?.toInt() ?? 0;
        _loading = false;
        _error = null;
      });
    } catch (e) {
      if (mounted) {
        setState(() {
          _loading = false;
          _error = e is ApiException && e.statusCode == 403 ? 'You need chat access to post updates.' : "Couldn't load your updates.";
        });
      }
    }
  }

  Future<void> _newText() async {
    final posted = await Navigator.push<bool>(context, MaterialPageRoute(
      fullscreenDialog: true,
      builder: (_) => TextStatusComposer(endpoint: '${_account.base}/status'),
    ));
    if (posted == true) _load();
  }

  Future<void> _newPhoto() async {
    final picked = await ImagePicker().pickImage(source: ImageSource.gallery, imageQuality: 85, maxWidth: 2048);
    if (picked == null || !mounted) return;
    final posted = await Navigator.push<bool>(context, MaterialPageRoute(
      fullscreenDialog: true,
      builder: (_) => PhotoStatusComposer(file: File(picked.path), name: picked.name, endpoint: '${_account.base}/status'),
    ));
    if (posted == true) _load();
  }

  void _open(int index) {
    Navigator.push(context, MaterialPageRoute(builder: (_) => StatusViewer(
      name: _account.name,
      avatarUrl: _account.logoUrl,
      updates: _updates.sublist(index),
      own: true,
      businessBase: _account.base,
    ))).then((_) => _load());
  }

  static String _time(Object? raw) {
    final dt = DateTime.tryParse(raw?.toString() ?? '')?.toLocal();
    if (dt == null) return '';
    final h = dt.hour % 12 == 0 ? 12 : dt.hour % 12;
    final clock = '$h:${dt.minute.toString().padLeft(2, '0')} ${dt.hour < 12 ? 'AM' : 'PM'}';
    return dt.day == DateTime.now().day ? 'Today, $clock' : 'Yesterday, $clock';
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(title: const Text('Status')),
      floatingActionButton: Column(mainAxisSize: MainAxisSize.min, children: [
        FloatingActionButton.small(
          heroTag: 'biz-status-text',
          tooltip: 'Text update',
          onPressed: _newText,
          backgroundColor: AppColors.surface,
          foregroundColor: AppColors.cyan,
          child: const Icon(Icons.edit),
        ),
        const SizedBox(height: 12),
        FloatingActionButton(
          heroTag: 'biz-status-photo',
          tooltip: 'Photo update',
          onPressed: _newPhoto,
          backgroundColor: AppColors.cyan,
          foregroundColor: AppColors.onAccent,
          child: const Icon(Icons.photo_camera_outlined),
        ),
      ]),
      body: RefreshIndicator(
        onRefresh: _load,
        color: AppColors.cyan,
        child: ListView(padding: const EdgeInsets.only(bottom: 140), children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 16, 16, 8),
            child: Text(
              _audience == 0
                  ? 'Your updates show to customers who chat with you. Share your chat link to get customers.'
                  : 'Shown to $_audience customer${_audience == 1 ? '' : 's'} who chat with you, each in their own language. Updates disappear after 24 hours.',
              style: TextStyle(color: AppColors.textSecondary, fontSize: 13.5),
            ),
          ),
          if (_loading)
            Padding(padding: const EdgeInsets.only(top: 40), child: Center(child: CircularProgressIndicator(color: AppColors.cyan)))
          else if (_error != null)
            NtEmptyState(icon: Icons.amp_stories_outlined, title: _error!, message: 'Pull down to try again.', error: true)
          else if (_updates.isEmpty)
            const NtEmptyState(icon: Icons.amp_stories_outlined, title: 'No updates now', message: 'Post an offer or news — for example today\'s fresh stock or a festival discount.')
          else
            for (var i = _updates.length - 1; i >= 0; i--)
              ListTile(
                leading: CircleAvatar(
                  backgroundColor: AppColors.cyan.withValues(alpha: 0.12),
                  child: Icon(_updates[i]['kind'] == 'photo' ? Icons.photo_outlined : Icons.text_fields, color: AppColors.cyan),
                ),
                title: Text(
                  (_updates[i]['text']?.toString().isNotEmpty ?? false) ? _updates[i]['text'].toString() : 'Photo',
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(color: AppColors.ink),
                ),
                subtitle: Text(_time(_updates[i]['createdAt']), style: TextStyle(color: AppColors.textSecondary)),
                trailing: Row(mainAxisSize: MainAxisSize.min, children: [
                  Icon(Icons.visibility_outlined, size: 18, color: AppColors.textSecondary),
                  const SizedBox(width: 4),
                  Text('${_updates[i]['viewCount'] ?? 0}', style: TextStyle(color: AppColors.textSecondary)),
                ]),
                onTap: () => _open(i),
              ),
        ]),
      ),
    );
  }
}
