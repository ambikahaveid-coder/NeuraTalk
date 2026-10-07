import 'dart:convert';
import 'dart:io';
import 'package:audioplayers/audioplayers.dart';
import 'package:flutter/foundation.dart';
import 'package:path_provider/path_provider.dart';
import 'api_service.dart';

/// "Listen": reads a message aloud in its language (POST /api/audio/speech,
/// the same voices the app uses on calls). One clip plays at a time; clips are
/// cached so tapping again is instant.
class SpeechService extends ChangeNotifier {
  SpeechService._();
  static final SpeechService instance = SpeechService._();

  final AudioPlayer _player = AudioPlayer();
  final Map<String, String> _cache = {};

  /// Key of the clip currently loading or playing (null when idle).
  String? activeKey;
  bool loading = false;

  static String keyFor(String text, String language) => '$language:${text.hashCode}';

  Future<void> toggle(String text, String language) async {
    final key = keyFor(text, language);
    if (activeKey == key) {
      await stop();
      return;
    }
    await _player.stop();
    activeKey = key;
    loading = true;
    notifyListeners();
    try {
      var path = _cache[key];
      if (path == null || !await File(path).exists()) {
        final res = await ApiService.post('/api/audio/speech', {'text': text, 'language': language});
        final audio = base64Decode(res['audio'] as String);
        final dir = await getTemporaryDirectory();
        path = '${dir.path}/speak_${key.replaceAll(RegExp(r'[^a-z0-9-]'), '_')}.mp3';
        await File(path).writeAsBytes(audio);
        _cache[key] = path;
      }
      if (activeKey != key) return; // the user tapped something else meanwhile
      loading = false;
      notifyListeners();
      await _player.play(DeviceFileSource(path));
      await _player.onPlayerComplete.first;
    } catch (_) {
      // Leave it silent; the text is still on screen.
    } finally {
      if (activeKey == key) {
        activeKey = null;
        loading = false;
        notifyListeners();
      }
    }
  }

  Future<void> stop() async {
    activeKey = null;
    loading = false;
    notifyListeners();
    await _player.stop();
  }
}
