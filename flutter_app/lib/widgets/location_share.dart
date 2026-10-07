import 'dart:math' as math;
import 'package:flutter/material.dart';
import 'package:geocoding/geocoding.dart';
import 'package:geolocator/geolocator.dart';
import 'package:url_launcher/url_launcher.dart';
import '../theme/app_theme.dart';

/// Turns coordinates into a short, human address ("Banjara Hills, Hyderabad").
/// Uses the phone's own geocoder; returns null when offline or unknown.
Future<String?> shortAddressFor(double lat, double lng) async {
  try {
    final places = await Geocoding().placemarkFromCoordinates(lat, lng).timeout(const Duration(seconds: 6));
    if (places.isEmpty) return null;
    final p = places.first;
    final parts = <String>[];
    void add(String? s) {
      final v = s?.trim() ?? '';
      if (v.isNotEmpty && !parts.contains(v) && !RegExp(r'^[0-9A-Z]{4}\+').hasMatch(v)) parts.add(v);
    }
    add(p.subLocality);
    add(p.locality);
    if (parts.isEmpty) add(p.street);
    if (parts.length < 2) add(p.administrativeArea);
    return parts.isEmpty ? null : parts.take(2).join(', ');
  } catch (_) {
    return null;
  }
}

Future<void> openInMaps(BuildContext context, double lat, double lng) async {
  final ok = await launchUrl(Uri.parse('https://www.google.com/maps/search/?api=1&query=$lat,$lng'), mode: LaunchMode.externalApplication)
      .catchError((_) => false);
  if (!ok && context.mounted) {
    ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text("Couldn't open Maps.")));
  }
}

(double, double)? parseGeo(String url) {
  final parts = url.replaceFirst('geo:', '').split(',');
  if (parts.length < 2) return null;
  final lat = double.tryParse(parts[0].trim());
  final lng = double.tryParse(parts[1].trim());
  return lat == null || lng == null ? null : (lat, lng);
}

/// "Share location" sheet: finds you, shows the address and accuracy, and
/// sends only when you tap Send. Nothing is shared before that.
Future<void> showShareLocationSheet(
  BuildContext context, {
  required Future<void> Function(double lat, double lng, String? address) onSend,
}) {
  return showModalBottomSheet(
    context: context,
    showDragHandle: true,
    isScrollControlled: true,
    builder: (_) => _ShareLocationSheet(onSend: onSend),
  );
}

class _ShareLocationSheet extends StatefulWidget {
  final Future<void> Function(double lat, double lng, String? address) onSend;
  const _ShareLocationSheet({required this.onSend});

  @override
  State<_ShareLocationSheet> createState() => _ShareLocationSheetState();
}

class _ShareLocationSheetState extends State<_ShareLocationSheet> {
  Position? _pos;
  String? _address;
  String? _error;
  bool _openSettings = false;
  bool _sending = false;

  @override
  void initState() {
    super.initState();
    _locate();
  }

  Future<void> _locate() async {
    setState(() {
      _error = null;
      _openSettings = false;
      _pos = null;
      _address = null;
    });
    try {
      var permission = await Geolocator.checkPermission();
      if (permission == LocationPermission.denied) permission = await Geolocator.requestPermission();
      if (permission == LocationPermission.denied || permission == LocationPermission.deniedForever) {
        setState(() {
          _error = 'NeuraTalk needs location permission to share where you are.';
          _openSettings = permission == LocationPermission.deniedForever;
        });
        return;
      }
      if (!await Geolocator.isLocationServiceEnabled()) {
        setState(() => _error = 'Turn on location (GPS) on your phone, then try again.');
        return;
      }
      final pos = await Geolocator.getCurrentPosition(
        locationSettings: const LocationSettings(accuracy: LocationAccuracy.high, timeLimit: Duration(seconds: 15)),
      );
      if (!mounted) return;
      setState(() => _pos = pos);
      final address = await shortAddressFor(pos.latitude, pos.longitude);
      if (mounted) setState(() => _address = address);
    } catch (_) {
      if (mounted) setState(() => _error = "Couldn't find your location. Move near a window and try again.");
    }
  }

