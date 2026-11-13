import 'package:flutter/material.dart';
import 'package:flutter/services.dart' show Clipboard, ClipboardData;
import 'package:provider/provider.dart';
import 'package:qr_flutter/qr_flutter.dart';
import 'package:share_plus/share_plus.dart';
import '../theme/app_theme.dart';
import '../widgets/nt_ui.dart';
import '../services/api_service.dart';
import '../providers/personal_chat_provider.dart';
import 'group_conversation_screen.dart';

/// Group invite links, joining by link, and broadcast lists
/// (server/group-invites.ts and server/chat-parity.ts).

String _err(Object e, String fallback) => e is ApiException ? e.message : fallback;

void _toast(BuildContext context, String text) {
  if (!context.mounted) return;
  ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(text)));
}

/// The invite code inside anything the person pasted: a full link or the code.
String? inviteCodeFrom(String input) {
  final s = input.trim();
  final m = RegExp(r'/g/([A-Za-z0-9_-]{8,64})').firstMatch(s) ?? RegExp(r'^([A-Za-z0-9_-]{8,64})$').firstMatch(s);
  return m?.group(1);
}

// ============================================================ admin: invite link

class GroupInviteLinkScreen extends StatefulWidget {
  const GroupInviteLinkScreen({super.key, required this.groupId, required this.groupName});
  final int groupId;
  final String groupName;

  @override
  State<GroupInviteLinkScreen> createState() => _GroupInviteLinkScreenState();
}

class _GroupInviteLinkScreenState extends State<GroupInviteLinkScreen> {
  Map<String, dynamic>? _link;
  bool _busy = true;
  String? _error;

  String get _base => '/api/group-chats/${widget.groupId}/invite-link';

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final res = await ApiService.get(_base) as Map<String, dynamic>;
      if (mounted) setState(() { _link = res['link'] as Map<String, dynamic>?; _busy = false; });
    } catch (e) {
      if (mounted) setState(() { _error = _err(e, 'Could not load the invite link.'); _busy = false; });
    }
  }

  Future<void> _make({bool reset = false}) async {
    if (reset) {
      final ok = await showDialog<bool>(
        context: context,
        builder: (d) => AlertDialog(
          title: const Text('Reset link?'),
          content: const Text("The current link stops working. People who haven't joined yet will need the new one."),
          actions: [
            TextButton(onPressed: () => Navigator.pop(d, false), child: const Text('Cancel')),
            TextButton(onPressed: () => Navigator.pop(d, true), child: const Text('Reset link')),
          ],
        ),
      );
      if (ok != true) return;
    }
    setState(() => _busy = true);
    try {
      final res = await ApiService.post(_base, {});
      if (mounted) setState(() { _link = res['link'] as Map<String, dynamic>?; _busy = false; });
      if (reset && mounted) _toast(context, 'New link made. The old one no longer works.');
    } catch (e) {
      if (mounted) { setState(() => _busy = false); _toast(context, _err(e, 'Could not make the link.')); }
    }
  }

  Future<void> _turnOff() async {
    setState(() => _busy = true);
    try {
      final res = await ApiService.delete(_base);
      if (mounted) setState(() { _link = res['link'] as Map<String, dynamic>?; _busy = false; });
    } catch (e) {
      if (mounted) { setState(() => _busy = false); _toast(context, _err(e, 'Could not turn the link off.')); }
    }
  }

  @override
  Widget build(BuildContext context) {
    final enabled = _link?['enabled'] == true;
    final url = _link?['url']?.toString() ?? '';
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(title: const Text('Invite via link')),
      body: _busy
          ? Center(child: CircularProgressIndicator(color: AppColors.cyan))
          : _error != null
              ? NtEmptyState(icon: Icons.link_off, title: "Couldn't load", message: _error!, error: true)
              : ListView(padding: const EdgeInsets.all(20), children: [
                  Text(
                    'Anyone with NeuraTalk can follow this link to join "${widget.groupName}". Only share it with people you trust.',
                    style: TextStyle(color: AppColors.textSecondary, fontSize: 14.5, height: 1.4),
                  ),
                  const SizedBox(height: 20),
                  if (!enabled)
                    FilledButton.icon(
                      onPressed: () => _make(),
                      icon: const Icon(Icons.link),
                      label: const Text('Turn on invite link'),
                    )
                  else ...[
                    Center(
                      child: Container(
                        padding: const EdgeInsets.all(12),
                        decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(16)),
                        child: QrImageView(data: url, size: 190, backgroundColor: Colors.white),
                      ),
                    ),
                    const SizedBox(height: 16),
                    SelectableText(url, textAlign: TextAlign.center, style: TextStyle(color: AppColors.cyan, fontSize: 15, fontWeight: FontWeight.w600)),
                    const SizedBox(height: 4),
                    Text('${_link?['joins'] ?? 0} joined with this link', textAlign: TextAlign.center, style: TextStyle(color: AppColors.textMuted, fontSize: 13)),
                    const SizedBox(height: 16),
                    ListTile(
                      leading: Icon(Icons.share_outlined, color: AppColors.cyan),
                      title: Text('Share link', style: TextStyle(color: AppColors.ink)),
                      onTap: () => Share.share('Join my NeuraTalk group "${widget.groupName}": $url'),
                    ),
                    ListTile(
                      leading: Icon(Icons.copy, color: AppColors.cyan),
                      title: Text('Copy link', style: TextStyle(color: AppColors.ink)),
                      onTap: () {
                        Clipboard.setData(ClipboardData(text: url));
                        _toast(context, 'Link copied');
                      },
                    ),
                    ListTile(
                      leading: Icon(Icons.refresh, color: AppColors.cyan),
                      title: Text('Reset link', style: TextStyle(color: AppColors.ink)),
                      onTap: () => _make(reset: true),
                    ),
                    ListTile(
                      leading: const Icon(Icons.link_off, color: AppColors.red),
                      title: const Text('Turn off link', style: TextStyle(color: AppColors.red)),
                      onTap: _turnOff,
                    ),
                  ],
                ]),
    );
  }
}

