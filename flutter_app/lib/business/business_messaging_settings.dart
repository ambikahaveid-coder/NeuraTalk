import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../services/api_service.dart';
import '../theme/app_theme.dart';
import '../widgets/nt_ui.dart';
import 'business_account.dart';

/// Loads and saves the business's chat settings (greeting, away message with
/// opening hours, quick replies, listed in search) as one object.
mixin _SettingsLoader<T extends StatefulWidget> on State<T> {
  Map<String, dynamic>? settings;
  bool loading = true;
  bool saving = false;
  String? loadError;

  String get settingsUrl => '${context.read<BusinessAccount>().base}/messaging-settings';

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => loadSettings());
  }

  Future<void> loadSettings() async {
    try {
      final res = await ApiService.get(settingsUrl);
      settings = _deepCopy(res['settings'] as Map);
      loadError = null;
      onLoaded();
    } catch (e) {
      loadError = e is ApiException ? e.message : 'Check your connection and try again.';
    }
    if (mounted) setState(() => loading = false);
  }

  void onLoaded() {}

  Future<bool> saveSettings() async {
    if (settings == null || saving) return false;
    setState(() => saving = true);
    try {
      final res = await ApiService.put(settingsUrl, settings!);
      settings = _deepCopy(res['settings'] as Map);
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Saved')));
      return true;
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e is ApiException ? e.message : 'Could not save. Try again.')));
      return false;
    } finally {
      if (mounted) setState(() => saving = false);
    }
  }

  Widget body(Widget Function() content) {
    if (loading) return Center(child: CircularProgressIndicator(color: AppColors.cyan));
    if (loadError != null) {
      return NtEmptyState(icon: Icons.wifi_off, title: "Couldn't load", message: loadError!, error: true, actionLabel: 'Try again', onAction: loadSettings);
    }
    return content();
  }

  Widget saveAction() => TextButton(
        onPressed: saving || settings == null ? null : saveSettings,
        child: saving ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2)) : const Text('Save'),
      );
}

Map<String, dynamic> _deepCopy(Map m) => m.map((k, v) => MapEntry('$k', v is Map ? _deepCopy(v) : v is List ? [for (final e in v) e is Map ? _deepCopy(e) : e] : v));

/// Greeting message: sent automatically when a customer writes to you for
/// the first time (WhatsApp Business → Greeting message).
class GreetingMessageScreen extends StatefulWidget {
  const GreetingMessageScreen({super.key});

  @override
  State<GreetingMessageScreen> createState() => _GreetingMessageScreenState();
}

class _GreetingMessageScreenState extends State<GreetingMessageScreen> with _SettingsLoader {
  final _text = TextEditingController();

  @override
  void onLoaded() {
    _text.text = settings?['greeting']?['text']?.toString() ?? '';
    if (_text.text.isEmpty) {
      _text.text = 'Namaste! Thank you for contacting ${context.read<BusinessAccount>().name}. How can we help you?';
    }
  }

  @override
  void dispose() {
    _text.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final greeting = (settings?['greeting'] as Map?) ?? const {};
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(title: const Text('Greeting message'), actions: [saveAction()]),
      body: body(() => ListView(padding: const EdgeInsets.all(20), children: [
            SwitchListTile(
              contentPadding: EdgeInsets.zero,
              value: greeting['enabled'] == true,
              onChanged: (v) => setState(() => settings!['greeting'] = {...greeting, 'enabled': v, 'text': _text.text.trim()}),
              title: const Text('Send greeting message'),
              subtitle: const Text('Greets customers when they message you for the first time'),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: _text,
              maxLength: 1000,
              minLines: 3,
              maxLines: 6,
              onChanged: (v) => settings!['greeting'] = {...(settings!['greeting'] as Map), 'text': v.trim()},
              decoration: const InputDecoration(labelText: 'Message'),
            ),
            Text('Each customer gets it in their own language.', style: TextStyle(color: AppColors.textMuted, fontSize: 13)),
          ])),
    );
  }
}

