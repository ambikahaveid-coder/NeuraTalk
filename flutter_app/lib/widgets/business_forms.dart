import 'dart:io';

import 'package:flutter/material.dart';
import 'package:path_provider/path_provider.dart';
import 'package:provider/provider.dart';
import 'package:share_plus/share_plus.dart';

import '../business/business_account.dart';
import '../services/api_service.dart';
import '../theme/app_theme.dart';

/// Business forms (like WhatsApp Flows): customer side card + fill-in sheet,
/// business side form picker and forms manager.

// ------------------------------------------------------------------ customer

/// The form inside a business chat. Tapping "Fill in" opens the fields.
class FormMessageCard extends StatelessWidget {
  final Map<String, dynamic> form;
  final bool submitted;
  final Future<void> Function(Map<String, String> answers)? onSubmit;
  const FormMessageCard({super.key, required this.form, required this.submitted, this.onSubmit});

  @override
  Widget build(BuildContext context) {
    return Column(crossAxisAlignment: CrossAxisAlignment.start, mainAxisSize: MainAxisSize.min, children: [
      Row(children: [
        Icon(Icons.assignment_outlined, color: AppColors.cyan, size: 20),
        const SizedBox(width: 6),
        Flexible(child: Text(form['title']?.toString() ?? 'Form', style: TextStyle(color: AppColors.ink, fontWeight: FontWeight.w800, fontSize: 15))),
      ]),
      if ((form['intro'] ?? '').toString().isNotEmpty)
        Padding(padding: const EdgeInsets.only(top: 4), child: Text(form['intro'].toString(), style: TextStyle(color: AppColors.textSecondary))),
      const SizedBox(height: 8),
      if (submitted)
        Row(children: [Icon(Icons.check_circle, color: AppColors.green, size: 18), const SizedBox(width: 6), Text('Sent', style: TextStyle(color: AppColors.green, fontWeight: FontWeight.w700))])
      else if (onSubmit != null)
        FilledButton.tonal(
          onPressed: () async {
            final answers = await showModalBottomSheet<Map<String, String>>(
              context: context,
              isScrollControlled: true,
              backgroundColor: AppColors.surface,
              builder: (_) => _FillFormSheet(form: form),
            );
            if (answers != null) await onSubmit!(answers);
          },
          child: const Text('Fill in'),
        ),
    ]);
  }
}

class _FillFormSheet extends StatefulWidget {
  final Map<String, dynamic> form;
  const _FillFormSheet({required this.form});
  @override
  State<_FillFormSheet> createState() => _FillFormSheetState();
}

class _FillFormSheetState extends State<_FillFormSheet> {
  final Map<String, TextEditingController> _text = {};
  final Map<String, String> _choice = {};
  final Map<String, DateTime> _date = {};
  String? _error;

  List<Map<String, dynamic>> get _fields => ((widget.form['fields'] as List?) ?? const []).whereType<Map>().map((e) => Map<String, dynamic>.from(e)).toList();

  @override
  void dispose() {
    for (final c in _text.values) {
      c.dispose();
    }
    super.dispose();
  }

  TextEditingController _ctrl(String id) => _text.putIfAbsent(id, TextEditingController.new);

  void _submit() {
    final out = <String, String>{};
    for (final f in _fields) {
      final id = f['id'].toString();
      final type = f['type'].toString();
      final v = type == 'choice'
          ? (_choice[id] ?? '')
          : type == 'date'
              ? (_date[id] == null ? '' : '${_date[id]!.year.toString().padLeft(4, '0')}-${_date[id]!.month.toString().padLeft(2, '0')}-${_date[id]!.day.toString().padLeft(2, '0')}')
              : _ctrl(id).text.trim();
      if (v.isEmpty && f['required'] == true) {
        setState(() => _error = '"${f['label']}" is required.');
        return;
      }
      out[id] = v;
    }
    Navigator.pop(context, out);
  }