  Future<void> _send() async {
    final pos = _pos;
    if (pos == null) return;
    setState(() => _sending = true);
    try {
      await widget.onSend(pos.latitude, pos.longitude, _address);
      if (mounted) Navigator.pop(context);
    } catch (_) {
      if (mounted) {
        setState(() => _sending = false);
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text("Couldn't send your location. Try again.")));
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final pos = _pos;
    return SafeArea(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(20, 0, 20, 20),
        child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          Text('Share location', style: TextStyle(color: AppColors.ink, fontSize: 20, fontWeight: FontWeight.w800)),
          const SizedBox(height: 4),
          Text('Only this chat sees it. You can open it in Google Maps.',
              style: TextStyle(color: AppColors.textSecondary, fontSize: 14)),
          const SizedBox(height: 16),
          ClipRRect(
            borderRadius: BorderRadius.circular(18),
            child: SizedBox(
              height: 170,
              child: MapPreview(lat: pos?.latitude ?? 17.385, lng: pos?.longitude ?? 78.486, loading: pos == null && _error == null),
            ),
          ),
          const SizedBox(height: 16),
          if (_error != null) ...[
            Row(children: [
              Icon(Icons.location_off_outlined, color: AppColors.red),
              const SizedBox(width: 10),
              Expanded(child: Text(_error!, style: TextStyle(color: AppColors.ink, fontSize: 15, height: 1.4))),
            ]),
            const SizedBox(height: 16),
            ElevatedButton(
              onPressed: _openSettings ? Geolocator.openAppSettings : _locate,
              child: Text(_openSettings ? 'Open phone settings' : 'Try again'),
            ),
          ] else ...[
            Row(children: [
              Container(
                width: 44,
                height: 44,
                decoration: BoxDecoration(color: AppColors.green.withValues(alpha: 0.14), shape: BoxShape.circle),
                child: const Icon(Icons.my_location, color: AppColors.green, size: 22),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Text(pos == null ? 'Finding you…' : (_address ?? 'Your current location'),
                      maxLines: 2, overflow: TextOverflow.ellipsis,
                      style: TextStyle(color: AppColors.ink, fontSize: 16, fontWeight: FontWeight.w700)),
                  const SizedBox(height: 2),
                  Text(pos == null ? 'Using GPS' : 'Accurate to about ${pos.accuracy.round()} m',
                      style: TextStyle(color: AppColors.textSecondary, fontSize: 13.5)),
                ]),
              ),
              if (pos != null)
                IconButton(tooltip: 'Find me again', onPressed: _locate, icon: Icon(Icons.refresh, color: AppColors.textMuted)),
            ]),
            const SizedBox(height: 18),
            ElevatedButton.icon(
              onPressed: pos == null || _sending ? null : _send,
              icon: _sending
                  ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                  : const Icon(Icons.send_rounded, size: 20),
              label: const Text('Send current location'),
            ),
          ],
        ]),
      ),
    );
  }
}

/// Location message in a chat: map card, place name, one tap opens Google Maps.
class ChatLocationAttachment extends StatelessWidget {
  final String geo;
  final String? title;
  const ChatLocationAttachment({super.key, required this.geo, this.title});

  @override
  Widget build(BuildContext context) {
    final coords = parseGeo(geo);
    final name = (title == null || title == 'My Location' || title == 'Location') ? 'Shared location' : title!;
    return Material(
      color: AppColors.surface,
      borderRadius: BorderRadius.circular(14),
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: coords == null ? null : () => openInMaps(context, coords.$1, coords.$2),
        child: SizedBox(
          width: 250,
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, mainAxisSize: MainAxisSize.min, children: [
            SizedBox(height: 120, child: MapPreview(lat: coords?.$1 ?? 0, lng: coords?.$2 ?? 0)),
            Padding(
              padding: const EdgeInsets.fromLTRB(12, 10, 12, 10),
              child: Row(children: [
                Expanded(
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Text(name, maxLines: 2, overflow: TextOverflow.ellipsis,
                        style: TextStyle(color: AppColors.ink, fontSize: 15, fontWeight: FontWeight.w700)),
                    const SizedBox(height: 2),
                    Text('Open in Google Maps', style: TextStyle(color: AppColors.cyan, fontSize: 13, fontWeight: FontWeight.w600)),
                  ]),
                ),
                Icon(Icons.open_in_new, size: 18, color: AppColors.cyan),
              ]),
            ),
          ]),
        ),
      ),
    );
  }
}

