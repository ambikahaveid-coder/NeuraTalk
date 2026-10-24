import 'dart:io';

import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';
import 'package:provider/provider.dart';

import '../services/api_service.dart';
import '../services/media_store.dart';
import '../theme/app_theme.dart';
import '../widgets/nt_ui.dart';
import 'business_account.dart';

String rupeesOf(dynamic paise) => paise == null ? 'Price on request' : '₹${((paise as num) / 100).toStringAsFixed((paise % 100) == 0 ? 0 : 2)}';

/// Catalog: products/services with photo and price. Customers open it from
/// the chat and tap "Ask" (WhatsApp Business → Catalog).
class BusinessCatalogScreen extends StatefulWidget {
  const BusinessCatalogScreen({super.key});

  @override
  State<BusinessCatalogScreen> createState() => _BusinessCatalogScreenState();
}

class _BusinessCatalogScreenState extends State<BusinessCatalogScreen> {
  List<Map<String, dynamic>> _items = [];
  bool _loading = true;
  String? _error;

  String get _base => '${context.read<BusinessAccount>().base}/catalog';

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _load());
  }

  Future<void> _load() async {
    try {
      final res = await ApiService.get(_base);
      final list = (res['items'] as List? ?? const []).whereType<Map>().map((m) => Map<String, dynamic>.from(m)).toList();
      if (mounted) setState(() { _items = list; _loading = false; _error = null; });
    } catch (e) {
      if (mounted) setState(() { _loading = false; _error = e is ApiException ? e.message : 'Check your connection and try again.'; });
    }
  }

  Future<void> _edit([Map<String, dynamic>? item]) async {
    final changed = await Navigator.push<bool>(context, MaterialPageRoute(builder: (_) => _CatalogItemEditor(base: _base, item: item)));
    if (changed == true) _load();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(title: const Text('Catalog')),
      floatingActionButton: FloatingActionButton.extended(
        heroTag: 'catalog-add',
        onPressed: () => _edit(),
        backgroundColor: AppColors.cyan,
        foregroundColor: AppColors.onAccent,
        icon: const Icon(Icons.add),
        label: const Text('Add item'),
      ),
      body: _loading
          ? Center(child: CircularProgressIndicator(color: AppColors.cyan))
          : _error != null
              ? NtEmptyState(icon: Icons.wifi_off, title: "Couldn't load the catalog", message: _error!, error: true, actionLabel: 'Try again', onAction: _load)
              : _items.isEmpty
                  ? const NtEmptyState(
                      icon: Icons.shopping_bag_outlined,
                      title: 'Show what you sell',
                      message: 'Add products or services with a photo and price. Customers see them in your chat and can ask about any item.',
                    )
                  : RefreshIndicator(
                      onRefresh: _load,
                      child: ListView.separated(
                        padding: const EdgeInsets.only(bottom: 96),
                        itemCount: _items.length,
                        separatorBuilder: (_, __) => Divider(height: 1, color: AppColors.border),
                        itemBuilder: (_, i) {
                          final item = _items[i];
                          final available = item['isAvailable'] != false;
                          return ListTile(
                            contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
                            leading: ClipRRect(
                              borderRadius: BorderRadius.circular(10),
                              child: SizedBox(
                                width: 56,
                                height: 56,
                                child: item['imageUrl'] is String
                                    ? Image.network('${ApiService.baseUrl}${item['imageUrl']}', fit: BoxFit.cover,
                                        errorBuilder: (_, __, ___) => Icon(Icons.image_not_supported_outlined, color: AppColors.textMuted))
                                    : Container(color: AppColors.blueTint, child: Icon(Icons.shopping_bag_outlined, color: AppColors.cyan)),
                              ),
                            ),
                            title: Text(item['name']?.toString() ?? '', style: TextStyle(color: AppColors.ink, fontWeight: FontWeight.w600)),
                            subtitle: Text(
                              [rupeesOf(item['pricePaise']), if (!available) 'Hidden from customers'].join(' · '),
                              style: TextStyle(color: available ? AppColors.textSecondary : AppColors.orange),
                            ),
                            trailing: const Icon(Icons.chevron_right),
                            onTap: () => _edit(item),
                          );
                        },
                      ),
                    ),
    );
  }
}

class _CatalogItemEditor extends StatefulWidget {
  const _CatalogItemEditor({required this.base, this.item});
  final String base;
  final Map<String, dynamic>? item;

  @override
  State<_CatalogItemEditor> createState() => _CatalogItemEditorState();
}

class _CatalogItemEditorState extends State<_CatalogItemEditor> {
  final _form = GlobalKey<FormState>();
  late final TextEditingController _name = TextEditingController(text: widget.item?['name']?.toString() ?? '');
  late final TextEditingController _price = TextEditingController(
      text: widget.item?['pricePaise'] == null ? '' : ((widget.item!['pricePaise'] as num) / 100).toStringAsFixed(((widget.item!['pricePaise'] as num) % 100) == 0 ? 0 : 2));
  late final TextEditingController _about = TextEditingController(text: widget.item?['description']?.toString() ?? '');
  late bool _available = widget.item?['isAvailable'] != false;
  late String? _imagePath = widget.item?['imageUrl'] as String?;
  File? _newImage;
  bool _saving = false;

