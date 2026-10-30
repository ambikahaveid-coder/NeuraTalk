import 'dart:async';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';
import 'package:provider/provider.dart';

import '../providers/auth_provider.dart';
import '../services/api_service.dart';
import '../services/contact_resolver.dart';
import '../services/media_store.dart';
import '../theme/app_theme.dart';
import '../utils/languages.dart';
import '../widgets/nt_ui.dart';

/// Status updates: text or a photo that lasts 24 hours, seen by the people
/// you chat with. Text appears in each viewer's own language.
class UpdatesScreen extends StatefulWidget {
  const UpdatesScreen({super.key});

  @override
  State<UpdatesScreen> createState() => _UpdatesScreenState();
}

class _UpdatesScreenState extends State<UpdatesScreen> {
  List<Map<String, dynamic>> _mine = [];
  List<Map<String, dynamic>> _people = [];
  List<Map<String, dynamic>> _businesses = [];
  int _audience = 0;
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final res = await ApiService.get('/api/status/feed');
      if (!mounted) return;
      setState(() {
        _mine = ((res['mine'] as List?) ?? const []).cast<Map<String, dynamic>>();
        _people = ((res['people'] as List?) ?? const []).cast<Map<String, dynamic>>();
        _businesses = ((res['businesses'] as List?) ?? const []).whereType<Map>().map((m) => Map<String, dynamic>.from(m)).toList();
        _audience = (res['audienceSize'] as num?)?.toInt() ?? 0;
        _error = null;
        _loading = false;
      });
    } catch (_) {
      if (mounted) {
        setState(() {
          _error = "Couldn't load updates.";
          _loading = false;
        });
      }
    }
  }

  Widget _businessTile(Map<String, dynamic> entry) {
    final biz = (entry['business'] as Map?) ?? const {};
    final name = biz['name']?.toString() ?? 'Business';
    final updates = ((entry['updates'] as List?) ?? const []).whereType<Map>().map((m) => Map<String, dynamic>.from(m)).toList();
    return ListTile(
      contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 2),
      leading: _ring(seen: entry['allSeen'] == true, count: updates.length, child: NtAvatar(name: name, avatarUrl: biz['logoUrl']?.toString(), size: 48)),
      title: Row(children: [
        Flexible(child: Text(name, maxLines: 1, overflow: TextOverflow.ellipsis, style: TextStyle(color: AppColors.ink, fontWeight: FontWeight.w600))),
        if (biz['verified'] == true) ...[const SizedBox(width: 4), Icon(Icons.verified, size: 16, color: AppColors.cyan)],
      ]),
      subtitle: Text(_ago(updates.isEmpty ? null : updates.last['createdAt']), style: TextStyle(color: AppColors.textSecondary)),
      onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => StatusViewer(
        name: name,
        avatarUrl: biz['logoUrl']?.toString(),
        updates: updates,
        own: false,
      ))).then((_) => _load()),
    );
  }

  static String _ago(Object? raw) {
    final dt = DateTime.tryParse(raw?.toString() ?? '')?.toLocal();
    if (dt == null) return '';
    final diff = DateTime.now().difference(dt);
    if (diff.inMinutes < 1) return 'Just now';
    if (diff.inHours < 1) return '${diff.inMinutes} min ago';
    final h12 = dt.hour % 12 == 0 ? 12 : dt.hour % 12;
    final clock = '$h12:${dt.minute.toString().padLeft(2, '0')} ${dt.hour < 12 ? 'AM' : 'PM'}';
    return dt.day == DateTime.now().day ? 'Today, $clock' : 'Yesterday, $clock';
  }

  Future<void> _newText() async {
    final posted = await Navigator.push<bool>(context, MaterialPageRoute(fullscreenDialog: true, builder: (_) => const TextStatusComposer()));
    if (posted == true) _load();
  }

  Future<void> _newPhoto() async {
    final picked = await ImagePicker().pickImage(source: ImageSource.gallery, imageQuality: 85, maxWidth: 2048);
    if (picked == null || !mounted) return;
    final posted = await Navigator.push<bool>(context, MaterialPageRoute(fullscreenDialog: true, builder: (_) => PhotoStatusComposer(file: File(picked.path), name: picked.name)));
    if (posted == true) _load();
  }

  void _openMine() {
    if (_mine.isEmpty) {
      _newText();
      return;
    }
    final me = context.read<AuthProvider>().user;
    Navigator.push(context, MaterialPageRoute(builder: (_) => StatusViewer(
      name: 'My status',
      avatarUrl: me?['avatarUrl']?.toString(),
      updates: _mine,
      own: true,
    ))).then((_) => _load());
  }

  void _openPerson(Map<String, dynamic> person) {
    final user = (person['user'] as Map?) ?? const {};
    final name = ContactResolver.instance.nameFor(user['phone']?.toString()) ?? user['name']?.toString() ?? 'NeuraTalk user';
    Navigator.push(context, MaterialPageRoute(builder: (_) => StatusViewer(
      name: name,
      avatarUrl: user['avatarUrl']?.toString(),
      updates: ((person['updates'] as List?) ?? const []).cast<Map<String, dynamic>>(),
      own: false,
    ))).then((_) => _load());
  }

  Widget _ring({required Widget child, required bool seen, required int count}) {
    return Container(
      padding: const EdgeInsets.all(2.5),
      decoration: BoxDecoration(
        shape: BoxShape.circle,
        border: Border.all(color: count == 0 ? Colors.transparent : (seen ? AppColors.border : AppColors.cyan), width: 2.5),
      ),
      child: child,
    );
  }

  Widget _personTile(Map<String, dynamic> person) {
    final user = (person['user'] as Map?) ?? const {};
    final name = ContactResolver.instance.nameFor(user['phone']?.toString()) ?? user['name']?.toString() ?? 'NeuraTalk user';
    final updates = (person['updates'] as List?) ?? const [];
    final last = updates.isEmpty ? null : updates.last as Map;
    return ListTile(
      contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 2),
      leading: _ring(seen: person['allSeen'] == true, count: updates.length, child: NtAvatar(name: name, avatarUrl: user['avatarUrl']?.toString(), size: 48)),
      title: Text(name, style: TextStyle(color: AppColors.ink, fontWeight: FontWeight.w600)),
      subtitle: Text(_ago(last?['createdAt']), style: TextStyle(color: AppColors.textSecondary)),
      onTap: () => _openPerson(person),
    );
  }

  @override
  Widget build(BuildContext context) {
    final me = context.watch<AuthProvider>().user;
    final unseen = _people.where((p) => p['allSeen'] != true).toList();
    final viewed = _people.where((p) => p['allSeen'] == true).toList();
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(title: const Text('Updates')),
      floatingActionButton: Column(mainAxisSize: MainAxisSize.min, children: [
        FloatingActionButton.small(
          heroTag: 'status-text',
          tooltip: 'Text status',
          onPressed: _newText,
          backgroundColor: AppColors.surface,
          foregroundColor: AppColors.cyan,
          child: const Icon(Icons.edit),
        ),
        const SizedBox(height: 12),
        FloatingActionButton(
          heroTag: 'status-photo',
          tooltip: 'Photo status',
          onPressed: _newPhoto,
          backgroundColor: AppColors.cyan,
          foregroundColor: AppColors.onAccent,
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
          child: const Icon(Icons.photo_camera_outlined),
        ),
      ]),
      body: RefreshIndicator(
        onRefresh: _load,
        color: AppColors.cyan,
        child: ListView(
          padding: const EdgeInsets.only(bottom: 120),
          children: [
            ListTile(
              contentPadding: const EdgeInsets.fromLTRB(16, 8, 16, 8),
              leading: Stack(clipBehavior: Clip.none, children: [
                _ring(seen: false, count: _mine.length, child: NtAvatar(name: me?['displayName']?.toString() ?? 'Me', avatarUrl: me?['avatarUrl']?.toString(), size: 48)),
                if (_mine.isEmpty)
                  Positioned(
                    right: -2,
                    bottom: -2,
                    child: CircleAvatar(radius: 11, backgroundColor: AppColors.cyan, child: const Icon(Icons.add, size: 16, color: AppColors.onAccent)),
                  ),
              ]),
              title: Text('My status', style: TextStyle(color: AppColors.ink, fontWeight: FontWeight.w700)),
              subtitle: Text(
                _mine.isEmpty ? 'Share an update · it disappears after 24 hours' : '${_mine.length} update${_mine.length == 1 ? '' : 's'} · ${_ago(_mine.last['createdAt'])}',
                style: TextStyle(color: AppColors.textSecondary),
              ),
              onTap: _openMine,
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
              child: Text(
                _audience == 0
                    ? 'Your updates are shown to the people you chat with. Start a chat to share with someone.'
                    : 'Shown to the $_audience people you chat with, each in their own language.',
                style: TextStyle(color: AppColors.textMuted, fontSize: 12.5),
              ),
            ),
            if (_loading)
              Padding(padding: const EdgeInsets.only(top: 40), child: Center(child: CircularProgressIndicator(color: AppColors.cyan)))
            else if (_error != null)
              NtEmptyState(icon: Icons.wifi_off, title: _error!, message: 'Pull down to try again.', error: true)
            else if (_people.isEmpty && _businesses.isEmpty)
              const NtEmptyState(icon: Icons.amp_stories_outlined, title: 'No updates yet', message: 'When people you chat with share an update, it shows here.')
            else ...[
              if (unseen.isNotEmpty) const _Header('Recent updates'),
              for (final p in unseen) _personTile(p),
              if (viewed.isNotEmpty) const _Header('Viewed updates'),
              for (final p in viewed) _personTile(p),
              if (_businesses.isNotEmpty) const _Header('Businesses'),
              for (final b in _businesses) _businessTile(b),
            ],
          ],
        ),
      ),
    );
  }
}

