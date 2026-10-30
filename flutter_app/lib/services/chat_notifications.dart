import 'dart:convert';
import 'dart:ui' show DartPluginRegistrant;

import 'package:flutter/foundation.dart';
import 'package:flutter/painting.dart' show Color;
import 'package:flutter_local_notifications/flutter_local_notifications.dart';

import 'api_service.dart';

/// Chat message notifications the app shows itself (Android), so they can
/// carry a Reply button: type an answer in the notification and it is sent
/// without opening the app. The server sends these as data-only pushes only
/// to app versions that registered the `chatInlineReply` capability.
class ChatNotifications {
  ChatNotifications._();

  static final _plugin = FlutterLocalNotificationsPlugin();
  static bool _ready = false;
  static void Function(Map<String, dynamic> data)? _onOpen;

  static const _channel = AndroidNotificationChannel(
    'chat_messages',
    'Messages',
    description: 'New chat and group messages',
    importance: Importance.high,
  );

  static const _replyAction = 'reply';

  static const _replyableTypes = {'personal_chat_message', 'group_chat_message', 'business_message', 'business_inbox_message'};

  static bool isChatPush(Map<String, dynamic> data) => _replyableTypes.contains(data['type']) && data['title'] != null;

  /// [onOpen] is called with the push data when a notification is tapped
  /// while the app runs (also used for the tap that launched the app).
  static Future<void> init({void Function(Map<String, dynamic> data)? onOpen}) async {
    if (onOpen != null) _onOpen = onOpen;
    if (_ready) return;
    await _plugin.initialize(
      const InitializationSettings(android: AndroidInitializationSettings('@drawable/ic_stat_message')),
      onDidReceiveNotificationResponse: _onResponse,
      onDidReceiveBackgroundNotificationResponse: notificationResponseInBackground,
    );
    await _plugin
        .resolvePlatformSpecificImplementation<AndroidFlutterLocalNotificationsPlugin>()
        ?.createNotificationChannel(_channel);
    _ready = true;
  }

  /// The tap that started the app from a chat notification, if any.
  static Future<Map<String, dynamic>?> launchData() async {
    final details = await _plugin.getNotificationAppLaunchDetails();
    final response = details?.notificationResponse;
    if (details?.didNotificationLaunchApp != true || response == null || response.actionId == _replyAction) return null;
    return _decode(response.payload);
  }

  static int _idFor(Map<String, dynamic> data) {
    final key = '${data['type']}:${data['threadId'] ?? data['groupId'] ?? '${data['businessId'] ?? ''}/${data['conversationId'] ?? ''}'}';
    return key.hashCode & 0x7fffffff;
  }

  static Map<String, dynamic>? _decode(String? payload) {
    if (payload == null || payload.isEmpty) return null;
    try {
      final value = jsonDecode(payload);
      return value is Map ? Map<String, dynamic>.from(value) : null;
    } catch (_) {
      return null;
    }
  }

  /// One notification per chat (a newer message replaces the older one).
  static Future<void> showChat(Map<String, dynamic> data) async {
    await init();
    final title = data['title']?.toString() ?? 'New message';
    final body = data['body']?.toString() ?? '';
    final payload = jsonEncode({
      'type': data['type'],
      if (data['threadId'] != null) 'threadId': data['threadId'],
      if (data['groupId'] != null) 'groupId': data['groupId'],
      if (data['businessId'] != null) 'businessId': data['businessId'],
      if (data['conversationId'] != null) 'conversationId': data['conversationId'],
      'title': title,
    });
    await _plugin.show(
      _idFor(data),
      title,
      body,
      NotificationDetails(
        android: AndroidNotificationDetails(
          _channel.id,
          _channel.name,
          channelDescription: _channel.description,
          importance: Importance.high,
          priority: Priority.high,
          category: AndroidNotificationCategory.message,
          color: const Color(0xFF1E66F5),
          styleInformation: BigTextStyleInformation(body),
          actions: const [
            AndroidNotificationAction(
              _replyAction,
              'Reply',
              inputs: [AndroidNotificationActionInput(label: 'Message')],
              showsUserInterface: false,
              cancelNotification: false,
            ),
          ],
        ),
      ),
      payload: payload,
    );
  }

  static void _onResponse(NotificationResponse response) {
    if (response.actionId == _replyAction) {
      sendReply(response);
      return;
    }
    final data = _decode(response.payload);
    if (data != null) _onOpen?.call(data);
  }

  /// Sends the typed reply to the chat, then updates the notification.
  static Future<void> sendReply(NotificationResponse response) async {
    final data = _decode(response.payload);
    final text = response.input?.trim() ?? '';
    if (data == null || text.isEmpty) return;
    await init();
    await ApiService.init(); // may run in a background isolate
    final id = _idFor(data);
    try {
      if (data['type'] == 'group_chat_message' && data['groupId'] != null) {
        await ApiService.post('/api/group-chats/${data['groupId']}/messages', {'content': text, 'messageType': 'text'});
      } else if (data['type'] == 'business_message' && data['businessId'] != null) {
        // Customer answering a business.
        await ApiService.post('/api/messaging/business/${data['businessId']}/messages', {'content': text});
      } else if (data['type'] == 'business_inbox_message' && data['businessId'] != null && data['conversationId'] != null) {
        // Business team member answering a customer.
        await ApiService.post('/api/business/${data['businessId']}/conversations/${data['conversationId']}/messages', {'content': text});
      } else if (data['threadId'] != null) {
        await ApiService.post('/api/personal-chats/${data['threadId']}/messages', {
          'content': text,
          'clientMessageId': 'notif-${DateTime.now().microsecondsSinceEpoch}',
        });
      } else {
        return;
      }
      await _plugin.cancel(id);
    } catch (e) {
      debugPrint('Reply from notification failed: $e');
      await _plugin.show(
        id,
        data['title']?.toString() ?? 'NeuraTalk',
        'Not sent: "$text". Tap to open the chat.',
        NotificationDetails(
          android: AndroidNotificationDetails(_channel.id, _channel.name, importance: Importance.high, priority: Priority.high),
        ),
        payload: jsonEncode(data),
      );
    }
  }
}

/// Reply typed while the app is in the background or closed.
@pragma('vm:entry-point')
void notificationResponseInBackground(NotificationResponse response) {
  // A separate isolate: plugins (secure storage for the session) need registering.
  DartPluginRegistrant.ensureInitialized();
  ChatNotifications.sendReply(response);
}
