import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_contacts/flutter_contacts.dart';
import 'package:http/http.dart' as http;
import 'package:image_picker/image_picker.dart';
import 'package:path_provider/path_provider.dart';
import 'package:provider/provider.dart';
import 'package:url_launcher/url_launcher.dart';
import 'package:video_player/video_player.dart';

import '../providers/personal_chat_provider.dart';
import '../services/api_service.dart';
import '../services/media_store.dart';
import '../theme/app_theme.dart';

/// WhatsApp-style extras shared by 1:1 and group chats: polls, contact cards,
/// view once, search in chat and starring. [apiBase] is
/// "/api/personal-chats/<id>" or "/api/group-chats/<id>".

// ------------------------------------------------------------------ polls

/// Sheet to write a poll. Returns {question, options, multiple} or null.
Future<Map<String, dynamic>?> showCreatePollSheet(BuildContext context) {
  return showModalBottomSheet<Map<String, dynamic>>(
    context: context,
    isScrollControlled: true,
    backgroundColor: AppColors.surface,
    shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(20))),
    builder: (_) => const _CreatePollSheet(),
  );
}

class _CreatePollSheet extends StatefulWidget {
  const _CreatePollSheet();
  @override
  State<_CreatePollSheet> createState() => _CreatePollSheetState();
}

class _CreatePollSheetState extends State<_CreatePollSheet> {
  final _question = TextEditingController();
  final _options = [TextEditingController(), TextEditingController()];
  bool _multiple = false;
  String? _error;

  @override
  void dispose() {
    _question.dispose();
    for (final c in _options) {
      c.dispose();
    }
    super.dispose();
  }

  void _submit() {
    final q = _question.text.trim();
    final opts = [for (final c in _options) if (c.text.trim().isNotEmpty) c.text.trim()];
    final unique = opts.map((o) => o.toLowerCase()).toSet();
    setState(() {
      _error = q.isEmpty
          ? 'Write a question.'
          : opts.length < 2
              ? 'Add at least two options.'
              : unique.length != opts.length
                  ? 'Each option must be different.'
                  : null;
    });
    if (_error != null) return;
    Navigator.pop(context, {'question': q, 'options': opts, 'multiple': _multiple});
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.only(bottom: MediaQuery.of(context).viewInsets.bottom),
      child: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.fromLTRB(16, 16, 16, 16),
          child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, mainAxisSize: MainAxisSize.min, children: [
            Text('Create poll', style: TextStyle(color: AppColors.ink, fontSize: 20, fontWeight: FontWeight.w800)),
            const SizedBox(height: 12),
            TextField(
              controller: _question,
              maxLength: 255,
              autofocus: true,
              style: TextStyle(color: AppColors.ink),
              decoration: const InputDecoration(labelText: 'Question', counterText: ''),
            ),
            const SizedBox(height: 8),
            for (var i = 0; i < _options.length; i++)
              Padding(
                padding: const EdgeInsets.only(top: 6),
                child: Row(children: [
                  Expanded(
                    child: TextField(
                      controller: _options[i],
                      maxLength: 100,
                      style: TextStyle(color: AppColors.ink),
                      decoration: InputDecoration(labelText: 'Option ${i + 1}', counterText: ''),
                    ),
                  ),
                  if (_options.length > 2)
                    IconButton(
                      tooltip: 'Remove option',
                      icon: Icon(Icons.close, color: AppColors.textMuted),
                      onPressed: () => setState(() => _options.removeAt(i).dispose()),
                    ),
                ]),
              ),
            if (_options.length < 12)
              Align(
                alignment: Alignment.centerLeft,
                child: TextButton.icon(
                  onPressed: () => setState(() => _options.add(TextEditingController())),
                  icon: const Icon(Icons.add),
                  label: const Text('Add option'),
                ),
              ),
            SwitchListTile(
              contentPadding: EdgeInsets.zero,
              value: _multiple,
              onChanged: (v) => setState(() => _multiple = v),
              title: Text('Allow multiple answers', style: TextStyle(color: AppColors.ink)),
            ),
            if (_error != null) Text(_error!, style: const TextStyle(color: AppColors.red)),
            const SizedBox(height: 8),
            FilledButton(onPressed: _submit, child: const Text('Send poll')),
          ]),
        ),
      ),
    );
  }
}

