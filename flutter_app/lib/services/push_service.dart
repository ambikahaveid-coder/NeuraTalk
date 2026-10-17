import 'dart:async';
import 'dart:io';
import 'dart:math';

import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../main.dart' show navigatorKey;
import '../models/push_target.dart';
import '../providers/personal_chat_provider.dart';
import '../screens/conversation_screen.dart';
import '../screens/group_conversation_screen.dart';
import 'api_service.dart';
import 'call_service.dart';
import 'callkit_service.dart';

/// Registers each signed-in device for FCM pushes and routes message taps.
class PushService {
  static const _deviceIdKey = 'push_device_id';
  static bool _listenersStarted = false;
  static bool _foregroundListening = false;
  static bool _openingMessage = false;
  static int? _activeUserId;
  static int? _registeredUserId;
  static String? _registeredToken;
  static RemoteMessage? _pendingTap;
  static String? _lastOpenedMessageId;
  static Future<void>? _initialMessageFuture;
  static Future<void>? _initializing;
  static StreamSubscription<String>? _tokenRefreshSubscription;

  /// Start tap listeners before authentication completes so a cold-start tap
  /// is retained until the session and navigator are ready.
  static void startListening() {
    if (_listenersStarted) return;
    _listenersStarted = true;

    _listenForegroundMessages();
    FirebaseMessaging.onMessageOpenedApp.listen(
      (message) => unawaited(_queueMessageTap(message)),
      onError: (Object error) => debugPrint('Push tap listener failed: $error'),
    );
    _initialMessageFuture =
        FirebaseMessaging.instance.getInitialMessage().then((message) {
      if (message != null) _pendingTap = message;
    }).catchError((Object error) {
      debugPrint('Could not read the notification that opened the app: $error');
    });
  }

  static Future<void> init({required int userId}) async {
    startListening();
    if (!ApiService.isLoggedIn) return;
    _activeUserId = userId;

    if (_initializing != null) {
      try {
        await _initializing;
      } catch (error) {
        debugPrint('Previous push initialization failed: $error');
      }
      if (_registeredUserId == userId && _registeredToken != null) {
        await _openPendingTap();
        return;
      }
    }

    final initialization = _initialize(userId);
    _initializing = initialization;
    try {
      await initialization;
    } catch (error) {
      debugPrint('Could not initialize message notifications: $error');
    } finally {
      if (identical(_initializing, initialization)) _initializing = null;
    }
  }

  static Future<void> _initialize(int userId) async {
    await _initialMessageFuture;

    final settings = await FirebaseMessaging.instance.requestPermission(
      alert: true,
      badge: true,
      sound: true,
    );
    if (settings.authorizationStatus == AuthorizationStatus.denied) {
      debugPrint('Message notifications are disabled in system settings.');
      await _openPendingTap();
      return;
    }

    unawaited(CallKitService.requestPermissions());
    final token = await FirebaseMessaging.instance.getToken();
    if (token == null || token.isEmpty) {
      debugPrint(
          'FCM has not issued a device token yet; will retry on resume or token refresh.');
    } else {
      await _register(token, userId);
    }

    _tokenRefreshSubscription ??=
        FirebaseMessaging.instance.onTokenRefresh.listen(
      (newToken) {
        final activeUserId = _activeUserId;
        if (activeUserId != null && ApiService.isLoggedIn) {
          unawaited(_register(newToken, activeUserId));
        }
      },
      onError: (Object error) =>
          debugPrint('FCM token refresh listener failed: $error'),
    );

    await _openPendingTap();
  }

  static void _listenForegroundMessages() {
    if (_foregroundListening) return;
    _foregroundListening = true;
    FirebaseMessaging.onMessage.listen((message) {
      final data = message.data;
      if (data['type'] == 'incoming_call') {
        final ctx = navigatorKey.currentContext;
        if (ctx != null && ctx.mounted) {
          ctx.read<CallService>().pollNow();
        } else {
          unawaited(CallKitService.showIncomingCall(
            callId: data['callId'] as String? ?? '',
            callerName: data['callerName'] as String? ?? 'Unknown',
            callType: data['callType'] as String? ?? 'voice',
          ));
        }
        return;
      }

      final notification = message.notification;
      final context = navigatorKey.currentContext;
      if (notification == null || context == null || !context.mounted) return;
      ScaffoldMessenger.maybeOf(context)?.showSnackBar(
        SnackBar(
          content: Text(
            notification.body == null || notification.body!.isEmpty
                ? notification.title ?? 'New message'
                : '${notification.title ?? 'New message'}: ${notification.body}',
            maxLines: 2,
            overflow: TextOverflow.ellipsis,
          ),
          action: PushTarget.fromData(data) == null
              ? null
              : SnackBarAction(
                  label: 'Open',
                  onPressed: () => unawaited(_queueMessageTap(message)),
                ),
        ),
      );
    }, onError: (Object error) {
      debugPrint('Foreground notification listener failed: $error');
    });
  }

