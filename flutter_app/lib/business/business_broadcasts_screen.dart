import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../services/api_service.dart';
import '../services/media_store.dart';
import '../theme/app_theme.dart';
import '../widgets/attachment_picker.dart';
import '../widgets/nt_ui.dart';
import 'business_account.dart';

/// Broadcasts from the phone: write a message template (NeuraTalk reviews
/// it), then send an approved one to all your customers. Consent, blocks,
/// daily limit and wallet are all checked by the server at send time.
class BusinessBroadcastsScreen extends StatefulWidget {
  const BusinessBroadcastsScreen({super.key});

  @override
  State<BusinessBroadcastsScreen> createState() => _BusinessBroadcastsScreenState();
}

class _BusinessBroadcastsScreenState extends State<BusinessBroadcastsScreen> {
  List<Map<String, dynamic>> _broadcasts = [];
  List<Map<String, dynamic>> _templates = [];
  bool _loading = true;
  String? _error;
  bool _sending = false;
  bool _noAccess = false;

  String get _base => context.read<BusinessAccount>().base;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final b = await ApiService.get('$_base/broadcasts');
      final t = await ApiService.get('$_base/broadcast-templates');
      if (!mounted) return;
      setState(() {
        _broadcasts = ((b['broadcasts'] as List?) ?? const []).whereType<Map>().map((m) => Map<String, dynamic>.from(m)).toList();
        _templates = ((t['templates'] as List?) ?? const []).whereType<Map>().map((m) => Map<String, dynamic>.from(m)).toList();
        _loading = false;
        _error = null;
      });
    } catch (e) {
      if (mounted) {
        setState(() {
          _loading = false;
          _noAccess = e is ApiException && e.statusCode == 403;
          _error = _noAccess ? 'Broadcast tools are off for you' : "Couldn't load broadcasts.";
        });
      }
    }
  }

  /// Same as "Turn on" on the website: gives me the business tools
  /// (customers, templates, broadcasts). Only an owner/admin may do it.
  Future<void> _turnOn() async {
    setState(() => _loading = true);
    try {
      final g = await ApiService.get('$_base/rbac/grantable-permissions');
      await ApiService.post('$_base/rbac/grant-business-access', {'permissions': g['permissions']});
      _noAccess = false;
      await _load();
    } catch (e) {
      if (!mounted) return;
      setState(() => _loading = false);
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(
        content: Text(e is ApiException && e.statusCode == 403
            ? 'Only the business owner or an admin can turn this on. Ask them.'
            : 'Could not turn it on. Try again.'),
      ));
    }
  }

  static String _category(Object? c) => c == 'marketing' ? 'Offer' : 'Update';

  static (String, Color) _templateStatus(Map<String, dynamic> t) {
    switch (t['status']) {
      case 'approved':
        return ('Approved', AppColors.green);
      case 'pending_approval':
      case 'submitted':
        return ('NeuraTalk is reviewing', AppColors.orange);
      case 'rejected':
        return ('Not approved', AppColors.red);
      default:
        return (t['rejectionReason'] != null ? 'Not approved' : 'Draft', AppColors.textSecondary);
    }
  }

  Future<void> _newTemplate() async {
    final created = await Navigator.push<bool>(context, MaterialPageRoute(builder: (_) => ChangeNotifierProvider<BusinessAccount>.value(
      value: context.read<BusinessAccount>(),
      child: const _NewTemplateScreen(),
    )));
    if (created == true) _load();
  }

  Future<void> _send(Map<String, dynamic> template) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (d) => AlertDialog(
        title: const Text('Send to all your customers?'),
        content: Text(
          '"${template['content']}"\n\nIt goes to your customers on NeuraTalk, in each one\'s language. '
          '${template['category'] == 'marketing' ? 'Only people who agreed to receive offers get it. ' : ''}'
          'Each delivered message is charged to your wallet.',
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(d, false), child: const Text('Cancel')),
          FilledButton(onPressed: () => Navigator.pop(d, true), child: const Text('Send')),
        ],
      ),
    );
    if (ok != true || !mounted) return;
    setState(() => _sending = true);
    try {
      final res = await ApiService.post('$_base/broadcasts', {'versionId': template['versionId']});
      if (!mounted) return;
      final status = res['status']?.toString();
      final text = status == 'waiting_for_approval'
          ? (res['message']?.toString() ?? 'Waiting for another admin to approve.')
          : 'Sent to ${res['sent'] ?? 0} customers${(res['skipped'] ?? 0) > 0 ? ', ${res['skipped']} skipped (no consent, blocked, limit or wallet)' : ''}.';
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(text)));
      _load();
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e is ApiException ? e.message : 'Could not send. Try again.')));
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  Widget _broadcastTile(Map<String, dynamic> b) {
    final report = (b['report'] as Map?) ?? const {};
    num n(Object? v) => v is num ? v : 0;
    final delivery = (report['delivery'] as Map?) ?? const {};
    final sent = n(report['sent']);
    final delivered = n((delivery['delivered'] is Map) ? (delivery['delivered'] as Map)['count'] : delivery['delivered']);
    final read = n((delivery['read'] is Map) ? (delivery['read'] as Map)['count'] : delivery['read']);
    final status = b['status']?.toString() ?? '';
    final approval = (b['approval'] as Map?) ?? const {};
    final approvalStatus = approval['status']?.toString();
    final mine = approval['requestedByMe'] == true;
    String line;
    Widget? action;
    if (status == 'completed' || status == 'running') {
      line = 'Sent $sent · delivered $delivered · read $read';
    } else if (status == 'draft' && approvalStatus == 'pending') {
      line = mine ? 'Waiting for another admin to approve' : 'Waiting for your approval';
      if (!mine) action = FilledButton(onPressed: _sending ? null : () => _decide(b, 'approve'), child: const Text('Approve'));
    } else if (status == 'draft' && approvalStatus == 'approved') {
      line = 'Approved — not sent yet';
      action = FilledButton(onPressed: _sending ? null : () => _decide(b, 'send'), child: const Text('Send now'));
    } else if (approvalStatus == 'rejected') {
      line = 'Not approved${approval['reason'] != null ? ': ${approval['reason']}' : ''}';
    } else if (status == 'failed') {
      line = 'Failed${b['failureReason'] != null ? ': ${b['failureReason']}' : ''}';
    } else {
      line = status.replaceAll('_', ' ');
    }
    return ListTile(
      trailing: action,
      leading: CircleAvatar(
        backgroundColor: AppColors.cyan.withValues(alpha: 0.12),
        child: Icon(b['category'] == 'marketing' ? Icons.local_offer_outlined : Icons.notifications_active_outlined, color: AppColors.cyan),
      ),
      title: Text(b['name']?.toString() ?? 'Broadcast', style: TextStyle(color: AppColors.ink, fontWeight: FontWeight.w600)),
      subtitle: Text(line, style: TextStyle(color: AppColors.textSecondary)),
    );
  }

  Future<void> _decide(Map<String, dynamic> b, String step) async {
    setState(() => _sending = true);
    try {
      final res = await ApiService.post('$_base/broadcasts/${b['id']}/$step', {});
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Sent to ${res['sent'] ?? 0} customers.')));
      _load();
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e is ApiException ? e.message : 'Could not send. Try again.')));
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final approved = _templates.where((t) => t['status'] == 'approved').toList();
    return DefaultTabController(
      length: 2,
      child: Scaffold(
        backgroundColor: AppColors.background,
        appBar: AppBar(
          title: const Text('Broadcasts'),
          bottom: const TabBar(tabs: [Tab(text: 'Send'), Tab(text: 'Templates')]),
        ),
        body: _loading
            ? Center(child: CircularProgressIndicator(color: AppColors.cyan))
            : _noAccess
                ? ListView(padding: const EdgeInsets.all(24), children: [
                    const SizedBox(height: 40),
                    NtEmptyState(
                      icon: Icons.campaign_outlined,
                      title: _error!,
                      message: 'Turn on business tools to write templates and send offers to your customers. '
                          'NeuraTalk reviews every template before it can be sent.',
                    ),
                    const SizedBox(height: 16),
                    Center(child: FilledButton(onPressed: _turnOn, child: const Text('Turn on business tools'))),
                  ])
            : _error != null
                ? NtEmptyState(icon: Icons.campaign_outlined, title: _error!, message: 'Pull down to try again.', error: true)
                : TabBarView(children: [
                    RefreshIndicator(
                      onRefresh: _load,
                      child: ListView(padding: const EdgeInsets.only(bottom: 32), children: [
                        Padding(
                          padding: const EdgeInsets.fromLTRB(16, 16, 16, 4),
                          child: Text('SEND AN APPROVED TEMPLATE', style: TextStyle(color: AppColors.textMuted, fontSize: 12.5, fontWeight: FontWeight.w700, letterSpacing: 0.6)),
                        ),
                        if (approved.isEmpty)
                          Padding(
                            padding: const EdgeInsets.all(16),
                            child: Text('No approved templates yet. Write one in the Templates tab — NeuraTalk usually reviews it within a day.',
                                style: TextStyle(color: AppColors.textSecondary)),
                          ),
                        for (final t in approved)
                          ListTile(
                            title: Text(t['content']?.toString() ?? '', maxLines: 2, overflow: TextOverflow.ellipsis, style: TextStyle(color: AppColors.ink)),
                            subtitle: Text(_category(t['category']), style: TextStyle(color: AppColors.textSecondary)),
                            trailing: FilledButton(onPressed: _sending ? null : () => _send(t), child: const Text('Send')),
                          ),
                        Padding(
                          padding: const EdgeInsets.fromLTRB(16, 20, 16, 4),
                          child: Text('RECENT BROADCASTS', style: TextStyle(color: AppColors.textMuted, fontSize: 12.5, fontWeight: FontWeight.w700, letterSpacing: 0.6)),
                        ),
                        if (_broadcasts.isEmpty)
                          Padding(padding: const EdgeInsets.all(16), child: Text('None yet.', style: TextStyle(color: AppColors.textSecondary))),
                        for (final b in _broadcasts) _broadcastTile(b),
                      ]),
                    ),
                    RefreshIndicator(
                      onRefresh: _load,
                      child: ListView(padding: const EdgeInsets.only(bottom: 96), children: [
                        if (_templates.isEmpty)
                          const NtEmptyState(icon: Icons.description_outlined, title: 'No templates yet', message: 'Write an offer or an order update. NeuraTalk checks it before you can send it.'),
                        for (final t in _templates)
                          Builder(builder: (_) {
                            final (label, color) = _templateStatus(t);
                            return ListTile(
                              title: Text(t['content']?.toString() ?? '', maxLines: 2, overflow: TextOverflow.ellipsis, style: TextStyle(color: AppColors.ink)),
                              subtitle: Text(
                                [_category(t['category']), label, if (t['rejectionReason'] != null) t['rejectionReason']].join(' · '),
                                style: TextStyle(color: color),
                              ),
                            );
                          }),
                      ]),
                    ),
                  ]),
        floatingActionButton: _loading || _error != null ? null : FloatingActionButton.extended(
          heroTag: 'new-template',
          onPressed: _newTemplate,
          backgroundColor: AppColors.cyan,
          foregroundColor: AppColors.onAccent,
          icon: const Icon(Icons.add),
          label: const Text('New template'),
        ),
      ),
    );
  }
}

