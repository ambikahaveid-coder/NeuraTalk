import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:neuratalk/screens/login_screen.dart';
import 'package:neuratalk/theme/app_theme.dart';

void main() {
  group('LoginScreen — phone step', () {
    testWidgets('opens directly on the phone number step', (tester) async {
      await tester.pumpWidget(MaterialApp(theme: AppTheme.light, home: const LoginScreen()));

      expect(find.text('Welcome'), findsOneWidget);
      expect(find.text('Continue'), findsOneWidget);
      expect(find.byType(TextField), findsOneWidget);
    });

    testWidgets('rejects a number that is not 10 digits without calling the server', (tester) async {
      await tester.pumpWidget(MaterialApp(theme: AppTheme.light, home: const LoginScreen()));

      await tester.enterText(find.byType(TextField), '12345');
      await tester.tap(find.text('Continue'));
      await tester.pump();

      expect(find.text('Enter a valid 10-digit mobile number'), findsOneWidget);
    });

    testWidgets('asks for a number when the field is empty', (tester) async {
      await tester.pumpWidget(MaterialApp(theme: AppTheme.light, home: const LoginScreen()));

      await tester.tap(find.text('Continue'));
      await tester.pump();

      expect(find.text('Enter your phone number'), findsOneWidget);
    });
  });
}
