import 'dart:math';

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../services/api_service.dart';
import '../theme/app_theme.dart';
import '../widgets/nt_ui.dart';
import 'business_account.dart';

/// Auto-reply bot: when a customer types a word like "price" (or taps a
/// button), NeuraTalk answers at once as the business. Same server rules as
/// the web dashboard: one answer per message, cooldown, at most 5 in 10 min.
class BusinessAutoReplyScreen extends StatefulWidget {
  const BusinessAutoReplyScreen({super.key});

  @override
  State<BusinessAutoReplyScreen> createState() => _BusinessAutoReplyScreenState();
}

class _BusinessAutoReplyScreenState extends State<BusinessAutoReplyScreen> {
  List<Map<String, dynamic>>? _bots;
  String? _error;
  String? _pausedReason; // set when NeuraTalk paused this business's bots

  String get _base => '${context.read<BusinessAccount>().base}/auto-responders';

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _load());
  }

  Future<void> _load() async {
    try {
      final res = await ApiService.get(_base);
      final list = ((res as Map)['responders'] as List? ?? const []).whereType<Map>().map((m) => Map<String, dynamic>.from(m)).toList();
      final paused = res['pausedByNeuraTalk'];
      if (mounted) {
        setState(() {
          _bots = list;
          _error = null;
          _pausedReason = paused is Map ? (paused['reason']?.toString() ?? '') : null;
        });
      }
    } catch (e) {
      if (mounted) setState(() => _error = e is ApiException ? e.message : 'Check your connection and try again.');
    }
  }

  /// Every "Reply" button of every bot, so a tap can start another bot.
  List<(String, String)> get _buttons => [
        for (final b in _bots ?? const <Map<String, dynamic>>[])
          for (final x in (b['buttons'] as List? ?? const []).whereType<Map>())
            if (x['type'] == 'quick_reply' && x['id'] != null) ('${x['id']}', '${x['title']}'),
      ];

  Map<String, dynamic> _body(Map<String, dynamic> b) => {
        for (final k in const ['name', 'triggerType', 'matchType', 'keywords', 'replyText', 'buttons', 'formId', 'priority', 'cooldownSeconds', 'isActive']) k: b[k],
      };

  Future<void> _toggle(Map<String, dynamic> b) async {
    try {
      await ApiService.put('$_base/${b['id']}', {..._body(b), 'isActive': !(b['isActive'] == true)});
      await _load();
    } catch (e) {
      _snack(e is ApiException ? e.message : "Couldn't change it.");
    }
  }

  Future<void> _delete(Map<String, dynamic> b) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (c) => AlertDialog(
        title: Text('Delete "${b['name']}"?'),
        content: const Text('Customers will no longer get this automatic reply.'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(c, false), child: const Text('Cancel')),
          TextButton(onPressed: () => Navigator.pop(c, true), child: const Text('Delete')),
        ],
      ),
    );
    if (ok != true) return;
    try {
      await ApiService.delete('$_base/${b['id']}');
      await _load();
    } catch (e) {
      _snack(e is ApiException ? e.message : "Couldn't delete it.");
    }
  }

  Future<void> _edit([Map<String, dynamic>? b]) async {
    final account = context.read<BusinessAccount>();
    final saved = await Navigator.push<bool>(context, MaterialPageRoute(
      builder: (_) => ChangeNotifierProvider<BusinessAccount>.value(
        value: account,
        child: _AutoReplyEditor(initial: b, buttons: _buttons),
      ),
    ));
    if (saved == true) await _load();
  }

  void _snack(String m) {
    if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(m)));
  }

  @override
  Widget build(BuildContext context) {
    final bots = _bots;
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(title: const Text('Auto-reply bot')),
      floatingActionButton: bots == null ? null : FloatingActionButton.extended(
        onPressed: () => _edit(),
        icon: const Icon(Icons.add),
        label: const Text('New'),
      ),
      body: _error != null
          ? NtEmptyState(icon: Icons.wifi_off, title: "Couldn't load auto-replies", message: _error!, error: true, actionLabel: 'Try again', onAction: _load)
          : bots == null
              ? Center(child: CircularProgressIndicator(color: AppColors.cyan))
              : RefreshIndicator(
                  onRefresh: _load,
                  child: ListView(padding: const EdgeInsets.only(bottom: 96), children: [
                    if (_pausedReason != null)
                      Container(
                        margin: const EdgeInsets.fromLTRB(16, 12, 16, 0),
                        padding: const EdgeInsets.all(12),
                        decoration: BoxDecoration(color: AppColors.red.withValues(alpha: 0.08), borderRadius: BorderRadius.circular(12)),
                        child: Text(
                          'NeuraTalk paused your auto-replies. Customers get no automatic answers until this is lifted.'
                          '${_pausedReason!.isNotEmpty ? ' Reason: $_pausedReason' : ''}'
                          '${_pausedReason!.contains('support@') ? '' : ' Contact support@neuratalk.in.'}',
                          style: const TextStyle(color: AppColors.red, fontWeight: FontWeight.w600),
                        ),
                      ),
                    Padding(
                      padding: const EdgeInsets.fromLTRB(16, 12, 16, 8),
                      child: Text(
                        'When a customer types a word like "price" or taps a button, NeuraTalk answers at once as your business, day and night. '
                        'Each message gets one answer, and a customer gets at most 5 automatic replies in 10 minutes.',
                        style: TextStyle(color: AppColors.textSecondary, fontSize: 13.5),
                      ),
                    ),
                    if (bots.isEmpty)
                      const NtEmptyState(
                        icon: Icons.smart_toy_outlined,
                        title: 'No auto-replies yet',
                        message: 'Start with what customers ask most: prices, timings, location, menu.',
                      ),
                    for (final b in bots) _tile(b),
                  ]),
                ),
    );
  }

  Widget _tile(Map<String, dynamic> b) {
    final words = (b['keywords'] as List? ?? const []).map((k) {
      if (b['triggerType'] == 'button') return _buttons.firstWhere((x) => x.$1 == '$k', orElse: () => ('$k', '$k')).$2;
      return '$k';
    }).join(', ');
    final hits = (b['hits'] as num?)?.toInt() ?? 0;
    return ListTile(
      onTap: () => _edit(b),
      onLongPress: () => _delete(b),
      leading: CircleAvatar(
        backgroundColor: AppColors.blueTint,
        child: Icon(b['triggerType'] == 'button' ? Icons.touch_app_outlined : Icons.smart_toy_outlined, color: AppColors.cyan),
      ),
      title: Text('${b['name']}', style: TextStyle(color: AppColors.ink, fontWeight: FontWeight.w600)),
      subtitle: Text(
        '${b['triggerType'] == 'button' ? 'Tap' : 'Words'}: $words\n${b['replyText']}${hits > 0 ? '\n$hits replies sent' : ''}',
        maxLines: 4,
        overflow: TextOverflow.ellipsis,
        style: TextStyle(color: AppColors.textSecondary),
      ),
      isThreeLine: true,
      trailing: Switch(value: b['isActive'] == true, onChanged: (_) => _toggle(b)),
    );
  }
}

