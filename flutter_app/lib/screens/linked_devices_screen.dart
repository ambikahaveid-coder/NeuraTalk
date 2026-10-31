import 'package:flutter/material.dart';
import 'package:mobile_scanner/mobile_scanner.dart';

import '../services/api_service.dart';
import '../theme/app_theme.dart';

/// Linked devices (like WhatsApp Web): use NeuraTalk on a computer by scanning
/// the QR at neuratalk.in/link-device, and sign devices out.
class LinkedDevicesScreen extends StatefulWidget {
  const LinkedDevicesScreen({super.key});
  @override
  State<LinkedDevicesScreen> createState() => _LinkedDevicesScreenState();
}

class _LinkedDevicesScreenState extends State<LinkedDevicesScreen> {
  List<Map<String, dynamic>>? _sessions;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final res = await ApiService.get('/api/linked-devices');
      if (mounted) setState(() => _sessions = ((res['sessions'] as List?) ?? const []).whereType<Map>().map((e) => Map<String, dynamic>.from(e)).toList());
    } catch (_) {
      if (mounted) setState(() => _error = 'Could not load your devices.');
    }
  }

  void _toast(String t) {
    if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(t)));
  }

  Future<void> _link() async {
    final linked = await Navigator.push<String>(context, MaterialPageRoute(builder: (_) => const _LinkDeviceScreen()));
    if (linked != null) {
      _toast('Linked: $linked');
      _load();
    }
  }

  Future<void> _signOut(Map<String, dynamic> s) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (d) => AlertDialog(
        title: Text('Sign out ${s['device']}?'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(d, false), child: const Text('Cancel')),
          TextButton(onPressed: () => Navigator.pop(d, true), child: const Text('Sign out', style: TextStyle(color: AppColors.red))),
        ],
      ),
    );
    if (ok != true) return;
    try {
      await ApiService.delete('/api/linked-devices/${s['id']}');
      _load();
    } catch (_) {
      _toast('Could not sign out that device.');
    }
  }

  Future<void> _signOutOthers() async {
    try {
      final res = await ApiService.post('/api/linked-devices/sign-out-others', {});
      _toast('Signed out ${res['signedOut'] ?? 0} other device(s)');
      _load();
    } catch (_) {
      _toast('Could not sign out other devices.');
    }
  }

  static String _when(dynamic raw) {
    final d = DateTime.tryParse(raw?.toString() ?? '')?.toLocal();
    if (d == null) return '';
    final diff = DateTime.now().difference(d);
    if (diff.inMinutes < 2) return 'Active now';
    if (diff.inHours < 1) return 'Active ${diff.inMinutes} min ago';
    if (diff.inDays < 1) return 'Active ${diff.inHours} h ago';
    return 'Active ${d.day}/${d.month}/${d.year}';
  }

  @override
  Widget build(BuildContext context) {
    final list = _sessions;
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(title: const Text('Linked devices')),
      body: RefreshIndicator(
        onRefresh: _load,
        child: ListView(padding: const EdgeInsets.all(16), children: [
          Icon(Icons.devices_other, size: 56, color: AppColors.cyan),
          const SizedBox(height: 8),
          Text('Use NeuraTalk on your computer', textAlign: TextAlign.center, style: TextStyle(color: AppColors.ink, fontSize: 18, fontWeight: FontWeight.w800)),
          const SizedBox(height: 6),
          Text('Open neuratalk.in/link-device on the computer, then tap Link a device and scan the QR code.',
              textAlign: TextAlign.center, style: TextStyle(color: AppColors.textSecondary)),
          const SizedBox(height: 16),
          FilledButton.icon(onPressed: _link, icon: const Icon(Icons.qr_code_scanner), label: const Text('Link a device')),
          const SizedBox(height: 24),
          Text('Signed in on', style: TextStyle(color: AppColors.textSecondary, fontWeight: FontWeight.w700)),
          const SizedBox(height: 8),
          if (_error != null) Text(_error!, style: const TextStyle(color: AppColors.red)),
          if (list == null && _error == null) const Center(child: Padding(padding: EdgeInsets.all(16), child: CircularProgressIndicator())),
          for (final s in list ?? const <Map<String, dynamic>>[])
            Card(
              color: AppColors.surface,
              child: ListTile(
                leading: Icon(s['linked'] == true ? Icons.computer : Icons.smartphone, color: AppColors.cyan),
                title: Text('${s['device']}${s['current'] == true ? ' · this phone' : ''}', style: TextStyle(color: AppColors.ink, fontWeight: FontWeight.w600)),
                subtitle: Text([_when(s['lastActivityAt']), if (s['ip'] != null) s['ip']].join(' · '), style: TextStyle(color: AppColors.textSecondary)),
                trailing: s['current'] == true
                    ? null
                    : IconButton(tooltip: 'Sign out', icon: const Icon(Icons.logout, color: AppColors.red), onPressed: () => _signOut(s)),
              ),
            ),
          if ((list?.where((s) => s['current'] != true).length ?? 0) > 1)
            TextButton(onPressed: _signOutOthers, child: const Text('Sign out all other devices', style: TextStyle(color: AppColors.red))),
        ]),
      ),
    );
  }
}