class _Header extends StatelessWidget {
  final String text;
  const _Header(this.text);
  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.fromLTRB(16, 16, 16, 4),
        child: Text(text.toUpperCase(), style: TextStyle(color: AppColors.textMuted, fontSize: 12.5, fontWeight: FontWeight.w700, letterSpacing: 0.6)),
      );
}

/// Full-screen viewer: one update after another (5 s each, tap to skip).
class StatusViewer extends StatefulWidget {
  final String name;
  final String? avatarUrl;
  final List<Map<String, dynamic>> updates;
  final bool own;
  /// Set for a business's own updates (Business app): delete goes to the
  /// business, and views are shown as a count (customers stay private).
  final String? businessBase;
  const StatusViewer({super.key, required this.name, required this.avatarUrl, required this.updates, required this.own, this.businessBase});

  @override
  State<StatusViewer> createState() => _StatusViewerState();
}

class _StatusViewerState extends State<StatusViewer> with SingleTickerProviderStateMixin {
  late final AnimationController _progress = AnimationController(vsync: this, duration: const Duration(seconds: 5));
  int _index = 0;
  File? _photo;
  bool _showOriginal = false;

  @override
  void initState() {
    super.initState();
    // Start where the person hasn't watched yet.
    if (!widget.own) {
      final firstUnseen = widget.updates.indexWhere((u) => u['seen'] != true);
      if (firstUnseen > 0) _index = firstUnseen;
    }
    _progress.addStatusListener((s) {
      if (s == AnimationStatus.completed) _next();
    });
    _show();
  }

