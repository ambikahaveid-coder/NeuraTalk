import 'dart:convert';
import 'dart:io';

import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:flutter_contacts/flutter_contacts.dart';
import 'package:provider/provider.dart';

import '../services/api_service.dart';
import '../theme/app_theme.dart';
import 'business_account.dart';

/// Add many customers at once: a CSV file (name, phone, email) or contacts
/// picked from the phone. Duplicates are skipped by the server.
class BusinessImportScreen extends StatefulWidget {
  const BusinessImportScreen({super.key});

  @override
  State<BusinessImportScreen> createState() => _BusinessImportScreenState();
}

class _BusinessImportScreenState extends State<BusinessImportScreen> {
  List<Map<String, String>> _rows = [];
  String? _source;
  bool _consent = false;
  bool _uploading = false;
  Map<String, dynamic>? _result;

  /// Very small CSV reader: commas, optional quotes, first row may be a header.
  static List<List<String>> _parseCsv(String text) {
    final rows = <List<String>>[];
    for (final raw in const LineSplitter().convert(text)) {
      if (raw.trim().isEmpty) continue;
      final cells = <String>[];
      final cell = StringBuffer();
      var quoted = false;
      for (var i = 0; i < raw.length; i++) {
        final ch = raw[i];
        if (ch == '"') {
          if (quoted && i + 1 < raw.length && raw[i + 1] == '"') {
            cell.write('"');
            i++;
          } else {
            quoted = !quoted;
          }
        } else if (ch == ',' && !quoted) {
          cells.add(cell.toString().trim());
          cell.clear();
        } else {
          cell.write(ch);
        }
      }
      cells.add(cell.toString().trim());
      rows.add(cells);
    }
    return rows;
  }

  Future<void> _pickCsv() async {
    final picked = await FilePicker.platform.pickFiles(type: FileType.custom, allowedExtensions: ['csv', 'txt']);
    final path = picked?.files.single.path;
    if (path == null) return;
    final table = _parseCsv(await File(path).readAsString());
    if (table.isEmpty) return;
    // Find columns by header if there is one; else assume name, phone, email.
    final header = table.first.map((h) => h.toLowerCase()).toList();
    final hasHeader = header.any((h) => h.contains('phone') || h.contains('mobile') || h.contains('name') || h.contains('email'));
    int col(List<String> keys, int fallback) {
      if (!hasHeader) return fallback;
      final i = header.indexWhere((h) => keys.any(h.contains));
      return i;
    }
    final nameCol = col(['name'], 0), phoneCol = col(['phone', 'mobile', 'number'], 1), emailCol = col(['email', 'mail'], 2);
    String at(List<String> r, int c) => c >= 0 && c < r.length ? r[c] : '';
    final rows = [
      for (final r in hasHeader ? table.skip(1) : table)
        {'name': at(r, nameCol), 'phone': at(r, phoneCol), 'email': at(r, emailCol)},
    ].where((r) => (r['phone'] ?? '').isNotEmpty || (r['email'] ?? '').isNotEmpty).toList();
    setState(() {
      _rows = rows.take(2000).toList();
      _source = '${File(path).uri.pathSegments.last} · ${_rows.length} contacts';
      _result = null;
    });
  }

