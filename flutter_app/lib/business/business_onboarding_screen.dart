import 'dart:io';

import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';
import 'package:provider/provider.dart';

import '../providers/auth_provider.dart';
import '../services/api_service.dart';
import '../services/media_store.dart';
import '../theme/app_theme.dart';
import 'business_categories.dart';

/// First run of NeuraTalk Business for a number that has no business yet:
/// create it right here (like WhatsApp Business) — name, category, logo,
/// a few words about it. Customers see this name and logo on every message.
class BusinessOnboardingScreen extends StatefulWidget {
  const BusinessOnboardingScreen({super.key});

  @override
  State<BusinessOnboardingScreen> createState() => _BusinessOnboardingScreenState();
}

class _BusinessOnboardingScreenState extends State<BusinessOnboardingScreen> {
  final _form = GlobalKey<FormState>();
  final _name = TextEditingController();
  final _city = TextEditingController();
  final _about = TextEditingController();
  String? _category;
  File? _logo;
  bool _saving = false;
  String? _blockedReason;

  @override
  void dispose() {
    _name.dispose();
    _city.dispose();
    _about.dispose();
    super.dispose();
  }

  Future<void> _pickLogo() async {
    final picked = await ImagePicker().pickImage(source: ImageSource.gallery, maxWidth: 1024, maxHeight: 1024, imageQuality: 88);
    if (picked != null && mounted) setState(() => _logo = File(picked.path));
  }

  Future<void> _create() async {
    if (!(_form.currentState?.validate() ?? false) || _saving) return;
    setState(() => _saving = true);
    final auth = context.read<AuthProvider>();
    try {
      final res = await ApiService.post('/api/business/self-signup', {
        'name': _name.text.trim(),
        'category': _category,
        if (_city.text.trim().isNotEmpty) 'city': _city.text.trim(),
        if (_about.text.trim().isNotEmpty) 'description': _about.text.trim(),
      });
      final businessId = ((res['business'] as Map?)?['id'] as num?)?.toInt();
      if (businessId != null && _logo != null) {
        try {
          final path = await MediaStore.upload(_logo!, 'logo.jpg');
          await ApiService.put('/api/business/$businessId/branding/logo', {'objectPath': path});
        } catch (_) {
          // The business exists; the logo can be added from Business profile.
        }
      }
      await auth.fetchProfile();
    } on ApiException catch (e) {
      if (!mounted) return;
      if (e.statusCode == 409) {
        setState(() => _blockedReason = e.message);
      } else {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.message)));
      }
    } catch (_) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Could not create the business. Check your connection.')));
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final phone = context.watch<AuthProvider>().user?['phone']?.toString() ?? '';
    if (_blockedReason != null) return _blocked(phone);
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(
        title: const Text('Create your business'),
        actions: [TextButton(onPressed: () => context.read<AuthProvider>().logout(), child: const Text('Log out'))],
      ),
      body: SafeArea(
        child: Form(
          key: _form,
          child: ListView(
            padding: const EdgeInsets.fromLTRB(20, 8, 20, 32),
            children: [
              Text('Customers will see this name and logo on every message you send.',
                  style: TextStyle(color: AppColors.textSecondary, fontSize: 15)),
              const SizedBox(height: 20),
              Center(
                child: GestureDetector(
                  onTap: _pickLogo,
                  child: Stack(clipBehavior: Clip.none, children: [
                    CircleAvatar(
                      radius: 52,
                      backgroundColor: AppColors.blueTint,
                      backgroundImage: _logo != null ? FileImage(_logo!) : null,
                      child: _logo == null ? Icon(Icons.storefront_outlined, size: 44, color: AppColors.cyan) : null,
                    ),
                    Positioned(
                      right: -2,
                      bottom: -2,
                      child: CircleAvatar(radius: 18, backgroundColor: AppColors.cyan, child: const Icon(Icons.photo_camera, size: 18, color: AppColors.onAccent)),
                    ),
                  ]),
                ),
              ),
              const SizedBox(height: 8),
              Center(child: Text(_logo == null ? 'Add logo' : 'Change logo', style: TextStyle(color: AppColors.cyan, fontWeight: FontWeight.w600))),
              const SizedBox(height: 24),
              TextFormField(
                controller: _name,
                textCapitalization: TextCapitalization.words,
                maxLength: 80,
                decoration: const InputDecoration(labelText: 'Business name', hintText: 'e.g. Lakshmi Sarees'),
                validator: (v) => (v ?? '').trim().length < 2 ? 'Enter your business name' : null,
              ),
              const SizedBox(height: 8),
              DropdownButtonFormField<String>(
                initialValue: _category,
                isExpanded: true,
                decoration: const InputDecoration(labelText: 'Category'),
                items: [for (final c in kBusinessCategories) DropdownMenuItem(value: c, child: Text(c))],
                onChanged: (v) => setState(() => _category = v),
                validator: (v) => v == null ? 'Choose a category' : null,
              ),
              const SizedBox(height: 16),
              TextFormField(
                controller: _city,
                textCapitalization: TextCapitalization.words,
                decoration: const InputDecoration(labelText: 'City (optional)'),
              ),
              const SizedBox(height: 16),
              TextFormField(
                controller: _about,
                maxLength: 500,
                minLines: 2,
                maxLines: 4,
                decoration: const InputDecoration(labelText: 'About your business (optional)', hintText: 'What you sell, timings, delivery…'),
              ),
              const SizedBox(height: 8),
              Container(
                padding: const EdgeInsets.all(14),
                decoration: BoxDecoration(color: AppColors.blueTint, borderRadius: BorderRadius.circular(14)),
                child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Icon(Icons.verified_outlined, color: AppColors.cyan),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Text(
                      'You can chat with customers right away. The blue verified tick appears after NeuraTalk checks your business — ask for it from Tools.',
                      style: TextStyle(color: AppColors.ink, fontSize: 13.5),
                    ),
                  ),
                ]),
              ),
              const SizedBox(height: 24),
              SizedBox(
                height: 52,
                child: ElevatedButton(
                  onPressed: _saving ? null : _create,
                  child: _saving
                      ? const SizedBox(width: 22, height: 22, child: CircularProgressIndicator(strokeWidth: 2.5, color: AppColors.onAccent))
                      : const Text('Create business'),
                ),
              ),
              if (phone.isNotEmpty) ...[
                const SizedBox(height: 12),
                Center(child: Text('Business number: $phone', style: TextStyle(color: AppColors.textMuted, fontSize: 13))),
              ],
            ],
          ),
        ),
      ),
    );
  }

  Widget _blocked(String phone) {
    return Scaffold(
      backgroundColor: AppColors.background,
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(28),
          child: Column(mainAxisAlignment: MainAxisAlignment.center, children: [
            Icon(Icons.phone_android, size: 56, color: AppColors.cyan),
            const SizedBox(height: 16),
            Text('Use your business number', textAlign: TextAlign.center,
                style: TextStyle(color: AppColors.ink, fontSize: 22, fontWeight: FontWeight.w800)),
            const SizedBox(height: 12),
            Text(_blockedReason!, textAlign: TextAlign.center, style: TextStyle(color: AppColors.textSecondary, fontSize: 15)),
            if (phone.isNotEmpty) ...[
              const SizedBox(height: 8),
              Text(phone, style: TextStyle(color: AppColors.textMuted)),
            ],
            const SizedBox(height: 28),
            SizedBox(
              width: double.infinity,
              height: 50,
              child: ElevatedButton(onPressed: () => context.read<AuthProvider>().logout(), child: const Text('Log in with another number')),
            ),
          ]),
        ),
      ),
    );
  }
}