// ============================================================ anyone: join by link

/// Shows the group behind an invite and lets the person join it.
Future<void> showGroupInvite(BuildContext context, String code) async {
  await showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    backgroundColor: AppColors.surface,
    shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(20))),
    builder: (_) => _GroupInviteSheet(code: code),
  );
}

/// "Join with link": the person pastes a link they got elsewhere.
Future<void> askForGroupLink(BuildContext context) async {
  final ctrl = TextEditingController();
  final input = await showDialog<String>(
    context: context,
    builder: (d) => AlertDialog(
      title: const Text('Join a group with a link'),
      content: TextField(
        controller: ctrl,
        autofocus: true,
        decoration: const InputDecoration(hintText: 'https://neuratalk.in/g/…'),
      ),
      actions: [
        TextButton(onPressed: () => Navigator.pop(d), child: const Text('Cancel')),
        FilledButton(onPressed: () => Navigator.pop(d, ctrl.text), child: const Text('Next')),
      ],
    ),
  );
  if (input == null || !context.mounted) return;
  final code = inviteCodeFrom(input);
  if (code == null) {
    _toast(context, "That isn't a NeuraTalk group link.");
    return;
  }
  await showGroupInvite(context, code);
}

class _GroupInviteSheet extends StatefulWidget {
  const _GroupInviteSheet({required this.code});
  final String code;

  @override
  State<_GroupInviteSheet> createState() => _GroupInviteSheetState();
}

class _GroupInviteSheetState extends State<_GroupInviteSheet> {
  Map<String, dynamic>? _group;
  String? _error;
  bool _joining = false;

  @override
  void initState() {
    super.initState();
    ApiService.get('/api/group-invites/${widget.code}').then((res) {
      if (mounted) setState(() => _group = (res as Map)['group'] as Map<String, dynamic>?);
    }).catchError((Object e) {
      if (mounted) setState(() => _error = _err(e, 'This invite link isn\'t valid any more.'));
    });
  }

  Future<void> _join() async {
    setState(() => _joining = true);
    try {
      final res = await ApiService.post('/api/group-invites/${widget.code}/join', {});
      if (!mounted) return;
      final groupId = res['groupId'] as int;
      Navigator.pop(context);
      Navigator.of(context).push(MaterialPageRoute(builder: (_) => GroupConversationScreen(groupId: groupId)));
    } catch (e) {
      if (mounted) setState(() { _joining = false; _error = _err(e, 'Could not join.'); });
    }
  }

