// Screenshots of the real screens with real-shaped data, for design review.
// Not part of CI: runs only when UI_FIXTURES is set.
//   UI_FIXTURES=<json> PREVIEW_OUT=<dir> [ONLY=a,b] flutter test test/ui_audit --update-goldens
import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:provider/provider.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'package:neuratalk/providers/auth_provider.dart';
import 'package:neuratalk/providers/group_chat_provider.dart';
import 'package:neuratalk/providers/personal_chat_provider.dart';
import 'package:neuratalk/services/api_service.dart';
import 'package:neuratalk/services/call_service.dart';
import 'package:neuratalk/theme/app_theme.dart';
import 'package:neuratalk/screens/main_shell.dart';
import 'package:neuratalk/screens/conversation_screen.dart';
import 'package:neuratalk/screens/group_conversation_screen.dart';
import 'package:neuratalk/screens/calls_screen.dart';
import 'package:neuratalk/screens/updates_screen.dart';
import 'package:neuratalk/screens/settings_screen.dart';
import 'package:neuratalk/screens/wallet_screen.dart';
import 'package:neuratalk/screens/login_screen.dart';
import 'package:neuratalk/screens/onboarding_screen.dart';
import 'package:neuratalk/business/business_shell.dart';
import 'package:neuratalk/business/business_account.dart';
import 'package:neuratalk/business/business_catalog_screen.dart';
import 'store_assets.dart';

final _fixturesPath = Platform.environment['UI_FIXTURES'];
final _out = Platform.environment['PREVIEW_OUT'] ?? 'build/ui_audit';
final _only = (Platform.environment['ONLY'] ?? '').split(',').where((s) => s.isNotEmpty).toSet();

Future<void> _loadFonts() async {
  Future<void> family(String name, List<String> files) async {
    final loader = FontLoader(name);
    for (final f in files) {
      final bytes = File(f).readAsBytesSync();
      loader.addFont(Future.value(ByteData.view(Uint8List.fromList(bytes).buffer)));
    }
    await loader.load();
  }
  const fonts = 'assets/fonts';
  final fontDir = Platform.environment['UI_FONTS'] ?? '';
  final indic = ['$fontDir/NotoSansTelugu-Regular.ttf', '$fontDir/NotoSansDevanagari-Regular.ttf'].where((f) => File(f).existsSync()).toList();
  final emoji = ['C:/Windows/Fonts/seguiemj.ttf'].where((f) => File(f).existsSync()).toList();
  await family('Inter', [
    '$fonts/Inter-Regular.ttf', '$fonts/Inter-Medium.ttf', '$fonts/Inter-SemiBold.ttf', '$fonts/Inter-Bold.ttf', '$fonts/Inter-ExtraBold.ttf',
    ...indic, ...emoji,
  ]);
  final emojiFont = '$fontDir/NotoEmoji.ttf';
  if (File(emojiFont).existsSync()) await family('NotoEmoji', [emojiFont]);
  for (final f in indic) {
    await family(f.contains('Telugu') ? 'NotoTelugu' : 'NotoDeva', [f]);
  }
  await family('MaterialIcons', ['C:/flutter/bin/cache/artifacts/material_fonts/materialicons-regular.otf']);
  await family('Roboto', ['C:/flutter/bin/cache/artifacts/material_fonts/roboto-regular.ttf', ...indic, ...emoji]);
}

/// Text styles inherit these fallbacks through DefaultTextStyle, so Telugu and
/// Hindi render in screenshots the way the phone's system fonts render them.
ThemeData withIndicFallback(ThemeData t) {
  const fb = ['NotoTelugu', 'NotoDeva', 'NotoEmoji'];
  TextStyle? f(TextStyle? x) => x?.copyWith(fontFamilyFallback: fb);
  return t.copyWith(
    textTheme: t.textTheme.apply(fontFamilyFallback: fb),
    primaryTextTheme: t.primaryTextTheme.apply(fontFamilyFallback: fb),
    listTileTheme: t.listTileTheme.copyWith(titleTextStyle: f(t.listTileTheme.titleTextStyle), subtitleTextStyle: f(t.listTileTheme.subtitleTextStyle)),
    // The test engine draws FAB shadows as a black ring; phones draw a soft shadow.
    floatingActionButtonTheme: t.floatingActionButtonTheme.copyWith(elevation: 0, focusElevation: 0, hoverElevation: 0, highlightElevation: 0),
  );
}

