import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';

import '../providers/auth_provider.dart';
import '../services/api_service.dart';
import '../theme/app_theme.dart';

/// Asked after the SMS code when the account has two-step verification on.
/// Pops with true once signed in.
class TwoStepPinScreen extends StatefulWidget {
  final String ticket;
  final String? resetAvailableAt;
  const TwoStepPinScreen({super.key, required this.ticket, this.resetAvailableAt});

  @override
  State<TwoStepPinScreen> createState() => _TwoStepPinScreenState();
}

class _TwoStepPinScreenState extends State<TwoStepPinScreen> {
  final _pin = TextEditingController();
  bool _busy = false;
  String? _error;
  String? _info;

  @override
  void initState() {
    super.initState();
    final at = DateTime.tryParse(widget.resetAvailableAt ?? '')?.toLocal();
    if (at != null) _info = 'A PIN reset is pending. You can sign in without it after ${_date(at)}.';
  }

  static String _date(DateTime d) => '${d.day}/${d.month}/${d.year}';

  Future<void> _submit() async {
    final pin = _pin.text.trim();
    if (pin.length != 6) {
      setState(() => _error = 'Enter your 6-digit PIN.');
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await context.read<AuthProvider>().completeTwoStep(widget.ticket, pin);
      if (mounted) Navigator.pop(context, true);
    } on ApiException catch (e) {
      _pin.clear();
      setState(() => _error = e.message);
      if (e.statusCode == 429 || (e.statusCode == 401 && e.message.contains('expired'))) {
        await Future<void>.delayed(const Duration(seconds: 2));
        if (mounted) Navigator.pop(context, false);
      }
    } catch (_) {
      setState(() => _error = 'Could not check the PIN. Check your connection.');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _forgot() async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (d) => AlertDialog(
        title: const Text('Forgot your PIN?'),
        content: const Text('For your safety, the PIN can only be removed 7 days after you ask. '
            'Until then, sign in with the PIN if you remember it — that cancels the reset.'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(d, false), child: const Text('Cancel')),
          FilledButton(onPressed: () => Navigator.pop(d, true), child: const Text('Reset PIN')),
        ],
      ),
    );
    if (ok != true || !mounted) return;
    try {
      final res = await ApiService.post('/api/auth/two-step/forgot', {'ticket': widget.ticket});
      final at = DateTime.tryParse(res['resetAvailableAt']?.toString() ?? '')?.toLocal();
      setState(() => _info = at != null ? 'Reset requested. You can sign in without the PIN after ${_date(at)}.' : res['message']?.toString());
    } on ApiException catch (e) {
      setState(() => _error = e.message);
    } catch (_) {
      setState(() => _error = 'Could not request a reset. Check your connection.');
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(title: const Text('Two-step verification')),
      body: SafeArea(
        child: ListView(padding: const EdgeInsets.all(24), children: [
          Icon(Icons.lock_outline, size: 56, color: AppColors.cyan),
          const SizedBox(height: 16),
          Text('Enter your PIN', textAlign: TextAlign.center, style: TextStyle(color: AppColors.ink, fontSize: 22, fontWeight: FontWeight.w800)),
          const SizedBox(height: 8),
          Text('This account is protected with a 6-digit PIN.', textAlign: TextAlign.center, style: TextStyle(color: AppColors.textSecondary)),
          const SizedBox(height: 24),
          TextField(
            controller: _pin,
            autofocus: true,
            obscureText: true,
            keyboardType: TextInputType.number,
            maxLength: 6,
            textAlign: TextAlign.center,
            inputFormatters: [FilteringTextInputFormatter.digitsOnly],
            style: TextStyle(color: AppColors.ink, fontSize: 28, letterSpacing: 12),
            decoration: const InputDecoration(counterText: '', hintText: '••••••'),
            onChanged: (v) {
              if (v.length == 6 && !_busy) _submit();
            },
          ),
          if (_error != null) Padding(padding: const EdgeInsets.only(top: 8), child: Text(_error!, textAlign: TextAlign.center, style: const TextStyle(color: AppColors.red))),
          if (_info != null) Padding(padding: const EdgeInsets.only(top: 8), child: Text(_info!, textAlign: TextAlign.center, style: TextStyle(color: AppColors.textSecondary))),
          const SizedBox(height: 20),
          FilledButton(onPressed: _busy ? null : _submit, child: Text(_busy ? 'Checking…' : 'Continue')),
          TextButton(onPressed: _busy ? null : _forgot, child: const Text('Forgot PIN?')),
        ]),
      ),
    );
  }
}

