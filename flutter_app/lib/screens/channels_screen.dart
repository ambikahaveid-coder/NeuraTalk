import 'dart:io';

import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';

import '../services/api_service.dart';
import '../services/media_store.dart';
import '../theme/app_theme.dart';
import '../widgets/chat_attachments.dart';
import '../widgets/nt_ui.dart';

/// Channels in the Updates tab: the ones I run and follow, plus Find and Create.
class ChannelsSection extends StatefulWidget {
  const ChannelsSection({super.key});
  @override
  State<ChannelsSection> createState() => ChannelsSectionState();
}

class ChannelsSectionState extends State<ChannelsSection> {
  List<Map<String, dynamic>> _channels = [];
  bool _loaded = false;

  @override
  void initState() {
    super.initState();
    reload();
  }

  Future<void> reload() async {
    try {
      final res = await ApiService.get('/api/channels/mine');
      if (mounted) {
        setState(() {
          _channels = ((res['channels'] as List?) ?? const []).whereType<Map>().map((e) => Map<String, dynamic>.from(e)).toList();
          _loaded = true;
        });
      }
    } catch (_) {
      if (mounted) setState(() => _loaded = true);
    }
  }

  Future<void> _open(Map<String, dynamic> c) async {
    await Navigator.push(context, MaterialPageRoute(builder: (_) => ChannelScreen(channelId: c['id'] as int, initial: c)));
    reload();
  }

  @override
  Widget build(BuildContext context) {
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      Padding(
        padding: const EdgeInsets.fromLTRB(16, 16, 8, 4),
        child: Row(children: [
          Expanded(child: Text('CHANNELS', style: TextStyle(color: AppColors.textMuted, fontSize: 12.5, fontWeight: FontWeight.w700, letterSpacing: 0.6))),
          TextButton(
            onPressed: () async {
              await Navigator.push(context, MaterialPageRoute(builder: (_) => const ChannelDirectoryScreen()));
              reload();
            },
            child: const Text('Find channels'),
          ),
        ]),
      ),
      if (_loaded && _channels.isEmpty)
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
          child: Text('Follow channels for news and updates in your language, or start your own.', style: TextStyle(color: AppColors.textSecondary)),
        ),
      for (final c in _channels)
        ListTile(
          contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 2),
          leading: NtAvatar(name: c['name']?.toString() ?? 'Channel', avatarUrl: c['avatarUrl']?.toString(), size: 48),
          title: Row(children: [
            Flexible(child: Text(c['name']?.toString() ?? '', maxLines: 1, overflow: TextOverflow.ellipsis, style: TextStyle(color: AppColors.ink, fontWeight: FontWeight.w600))),
            if (c['verified'] == true) ...[const SizedBox(width: 4), Icon(Icons.verified, size: 16, color: AppColors.cyan)],
            if (c['muted'] == true) ...[const SizedBox(width: 4), Icon(Icons.notifications_off_outlined, size: 15, color: AppColors.textMuted)],
          ]),
          subtitle: Text(
            c['isOwner'] == true
                ? 'Your channel · ${c['followers']} follower${c['followers'] == 1 ? '' : 's'}'
                : ((c['lastUpdate'] as Map?)?['text']?.toString() ?? ((c['lastUpdate'] as Map?)?['hasMedia'] == true ? '📷 Photo' : 'No updates yet')),
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: TextStyle(color: AppColors.textSecondary),
          ),
          trailing: (c['unread'] as num? ?? 0) > 0
              ? CircleAvatar(radius: 11, backgroundColor: AppColors.cyan, child: Text('${c['unread']}', style: const TextStyle(color: AppColors.onAccent, fontSize: 11, fontWeight: FontWeight.w700)))
              : null,
          onTap: () => _open(c),
        ),
      Padding(
        padding: const EdgeInsets.symmetric(horizontal: 16),
        child: Align(
          alignment: Alignment.centerLeft,
          child: TextButton.icon(
            onPressed: () async {
              final created = await showCreateChannelSheet(context);
              if (created != null && context.mounted) {
                reload();
                _open(created);
              }
            },
            icon: const Icon(Icons.add),
            label: const Text('Create channel'),
          ),
        ),
      ),
    ]);
  }
}

