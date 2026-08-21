import 'package:flutter/material.dart';
import 'package:permission_handler/permission_handler.dart';
import '../theme/app_theme.dart';

/// Real microphone permission status -- Android has no in-app selectable
/// input device for a normal (non-system) app, so this screen shows the
/// actual OS permission state and lets the user fix it, rather than a fake
/// "input device" picker that wouldn't do anything.
class MicrophoneSettingsScreen extends StatefulWidget {
  const MicrophoneSettingsScreen({super.key});

  @override
  State<MicrophoneSettingsScreen> createState() => _MicrophoneSettingsScreenState();
}

class _MicrophoneSettingsScreenState extends State<MicrophoneSettingsScreen> with WidgetsBindingObserver {
  PermissionStatus? _status;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _refresh();
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) _refresh();
  }

  Future<void> _refresh() async {
    final status = await Permission.microphone.status;
    if (mounted) setState(() => _status = status);
  }

  Future<void> _request() async {
    final status = await Permission.microphone.request();
    if (mounted) setState(() => _status = status);
  }

  String _label(PermissionStatus? s) {
    switch (s) {
      case PermissionStatus.granted:
        return 'Allowed';
      case PermissionStatus.denied:
        return 'Not allowed';
      case PermissionStatus.permanentlyDenied:
        return 'Blocked — enable it in system settings';
      case PermissionStatus.restricted:
        return 'Restricted';
      default:
        return 'Unknown';
    }
  }

  @override
  Widget build(BuildContext context) {
    final granted = _status == PermissionStatus.granted;
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(title: const Text('Microphone Settings')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          ListTile(
            leading: Icon(granted ? Icons.mic : Icons.mic_off, color: granted ? AppColors.green : AppColors.red),
            title: const Text('Microphone access', style: TextStyle(color: AppColors.white)),
            subtitle: Text(_label(_status), style: const TextStyle(color: AppColors.textMuted)),
          ),
          const SizedBox(height: 8),
          const Padding(
            padding: EdgeInsets.symmetric(horizontal: 16),
            child: Text(
              'Required for voice calls, video calls, and voice messages. NeuraTalk always uses your device\'s default microphone — there is no separate in-app selection on Android.',
              style: TextStyle(color: AppColors.textMuted, fontSize: 12),
            ),
          ),
          const SizedBox(height: 24),
          if (!granted)
            SizedBox(
              width: double.infinity,
              child: ElevatedButton(
                onPressed: _status == PermissionStatus.permanentlyDenied ? openAppSettings : _request,
                style: ElevatedButton.styleFrom(backgroundColor: AppColors.cyan, padding: const EdgeInsets.symmetric(vertical: 14)),
                child: Text(
                  _status == PermissionStatus.permanentlyDenied ? 'Open App Settings' : 'Allow Microphone',
                  style: const TextStyle(color: AppColors.background, fontWeight: FontWeight.w700),
                ),
              ),
            ),
        ],
      ),
    );
  }
}