/// Away message + business hours: outside opening hours customers get this
/// reply (once every 12 hours), and the chat shows "Closed now".
class AwayMessageScreen extends StatefulWidget {
  const AwayMessageScreen({super.key});

  @override
  State<AwayMessageScreen> createState() => _AwayMessageScreenState();
}

class _AwayMessageScreenState extends State<AwayMessageScreen> with _SettingsLoader {
  final _text = TextEditingController();
  static const _days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  @override
  void onLoaded() {
    _text.text = settings?['away']?['text']?.toString() ?? '';
    if (_text.text.isEmpty) _text.text = "Thanks for your message. We're closed now and will reply as soon as we open.";
  }

  @override
  void dispose() {
    _text.dispose();
    super.dispose();
  }

  Map<String, dynamic> get _away => settings!['away'] as Map<String, dynamic>;
  Map<String, dynamic> get _hours => (_away['hours'] as Map<String, dynamic>?) ?? (_away['hours'] = <String, dynamic>{});

  Future<String?> _pickTime(String current) async {
    final parts = current.split(':');
    final picked = await showTimePicker(context: context, initialTime: TimeOfDay(hour: int.parse(parts[0]), minute: int.parse(parts[1])));
    if (picked == null) return null;
    return '${picked.hour.toString().padLeft(2, '0')}:${picked.minute.toString().padLeft(2, '0')}';
  }

  String _label(String hhmm) {
    final p = hhmm.split(':');
    final h = int.parse(p[0]);
    return '${h % 12 == 0 ? 12 : h % 12}:${p[1]} ${h < 12 ? 'AM' : 'PM'}';
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(title: const Text('Away message & hours'), actions: [saveAction()]),
      body: body(() {
        final hours = _hours;
        return ListView(padding: const EdgeInsets.all(20), children: [
          SwitchListTile(
            contentPadding: EdgeInsets.zero,
            value: _away['enabled'] == true,
            onChanged: (v) => setState(() { _away['enabled'] = v; _away['text'] = _text.text.trim(); }),
            title: const Text('Send away message'),
            subtitle: const Text('Replies automatically when you are closed'),
          ),
          TextField(
            controller: _text,
            maxLength: 1000,
            minLines: 2,
            maxLines: 5,
            onChanged: (v) => _away['text'] = v.trim(),
            decoration: const InputDecoration(labelText: 'Message'),
          ),
          const SizedBox(height: 12),
          Text('Business hours', style: TextStyle(color: AppColors.ink, fontSize: 17, fontWeight: FontWeight.w700)),
          const SizedBox(height: 4),
          Text(hours.isEmpty ? 'Not set — customers see you as always open.' : 'Customers see "Open now" or "Closed now".',
              style: TextStyle(color: AppColors.textMuted, fontSize: 13)),
          const SizedBox(height: 8),
          for (var d = 1; d <= 7; d++) _dayRow(d % 7, hours),
        ]);
      }),
    );
  }

  Widget _dayRow(int day, Map<String, dynamic> hours) {
    final key = '$day';
    final h = hours[key] as Map?;
    final open = h != null;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 2),
      child: Row(children: [
        SizedBox(width: 104, child: Text(_days[day], style: TextStyle(color: AppColors.ink, fontWeight: FontWeight.w600))),
        Switch(
          value: open,
          onChanged: (v) => setState(() => v ? hours[key] = {'open': '09:00', 'close': '21:00'} : hours.remove(key)),
        ),
        if (open) ...[
          TextButton(
            onPressed: () async {
              final t = await _pickTime('${h['open']}');
              if (t != null) setState(() => hours[key] = {...h, 'open': t});
            },
            child: Text(_label('${h['open']}')),
          ),
          Text('–', style: TextStyle(color: AppColors.textMuted)),
          TextButton(
            onPressed: () async {
              final t = await _pickTime('${h['close']}');
              if (t != null) setState(() => hours[key] = {...h, 'close': t});
            },
            child: Text(_label('${h['close']}')),
          ),
        ] else
          Text('Closed', style: TextStyle(color: AppColors.textMuted)),
      ]),
    );
  }
}