/// A poll inside a chat bubble: tap an option to vote (tap again to take it back).
class PollCard extends StatefulWidget {
  final Map<String, dynamic> poll;
  final String apiBase;
  final int? messageId;
  final VoidCallback? onVoted;
  /// The question in the reader's language (the poll keeps the original).
  final String? question;
  const PollCard({super.key, required this.poll, required this.apiBase, required this.messageId, this.onVoted, this.question});

  @override
  State<PollCard> createState() => _PollCardState();
}

class _PollCardState extends State<PollCard> {
  late Map<String, dynamic> _poll = widget.poll;
  bool _busy = false;

  @override
  void didUpdateWidget(covariant PollCard oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (!_busy) _poll = widget.poll;
  }

  Future<void> _tap(String optionId) async {
    final id = widget.messageId;
    if (id == null || _busy) return;
    final multiple = _poll['multiple'] == true;
    final mine = [...((_poll['myVotes'] as List?) ?? const []).map((e) => e.toString())];
    final next = mine.contains(optionId)
        ? (mine..remove(optionId))
        : (multiple ? [...mine, optionId] : [optionId]);
    setState(() => _busy = true);
    try {
      final res = await ApiService.post('${widget.apiBase}/messages/$id/vote', {'optionIds': next});
      if (res['poll'] is Map && mounted) setState(() => _poll = Map<String, dynamic>.from(res['poll'] as Map));
      widget.onVoted?.call();
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e is ApiException ? e.message : 'Could not vote. Try again.')));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final options = ((_poll['options'] as List?) ?? const []).whereType<Map>().toList();
    final mine = ((_poll['myVotes'] as List?) ?? const []).map((e) => e.toString()).toSet();
    final voters = (_poll['totalVoters'] as num?)?.toInt() ?? 0;
    final maxVotes = options.fold<int>(0, (m, o) => ((o['votes'] as num?)?.toInt() ?? 0) > m ? (o['votes'] as num).toInt() : m);
    return ConstrainedBox(
      constraints: const BoxConstraints(minWidth: 220),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, mainAxisSize: MainAxisSize.min, children: [
        Row(children: [
          Icon(Icons.poll_outlined, size: 18, color: AppColors.cyan),
          const SizedBox(width: 6),
          Text(_poll['multiple'] == true ? 'Poll · select one or more' : 'Poll · select one',
              style: TextStyle(color: AppColors.textMuted, fontSize: 12)),
        ]),
        const SizedBox(height: 6),
        Text(widget.question ?? _poll['question']?.toString() ?? '', style: TextStyle(color: AppColors.ink, fontSize: 16, fontWeight: FontWeight.w700)),
        const SizedBox(height: 8),
        for (final o in options)
          Padding(
            padding: const EdgeInsets.symmetric(vertical: 4),
            child: InkWell(
              borderRadius: BorderRadius.circular(10),
              onTap: () => _tap(o['id'].toString()),
              child: Padding(
                padding: const EdgeInsets.symmetric(vertical: 4),
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Row(children: [
                    Icon(mine.contains(o['id'].toString()) ? Icons.check_circle : Icons.radio_button_unchecked,
                        size: 20, color: mine.contains(o['id'].toString()) ? AppColors.cyan : AppColors.textMuted),
                    const SizedBox(width: 8),
                    Expanded(child: Text(o['text']?.toString() ?? '', style: TextStyle(color: AppColors.ink, fontSize: 15))),
                    Text('${(o['votes'] as num?)?.toInt() ?? 0}', style: TextStyle(color: AppColors.textSecondary, fontWeight: FontWeight.w700)),
                  ]),
                  const SizedBox(height: 4),
                  Padding(
                    padding: const EdgeInsets.only(left: 28),
                    child: LinearProgressIndicator(
                      value: maxVotes == 0 ? 0 : (((o['votes'] as num?)?.toInt() ?? 0) / (voters == 0 ? 1 : voters)).clamp(0, 1).toDouble(),
                      minHeight: 5,
                      borderRadius: BorderRadius.circular(3),
                      backgroundColor: AppColors.border,
                      color: AppColors.cyan,
                    ),
                  ),
                ]),
              ),
            ),
          ),
        const SizedBox(height: 4),
        Text(voters == 1 ? '1 person voted' : '$voters people voted', style: TextStyle(color: AppColors.textMuted, fontSize: 12)),
      ]),
    );
  }
}

