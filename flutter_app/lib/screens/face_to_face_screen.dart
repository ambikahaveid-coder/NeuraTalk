import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:audioplayers/audioplayers.dart';
import 'package:flutter/material.dart';
import 'package:permission_handler/permission_handler.dart';
import 'package:provider/provider.dart';
import 'package:record/record.dart';

import '../providers/auth_provider.dart';
import '../services/api_service.dart';
import '../theme/app_theme.dart';

/// Two people, one phone: each taps their side and speaks; the phone shows
/// and speaks the translation. Streams 16 kHz PCM to /ws/face-to-face and
/// plays back the translated speech the server returns.
class FaceToFaceScreen extends StatefulWidget {
  const FaceToFaceScreen({super.key});

  @override
  State<FaceToFaceScreen> createState() => _FaceToFaceScreenState();
}

enum _Side { me, them }

class _Line {
  _Line(this.side);
  final _Side side;
  final List<String> finals = [];
  String partial = '';
  final List<String> translatedFinals = [];
  String translatedPartial = '';

  /// Finished sentences of this turn plus the one still being spoken.
  String get original => [...finals, if (partial.isNotEmpty) partial].join(' ');
  String get translated => [...translatedFinals, if (translatedPartial.isNotEmpty) translatedPartial].join(' ');
}

class _FaceToFaceScreenState extends State<FaceToFaceScreen> {
  static const int _frameBytes = 640; // 20 ms of 16 kHz mono PCM16

  final AudioRecorder _recorder = AudioRecorder();
  final AudioPlayer _player = AudioPlayer();
  final List<_Line> _lines = [];
  final List<Uint8List> _playQueue = [];
  final BytesBuilder _pcm = BytesBuilder(copy: false);
  final BytesBuilder _micRemainder = BytesBuilder(copy: false);

  List<Map<String, dynamic>> _languages = const [];
  String _myLanguage = 'te';
  String _theirLanguage = 'en';

  WebSocket? _ws;
  StreamSubscription<Uint8List>? _micSub;
  StreamSubscription<void>? _playerDoneSub;
  Timer? _flushTimer;
  _Side? _active;
  bool _connecting = false;
  bool _playing = false;
  DateTime _quietUntil = DateTime.fromMillisecondsSinceEpoch(0);
  String? _error;

  @override
  void initState() {
    super.initState();
    final profileLanguage = context.read<AuthProvider>().user?['preferredLanguage']?.toString();
    if (profileLanguage != null && profileLanguage.isNotEmpty) {
      _myLanguage = profileLanguage;
      _theirLanguage = profileLanguage == 'en' ? 'hi' : 'en';
    }
    _playerDoneSub = _player.onPlayerComplete.listen((_) => _playNext());
    _loadLanguages();
  }

  @override
  void dispose() {
    _flushTimer?.cancel();
    _micSub?.cancel();
    _playerDoneSub?.cancel();
    unawaited(_recorder.dispose());
    unawaited(_player.dispose());
    _ws?.close();
    super.dispose();
  }

  Future<void> _loadLanguages() async {
    try {
      final res = await ApiService.get('/api/group-chats/languages') as List;
      if (mounted) setState(() => _languages = res.cast<Map<String, dynamic>>());
    } catch (_) {
      // The pickers fall back to showing the language codes.
    }
  }

  String _languageName(String code) {
    for (final l in _languages) {
      if (l['code'] == code) return l['name']?.toString() ?? code;
    }
    return code.toUpperCase();
  }

  // ---------------------------------------------------------------- session

  Future<bool> _ensureConnected() async {
    if (_ws != null) return true;
    setState(() {
      _connecting = true;
      _error = null;
    });
    try {
      final mic = await Permission.microphone.request();
      if (!mic.isGranted) {
        throw const _F2FException('Microphone permission is needed to translate a conversation.');
      }
      final session = await ApiService.post('/api/face-to-face/session', {});
      final token = session['token'] as String?;
      final wsPath = session['wsPath'] as String? ?? '/ws/face-to-face';
      if (token == null) throw const _F2FException('Could not start face-to-face translation.');
      final wsBase = ApiService.baseUrl.replaceFirst(RegExp(r'^http'), 'ws');
      final sessionId = 'f2f-${DateTime.now().millisecondsSinceEpoch}';
      final ws = await WebSocket.connect(
        '$wsBase$wsPath?token=${Uri.encodeComponent(token)}&sessionId=$sessionId',
      );
      ws.listen(_onServerMessage, onDone: _onSocketClosed, onError: (_) => _onSocketClosed());
      _ws = ws;
      await _startMic();
      return true;
    } on ApiException catch (e) {
      _setError(e.statusCode == 402 ? 'You have no minutes left. Recharge to continue.' : e.message);
    } on _F2FException catch (e) {
      _setError(e.message);
    } catch (_) {
      _setError('Could not connect. Check your internet and try again.');
    } finally {
      if (mounted) setState(() => _connecting = false);
    }
    return false;
  }

