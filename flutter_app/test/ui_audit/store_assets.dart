// Play Store graphics and the business-app launcher icon, drawn from the real
// brand mark (android/app/src/main/res/.../ic_launcher_foreground.png).
import 'dart:io';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

const _navy = Color(0xFF0B1530);
const _blue = Color(0xFF1F6BFF);
const _sky = Color(0xFF2EA8FF);
const _foreground = 'android/app/src/main/res/mipmap-xxxhdpi/ic_launcher_foreground.png';

/// A store screenshot: the phone screen, a little smaller, under a heading.
class StoreFrame extends StatelessWidget {
  const StoreFrame({super.key, required this.caption, required this.child});
  final String caption;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    // The phone screen lays out at a real phone size, then is scaled down.
    const phone = Size(411, 860);
    return Directionality(
      textDirection: TextDirection.ltr,
      child: DecoratedBox(
        decoration: const BoxDecoration(
          gradient: LinearGradient(begin: Alignment.topLeft, end: Alignment.bottomRight, colors: [_navy, Color(0xFF16307A)]),
        ),
        child: Column(children: [
          SizedBox(
            height: 150,
            child: Center(
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: 20),
                child: Text(caption,
                    textAlign: TextAlign.center,
                    style: const TextStyle(fontFamily: 'Inter', color: Colors.white, fontSize: 26, height: 1.25, fontWeight: FontWeight.w800, decoration: TextDecoration.none)),
              ),
            ),
          ),
          Expanded(
            child: Padding(
              padding: const EdgeInsets.fromLTRB(28, 0, 28, 0),
              child: FittedBox(
                fit: BoxFit.contain,
                alignment: Alignment.topCenter,
                child: Container(
                  width: phone.width,
                  height: phone.height,
                  decoration: BoxDecoration(
                    borderRadius: const BorderRadius.vertical(top: Radius.circular(36)),
                    border: Border.all(color: const Color(0xFF2B3A66), width: 6),
                  ),
                  child: ClipRRect(
                    borderRadius: const BorderRadius.vertical(top: Radius.circular(30)),
                    child: MediaQuery(
                      data: MediaQuery.of(context).copyWith(size: phone, padding: const EdgeInsets.only(top: 24), viewPadding: const EdgeInsets.only(top: 24)),
                      child: child,
                    ),
                  ),
                ),
              ),
            ),
          ),
        ]),
      ),
    );
  }
}

class _Badge extends StatelessWidget {
  const _Badge(this.size);
  final double size;
  @override
  Widget build(BuildContext context) => Container(
        width: size,
        height: size,
        decoration: BoxDecoration(
          color: Colors.white,
          shape: BoxShape.circle,
          border: Border.all(color: _navy, width: size * 0.07),
        ),
        alignment: Alignment.center,
        child: Text('B',
            style: TextStyle(fontFamily: 'Inter', color: _blue, fontSize: size * 0.62, fontWeight: FontWeight.w800, height: 1.0)),
      );
}

/// Adaptive-icon foreground (108 dp canvas); the badge sits inside the 66 dp safe circle.
Widget _foregroundLayer(ImageProvider mark, double s, {required bool business}) => SizedBox(
      width: s,
      height: s,
      child: Stack(children: [
        Positioned.fill(child: Image(image: mark, fit: BoxFit.contain)),
        if (business) Positioned(left: s * 0.555, top: s * 0.555, child: _Badge(s * 0.2)),
      ]),
    );

/// Legacy (pre-Android 8) launcher icon: rounded square, mark, badge.
Widget _legacyIcon(ImageProvider mark, double s, {required bool business}) => Container(
      width: s,
      height: s,
      decoration: BoxDecoration(color: _navy, borderRadius: BorderRadius.circular(s * 0.22)),
      child: Stack(children: [
        Positioned.fill(child: Transform.scale(scale: 1.45, child: Image(image: mark, fit: BoxFit.contain))),
        if (business) Positioned(right: s * 0.1, bottom: s * 0.1, child: _Badge(s * 0.34)),
      ]),
    );