// ------------------------------------------------------------------ contact cards

/// Pick one phone contact to share. Returns {name, phones} or null.
Future<Map<String, dynamic>?> pickContactToShare(BuildContext context) async {
  if (!await FlutterContacts.requestPermission(readonly: true)) {
    if (context.mounted) ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Allow contacts to share one.')));
    return null;
  }
  final all = (await FlutterContacts.getContacts(withProperties: true)).where((c) => c.phones.isNotEmpty).toList();
  if (!context.mounted) return null;
  final picked = await showModalBottomSheet<Contact>(
    context: context,
    isScrollControlled: true,
    backgroundColor: AppColors.surface,
    builder: (sheet) => _ContactPickerSheet(contacts: all),
  );
  if (picked == null) return null;
  return {
    'name': picked.displayName.trim().isEmpty ? picked.phones.first.number : picked.displayName.trim(),
    'phones': [for (final p in picked.phones.take(5)) p.number],
  };
}

class _ContactPickerSheet extends StatefulWidget {
  final List<Contact> contacts;
  const _ContactPickerSheet({required this.contacts});
  @override
  State<_ContactPickerSheet> createState() => _ContactPickerSheetState();
}

class _ContactPickerSheetState extends State<_ContactPickerSheet> {
  String _q = '';
  @override
  Widget build(BuildContext context) {
    final list = widget.contacts.where((c) => c.displayName.toLowerCase().contains(_q.toLowerCase()) || c.phones.any((p) => p.number.contains(_q))).toList();
    return SafeArea(
      child: SizedBox(
        height: MediaQuery.of(context).size.height * 0.8,
        child: Column(children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 16, 16, 8),
            child: TextField(
              autofocus: true,
              style: TextStyle(color: AppColors.ink),
              decoration: const InputDecoration(prefixIcon: Icon(Icons.search), hintText: 'Search contacts'),
              onChanged: (v) => setState(() => _q = v.trim()),
            ),
          ),
          Expanded(
            child: ListView.builder(
              itemCount: list.length,
              itemBuilder: (_, i) => ListTile(
                leading: const CircleAvatar(child: Icon(Icons.person)),
                title: Text(list[i].displayName, style: TextStyle(color: AppColors.ink)),
                subtitle: Text(list[i].phones.first.number, style: TextStyle(color: AppColors.textSecondary)),
                onTap: () => Navigator.pop(context, list[i]),
              ),
            ),
          ),
        ]),
      ),
    );
  }
}

/// A shared contact inside a bubble: Message (if on NeuraTalk), Call and Save.
class ContactCardView extends StatelessWidget {
  final Map<String, dynamic> contact;
  final int? myUserId;
  /// Opens a 1:1 chat with that NeuraTalk user (the screen decides how).
  final void Function(int userId)? onMessage;
  const ContactCardView({super.key, required this.contact, this.myUserId, this.onMessage});

  @override
  Widget build(BuildContext context) {
    final name = contact['name']?.toString() ?? 'Contact';
    final phones = ((contact['phones'] as List?) ?? const []).map((e) => e.toString()).toList();
    final userId = (contact['userId'] as num?)?.toInt();
    Widget action(IconData icon, String label, VoidCallback onTap) => Expanded(
          child: TextButton.icon(onPressed: onTap, icon: Icon(icon, size: 18), label: Text(label)),
        );
    return ConstrainedBox(
      constraints: const BoxConstraints(minWidth: 220),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, mainAxisSize: MainAxisSize.min, children: [
        Row(children: [
          CircleAvatar(backgroundColor: AppColors.blueTint, child: Icon(Icons.person, color: AppColors.cyan)),
          const SizedBox(width: 10),
          Expanded(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(name, style: TextStyle(color: AppColors.ink, fontWeight: FontWeight.w700, fontSize: 16)),
              if (phones.isNotEmpty) Text(phones.first, style: TextStyle(color: AppColors.textSecondary, fontSize: 13)),
              if (userId != null) Text('On NeuraTalk', style: TextStyle(color: AppColors.green, fontSize: 12, fontWeight: FontWeight.w600)),
            ]),
          ),
        ]),
        Divider(color: AppColors.border),
        Row(children: [
          if (userId != null && userId != myUserId && onMessage != null) action(Icons.chat_bubble_outline, 'Message', () => onMessage!(userId)),
          if (phones.isNotEmpty) action(Icons.call_outlined, 'Call', () => launchUrl(Uri.parse('tel:${phones.first.replaceAll(' ', '')}'))),
          if (phones.isNotEmpty)
            action(Icons.person_add_alt, 'Save', () async {
              final c = Contact()
                ..name = Name(first: name)
                ..phones = [for (final p in phones) Phone(p)];
              try {
                await FlutterContacts.openExternalInsert(c);
              } catch (_) {
                if (context.mounted) ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Could not open your contacts app.')));
              }
            }),
        ]),
      ]),
    );
  }
}