/// Name + description (+ optional photo) for a new channel.
Future<Map<String, dynamic>?> showCreateChannelSheet(BuildContext context) {
  final name = TextEditingController();
  final desc = TextEditingController();
  return showModalBottomSheet<Map<String, dynamic>>(
    context: context,
    isScrollControlled: true,
    backgroundColor: AppColors.surface,
    builder: (sheet) {
      String? error;
      bool busy = false;
      return StatefulBuilder(builder: (ctx, setSheet) => Padding(
        padding: EdgeInsets.only(bottom: MediaQuery.of(ctx).viewInsets.bottom),
        child: SafeArea(
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
              Text('Create a channel', style: TextStyle(color: AppColors.ink, fontSize: 20, fontWeight: FontWeight.w800)),
              const SizedBox(height: 6),
              Text('Anyone can find and follow it. Followers can\'t see each other, and you only see how many there are. Each follower reads your updates in their own language.',
                  style: TextStyle(color: AppColors.textSecondary, fontSize: 13)),
              const SizedBox(height: 12),
              TextField(controller: name, maxLength: 60, autofocus: true, style: TextStyle(color: AppColors.ink), decoration: const InputDecoration(labelText: 'Channel name')),
              TextField(controller: desc, maxLength: 500, maxLines: 3, minLines: 1, style: TextStyle(color: AppColors.ink), decoration: const InputDecoration(labelText: 'What is it about? (optional)')),
              if (error != null) Text(error!, style: const TextStyle(color: AppColors.red)),
              const SizedBox(height: 8),
              FilledButton(
                onPressed: busy
                    ? null
                    : () async {
                        setSheet(() { busy = true; error = null; });
                        try {
                          final res = await ApiService.post('/api/channels', {'name': name.text.trim(), if (desc.text.trim().isNotEmpty) 'description': desc.text.trim()});
                          if (ctx.mounted) Navigator.pop(ctx, Map<String, dynamic>.from(res['channel'] as Map));
                        } on ApiException catch (e) {
                          setSheet(() { busy = false; error = e.message; });
                        } catch (_) {
                          setSheet(() { busy = false; error = 'Could not create the channel.'; });
                        }
                      },
                child: Text(busy ? 'Creating…' : 'Create channel'),
              ),
            ]),
          ),
        ),
      ));
    },
  );
}

/// Directory: search and follow channels.
class ChannelDirectoryScreen extends StatefulWidget {
  const ChannelDirectoryScreen({super.key});
  @override
  State<ChannelDirectoryScreen> createState() => _ChannelDirectoryScreenState();
}

class _ChannelDirectoryScreenState extends State<ChannelDirectoryScreen> {
  List<Map<String, dynamic>>? _list;
  int _seq = 0;

  @override
  void initState() {
    super.initState();
    _search('');
  }

  Future<void> _search(String q) async {
    final seq = ++_seq;
    try {
      final res = await ApiService.get('/api/channels/discover?q=${Uri.encodeQueryComponent(q.trim())}');
      if (mounted && seq == _seq) setState(() => _list = ((res['channels'] as List?) ?? const []).whereType<Map>().map((e) => Map<String, dynamic>.from(e)).toList());
    } catch (_) {
      if (mounted && seq == _seq) setState(() => _list = []);
    }
  }

  Future<void> _toggle(Map<String, dynamic> c) async {
    final following = c['isFollowing'] == true;
    setState(() => c['isFollowing'] = !following);
    try {
      following ? await ApiService.delete('/api/channels/${c['id']}/follow') : await ApiService.post('/api/channels/${c['id']}/follow', {});
      setState(() => c['followers'] = ((c['followers'] as num?) ?? 0) + (following ? -1 : 1));
    } catch (_) {
      setState(() => c['isFollowing'] = following);
    }
  }