  Widget _field(Map<String, dynamic> f) {
    final id = f['id'].toString();
    final label = '${f['label']}${f['required'] == true ? ' *' : ''}';
    switch (f['type']) {
      case 'choice':
        return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(label, style: TextStyle(color: AppColors.ink, fontWeight: FontWeight.w600)),
          Wrap(spacing: 8, children: [
            for (final o in ((f['options'] as List?) ?? const []).map((e) => e.toString()))
              ChoiceChip(label: Text(o), selected: _choice[id] == o, onSelected: (_) => setState(() => _choice[id] = o)),
          ]),
        ]);
      case 'date':
        return ListTile(
          contentPadding: EdgeInsets.zero,
          title: Text(label, style: TextStyle(color: AppColors.ink)),
          subtitle: Text(_date[id] == null ? 'Pick a date' : '${_date[id]!.day}/${_date[id]!.month}/${_date[id]!.year}', style: TextStyle(color: AppColors.textSecondary)),
          trailing: const Icon(Icons.calendar_today_outlined),
          onTap: () async {
            final now = DateTime.now();
            final d = await showDatePicker(context: context, firstDate: DateTime(now.year - 100), lastDate: DateTime(now.year + 5), initialDate: _date[id] ?? now);
            if (d != null) setState(() => _date[id] = d);
          },
        );
      default:
        return TextField(
          controller: _ctrl(id),
          maxLines: f['type'] == 'long_text' ? 4 : 1,
          keyboardType: f['type'] == 'number'
              ? TextInputType.number
              : f['type'] == 'phone'
                  ? TextInputType.phone
                  : f['type'] == 'email'
                      ? TextInputType.emailAddress
                      : TextInputType.text,
          style: TextStyle(color: AppColors.ink),
          decoration: InputDecoration(labelText: label),
        );
    }
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.only(bottom: MediaQuery.of(context).viewInsets.bottom),
      child: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(16),
          child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, mainAxisSize: MainAxisSize.min, children: [
            Text(widget.form['title']?.toString() ?? 'Form', style: TextStyle(color: AppColors.ink, fontSize: 20, fontWeight: FontWeight.w800)),
            if ((widget.form['intro'] ?? '').toString().isNotEmpty)
              Padding(padding: const EdgeInsets.only(top: 4), child: Text(widget.form['intro'].toString(), style: TextStyle(color: AppColors.textSecondary))),
            const SizedBox(height: 8),
            for (final f in _fields) Padding(padding: const EdgeInsets.only(top: 10), child: _field(f)),
            if (_error != null) Padding(padding: const EdgeInsets.only(top: 8), child: Text(_error!, style: const TextStyle(color: AppColors.red))),
            const SizedBox(height: 16),
            FilledButton(onPressed: _submit, child: const Text('Send')),
            const SizedBox(height: 4),
            Text('Your answers go only to this business.', textAlign: TextAlign.center, style: TextStyle(color: AppColors.textMuted, fontSize: 12)),
          ]),
        ),
      ),
    );
  }
}

// ------------------------------------------------------------------ business

/// Pick one of the business's forms to send. Returns the form id.
Future<int?> pickBusinessForm(BuildContext context, String base) async {
  List<Map<String, dynamic>> forms = [];
  try {
    final res = await ApiService.get('$base/forms');
    forms = ((res['forms'] as List?) ?? const []).whereType<Map>().map((e) => Map<String, dynamic>.from(e)).toList();
  } catch (_) {}
  if (!context.mounted) return null;
  if (forms.isEmpty) {
    ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('No forms yet. Create one in Tools → Forms.')));
    return null;
  }
  return showModalBottomSheet<int>(
    context: context,
    backgroundColor: AppColors.surface,
    builder: (s) => SafeArea(
      child: ListView(shrinkWrap: true, children: [
        Padding(padding: const EdgeInsets.all(16), child: Text('Send a form', style: TextStyle(color: AppColors.ink, fontSize: 18, fontWeight: FontWeight.w800))),
        for (final f in forms)
          ListTile(
            leading: Icon(Icons.assignment_outlined, color: AppColors.cyan),
            title: Text(f['title']?.toString() ?? ''),
            subtitle: Text('${(f['fields'] as List?)?.length ?? 0} questions · ${f['responses'] ?? 0} answers'),
            onTap: () => Navigator.pop(s, f['id'] as int),
          ),
      ]),
    ),
  );
}

/// Tools → Forms: list, build, see answers, export CSV.
class BusinessFormsScreen extends StatefulWidget {
  const BusinessFormsScreen({super.key});
  @override
  State<BusinessFormsScreen> createState() => _BusinessFormsScreenState();
}