/// Opens (or starts) a 1:1 chat with a NeuraTalk user from a contact card.
Future<Map<String, dynamic>?> startChatWithUser(BuildContext context, int userId) async {
  try {
    return await context.read<PersonalChatProvider>().startThread(userId: userId);
  } catch (e) {
    if (context.mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e is ApiException ? e.message : 'Could not open the chat.')));
    return null;
  }
}

// ------------------------------------------------------------------ view once

/// One photo or video from the gallery to send as view once.
Future<(File, String)?> pickViewOnceMedia(BuildContext context) async {
  try {
    final x = await ImagePicker().pickMedia();
    if (x == null) return null;
    final name = x.name.isNotEmpty ? x.name : x.path.split(Platform.pathSeparator).last;
    final kind = MediaStore.kindOf(name);
    if (kind != MediaKind.image && kind != MediaKind.video) {
      if (context.mounted) ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('View once works with photos and videos.')));
      return null;
    }
    final file = File(x.path);
    if (await file.length() > MediaStore.maxUploadBytes) {
      if (context.mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('The limit is ${MediaStore.formatSize(MediaStore.maxUploadBytes)}.')));
      return null;
    }
    return (file, name);
  } catch (_) {
    if (context.mounted) ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Could not open your gallery.')));
    return null;
  }
}

/// The "view once" bubble body. The reader taps to open it once; after that it says "Opened".
class ViewOnceView extends StatefulWidget {
  final Map<String, dynamic> message;
  final String apiBase;
  final bool isOwn;
  final VoidCallback? onOpened;
  const ViewOnceView({super.key, required this.message, required this.apiBase, required this.isOwn, this.onOpened});
  @override
  State<ViewOnceView> createState() => _ViewOnceViewState();
}

class _ViewOnceViewState extends State<ViewOnceView> {
  bool _loading = false;
  bool _openedHere = false;

  bool get _isVideo => (widget.message['attachmentMime']?.toString() ?? '').startsWith('video') || widget.message['messageType'] == 'file';

