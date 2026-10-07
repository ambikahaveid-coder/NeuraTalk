import 'dart:async';
import 'dart:io';
import 'package:http/http.dart' as http;
import 'package:path_provider/path_provider.dart';
import 'api_service.dart';

/// What kind of attachment a file is, for choosing the bubble and the picker.
enum MediaKind { image, video, audio, document }

/// Chat attachments: file types, signed-in downloads with an on-device cache,
/// and streamed uploads.
///
/// Attachments are private on the server (only the two people in the chat can
/// read them), so every download must carry the user's session token. Plain
/// `Image.network(url)` / opening the URL in a browser does not, and gets 403.
class MediaStore {
  /// Must match MAX_UPLOAD_SIZE_BYTES in server/ai_integrations/object_storage/routes.ts.
  static const maxUploadBytes = 200 * 1024 * 1024;

  static const _types = <String, String>{
    // images
    'jpg': 'image/jpeg', 'jpeg': 'image/jpeg', 'png': 'image/png', 'webp': 'image/webp', 'gif': 'image/gif',
    'heic': 'image/heic', 'heif': 'image/heif', 'bmp': 'image/bmp',
    // video
    'mp4': 'video/mp4', 'm4v': 'video/mp4', 'mov': 'video/quicktime', 'webm': 'video/webm', '3gp': 'video/3gpp',
    'mkv': 'video/x-matroska', 'avi': 'video/x-msvideo', 'mpeg': 'video/mpeg', 'mpg': 'video/mpeg',
    // audio
    'mp3': 'audio/mpeg', 'm4a': 'audio/mp4', 'aac': 'audio/aac', 'wav': 'audio/wav', 'ogg': 'audio/ogg',
    'opus': 'audio/opus', 'amr': 'audio/amr', 'flac': 'audio/flac',
    // documents
    'pdf': 'application/pdf', 'txt': 'text/plain', 'csv': 'text/csv', 'rtf': 'application/rtf', 'json': 'application/json',
    'doc': 'application/msword', 'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'xls': 'application/vnd.ms-excel', 'xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'ppt': 'application/vnd.ms-powerpoint', 'pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'odt': 'application/vnd.oasis.opendocument.text', 'ods': 'application/vnd.oasis.opendocument.spreadsheet',
    'odp': 'application/vnd.oasis.opendocument.presentation', 'epub': 'application/epub+zip',
    // archives
    'zip': 'application/zip', '7z': 'application/x-7z-compressed', 'rar': 'application/vnd.rar',
    'gz': 'application/gzip', 'tar': 'application/x-tar',
  };

  /// Files that run code when opened — refused by the server too
  /// (BLOCKED_UPLOAD_EXTENSIONS in routes.ts).
  static const _blocked = {
    'exe', 'msi', 'bat', 'cmd', 'com', 'scr', 'pif', 'cpl', 'vbs', 'vbe', 'js', 'jse', 'wsf', 'wsh', 'ps1', 'psm1',
    'hta', 'jar', 'apk', 'aab', 'xapk', 'dll', 'sys', 'reg', 'lnk', 'html', 'htm', 'xhtml', 'svg', 'svgz', 'sh',
    'app', 'dmg', 'deb', 'rpm',
  };

  static String extensionOf(String name) {
    final dot = name.lastIndexOf('.');
    return dot < 0 ? '' : name.substring(dot + 1).toLowerCase();
  }

  /// Any other file type is still sent, as a generic document.
  static String contentTypeFor(String name) => _types[extensionOf(name)] ?? 'application/octet-stream';

  static bool isBlocked(String name) => _blocked.contains(extensionOf(name));

  static MediaKind kindOf(String name, {String? mime}) {
    final type = mime ?? contentTypeFor(name);
    if (type.startsWith('image/')) return MediaKind.image;
    if (type.startsWith('video/')) return MediaKind.video;
    if (type.startsWith('audio/')) return MediaKind.audio;
    return MediaKind.document;
  }

  /// "2.4 MB", "830 KB".
  static String formatSize(num? bytes) {
    if (bytes == null || bytes <= 0) return '';
    if (bytes < 1024) return '$bytes B';
    if (bytes < 1024 * 1024) return '${(bytes / 1024).round()} KB';
    final mb = bytes / (1024 * 1024);
    return '${mb >= 10 ? mb.round() : mb.toStringAsFixed(1)} MB';
  }