class _BusinessFormsScreenState extends State<BusinessFormsScreen> {
  List<Map<String, dynamic>>? _forms;
  String get _base => context.read<BusinessAccount>().base;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _load());
  }

  Future<void> _load() async {
    try {
      final res = await ApiService.get('$_base/forms');
      if (mounted) setState(() => _forms = ((res['forms'] as List?) ?? const []).whereType<Map>().map((e) => Map<String, dynamic>.from(e)).toList());
    } on ApiException catch (e) {
      if (mounted) {
        setState(() => _forms = []);
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.message)));
      }
    } catch (_) {
      if (mounted) setState(() => _forms = []);
    }
  }

  Future<void> _edit([Map<String, dynamic>? form]) async {
    final saved = await Navigator.push<bool>(context, MaterialPageRoute(builder: (_) => _FormBuilderScreen(base: _base, form: form)));
    if (saved == true) _load();
  }

  @override
  Widget build(BuildContext context) {
    final forms = _forms;
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(title: const Text('Forms')),
      floatingActionButton: FloatingActionButton.extended(onPressed: () => _edit(), icon: const Icon(Icons.add), label: const Text('New form')),
      body: forms == null
          ? const Center(child: CircularProgressIndicator())
          : ListView(padding: const EdgeInsets.fromLTRB(16, 16, 16, 96), children: [
              Text('Send a form in a chat (bookings, enquiries, feedback). Customers fill it in inside the chat and the answers come here.',
                  style: TextStyle(color: AppColors.textSecondary)),
              const SizedBox(height: 12),
              if (forms.isEmpty) Padding(padding: const EdgeInsets.all(24), child: Center(child: Text('No forms yet.', style: TextStyle(color: AppColors.textMuted)))),
              for (final f in forms)
                Card(
                  color: AppColors.surface,
                  child: ListTile(
                    leading: Icon(Icons.assignment_outlined, color: AppColors.cyan),
                    title: Text(f['title']?.toString() ?? '', style: TextStyle(color: AppColors.ink, fontWeight: FontWeight.w700)),
                    subtitle: Text('${(f['fields'] as List?)?.length ?? 0} questions · ${f['responses'] ?? 0} answers', style: TextStyle(color: AppColors.textSecondary)),
                    trailing: PopupMenuButton<String>(
                      onSelected: (v) async {
                        if (v == 'answers') {
                          Navigator.push(context, MaterialPageRoute(builder: (_) => _FormResponsesScreen(base: _base, form: f)));
                        } else if (v == 'edit') {
                          _edit(f);
                        } else if (v == 'delete') {
                          try {
                            await ApiService.delete('$_base/forms/${f['id']}');
                            _load();
                          } catch (_) {}
                        }
                      },
                      itemBuilder: (_) => const [
                        PopupMenuItem(value: 'answers', child: Text('See answers')),
                        PopupMenuItem(value: 'edit', child: Text('Edit')),
                        PopupMenuItem(value: 'delete', child: Text('Delete', style: TextStyle(color: AppColors.red))),
                      ],
                    ),
                    onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => _FormResponsesScreen(base: _base, form: f))),
                  ),
                ),
            ]),
    );
  }
}

class _FormBuilderScreen extends StatefulWidget {
  final String base;
  final Map<String, dynamic>? form;
  const _FormBuilderScreen({required this.base, this.form});
  @override
  State<_FormBuilderScreen> createState() => _FormBuilderScreenState();
}

class _FormBuilderScreenState extends State<_FormBuilderScreen> {
  late final _title = TextEditingController(text: widget.form?['title']?.toString() ?? '');
  late final _intro = TextEditingController(text: widget.form?['intro']?.toString() ?? '');
  late final List<Map<String, dynamic>> _fields = [
    for (final f in ((widget.form?['fields'] as List?) ?? const []).whereType<Map>()) Map<String, dynamic>.from(f),
  ];
  bool _saving = false;
  static const _types = {'text': 'Short answer', 'long_text': 'Paragraph', 'number': 'Number', 'date': 'Date', 'choice': 'Choice', 'phone': 'Phone', 'email': 'Email'};

  @override
  void initState() {
    super.initState();
    if (_fields.isEmpty) _fields.add({'id': 'name', 'label': 'Your name', 'type': 'text', 'required': true});
  }