  Future<void> _open() async {
    final id = widget.message['id'];
    if (id is! int || _loading) return;
    setState(() => _loading = true);
    File? temp;
    try {
      final res = await http.get(Uri.parse('${ApiService.baseUrl}${widget.apiBase}/messages/$id/view-once'), headers: MediaStore.authHeaders)
          .timeout(const Duration(seconds: 60));
      if (res.statusCode != 200) {
        throw ApiException(res.statusCode == 410 ? 'This was already opened.' : 'Could not open. Try again.', res.statusCode);
      }
      setState(() => _openedHere = true);
      if (!mounted) return;
      if (_isVideo) {
        final dir = await getTemporaryDirectory();
        temp = File('${dir.path}/vo_${DateTime.now().microsecondsSinceEpoch}.mp4');
        await temp.writeAsBytes(res.bodyBytes, flush: true);
        if (!mounted) return;
        await Navigator.push(context, MaterialPageRoute(fullscreenDialog: true, builder: (_) => _ViewOnceVideo(file: temp!)));
      } else {
        await Navigator.push(context, MaterialPageRoute(fullscreenDialog: true, builder: (_) => _ViewOncePhoto(bytes: res.bodyBytes)));
      }
      widget.onOpened?.call();
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e is ApiException ? e.message : 'Could not open. Check your connection.')));
      if (e is ApiException && e.statusCode == 410) setState(() => _openedHere = true);
    } finally {
      // Nothing is kept on the phone.
      try {
        if (temp != null && await temp.exists()) await temp.delete();
      } catch (_) {}
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final opened = _openedHere || widget.message['viewOnceOpened'] == true;
    final label = widget.isOwn
        ? (opened ? 'Opened' : (_isVideo ? 'View once video' : 'View once photo'))
        : (opened ? 'Opened' : (_isVideo ? 'Video' : 'Photo'));
    final canOpen = !widget.isOwn && !opened;
    return InkWell(
      onTap: canOpen ? _open : null,
      borderRadius: BorderRadius.circular(12),
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 6, horizontal: 4),
        child: Row(mainAxisSize: MainAxisSize.min, children: [
          _loading
              ? SizedBox(width: 26, height: 26, child: CircularProgressIndicator(strokeWidth: 2, color: AppColors.cyan))
              : Container(
                  width: 26,
                  height: 26,
                  alignment: Alignment.center,
                  decoration: BoxDecoration(
                    shape: BoxShape.circle,
                    border: Border.all(color: opened ? AppColors.textMuted : AppColors.cyan, width: 2, style: opened ? BorderStyle.solid : BorderStyle.solid),
                  ),
                  child: Text('1', style: TextStyle(color: opened ? AppColors.textMuted : AppColors.cyan, fontWeight: FontWeight.w800, fontSize: 13)),
                ),
          const SizedBox(width: 10),
          Text(label, style: TextStyle(color: opened ? AppColors.textMuted : AppColors.ink, fontSize: 15, fontWeight: FontWeight.w600,
              fontStyle: opened ? FontStyle.italic : FontStyle.normal)),
          if (canOpen) ...[
            const SizedBox(width: 6),
            Text('· tap to view', style: TextStyle(color: AppColors.textMuted, fontSize: 12.5)),
          ],
        ]),
      ),
    );
  }
}

class _ViewOncePhoto extends StatelessWidget {
  final List<int> bytes;
  const _ViewOncePhoto({required this.bytes});
  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.black,
      appBar: AppBar(backgroundColor: Colors.black, foregroundColor: Colors.white, title: const Text('View once')),
      body: Center(child: InteractiveViewer(child: Image.memory(bytes as dynamic))),
    );
  }
}

class _ViewOnceVideo extends StatefulWidget {
  final File file;
  const _ViewOnceVideo({required this.file});
  @override
  State<_ViewOnceVideo> createState() => _ViewOnceVideoState();
}

class _ViewOnceVideoState extends State<_ViewOnceVideo> {
  late final VideoPlayerController _c = VideoPlayerController.file(widget.file);
  @override
  void initState() {
    super.initState();
    _c.initialize().then((_) {
      if (mounted) setState(() {});
      _c.play();
    });
  }

  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.black,
      appBar: AppBar(backgroundColor: Colors.black, foregroundColor: Colors.white, title: const Text('View once')),
      body: Center(
        child: _c.value.isInitialized
            ? GestureDetector(
                onTap: () => setState(() => _c.value.isPlaying ? _c.pause() : _c.play()),
                child: AspectRatio(aspectRatio: _c.value.aspectRatio, child: VideoPlayer(_c)),
              )
            : const CircularProgressIndicator(),
      ),
    );
  }
}

// ------------------------------------------------------------------ starring

/// Which messages in one chat I starred; toggles with the server.
class StarStore extends ChangeNotifier {
  final String chatType;
  final int chatId;
  final Set<int> ids = {};
  StarStore(this.chatType, this.chatId);

  Future<void> load() async {
    try {
      final res = await ApiService.get('/api/starred/ids?chatType=$chatType&chatId=$chatId');
      ids
        ..clear()
        ..addAll(((res['ids'] as List?) ?? const []).whereType<num>().map((e) => e.toInt()));
      notifyListeners();
    } catch (_) {}
  }

  bool has(dynamic id) => id is int && ids.contains(id);

  Future<bool> toggle(int messageId) async {
    final starring = !ids.contains(messageId);
    starring ? ids.add(messageId) : ids.remove(messageId);
    notifyListeners();
    try {
      if (starring) {
        await ApiService.post('/api/starred', {'chatType': chatType, 'chatId': chatId, 'messageId': messageId});
      } else {
        await ApiService.delete('/api/starred/$chatType/$messageId');
      }
      return starring;
    } catch (_) {
      starring ? ids.remove(messageId) : ids.add(messageId);
      notifyListeners();
      rethrow;
    }
  }
}