class _ButtonDraft {
  String type = 'quick_reply';
  final title = TextEditingController();
  final value = TextEditingController();
}

class _NewTemplateScreen extends StatefulWidget {
  const _NewTemplateScreen();
  @override
  State<_NewTemplateScreen> createState() => _NewTemplateScreenState();
}

class _NewTemplateScreenState extends State<_NewTemplateScreen> {
  final _name = TextEditingController();
  final _content = TextEditingController(text: 'Hi {{name}}, ');
  String _category = 'marketing';
  bool _saving = false;
  // Optional photo / video / PDF, uploaded to NeuraTalk and reviewed with the text.
  String? _mediaPath;
  String? _mediaName;
  bool _uploading = false;
  // Up to 3 buttons: quick reply / website / call.
  final List<_ButtonDraft> _buttons = [];

  List<Map<String, dynamic>>? _buttonsPayload() {
    if (_buttons.isEmpty) return null;
    var n = 0;
    return [
      for (final b in _buttons)
        if (b.title.text.trim().isNotEmpty)
          {
            'type': b.type,
            'title': b.title.text.trim(),
            if (b.type == 'quick_reply') 'id': 'btn_${++n}',
            if (b.type == 'url') 'url': b.value.text.trim(),
            if (b.type == 'call') 'phone': b.value.text.trim(),
          },
    ];
  }

