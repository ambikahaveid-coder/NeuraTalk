import 'dart:io';

import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';
import 'package:provider/provider.dart';

import '../services/api_service.dart';
import '../services/media_store.dart';
import '../theme/app_theme.dart';
import '../widgets/nt_ui.dart';
import 'business_account.dart';
import 'business_categories.dart';

/// Business profile, as customers see it: logo, name, category, about,
/// address, email and website (WhatsApp Business → Business profile).
class BusinessProfileScreen extends StatefulWidget {
  const BusinessProfileScreen({super.key});

  @override
  State<BusinessProfileScreen> createState() => _BusinessProfileScreenState();
}

class _BusinessProfileScreenState extends State<BusinessProfileScreen> {
  final _form = GlobalKey<FormState>();
  late final TextEditingController _name;
  late final TextEditingController _about;
  late final TextEditingController _address;
  late final TextEditingController _city;
  late final TextEditingController _email;
  late final TextEditingController _website;
  String? _category;
  bool _saving = false;
  bool _uploading = false;

  @override
  void initState() {
    super.initState();
    final b = context.read<BusinessAccount>().business ?? const {};
    String t(String k) => b[k]?.toString() ?? '';
    _name = TextEditingController(text: t('name'));
    _about = TextEditingController(text: t('description'));
    _address = TextEditingController(text: t('address'));
    _city = TextEditingController(text: t('city'));
    _email = TextEditingController(text: t('email'));
    _website = TextEditingController(text: t('website'));
    final cat = b['category']?.toString();
    _category = cat != null && cat.isNotEmpty ? cat : null;
  }

  @override
  void dispose() {
    for (final c in [_name, _about, _address, _city, _email, _website]) {
      c.dispose();
    }
    super.dispose();
  }

  Future<void> _changeLogo() async {
    final account = context.read<BusinessAccount>();
    final picked = await ImagePicker().pickImage(source: ImageSource.gallery, maxWidth: 1024, maxHeight: 1024, imageQuality: 88);
    if (picked == null) return;
    setState(() => _uploading = true);
    try {
      final path = await MediaStore.upload(File(picked.path), 'logo.jpg');
      await ApiService.put('${account.base}/branding/logo', {'objectPath': path});
      await account.load();
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e is ApiException ? e.message : 'Could not change the logo.')));
    } finally {
      if (mounted) setState(() => _uploading = false);
    }
  }

  Future<void> _save() async {
    if (!(_form.currentState?.validate() ?? false) || _saving) return;
    final account = context.read<BusinessAccount>();
    setState(() => _saving = true);
    var website = _website.text.trim();
    if (website.isNotEmpty && !website.startsWith('http')) website = 'https://$website';
    try {
      await ApiService.patch('${account.base}/profile', {
        'name': _name.text.trim(),
        'industry': _category ?? '',
        'description': _about.text.trim(),
        'address': _address.text.trim(),
        'addressCity': _city.text.trim(),
        if (_email.text.trim().isNotEmpty) 'email': _email.text.trim(),
        'website': website,
      });
      await account.load();
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Business profile saved')));
        Navigator.pop(context);
      }
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e is ApiException ? e.message : 'Could not save. Try again.')));
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final account = context.watch<BusinessAccount>();
    final categories = {...kBusinessCategories, if (_category != null) _category!}.toList();
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(
        title: const Text('Business profile'),
        actions: [
          TextButton(onPressed: _saving ? null : _save, child: _saving ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2)) : const Text('Save')),
        ],
      ),
      body: Form(
        key: _form,
        child: ListView(
          padding: const EdgeInsets.fromLTRB(20, 12, 20, 32),
          children: [
            Center(
              child: GestureDetector(
                onTap: _uploading ? null : _changeLogo,
                child: Stack(clipBehavior: Clip.none, children: [
                  NtAvatar(name: account.name, avatarUrl: account.logoUrl, size: 104),
                  if (_uploading)
                    const Positioned.fill(child: Center(child: CircularProgressIndicator())),
                  Positioned(
                    right: -2,
                    bottom: -2,
                    child: CircleAvatar(radius: 18, backgroundColor: AppColors.cyan, child: const Icon(Icons.photo_camera, size: 18, color: AppColors.onAccent)),
                  ),
                ]),
              ),
            ),
            const SizedBox(height: 8),
            Center(child: Text('Logo — customers see it on every message', style: TextStyle(color: AppColors.textMuted, fontSize: 13))),
            const SizedBox(height: 20),
            TextFormField(
              controller: _name,
              maxLength: 80,
              textCapitalization: TextCapitalization.words,
              decoration: const InputDecoration(labelText: 'Business name'),
              validator: (v) => (v ?? '').trim().length < 2 ? 'Enter your business name' : null,
            ),
            DropdownButtonFormField<String>(
              initialValue: _category,
              isExpanded: true,
              decoration: const InputDecoration(labelText: 'Category'),
              items: [for (final c in categories) DropdownMenuItem(value: c, child: Text(c))],
              onChanged: (v) => setState(() => _category = v),
            ),
            const SizedBox(height: 16),
            TextFormField(
              controller: _about,
              maxLength: 500,
              minLines: 2,
              maxLines: 5,
              decoration: const InputDecoration(labelText: 'About', hintText: 'What you offer, delivery, timings…'),
            ),
            TextFormField(controller: _address, decoration: const InputDecoration(labelText: 'Address')),
            const SizedBox(height: 16),
            TextFormField(controller: _city, textCapitalization: TextCapitalization.words, decoration: const InputDecoration(labelText: 'City')),
            const SizedBox(height: 16),
            TextFormField(
              controller: _email,
              keyboardType: TextInputType.emailAddress,
              decoration: const InputDecoration(labelText: 'Email (optional)'),
              validator: (v) {
                final t = (v ?? '').trim();
                return t.isEmpty || RegExp(r'^[^@\s]+@[^@\s]+\.[^@\s]+$').hasMatch(t) ? null : 'Enter a valid email';
              },
            ),
            const SizedBox(height: 16),
            TextFormField(
              controller: _website,
              keyboardType: TextInputType.url,
              decoration: const InputDecoration(labelText: 'Website (optional)', hintText: 'www.example.com'),
            ),
            const SizedBox(height: 16),
            Row(children: [
              Icon(Icons.phone_outlined, size: 18, color: AppColors.textMuted),
              const SizedBox(width: 8),
              Expanded(child: Text('Business number: ${account.business?['phone'] ?? ''}', style: TextStyle(color: AppColors.textSecondary))),
            ]),
          ],
        ),
      ),
    );
  }
}
