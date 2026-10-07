import 'package:flutter/material.dart';
import 'package:permission_handler/permission_handler.dart';
import '../theme/app_theme.dart';
import '../widgets/nt_ui.dart';

/// Shows the real OS microphone permission and lets the user fix it.
/// Android has no in-app input-device picker for normal apps, so there's
/// no fake one here.
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
        return 'Blocked. Turn it on in phone settings';
      case PermissionStatus.restricted:
        return 'Restricted';
      default:
        return 'Checking...';
    }
  }

  @override
  Widget build(BuildContext context) {
    final granted = _status == PermissionStatus.granted;
    final blocked = _status == PermissionStatus.permanentlyDenied;
    final tint = _status == null ? AppColors.textMuted : (granted ? AppColors.green : AppColors.red);
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(title: const Text('Microphone')),
      body: ListView(
        padding: const EdgeInsets.all(NtSpace.l),
        children: [
          NtCard(
            padding: const EdgeInsets.all(NtSpace.l),
            child: Row(children: [
              Container(
                width: 48,
                height: 48,
                decoration: BoxDecoration(color: tint.withValues(alpha: 0.14), shape: BoxShape.circle),
                child: Icon(granted ? Icons.mic : Icons.mic_off, color: tint),
              ),
              const SizedBox(width: 14),
              Expanded(
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Text('Microphone access', style: TextStyle(color: AppColors.ink, fontWeight: FontWeight.w600, fontSize: 16)),
                  const SizedBox(height: 2),
                  Text(_label(_status), style: TextStyle(color: tint, fontSize: 14, fontWeight: FontWeight.w600)),
                ]),
              ),
            ]),
          ),
          if (!granted && _status != null) ...[
            const SizedBox(height: NtSpace.l),
            ElevatedButton(
              onPressed: blocked ? openAppSettings : _request,
              child: Text(blocked ? 'Open phone settings' : 'Allow microphone'),
            ),
          ],
          const SizedBox(height: NtSpace.xxl),
          const NtInfoCard(
            icon: Icons.info_outline,
            title: 'Why NeuraTalk needs it',
            body: "For voice and video calls, voice messages and face-to-face translation. NeuraTalk uses your phone's default microphone or a connected headset.",
          ),
        ],
      ),
    );
  }
}