http.Client _client(Map<String, dynamic> data) => MockClient((req) async {
      final key = req.url.path + (req.url.hasQuery ? '?${req.url.query}' : '');
      final body = data[key] ?? data[req.url.path];
      if (body != null) return http.Response(jsonEncode(body), 200, headers: {'content-type': 'application/json; charset=utf-8'});
      if (req.method != 'GET') return http.Response('{"success":true}', 200, headers: {'content-type': 'application/json'});
      // Unknown list endpoints: empty, like a new account.
      return http.Response('{"success":true}', 200, headers: {'content-type': 'application/json'});
    });

Future<void> _shot(WidgetTester tester, String name, Widget screen, Map<String, dynamic> data, Map<String, dynamic> me,
    {bool dark = false, int settleMs = 1500, String? caption}) async {
  if (_only.isNotEmpty && !_only.contains(name)) return;
  await http.runWithClient(() async {
    // Store screenshots: 1080x1920 (16:9), the phone screen under a heading.
    tester.view.physicalSize = caption == null ? const Size(1080, 2340) : const Size(1080, 1920);
    tester.view.devicePixelRatio = 2.625;
    final auth = AuthProvider();
    await tester.runAsync(() async {
      await ApiService.saveToken('ui-audit');
      await auth.completeWebLogin('ui-audit', me);
    });
    await tester.pumpWidget(MultiProvider(
      providers: [
        ChangeNotifierProvider.value(value: auth),
        ChangeNotifierProvider(create: (_) => CallService(), lazy: false),
        ChangeNotifierProvider(create: (_) => PersonalChatProvider()),
        ChangeNotifierProvider(create: (_) => GroupChatProvider()),
        ChangeNotifierProvider(create: (_) => ThemeController()),
      ],
      child: MaterialApp(
        debugShowCheckedModeBanner: false,
        theme: withIndicFallback(AppTheme.light),
        darkTheme: withIndicFallback(AppTheme.dark),
        themeMode: dark ? ThemeMode.dark : ThemeMode.light,
        builder: (context, child) => ThemeSync(child: caption == null ? child! : StoreFrame(caption: caption, child: child!)),
        home: screen,
      ),
    ));
    for (var i = 0; i < 6; i++) {
      await tester.runAsync(() => Future.delayed(Duration(milliseconds: settleMs ~/ 6)));
      await tester.pump(const Duration(milliseconds: 200));
    }
    await expectLater(find.byType(MaterialApp), matchesGoldenFile(caption == null ? '$_out/${name}_${dark ? 'dark' : 'light'}.png' : '$_out/store_$name.png'));
    await tester.pumpWidget(const SizedBox());
    await tester.pump(const Duration(seconds: 1));
  }, () => _client(data));
}