/// Scan the QR (or type the code) shown on the computer, then approve.
class _LinkDeviceScreen extends StatefulWidget {
  const _LinkDeviceScreen();
  @override
  State<_LinkDeviceScreen> createState() => _LinkDeviceScreenState();
}

class _LinkDeviceScreenState extends State<_LinkDeviceScreen> {
  final _code = TextEditingController();
  final _scanner = MobileScannerController(formats: const [BarcodeFormat.qrCode]);
  bool _busy = false;
  bool _typing = false;
  String? _error;

  @override
  void dispose() {
    _scanner.dispose();
    _code.dispose();
    super.dispose();
  }

  Future<void> _approve(String code) async {
    if (_busy) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    await _scanner.stop();
    if (!mounted) return;
    final ok = await showDialog<bool>(
      context: context,
      builder: (d) => AlertDialog(
        title: const Text('Link this computer?'),
        content: const Text('It will be able to read and send your messages until you sign it out. Only link computers you trust.'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(d, false), child: const Text('Cancel')),
          FilledButton(onPressed: () => Navigator.pop(d, true), child: const Text('Link')),
        ],
      ),
    );
    if (ok != true) {
      setState(() => _busy = false);
      if (!_typing) await _scanner.start();
      return;
    }
    try {
      final res = await ApiService.post('/api/link-device/approve', {'code': code});
      if (mounted) Navigator.pop(context, res['device']?.toString() ?? 'Computer');
    } on ApiException catch (e) {
      setState(() => _error = e.message);
      if (!_typing) await _scanner.start();
    } catch (_) {
      setState(() => _error = 'Could not link. Check your connection.');
      if (!_typing) await _scanner.start();
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(title: const Text('Link a device')),
      body: ListView(padding: const EdgeInsets.all(16), children: [
        if (!_typing)
          AspectRatio(
            aspectRatio: 1,
            child: ClipRRect(
              borderRadius: BorderRadius.circular(16),
              child: MobileScanner(
                controller: _scanner,
                onDetect: (capture) {
                  final value = capture.barcodes.firstOrNull?.rawValue;
                  if (value != null && value.contains('link-device')) _approve(value);
                },
                errorBuilder: (_, error) => Container(
                  color: Colors.black,
                  alignment: Alignment.center,
                  padding: const EdgeInsets.all(16),
                  child: const Text('Camera not available. Allow camera access, or type the code instead.',
                      textAlign: TextAlign.center, style: TextStyle(color: Colors.white)),
                ),
              ),
            ),
          ),
        const SizedBox(height: 12),
        Text(_typing ? 'Type the 8-character code shown on the computer.' : 'Point your camera at the QR code on neuratalk.in/link-device.',
            textAlign: TextAlign.center, style: TextStyle(color: AppColors.textSecondary)),
        if (_typing) ...[
          const SizedBox(height: 12),
          TextField(
            controller: _code,
            autofocus: true,
            textCapitalization: TextCapitalization.characters,
            maxLength: 9,
            textAlign: TextAlign.center,
            style: TextStyle(color: AppColors.ink, fontSize: 24, letterSpacing: 4),
            decoration: const InputDecoration(counterText: '', hintText: 'ABCD-EFGH'),
          ),
          FilledButton(
            onPressed: _busy ? null : () => _approve(_code.text),
            child: Text(_busy ? 'Linking…' : 'Link'),
          ),
        ],
        if (_error != null) Padding(padding: const EdgeInsets.only(top: 8), child: Text(_error!, textAlign: TextAlign.center, style: const TextStyle(color: AppColors.red))),
        TextButton(
          onPressed: () async {
            if (_typing) {
              setState(() => _typing = false);
              await _scanner.start();
            } else {
              await _scanner.stop();
              setState(() => _typing = true);
            }
          },
          child: Text(_typing ? 'Scan the QR code instead' : 'Type the code instead'),
        ),
      ]),
    );
  }
}
