import 'dart:async';
import 'dart:io';
import 'package:audioplayers/audioplayers.dart';
import 'package:flutter/material.dart';
import 'package:path_provider/path_provider.dart';
import 'package:provider/provider.dart';
import 'package:record/record.dart';
import '../providers/auth_provider.dart';
import '../services/api_service.dart';
import '../services/voice_consent.dart';
import '../theme/app_theme.dart';
import '../utils/languages.dart';
import '../utils/voice_prompts.dart';
import '../widgets/nt_ui.dart';

/// Records three short readings in-app and turns them into the user's own
/// voice for translated calls (server/voice-training.ts). The clone is used
/// automatically once training finishes; an admin can turn a misused one off.
class VoiceCloneScreen extends StatefulWidget {
  const VoiceCloneScreen({super.key});

  @override
  State<VoiceCloneScreen> createState() => _VoiceCloneScreenState();
}

enum _Stage { loading, intro, recording, uploading, status, error }

class _VoiceCloneScreenState extends State<VoiceCloneScreen> {
  static const _minSeconds = 8;
  static const _maxSeconds = 60;

  // Created on first use: nothing touches the microphone or audio output
  // until the user starts recording or listening back.
  AudioRecorder? _recorderInstance;
  AudioPlayer? _playerInstance;
  AudioRecorder get _recorder => _recorderInstance ??= AudioRecorder();
  AudioPlayer get _player => _playerInstance ??= (AudioPlayer()
    ..onPlayerComplete.listen((_) {
      if (mounted) setState(() => _playing = false);
    }));

  _Stage _stage = _Stage.loading;
  Map<String, dynamic>? _profile;
  String? _loadError;

  List<String> _prompts = voicePromptsFor('en');
  int _index = 0;
  final List<String?> _paths = [null, null, null];
  final List<int> _durations = [0, 0, 0];
  bool _recording = false;
  bool _playing = false;
  DateTime? _startedAt;
  Duration _elapsed = Duration.zero;
  Timer? _ticker;
  Timer? _poll;
  bool _consented = false;
  String _uploadStep = '';
  bool _busy = false;
  bool? _learnAllowed;