/// Settings: turn two-step verification on, change the PIN, or turn it off.
class TwoStepSettingsScreen extends StatefulWidget {
  const TwoStepSettingsScreen({super.key});
  @override
  State<TwoStepSettingsScreen> createState() => _TwoStepSettingsScreenState();
}

class _TwoStepSettingsScreenState extends State<TwoStepSettingsScreen> {
  bool? _enabled;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final res = await ApiService.get('/api/privacy/two-step');
      if (mounted) setState(() => _enabled = res['enabled'] == true);
    } catch (_) {
      if (mounted) setState(() => _enabled = false);
    }
  }

  Future<String?> _askPin(String title, {String? hint}) {
    final c = TextEditingController();
    return showDialog<String>(
      context: context,
      builder: (d) => AlertDialog(
        title: Text(title),
        content: Column(mainAxisSize: MainAxisSize.min, children: [
          if (hint != null) Text(hint, style: TextStyle(color: AppColors.textSecondary)),
          TextField(
            controller: c,
            autofocus: true,
            obscureText: true,
            keyboardType: TextInputType.number,
            maxLength: 6,
            inputFormatters: [FilteringTextInputFormatter.digitsOnly],
            decoration: const InputDecoration(counterText: '', hintText: '6 digits'),
          ),
        ]),
        actions: [
          TextButton(onPressed: () => Navigator.pop(d), child: const Text('Cancel')),
          FilledButton(onPressed: () => Navigator.pop(d, c.text.trim()), child: const Text('Next')),
        ],
      ),
    );
  }

  void _toast(String t) {
    if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(t)));
  }

  Future<void> _setPin({required bool change}) async {
    String? current;
    if (change) {
      current = await _askPin('Current PIN');
      if (current == null || current.length != 6) return;
    }
    final pin = await _askPin(change ? 'New PIN' : 'Create a 6-digit PIN', hint: 'You\'ll be asked for it whenever you sign in on a phone.');
    if (pin == null) return;
    if (pin.length != 6) return _toast('The PIN is 6 digits.');
    final again = await _askPin('Confirm the PIN');
    if (again != pin) return _toast('The PINs don\'t match.');
    try {
      await ApiService.post('/api/privacy/two-step', {'pin': pin, if (current != null) 'currentPin': current});
      setState(() => _enabled = true);
      _toast(change ? 'PIN changed' : 'Two-step verification is on');
    } on ApiException catch (e) {
      _toast(e.message);
    } catch (_) {
      _toast('Could not save. Check your connection.');
    }
  }

  Future<void> _turnOff() async {
    final pin = await _askPin('Enter your PIN to turn it off');
    if (pin == null || pin.length != 6) return;
    try {
      await ApiService.delete('/api/privacy/two-step', body: {'pin': pin});
      setState(() => _enabled = false);
      _toast('Two-step verification is off');
    } on ApiException catch (e) {
      _toast(e.message);
    } catch (_) {
      _toast('Could not save. Check your connection.');
    }
  }

  @override
  Widget build(BuildContext context) {
    final on = _enabled;
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(title: const Text('Two-step verification')),
      body: on == null
          ? const Center(child: CircularProgressIndicator())
          : ListView(padding: const EdgeInsets.all(20), children: [
              Icon(on ? Icons.verified_user : Icons.lock_outline, size: 56, color: on ? AppColors.green : AppColors.cyan),
              const SizedBox(height: 12),
              Text(on ? 'Two-step verification is on' : 'Add a PIN to your account',
                  textAlign: TextAlign.center, style: TextStyle(color: AppColors.ink, fontSize: 20, fontWeight: FontWeight.w800)),
              const SizedBox(height: 8),
              Text(
                'After the SMS code, NeuraTalk will also ask for your 6-digit PIN. '
                'Even if someone gets your SIM or SMS code, they can\'t sign in without it.',
                textAlign: TextAlign.center,
                style: TextStyle(color: AppColors.textSecondary),
              ),
              const SizedBox(height: 24),
              if (!on) FilledButton(onPressed: () => _setPin(change: false), child: const Text('Turn on')),
              if (on) ...[
                OutlinedButton(onPressed: () => _setPin(change: true), child: const Text('Change PIN')),
                const SizedBox(height: 8),
                TextButton(onPressed: _turnOff, child: const Text('Turn off', style: TextStyle(color: AppColors.red))),
              ],
            ]),
    );
  }
}