  @override
  Widget build(BuildContext context) {
    final list = _list;
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(title: const Text('Find channels')),
      body: Column(children: [
        Padding(
          padding: const EdgeInsets.all(16),
          child: TextField(
            style: TextStyle(color: AppColors.ink),
            decoration: const InputDecoration(prefixIcon: Icon(Icons.search), hintText: 'Search channels'),
            onChanged: _search,
          ),
        ),
        Expanded(
          child: list == null
              ? const Center(child: CircularProgressIndicator())
              : list.isEmpty
                  ? Center(child: Text('No channels found', style: TextStyle(color: AppColors.textMuted)))
                  : ListView.builder(
                      itemCount: list.length,
                      itemBuilder: (_, i) {
                        final c = list[i];
                        return ListTile(
                          leading: NtAvatar(name: c['name']?.toString() ?? 'Channel', avatarUrl: c['avatarUrl']?.toString(), size: 44),
                          title: Row(children: [
                            Flexible(child: Text(c['name']?.toString() ?? '', maxLines: 1, overflow: TextOverflow.ellipsis, style: TextStyle(color: AppColors.ink, fontWeight: FontWeight.w600))),
                            if (c['verified'] == true) ...[const SizedBox(width: 4), Icon(Icons.verified, size: 16, color: AppColors.cyan)],
                          ]),
                          subtitle: Text('${c['followers']} follower${c['followers'] == 1 ? '' : 's'}${(c['description'] ?? '').toString().isNotEmpty ? ' · ${c['description']}' : ''}',
                              maxLines: 2, overflow: TextOverflow.ellipsis, style: TextStyle(color: AppColors.textSecondary)),
                          trailing: c['isOwner'] == true
                              ? null
                              : (c['isFollowing'] == true
                                  ? OutlinedButton(onPressed: () => _toggle(c), child: const Text('Following'))
                                  : FilledButton(onPressed: () => _toggle(c), child: const Text('Follow'))),
                          onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => ChannelScreen(channelId: c['id'] as int, initial: c))),
                        );
                      },
                    ),
        ),
      ]),
    );
  }
}

/// One channel: its updates (in my language), reactions, follow/mute; the owner can post.
class ChannelScreen extends StatefulWidget {
  final int channelId;
  final Map<String, dynamic>? initial;
  const ChannelScreen({super.key, required this.channelId, this.initial});
  @override
  State<ChannelScreen> createState() => _ChannelScreenState();
}

class _ChannelScreenState extends State<ChannelScreen> {
  late Map<String, dynamic> _channel = Map<String, dynamic>.from(widget.initial ?? {});
  List<Map<String, dynamic>>? _updates;
  final _text = TextEditingController();
  bool _posting = false;
  static const _reactions = ['👍', '❤️', '😂', '😮', '😢', '🙏'];