// ------------------------------------------------------------------ search in chat

/// Searches one chat (original and translated text). Pops with the message id.
class ChatSearchScreen extends StatefulWidget {
  final String apiBase;
  final String title;
  const ChatSearchScreen({super.key, required this.apiBase, required this.title});
  @override
  State<ChatSearchScreen> createState() => _ChatSearchScreenState();
}

class _ChatSearchScreenState extends State<ChatSearchScreen> {
  List<Map<String, dynamic>> _results = [];
  bool _loading = false;
  String _q = '';
  int _seq = 0;

  Future<void> _search(String q) async {
    _q = q.trim();
    final seq = ++_seq;
    if (_q.length < 2) {
      setState(() => _results = []);
      return;
    }
    setState(() => _loading = true);
    try {
      final res = await ApiService.get('${widget.apiBase}/search?q=${Uri.encodeQueryComponent(_q)}');
      if (seq != _seq || !mounted) return;
      setState(() => _results = ((res['results'] as List?) ?? const []).whereType<Map>().map((e) => Map<String, dynamic>.from(e)).toList());
    } catch (_) {
      if (mounted && seq == _seq) setState(() => _results = []);
    } finally {
      if (mounted && seq == _seq) setState(() => _loading = false);
    }
  }

  static String _date(dynamic raw) {
    final d = DateTime.tryParse(raw?.toString() ?? '')?.toLocal();
    if (d == null) return '';
    return '${d.day}/${d.month}/${d.year % 100} ${d.hour.toString().padLeft(2, '0')}:${d.minute.toString().padLeft(2, '0')}';
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(
        title: TextField(
          autofocus: true,
          style: TextStyle(color: AppColors.ink, fontSize: 17),
          decoration: InputDecoration(hintText: 'Search in ${widget.title}', border: InputBorder.none, filled: false),
          onChanged: _search,
        ),
      ),
      body: _loading && _results.isEmpty
          ? Center(child: CircularProgressIndicator(color: AppColors.cyan))
          : _results.isEmpty
              ? Center(
                  child: Text(_q.length < 2 ? 'Type at least 2 letters' : 'No messages found',
                      style: TextStyle(color: AppColors.textMuted)),
                )
              : ListView.separated(
                  itemCount: _results.length,
                  separatorBuilder: (_, __) => Divider(height: 1, color: AppColors.border),
                  itemBuilder: (_, i) {
                    final r = _results[i];
                    final who = r['isOwn'] == true ? 'You' : (r['senderName']?.toString() ?? '');
                    return ListTile(
                      title: Text(r['text']?.toString() ?? '', maxLines: 2, overflow: TextOverflow.ellipsis, style: TextStyle(color: AppColors.ink)),
                      subtitle: Text('${who.isEmpty ? '' : '$who · '}${_date(r['createdAt'])}', style: TextStyle(color: AppColors.textSecondary, fontSize: 12.5)),
                      onTap: () => Navigator.pop(context, (r['messageId'] as num?)?.toInt()),
                    );
                  },
                ),
    );
  }
}

// ------------------------------------------------------------------ starred list

class StarredMessagesScreen extends StatefulWidget {
  const StarredMessagesScreen({super.key});
  @override
  State<StarredMessagesScreen> createState() => _StarredMessagesScreenState();
}

