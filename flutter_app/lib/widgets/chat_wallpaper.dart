import 'dart:math' as math;
import 'package:flutter/material.dart';
import '../theme/app_theme.dart';
import '../services/api_service.dart';

/// Chat wallpapers (server/chat-parity.ts): a default plus one per chat,
/// stored on the server so every device shows the same.
/// Keys: "default", "personal:<threadId>", "group:<groupId>".
class WallpaperStore extends ChangeNotifier {
  WallpaperStore._();
  static final WallpaperStore instance = WallpaperStore._();

  final Map<String, Map<String, dynamic>> _byKey = {};
  bool _loaded = false;

  Future<void> load({bool force = false}) async {
    if (_loaded && !force) return;
    try {
      final res = await ApiService.get('/api/chat-wallpapers') as Map<String, dynamic>;
      _byKey
        ..clear()
        ..addEntries((res['wallpapers'] as List).cast<Map>().map((w) => MapEntry('${w['chatKey']}', Map<String, dynamic>.from(w))));
      _loaded = true;
      notifyListeners();
    } catch (_) {/* chats still work without a wallpaper */}
  }

  /// This chat's own wallpaper, else the default, else none.
  Map<String, dynamic>? forChat(String key) => _byKey[key] ?? _byKey['default'];
  Map<String, dynamic>? own(String key) => _byKey[key];

  Future<void> set(String key, String kind, String value, int dim) async {
    await ApiService.put('/api/chat-wallpapers/$key', {'kind': kind, 'value': value, 'dim': dim});
    _byKey[key] = {'chatKey': key, 'kind': kind, 'value': value, 'dim': dim};
    notifyListeners();
  }

  Future<void> reset(String key) async {
    await ApiService.delete('/api/chat-wallpapers/$key');
    _byKey.remove(key);
    notifyListeners();
  }
}

class WallpaperPreset {
  const WallpaperPreset(this.id, this.label, this.light, this.dark, {this.doodle = false});
  final String id;
  final String label;
  final List<Color> light;
  final List<Color> dark;
  final bool doodle;
}

const wallpaperPresets = <WallpaperPreset>[
  WallpaperPreset('doodle', 'Doodle', [Color(0xFFEFF4FA), Color(0xFFE3ECF7)], [Color(0xFF0E1624), Color(0xFF121D2E)], doodle: true),
  WallpaperPreset('sky', 'Sky', [Color(0xFFDDEEFF), Color(0xFFF4F9FF)], [Color(0xFF0B2340), Color(0xFF10192B)]),
  WallpaperPreset('mint', 'Mint', [Color(0xFFDDF5EA), Color(0xFFF3FBF7)], [Color(0xFF0C2A21), Color(0xFF0F1C18)]),
  WallpaperPreset('sand', 'Sand', [Color(0xFFF6EBDD), Color(0xFFFBF6EF)], [Color(0xFF2B2117), Color(0xFF1B1611)]),
  WallpaperPreset('rose', 'Rose', [Color(0xFFFBE3EA), Color(0xFFFDF3F6)], [Color(0xFF2E1520), Color(0xFF1C1116)]),
  WallpaperPreset('night', 'Night', [Color(0xFF1B2440), Color(0xFF2B2F5A)], [Color(0xFF070B18), Color(0xFF141834)], doodle: true),
  WallpaperPreset('lavender', 'Lavender', [Color(0xFFE9E3FB), Color(0xFFF6F3FE)], [Color(0xFF1E1836), Color(0xFF151223)]),
  WallpaperPreset('leaf', 'Leaf', [Color(0xFFE4F1D9), Color(0xFFF4F9EE)], [Color(0xFF17260F), Color(0xFF11180C)], doodle: true),
];

const wallpaperColors = <String>[
  '#ECE5DD', '#D1E8E2', '#CFE3F7', '#F3D9DC', '#E8E0F5', '#F5EBC8',
  '#1F6F5C', '#21407A', '#5B2A4A', '#3A3A3A', '#0F1B2D', '#000000',
];

Color hexColor(String hex) => Color(int.parse('FF${hex.replaceFirst('#', '')}', radix: 16));

/// Paints the wallpaper behind a chat's messages.
class ChatWallpaper extends StatelessWidget {
  const ChatWallpaper({super.key, required this.chatKey, required this.child});
  final String chatKey;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: WallpaperStore.instance,
      builder: (context, _) {
        final w = WallpaperStore.instance.forChat(chatKey);
        if (w == null || w['kind'] == 'none') return child;
        return Stack(children: [
          Positioned.fill(child: WallpaperView(kind: '${w['kind']}', value: '${w['value']}', dim: (w['dim'] as num?)?.toInt() ?? 0)),
          child,
        ]);
      },
    );
  }
}

