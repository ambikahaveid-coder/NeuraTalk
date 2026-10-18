import 'package:flutter_test/flutter_test.dart';
import 'package:neuratalk/utils/voice_prompts.dart';

void main() {
  test('gives three lines in the speaker\'s own language', () {
    expect(voicePromptsFor('te'), hasLength(3));
    expect(voicePromptsFor('te-IN').first, contains('నమస్కారం'));
    expect(voicePromptsFor('hi').first, contains('नमस्ते'));
  });

  test('falls back to English for languages without prompts', () {
    expect(voicePromptsFor('sw').first, startsWith('Hello!'));
    expect(voicePromptsFor(null).first, startsWith('Hello!'));
  });
}