  @override
  void dispose() {
    _progress.dispose();
    super.dispose();
  }

  Map<String, dynamic> get _current => widget.updates[_index];

  Future<void> _show() async {
    _progress.stop();
    _progress.value = 0;
    setState(() {
      _photo = null;
      _showOriginal = false;
    });
    final u = _current;
    if (!widget.own && u['seen'] != true && u['id'] != null) {
      unawaited(ApiService.post('/api/status/${u['id']}/view', {}).then<void>((_) {
        u['seen'] = true;
      }).catchError((Object _) {}));
    }
    if (u['kind'] == 'photo' && u['mediaUrl'] != null) {
      try {
        final file = await MediaStore.download(u['mediaUrl'].toString(), 'status-${u['id']}.jpg');
        if (!mounted || _current != u) return;
        setState(() => _photo = file);
      } catch (_) {}
    }
    if (mounted) _progress.forward(from: 0);
  }

  void _next() {
    if (_index < widget.updates.length - 1) {
      setState(() => _index++);
      _show();
    } else {
      Navigator.pop(context);
    }
  }

  void _prev() {
    if (_index > 0) {
      setState(() => _index--);
      _show();
    } else {
      _show();
    }
  }

  Future<void> _viewers() async {
    if (widget.businessBase != null) {
      final n = (_current['viewCount'] as num?)?.toInt() ?? 0;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Seen by $n customer${n == 1 ? '' : 's'}')));
      return;
    }
    _progress.stop();
    List viewers = const [];
    try {
      final res = await ApiService.get('/api/status/${_current['id']}/viewers');
      viewers = (res['viewers'] as List?) ?? const [];
    } catch (_) {}
    if (!mounted) return;
    await showModalBottomSheet(
      context: context,
      backgroundColor: AppColors.surface,
      builder: (_) => SafeArea(
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          Padding(
            padding: const EdgeInsets.all(16),
            child: Text('Viewed by ${viewers.length}', style: TextStyle(color: AppColors.ink, fontSize: 17, fontWeight: FontWeight.w700)),
          ),
          if (viewers.isEmpty)
            Padding(padding: const EdgeInsets.only(bottom: 24), child: Text('No views yet', style: TextStyle(color: AppColors.textSecondary)))
          else
            Flexible(
              child: ListView(shrinkWrap: true, children: [
                for (final v in viewers.cast<Map>())
                  ListTile(
                    leading: NtAvatar(name: v['name']?.toString() ?? '', avatarUrl: v['avatarUrl']?.toString(), size: 40),
                    title: Text(ContactResolver.instance.nameFor(v['phone']?.toString()) ?? v['name']?.toString() ?? '', style: TextStyle(color: AppColors.ink)),
                    subtitle: Text(_UpdatesScreenState._ago(v['viewedAt']), style: TextStyle(color: AppColors.textSecondary)),
                  ),
              ]),
            ),
        ]),
      ),
    );
    if (mounted) _progress.forward();
  }

  Future<void> _delete() async {
    _progress.stop();
    final ok = await showDialog<bool>(
      context: context,
      builder: (d) => AlertDialog(
        title: const Text('Delete this update?'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(d, false), child: const Text('Cancel')),
          TextButton(onPressed: () => Navigator.pop(d, true), child: const Text('Delete', style: TextStyle(color: AppColors.red))),
        ],
      ),
    );
    if (ok != true) {
      if (mounted) _progress.forward();
      return;
    }
    try {
      await ApiService.delete('${widget.businessBase ?? '/api'}/status/${_current['id']}');
      if (mounted) Navigator.pop(context);
    } catch (_) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Could not delete.')));
    }
  }

  Color _bg(Object? hex) {
    final value = int.tryParse((hex?.toString() ?? '').replaceFirst('#', ''), radix: 16);
    return value == null ? const Color(0xFF1E66F5) : Color(0xFF000000 | value);
  }

  @override
  Widget build(BuildContext context) {
    final u = _current;
    final isPhoto = u['kind'] == 'photo';
    final text = u['text']?.toString();
    final original = u['originalText']?.toString();
    return Scaffold(
      backgroundColor: isPhoto ? Colors.black : _bg(u['background']),
      body: SafeArea(
        child: GestureDetector(
          onTapUp: (d) => d.localPosition.dx < MediaQuery.of(context).size.width / 3 ? _prev() : _next(),
          onLongPressStart: (_) => _progress.stop(),
          onLongPressEnd: (_) => _progress.forward(),
          child: Stack(children: [
            Positioned.fill(
              child: isPhoto
                  ? (_photo == null
                      ? const Center(child: CircularProgressIndicator(color: Colors.white))
                      : Image.file(_photo!, fit: BoxFit.contain))
                  : Center(
                      child: Padding(
                        padding: const EdgeInsets.all(28),
                        child: Text(_showOriginal && original != null ? original : (text ?? ''),
                            textAlign: TextAlign.center,
                            style: const TextStyle(color: Colors.white, fontSize: 28, fontWeight: FontWeight.w600, height: 1.3)),
                      ),
                    ),
            ),
            if (isPhoto && text != null && text.isNotEmpty)
              Positioned(
                left: 0,
                right: 0,
                bottom: 72,
                child: Container(
                  color: Colors.black54,
                  padding: const EdgeInsets.all(14),
                  child: Text(_showOriginal && original != null ? original : text, textAlign: TextAlign.center, style: const TextStyle(color: Colors.white, fontSize: 16)),
                ),
              ),
            // Progress bars, one per update.
            Positioned(
              left: 8,
              right: 8,
              top: 8,
              child: Row(children: [
                for (var i = 0; i < widget.updates.length; i++)
                  Expanded(
                    child: Padding(
                      padding: const EdgeInsets.symmetric(horizontal: 2),
                      child: AnimatedBuilder(
                        animation: _progress,
                        builder: (_, __) => LinearProgressIndicator(
                          value: i < _index ? 1 : (i == _index ? _progress.value : 0),
                          minHeight: 3,
                          color: Colors.white,
                          backgroundColor: Colors.white30,
                        ),
                      ),
                    ),
                  ),
              ]),
            ),
            Positioned(
              left: 4,
              right: 4,
              top: 18,
              child: Row(children: [
                IconButton(icon: const Icon(Icons.arrow_back, color: Colors.white), onPressed: () => Navigator.pop(context)),
                NtAvatar(name: widget.name, avatarUrl: widget.avatarUrl, size: 36),
                const SizedBox(width: 10),
                Expanded(
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Text(widget.name, style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w700, fontSize: 16)),
                    Text(_UpdatesScreenState._ago(u['createdAt']), style: const TextStyle(color: Colors.white70, fontSize: 12.5)),
                  ]),
                ),
                if (widget.own)
                  IconButton(icon: const Icon(Icons.delete_outline, color: Colors.white), tooltip: 'Delete', onPressed: _delete),
              ]),
            ),
            if (original != null)
              Positioned(
                left: 0,
                right: 0,
                bottom: widget.own ? 64 : 20,
                child: Center(
                  child: TextButton.icon(
                    style: TextButton.styleFrom(foregroundColor: Colors.white, backgroundColor: Colors.black26),
                    onPressed: () => setState(() => _showOriginal = !_showOriginal),
                    icon: const Icon(Icons.translate, size: 16),
                    label: Text(_showOriginal ? 'Show translation' : 'Original · ${Languages.name(u['originalLanguage']?.toString())}'),
                  ),
                ),
              ),
            if (widget.own)
              Positioned(
                left: 0,
                right: 0,
                bottom: 12,
                child: Center(
                  child: TextButton.icon(
                    style: TextButton.styleFrom(foregroundColor: Colors.white),
                    onPressed: _viewers,
                    icon: const Icon(Icons.visibility_outlined),
                    label: Text('${(u['viewCount'] as num?)?.toInt() ?? 0}'),
                  ),
                ),
              ),
          ]),
        ),
      ),
    );
  }
}

