import 'dart:async';
import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../services/api_service.dart';
import '../services/e2e_crypto.dart';
import '../theme/app_theme.dart';
import '../widgets/nt_ui.dart';
import 'business_messages_screen.dart' show formatClockTime;

/// A Private chat: end-to-end encrypted, no translation, on this phone only.
class PrivateChatScreen extends StatefulWidget {
  const PrivateChatScreen({super.key, required this.threadId, required this.peerName, this.crypto});
  final int threadId;
  final String peerName;
  final E2eCrypto? crypto;

  @override
  State<PrivateChatScreen> createState() => _PrivateChatScreenState();
}

class _PrivateChatScreenState extends State<PrivateChatScreen> {
  late final E2eCrypto _crypto = widget.crypto ?? E2eCrypto();
  final _input = TextEditingController();
  final _scroll = ScrollController();
  Timer? _poll;

  String get _base => '/api/personal-chats/${widget.threadId}/private';

  bool _loading = true;
  String? _error;
  Map? _mine;
  Map? _peer;
  String? _safety;
  bool _keyChanged = false;
  bool _sending = false;
  int _timerSeconds = 0;
  final List<Map<String, dynamic>> _messages = [];
  int _lastId = 0;

  @override
  void initState() {
    super.initState();
    _start();
  }

  @override
  void dispose() {
    _poll?.cancel();
    _input.dispose();
    _scroll.dispose();
    super.dispose();
  }

  Future<void> _start() async {
    try {
      // This phone's key: made once, the public half registered with NeuraTalk.
      await ApiService.put('/api/e2e/my-key', {'publicKey': await _crypto.publicKey()});
      await _loadKeys();
      final prefs = await SharedPreferences.getInstance();
      _timerSeconds = prefs.getInt('private_timer_${widget.threadId}') ?? 0;
      await _loadMessages();
      if (mounted) setState(() => _loading = false);
      _poll = Timer.periodic(const Duration(seconds: 3), (_) => _loadMessages());
    } catch (e) {
      if (mounted) setState(() { _loading = false; _error = e is ApiException ? e.message : 'Could not open the private chat.'; });
    }
  }

  Future<void> _loadKeys() async {
    final res = await ApiService.get('$_base/keys') as Map;
    final prefs = await SharedPreferences.getInstance();
    final seenKey = 'private_peer_key_${widget.threadId}';
    final peer = res['peer'] as Map?;
    final seen = prefs.getString(seenKey);
    final changed = peer != null && seen != null && seen != peer['publicKey'];
    if (peer != null && seen == null) await prefs.setString(seenKey, '${peer['publicKey']}');
    if (!mounted) return;
    setState(() {
      _mine = res['mine'] as Map?;
      _peer = peer;
      _safety = res['safetyNumber']?.toString();
      _keyChanged = changed;
    });
  }