/// Quick replies: type "/" in a chat to send a saved answer.
class QuickRepliesScreen extends StatefulWidget {
  const QuickRepliesScreen({super.key});

  @override
  State<QuickRepliesScreen> createState() => _QuickRepliesScreenState();
}

class _QuickRepliesScreenState extends State<QuickRepliesScreen> with _SettingsLoader {
  List get _replies => (settings!['quickReplies'] as List?) ?? (settings!['quickReplies'] = []);

  Future<void> _edit([int? index]) async {
    final existing = index == null ? null : _replies[index] as Map;
    final shortcut = TextEditingController(text: existing?['shortcut']?.toString() ?? '');
    final text = TextEditingController(text: existing?['text']?.toString() ?? '');
    final result = await showModalBottomSheet<String>(
      context: context,
      isScrollControlled: true,
      backgroundColor: AppColors.surface,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(20))),
      builder: (sheet) => Padding(
        padding: EdgeInsets.fromLTRB(20, 20, 20, MediaQuery.of(sheet).viewInsets.bottom + 20),
        child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          Text(index == null ? 'New quick reply' : 'Edit quick reply', style: TextStyle(color: AppColors.ink, fontSize: 18, fontWeight: FontWeight.w700)),
          const SizedBox(height: 12),
          TextField(controller: shortcut, maxLength: 30, decoration: const InputDecoration(labelText: 'Shortcut', prefixText: '/', hintText: 'thanks')),
          TextField(controller: text, maxLength: 2000, minLines: 2, maxLines: 5, decoration: const InputDecoration(labelText: 'Message')),
          const SizedBox(height: 12),
          Row(children: [
            if (index != null)
              TextButton(onPressed: () => Navigator.pop(sheet, 'delete'), child: Text('Delete', style: TextStyle(color: AppColors.red))),
            const Spacer(),
            ElevatedButton(onPressed: () => Navigator.pop(sheet, 'save'), child: const Text('Done')),
          ]),
        ]),
      ),
    );
    if (result == 'delete' && index != null) {
      setState(() => _replies.removeAt(index));
      await saveSettings();
    } else if (result == 'save') {
      final s = shortcut.text.trim().toLowerCase().replaceAll(RegExp(r'[^a-z0-9_-]'), '');
      final t = text.text.trim();
      if (s.isEmpty || t.isEmpty) return;
      setState(() {
        final entry = {'shortcut': s, 'text': t};
        if (index == null) {
          _replies.add(entry);
        } else {
          _replies[index] = entry;
        }
      });
      await saveSettings();
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(title: const Text('Quick replies')),
      floatingActionButton: settings == null
          ? null
          : FloatingActionButton(
              heroTag: 'qr-add',
              onPressed: () => _edit(),
              backgroundColor: AppColors.cyan,
              foregroundColor: AppColors.onAccent,
              child: const Icon(Icons.add),
            ),
      body: body(() => _replies.isEmpty
          ? const NtEmptyState(
              icon: Icons.bolt_outlined,
              title: 'Answer faster',
              message: 'Save answers you send often. In any chat, type "/" and pick one.',
            )
          : ListView.separated(
              padding: const EdgeInsets.only(bottom: 96),
              itemCount: _replies.length,
              separatorBuilder: (_, __) => Divider(height: 1, color: AppColors.border),
              itemBuilder: (_, i) {
                final q = _replies[i] as Map;
                return ListTile(
                  title: Text('/${q['shortcut']}', style: TextStyle(color: AppColors.cyan, fontWeight: FontWeight.w700)),
                  subtitle: Text('${q['text']}', maxLines: 2, overflow: TextOverflow.ellipsis),
                  onTap: () => _edit(i),
                );
              },
            )),
    );
  }
}