  String get _base => '/api/channels/${widget.channelId}';

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _text.dispose();
    super.dispose();
  }

  void _toast(String t) {
    if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(t)));
  }

  Future<void> _load() async {
    try {
      final c = await ApiService.get(_base);
      final u = await ApiService.get('$_base/updates');
      if (!mounted) return;
      setState(() {
        _channel = Map<String, dynamic>.from(c['channel'] as Map);
        _updates = ((u['updates'] as List?) ?? const []).whereType<Map>().map((e) => Map<String, dynamic>.from(e)).toList();
      });
    } on ApiException catch (e) {
      if (mounted) {
        setState(() => _updates = []);
        _toast(e.message);
      }
    } catch (_) {
      if (mounted) setState(() => _updates = []);
    }
  }

  Future<void> _follow() async {
    final following = _channel['isFollowing'] == true;
    try {
      following ? await ApiService.delete('$_base/follow') : await ApiService.post('$_base/follow', {});
      _load();
    } catch (_) {
      _toast('Could not update. Check your connection.');
    }
  }

  Future<void> _mute(bool muted) async {
    try {
      await ApiService.patch('$_base/follow', {'muted': muted});
      setState(() => _channel['muted'] = muted);
    } catch (_) {
      _toast('Could not update notifications.');
    }
  }

  Future<void> _post({File? media, String? mediaName}) async {
    final text = _text.text.trim();
    if (text.isEmpty && media == null) return;
    setState(() => _posting = true);
    try {
      String? path;
      String? mime;
      if (media != null) {
        path = await MediaStore.upload(media, mediaName ?? 'photo.jpg');
        mime = MediaStore.contentTypeFor(mediaName ?? 'photo.jpg');
      }
      await ApiService.post('$_base/updates', {
        if (text.isNotEmpty) 'text': text,
        if (path != null) 'mediaUrl': path,
        if (mime != null) 'mediaMime': mime,
      });
      _text.clear();
      _load();
    } on ApiException catch (e) {
      _toast(e.message);
    } catch (_) {
      _toast('Could not post. Check your connection.');
    } finally {
      if (mounted) setState(() => _posting = false);
    }
  }

  Future<void> _pickMedia() async {
    final x = await ImagePicker().pickMedia();
    if (x == null) return;
    final kind = MediaStore.kindOf(x.name);
    if (kind != MediaKind.image && kind != MediaKind.video) return _toast('Channels take photos and videos.');
    await _post(media: File(x.path), mediaName: x.name);
  }

  Future<void> _react(Map<String, dynamic> u, String emoji) async {
    if (_channel['isFollowing'] != true) return _toast('Follow the channel to react.');
    final mine = u['myReaction']?.toString();
    try {
      final res = await ApiService.post('$_base/updates/${u['id']}/reaction', {'emoji': mine == emoji ? null : emoji});
      setState(() {
        u['reactions'] = res['reactions'];
        u['myReaction'] = res['myReaction'];
      });
    } catch (_) {
      _toast('Could not react.');
    }
  }

  Future<void> _deleteUpdate(Map<String, dynamic> u) async {
    try {
      await ApiService.delete('$_base/updates/${u['id']}');
      setState(() => _updates?.remove(u));
    } catch (_) {
      _toast('Could not delete.');
    }
  }

  Future<void> _deleteChannel() async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (d) => AlertDialog(
        title: const Text('Delete this channel?'),
        content: const Text('Followers will no longer see it. This can\'t be undone.'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(d, false), child: const Text('Cancel')),
          TextButton(onPressed: () => Navigator.pop(d, true), child: const Text('Delete', style: TextStyle(color: AppColors.red))),
        ],
      ),
    );
    if (ok != true) return;
    try {
      await ApiService.delete(_base);
      if (mounted) Navigator.pop(context);
    } catch (_) {
      _toast('Could not delete the channel.');
    }
  }

  Future<void> _report() async {
    try {
      await ApiService.post('/api/abuse/report', {'reportedEntityType': 'channel', 'reportedEntityId': widget.channelId, 'category': 'inappropriate'});
      _toast('Report sent. Thank you.');
    } catch (_) {
      _toast('Could not send the report.');
    }
  }

  static String _ago(dynamic raw) {
    final d = DateTime.tryParse(raw?.toString() ?? '')?.toLocal();
    if (d == null) return '';
    final h = d.hour % 12 == 0 ? 12 : d.hour % 12;
    return '${d.day}/${d.month} · $h:${d.minute.toString().padLeft(2, '0')} ${d.hour < 12 ? 'AM' : 'PM'}';
  }

  @override
  Widget build(BuildContext context) {
    final isOwner = _channel['isOwner'] == true;
    final following = _channel['isFollowing'] == true;
    final updates = _updates;
    return Scaffold(
      backgroundColor: AppColors.backgroundMid,
      appBar: AppBar(
        titleSpacing: 0,
        title: Row(children: [
          NtAvatar(name: _channel['name']?.toString() ?? 'Channel', avatarUrl: _channel['avatarUrl']?.toString(), size: 38),
          const SizedBox(width: 10),
          Expanded(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, mainAxisSize: MainAxisSize.min, children: [
              Row(children: [
                Flexible(child: Text(_channel['name']?.toString() ?? 'Channel', maxLines: 1, overflow: TextOverflow.ellipsis, style: TextStyle(color: AppColors.ink, fontSize: 17, fontWeight: FontWeight.w700))),
                if (_channel['verified'] == true) ...[const SizedBox(width: 4), Icon(Icons.verified, size: 16, color: AppColors.cyan)],
              ]),
              Text('${_channel['followers'] ?? 0} followers', style: TextStyle(color: AppColors.textSecondary, fontSize: 12.5)),
            ]),
          ),
        ]),
        actions: [
          PopupMenuButton<String>(
            onSelected: (v) {
              if (v == 'mute') _mute(_channel['muted'] != true);
              if (v == 'unfollow') _follow();
              if (v == 'delete') _deleteChannel();
              if (v == 'report') _report();
            },
            itemBuilder: (_) => [
              if (following) PopupMenuItem(value: 'mute', child: Text(_channel['muted'] == true ? 'Unmute' : 'Mute notifications')),
              if (following) const PopupMenuItem(value: 'unfollow', child: Text('Unfollow')),
              if (isOwner) const PopupMenuItem(value: 'delete', child: Text('Delete channel', style: TextStyle(color: AppColors.red))),
              if (!isOwner) const PopupMenuItem(value: 'report', child: Text('Report', style: TextStyle(color: AppColors.red))),
            ],
          ),
        ],
      ),
      body: Column(children: [
        if ((_channel['description'] ?? '').toString().isNotEmpty)
          Container(
            width: double.infinity,
            color: AppColors.background,
            padding: const EdgeInsets.fromLTRB(16, 10, 16, 10),
            child: Text(_channel['description'].toString(), style: TextStyle(color: AppColors.textSecondary)),
          ),
        Expanded(
          child: updates == null
              ? const Center(child: CircularProgressIndicator())
              : updates.isEmpty
                  ? Center(child: Text(isOwner ? 'Post your first update below.' : 'No updates in the last 30 days.', style: TextStyle(color: AppColors.textMuted)))
                  : RefreshIndicator(
                      onRefresh: _load,
                      child: ListView.builder(
                        reverse: true,
                        padding: const EdgeInsets.all(12),
                        itemCount: updates.length,
                        itemBuilder: (_, i) {
                          final u = updates[i];
                          final counts = ((u['reactions'] as Map?) ?? const {}).cast<String, dynamic>();
                          final mime = u['mediaMime']?.toString() ?? '';
                          return Card(
                            color: AppColors.surface,
                            margin: const EdgeInsets.symmetric(vertical: 6),
                            child: Padding(
                              padding: const EdgeInsets.all(12),
                              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                                if (u['mediaUrl'] != null)
                                  mime.startsWith('video')
                                      ? ChatVideoAttachment(objectPath: u['mediaUrl'].toString(), name: 'video.mp4')
                                      : ChatImageAttachment(objectPath: u['mediaUrl'].toString(), name: 'photo.jpg'),
                                if ((u['text'] ?? '').toString().isNotEmpty) ...[
                                  if (u['mediaUrl'] != null) const SizedBox(height: 8),
                                  Text(u['text'].toString(), style: TextStyle(color: AppColors.ink, fontSize: 16, height: 1.35)),
                                  if (u['translated'] == true)
                                    Padding(
                                      padding: const EdgeInsets.only(top: 4),
                                      child: Text('Translated · original: ${u['originalText']}', style: TextStyle(color: AppColors.textMuted, fontSize: 12.5)),
                                    ),
                                ],
                                const SizedBox(height: 8),
                                Row(children: [
                                  Text(_ago(u['createdAt']), style: TextStyle(color: AppColors.textMuted, fontSize: 12)),
                                  const Spacer(),
                                  if (counts.isNotEmpty)
                                    Text(counts.entries.map((e) => '${e.key} ${e.value}').join('  '), style: TextStyle(color: AppColors.textSecondary)),
                                  if (isOwner)
                                    IconButton(tooltip: 'Delete update', icon: Icon(Icons.delete_outline, color: AppColors.textMuted, size: 20), onPressed: () => _deleteUpdate(u)),
                                ]),
                                if (!isOwner)
                                  Wrap(spacing: 4, children: [
                                    for (final e in _reactions)
                                      InkWell(
                                        borderRadius: BorderRadius.circular(16),
                                        onTap: () => _react(u, e),
                                        child: Container(
                                          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                                          decoration: BoxDecoration(
                                            color: u['myReaction'] == e ? AppColors.blueTint : Colors.transparent,
                                            borderRadius: BorderRadius.circular(16),
                                          ),
                                          child: Text(e, style: const TextStyle(fontSize: 18)),
                                        ),
                                      ),
                                  ]),
                              ]),
                            ),
                          );
                        },
                      ),
                    ),
        ),
        if (isOwner)
          SafeArea(
            top: false,
            child: Container(
              padding: const EdgeInsets.fromLTRB(8, 6, 8, 8),
              decoration: BoxDecoration(color: AppColors.background, border: Border(top: BorderSide(color: AppColors.border))),
              child: Row(children: [
                IconButton(tooltip: 'Photo or video', icon: Icon(Icons.photo_outlined, color: AppColors.textMuted), onPressed: _posting ? null : _pickMedia),
                Expanded(
                  child: TextField(
                    controller: _text,
                    minLines: 1,
                    maxLines: 5,
                    maxLength: 4000,
                    style: TextStyle(color: AppColors.ink),
                    decoration: const InputDecoration(hintText: 'Write an update', counterText: '', isDense: true),
                  ),
                ),
                IconButton(
                  tooltip: 'Post',
                  icon: _posting ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2)) : Icon(Icons.send, color: AppColors.cyan),
                  onPressed: _posting ? null : () => _post(),
                ),
              ]),
            ),
          )
        else if (!following)
          SafeArea(
            top: false,
            child: Padding(
              padding: const EdgeInsets.all(12),
              child: SizedBox(width: double.infinity, child: FilledButton(onPressed: _follow, child: const Text('Follow'))),
            ),
          ),
      ]),
    );
  }
}