class _AutoReplyEditor extends StatefulWidget {
  const _AutoReplyEditor({this.initial, required this.buttons});
  final Map<String, dynamic>? initial;
  final List<(String, String)> buttons;

  @override
  State<_AutoReplyEditor> createState() => _AutoReplyEditorState();
}

class _AutoReplyEditorState extends State<_AutoReplyEditor> {
  late final _name = TextEditingController(text: widget.initial?['name']?.toString() ?? '');
  late final _reply = TextEditingController(text: widget.initial?['replyText']?.toString() ?? '');
  final _word = TextEditingController();
  late String _trigger = widget.initial?['triggerType']?.toString() ?? 'keyword';
  late String _match = widget.initial?['matchType']?.toString() ?? 'contains';
  late int _cooldown = (widget.initial?['cooldownSeconds'] as num?)?.toInt() ?? 60;
  late final List<String> _keywords = [for (final k in (widget.initial?['keywords'] as List? ?? const [])) '$k'];
  // Only "Reply" buttons are edited here; link/call buttons made on the web are kept as they are.
  late final List<Map<String, dynamic>> _otherButtons = [
    for (final b in (widget.initial?['buttons'] as List? ?? const []).whereType<Map>())
      if (b['type'] != 'quick_reply') Map<String, dynamic>.from(b),
  ];
  late final List<(String?, TextEditingController)> _replyButtons = [
    for (final b in (widget.initial?['buttons'] as List? ?? const []).whereType<Map>())
      if (b['type'] == 'quick_reply') (b['id']?.toString(), TextEditingController(text: '${b['title']}')),
  ];
  bool _saving = false;

