import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:provider/provider.dart';
import 'package:neuratalk/providers/auth_provider.dart';
import 'package:neuratalk/screens/voice_clone_screen.dart';

class _SignedInAuth extends AuthProvider {
  @override
  Map<String, dynamic>? get user => {'id': 7, 'preferredLanguage': 'en'};
}

/// Pumps the screen with the voice profile endpoint answering [profile]
/// (or failing with [statusCode]).
Future<void> _pump(WidgetTester tester, {Map<String, dynamic>? profile, int statusCode = 200}) async {
  final client = MockClient((request) async {
    if (request.url.path == '/api/voice-training/profile/7') {
      final body = statusCode == 200
          ? (profile == null ? {'hasCustomVoice': false} : {'hasCustomVoice': true, 'profile': profile})
          : {'error': 'Server error'};
      return http.Response(jsonEncode(body), statusCode);
    }
    return http.Response('{}', 404);
  });
  await http.runWithClient(() async {
    await tester.pumpWidget(ChangeNotifierProvider<AuthProvider>(
      create: (_) => _SignedInAuth(),
      child: const MaterialApp(home: VoiceCloneScreen()),
    ));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 50));
  }, () => client);
}

void main() {
  testWidgets('a new user is invited to record three passages', (tester) async {
    await _pump(tester);
    expect(find.text('Talk in your own voice'), findsOneWidget);
    expect(find.text('Read 3 short passages'), findsOneWidget);

    await tester.tap(find.text('Get started'));
    await tester.pump();
    expect(find.text('Passage 1 of 3'), findsOneWidget);
    expect(find.textContaining('This is my own voice, recorded for NeuraTalk'), findsOneWidget);
    // Next stays disabled until the passage is recorded.
    final next = tester.widget<ElevatedButton>(find.widgetWithText(ElevatedButton, 'Next'));
    expect(next.onPressed, isNull);
  });

  testWidgets('a ready, enabled voice says calls use it', (tester) async {
    await _pump(tester, profile: {'trainingStatus': 'ready', 'isEnabled': true, 'moderationStatus': 'approved'});
    expect(find.text('Your calls use your voice'), findsOneWidget);
    expect(find.text('Use my voice in calls'), findsOneWidget);
    expect(find.text('Record again'), findsOneWidget);
  });

  testWidgets('training shows progress and the expected wait', (tester) async {
    await _pump(tester, profile: {'trainingStatus': 'training', 'isEnabled': false, 'moderationStatus': 'pending'});
    expect(find.text('Creating your voice…'), findsOneWidget);
    expect(find.textContaining('2 to 5 minutes'), findsOneWidget);
    expect(find.text('Record again'), findsNothing);
  });

  testWidgets('a voice an admin turned off explains why and cannot be switched on', (tester) async {
    await _pump(tester, profile: {'trainingStatus': 'ready', 'isEnabled': false, 'moderationStatus': 'rejected'});
    expect(find.text('Your voice was turned off'), findsOneWidget);
    expect(find.text('Use my voice in calls'), findsNothing);
  });

  testWidgets('a failed load offers a retry', (tester) async {
    await _pump(tester, statusCode: 500);
    expect(find.text('Could not load your voice'), findsOneWidget);
    expect(find.text('Try again'), findsOneWidget);
  });
}