class TextStatusComposer extends StatefulWidget {
  /// Where the update is posted (a business posts to its own address).
  final String endpoint;
  const TextStatusComposer({super.key, this.endpoint = '/api/status'});
  @override
  State<TextStatusComposer> createState() => _TextStatusComposerState();
}

class _TextStatusComposerState extends State<TextStatusComposer> {
  static const _colors = ['#1E66F5', '#7C3AED', '#16A34A', '#EA580C', '#DB2777', '#0F172A'];
  final _ctrl = TextEditingController();
  int _color = 0;
  bool _posting = false;

  Future<void> _post() async {
    final text = _ctrl.text.trim();
    if (text.isEmpty || _posting) return;
    setState(() => _posting = true);
    try {
      await ApiService.post(widget.endpoint, {'kind': 'text', 'text': text, 'background': _colors[_color]});
      if (mounted) Navigator.pop(context, true);
    } catch (e) {
      if (mounted) {
        setState(() => _posting = false);
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e is ApiException && e.message.isNotEmpty ? e.message : 'Could not post. Try again.')));
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final bg = Color(0xFF000000 | int.parse(_colors[_color].substring(1), radix: 16));
    return Scaffold(
      backgroundColor: bg,
      appBar: AppBar(
        backgroundColor: Colors.transparent,
        foregroundColor: Colors.white,
        iconTheme: const IconThemeData(color: Colors.white),
        actions: [
          IconButton(
            tooltip: 'Change colour',
            icon: const Icon(Icons.palette_outlined, color: Colors.white),
            onPressed: () => setState(() => _color = (_color + 1) % _colors.length),
          ),
        ],
      ),
      body: Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: TextField(
            controller: _ctrl,
            autofocus: true,
            maxLength: 700,
            maxLines: null,
            textAlign: TextAlign.center,
            style: const TextStyle(color: Colors.white, fontSize: 28, fontWeight: FontWeight.w600),
            cursorColor: Colors.white,
            decoration: const InputDecoration(
              hintText: 'Type a status',
              hintStyle: TextStyle(color: Colors.white54),
              border: InputBorder.none,
              enabledBorder: InputBorder.none,
              focusedBorder: InputBorder.none,
              filled: false,
              counterStyle: TextStyle(color: Colors.white54),
            ),
          ),
        ),
      ),
      floatingActionButton: FloatingActionButton(
        tooltip: 'Post',
        onPressed: _post,
        backgroundColor: Colors.white,
        foregroundColor: bg,
        child: _posting ? SizedBox(width: 22, height: 22, child: CircularProgressIndicator(strokeWidth: 2, color: bg)) : const Icon(Icons.send),
      ),
    );
  }
}