  String _idFor(String label) {
    var base = label.toLowerCase().replaceAll(RegExp(r'[^a-z0-9]+'), '_').replaceAll(RegExp(r'^_|_$'), '');
    if (base.isEmpty) base = 'q';
    if (base.length > 24) base = base.substring(0, 24);
    var id = base;
    var n = 2;
    while (_fields.where((f) => f['id'] == id).length > (_fields.any((f) => f['label'] == label && f['id'] == id) ? 1 : 0)) {
      id = '${base}_$n';
      n++;
    }
    return id;
  }

  Future<void> _editField([int? index]) async {
    final f = index == null ? <String, dynamic>{'type': 'text', 'required': false} : Map<String, dynamic>.from(_fields[index]);
    final label = TextEditingController(text: f['label']?.toString() ?? '');
    final options = TextEditingController(text: ((f['options'] as List?) ?? const []).join(', '));
    final result = await showDialog<Map<String, dynamic>>(
      context: context,
      builder: (d) => StatefulBuilder(builder: (ctx, setD) => AlertDialog(
        title: Text(index == null ? 'Add a question' : 'Edit question'),
        content: SingleChildScrollView(
          child: Column(mainAxisSize: MainAxisSize.min, children: [
            TextField(controller: label, autofocus: true, maxLength: 80, decoration: const InputDecoration(labelText: 'Question')),
            DropdownButtonFormField<String>(
              initialValue: f['type']?.toString() ?? 'text',
              items: [for (final e in _types.entries) DropdownMenuItem(value: e.key, child: Text(e.value))],
              onChanged: (v) => setD(() => f['type'] = v),
              decoration: const InputDecoration(labelText: 'Answer type'),
            ),
            if (f['type'] == 'choice')
              TextField(controller: options, decoration: const InputDecoration(labelText: 'Options, separated by commas')),
            SwitchListTile(contentPadding: EdgeInsets.zero, value: f['required'] == true, onChanged: (v) => setD(() => f['required'] = v), title: const Text('Required')),
          ]),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(d), child: const Text('Cancel')),
          FilledButton(
            onPressed: () {
              if (label.text.trim().isEmpty) return;
              f['label'] = label.text.trim();
              f['id'] ??= _idFor(label.text.trim());
              if (f['type'] == 'choice') {
                f['options'] = options.text.split(',').map((e) => e.trim()).where((e) => e.isNotEmpty).toSet().toList();
              } else {
                f.remove('options');
              }
              Navigator.pop(d, f);
            },
            child: const Text('Save'),
          ),
        ],
      )),
    );
    if (result == null) return;
    setState(() => index == null ? _fields.add(result) : _fields[index] = result);
  }

  Future<void> _save() async {
    if (_title.text.trim().length < 2) return _toast('Give the form a title.');
    if (_fields.isEmpty) return _toast('Add at least one question.');
    setState(() => _saving = true);
    final body = {
      'name': _title.text.trim(),
      'title': _title.text.trim(),
      if (_intro.text.trim().isNotEmpty) 'intro': _intro.text.trim(),
      'fields': _fields,
    };
    try {
      if (widget.form == null) {
        await ApiService.post('${widget.base}/forms', body);
      } else {
        await ApiService.put('${widget.base}/forms/${widget.form!['id']}', body);
      }
      if (mounted) Navigator.pop(context, true);
    } on ApiException catch (e) {
      _toast(e.message);
    } catch (_) {
      _toast('Could not save the form.');
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  void _toast(String t) {
    if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(t)));
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(
        title: Text(widget.form == null ? 'New form' : 'Edit form'),
        actions: [TextButton(onPressed: _saving ? null : _save, child: Text(_saving ? 'Saving…' : 'Save'))],
      ),
      body: ListView(padding: const EdgeInsets.all(16), children: [
        TextField(controller: _title, maxLength: 80, style: TextStyle(color: AppColors.ink), decoration: const InputDecoration(labelText: 'Title (customers see this)')),
        TextField(controller: _intro, maxLength: 300, maxLines: 2, style: TextStyle(color: AppColors.ink), decoration: const InputDecoration(labelText: 'Short note (optional)')),
        const SizedBox(height: 8),
        Text('Questions', style: TextStyle(color: AppColors.ink, fontWeight: FontWeight.w700)),
        ReorderableListView(
          shrinkWrap: true,
          physics: const NeverScrollableScrollPhysics(),
          onReorder: (a, b) => setState(() {
            final f = _fields.removeAt(a);
            _fields.insert(b > a ? b - 1 : b, f);
          }),
          children: [
            for (var i = 0; i < _fields.length; i++)
              ListTile(
                key: ValueKey('${_fields[i]['id']}-$i'),
                contentPadding: EdgeInsets.zero,
                title: Text('${_fields[i]['label']}${_fields[i]['required'] == true ? ' *' : ''}', style: TextStyle(color: AppColors.ink)),
                subtitle: Text(_types[_fields[i]['type']] ?? '', style: TextStyle(color: AppColors.textSecondary)),
                onTap: () => _editField(i),
                trailing: IconButton(icon: const Icon(Icons.delete_outline), onPressed: () => setState(() => _fields.removeAt(i))),
              ),
          ],
        ),
        if (_fields.length < 15) TextButton.icon(onPressed: () => _editField(), icon: const Icon(Icons.add), label: const Text('Add a question')),
      ]),
    );
  }
}