void main() {
  if (_fixturesPath == null) {
    test('ui audit skipped (set UI_FIXTURES)', () {});
    return;
  }
  final fx = jsonDecode(File(_fixturesPath!).readAsStringSync()) as Map<String, dynamic>;
  final kiran = Map<String, dynamic>.from(fx['kiran'] as Map);
  final biz = Map<String, dynamic>.from(fx['business'] as Map);
  final ids = Map<String, dynamic>.from(fx['ids'] as Map);
  final kiranMe = Map<String, dynamic>.from(kiran['/api/auth/me'] as Map);
  final bizMe = Map<String, dynamic>.from(biz['/api/auth/me'] as Map);
  final thread1 = Map<String, dynamic>.from((kiran['/api/personal-chats/${ids['thread1']}'] as Map)['thread'] as Map);

  setUpAll(() async {
    TestWidgetsFlutterBinding.ensureInitialized();
    SharedPreferences.setMockInitialValues({'onboarding_done': true, 'voice_learning_asked_v2': true, 'language_chosen_v1': true, 'call_readiness_asked_v1': true});
    const storage = MethodChannel('plugins.it_nomads.com/flutter_secure_storage');
    final store = <String, String>{};
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger.setMockMethodCallHandler(storage, (call) async {
      final args = (call.arguments as Map?) ?? {};
      switch (call.method) {
        case 'write': store[args['key'] as String] = args['value'] as String; return null;
        case 'read': return store[args['key']];
        case 'delete': store.remove(args['key']); return null;
        case 'readAll': return store;
        case 'containsKey': return store.containsKey(args['key']);
        default: return null;
      }
    });
    await _loadFonts();
  });

  final screens = <String, (Widget, Map<String, dynamic>, Map<String, dynamic>)>{
    'chats': (const MainShell(), kiran, kiranMe),
    'conversation': (ConversationScreen(thread: thread1), kiran, kiranMe),
    'group': (GroupConversationScreen(groupId: ids['groupId'] as int), kiran, kiranMe),
    'calls': (const Scaffold(body: CallsScreen()), kiran, kiranMe),
    'updates': (const Scaffold(body: UpdatesScreen()), kiran, kiranMe),
    'settings': (const SettingsScreen(), kiran, kiranMe),
    'wallet': (const WalletScreen(), kiran, kiranMe),
    'login': (const LoginScreen(), kiran, kiranMe),
    'onboarding': (const OnboardingScreen(), kiran, kiranMe),
    'business': (const BusinessShell(), biz, bizMe),
  };
  if (Platform.environment['STORE'] == '1') {
    final account = BusinessAccount(ids['orgId'] as int);
    Widget withAccount(Widget w) => ChangeNotifierProvider<BusinessAccount>.value(value: account, child: w);
    final conv = ((biz['/api/business/${ids['orgId']}/conversations'] as Map)['conversations'] as List).first as Map<String, dynamic>;
    final store = <String, (Widget, Map<String, dynamic>, Map<String, dynamic>, String)>{
      '1_chat': (ConversationScreen(thread: thread1), kiran, kiranMe, 'Write in Telugu.\nThey read it in English.'),
      '2_chats': (const MainShell(), kiran, kiranMe, 'Every chat translated\nas it arrives'),
      '3_group': (GroupConversationScreen(groupId: ids['groupId'] as int), kiran, kiranMe, 'Groups where everyone\nreads their own language'),
      '4_calls': (const Scaffold(body: CallsScreen()), kiran, kiranMe, 'Voice and video calls,\nfree without translation'),
      '5_plan': (const WalletScreen(), kiran, kiranMe, '5 free AI translation minutes.\nNo card needed.'),
      'b1_inbox': (const BusinessShell(), biz, bizMe, 'Every customer chat\nin one inbox'),
      'b2_chat': (withAccount(BusinessConversationScreen(businessId: ids['orgId'] as int, conversationId: conv['id'] as int, summary: conv)), biz, bizMe, 'Reply in English.\nCustomers read Telugu.'),
      'b3_catalog': (withAccount(const BusinessCatalogScreen()), biz, bizMe, 'Share your catalog\nand take orders in chat'),
    };
    for (final e in store.entries) {
      testWidgets('store ${e.key}', (tester) async {
        final (w, data, me, caption) = e.value;
        await _shot(tester, e.key, w, data, me, caption: caption);
      });
    }
    registerStoreGraphics(_out);
    return;
  }
  for (final entry in screens.entries) {
    for (final dark in [false, true]) {
      testWidgets('${entry.key} ${dark ? 'dark' : 'light'}', (tester) async {
        final (w, data, me) = entry.value;
        await _shot(tester, entry.key, w, data, me, dark: dark);
      });
    }
  }
}