  bool get _isNew => widget.item == null;

  @override
  void dispose() {
    _name.dispose();
    _price.dispose();
    _about.dispose();
    super.dispose();
  }

  Future<void> _pick() async {
    final picked = await ImagePicker().pickImage(source: ImageSource.gallery, maxWidth: 1600, maxHeight: 1600, imageQuality: 85);
    if (picked != null && mounted) setState(() => _newImage = File(picked.path));
  }

  Future<void> _save() async {
    if (!(_form.currentState?.validate() ?? false) || _saving) return;
    setState(() => _saving = true);
    try {
      if (_newImage != null) _imagePath = await MediaStore.upload(_newImage!, 'item.jpg');
      final priceText = _price.text.trim();
      final body = {
        'name': _name.text.trim(),
        'description': _about.text.trim().isEmpty ? null : _about.text.trim(),
        'pricePaise': priceText.isEmpty ? null : (double.parse(priceText) * 100).round(),
        'isAvailable': _available,
        if (_newImage != null || _isNew) 'imageUrl': _imagePath,
      };
      if (_isNew) {
        await ApiService.post(widget.base, body);
      } else {
        await ApiService.patch('${widget.base}/${widget.item!['id']}', body);
      }
      if (mounted) Navigator.pop(context, true);
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e is ApiException ? e.message : 'Could not save. Try again.')));
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  Future<void> _delete() async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (d) => AlertDialog(
        title: const Text('Remove this item?'),
        content: const Text('Customers will no longer see it in your catalog.'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(d, false), child: const Text('Cancel')),
          TextButton(onPressed: () => Navigator.pop(d, true), child: Text('Remove', style: TextStyle(color: AppColors.red))),
        ],
      ),
    );
    if (ok != true) return;
    try {
      await ApiService.delete('${widget.base}/${widget.item!['id']}');
      if (mounted) Navigator.pop(context, true);
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e is ApiException ? e.message : 'Could not remove.')));
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(
        title: Text(_isNew ? 'Add item' : 'Edit item'),
        actions: [
          if (!_isNew) IconButton(tooltip: 'Remove', icon: Icon(Icons.delete_outline, color: AppColors.red), onPressed: _delete),
          TextButton(onPressed: _saving ? null : _save, child: _saving ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2)) : const Text('Save')),
        ],
      ),
      body: Form(
        key: _form,
        child: ListView(
          padding: const EdgeInsets.all(20),
          children: [
            GestureDetector(
              onTap: _pick,
              child: AspectRatio(
                aspectRatio: 16 / 10,
                child: ClipRRect(
                  borderRadius: BorderRadius.circular(16),
                  child: _newImage != null
                      ? Image.file(_newImage!, fit: BoxFit.cover)
                      : _imagePath != null
                          ? Image.network('${ApiService.baseUrl}$_imagePath', fit: BoxFit.cover)
                          : Container(
                              color: AppColors.blueTint,
                              child: Column(mainAxisAlignment: MainAxisAlignment.center, children: [
                                Icon(Icons.add_photo_alternate_outlined, size: 40, color: AppColors.cyan),
                                const SizedBox(height: 6),
                                Text('Add a photo', style: TextStyle(color: AppColors.cyan, fontWeight: FontWeight.w600)),
                              ]),
                            ),
                ),
              ),
            ),
            const SizedBox(height: 20),
            TextFormField(
              controller: _name,
              maxLength: 120,
              textCapitalization: TextCapitalization.sentences,
              decoration: const InputDecoration(labelText: 'Item name'),
              validator: (v) => (v ?? '').trim().isEmpty ? 'Enter a name' : null,
            ),
            TextFormField(
              controller: _price,
              keyboardType: const TextInputType.numberWithOptions(decimal: true),
              decoration: const InputDecoration(labelText: 'Price (₹, optional)', prefixText: '₹ '),
              validator: (v) {
                final t = (v ?? '').trim();
                return t.isEmpty || double.tryParse(t) != null && double.parse(t) >= 0 ? null : 'Enter a number';
              },
            ),
            const SizedBox(height: 16),
            TextFormField(
              controller: _about,
              maxLength: 1000,
              minLines: 2,
              maxLines: 5,
              decoration: const InputDecoration(labelText: 'Description (optional)'),
            ),
            SwitchListTile(
              contentPadding: EdgeInsets.zero,
              value: _available,
              onChanged: (v) => setState(() => _available = v),
              title: const Text('Show to customers'),
              subtitle: const Text('Turn off when out of stock'),
            ),
          ],
        ),
      ),
    );
  }
}