class _FormResponsesScreen extends StatefulWidget {
  final String base;
  final Map<String, dynamic> form;
  const _FormResponsesScreen({required this.base, required this.form});
  @override
  State<_FormResponsesScreen> createState() => _FormResponsesScreenState();
}

class _FormResponsesScreenState extends State<_FormResponsesScreen> {
  List<Map<String, dynamic>>? _list;

  @override
  void initState() {
    super.initState();
    ApiService.get('${widget.base}/forms/${widget.form['id']}/responses').then((res) {
      if (mounted) setState(() => _list = ((res['responses'] as List?) ?? const []).whereType<Map>().map((e) => Map<String, dynamic>.from(e)).toList());
    }).catchError((_) {
      if (mounted) setState(() => _list = []);
    });
  }

  Future<void> _export() async {
    try {
      final token = ApiService.token;
      final res = await HttpClient().getUrl(Uri.parse('${ApiService.baseUrl}${widget.base}/forms/${widget.form['id']}/responses.csv'))
          .then((r) {
        if (token != null) r.headers.set('Authorization', 'Bearer $token');
        return r.close();
      });
      final bytes = await res.fold<List<int>>(<int>[], (a, b) => a..addAll(b));
      if (res.statusCode != 200) throw Exception('failed');
      final dir = await getTemporaryDirectory();
      final file = File('${dir.path}/${(widget.form['title'] ?? 'form').toString().replaceAll(RegExp(r'[^\w-]+'), '_')}-answers.csv');
      await file.writeAsBytes(bytes, flush: true);
      await Share.shareXFiles([XFile(file.path, mimeType: 'text/csv')]);
    } catch (_) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Could not export the answers.')));
    }
  }

  @override
  Widget build(BuildContext context) {
    final list = _list;
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(
        title: Text(widget.form['title']?.toString() ?? 'Answers'),
        actions: [IconButton(tooltip: 'Export CSV', icon: const Icon(Icons.download_outlined), onPressed: _export)],
      ),
      body: list == null
          ? const Center(child: CircularProgressIndicator())
          : list.isEmpty
              ? Center(child: Text('No answers yet.', style: TextStyle(color: AppColors.textMuted)))
              : ListView.builder(
                  padding: const EdgeInsets.all(12),
                  itemCount: list.length,
                  itemBuilder: (_, i) {
                    final r = list[i];
                    final answers = ((r['answers'] as List?) ?? const []).whereType<Map>().toList();
                    final when = DateTime.tryParse(r['createdAt']?.toString() ?? '')?.toLocal();
                    return Card(
                      color: AppColors.surface,
                      child: Padding(
                        padding: const EdgeInsets.all(12),
                        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                          Text('${r['customerName'] ?? 'Customer'}${when == null ? '' : ' · ${when.day}/${when.month}/${when.year}'}',
                              style: TextStyle(color: AppColors.ink, fontWeight: FontWeight.w700)),
                          const SizedBox(height: 6),
                          for (final a in answers)
                            if ((a['value'] ?? '').toString().isNotEmpty)
                              Padding(
                                padding: const EdgeInsets.only(top: 2),
                                child: Text('${a['label']}: ${a['value']}', style: TextStyle(color: AppColors.textSecondary)),
                              ),
                        ]),
                      ),
                    );
                  },
                ),
    );
  }
}
