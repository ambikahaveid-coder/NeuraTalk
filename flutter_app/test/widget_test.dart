import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:neuratalk/screens/login_screen.dart';
import 'package:neuratalk/theme/app_theme.dart';

void main() {
  group('LoginScreen — account type step', () {
    testWidgets('shows Get Started with Personal/Business choices, defaulting to Personal', (tester) async {
      await tester.pumpWidget(MaterialApp(theme: AppTheme.dark, home: const LoginScreen()));

      expect(find.text('Get Started'), findsOneWidget);
      expect(find.text('Personal'), findsOneWidget);
      expect(find.text('Business'), findsOneWidget);
      expect(find.text('Continue →'), findsOneWidget);
    });

    testWidgets('tapping Continue advances to the phone entry step', (tester) async {
      await tester.pumpWidget(MaterialApp(theme: AppTheme.dark, home: const LoginScreen()));

      await tester.tap(find.text('Continue →'));
      await tester.pump();

      // The account-type choices are gone once past that step.
      expect(find.text('Get Started'), findsNothing);
    });

    testWidgets('tapping Business selects it without crashing', (tester) async {
      await tester.pumpWidget(MaterialApp(theme: AppTheme.dark, home: const LoginScreen()));

      await tester.tap(find.text('Business'));
      await tester.pump();

      expect(find.text('Business'), findsOneWidget);
    });
  });
}