  @override
  Widget build(BuildContext context) {
    final g = _group;
    return SafeArea(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(24, 24, 24, 16),
        child: _error != null
            ? Column(mainAxisSize: MainAxisSize.min, children: [
                const Icon(Icons.link_off, size: 40, color: AppColors.red),
                const SizedBox(height: 12),
                Text(_error!, textAlign: TextAlign.center, style: TextStyle(color: AppColors.ink, fontSize: 15)),
                const SizedBox(height: 16),
                TextButton(onPressed: () => Navigator.pop(context), child: const Text('Close')),
              ])
            : g == null
                ? Padding(padding: const EdgeInsets.all(24), child: Center(child: CircularProgressIndicator(color: AppColors.cyan)))
                : Column(mainAxisSize: MainAxisSize.min, children: [
                    NtAvatar(name: g['name']?.toString() ?? 'Group', size: 72),
                    const SizedBox(height: 12),
                    Text(g['name']?.toString() ?? 'Group', textAlign: TextAlign.center, style: TextStyle(color: AppColors.ink, fontSize: 20, fontWeight: FontWeight.w800)),
                    const SizedBox(height: 4),
                    Text(
                      'Group · ${g['members']} member${g['members'] == 1 ? '' : 's'}${g['createdBy'] != null ? ' · created by ${g['createdBy']}' : ''}',
                      textAlign: TextAlign.center,
                      style: TextStyle(color: AppColors.textSecondary),
                    ),
                    if ((g['description']?.toString() ?? '').isNotEmpty) ...[
                      const SizedBox(height: 10),
                      Text(g['description'].toString(), textAlign: TextAlign.center, style: TextStyle(color: AppColors.textSecondary)),
                    ],
                    const SizedBox(height: 20),
                    SizedBox(
                      width: double.infinity,
                      child: g['alreadyMember'] == true
                          ? FilledButton(
                              onPressed: () {
                                Navigator.pop(context);
                                Navigator.of(context).push(MaterialPageRoute(builder: (_) => GroupConversationScreen(groupId: g['id'] as int)));
                              },
                              child: const Text("You're already in this group — open it"),
                            )
                          : FilledButton(
                              onPressed: _joining ? null : _join,
                              child: Text(_joining ? 'Joining…' : 'Join group'),
                            ),
                    ),
                  ]),
      ),
    );
  }
}

// ============================================================ broadcast lists

class BroadcastListsScreen extends StatefulWidget {
  const BroadcastListsScreen({super.key});

  @override
  State<BroadcastListsScreen> createState() => _BroadcastListsScreenState();
}

class _BroadcastListsScreenState extends State<BroadcastListsScreen> {
  List<Map<String, dynamic>> _lists = [];
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final res = await ApiService.get('/api/broadcast-lists') as Map<String, dynamic>;
      if (mounted) setState(() { _lists = (res['lists'] as List).cast<Map<String, dynamic>>(); _loading = false; _error = null; });
    } catch (e) {
      if (mounted) setState(() { _error = _err(e, 'Could not load your lists.'); _loading = false; });
    }
  }

  Future<void> _edit([Map<String, dynamic>? list]) async {
    final changed = await Navigator.push<bool>(context, MaterialPageRoute(builder: (_) => BroadcastListEditScreen(list: list)));
    if (changed == true) _load();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(title: const Text('Broadcast lists')),
      floatingActionButton: FloatingActionButton.extended(
        heroTag: 'new-broadcast',
        onPressed: () => _edit(),
        backgroundColor: AppColors.cyan,
        foregroundColor: AppColors.onAccent,
        icon: const Icon(Icons.add),
        label: const Text('New list'),
      ),
      body: _loading
          ? Center(child: CircularProgressIndicator(color: AppColors.cyan))
          : _error != null
              ? NtEmptyState(icon: Icons.wifi_off, title: "Couldn't load", message: _error!, error: true)
              : RefreshIndicator(
                  onRefresh: _load,
                  child: ListView(padding: const EdgeInsets.only(bottom: 96), children: [
                    Padding(
                      padding: const EdgeInsets.fromLTRB(20, 16, 20, 8),
                      child: Text(
                        'Send one message to many people at once. Each person gets it as a normal chat from you and replies only to you. '
                        'Only people who have messaged you or saved your number receive it.',
                        style: TextStyle(color: AppColors.textSecondary, fontSize: 13.5, height: 1.4),
                      ),
                    ),
                    if (_lists.isEmpty)
                      const Padding(
                        padding: EdgeInsets.only(top: 40),
                        child: NtEmptyState(icon: Icons.campaign_outlined, title: 'No lists yet', message: 'Tap New list to pick people.'),
                      ),
                    for (final l in _lists)
                      ListTile(
                        contentPadding: const EdgeInsets.symmetric(horizontal: 20, vertical: 4),
                        leading: CircleAvatar(backgroundColor: AppColors.blueTint, child: Icon(Icons.campaign_outlined, color: AppColors.cyan)),
                        title: Text(l['name']?.toString() ?? 'List', style: TextStyle(color: AppColors.ink, fontWeight: FontWeight.w700)),
                        subtitle: Text(
                          ((l['members'] as List?) ?? const []).map((m) => (m as Map)['name']).join(', '),
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: TextStyle(color: AppColors.textSecondary),
                        ),
                        onTap: () async {
                          await Navigator.push(context, MaterialPageRoute(builder: (_) => BroadcastSendScreen(list: l)));
                          _load();
                        },
                        trailing: IconButton(icon: Icon(Icons.edit_outlined, color: AppColors.textMuted), tooltip: 'Edit', onPressed: () => _edit(l)),
                      ),
                  ]),
                ),
    );
  }
}