  /// Headers for loading a private attachment (images, video streaming).
  static Map<String, String> get authHeaders =>
      {if (ApiService.token != null) 'Authorization': 'Bearer ${ApiService.token}'};

  static String urlFor(String objectPath) => '${ApiService.baseUrl}$objectPath';

  static Future<Directory> _cacheDir() async {
    final dir = Directory('${(await getApplicationSupportDirectory()).path}/chat_media');
    if (!await dir.exists()) await dir.create(recursive: true);
    return dir;
  }

  static Future<File> _cacheFileFor(String objectPath, String name) async {
    final dir = await _cacheDir();
    // Object paths end in a unique id ("/objects/uploads/<uuid>").
    final id = objectPath.split('/').last.replaceAll(RegExp(r'[^A-Za-z0-9-]'), '');
    // Keep the real file name so "Open with" apps show it and pick the right viewer.
    final safe = name.replaceAll(RegExp(r'[\\/:*?"<>|\n\r]'), '_');
    return File('${dir.path}/${id}_$safe');
  }

  /// The cached copy if it was already downloaded, else null.
  static Future<File?> cached(String objectPath, String name) async {
    final f = await _cacheFileFor(objectPath, name);
    return await f.exists() && await f.length() > 0 ? f : null;
  }

  static final Map<String, Future<File>> _inFlight = {};

  /// Downloads an attachment once (signed in) and returns the local file.
  /// Concurrent calls for the same file share one download.
  static Future<File> download(String objectPath, String name, {void Function(double progress)? onProgress}) {
    return _inFlight[objectPath] ??= _download(objectPath, name, onProgress).whenComplete(() => _inFlight.remove(objectPath));
  }

  static Future<File> _download(String objectPath, String name, void Function(double)? onProgress) async {
    final existing = await cached(objectPath, name);
    if (existing != null) {
      onProgress?.call(1);
      return existing;
    }
    final target = await _cacheFileFor(objectPath, name);
    final partial = File('${target.path}.part');
    final client = http.Client();
    try {
      final request = http.Request('GET', Uri.parse(urlFor(objectPath)))..headers.addAll(authHeaders);
      final res = await client.send(request).timeout(const Duration(seconds: 30));
      if (res.statusCode != 200) {
        throw ApiException(res.statusCode == 403 ? 'You no longer have access to this file.' : 'Download failed', res.statusCode);
      }
      final total = res.contentLength ?? 0;
      var received = 0;
      final sink = partial.openWrite();
      try {
        await for (final chunk in res.stream.timeout(const Duration(seconds: 60))) {
          sink.add(chunk);
          received += chunk.length;
          if (total > 0) onProgress?.call(received / total);
        }
      } finally {
        await sink.close();
      }
      await partial.rename(target.path);
      onProgress?.call(1);
      return target;
    } catch (_) {
      if (await partial.exists()) await partial.delete();
      rethrow;
    } finally {
      client.close();
    }
  }

  /// Asks the server for an upload slot, then streams [file] straight to
  /// storage (never fully in memory). Returns the attachment path to send.
  static Future<String> upload(
    File file,
    String name, {
    void Function(double progress)? onProgress,
    UploadCancelToken? cancelToken,
  }) async {
    final size = await file.length();
    final contentType = contentTypeFor(name);
    final info = await ApiService.post('/api/uploads/request-url', {'name': name, 'size': size, 'contentType': contentType});
    final client = http.Client();
    try {
      final request = http.StreamedRequest('PUT', Uri.parse(info['uploadURL'] as String))
        ..headers['Content-Type'] = contentType
        ..contentLength = size;
      var sent = 0;
      unawaited(() async {
        try {
          await for (final chunk in file.openRead()) {
            if (cancelToken?.cancelled == true) break;
            request.sink.add(chunk);
            sent += chunk.length;
            onProgress?.call(sent / size);
            await Future<void>.delayed(Duration.zero);
          }
        } finally {
          await request.sink.close();
        }
      }());
      final response = await client.send(request).timeout(const Duration(minutes: 20));
      final body = await response.stream.bytesToString();
      if (cancelToken?.cancelled == true) throw ApiException('Upload cancelled', 0);
      if (response.statusCode >= 400) throw ApiException('Upload failed (${response.statusCode}) $body'.trim(), response.statusCode);
      return info['objectPath'] as String;
    } finally {
      client.close();
    }
  }
}