class WallpaperView extends StatelessWidget {
  const WallpaperView({super.key, required this.kind, required this.value, this.dim = 0});
  final String kind;
  final String value;
  final int dim;

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    Widget base;
    if (kind == 'color' && RegExp(r'^#[0-9a-fA-F]{6}$').hasMatch(value)) {
      base = ColoredBox(color: hexColor(value));
    } else if (kind == 'preset') {
      final p = wallpaperPresets.firstWhere((x) => x.id == value, orElse: () => wallpaperPresets.first);
      final colors = dark ? p.dark : p.light;
      base = DecoratedBox(
        decoration: BoxDecoration(gradient: LinearGradient(begin: Alignment.topLeft, end: Alignment.bottomRight, colors: colors)),
        child: p.doodle ? CustomPaint(painter: _DoodlePainter((dark || p.id == 'night') ? Colors.white.withValues(alpha: 0.05) : AppColors.navy.withValues(alpha: 0.05))) : null,
      );
    } else {
      return const SizedBox.shrink();
    }
    if (dim <= 0) return base;
    return Stack(fit: StackFit.expand, children: [base, ColoredBox(color: Colors.black.withValues(alpha: dim / 100))]);
  }
}

/// Small chat-themed shapes in a loose grid.
class _DoodlePainter extends CustomPainter {
  _DoodlePainter(this.color);
  final Color color;

  @override
  void paint(Canvas canvas, Size size) {
    final paint = Paint()
      ..color = color
      ..style = PaintingStyle.stroke
      ..strokeWidth = 1.6
      ..strokeCap = StrokeCap.round;
    const step = 56.0;
    var row = 0;
    for (double y = 12; y < size.height + step; y += step, row++) {
      var col = 0;
      for (double x = (row.isOdd ? step / 2 : 0) + 12; x < size.width + step; x += step, col++) {
        switch ((row * 3 + col) % 5) {
          case 0: // speech bubble
            final r = RRect.fromRectAndRadius(Rect.fromLTWH(x, y, 22, 15), const Radius.circular(6));
            canvas.drawRRect(r, paint);
            canvas.drawLine(Offset(x + 6, y + 15), Offset(x + 3, y + 21), paint);
          case 1: // heart
            final p = Path()
              ..moveTo(x + 10, y + 18)
              ..cubicTo(x - 4, y + 8, x + 4, y - 2, x + 10, y + 5)
              ..cubicTo(x + 16, y - 2, x + 24, y + 8, x + 10, y + 18);
            canvas.drawPath(p, paint);
          case 2: // star
            final p = Path();
            for (var i = 0; i < 5; i++) {
              final a = -math.pi / 2 + i * 4 * math.pi / 5;
              final pt = Offset(x + 10 + 9 * math.cos(a), y + 10 + 9 * math.sin(a));
              i == 0 ? p.moveTo(pt.dx, pt.dy) : p.lineTo(pt.dx, pt.dy);
            }
            p.close();
            canvas.drawPath(p, paint);
          case 3: // circle
            canvas.drawCircle(Offset(x + 10, y + 10), 7, paint);
          default: // music note
            canvas.drawCircle(Offset(x + 6, y + 17), 3.5, paint);
            canvas.drawLine(Offset(x + 9.5, y + 17), Offset(x + 9.5, y + 2), paint);
            canvas.drawLine(Offset(x + 9.5, y + 2), Offset(x + 17, y + 5), paint);
        }
      }
    }
  }

  @override
  bool shouldRepaint(covariant _DoodlePainter old) => old.color != color;
}

/// Pick a wallpaper for one chat (or the default for all chats).
class WallpaperPickerScreen extends StatefulWidget {
  const WallpaperPickerScreen({super.key, required this.chatKey, this.title = 'Chat wallpaper'});
  final String chatKey;
  final String title;

  @override
  State<WallpaperPickerScreen> createState() => _WallpaperPickerScreenState();
}

class _WallpaperPickerScreenState extends State<WallpaperPickerScreen> {
  String _kind = 'preset';
  String _value = 'doodle';
  double _dim = 0;
  bool _saving = false;

  bool get _isDefault => widget.chatKey == 'default';

  @override
  void initState() {
    super.initState();
    final w = WallpaperStore.instance.own(widget.chatKey);
    if (w != null) {
      _kind = '${w['kind']}';
      _value = '${w['value']}';
      _dim = ((w['dim'] as num?) ?? 0).toDouble();
    }
    WallpaperStore.instance.load();
  }