  void _onSocketClosed() {
    _ws = null;
    unawaited(_micSub?.cancel());
    _micSub = null;
    unawaited(_recorder.stop());
    if (mounted && _active != null) {
      setState(() => _active = null);
      _setError('Connection closed. Tap a side to start again.');
    }
  }

  Future<void> _startMic() async {
    if (_micSub != null) return;
    final stream = await _recorder.startStream(const RecordConfig(
      encoder: AudioEncoder.pcm16bits,
      sampleRate: 16000,
      numChannels: 1,
      echoCancel: true,
      noiseSuppress: true,
      autoGain: true,
      androidConfig: AndroidRecordConfig(
        audioSource: AndroidAudioSource.voiceCommunication,
        speakerphone: true,
      ),
    ));
    _micSub = stream.listen(_onMicChunk);
  }

  /// Splits the recorder's chunks into the 20 ms frames the server expects.
  /// While the phone is speaking a translation (and briefly after), silence
  /// is sent instead so the translation isn't picked up and translated again.
  void _onMicChunk(Uint8List chunk) {
    final ws = _ws;
    if (ws == null || _active == null) return;
    _micRemainder.add(chunk);
    final all = _micRemainder.takeBytes();
    final usable = all.length - (all.length % _frameBytes);
    final muted = _playing || DateTime.now().isBefore(_quietUntil);
    for (var i = 0; i < usable; i += _frameBytes) {
      ws.add(muted ? Uint8List(_frameBytes) : Uint8List.sublistView(all, i, i + _frameBytes));
    }
    if (usable < all.length) _micRemainder.add(Uint8List.sublistView(all, usable));
  }

  Future<void> _selectSide(_Side side) async {
    if (_active == side) {
      _ws?.add(jsonEncode({'type': 'stop'}));
      setState(() => _active = null);
      return;
    }
    if (!await _ensureConnected()) return;
    final mine = side == _Side.me;
    _ws?.add(jsonEncode({
      'type': 'config',
      'speaker': mine ? 'person1' : 'person2',
      'sourceLanguage': mine ? _myLanguage : _theirLanguage,
      'targetLanguage': mine ? _theirLanguage : _myLanguage,
    }));
    _stopPlayback();
    setState(() => _active = side);
  }

  // ------------------------------------------------------------- incoming

  void _onServerMessage(dynamic raw) {
    if (raw is! String) return;
    Map<String, dynamic> msg;
    try {
      msg = jsonDecode(raw) as Map<String, dynamic>;
    } catch (_) {
      return;
    }
    switch (msg['type']) {
      case 'transcript.partial':
      case 'transcript.final':
        _updateLine(msg['speaker'], original: msg['text'] as String?, isFinal: msg['type'] == 'transcript.final');
        break;
      case 'translation.partial':
      case 'translation.final':
        _updateLine(msg['speaker'],
            translated: msg['translatedText'] as String?, isFinal: msg['type'] == 'translation.final');
        break;
      case 'audio':
        final data = msg['data'];
        if (data is String) _onAudioFrame(base64Decode(data));
        break;
      case 'interrupt':
        _stopPlayback();
        break;
      case 'error':
        final message = msg['message'] as String?;
        if (message != null && msg['code'] != null) _setError(message);
        break;
    }
  }

  void _updateLine(dynamic speaker, {String? original, String? translated, bool isFinal = false}) {
    final side = speaker == 'person2' ? _Side.them : _Side.me;
    if (!mounted) return;
    setState(() {
      var line = _lines.isNotEmpty && _lines.last.side == side ? _lines.last : null;
      if (line == null) {
        line = _Line(side);
        _lines.add(line);
      }
      final text = original?.trim() ?? '';
      if (text.isNotEmpty) {
        if (isFinal) {
          line.finals.add(text);
          line.partial = '';
        } else {
          line.partial = text;
        }
      }
      final translatedText = translated?.trim() ?? '';
      if (translatedText.isNotEmpty) {
        if (isFinal) {
          line.translatedFinals.add(translatedText);
          line.translatedPartial = '';
        } else {
          line.translatedPartial = translatedText;
        }
      }
    });
  }

