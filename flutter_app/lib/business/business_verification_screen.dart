import 'dart:io';

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../services/api_service.dart';
import '../services/media_store.dart';
import '../theme/app_theme.dart';
import '../widgets/attachment_picker.dart';
import '../widgets/nt_ui.dart';
import 'business_account.dart';

/// Blue tick: send NeuraTalk your registration and PAN. NeuraTalk checks
/// them and approves the brand name customers will see with the tick.
class BusinessVerificationScreen extends StatefulWidget {
  const BusinessVerificationScreen({super.key});

  @override
  State<BusinessVerificationScreen> createState() => _BusinessVerificationScreenState();
}

class _Doc {
  _Doc(this.kind, this.name, this.path, this.sizeBytes);
  final String kind;
  final String name;
  final String path;
  final int sizeBytes;
}

class _BusinessVerificationScreenState extends State<BusinessVerificationScreen> {
  Map<String, dynamic>? _state;
  bool _loading = true;
  String? _error;
  bool _submitting = false;
  String? _uploadingKind;

  final _legal = TextEditingController();
  final _brand = TextEditingController();
  final _docNumber = TextEditingController();
  final _pan = TextEditingController();
  final _website = TextEditingController();
  final _social = TextEditingController();
  String _docType = 'gst';
  final List<_Doc> _docs = [];