  static Future<void> _queueMessageTap(RemoteMessage message) async {
    _pendingTap = message;
    await _openPendingTap();
  }

  static Future<void> _openPendingTap() async {
    final message = _pendingTap;
    if (message == null || _openingMessage) return;

    final context = navigatorKey.currentContext;
    final navigator = navigatorKey.currentState;
    if (!ApiService.isLoggedIn || context == null || navigator == null) return;

    final target = PushTarget.fromData(message.data);
    if (target == null) {
      debugPrint(
          'Notification tap did not include a supported chat destination.');
      _pendingTap = null;
      return;
    }
    if (message.messageId != null &&
        message.messageId == _lastOpenedMessageId) {
      _pendingTap = null;
      return;
    }

    _openingMessage = true;
    _pendingTap = null;
    final messenger = ScaffoldMessenger.maybeOf(context);
    try {
      switch (target.type) {
        case PushTargetType.personalChat:
          final chats = context.read<PersonalChatProvider>();
          await chats.loadThreads();
          if (!context.mounted || navigatorKey.currentState != navigator) {
            _pendingTap = message;
            return;
          }
          Map<String, dynamic>? thread;
          for (final item in chats.threads) {
            if (int.tryParse(item['id']?.toString() ?? '') == target.id) {
              thread = item;
              break;
            }
          }
          thread ??= await _fetchPersonalThread(target.id);
          if (thread == null) {
            throw StateError('This conversation is no longer available.');
          }
          unawaited(navigator.push(MaterialPageRoute(
            builder: (_) => ConversationScreen(thread: thread!),
          )));
          break;
        case PushTargetType.groupChat:
          unawaited(navigator.push(MaterialPageRoute(
            builder: (_) => GroupConversationScreen(groupId: target.id),
          )));
          break;
      }
      _lastOpenedMessageId = message.messageId;
    } catch (error) {
      debugPrint(
          'Could not open the conversation from its notification: $error');
      _pendingTap = message;
      messenger?.showSnackBar(const SnackBar(
        content: Text(
            "Couldn't open that conversation. Check your connection and try again."),
      ));
    } finally {
      _openingMessage = false;
    }
  }

  static Future<Map<String, dynamic>?> _fetchPersonalThread(
      int threadId) async {
    try {
      final result = await ApiService.get('/api/personal-chats/$threadId');
      if (result is! Map<String, dynamic>) return null;
      final thread = result['thread'];
      return thread is Map ? Map<String, dynamic>.from(thread) : null;
    } catch (error) {
      debugPrint('Could not load the notification conversation: $error');
      return null;
    }
  }

  static Future<void> _register(String pushToken, int userId) async {
    if (_registeredUserId == userId && _registeredToken == pushToken) return;

    final deviceId = await _stableDeviceId();
    for (var attempt = 0; attempt < 3; attempt++) {
      try {
        await ApiService.post('/api/notifications/device-token', {
          'deviceId': deviceId,
          'platform': Platform.isIOS ? 'ios' : 'android',
          'token': pushToken,
        });
        _registeredUserId = userId;
        _registeredToken = pushToken;
        return;
      } catch (error) {
        debugPrint(
            'FCM device registration attempt ${attempt + 1} failed: $error');
        if (attempt < 2) {
          await Future<void>.delayed(Duration(seconds: 1 << attempt));
        }
      }
    }
  }

  /// Remove this account's token before clearing its session to prevent this
  /// device receiving messages for an account that has signed out.
  static Future<void> unregisterCurrentDevice() async {
    if (ApiService.isLoggedIn) {
      try {
        final deviceId = await _stableDeviceId();
        await ApiService.delete(
          '/api/notifications/device-token/${Uri.encodeComponent(deviceId)}',
        );
      } catch (error) {
        debugPrint(
            'Could not unregister this device from push notifications: $error');
      }
    }
    _activeUserId = null;
    _registeredUserId = null;
    _registeredToken = null;
  }

  static Future<String> _stableDeviceId() async {
    final prefs = await SharedPreferences.getInstance();
    final existing = prefs.getString(_deviceIdKey);
    if (existing != null) return existing;
    final generated =
        List.generate(24, (_) => Random.secure().nextInt(16).toRadixString(16))
            .join();
    await prefs.setString(_deviceIdKey, generated);
    return generated;
  }
}