  // Server streams 20 ms frames faster than real time; collect one sentence
  // and play it once the frames pause.
  void _onAudioFrame(Uint8List frame) {
    _pcm.add(frame);
    _flushTimer?.cancel();
    _flushTimer = Timer(const Duration(milliseconds: 250), () {
      final pcm = _pcm.takeBytes();
      if (pcm.isEmpty) return;
      _playQueue.add(_wav(pcm));
      if (!_playing) _playNext();
    });
  }

  Future<void> _playNext() async {
    if (_playQueue.isEmpty) {
      _quietUntil = DateTime.now().add(const Duration(milliseconds: 400));
      if (mounted) setState(() => _playing = false);
      return;
    }
    if (mounted) setState(() => _playing = true);
    final next = _playQueue.removeAt(0);
    try {
      await _player.play(BytesSource(next, mimeType: 'audio/wav'));
    } catch (_) {
      unawaited(_playNext());
    }
  }

  void _stopPlayback() {
    _flushTimer?.cancel();
    _pcm.takeBytes();
    _playQueue.clear();
    unawaited(_player.stop());
    if (mounted && _playing) setState(() => _playing = false);
  }

  static Uint8List _wav(Uint8List pcm) {
    final header = ByteData(44);
    void ascii(int offset, String s) {
      for (var i = 0; i < s.length; i++) {
        header.setUint8(offset + i, s.codeUnitAt(i));
      }
    }
    ascii(0, 'RIFF');
    header.setUint32(4, 36 + pcm.length, Endian.little);
    ascii(8, 'WAVEfmt ');
    header.setUint32(16, 16, Endian.little);
    header.setUint16(20, 1, Endian.little);
    header.setUint16(22, 1, Endian.little);
    header.setUint32(24, 16000, Endian.little);
    header.setUint32(28, 32000, Endian.little);
    header.setUint16(32, 2, Endian.little);
    header.setUint16(34, 16, Endian.little);
    ascii(36, 'data');
    header.setUint32(40, pcm.length, Endian.little);
    return (BytesBuilder(copy: false)
          ..add(header.buffer.asUint8List())
          ..add(pcm))
        .takeBytes();
  }

  void _setError(String message) {
    if (mounted) setState(() => _error = message);
  }

  // ------------------------------------------------------------------- UI