  Widget _buttonEditor(_ButtonDraft b) {
    return Card(
      color: AppColors.surface,
      margin: const EdgeInsets.only(bottom: 8),
      child: Padding(
        padding: const EdgeInsets.fromLTRB(12, 4, 4, 8),
        child: Column(children: [
          Row(children: [
            Expanded(
              child: DropdownButton<String>(
                value: b.type,
                isExpanded: true,
                underline: const SizedBox.shrink(),
                items: const [
                  DropdownMenuItem(value: 'quick_reply', child: Text('Quick reply (customer taps to answer)')),
                  DropdownMenuItem(value: 'url', child: Text('Visit website')),
                  DropdownMenuItem(value: 'call', child: Text('Call phone number')),
                ],
                onChanged: (v) => setState(() => b.type = v ?? b.type),
              ),
            ),
            IconButton(tooltip: 'Remove button', icon: const Icon(Icons.close), onPressed: () => setState(() => _buttons.remove(b))),
          ]),
          TextField(controller: b.title, maxLength: 25, decoration: const InputDecoration(labelText: 'Button text', hintText: 'Yes, I want it', isDense: true)),
          if (b.type != 'quick_reply')
            TextField(
              controller: b.value,
              keyboardType: b.type == 'url' ? TextInputType.url : TextInputType.phone,
              decoration: InputDecoration(
                labelText: b.type == 'url' ? 'Website (https://…)' : 'Phone number',
                hintText: b.type == 'url' ? 'https://yourshop.in/offer' : '+91 98xxxxxxxx',
                isDense: true,
              ),
            ),
        ]),
      ),
    );
  }

