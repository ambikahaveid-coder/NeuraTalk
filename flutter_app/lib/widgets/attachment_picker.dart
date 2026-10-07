import 'dart:io';
import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';
import 'package:permission_handler/permission_handler.dart';
import '../services/media_store.dart';
import '../theme/app_theme.dart';

/// Gallery / Camera / Video / Document picker sheet. Returns the chosen files
/// (already checked against the size limit and blocked types), or an empty list.
class AttachmentPicker {
  static const maxItems = 10;

  /// [onLocation] adds a Location tile; it runs instead of picking files.
  static Future<List<(File, String)>> show(BuildContext context, {VoidCallback? onLocation}) async {
    final choice = await showModalBottomSheet<String>(
      context: context,
      showDragHandle: true,
      builder: (sheet) {
        Widget item(String id, IconData icon, String label, Color color) => InkWell(
              borderRadius: BorderRadius.circular(16),
              onTap: () => Navigator.pop(sheet, id),
              child: Padding(
                padding: const EdgeInsets.symmetric(vertical: 10),
                child: Column(mainAxisSize: MainAxisSize.min, children: [
                  Container(
                    width: 60,
                    height: 60,
                    decoration: BoxDecoration(
                      color: color.withValues(alpha: AppColors.isDark ? 0.22 : 0.12),
                      borderRadius: BorderRadius.circular(18),
                    ),
                    child: Icon(icon, color: color, size: 28),
                  ),
                  const SizedBox(height: 8),
                  Text(label, style: TextStyle(color: AppColors.ink, fontSize: 13.5, fontWeight: FontWeight.w500)),
                ]),
              ),
            );
        return SafeArea(
          child: Padding(
            padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
            child: GridView.count(
              crossAxisCount: 3,
              shrinkWrap: true,
              physics: const NeverScrollableScrollPhysics(),
              children: [
                item('gallery', Icons.photo_library, 'Gallery', const Color(0xFF7C3AED)),
                item('camera', Icons.photo_camera, 'Camera', const Color(0xFFDB2777)),
                item('video', Icons.videocam, 'Video', const Color(0xFFEA580C)),
                item('document', Icons.insert_drive_file, 'Document', const Color(0xFF2563EB)),
                if (onLocation != null) item('location', Icons.location_on, 'Location', const Color(0xFF16A34A)),
              ],
            ),
          ),
        );
      },
    );
    if (choice == null || !context.mounted) return const [];
    if (choice == 'location') {
      onLocation?.call();
      return const [];
    }

    List<(File, String)> picked = const [];
    try {
      switch (choice) {
        case 'gallery':
          if ((await Permission.photos.status).isPermanentlyDenied) {
            _toast(context, 'Photo access is turned off for NeuraTalk. Turn it on in Settings > Apps > NeuraTalk > Permissions.');
            return const [];
          }
          final media = await ImagePicker().pickMultipleMedia(limit: maxItems);
          picked = [for (final x in media) (File(x.path), _nameOf(x))];
        case 'camera':
          final x = await ImagePicker().pickImage(source: ImageSource.camera, imageQuality: 88, maxWidth: 2560);
          if (x != null) picked = [(File(x.path), _nameOf(x))];
        case 'video':
          final x = await ImagePicker().pickVideo(source: ImageSource.camera, maxDuration: const Duration(minutes: 5));
          if (x != null) picked = [(File(x.path), _nameOf(x))];
        case 'document':
          final result = await FilePicker.platform.pickFiles(allowMultiple: true, withData: false);
          picked = [
            for (final f in (result?.files ?? const <PlatformFile>[]))
              if (f.path != null) (File(f.path!), f.name),
          ];
      }
    } catch (_) {
      if (context.mounted) _toast(context, 'Could not open ${choice == 'document' ? 'your files' : choice == 'gallery' ? 'your gallery' : 'the camera'}.');
      return const [];
    }

    final ok = <(File, String)>[];
    for (final (file, name) in picked.take(maxItems)) {
      if (MediaStore.isBlocked(name)) {
        if (context.mounted) _toast(context, '"$name" can\'t be sent: apps and scripts are blocked for safety.');
        continue;
      }
      final size = await file.length();
      if (size == 0) continue;
      if (size > MediaStore.maxUploadBytes) {
        if (context.mounted) {
          _toast(context, '"$name" is ${MediaStore.formatSize(size)}. The limit is ${MediaStore.formatSize(MediaStore.maxUploadBytes)}.');
        }
        continue;
      }
      ok.add((file, name));
    }
    return ok;
  }

  static String _nameOf(XFile x) {
    final name = x.name.isNotEmpty ? x.name : x.path.split(Platform.pathSeparator).last;
    return name.contains('.') ? name : '$name.jpg';
  }

  static void _toast(BuildContext context, String text) =>
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(text)));
}