class PhotoStatusComposer extends StatefulWidget {
  final File file;
  final String name;
  final String endpoint;
  const PhotoStatusComposer({super.key, required this.file, required this.name, this.endpoint = '/api/status'});
  @override
  State<PhotoStatusComposer> createState() => _PhotoStatusComposerState();
}

class _PhotoStatusComposerState extends State<PhotoStatusComposer> {
  final _caption = TextEditingController();
  double? _progress;

  Future<void> _post() async {
    if (_progress != null) return;
    setState(() => _progress = 0);
    try {
      final path = await MediaStore.upload(widget.file, widget.name, onProgress: (p) {
        if (mounted) setState(() => _progress = p);
      });
      await ApiService.post(widget.endpoint, {
        'kind': 'photo',
        'mediaUrl': path,
        if (_caption.text.trim().isNotEmpty) 'text': _caption.text.trim(),
      });
      if (mounted) Navigator.pop(context, true);
    } catch (e) {
      if (mounted) {
        setState(() => _progress = null);
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e is ApiException && e.message.isNotEmpty ? e.message : 'Could not post. Try again.')));
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.black,
      appBar: AppBar(backgroundColor: Colors.black, foregroundColor: Colors.white, iconTheme: const IconThemeData(color: Colors.white)),
      body: Column(children: [
        Expanded(child: Image.file(widget.file, fit: BoxFit.contain)),
        if (_progress != null) LinearProgressIndicator(value: _progress! > 0 ? _progress : null, color: AppColors.cyan),
        SafeArea(
          top: false,
          child: Padding(
            padding: const EdgeInsets.fromLTRB(12, 8, 12, 8),
            child: Row(children: [
              Expanded(
                child: TextField(
                  controller: _caption,
                  maxLength: 700,
                  style: const TextStyle(color: Colors.white),
                  decoration: const InputDecoration(
                    hintText: 'Add a caption',
                    hintStyle: TextStyle(color: Colors.white54),
                    counterText: '',
                    filled: true,
                    fillColor: Colors.white12,
                  ),
                ),
              ),
              const SizedBox(width: 8),
              FloatingActionButton.small(heroTag: 'post-photo', onPressed: _post, backgroundColor: AppColors.cyan, child: const Icon(Icons.send, color: AppColors.onAccent)),
            ]),
          ),
        ),
      ]),
    );
  }
}
