import 'package:flutter/material.dart';

import '../services/api_service.dart';
import '../theme/app_theme.dart';

/// Pick one of the business's NeuraTalk-approved templates and fill in its
/// blanks. Returns {'templateVersionId': id, 'variables': {...}} or null.
/// {{name}} is filled with the customer's name by the server.
Future<Map<String, dynamic>?> pickApprovedTemplate(BuildContext context, String base) async {
  List<Map<String, dynamic>> templates;
  try {
    final res = await ApiService.get('$base/sendable-templates');
    templates = ((res['templates'] as List?) ?? const []).whereType<Map>().map((m) => Map<String, dynamic>.from(m)).toList();
  } catch (e) {
    if (context.mounted) {
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(
        content: Text(e is ApiException && e.statusCode == 403
            ? 'Turn on business tools in Tools → Broadcasts first.'
            : "Couldn't load your templates."),
      ));
    }
    return null;
  }
  if (!context.mounted) return null;

  final chosen = await showModalBottomSheet<Map<String, dynamic>>(
    context: context,
    isScrollControlled: true,
    backgroundColor: AppColors.surface,
    shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(20))),
    builder: (sheet) => DraggableScrollableSheet(
      expand: false,
      initialChildSize: 0.6,
      builder: (_, controller) => ListView(controller: controller, padding: const EdgeInsets.all(16), children: [
        Text('Send an approved template', style: TextStyle(color: AppColors.ink, fontSize: 18, fontWeight: FontWeight.w700)),
        const SizedBox(height: 4),
        Text('Only templates NeuraTalk approved can start a conversation. The customer reads it in their language and can reply.',
            style: TextStyle(color: AppColors.textSecondary, fontSize: 13)),
        const SizedBox(height: 12),
        if (templates.isEmpty)
          Padding(
            padding: const EdgeInsets.symmetric(vertical: 24),
            child: Text('No approved templates yet. Write one in Tools → Broadcasts → Templates.',
                textAlign: TextAlign.center, style: TextStyle(color: AppColors.textSecondary)),
          ),
        for (final t in templates)
          Card(
            color: AppColors.background,
            child: ListTile(
              leading: Icon(
                t['mediaType'] == 'image' ? Icons.image_outlined
                    : t['mediaType'] == 'video' ? Icons.videocam_outlined
                    : t['mediaType'] == 'document' ? Icons.picture_as_pdf_outlined
                    : Icons.description_outlined,
                color: AppColors.cyan,
              ),
              title: Text(t['content']?.toString() ?? '', maxLines: 3, overflow: TextOverflow.ellipsis, style: TextStyle(color: AppColors.ink)),
              subtitle: Text(t['category'] == 'marketing' ? 'Offer · only to customers who agreed to offers' : 'Update',
                  style: TextStyle(color: AppColors.textSecondary, fontSize: 12.5)),
              onTap: () => Navigator.pop(sheet, t),
            ),
          ),
      ]),
    ),
  );
  if (chosen == null || !context.mounted) return null;

  // Blanks other than {{name}} (the server fills the customer's name).
  final blanks = ((chosen['variables'] as List?) ?? const [])
      .whereType<Map>()
      .map((v) => v['name']?.toString() ?? '')
      .where((n) => n.isNotEmpty && n != 'name')
      .toList();
  final values = <String, String>{};
  if (blanks.isNotEmpty) {
    final controllers = {for (final b in blanks) b: TextEditingController()};
    final ok = await showDialog<bool>(
      context: context,
      builder: (d) => AlertDialog(
        title: const Text('Fill in the details'),
        content: SingleChildScrollView(
          child: Column(mainAxisSize: MainAxisSize.min, children: [
            Text(chosen['content']?.toString() ?? '', style: TextStyle(color: AppColors.textSecondary, fontSize: 13)),
            const SizedBox(height: 8),
            for (final b in blanks)
              TextField(controller: controllers[b], decoration: InputDecoration(labelText: b.replaceAll('_', ' '))),
          ]),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(d, false), child: const Text('Cancel')),
          FilledButton(onPressed: () => Navigator.pop(d, true), child: const Text('Send')),
        ],
      ),
    );
    if (ok != true) return null;
    for (final b in blanks) {
      final v = controllers[b]!.text.trim();
      if (v.isNotEmpty) values[b] = v;
    }
  }
  return {'templateVersionId': chosen['versionId'], 'variables': values};
}
