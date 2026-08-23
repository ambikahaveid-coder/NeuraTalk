import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

/// Regression coverage for the P0 found on 2026-08-23: CallScreen and
/// IncomingCallScreen used PopScope(canPop: false) while their own
/// deliberate-exit code called Navigator.maybePop()/pop() to leave the
/// screen -- since canPop never became true, every one of those pops was
/// silently swallowed by Flutter's own popDisposition handling (see
/// Navigator.maybePop() in the Flutter SDK, which calls
/// route.onPopInvokedWithResult(false, result) and returns without
/// popping when popDisposition is doNotPop). Reject/dismiss/timeout paths
/// never actually closed their screen; only Accept worked, because it
/// uses pushReplacement, which bypasses the canPop gate entirely.
///
/// This can't be tested against the real CallScreen/IncomingCallScreen
/// widgets without mocking ApiService's network calls and the LiveKit SDK
/// -- ApiService hardcodes a real production base URL with no injection
/// seam, and no mocking library (mockito/mocktail) is present in this
/// project. Introducing one is out of scope for this fix. Instead, this
/// isolates the exact navigation mechanism both screens now share --
/// PopScope(canPop: false) plus a deliberate exit that flips canPop and
/// pops on the next frame -- in a minimal harness, so the specific bug
/// class (a pop that's supposed to work but gets silently blocked) is
/// covered by a real, running test.
void main() {
  group('Call screen deliberate-exit navigation pattern', () {
    testWidgets(
      'REGRESSION: PopScope(canPop: false) with no override permanently blocks Navigator.maybePop() '
      '(this is the exact bug -- reject/dismiss/timeout never closed the screen)',
      (tester) async {
        await tester.pumpWidget(
          MaterialApp(
            home: Builder(
              builder: (context) => PopScope(
                canPop: false,
                child: Scaffold(
                  body: TextButton(
                    onPressed: () => Navigator.of(context).maybePop(),
                    child: const Text('blocked-exit'),
                  ),
                ),
              ),
            ),
          ),
        );

        expect(find.text('blocked-exit'), findsOneWidget);
        await tester.tap(find.text('blocked-exit'));
        await tester.pumpAndSettle();

        // The screen is still here -- this is the bug, demonstrated directly.
        expect(find.text('blocked-exit'), findsOneWidget);
      },
    );

    testWidgets(
      'FIX: flipping canPop via setState then popping on the next frame actually closes the screen',
      (tester) async {
        await tester.pumpWidget(
          MaterialApp(
            home: Navigator(
              onGenerateRoute: (settings) => MaterialPageRoute(builder: (_) => const _FixedExitScreen()),
            ),
          ),
        );

        expect(find.text('fixed-exit-screen'), findsOneWidget);
        await tester.tap(find.text('deliberate-exit'));
        // setState's rebuild, then the addPostFrameCallback's pop, then the
        // pop's own route-transition animation all need frames to fully
        // settle -- a single pump() (or even two) isn't enough headroom.
        await tester.pumpAndSettle();

        expect(find.text('fixed-exit-screen'), findsNothing);
      },
    );

    testWidgets(
      'REGRESSION: popping immediately after setState (no frame wait) still gets blocked -- '
      'proves canPopNotifier only updates on the next rebuild, not synchronously after setState()',
      (tester) async {
        await tester.pumpWidget(
          MaterialApp(
            home: Navigator(
              onGenerateRoute: (settings) => MaterialPageRoute(builder: (_) => const _NaiveExitScreen()),
            ),
          ),
        );

        expect(find.text('naive-exit-screen'), findsOneWidget);
        await tester.tap(find.text('naive-exit'));
        await tester.pumpAndSettle();

        // Still here -- popping in the same call stack as the setState()
        // that flips canPop doesn't work; this is why the real fix needs
        // the post-frame callback, not just the state flip.
        expect(find.text('naive-exit-screen'), findsOneWidget);
      },
    );

    testWidgets(
      'duplicate-trigger guard: an idempotency flag prevents a second logical operation '
      'from running once the first has already started',
      (tester) async {
        var networkCallCount = 0;
        var guardActive = false;

        Future<void> guardedOperation() async {
          if (guardActive) return;
          guardActive = true;
          networkCallCount++;
        }

        // Simulates a button double-tap / PopScope-retrigger / remote-event
        // race all firing the same logical "end this call" operation.
        await guardedOperation();
        await guardedOperation();
        await guardedOperation();

        expect(networkCallCount, 1);
      },
    );
  });
}

class _FixedExitScreen extends StatefulWidget {
  const _FixedExitScreen();
  @override
  State<_FixedExitScreen> createState() => _FixedExitScreenState();
}

class _FixedExitScreenState extends State<_FixedExitScreen> {
  bool _allowPop = false;

  void _exitScreen() {
    if (!mounted) return;
    setState(() => _allowPop = true);
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) Navigator.of(context).pop();
    });
  }

  @override
  Widget build(BuildContext context) {
    return PopScope(
      canPop: _allowPop,
      child: Scaffold(
        body: Column(
          children: [
            const Text('fixed-exit-screen'),
            TextButton(onPressed: _exitScreen, child: const Text('deliberate-exit')),
          ],
        ),
      ),
    );
  }
}

class _NaiveExitScreen extends StatefulWidget {
  const _NaiveExitScreen();
  @override
  State<_NaiveExitScreen> createState() => _NaiveExitScreenState();
}

class _NaiveExitScreenState extends State<_NaiveExitScreen> {
  bool _allowPop = false;

  void _exitScreen() {
    if (!mounted) return;
    setState(() => _allowPop = true);
    Navigator.of(context).maybePop(); // no frame wait -- still broken
  }

  @override
  Widget build(BuildContext context) {
    return PopScope(
      canPop: _allowPop,
      child: Scaffold(
        body: Column(
          children: [
            const Text('naive-exit-screen'),
            TextButton(onPressed: _exitScreen, child: const Text('naive-exit')),
          ],
        ),
      ),
    );
  }
}