class BroadcastListEditScreen extends StatefulWidget {
  const BroadcastListEditScreen({super.key, this.list});
  final Map<String, dynamic>? list;

  @override
  State<BroadcastListEditScreen> createState() => _BroadcastListEditScreenState();
}

class _BroadcastListEditScreenState extends State<BroadcastListEditScreen> {
  late final TextEditingController _name = TextEditingController(text: widget.list?['name']?.toString() ?? '');
  late final Set<int> _picked = {
    for (final m in (widget.list?['members'] as List?) ?? const []) (m as Map)['id'] as int,
  };
  bool _saving = false;

  /// People you chat with (your 1:1 chats), plus anyone already on the list.
  List<Map<String, dynamic>> _people(BuildContext context) {
    final seen = <int>{};
    final out = <Map<String, dynamic>>[];
    for (final t in context.watch<PersonalChatProvider>().threads) {
      final peer = t['peer'] as Map?;
      final id = peer?['id'];
      if (id is! int || !seen.add(id)) continue;
      out.add({'id': id, 'name': peer?['displayName'] ?? peer?['username'] ?? 'Contact'});
    }
    for (final m in (widget.list?['members'] as List?) ?? const []) {
      final id = (m as Map)['id'] as int;
      if (seen.add(id)) out.add({'id': id, 'name': m['name']});
    }
    return out;
  }

  Future<void> _save() async {
    final name = _name.text.trim();
    if (name.isEmpty) return _toast(context, 'Give the list a name.');
    if (_picked.length < 2) return _toast(context, 'Pick at least 2 people.');
    setState(() => _saving = true);
    try {
      final body = {'name': name, 'memberIds': _picked.toList()};
      if (widget.list == null) {
        await ApiService.post('/api/broadcast-lists', body);
      } else {
        await ApiService.put('/api/broadcast-lists/${widget.list!['id']}', body);
      }
      if (mounted) Navigator.pop(context, true);
    } catch (e) {
      if (mounted) { setState(() => _saving = false); _toast(context, _err(e, 'Could not save the list.')); }
    }
  }

  Future<void> _delete() async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (d) => AlertDialog(
        title: const Text('Delete this list?'),
        content: const Text('Messages already sent stay in each chat.'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(d, false), child: const Text('Cancel')),
          TextButton(onPressed: () => Navigator.pop(d, true), child: const Text('Delete', style: TextStyle(color: AppColors.red))),
        ],
      ),
    );
    if (ok != true) return;
    try {
      await ApiService.delete('/api/broadcast-lists/${widget.list!['id']}');
      if (mounted) Navigator.pop(context, true);
    } catch (e) {
      if (mounted) _toast(context, _err(e, 'Could not delete the list.'));
    }
  }

  @override
  void dispose() {
    _name.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final people = _people(context);
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(
        title: Text(widget.list == null ? 'New broadcast list' : 'Edit list'),
        actions: [
          if (widget.list != null) IconButton(icon: const Icon(Icons.delete_outline), tooltip: 'Delete list', onPressed: _delete),
        ],
      ),
      bottomNavigationBar: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: FilledButton(
            onPressed: _saving ? null : _save,
            child: Text(_saving ? 'Saving…' : 'Save (${_picked.length} selected)'),
          ),
        ),
      ),
      body: ListView(children: [
        Padding(
          padding: const EdgeInsets.all(16),
          child: TextField(
            controller: _name,
            maxLength: 60,
            decoration: const InputDecoration(labelText: 'List name', hintText: 'e.g. Family, Customers'),
          ),
        ),
        NtSectionHeader('Pick people (${_picked.length})'),
        if (people.isEmpty)
          Padding(
            padding: const EdgeInsets.all(20),
            child: Text('Start a chat with someone first; they will show up here.', style: TextStyle(color: AppColors.textSecondary)),
          ),
        for (final p in people)
          CheckboxListTile(
            value: _picked.contains(p['id']),
            onChanged: (v) => setState(() => v == true ? _picked.add(p['id'] as int) : _picked.remove(p['id'])),
            secondary: NtAvatar(name: p['name'].toString(), size: 40),
            title: Text(p['name'].toString(), style: TextStyle(color: AppColors.ink)),
            activeColor: AppColors.cyan,
          ),
      ]),
    );
  }
}