class _StarredMessagesScreenState extends State<StarredMessagesScreen> {
  List<Map<String, dynamic>>? _items;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final res = await ApiService.get('/api/starred');
      if (mounted) setState(() => _items = ((res['items'] as List?) ?? const []).whereType<Map>().map((e) => Map<String, dynamic>.from(e)).toList());
    } catch (_) {
      if (mounted) setState(() => _error = 'Could not load starred messages.');
    }
  }

  Future<void> _unstar(Map<String, dynamic> item) async {
    try {
      await ApiService.delete('/api/starred/${item['chatType']}/${item['messageId']}');
      if (mounted) setState(() => _items!.remove(item));
    } catch (_) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Could not remove the star.')));
    }
  }

  String _summary(Map<String, dynamic> m) {
    if (m['poll'] is Map) return '📊 ${(m['poll'] as Map)['question']}';
    if (m['contact'] is Map) return '👤 ${(m['contact'] as Map)['name']}';
    if (m['viewOnce'] == true) return '📷 View once';
    switch (m['messageType']) {
      case 'attachment':
        return '📷 Photo';
      case 'file':
        return '📄 ${m['attachmentTitle'] ?? 'File'}';
      case 'voice_note':
        return '🎤 Voice message';
      case 'location':
        return '📍 Location';
    }
    return m['text']?.toString() ?? '';
  }

  @override
  Widget build(BuildContext context) {
    final items = _items;
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(title: const Text('Starred messages')),
      body: _error != null
          ? Center(child: Text(_error!, style: const TextStyle(color: AppColors.red)))
          : items == null
              ? Center(child: CircularProgressIndicator(color: AppColors.cyan))
              : items.isEmpty
                  ? Center(
                      child: Padding(
                        padding: const EdgeInsets.all(32),
                        child: Text('Tap and hold a message, then tap Star to find it here later.',
                            textAlign: TextAlign.center, style: TextStyle(color: AppColors.textMuted)),
                      ),
                    )
                  : RefreshIndicator(
                      onRefresh: _load,
                      child: ListView.separated(
                        itemCount: items.length,
                        separatorBuilder: (_, __) => Divider(height: 1, color: AppColors.border),
                        itemBuilder: (_, i) {
                          final m = items[i];
                          return ListTile(
                            leading: Icon(Icons.star, color: AppColors.orange),
                            title: Text(_summary(m), maxLines: 3, overflow: TextOverflow.ellipsis, style: TextStyle(color: AppColors.ink)),
                            subtitle: Text('${m['senderName']} · ${m['chatName']}', style: TextStyle(color: AppColors.textSecondary, fontSize: 12.5)),
                            trailing: IconButton(tooltip: 'Unstar', icon: Icon(Icons.star_border, color: AppColors.textMuted), onPressed: () => _unstar(m)),
                          );
                        },
                      ),
                    ),
    );
  }
}

// ------------------------------------------------------------------ privacy toggles

/// "Last seen and online" and "Read receipts" switches (WhatsApp rules: if you
/// hide yours you can't see other people's either).
class PrivacyToggles extends StatefulWidget {
  const PrivacyToggles({super.key});
  @override
  State<PrivacyToggles> createState() => _PrivacyTogglesState();
}

class _PrivacyTogglesState extends State<PrivacyToggles> {
  bool? _lastSeen;
  bool? _receipts;

  @override
  void initState() {
    super.initState();
    ApiService.get('/api/privacy/settings').then((res) {
      final s = (res['settings'] as Map?) ?? const {};
      if (mounted) setState(() {
        _lastSeen = s['lastSeen'] != 'nobody';
        _receipts = s['readReceipts'] != false;
      });
    }).catchError((_) {
      if (mounted) setState(() {
        _lastSeen = true;
        _receipts = true;
      });
    });
  }

  Future<void> _save(Map<String, dynamic> change, VoidCallback undo) async {
    try {
      await ApiService.put('/api/privacy/settings', change);
    } catch (_) {
      undo();
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Could not save. Check your connection.')));
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_lastSeen == null) return const Padding(padding: EdgeInsets.all(16), child: Center(child: CircularProgressIndicator()));
    return Column(children: [
      SwitchListTile(
        value: _lastSeen!,
        title: Text('Last seen and online', style: TextStyle(color: AppColors.ink, fontWeight: FontWeight.w600)),
        subtitle: Text('If you turn this off, you won\'t see other people\'s last seen or online either.',
            style: TextStyle(color: AppColors.textSecondary, fontSize: 13)),
        onChanged: (v) {
          setState(() => _lastSeen = v);
          _save({'lastSeen': v ? 'everyone' : 'nobody'}, () => setState(() => _lastSeen = !v));
        },
      ),
      SwitchListTile(
        value: _receipts!,
        title: Text('Read receipts', style: TextStyle(color: AppColors.ink, fontWeight: FontWeight.w600)),
        subtitle: Text('If you turn this off, you won\'t send or see blue ticks in 1:1 chats.',
            style: TextStyle(color: AppColors.textSecondary, fontSize: 13)),
        onChanged: (v) {
          setState(() => _receipts = v);
          _save({'readReceipts': v}, () => setState(() => _receipts = !v));
        },
      ),
    ]);
  }
}
