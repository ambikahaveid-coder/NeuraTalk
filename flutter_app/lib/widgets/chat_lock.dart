import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:path_provider/path_provider.dart';
import 'package:share_plus/share_plus.dart';

import '../theme/app_theme.dart';

/// Chat lock: chosen chats are hidden behind a secret code kept in this
/// phone's encrypted storage (like WhatsApp's locked chats / secret code).
/// Keys: "p:<threadId>" for 1:1 chats, "g:<groupId>" for groups.
class ChatLock extends ChangeNotifier {
  ChatLock._() {
    // Leaving the app locks the folder again.
    AppLifecycleListener(onHide: () {
      if (_unlocked) {
        _unlocked = false;
        notifyListeners();
      }
    });
  }
  static final ChatLock instance = ChatLock._();

  static const _storage = FlutterSecureStorage();
  static const _codeKey = 'chat_lock_code_v1';
  static const _chatsKey = 'chat_lock_chats_v1';

  final Set<String> _locked = {};
  bool _loaded = false;
  bool _unlocked = false;

  bool get unlocked => _unlocked;
  int get count => _locked.length;
  bool isLocked(String key) => _locked.contains(key);

  Future<void> load() async {
    if (_loaded) return;
    try {
      final raw = await _storage.read(key: _chatsKey);
      if (raw != null) _locked.addAll((jsonDecode(raw) as List).map((e) => e.toString()));
    } catch (_) {}
    _loaded = true;
    notifyListeners();
  }

  Future<void> _save() async {
    try {
      await _storage.write(key: _chatsKey, value: jsonEncode(_locked.toList()));
    } catch (_) {}
    notifyListeners();
  }

  /// Locks a chat; the first time, the person picks the secret code.
  Future<bool> lock(BuildContext context, String key) async {
    await load();
    final existing = await _storage.read(key: _codeKey);
    if (existing == null) {
      if (!context.mounted) return false;
      final code = await _askCode(context, title: 'Create a secret code', hint: 'You\'ll use it to open locked chats. 4–8 digits.');
      if (code == null) return false;
      if (!context.mounted) return false;
      final again = await _askCode(context, title: 'Enter it again');
      if (again != code) {
        if (context.mounted) _toast(context, 'The codes don\'t match.');
        return false;
      }
      await _storage.write(key: _codeKey, value: code);
    }
    _locked.add(key);
    _unlocked = false;
    await _save();
    if (context.mounted) _toast(context, 'Chat locked. Find it under "Locked chats".');
    return true;
  }

  Future<bool> unlockChat(BuildContext context, String key) async {
    if (!await verify(context)) return false;
    _locked.remove(key);
    await _save();
    if (context.mounted) _toast(context, 'Chat unlocked');
    return true;
  }

  /// Asks the secret code; true when right. Opens the locked folder for this session.
  Future<bool> verify(BuildContext context) async {
    if (_unlocked) return true;
    final stored = await _storage.read(key: _codeKey);
    if (stored == null) return true;
    if (!context.mounted) return false;
    final code = await _askCode(context, title: 'Enter your secret code');
    if (code == null) return false;
    if (code != stored) {
      if (context.mounted) _toast(context, 'Wrong code');
      return false;
    }
    _unlocked = true;
    notifyListeners();
    return true;
  }

  static void _toast(BuildContext context, String t) => ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(t)));

  static Future<String?> _askCode(BuildContext context, {required String title, String? hint}) {
    final c = TextEditingController();
    return showDialog<String>(
      context: context,
      builder: (d) => AlertDialog(
        title: Text(title),
        content: Column(mainAxisSize: MainAxisSize.min, children: [
          if (hint != null) Text(hint, style: TextStyle(color: AppColors.textSecondary)),
          TextField(
            controller: c,
            autofocus: true,
            obscureText: true,
            keyboardType: TextInputType.number,
            maxLength: 8,
            inputFormatters: [FilteringTextInputFormatter.digitsOnly],
            decoration: const InputDecoration(counterText: ''),
          ),
        ]),
        actions: [
          TextButton(onPressed: () => Navigator.pop(d), child: const Text('Cancel')),
          FilledButton(
            onPressed: () {
              final v = c.text.trim();
              if (v.length >= 4) Navigator.pop(d, v);
            },
            child: const Text('OK'),
          ),
        ],
      ),
    );
  }
}

/// Writes a chat to a .txt file and opens the share sheet (WhatsApp's "Export chat").
Future<void> shareChatExport(BuildContext context, String title, List<String> lines) async {
  try {
    final dir = await getTemporaryDirectory();
    final safe = title.replaceAll(RegExp(r'[^\w\s-]'), '').trim();
    final file = File('${dir.path}/NeuraTalk chat with ${safe.isEmpty ? 'contact' : safe}.txt');
    await file.writeAsString(lines.join('\n'), flush: true);
    await Share.shareXFiles([XFile(file.path, mimeType: 'text/plain')], subject: 'NeuraTalk chat with $title');
  } catch (_) {
    if (context.mounted) ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Could not export this chat.')));
  }
}

/// One exported line: "31/10/26, 9:05 PM - Name: text".
String exportLine(dynamic createdAt, String who, String text) {
  final d = DateTime.tryParse(createdAt?.toString() ?? '')?.toLocal();
  final when = d == null
      ? ''
      : '${d.day}/${d.month}/${d.year % 100}, ${d.hour % 12 == 0 ? 12 : d.hour % 12}:${d.minute.toString().padLeft(2, '0')} ${d.hour < 12 ? 'AM' : 'PM'}';
  return '$when - $who: $text';
}

/// What an exported message says for photos, files, polls etc.
String exportText(Map<String, dynamic> m, String fallback) {
  if (m['isDeleted'] == true) return 'This message was deleted';
  if (m['viewOnce'] == true) return '<View once media>';
  if (m['poll'] is Map) {
    final p = m['poll'] as Map;
    final opts = ((p['options'] as List?) ?? const []).whereType<Map>().map((o) => '${o['text']} (${o['votes'] ?? 0})').join(', ');
    return 'POLL: ${p['question']} — $opts';
  }
  if (m['contact'] is Map) return 'Contact: ${(m['contact'] as Map)['name']} ${((m['contact'] as Map)['phones'] as List?)?.join(', ') ?? ''}';
  switch (m['messageType']) {
    case 'attachment':
      return '<Photo omitted>';
    case 'file':
      return '<${m['attachmentTitle'] ?? 'File'} omitted>';
    case 'voice_note':
      return '<Voice message omitted>';
    case 'location':
      return 'Location: ${m['attachmentTitle'] ?? ''}';
  }
  return fallback;
}