  String get _base => '${context.read<BusinessAccount>().base}/auto-responders';

  @override
  void dispose() {
    _name.dispose();
    _reply.dispose();
    _word.dispose();
    for (final b in _replyButtons) {
      b.$2.dispose();
    }
    super.dispose();
  }

  void _addWords(String raw) {
    final parts = raw.split(',').map((w) => w.trim()).where((w) => w.isNotEmpty);
    setState(() {
      for (final p in parts) {
        if (!_keywords.contains(p) && _keywords.length < 20) _keywords.add(p);
      }
      _word.clear();
    });
  }

  static String _newId(String title) {
    final base = title.toLowerCase().replaceAll(RegExp(r'[^a-z0-9]+'), '_').replaceAll(RegExp(r'^_|_$'), '');
    final r = Random().nextInt(0xFFFFF).toRadixString(36);
    return '${base.isEmpty ? 'btn' : (base.length > 30 ? base.substring(0, 30) : base)}_$r';
  }

  Future<void> _save() async {
    if (_word.text.trim().isNotEmpty) _addWords(_word.text);
    final buttons = [
      for (final b in _replyButtons)
        if (b.$2.text.trim().isNotEmpty) {'type': 'quick_reply', 'id': b.$1 ?? _newId(b.$2.text), 'title': b.$2.text.trim()},
      ..._otherButtons,
    ];
    final body = {
      'name': _name.text.trim(),
      'triggerType': _trigger,
      'matchType': _match,
      'keywords': _keywords,
      'replyText': _reply.text.trim(),
      'buttons': buttons.take(3).toList(),
      'formId': widget.initial?['formId'],
      'priority': (widget.initial?['priority'] as num?)?.toInt() ?? 100,
      'cooldownSeconds': _cooldown,
      'isActive': widget.initial?['isActive'] ?? true,
    };
    setState(() => _saving = true);
    try {
      if (widget.initial == null) {
        await ApiService.post(_base, body);
      } else {
        await ApiService.put('$_base/${widget.initial!['id']}', body);
      }
      if (mounted) Navigator.pop(context, true);
    } catch (e) {
      if (mounted) {
        setState(() => _saving = false);
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e is ApiException ? e.message : "Couldn't save. Try again.")));
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final canSave = !_saving && _name.text.trim().isNotEmpty && _reply.text.trim().isNotEmpty && (_keywords.isNotEmpty || _word.text.trim().isNotEmpty);
    final buttonChoices = widget.buttons.where((b) => !_keywords.contains(b.$1)).toList();
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(
        title: Text(widget.initial == null ? 'New auto-reply' : 'Edit auto-reply'),
        actions: [TextButton(onPressed: canSave ? _save : null, child: const Text('SAVE'))],
      ),
      body: ListView(padding: const EdgeInsets.all(16), children: [
        TextField(
          controller: _name,
          maxLength: 60,
          onChanged: (_) => setState(() {}),
          decoration: const InputDecoration(labelText: 'Name (only you see this)', hintText: 'Prices'),
        ),
        const SizedBox(height: 8),
        SegmentedButton<String>(
          segments: const [
            ButtonSegment(value: 'keyword', label: Text('Customer types'), icon: Icon(Icons.keyboard_outlined)),
            ButtonSegment(value: 'button', label: Text('Customer taps'), icon: Icon(Icons.touch_app_outlined)),
          ],
          selected: {_trigger},
          onSelectionChanged: (s) => setState(() { _trigger = s.first; _keywords.clear(); }),
        ),
        const SizedBox(height: 16),
        if (_trigger == 'keyword') ...[
          TextField(
            controller: _word,
            textInputAction: TextInputAction.done,
            onChanged: (v) { if (v.endsWith(',')) { _addWords(v); } else { setState(() {}); } },
            onSubmitted: _addWords,
            decoration: InputDecoration(
              labelText: 'Words, in any language',
              hintText: 'price, rate, ధర, कीमत',
              suffixIcon: IconButton(icon: const Icon(Icons.add), tooltip: 'Add word', onPressed: () => _addWords(_word.text)),
            ),
          ),
          const SizedBox(height: 8),
          DropdownButtonFormField<String>(
            initialValue: _match,
            decoration: const InputDecoration(labelText: 'How to match'),
            items: const [
              DropdownMenuItem(value: 'contains', child: Text('Message contains the word')),
              DropdownMenuItem(value: 'exact', child: Text('Message is exactly the word')),
              DropdownMenuItem(value: 'starts_with', child: Text('Message starts with the word')),
            ],
            onChanged: (v) => setState(() => _match = v ?? 'contains'),
          ),
        ] else if (widget.buttons.isEmpty)
          Text('First add a "Reply" button to another auto-reply. Then you can answer the tap here.', style: TextStyle(color: AppColors.textSecondary))
        else if (buttonChoices.isNotEmpty)
          DropdownButtonFormField<String>(
            key: ValueKey(_keywords.length),
            decoration: const InputDecoration(labelText: 'Which button'),
            items: [for (final b in buttonChoices) DropdownMenuItem(value: b.$1, child: Text(b.$2))],
            onChanged: (v) => setState(() { if (v != null) _keywords.add(v); }),
          ),
        const SizedBox(height: 8),
        Wrap(spacing: 6, runSpacing: 6, children: [
          for (final k in _keywords)
            InputChip(
              label: Text(_trigger == 'button' ? widget.buttons.firstWhere((b) => b.$1 == k, orElse: () => (k, k)).$2 : k),
              onDeleted: () => setState(() => _keywords.remove(k)),
            ),
        ]),
        const SizedBox(height: 16),
        TextField(
          controller: _reply,
          maxLength: 1000,
          minLines: 3,
          maxLines: 8,
          onChanged: (_) => setState(() {}),
          decoration: const InputDecoration(
            labelText: 'Reply',
            hintText: 'Hi {{first_name}}! Kaju Barfi is ₹450 for 500 g.',
            helperText: '{{first_name}} becomes the customer\'s name. Customers read it in their own language.',
            helperMaxLines: 2,
            alignLabelWithHint: true,
          ),
        ),
        const SizedBox(height: 12),
        Row(children: [
          Expanded(child: Text('Reply buttons', style: TextStyle(color: AppColors.ink, fontWeight: FontWeight.w600))),
          TextButton.icon(
            onPressed: _replyButtons.length + _otherButtons.length >= 3 ? null : () => setState(() => _replyButtons.add((null, TextEditingController()))),
            icon: const Icon(Icons.add),
            label: const Text('Add'),
          ),
        ]),
        for (var i = 0; i < _replyButtons.length; i++)
          Padding(
            padding: const EdgeInsets.only(bottom: 8),
            child: TextField(
              controller: _replyButtons[i].$2,
              maxLength: 25,
              decoration: InputDecoration(
                labelText: 'Button ${i + 1}',
                hintText: 'Order now',
                counterText: '',
                suffixIcon: IconButton(
                  icon: const Icon(Icons.close),
                  tooltip: 'Remove button',
                  onPressed: () => setState(() => _replyButtons.removeAt(i).$2.dispose()),
                ),
              ),
            ),
          ),
        for (final b in _otherButtons)
          ListTile(
            contentPadding: EdgeInsets.zero,
            leading: Icon(b['type'] == 'url' ? Icons.link : Icons.call, color: AppColors.cyan),
            title: Text('${b['title']}'),
            subtitle: Text('${b['url'] ?? b['phone'] ?? ''} · change it on the computer'),
          ),
        const SizedBox(height: 12),
        DropdownButtonFormField<int>(
          initialValue: const [0, 60, 600, 3600, 86400].contains(_cooldown) ? _cooldown : 60,
          decoration: const InputDecoration(labelText: "Don't repeat to the same customer for"),
          items: const [
            DropdownMenuItem(value: 0, child: Text('Always reply')),
            DropdownMenuItem(value: 60, child: Text('1 minute')),
            DropdownMenuItem(value: 600, child: Text('10 minutes')),
            DropdownMenuItem(value: 3600, child: Text('1 hour')),
            DropdownMenuItem(value: 86400, child: Text('1 day')),
          ],
          onChanged: (v) => setState(() => _cooldown = v ?? 60),
        ),
        const SizedBox(height: 24),
        FilledButton(onPressed: canSave ? _save : null, child: _saving ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2)) : const Text('Save')),
      ]),
    );
  }
}