  String get _base => context.read<BusinessAccount>().base;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    for (final c in [_legal, _brand, _docNumber, _pan, _website, _social]) {
      c.dispose();
    }
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final res = await ApiService.get('$_base/verification');
      if (!mounted) return;
      setState(() {
        _state = Map<String, dynamic>.from(res);
        _loading = false;
        _error = null;
        if (_brand.text.isEmpty) _brand.text = res['name']?.toString() ?? '';
        if (_legal.text.isEmpty) _legal.text = res['legalName']?.toString() ?? '';
      });
    } catch (e) {
      if (mounted) {
        setState(() {
          _loading = false;
          _error = e is ApiException && e.statusCode == 403 ? 'Only the business owner or an admin can do this.' : "Couldn't load.";
        });
      }
    }
  }

  static const _kindLabels = {
    'business_proof': 'Business registration',
    'pan': 'PAN card',
    'owner_id': 'Owner ID (masked Aadhaar / voter ID / passport / DL)',
    'address_proof': 'Address proof (electricity bill / rent agreement)',
  };

  Future<void> _addDoc(String kind) async {
    final picked = await AttachmentPicker.show(context);
    if (picked.isEmpty || !mounted) return;
    final (file, name) = picked.first;
    final mime = MediaStore.contentTypeFor(name);
    if (!(mime == 'application/pdf' || mime == 'image/jpeg' || mime == 'image/png')) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Use a PDF, JPG or PNG.')));
      return;
    }
    final size = await File(file.path).length();
    if (size > 5 * 1024 * 1024) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Each document must be 5 MB or smaller.')));
      return;
    }
    if (_docs.length >= 6) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Up to 6 documents.')));
      return;
    }
    setState(() => _uploadingKind = kind);
    try {
      final path = await MediaStore.upload(file, name);
      if (mounted) setState(() => _docs.add(_Doc(kind, name, path, size)));
    } catch (_) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Upload failed. Try again.')));
    } finally {
      if (mounted) setState(() => _uploadingKind = null);
    }
  }

  Future<void> _submit() async {
    if (_submitting) return;
    String? problem;
    if (_legal.text.trim().length < 2) problem = 'Enter the legal name as on your documents.';
    if (_brand.text.trim().length < 2) problem = 'Enter the name customers will see.';
    if (!_docs.any((d) => d.kind == 'business_proof')) problem = 'Add your business registration document.';
    if (!_docs.any((d) => d.kind == 'pan')) problem = 'Add a PAN card.';
    if (problem != null) {
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(problem)));
      return;
    }
    setState(() => _submitting = true);
    try {
      await ApiService.post('$_base/verification', {
        'legalName': _legal.text.trim(),
        'brandName': _brand.text.trim(),
        'businessDocType': _docType,
        if (_docNumber.text.trim().isNotEmpty) 'businessDocNumber': _docNumber.text.trim(),
        if (_pan.text.trim().isNotEmpty) 'panNumber': _pan.text.trim().toUpperCase(),
        if (_website.text.trim().isNotEmpty) 'website': _website.text.trim(),
        if (_social.text.trim().isNotEmpty) 'socialUrl': _social.text.trim(),
        'files': [for (final d in _docs) {'kind': d.kind, 'path': d.path, 'name': d.name}],
      });
      if (!mounted) return;
      await context.read<BusinessAccount>().load();
      _docs.clear();
      await _load();
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Sent. NeuraTalk will check your documents.')));
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e is ApiException ? e.message : 'Could not send. Try again.')));
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
  }

  Widget _statusCard() {
    final status = _state?['status']?.toString();
    final req = (_state?['request'] as Map?) ?? const {};
    final (title, body, color, icon) = switch (status) {
      'verified' => ('Verified ✔', 'Customers see the blue tick next to ${_state?['name']}. Changing your business name removes the tick until NeuraTalk checks again.', AppColors.green, Icons.verified),
      'pending' => ('NeuraTalk is checking', 'You sent ${req['businessDocLabel'] ?? 'your documents'}. Usually within 2 working days.', AppColors.orange, Icons.schedule),
      'rejected' => ('Please fix and send again', '${req['reason'] ?? 'NeuraTalk needs a change.'}', AppColors.red, Icons.error_outline),
      _ => ('Get the blue tick', 'Send your business registration and PAN. No website or social page needed.', AppColors.cyan, Icons.verified_outlined),
    };
    return Container(
      margin: const EdgeInsets.fromLTRB(16, 16, 16, 8),
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(color: color.withValues(alpha: 0.10), borderRadius: BorderRadius.circular(14)),
      child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Icon(icon, color: color),
        const SizedBox(width: 10),
        Expanded(
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(title, style: TextStyle(color: AppColors.ink, fontWeight: FontWeight.w700)),
            const SizedBox(height: 2),
            Text(body, style: TextStyle(color: AppColors.textSecondary, fontSize: 13.5)),
          ]),
        ),
      ]),
    );
  }

  Widget _docRow(String kind, {required bool required}) {
    final mine = _docs.where((d) => d.kind == kind).toList();
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Row(children: [
          Expanded(child: Text('${_kindLabels[kind]}${required ? ' *' : ''}', style: TextStyle(color: AppColors.ink, fontWeight: FontWeight.w600))),
          TextButton.icon(
            onPressed: _uploadingKind != null ? null : () => _addDoc(kind),
            icon: _uploadingKind == kind
                ? const SizedBox(width: 14, height: 14, child: CircularProgressIndicator(strokeWidth: 2))
                : const Icon(Icons.upload_file, size: 18),
            label: Text(mine.isEmpty ? 'Add' : 'Add more'),
          ),
        ]),
        for (final d in mine)
          Row(children: [
            Icon(Icons.check_circle, size: 16, color: AppColors.green),
            const SizedBox(width: 6),
            Expanded(child: Text('${d.name} · ${(d.sizeBytes / 1024).ceil()} KB', maxLines: 1, overflow: TextOverflow.ellipsis, style: TextStyle(color: AppColors.textSecondary, fontSize: 13))),
            IconButton(tooltip: 'Remove', icon: const Icon(Icons.close, size: 18), onPressed: () => setState(() => _docs.remove(d))),
          ]),
      ]),
    );
  }

  @override
  Widget build(BuildContext context) {
    final status = _state?['status']?.toString();
    final canSubmit = status == 'not_requested' || status == 'rejected';
    final docTypes = ((_state?['requirements'] as Map?)?['businessDocTypes'] as List? ?? const []).whereType<Map>().toList();
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(title: const Text('Verified business')),
      body: _loading
          ? Center(child: CircularProgressIndicator(color: AppColors.cyan))
          : _error != null
              ? NtEmptyState(icon: Icons.verified_outlined, title: _error!, message: 'Pull down to try again.', error: true)
              : RefreshIndicator(
                  onRefresh: _load,
                  child: ListView(padding: const EdgeInsets.only(bottom: 40), children: [
                    _statusCard(),
                    if (canSubmit) ...[
                      Padding(
                        padding: const EdgeInsets.fromLTRB(16, 8, 16, 0),
                        child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                          TextField(controller: _brand, maxLength: 80, decoration: const InputDecoration(labelText: 'Name customers will see *', helperText: 'Shown with the blue tick on every message')),
                          TextField(controller: _legal, maxLength: 200, decoration: const InputDecoration(labelText: 'Legal name, as on your documents *')),
                          const SizedBox(height: 8),
                          DropdownButtonFormField<String>(
                            initialValue: _docType,
                            isExpanded: true,
                            decoration: const InputDecoration(labelText: 'Business registration *'),
                            items: [
                              for (final t in docTypes)
                                DropdownMenuItem(value: t['id'].toString(), child: Text(t['label'].toString(), overflow: TextOverflow.ellipsis)),
                            ],
                            onChanged: (v) => setState(() => _docType = v ?? _docType),
                          ),
                          TextField(controller: _docNumber, maxLength: 40, textCapitalization: TextCapitalization.characters, decoration: const InputDecoration(labelText: 'Registration number (GSTIN / Udyam / licence no.)')),
                          TextField(controller: _pan, maxLength: 10, textCapitalization: TextCapitalization.characters, decoration: const InputDecoration(labelText: 'PAN (business, or owner for a proprietorship)')),
                          const SizedBox(height: 8),
                          Text('DOCUMENTS · PDF, JPG or PNG · up to 5 MB each', style: TextStyle(color: AppColors.textMuted, fontSize: 12.5, fontWeight: FontWeight.w700, letterSpacing: 0.4)),
                          _docRow('business_proof', required: true),
                          _docRow('pan', required: true),
                          _docRow('owner_id', required: false),
                          _docRow('address_proof', required: false),
                          const SizedBox(height: 8),
                          TextField(controller: _website, keyboardType: TextInputType.url, decoration: const InputDecoration(labelText: 'Website (optional)', hintText: 'https://')),
                          TextField(controller: _social, keyboardType: TextInputType.url, decoration: const InputDecoration(labelText: 'Instagram / Facebook page (optional)', hintText: 'https://')),
                          const SizedBox(height: 12),
                          Text('Only NeuraTalk reviewers can open your documents. Use a masked Aadhaar (first 8 digits hidden) if you add one.',
                              style: TextStyle(color: AppColors.textMuted, fontSize: 12.5)),
                          const SizedBox(height: 12),
                          FilledButton(
                            onPressed: _submitting || _uploadingKind != null ? null : _submit,
                            child: Text(_submitting ? 'Sending…' : 'Send to NeuraTalk'),
                          ),
                        ]),
                      ),
                    ],
                  ]),
                ),
    );
  }
}