class BroadcastSendScreen extends StatefulWidget {
  const BroadcastSendScreen({super.key, required this.list});
  final Map<String, dynamic> list;

  @override
  State<BroadcastSendScreen> createState() => _BroadcastSendScreenState();
}

class _BroadcastSendScreenState extends State<BroadcastSendScreen> {
  final _text = TextEditingController();
  List<Map<String, dynamic>> _sends = [];
  bool _sending = false;

  @override
  void initState() {
    super.initState();
    _loadSends();
  }

  Future<void> _loadSends() async {
    try {
      final res = await ApiService.get('/api/broadcast-lists/${widget.list['id']}') as Map<String, dynamic>;
      if (mounted) setState(() => _sends = (res['sends'] as List).cast<Map<String, dynamic>>());
    } catch (_) {}
  }

  static String reasonText(String r) => switch (r) {
        'hasnt_messaged_you' => "hasn't messaged you or saved your number",
        'blocked' => 'blocked',
        _ => "couldn't be reached",
      };

  Future<void> _send() async {
    final content = _text.text.trim();
    if (content.isEmpty || _sending) return;
    setState(() => _sending = true);
    try {
      final res = await ApiService.post('/api/broadcast-lists/${widget.list['id']}/send', {
        'content': content,
        'clientMessageId': 'bc-${DateTime.now().microsecondsSinceEpoch}',
      });
      _text.clear();
      if (!mounted) return;
      final skipped = (res['skipped'] as List? ?? const []).cast<Map>();
      await showDialog<void>(
        context: context,
        builder: (d) => AlertDialog(
          title: Text('Sent to ${res['sent']} of ${res['total']}'),
          content: skipped.isEmpty
              ? const Text('Everyone on the list got it.')
              : Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
                  const Text('Not sent to:'),
                  const SizedBox(height: 6),
                  for (final s in skipped) Text('• ${s['name']} — ${reasonText('${s['reason']}')}'),
                ]),
          actions: [TextButton(onPressed: () => Navigator.pop(d), child: const Text('OK'))],
        ),
      );
      context.read<PersonalChatProvider>().loadThreads();
      _loadSends();
    } catch (e) {
      if (mounted) _toast(context, _err(e, 'Could not send.'));
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  @override
  void dispose() {
    _text.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final members = (widget.list['members'] as List?) ?? const [];
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(
        title: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(widget.list['name']?.toString() ?? 'Broadcast'),
          Text('${members.length} recipients', style: TextStyle(fontSize: 12.5, color: AppColors.textSecondary)),
        ]),
      ),
      body: Column(children: [
        Expanded(
          child: _sends.isEmpty
              ? const NtEmptyState(icon: Icons.campaign_outlined, title: 'Nothing sent yet', message: 'Type a message below. Each person gets it in their own chat with you.')
              : ListView(padding: const EdgeInsets.all(16), reverse: true, children: [
                  for (final s in _sends)
                    Align(
                      alignment: Alignment.centerRight,
                      child: Container(
                        margin: const EdgeInsets.only(bottom: 10, left: 48),
                        padding: const EdgeInsets.all(12),
                        decoration: BoxDecoration(color: AppColors.blueTint, borderRadius: BorderRadius.circular(14)),
                        child: Column(crossAxisAlignment: CrossAxisAlignment.end, children: [
                          Text(s['preview']?.toString() ?? '', style: TextStyle(color: AppColors.ink, fontSize: 15)),
                          const SizedBox(height: 4),
                          Text(
                            'Sent to ${s['sent']}${(s['skipped'] as List? ?? const []).isNotEmpty ? ' · ${(s['skipped'] as List).length} not reached' : ''}',
                            style: TextStyle(color: AppColors.textMuted, fontSize: 12),
                          ),
                        ]),
                      ),
                    ),
                ]),
        ),
        SafeArea(
          top: false,
          child: Padding(
            padding: const EdgeInsets.fromLTRB(12, 6, 8, 10),
            child: Row(children: [
              Expanded(
                child: TextField(
                  controller: _text,
                  minLines: 1,
                  maxLines: 5,
                  maxLength: 4000,
                  decoration: const InputDecoration(hintText: 'Message', counterText: ''),
                ),
              ),
              IconButton(
                onPressed: _sending ? null : _send,
                tooltip: 'Send to everyone',
                icon: _sending
                    ? SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2, color: AppColors.cyan))
                    : Icon(Icons.send, color: AppColors.cyan),
              ),
            ]),
          ),
        ),
      ]),
    );
  }
}