/// Drawn map-style backdrop with a pin. It is an illustration (no map tiles,
/// no API key); the real place opens in Google Maps.
class MapPreview extends StatelessWidget {
  final double lat;
  final double lng;
  final bool loading;
  const MapPreview({super.key, required this.lat, required this.lng, this.loading = false});

  @override
  Widget build(BuildContext context) {
    return Stack(fit: StackFit.expand, children: [
      CustomPaint(painter: _MapPainter(seed: (lat * 1000).round() ^ (lng * 1000).round(), dark: AppColors.isDark)),
      Center(
        child: loading
            ? SizedBox(width: 28, height: 28, child: CircularProgressIndicator(strokeWidth: 3, color: AppColors.cyan))
            : Column(mainAxisSize: MainAxisSize.min, children: [
                Container(
                  width: 34,
                  height: 34,
                  decoration: BoxDecoration(
                    color: const Color(0xFFE5484D),
                    shape: BoxShape.circle,
                    border: Border.all(color: Colors.white, width: 3),
                  ),
                  child: const Icon(Icons.person_pin, color: Colors.white, size: 16),
                ),
                Container(width: 3, height: 10, color: const Color(0xFFE5484D)),
                Container(
                  width: 14,
                  height: 5,
                  decoration: BoxDecoration(color: Colors.black.withValues(alpha: 0.18), borderRadius: BorderRadius.circular(4)),
                ),
              ]),
      ),
    ]);
  }
}

class _MapPainter extends CustomPainter {
  final int seed;
  final bool dark;
  _MapPainter({required this.seed, required this.dark});

  @override
  void paint(Canvas canvas, Size size) {
    final rnd = math.Random(seed);
    final land = dark ? const Color(0xFF1B2540) : const Color(0xFFEFF2E9);
    final block = dark ? const Color(0xFF222E4D) : const Color(0xFFE4E8DC);
    final park = dark ? const Color(0xFF1E3B33) : const Color(0xFFCFE8C9);
    final water = dark ? const Color(0xFF1D3557) : const Color(0xFFBFDDF5);
    final road = dark ? const Color(0xFF3A4A70) : Colors.white;
    final major = dark ? const Color(0xFF6B5A2E) : const Color(0xFFFCE7A8);

    canvas.drawRect(Offset.zero & size, Paint()..color = land);
    // City blocks.
    final b = Paint()..color = block;
    for (var i = 0; i < 14; i++) {
      final w = 24 + rnd.nextDouble() * 50, h = 18 + rnd.nextDouble() * 34;
      canvas.drawRRect(
          RRect.fromRectAndRadius(Rect.fromLTWH(rnd.nextDouble() * size.width, rnd.nextDouble() * size.height, w, h), const Radius.circular(3)), b);
    }
    // A park and some water.
    canvas.drawOval(Rect.fromLTWH(size.width * (0.05 + rnd.nextDouble() * 0.5), size.height * rnd.nextDouble() * 0.6, 70, 46), Paint()..color = park);
    final wp = Path()
      ..moveTo(size.width, size.height * (0.55 + rnd.nextDouble() * 0.2))
      ..quadraticBezierTo(size.width * 0.75, size.height * 0.8, size.width * 0.82, size.height)
      ..lineTo(size.width, size.height)
      ..close();
    canvas.drawPath(wp, Paint()..color = water);
    // Streets.
    final minor = Paint()
      ..color = road
      ..strokeWidth = 5
      ..strokeCap = StrokeCap.round;
    for (var i = 0; i < 5; i++) {
      final y = size.height * (i + 0.5) / 5 + rnd.nextDouble() * 8;
      canvas.drawLine(Offset(0, y), Offset(size.width, y + (rnd.nextDouble() - 0.5) * 30), minor);
    }
    for (var i = 0; i < 6; i++) {
      final x = size.width * (i + 0.5) / 6 + rnd.nextDouble() * 10;
      canvas.drawLine(Offset(x, 0), Offset(x + (rnd.nextDouble() - 0.5) * 30, size.height), minor);
    }
    final main = Paint()
      ..color = major
      ..strokeWidth = 9
      ..strokeCap = StrokeCap.round;
    canvas.drawLine(Offset(0, size.height * (0.2 + rnd.nextDouble() * 0.6)), Offset(size.width, size.height * (0.2 + rnd.nextDouble() * 0.6)), main);
  }

  @override
  bool shouldRepaint(_MapPainter old) => old.seed != seed || old.dark != dark;
}