  Future<void> _pickLanguage(_Side side) async {
    if (_active != null) return;
    final picked = await showModalBottomSheet<String>(
      context: context,
      showDragHandle: true,
      builder: (_) => SafeArea(
        child: ListView(
          shrinkWrap: true,
          children: [
            for (final l in _languages)
              ListTile(
                title: Text(l['name']?.toString() ?? ''),
                trailing: (side == _Side.me ? _myLanguage : _theirLanguage) == l['code']
                    ? const Icon(Icons.check, color: AppColors.cyan)
                    : null,
                onTap: () => Navigator.pop(context, l['code']?.toString()),
              ),
          ],
        ),
      ),
    );
    if (picked == null) return;
    setState(() => side == _Side.me ? _myLanguage = picked : _theirLanguage = picked);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.backgroundMid,
      appBar: AppBar(title: const Text('Face to face')),
      body: SafeArea(
        child: Column(
          children: [
            _languageBar(),
            if (_error != null)
              Container(
                width: double.infinity,
                margin: const EdgeInsets.fromLTRB(16, 4, 16, 0),
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  color: AppColors.red.withValues(alpha: 0.08),
                  borderRadius: BorderRadius.circular(12),
                ),
                child: Text(_error!, style: const TextStyle(color: AppColors.red)),
              ),
            Expanded(child: _conversation()),
            _statusLine(),
            _sideButtons(),
          ],
        ),
      ),
    );
  }

  Widget _languageBar() {
    Widget chip(_Side side) {
      final code = side == _Side.me ? _myLanguage : _theirLanguage;
      return Expanded(
        child: InkWell(
          borderRadius: BorderRadius.circular(14),
          onTap: () => _pickLanguage(side),
          child: Container(
            padding: const EdgeInsets.symmetric(vertical: 12, horizontal: 14),
            decoration: BoxDecoration(
              color: AppColors.surface,
              borderRadius: BorderRadius.circular(14),
              border: Border.all(color: AppColors.border),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(side == _Side.me ? 'You speak' : 'They speak',
                    style: const TextStyle(fontSize: 12, color: AppColors.textMuted)),
                const SizedBox(height: 2),
                Text(_languageName(code),
                    style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w600, color: AppColors.textPrimary)),
              ],
            ),
          ),
        ),
      );
    }

    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 12, 16, 8),
      child: Row(
        children: [
          chip(_Side.me),
          IconButton(
            tooltip: 'Swap languages',
            onPressed: _active != null
                ? null
                : () => setState(() {
                      final t = _myLanguage;
                      _myLanguage = _theirLanguage;
                      _theirLanguage = t;
                    }),
            icon: const Icon(Icons.swap_horiz, color: AppColors.cyan),
          ),
          chip(_Side.them),
        ],
      ),
    );
  }

  Widget _conversation() {
    if (_lines.isEmpty) {
      return const Center(
        child: Padding(
          padding: EdgeInsets.all(32),
          child: Text(
            'Tap your side and speak.\nThe phone will say it in the other language.',
            textAlign: TextAlign.center,
            style: TextStyle(fontSize: 16, color: AppColors.textSecondary, height: 1.4),
          ),
        ),
      );
    }
    return ListView.builder(
      reverse: true,
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
      itemCount: _lines.length,
      itemBuilder: (_, i) {
        final line = _lines[_lines.length - 1 - i];
        final mine = line.side == _Side.me;
        final original = line.original;
        return Align(
          alignment: mine ? Alignment.centerRight : Alignment.centerLeft,
          child: Container(
            constraints: BoxConstraints(maxWidth: MediaQuery.of(context).size.width * 0.82),
            margin: const EdgeInsets.symmetric(vertical: 6),
            padding: const EdgeInsets.all(14),
            decoration: BoxDecoration(
              color: mine ? AppColors.cyan : AppColors.surface,
              borderRadius: BorderRadius.circular(16),
              border: mine ? null : Border.all(color: AppColors.border),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                if (line.translated.isNotEmpty)
                  Text(line.translated,
                      style: TextStyle(
                          fontSize: 19,
                          fontWeight: FontWeight.w600,
                          height: 1.3,
                          color: mine ? AppColors.onAccent : AppColors.textPrimary)),
                if (original.isNotEmpty) ...[
                  if (line.translated.isNotEmpty) const SizedBox(height: 6),
                  Text(original,
                      style: TextStyle(
                          fontSize: 14,
                          color: mine ? AppColors.onAccent.withValues(alpha: 0.85) : AppColors.textSecondary)),
                ],
              ],
            ),
          ),
        );
      },
    );
  }

  Widget _statusLine() {
    final String text;
    if (_connecting) {
      text = 'Connecting…';
    } else if (_playing) {
      text = 'Speaking the translation…';
    } else if (_active == _Side.me) {
      text = 'Listening to you in ${_languageName(_myLanguage)}';
    } else if (_active == _Side.them) {
      text = 'Listening to them in ${_languageName(_theirLanguage)}';
    } else {
      text = '';
    }
    return SizedBox(
      height: 28,
      child: Center(child: Text(text, style: const TextStyle(color: AppColors.textSecondary))),
    );
  }

  Widget _sideButtons() {
    Widget button(_Side side) {
      final active = _active == side;
      final language = _languageName(side == _Side.me ? _myLanguage : _theirLanguage);
      return Expanded(
        child: SizedBox(
          height: 96,
          child: FilledButton(
            style: FilledButton.styleFrom(
              backgroundColor: active ? AppColors.cyan : AppColors.surface,
              foregroundColor: active ? AppColors.onAccent : AppColors.textPrimary,
              side: BorderSide(color: active ? AppColors.cyan : AppColors.borderBright),
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
            ),
            onPressed: _connecting ? null : () => _selectSide(side),
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Icon(active ? Icons.mic : Icons.mic_none, size: 30),
                const SizedBox(height: 6),
                Text(side == _Side.me ? 'Me · $language' : 'Them · $language',
                    textAlign: TextAlign.center,
                    style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w600)),
              ],
            ),
          ),
        ),
      );
    }

    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 4, 16, 16),
      child: Row(children: [button(_Side.me), const SizedBox(width: 12), button(_Side.them)]),
    );
  }
}

class _F2FException implements Exception {
  const _F2FException(this.message);
  final String message;
}
