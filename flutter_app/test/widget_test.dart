import 'package:flutter_test/flutter_test.dart';

import 'package:neuratalk/shell/shell_config.dart';

void main() {
  test('uses a valid live platform url', () {
    expect(ShellConfig.initialUri, isNotNull);
    expect(ShellConfig.initialUri!.hasScheme, isTrue);
  });
}
