import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter/foundation.dart';
import 'package:provider/provider.dart';
import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_crashlytics/firebase_crashlytics.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'theme/app_theme.dart';
import 'providers/auth_provider.dart';
import 'providers/personal_chat_provider.dart';
import 'providers/group_chat_provider.dart';
import 'services/call_service.dart';
import 'services/callkit_service.dart';
import 'services/push_service.dart';
import 'screens/onboarding_screen.dart';
import 'screens/main_shell.dart';
import 'screens/incoming_call_screen.dart';
import 'screens/call_screen.dart';

final navigatorKey = GlobalKey<NavigatorState>();

/// Runs in a separate background isolate the OS spins up to deliver an FCM
/// message while the app is backgrounded or fully killed -- it has no access
/// to the running app's widget tree/providers, so it can only show the
/// native ringing UI from the push payload itself (server/firebase-admin.ts's
/// sendVoIPPush). The actual accept/decline handling (which needs the real
/// LiveKit join info) happens later, in the main isolate, via
/// CallKitService.startListening() once the app resumes.
@pragma('vm:entry-point')
Future<void> _firebaseMessagingBackgroundHandler(RemoteMessage message) async {
  await Firebase.initializeApp();
  final data = message.data;
  if (data['type'] == 'incoming_call') {
    await CallKitService.showIncomingCall(
      callId: data['callId'] as String? ?? '',
      callerName: data['callerName'] as String? ?? 'Unknown',
      callType: data['callType'] as String? ?? 'voice',
    );
  }
}

void main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await Firebase.initializeApp();
  FirebaseMessaging.onBackgroundMessage(_firebaseMessagingBackgroundHandler);
  CallKitService.startListening();

  // Crash reporting — Flutter framework errors and uncaught async errors
  // are forwarded to Crashlytics in release builds. Left OFF in debug so
  // local development errors don't pollute the dashboard.
  FlutterError.onError = (FlutterErrorDetails details) {
    FlutterError.presentError(details);
    if (!kDebugMode) {
      FirebaseCrashlytics.instance.recordFlutterFatalError(details);
    }
  };
  PlatformDispatcher.instance.onError = (error, stack) {
    if (!kDebugMode) {
      FirebaseCrashlytics.instance.recordError(error, stack, fatal: true);
    }
    return true;
  };
  await FirebaseCrashlytics.instance.setCrashlyticsCollectionEnabled(!kDebugMode);

  SystemChrome.setPreferredOrientations([DeviceOrientation.portraitUp]);
  SystemChrome.setSystemUIOverlayStyle(const SystemUiOverlayStyle(
    statusBarColor: Colors.transparent,
    statusBarIconBrightness: Brightness.light,
  ));
  runApp(const NeuraTalkApp());
}

class NeuraTalkApp extends StatelessWidget {
  const NeuraTalkApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MultiProvider(
      providers: [
        ChangeNotifierProvider(create: (_) => AuthProvider()..init()),
        ChangeNotifierProvider(create: (_) => CallService(), lazy: false),
        ChangeNotifierProvider(create: (_) => PersonalChatProvider()),
        ChangeNotifierProvider(create: (_) => GroupChatProvider()),
      ],
      child: MaterialApp(
        navigatorKey: navigatorKey,
        title: 'NeuraTalk',
        theme: AppTheme.dark,
        debugShowCheckedModeBanner: false,
        home: const _AppRouter(),
      ),
    );
  }
}

class _AppRouter extends StatefulWidget {
  const _AppRouter();

  @override
  State<_AppRouter> createState() => _AppRouterState();
}

class _AppRouterState extends State<_AppRouter> with WidgetsBindingObserver {
  bool _checked = false;
  bool _showingIncomingCall = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    // The incoming-call poll timer keeps running in the background per the
    // OS's whim, but there's no guarantee it fired recently right as the
    // user reopens the app — force an immediate check on resume so a call
    // that arrived while backgrounded surfaces without a stale ~4s wait.
    if (state == AppLifecycleState.resumed && mounted) {
      final auth = context.read<AuthProvider>();
      if (auth.isLoggedIn) {
        context.read<CallService>().pollNow();
      }
    }
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (!_checked) {
      _checked = true;
      final auth = context.read<AuthProvider>();
      final calls = context.read<CallService>();
      auth.addListener(() {
        if (!mounted) return;
        setState(() {});
        if (auth.isLoggedIn) {
          calls.startPolling();
          unawaited(PushService.init());
        } else {
          calls.stopPolling();
        }
      });
      calls.addListener(_onCallServiceChanged);
      if (auth.isLoggedIn) {
        calls.startPolling();
        unawaited(PushService.init());
      }
    }
  }

  bool _showingCallWaiting = false;

  void _onCallServiceChanged() {
    final calls = context.read<CallService>();
    final incoming = calls.incomingCall;
    if (incoming == null) return;

    if (calls.inActiveCall) {
      // A second real caller while already talking to someone -- must not
      // silently vanish or stack a duplicate full-screen IncomingCallScreen
      // on top of the live call. Surface it as a proper call-waiting prompt.
      if (_showingCallWaiting) return;
      _showingCallWaiting = true;
      final activeSession = calls.activeCallSession;
      showDialog<void>(
        context: navigatorKey.currentContext!,
        barrierDismissible: false,
        builder: (dialogContext) => AlertDialog(
          title: const Text('Call waiting'),
          content: Text('${incoming.remoteName} is calling while you\'re on another call.'),
          actions: [
            TextButton(
              onPressed: () async {
                Navigator.of(dialogContext).pop();
                calls.markHandledExternally(incoming.callId);
                await calls.rejectCall(incoming.callId);
                calls.clearIncomingCall();
              },
              child: const Text('Reject'),
            ),
            TextButton(
              onPressed: () async {
                Navigator.of(dialogContext).pop();
                calls.markHandledExternally(incoming.callId);
                if (activeSession != null) {
                  // Ending the current call server-side tears down its
                  // LiveKit room, which delivers the active CallScreen a
                  // RoomDisconnectedEvent and pops it via its own existing
                  // handler -- no direct reference to that screen needed.
                  await calls.endCall(activeSession.callId);
                }
                calls.clearIncomingCall();
                navigatorKey.currentState?.push(MaterialPageRoute(
                  builder: (_) => CallScreen(session: incoming, callService: calls),
                ));
              },
              child: const Text('End current & Accept'),
            ),
          ],
        ),
      ).then((_) => _showingCallWaiting = false);
      return;
    }

    if (!_showingIncomingCall) {
      _showingIncomingCall = true;
      navigatorKey.currentState
          ?.push(MaterialPageRoute(
            builder: (_) => IncomingCallScreen(session: incoming, callService: calls),
          ))
          .then((_) => _showingIncomingCall = false);
    }
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    context.read<CallService>().removeListener(_onCallServiceChanged);
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthProvider>();
    if (!auth.isLoggedIn) {
      return const OnboardingScreen();
    }
    return const MainShell();
  }
}