  int? get _userId => int.tryParse(context.read<AuthProvider>().user?['id']?.toString() ?? '');

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      final lang = context.read<AuthProvider>().user?['preferredLanguage']?.toString();
      _prompts = voicePromptsFor(lang);
      _loadProfile();
    });
  }

  @override
  void dispose() {
    _ticker?.cancel();
    _poll?.cancel();
    _recorderInstance?.dispose();
    _playerInstance?.dispose();
    super.dispose();
  }

  Future<void> _loadProfile() async {
    final id = _userId;
    if (id == null) return;
    try {
      final data = await ApiService.get('/api/voice-training/profile/$id');
      if (!mounted) return;
      final hasVoice = data is Map && data['hasCustomVoice'] == true;
      final consent = await VoiceConsent.status();
      if (!mounted) return;
      _learnAllowed = consent?['allowed'] == true;
      setState(() {
        _profile = hasVoice ? Map<String, dynamic>.from(data['profile'] as Map) : null;
        _stage = hasVoice ? _Stage.status : _Stage.intro;
      });
      _schedulePoll();
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _loadError = e is ApiException ? e.message : 'Check your internet connection and try again.';
        _stage = _Stage.error;
      });
    }
  }

  // Training takes a few minutes; keep the status fresh while it runs.
  void _schedulePoll() {
    _poll?.cancel();
    if (_profile?['trainingStatus'] == 'training') {
      _poll = Timer(const Duration(seconds: 5), _loadProfile);
    }
  }

  Future<void> _toggleRecording() async {
    if (_recording) return _stopRecording();
    if (!await _recorder.hasPermission()) {
      _snack('Allow microphone access to record your voice.');
      return;
    }
    await _playerInstance?.stop();
    final dir = await getTemporaryDirectory();
    final path = '${dir.path}/voice_sample_${_index}_${DateTime.now().millisecondsSinceEpoch}.wav';
    // WAV at 44.1 kHz mono: what the cloning provider expects (enrolled as audio/wav).
    await _recorder.start(const RecordConfig(encoder: AudioEncoder.wav, sampleRate: 44100, numChannels: 1), path: path);
    setState(() {
      _recording = true;
      _playing = false;
      _startedAt = DateTime.now();
      _elapsed = Duration.zero;
    });
    _ticker = Timer.periodic(const Duration(milliseconds: 250), (_) {
      if (!mounted || _startedAt == null) return;
      final elapsed = DateTime.now().difference(_startedAt!);
      setState(() => _elapsed = elapsed);
      if (elapsed.inSeconds >= _maxSeconds) _stopRecording();
    });
  }

  Future<void> _stopRecording() async {
    _ticker?.cancel();
    final path = await _recorder.stop();
    final seconds = _startedAt == null ? 0 : DateTime.now().difference(_startedAt!).inSeconds;
    setState(() {
      _recording = false;
      _startedAt = null;
    });
    if (path == null) return;
    if (seconds < _minSeconds) {
      _snack('That was a bit short. Read the whole passage, about 15 seconds.');
      return;
    }
    setState(() {
      _paths[_index] = path;
      _durations[_index] = seconds;
    });
  }

  Future<void> _togglePlayback() async {
    final path = _paths[_index];
    if (path == null) return;
    if (_playing) {
      await _player.stop();
      setState(() => _playing = false);
      return;
    }
    await _player.play(DeviceFileSource(path));
    setState(() => _playing = true);
  }

  Future<void> _submit() async {
    final id = _userId;
    if (id == null || _busy) return;
    setState(() {
      _busy = true;
      _stage = _Stage.uploading;
    });
    try {
      for (var i = 0; i < _paths.length; i++) {
        setState(() => _uploadStep = 'Uploading recording ${i + 1} of ${_paths.length}…');
        final bytes = await File(_paths[i]!).readAsBytes();
        final info = await ApiService.post('/api/voice-training/request-upload', {'consent': true});
        // A minute of WAV is ~5 MB; putBytes' 30 s cap fails on slow mobile data.
        await ApiService.putBytesWithProgress(info['uploadURL'] as String, bytes, 'audio/wav');
        await ApiService.post('/api/voice-training/samples', {
          'objectPath': info['objectPath'],
          'consent': true,
          'duration': _durations[i],
          'transcript': _prompts[i],
          'metadata': {'source': 'app', 'mimeType': 'audio/wav', 'sizeBytes': bytes.length},
        });
      }
      setState(() => _uploadStep = 'Creating your voice…');
      await ApiService.post('/api/voice-training/train/$id', {});
      await _loadProfile();
    } catch (e) {
      if (!mounted) return;
      setState(() => _stage = _Stage.recording);
      _snack(e is ApiException ? e.message : 'Upload failed. Check your connection and try again.');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _setEnabled(bool enabled) async {
    final id = _userId;
    if (id == null) return;
    setState(() => _busy = true);
    try {
      await ApiService.patch('/api/voice-training/profile/$id/toggle', {'enabled': enabled});
      await _loadProfile();
    } catch (e) {
      _snack(e is ApiException ? e.message : 'Could not change this setting.');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _deleteVoice({required bool thenRecord}) async {
    final id = _userId;
    if (id == null) return;
    final ok = await showDialog<bool>(
      context: context,
      builder: (d) => AlertDialog(
        title: Text(thenRecord ? 'Record your voice again?' : 'Delete your voice?'),
        content: Text(thenRecord
            ? 'Your current voice and recordings are deleted first. Calls use a standard voice until the new one is ready.'
            : 'Your recordings and your voice are deleted. Calls use a standard voice from now on.'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(d, false), child: const Text('Cancel')),
          TextButton(
            onPressed: () => Navigator.pop(d, true),
            child: Text(thenRecord ? 'Record again' : 'Delete', style: const TextStyle(color: AppColors.red)),
          ),
        ],
      ),
    );
    if (ok != true) return;
    setState(() => _busy = true);
    try {
      await ApiService.delete('/api/voice-training/delete-all/$id', body: {'confirmDelete': true});
      if (!mounted) return;
      _resetRecordings();
      setState(() {
        _profile = null;
        _stage = thenRecord ? _Stage.recording : _Stage.intro;
      });
    } catch (e) {
      _snack(e is ApiException ? e.message : 'Could not delete your voice.');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  void _resetRecordings() {
    _index = 0;
    _consented = false;
    for (var i = 0; i < _paths.length; i++) {
      _paths[i] = null;
      _durations[i] = 0;
    }
  }

  void _snack(String message) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(message)));
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(title: const Text('Your voice')),
      body: SafeArea(child: _body()),
    );
  }

  Widget _body() {
    switch (_stage) {
      case _Stage.loading:
        return const Center(child: CircularProgressIndicator());
      case _Stage.error:
        return NtEmptyState(
          icon: Icons.wifi_off,
          title: 'Could not load your voice',
          message: _loadError ?? 'Please try again.',
          actionLabel: 'Try again',
          onAction: () {
            setState(() => _stage = _Stage.loading);
            _loadProfile();
          },
          error: true,
        );
      case _Stage.intro:
        return _intro();
      case _Stage.recording:
        return _recordingStep();
      case _Stage.uploading:
        return NtEmptyState(icon: Icons.cloud_upload_outlined, title: 'Saving your voice', message: _uploadStep);
      case _Stage.status:
        return _status();
    }
  }

  // The primary action stays pinned at the bottom so it is visible on small
  // phones without scrolling past the explanation.
  Widget _withBottomAction(List<Widget> content, Widget action) {
    return Column(children: [
      Expanded(child: ListView(padding: const EdgeInsets.all(NtSpace.l), children: content)),
      Padding(padding: const EdgeInsets.fromLTRB(NtSpace.l, NtSpace.s, NtSpace.l, NtSpace.l), child: action),
    ]);
  }

  Widget _intro() {
    final lang = context.read<AuthProvider>().user?['preferredLanguage']?.toString();
    return _withBottomAction([
      NtCard(
        padding: const EdgeInsets.all(NtSpace.xl),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Container(
            width: 56,
            height: 56,
            decoration: BoxDecoration(color: AppColors.cyan.withValues(alpha: 0.12), shape: BoxShape.circle),
            child: Icon(Icons.record_voice_over, color: AppColors.cyan, size: 30),
          ),
          const SizedBox(height: NtSpace.l),
          Text('Talk in your own voice', style: TextStyle(color: AppColors.ink, fontSize: 22, fontWeight: FontWeight.w800)),
          const SizedBox(height: NtSpace.s),
          Text(
            'When you call someone who speaks another language, they hear your words translated, in your voice instead of a robot voice.',
            style: TextStyle(color: AppColors.textSecondary, fontSize: 15, height: 1.45),
          ),
        ]),
      ),
      const SizedBox(height: NtSpace.m),
      const NtInfoCard(
        icon: Icons.mic_none,
        title: 'Read 3 short passages',
        body: 'About a minute in total. Find a quiet place and speak the way you normally talk.',
      ),
      const SizedBox(height: NtSpace.m),
      NtInfoCard(
        icon: Icons.translate,
        title: 'In ${Languages.name(lang ?? 'en')}',
        body: 'The passages are in the language you speak, so your voice keeps your own accent.',
      ),
      const SizedBox(height: NtSpace.m),
      const NtInfoCard(
        icon: Icons.lock_outline,
        title: 'Private to you',
        body: 'Recordings are encrypted. Only your calls use your voice, and you can delete it any time.',
      ),
      const SizedBox(height: NtSpace.m),
      NtCard(
        child: SwitchListTile(
          contentPadding: EdgeInsets.zero,
          value: _learnAllowed ?? false,
          onChanged: _learnAllowed == null ? null : (value) async {
            setState(() => _learnAllowed = value);
            if (!await VoiceConsent.setAllowed(value) && mounted) setState(() => _learnAllowed = !value);
          },
          title: Text('Or learn it from my calls', style: TextStyle(color: AppColors.ink, fontWeight: FontWeight.w700)),
          subtitle: Text(
            'Skip the reading: NeuraTalk learns your voice from the first half-minute you speak in a call. The recording is not kept.',
            style: TextStyle(color: AppColors.textSecondary, height: 1.35),
          ),
        ),
      ),
    ], SizedBox(
      width: double.infinity,
      child: ElevatedButton(
        onPressed: () => setState(() {
          _resetRecordings();
          _stage = _Stage.recording;
        }),
        child: const Text('Get started'),
      ),
    ));
  }

  Widget _recordingStep() {
    final recorded = _paths[_index] != null;
    final last = _index == _paths.length - 1;
    final seconds = _recording ? _elapsed.inSeconds : _durations[_index];
    return _withBottomAction([
      Row(children: [
        Text('Passage ${_index + 1} of ${_paths.length}', style: TextStyle(color: AppColors.textSecondary, fontSize: 14, fontWeight: FontWeight.w600)),
        const Spacer(),
        for (var i = 0; i < _paths.length; i++)
          Container(
            width: 28,
            height: 6,
            margin: const EdgeInsets.only(left: NtSpace.xs),
            decoration: BoxDecoration(
              color: _paths[i] != null || i == _index ? AppColors.cyan : AppColors.border,
              borderRadius: BorderRadius.circular(3),
            ),
          ),
      ]),
      const SizedBox(height: NtSpace.l),
      NtCard(
        padding: const EdgeInsets.all(NtSpace.xl),
        child: Text(_prompts[_index], style: TextStyle(color: AppColors.ink, fontSize: 19, height: 1.6, fontWeight: FontWeight.w500)),
      ),
      const SizedBox(height: NtSpace.s),
      Text('Read it aloud slowly and naturally.', textAlign: TextAlign.center, style: TextStyle(color: AppColors.textMuted, fontSize: 13.5)),
      const SizedBox(height: NtSpace.xxl),
      Center(
        child: Semantics(
          button: true,
          label: _recording ? 'Stop recording' : (recorded ? 'Record this passage again' : 'Start recording'),
          child: GestureDetector(
            onTap: _busy ? null : _toggleRecording,
            child: AnimatedContainer(
              duration: const Duration(milliseconds: 200),
              width: 88,
              height: 88,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                color: _recording ? AppColors.red : AppColors.cyan,
                boxShadow: [BoxShadow(color: (_recording ? AppColors.red : AppColors.cyan).withValues(alpha: 0.35), blurRadius: _recording ? 24 : 12)],
              ),
              child: Icon(_recording ? Icons.stop_rounded : Icons.mic, color: AppColors.onAccent, size: 40),
            ),
          ),
        ),
      ),
      const SizedBox(height: NtSpace.m),
      Text(
        _recording
            ? 'Recording… 0:${seconds.toString().padLeft(2, '0')}  ·  tap to stop'
            : recorded
                ? 'Recorded ${seconds}s  ·  tap the mic to record again'
                : 'Tap the mic and start reading',
        textAlign: TextAlign.center,
        style: TextStyle(color: _recording ? AppColors.red : AppColors.textSecondary, fontSize: 14.5, fontWeight: FontWeight.w600),
      ),
      if (recorded && !_recording) ...[
        const SizedBox(height: NtSpace.s),
        Center(
          child: TextButton.icon(
            onPressed: _togglePlayback,
            icon: Icon(_playing ? Icons.stop_circle_outlined : Icons.play_circle_outline),
            label: Text(_playing ? 'Stop' : 'Listen back'),
          ),
        ),
      ],
      if (last && recorded && !_recording) ...[
        const SizedBox(height: NtSpace.l),
        NtCard(
          child: CheckboxListTile(
            value: _consented,
            onChanged: (v) => setState(() => _consented = v == true),
            controlAffinity: ListTileControlAffinity.leading,
            contentPadding: const EdgeInsets.symmetric(horizontal: NtSpace.s, vertical: NtSpace.xs),
            title: Text(
              'This is my own voice. I agree that NeuraTalk can use these recordings to speak my translated words in my voice during my calls. I can delete it any time.',
              style: TextStyle(color: AppColors.ink, fontSize: 13.5, height: 1.4),
            ),
          ),
        ),
      ],
    ], Row(children: [
        if (_index > 0)
          Expanded(
            child: OutlinedButton(
              onPressed: _recording ? null : () => setState(() => _index -= 1),
              child: const Text('Back'),
            ),
          ),
        if (_index > 0) const SizedBox(width: NtSpace.m),
        Expanded(
          child: ElevatedButton(
            onPressed: !recorded || _recording || _busy || (last && !_consented)
                ? null
                : () async {
                    await _playerInstance?.stop();
                    if (last) {
                      await _submit();
                    } else {
                      setState(() {
                        _index += 1;
                        _playing = false;
                      });
                    }
                  },
            child: Text(last ? 'Create my voice' : 'Next'),
          ),
        ),
      ]));
  }

  Widget _status() {
    final p = _profile ?? const {};
    final training = p['trainingStatus']?.toString() ?? 'pending';
    final enabled = p['isEnabled'] == true;
    final rejected = p['moderationStatus'] == 'rejected';

    final (IconData icon, Color color, String title, String body) = switch (training) {
      _ when rejected => (Icons.block, AppColors.red, 'Your voice was turned off', 'NeuraTalk switched this voice off. Calls use a standard voice. Contact support if you think this is a mistake.'),
      'ready' when enabled => (Icons.check_circle, AppColors.green, 'Your calls use your voice', 'When you speak with someone in another language, they hear your words in your own voice.'),
      'ready' => (Icons.pause_circle_outline, AppColors.orange, 'Your voice is switched off', 'Calls use a standard voice until you turn it back on.'),
      'training' => (Icons.hourglass_top, AppColors.cyan, 'Creating your voice…', 'This takes 2 to 5 minutes. You can leave this screen; it keeps going.'),
      'failed' || 'pending_gpu' => (Icons.error_outline, AppColors.red, 'We couldn\'t create your voice', 'Record the passages again in a quiet place. Calls use a standard voice for now.'),
      _ => (Icons.mic_none, AppColors.cyan, 'Your voice isn\'t ready yet', 'Record the passages to create it.'),
    };

    return ListView(padding: const EdgeInsets.all(NtSpace.l), children: [
      NtCard(
        padding: const EdgeInsets.all(NtSpace.xl),
        child: Column(children: [
          Container(
            width: 64,
            height: 64,
            decoration: BoxDecoration(color: color.withValues(alpha: 0.12), shape: BoxShape.circle),
            child: training == 'training'
                ? Padding(padding: const EdgeInsets.all(18), child: CircularProgressIndicator(strokeWidth: 3, color: color))
                : Icon(icon, color: color, size: 34),
          ),
          const SizedBox(height: NtSpace.l),
          Text(title, textAlign: TextAlign.center, style: TextStyle(color: AppColors.ink, fontSize: 20, fontWeight: FontWeight.w800)),
          const SizedBox(height: NtSpace.s),
          Text(body, textAlign: TextAlign.center, style: TextStyle(color: AppColors.textSecondary, fontSize: 15, height: 1.45)),
        ]),
      ),
      if (training == 'ready' && !rejected) ...[
        const SizedBox(height: NtSpace.m),
        NtCard(
          child: SwitchListTile(
            value: enabled,
            onChanged: _busy ? null : _setEnabled,
            title: Text('Use my voice in calls', style: TextStyle(color: AppColors.ink, fontWeight: FontWeight.w600, fontSize: 16)),
            subtitle: Text('Turn off to use a standard voice', style: TextStyle(color: AppColors.textSecondary, fontSize: 13.5)),
          ),
        ),
      ],
      const SizedBox(height: NtSpace.xxl),
      if (training != 'training' && !rejected)
        OutlinedButton.icon(
          onPressed: _busy ? null : () => _deleteVoice(thenRecord: true),
          icon: const Icon(Icons.mic),
          label: const Text('Record again'),
        ),
      const SizedBox(height: NtSpace.s),
      TextButton.icon(
        onPressed: _busy ? null : () => _deleteVoice(thenRecord: false),
        icon: const Icon(Icons.delete_outline, color: AppColors.red),
        label: const Text('Delete my voice', style: TextStyle(color: AppColors.red)),
      ),
    ]);
  }
}