/// Play listing icon 512x512: full square (Play applies its own mask).
Widget _playIcon(ImageProvider mark, {required bool business}) => Container(
      width: 512,
      height: 512,
      color: _navy,
      child: Stack(children: [
        Positioned.fill(child: Transform.scale(scale: 1.5, child: Image(image: mark, fit: BoxFit.contain))),
        if (business) Positioned(right: 72, bottom: 72, child: const _Badge(150)),
      ]),
    );

Widget _feature(ImageProvider mark, {required bool business}) => Container(
      width: 1024,
      height: 500,
      decoration: const BoxDecoration(
        gradient: LinearGradient(begin: Alignment.topLeft, end: Alignment.bottomRight, colors: [_navy, Color(0xFF16307A), _blue]),
      ),
      child: Row(children: [
        const SizedBox(width: 56),
        SizedBox(width: 300, height: 300, child: Stack(children: [
          Positioned.fill(child: Transform.scale(scale: 1.5, child: Image(image: mark, fit: BoxFit.contain))),
          if (business) const Positioned(right: 18, bottom: 18, child: _Badge(96)),
        ])),
        const SizedBox(width: 40),
        Expanded(
          child: Column(mainAxisAlignment: MainAxisAlignment.center, crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(business ? 'NeuraTalk Business' : 'NeuraTalk',
                style: const TextStyle(fontFamily: 'Inter', color: Colors.white, fontSize: 54, fontWeight: FontWeight.w800, decoration: TextDecoration.none)),
            const SizedBox(height: 14),
            Text(
                business ? 'Chat with every customer\nin their own language.' : 'Talk in your language.\nThey hear theirs.',
                style: const TextStyle(fontFamily: 'Inter', color: Color(0xFFD9E6FF), fontSize: 34, height: 1.25, fontWeight: FontWeight.w600, decoration: TextDecoration.none)),
            const SizedBox(height: 22),
            Container(width: 120, height: 6, decoration: BoxDecoration(color: _sky, borderRadius: BorderRadius.circular(3))),
          ]),
        ),
        const SizedBox(width: 40),
      ]),
    );

Future<void> _render(WidgetTester tester, Size size, Widget Function(ImageProvider mark) build, String path) async {
  tester.view.physicalSize = size;
  tester.view.devicePixelRatio = 1;
  final bytes = File(_foreground).readAsBytesSync();
  final mark = MemoryImage(Uint8List.fromList(bytes));
  final key = GlobalKey();
  await tester.pumpWidget(Directionality(
    textDirection: TextDirection.ltr,
    child: Align(alignment: Alignment.topLeft, child: RepaintBoundary(key: key, child: build(mark))),
  ));
  await tester.runAsync(() => precacheImage(mark, key.currentContext!));
  await tester.pump();
  await expectLater(find.byKey(key), matchesGoldenFile(path));
}

void registerStoreGraphics(String out) {
  for (final business in [false, true]) {
    final app = business ? 'business' : 'customer';
    testWidgets('play icon $app', (t) => _render(t, const Size(512, 512), (m) => _playIcon(m, business: business), '$out/play_icon_$app.png'));
    testWidgets('feature graphic $app', (t) => _render(t, const Size(1024, 500), (m) => _feature(m, business: business), '$out/feature_$app.png'));
  }
  // Business launcher icons (customer keeps the existing ones).
  const densities = {'mdpi': 1.0, 'hdpi': 1.5, 'xhdpi': 2.0, 'xxhdpi': 3.0, 'xxxhdpi': 4.0};
  densities.forEach((d, f) {
    testWidgets('business foreground $d', (t) => _render(t, Size(108 * f, 108 * f), (m) => _foregroundLayer(m, 108 * f, business: true), '$out/res/mipmap-$d/ic_launcher_foreground.png'));
    testWidgets('business legacy $d', (t) => _render(t, Size(48 * f, 48 * f), (m) => _legacyIcon(m, 48 * f, business: true), '$out/res/mipmap-$d/ic_launcher.png'));
  });
}