  Future<void> _pickMedia() async {
    final picked = await AttachmentPicker.show(context);
    if (picked.isEmpty || !mounted) return;
    final (file, name) = picked.first;
    final mime = MediaStore.contentTypeFor(name);
    if (!(mime.startsWith('image/') || mime.startsWith('video/') || mime == 'application/pdf')) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Use a photo, an MP4 video or a PDF.')));
      return;
    }
    setState(() => _uploading = true);
    try {
      final path = await MediaStore.upload(file, name);
      if (mounted) setState(() { _mediaPath = path; _mediaName = name; });
    } catch (_) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Upload failed. Try again.')));
    } finally {
      if (mounted) setState(() => _uploading = false);
    }
  }

  Future<void> _save() async {
    if (_saving || _uploading) return;
    setState(() => _saving = true);
    try {
      await ApiService.post('${context.read<BusinessAccount>().base}/broadcast-templates', {
        'name': _name.text.trim().isEmpty ? 'Message' : _name.text.trim(),
        'category': _category,
        'content': _content.text.trim(),
        if (_mediaPath != null) 'mediaUrl': _mediaPath,
        if (_buttonsPayload() != null) 'buttons': _buttonsPayload(),
      });
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Sent to NeuraTalk for review.')));
      Navigator.pop(context, true);
    } catch (e) {
      if (mounted) {
        setState(() => _saving = false);
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e is ApiException ? e.message : 'Could not save.')));
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(title: const Text('New template')),
      body: ListView(padding: const EdgeInsets.all(16), children: [
        TextField(controller: _name, maxLength: 60, decoration: const InputDecoration(labelText: 'Name (only you see it)', hintText: 'Diwali offer')),
        const SizedBox(height: 8),
        Text('Type', style: TextStyle(color: AppColors.textSecondary)),
        RadioGroup<String>(
          groupValue: _category,
          onChanged: (v) => setState(() => _category = v ?? _category),
          child: const Column(children: [
            RadioListTile<String>(
              value: 'marketing',
              title: Text('Offer or promotion'), subtitle: Text('Only customers who said yes to offers receive it'),
            ),
            RadioListTile<String>(
              value: 'utility',
              title: Text('Order or account update'), subtitle: Text('Must not contain offers — NeuraTalk checks this'),
            ),
          ]),
        ),
        const SizedBox(height: 8),
        TextField(
          controller: _content,
          minLines: 4,
          maxLines: 8,
          maxLength: 1024,
          decoration: const InputDecoration(labelText: 'Message', helperText: '{{name}} becomes each customer\'s name. Each customer reads it in their own language.'),
        ),
        const SizedBox(height: 8),
        OutlinedButton.icon(
          onPressed: _uploading ? null : _pickMedia,
          icon: _uploading
              ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2))
              : Icon(_mediaPath == null ? Icons.attach_file : Icons.check_circle, color: _mediaPath == null ? null : AppColors.green),
          label: Text(_mediaPath == null ? 'Add a photo, video or PDF (optional)' : _mediaName ?? 'File added'),
        ),
        if (_mediaPath != null)
          TextButton(onPressed: () => setState(() { _mediaPath = null; _mediaName = null; }), child: const Text('Remove the file')),
        const SizedBox(height: 12),
        Text('BUTTONS (OPTIONAL, UP TO 3)', style: TextStyle(color: AppColors.textMuted, fontSize: 12.5, fontWeight: FontWeight.w700, letterSpacing: 0.6)),
        const SizedBox(height: 6),
        for (final b in _buttons) _buttonEditor(b),
        if (_buttons.length < 3)
          OutlinedButton.icon(
            onPressed: () => setState(() => _buttons.add(_ButtonDraft())),
            icon: const Icon(Icons.add),
            label: const Text('Add a button'),
          ),
        const SizedBox(height: 16),
        FilledButton(onPressed: _saving || _uploading ? null : _save, child: Text(_saving ? 'Sending…' : 'Send to NeuraTalk for review')),
      ]),
    );
  }
}