  Future<void> _acceptNewKey() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString('private_peer_key_${widget.threadId}', '${_peer?['publicKey']}');
    if (mounted) setState(() => _keyChanged = false);
  }

  Future<void> _loadMessages() async {
    try {
      final res = await ApiService.get('$_base/messages?after=$_lastId') as Map;
      final list = (res['messages'] as List).cast<Map>();
      if (list.isEmpty) return;
      final myKeyId = '${_mine?['id']}';
      for (final m in list) {
        String text;
        bool unreadable = false;
        if (m['deleted'] == true) {
          text = 'This message was deleted';
          unreadable = true;
        } else {
          try {
            final body = jsonDecode(await _crypto.decrypt(m, myKeyId)) as Map;
            text = '${body['body'] ?? ''}';
          } on E2eNotForThisPhone {
            text = '🔒 Sent to your old phone. It can\'t be read here.';
            unreadable = true;
          } catch (_) {
            text = '🔒 This message couldn\'t be opened.';
            unreadable = true;
          }
        }
        _messages.removeWhere((x) => x['id'] == m['id']);
        _messages.add({'id': m['id'], 'isOwn': m['isOwn'] == true, 'text': text, 'unreadable': unreadable, 'createdAt': m['createdAt'], 'readAt': m['readAt']});
        if ((m['id'] as num).toInt() > _lastId) _lastId = (m['id'] as num).toInt();
      }
      if (mounted) setState(() {});
      unawaited(ApiService.post('$_base/read', {}).then<void>((_) {}).catchError((Object _) {}));
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (_scroll.hasClients) _scroll.jumpTo(_scroll.position.maxScrollExtent);
      });
    } catch (_) {/* next poll tries again */}
  }

  Future<void> _send() async {
    final text = _input.text.trim();
    if (text.isEmpty || _sending || _mine == null || _peer == null) return;
    setState(() => _sending = true);
    try {
      final body = await _crypto.encrypt(jsonEncode({'t': 'text', 'body': text}), {
        '${_mine!['id']}': '${_mine!['publicKey']}',
        '${_peer!['id']}': '${_peer!['publicKey']}',
      });
      await ApiService.post('$_base/messages', {
        ...body,
        'clientMessageId': 'p-${DateTime.now().microsecondsSinceEpoch}',
        if (_timerSeconds > 0) 'expiresInSeconds': _timerSeconds,
      });
      _input.clear();
      await _loadMessages();
    } catch (e) {
      if (e is ApiException && e.statusCode == 409) {
        await _loadKeys();
        if (mounted) setState(() => _keyChanged = true);
      }
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e is ApiException ? e.message : 'Could not send.')));
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  Future<void> _delete(Map m) async {
    try {
      await ApiService.delete('$_base/messages/${m['id']}');
      setState(() { m['text'] = 'This message was deleted'; m['unreadable'] = true; });
    } catch (_) {}
  }

  Future<void> _pickTimer() async {
    final pick = await showModalBottomSheet<int>(
      context: context,
      backgroundColor: AppColors.surface,
      builder: (s) => SafeArea(
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          const ListTile(title: Text('Disappearing messages', style: TextStyle(fontWeight: FontWeight.w700))),
          for (final (label, secs) in [('Off', 0), ('1 hour', 3600), ('1 day', 86400), ('7 days', 604800)])
            RadioListTile<int>(value: secs, groupValue: _timerSeconds, title: Text(label), onChanged: (v) => Navigator.pop(s, v)),
        ]),
      ),
    );
    if (pick == null) return;
    final prefs = await SharedPreferences.getInstance();
    await prefs.setInt('private_timer_${widget.threadId}', pick);
    setState(() => _timerSeconds = pick);
  }

  void _showSecurityCode() {
    showDialog<void>(
      context: context,
      builder: (d) => AlertDialog(
        title: const Text('Security code'),
        content: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text('Compare this with ${widget.peerName}, in person or on a call. If both phones show the same numbers, nobody is in the middle.',
              style: TextStyle(color: AppColors.textSecondary)),
          const SizedBox(height: 16),
          SelectableText(_safety ?? '—', style: TextStyle(color: AppColors.ink, fontSize: 20, fontWeight: FontWeight.w700, letterSpacing: 1.5, height: 1.5, fontFamily: 'monospace')),
        ]),
        actions: [TextButton(onPressed: () => Navigator.pop(d), child: const Text('Done'))],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(
        title: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(widget.peerName),
          Row(children: [
            Icon(Icons.lock, size: 13, color: AppColors.green),
            const SizedBox(width: 4),
            Text('Private · end-to-end encrypted', style: TextStyle(fontSize: 12.5, color: AppColors.green)),
          ]),
        ]),
        actions: [
          IconButton(tooltip: 'Disappearing messages', icon: Icon(_timerSeconds > 0 ? Icons.timer : Icons.timer_outlined), onPressed: _pickTimer),
          IconButton(tooltip: 'Security code', icon: const Icon(Icons.verified_user_outlined), onPressed: _safety == null ? null : _showSecurityCode),
        ],
      ),
      body: _loading
          ? Center(child: CircularProgressIndicator(color: AppColors.cyan))
          : _error != null
              ? NtEmptyState(icon: Icons.lock_outline, title: "Couldn't open", message: _error!, error: true)
              : Column(children: [
                  if (_keyChanged)
                    MaterialBanner(
                      backgroundColor: AppColors.orange.withValues(alpha: 0.12),
                      content: Text("${widget.peerName}'s security code changed (new phone or reinstall). Check the code with them if you're unsure."),
                      actions: [
                        TextButton(onPressed: _showSecurityCode, child: const Text('View code')),
                        TextButton(onPressed: _acceptNewKey, child: const Text('OK')),
                      ],
                    ),
                  Expanded(
                    child: ListView(controller: _scroll, padding: const EdgeInsets.all(16), children: [
                      Container(
                        padding: const EdgeInsets.all(12),
                        margin: const EdgeInsets.only(bottom: 12),
                        decoration: BoxDecoration(color: AppColors.blueTint, borderRadius: BorderRadius.circular(12)),
                        child: Text(
                          'Messages here are end-to-end encrypted: only you and ${widget.peerName} can read them, not even NeuraTalk. '
                          'They are not translated, are only on your phones (not the web), and a new phone can\'t read older ones.',
                          style: TextStyle(color: AppColors.ink, fontSize: 13, height: 1.4),
                        ),
                      ),
                      if (_peer == null)
                        NtEmptyState(
                          icon: Icons.hourglass_empty,
                          title: 'Waiting for ${widget.peerName}',
                          message: 'Ask them to update NeuraTalk and open Private chat with you once. Then you can write here.',
                        ),
                      for (final m in _messages)
                        Align(
                          alignment: m['isOwn'] == true ? Alignment.centerRight : Alignment.centerLeft,
                          child: GestureDetector(
                            onLongPress: m['isOwn'] == true && m['unreadable'] != true ? () => _delete(m) : null,
                            child: Container(
                              constraints: BoxConstraints(maxWidth: MediaQuery.of(context).size.width * 0.78),
                              margin: const EdgeInsets.symmetric(vertical: 4),
                              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                              decoration: BoxDecoration(
                                color: m['isOwn'] == true ? AppColors.cyan.withValues(alpha: 0.18) : AppColors.surface,
                                borderRadius: BorderRadius.circular(16),
                                border: Border.all(color: AppColors.border),
                              ),
                              child: Column(crossAxisAlignment: CrossAxisAlignment.end, children: [
                                Text('${m['text']}', style: TextStyle(
                                  color: m['unreadable'] == true ? AppColors.textMuted : AppColors.ink,
                                  fontStyle: m['unreadable'] == true ? FontStyle.italic : FontStyle.normal, fontSize: 15)),
                                const SizedBox(height: 2),
                                Row(mainAxisSize: MainAxisSize.min, children: [
                                  Icon(Icons.lock, size: 11, color: AppColors.textMuted),
                                  const SizedBox(width: 3),
                                  Text([formatClockTime(m['createdAt']), if (m['isOwn'] == true && m['readAt'] != null) 'Seen'].join(' · '),
                                      style: TextStyle(color: AppColors.textMuted, fontSize: 11)),
                                ]),
                              ]),
                            ),
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
                            controller: _input,
                            enabled: _peer != null,
                            minLines: 1,
                            maxLines: 5,
                            maxLength: 4000,
                            decoration: InputDecoration(
                              hintText: _peer == null ? 'Waiting for them…' : 'Private message',
                              counterText: '',
                              prefixIcon: Icon(Icons.lock_outline, size: 18, color: AppColors.textMuted),
                            ),
                          ),
                        ),
                        IconButton(
                          tooltip: 'Send',
                          onPressed: _sending || _peer == null ? null : _send,
                          icon: Icon(Icons.send, color: AppColors.cyan),
                        ),
                      ]),
                    ),
                  ),
                ]),
    );
  }
}