  Future<void> _save() async {
    setState(() => _saving = true);
    try {
      await WallpaperStore.instance.set(widget.chatKey, _kind, _kind == 'none' ? '' : _value, _dim.round());
      if (mounted) Navigator.pop(context);
    } catch (e) {
      if (mounted) {
        setState(() => _saving = false);
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e is ApiException ? e.message : 'Could not save the wallpaper.')));
      }
    }
  }

  Future<void> _reset() async {
    try {
      await WallpaperStore.instance.reset(widget.chatKey);
      if (mounted) Navigator.pop(context);
    } catch (_) {}
  }

  Widget _tile({required Widget child, required bool selected, required VoidCallback onTap, String? label}) {
    return GestureDetector(
      onTap: onTap,
      child: Column(children: [
        Expanded(
          child: Container(
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(12),
              border: Border.all(color: selected ? AppColors.cyan : AppColors.border, width: selected ? 3 : 1),
            ),
            clipBehavior: Clip.antiAlias,
            child: child,
          ),
        ),
        if (label != null) Padding(padding: const EdgeInsets.only(top: 4), child: Text(label, style: TextStyle(color: AppColors.textSecondary, fontSize: 12))),
      ]),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(title: Text(widget.title)),
      bottomNavigationBar: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Row(children: [
            if (WallpaperStore.instance.own(widget.chatKey) != null)
              Expanded(child: OutlinedButton(onPressed: _reset, child: Text(_isDefault ? 'Remove' : 'Use default'))),
            if (WallpaperStore.instance.own(widget.chatKey) != null) const SizedBox(width: 12),
            Expanded(child: FilledButton(onPressed: _saving ? null : _save, child: Text(_saving ? 'Saving…' : 'Set wallpaper'))),
          ]),
        ),
      ),
      body: ListView(padding: const EdgeInsets.all(16), children: [
        // Preview with two sample bubbles.
        SizedBox(
          height: 200,
          child: ClipRRect(
            borderRadius: BorderRadius.circular(16),
            child: Stack(children: [
              Positioned.fill(child: _kind == 'none' ? ColoredBox(color: AppColors.background) : WallpaperView(kind: _kind, value: _value, dim: _dim.round())),
              Positioned(left: 16, top: 24, child: _bubble('Hello! 👋', false)),
              Positioned(right: 16, top: 80, child: _bubble('నమస్తే! How are you?', true)),
            ]),
          ),
        ),
        const SizedBox(height: 20),
        Text('Wallpapers', style: TextStyle(color: AppColors.ink, fontWeight: FontWeight.w700)),
        const SizedBox(height: 10),
        GridView.count(
          crossAxisCount: 4,
          shrinkWrap: true,
          physics: const NeverScrollableScrollPhysics(),
          mainAxisSpacing: 10,
          crossAxisSpacing: 10,
          childAspectRatio: 0.62,
          children: [
            _tile(
              label: 'None',
              selected: _kind == 'none',
              onTap: () => setState(() => _kind = 'none'),
              child: ColoredBox(color: AppColors.surface, child: Icon(Icons.block, color: AppColors.textMuted)),
            ),
            for (final p in wallpaperPresets)
              _tile(
                label: p.label,
                selected: _kind == 'preset' && _value == p.id,
                onTap: () => setState(() { _kind = 'preset'; _value = p.id; }),
                child: WallpaperView(kind: 'preset', value: p.id),
              ),
          ],
        ),
        const SizedBox(height: 20),
        Text('Solid colours', style: TextStyle(color: AppColors.ink, fontWeight: FontWeight.w700)),
        const SizedBox(height: 10),
        GridView.count(
          crossAxisCount: 6,
          shrinkWrap: true,
          physics: const NeverScrollableScrollPhysics(),
          mainAxisSpacing: 10,
          crossAxisSpacing: 10,
          children: [
            for (final c in wallpaperColors)
              _tile(
                selected: _kind == 'color' && _value.toUpperCase() == c,
                onTap: () => setState(() { _kind = 'color'; _value = c; }),
                child: ColoredBox(color: hexColor(c)),
              ),
          ],
        ),
        if (_kind != 'none') ...[
          const SizedBox(height: 20),
          Text('Dim (for dark mode)', style: TextStyle(color: AppColors.ink, fontWeight: FontWeight.w700)),
          Slider(value: _dim, min: 0, max: 80, divisions: 8, label: '${_dim.round()}%', activeColor: AppColors.cyan, onChanged: (v) => setState(() => _dim = v)),
        ],
      ]),
    );
  }

  Widget _bubble(String text, bool mine) => Container(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
        decoration: BoxDecoration(color: mine ? AppColors.cyan : AppColors.surface, borderRadius: BorderRadius.circular(14)),
        child: Text(text, style: TextStyle(color: mine ? AppColors.onAccent : AppColors.ink)),
      );
}