  Future<void> _pickContacts() async {
    if (!await FlutterContacts.requestPermission(readonly: true)) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Allow contacts to pick from your phone.')));
      return;
    }
    final all = await FlutterContacts.getContacts(withProperties: true);
    if (!mounted) return;
    final chosen = <int>{};
    final ok = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      backgroundColor: AppColors.surface,
      builder: (sheet) => StatefulBuilder(
        builder: (_, setSheet) => DraggableScrollableSheet(
          expand: false,
          initialChildSize: 0.85,
          builder: (_, controller) => Column(children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 16, 8, 8),
              child: Row(children: [
                Expanded(child: Text('Pick customers (${chosen.length})', style: TextStyle(color: AppColors.ink, fontSize: 18, fontWeight: FontWeight.w700))),
                FilledButton(onPressed: chosen.isEmpty ? null : () => Navigator.pop(sheet, true), child: const Text('Add')),
              ]),
            ),
            Expanded(
              child: ListView.builder(
                controller: controller,
                itemCount: all.length,
                itemBuilder: (_, i) {
                  final c = all[i];
                  if (c.phones.isEmpty) return const SizedBox.shrink();
                  return CheckboxListTile(
                    value: chosen.contains(i),
                    onChanged: (v) => setSheet(() => v == true ? chosen.add(i) : chosen.remove(i)),
                    title: Text(c.displayName),
                    subtitle: Text(c.phones.first.number),
                  );
                },
              ),
            ),
          ]),
        ),
      ),
    );
    if (ok != true) return;
    setState(() {
      _rows = [
        for (final i in chosen)
          {'name': all[i].displayName, 'phone': all[i].phones.first.number, 'email': all[i].emails.isNotEmpty ? all[i].emails.first.address : ''},
      ];
      _source = 'From your phone · ${_rows.length} contacts';
      _result = null;
    });
  }

  Future<void> _upload() async {
    if (_rows.isEmpty || _uploading) return;
    setState(() => _uploading = true);
    try {
      final res = await ApiService.post('${context.read<BusinessAccount>().base}/customers/import', {
        'rows': [
          for (final r in _rows)
            {
              if ((r['name'] ?? '').isNotEmpty) 'name': r['name'],
              if ((r['phone'] ?? '').isNotEmpty) 'phone': r['phone'],
              if ((r['email'] ?? '').isNotEmpty) 'email': r['email'],
            },
        ],
        'offersConsentConfirmed': _consent,
      });
      if (mounted) setState(() => _result = Map<String, dynamic>.from(res));
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e is ApiException ? e.message : 'Import failed. Try again.')));
    } finally {
      if (mounted) setState(() => _uploading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final result = _result;
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(title: const Text('Import customers')),
      body: ListView(padding: const EdgeInsets.all(16), children: [
        Text('Add your existing customers so you can message them, send updates and offers.',
            style: TextStyle(color: AppColors.textSecondary)),
        const SizedBox(height: 16),
        Row(children: [
          Expanded(child: OutlinedButton.icon(onPressed: _pickCsv, icon: const Icon(Icons.table_chart_outlined), label: const Text('CSV file'))),
          const SizedBox(width: 12),
          Expanded(child: OutlinedButton.icon(onPressed: _pickContacts, icon: const Icon(Icons.contacts_outlined), label: const Text('Phone contacts'))),
        ]),
        const SizedBox(height: 8),
        Text('CSV columns: name, phone, email (a header row is fine). Up to 2,000 at a time.',
            style: TextStyle(color: AppColors.textMuted, fontSize: 12.5)),
        if (_rows.isNotEmpty) ...[
          const SizedBox(height: 16),
          Text(_source ?? '', style: TextStyle(color: AppColors.ink, fontWeight: FontWeight.w700)),
          const SizedBox(height: 6),
          for (final r in _rows.take(5))
            ListTile(
              dense: true,
              contentPadding: EdgeInsets.zero,
              leading: const Icon(Icons.person_outline),
              title: Text((r['name'] ?? '').isEmpty ? (r['phone'] ?? '') : r['name']!),
              subtitle: Text([r['phone'], r['email']].where((v) => (v ?? '').isNotEmpty).join(' · ')),
            ),
          if (_rows.length > 5) Text('…and ${_rows.length - 5} more', style: TextStyle(color: AppColors.textSecondary)),
          CheckboxListTile(
            contentPadding: EdgeInsets.zero,
            value: _consent,
            onChanged: (v) => setState(() => _consent = v ?? false),
            title: const Text('These customers agreed to get offers from me'),
            subtitle: const Text('Only tick this if they really agreed. Without it they get order and account updates only — they can stop offers any time.'),
          ),
          const SizedBox(height: 8),
          FilledButton(
            onPressed: _uploading ? null : _upload,
            child: Text(_uploading ? 'Adding…' : 'Add ${_rows.length} customers'),
          ),
        ],
        if (result != null) ...[
          const SizedBox(height: 16),
          Card(
            color: AppColors.surface,
            child: Padding(
              padding: const EdgeInsets.all(14),
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text('Added ${result['added']} customers', style: TextStyle(color: AppColors.green, fontWeight: FontWeight.w700, fontSize: 16)),
                Text('${result['onNeuraTalk']} of them already use NeuraTalk and can get your messages now.', style: TextStyle(color: AppColors.ink)),
                if ((result['alreadyThere'] as num? ?? 0) > 0) Text('${result['alreadyThere']} were already in your list.', style: TextStyle(color: AppColors.textSecondary)),
                if ((result['problemCount'] as num? ?? 0) > 0) ...[
                  const SizedBox(height: 6),
                  Text('${result['problemCount']} rows could not be added:', style: TextStyle(color: AppColors.orange)),
                  for (final p in ((result['problems'] as List?) ?? const []).whereType<Map>().take(8))
                    Text('Row ${p['row']}: ${p['reason']}', style: TextStyle(color: AppColors.textSecondary, fontSize: 12.5)),
                ],
              ]),
            ),
          ),
        ],
      ]),
    );
  }
}
