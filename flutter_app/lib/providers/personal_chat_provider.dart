import 'dart:async';
import 'dart:convert';
import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;
import '../services/api_service.dart';

/// Real user-to-user chat state — wired to server/personal-chat-routes.ts.
/// Separate from the NEURA AI assistant (which uses /api/ai/chat and its
/// own screen/provider); this must never mix with that conversation data.
class PersonalChatProvider extends ChangeNotifier {
  List<Map<String, dynamic>> threads = [];
  bool loadingThreads = false;
  String? threadsError;

  Map<String, dynamic>? activeThread;
  List<Map<String, dynamic>> messages = [];
  bool loadingMessages = false;
  String? messagesError;

  bool peerTyping = false;
  DateTime? peerLastActiveAt;
  bool peerRecentlyActive = false;

  StreamSubscription<String>? _sseSub;
  http.Client? _sseClient;
  Timer? _presenceTimer;
  Timer? _typingStopTimer;
  bool _iAmTyping = false;

  Future<void> loadThreads() async {
    loadingThreads = true;
    threadsError = null;
    notifyListeners();
    try {
      final res = await ApiService.get('/api/personal-chats') as Map<String, dynamic>;
      threads = (res['threads'] as List).cast<Map<String, dynamic>>();
    } catch (e) {
      threadsError = 'Could not load conversations.';
    } finally {
      loadingThreads = false;
      notifyListeners();
    }
  }

  Future<Map<String, dynamic>?> startThread({int? userId, String? identifier}) async {
    try {
      final res = await ApiService.post('/api/personal-chats', {
        if (userId != null) 'userId': userId,
        if (identifier != null) 'identifier': identifier,
      });
      return res['thread'] as Map<String, dynamic>?;
    } on ApiException {
      rethrow;
    }
  }

  Future<void> openThread(int threadId) async {
    loadingMessages = true;
    messagesError = null;
    messages = [];
    peerTyping = false;
    peerLastActiveAt = null;
    notifyListeners();

    try {
      final res = await ApiService.get('/api/personal-chats/$threadId') as Map<String, dynamic>;
      activeThread = res['thread'] as Map<String, dynamic>?;
      messages = (res['messages'] as List).cast<Map<String, dynamic>>();
      unawaited(markSeen(threadId));
      _startPresencePolling(threadId);
    } catch (e) {
      messagesError = 'Could not load this conversation.';
    } finally {
      loadingMessages = false;
      notifyListeners();
    }
  }

  void closeThread() {
    activeThread = null;
    messages = [];
    _presenceTimer?.cancel();
    _presenceTimer = null;
    if (_iAmTyping) {
      _iAmTyping = false;
    }
  }

  Future<void> sendMessage(
    int threadId,
    String content, {
    String messageType = 'text',
    String? attachmentUrl,
    String? attachmentTitle,
    int? replyToId,
  }) async {
    final clientMessageId = '${DateTime.now().microsecondsSinceEpoch}';
    final optimistic = {
      'id': clientMessageId,
      'clientMessageId': clientMessageId,
      'threadId': threadId,
      'isOwn': true,
      'displayContent': content,
      'originalContent': content,
      'messageType': messageType,
      'attachmentUrl': attachmentUrl,
      'attachmentTitle': attachmentTitle,
      'replyToId': replyToId,
      'deliveryStatus': 'sending',
      'createdAt': DateTime.now().toIso8601String(),
    };
    messages = [...messages, optimistic];
    notifyListeners();

    try {
      final res = await ApiService.post('/api/personal-chats/$threadId/messages', {
        'content': content,
        'clientMessageId': clientMessageId,
        'messageType': messageType,
        if (attachmentUrl != null) 'attachmentUrl': attachmentUrl,
        if (attachmentTitle != null) 'attachmentTitle': attachmentTitle,
        if (replyToId != null) 'replyToId': replyToId,
      });
      final saved = res['message'] as Map<String, dynamic>;
      final idx = messages.indexWhere((m) => m['clientMessageId'] == clientMessageId);
      if (idx != -1) {
        messages[idx] = saved;
      } else {
        messages.add(saved);
      }
    } catch (e) {
      final idx = messages.indexWhere((m) => m['clientMessageId'] == clientMessageId);
      if (idx != -1) {
        messages[idx] = {...messages[idx], 'deliveryStatus': 'failed'};
      }
    } finally {
      notifyListeners();
    }
  }

  Future<void> retryMessage(int threadId, Map<String, dynamic> failedMessage) async {
    final idx = messages.indexWhere((m) => m['clientMessageId'] == failedMessage['clientMessageId']);
    if (idx != -1) {
      messages[idx] = {...messages[idx], 'deliveryStatus': 'sending'};
      notifyListeners();
    }
    try {
      final res = await ApiService.post('/api/personal-chats/$threadId/messages', {
        'content': failedMessage['originalContent'],
        'clientMessageId': failedMessage['clientMessageId'],
        'messageType': failedMessage['messageType'] ?? 'text',
        if (failedMessage['attachmentUrl'] != null) 'attachmentUrl': failedMessage['attachmentUrl'],
        if (failedMessage['attachmentTitle'] != null) 'attachmentTitle': failedMessage['attachmentTitle'],
      });
      final saved = res['message'] as Map<String, dynamic>;
      final i2 = messages.indexWhere((m) => m['clientMessageId'] == failedMessage['clientMessageId']);
      if (i2 != -1) messages[i2] = saved;
    } catch (_) {
      final i2 = messages.indexWhere((m) => m['clientMessageId'] == failedMessage['clientMessageId']);
      if (i2 != -1) messages[i2] = {...messages[i2], 'deliveryStatus': 'failed'};
    } finally {
      notifyListeners();
    }
  }

  Future<void> markSeen(int threadId) async {
    try {
      await ApiService.post('/api/personal-chats/$threadId/seen', {});
    } catch (_) {}
  }

  /// Delete for everyone -- server clears the content; only the sender may
  /// call this (server enforces it too).
  Future<void> deleteMessage(int threadId, int messageId) async {
    final idx = messages.indexWhere((m) => m['id'] == messageId);
    try {
      await ApiService.delete('/api/personal-chats/$threadId/messages/$messageId');
      if (idx != -1) {
        messages[idx] = {
          ...messages[idx],
          'isDeleted': true,
          'displayContent': 'This message was deleted',
          'originalContent': '',
          'attachmentUrl': null,
          'showingTranslated': false,
        };
        notifyListeners();
      }
    } catch (_) {
      rethrow;
    }
  }

  /// Clears this thread from the caller's own view only -- the other
  /// participant's messages are untouched.
  Future<void> clearChat(int threadId) async {
    await ApiService.post('/api/personal-chats/$threadId/clear', {});
    messages = [];
    notifyListeners();
  }

  /// Pin/archive/mute are per-viewer (server/personal-chat-routes.ts's
  /// PATCH .../state) -- updates the local thread list optimistically so
  /// the list re-sorts/re-filters immediately.
  Future<void> updateThreadState(int threadId, {bool? pinned, bool? archived, bool? muted}) async {
    await ApiService.patch('/api/personal-chats/$threadId/state', {
      if (pinned != null) 'pinned': pinned,
      if (archived != null) 'archived': archived,
      if (muted != null) 'muted': muted,
    });
    final idx = threads.indexWhere((t) => t['id'] == threadId);
    if (idx != -1) {
      threads[idx] = {
        ...threads[idx],
        if (pinned != null) 'isPinned': pinned,
        if (archived != null) 'isArchived': archived,
        if (muted != null) 'isMuted': muted,
      };
      notifyListeners();
    }
  }

  /// Disappearing messages -- shared per-thread, not per-viewer.
  Future<void> setDisappearing(int threadId, int seconds) async {
    await ApiService.patch('/api/personal-chats/$threadId/disappearing', {'seconds': seconds});
    if (activeThread != null && activeThread!['id'] == threadId) {
      activeThread = {...activeThread!, 'disappearingSeconds': seconds == 0 ? null : seconds};
      notifyListeners();
    }
  }

  /// Debounced typing: call on every keystroke. Sends isTyping=true at most
  /// once per burst, and auto-sends isTyping=false after 3s of silence
  /// (matches the server's own 8s TTL with margin to spare).
  void onTextChanged(int threadId, String text) {
    _typingStopTimer?.cancel();
    if (text.trim().isEmpty) {
      if (_iAmTyping) {
        _iAmTyping = false;
        unawaited(_setTyping(threadId, false));
      }
      return;
    }
    if (!_iAmTyping) {
      _iAmTyping = true;
      unawaited(_setTyping(threadId, true));
    }
    _typingStopTimer = Timer(const Duration(seconds: 3), () {
      _iAmTyping = false;
      unawaited(_setTyping(threadId, false));
    });
  }

  Future<void> _setTyping(int threadId, bool isTyping) async {
    try {
      await ApiService.post('/api/personal-chats/$threadId/typing', {'isTyping': isTyping});
    } catch (_) {}
  }

  void _startPresencePolling(int threadId) {
    _presenceTimer?.cancel();
    _refreshPresence(threadId);
    _presenceTimer = Timer.periodic(const Duration(seconds: 8), (_) => _refreshPresence(threadId));
  }

  Future<void> _refreshPresence(int threadId) async {
    try {
      final res = await ApiService.get('/api/personal-chats/$threadId/presence') as Map<String, dynamic>;
      peerTyping = res['isTyping'] == true;
      peerRecentlyActive = res['isRecentlyActive'] == true;
      final raw = res['lastActiveAt'] as String?;
      peerLastActiveAt = raw != null ? DateTime.tryParse(raw) : null;
      notifyListeners();
    } catch (_) {}
  }

  // --- SSE realtime updates ---------------------------------------------

  void connectStream() {
    if (_sseSub != null) return;
    _openSse();
  }

  void _openSse() {
    if (!ApiService.isLoggedIn) return;
    final client = http.Client();
    _sseClient = client;
    final request = http.Request('GET', Uri.parse('${ApiService.baseUrl}/api/personal-chats/stream'));
    request.headers['Authorization'] = 'Bearer ${ApiService.token}';
    request.headers['Accept'] = 'text/event-stream';

    client.send(request).then((streamed) {
      if (streamed.statusCode != 200) {
        _scheduleReconnect();
        return;
      }
      String buffer = '';
      _sseSub = streamed.stream.transform(utf8.decoder).listen(
        (chunk) {
          buffer += chunk;
          while (buffer.contains('\n\n')) {
            final idx = buffer.indexOf('\n\n');
            final rawEvent = buffer.substring(0, idx);
            buffer = buffer.substring(idx + 2);
            _handleSseEvent(rawEvent);
          }
        },
        onError: (_) => _scheduleReconnect(),
        onDone: () => _scheduleReconnect(),
        cancelOnError: true,
      );
    }).catchError((_) {
      _scheduleReconnect();
    });
  }

  void _handleSseEvent(String rawEvent) {
    final line = rawEvent.split('\n').firstWhere((l) => l.startsWith('data:'), orElse: () => '');
    if (line.isEmpty) return;
    Map<String, dynamic> payload;
    try {
      payload = jsonDecode(line.substring(5).trim()) as Map<String, dynamic>;
    } catch (_) {
      return;
    }

    final type = payload['type'] as String?;
    switch (type) {
      case 'message_created':
        final threadId = payload['threadId'];
        if (activeThread != null && activeThread!['id'].toString() == threadId.toString()) {
          // Peer's message landed while we're viewing this thread — reload
          // just the tail rather than guessing the shape from the event.
          openThread(threadId is int ? threadId : int.parse(threadId.toString()));
        }
        loadThreads();
        break;
      case 'typing':
        if (activeThread != null && activeThread!['id'].toString() == payload['threadId'].toString()) {
          final senderId = payload['senderUserId'];
          if (senderId != null && senderId.toString() != _selfIdHint) {
            peerTyping = payload['isTyping'] == true;
            notifyListeners();
          }
        }
        break;
      case 'messages_seen':
      case 'messages_delivered':
        if (activeThread != null && activeThread!['id'].toString() == payload['threadId'].toString()) {
          final threadId = payload['threadId'];
          openThread(threadId is int ? threadId : int.parse(threadId.toString()));
        }
        break;
      case 'thread_created':
      case 'thread_updated':
        loadThreads();
        break;
    }
  }

  /// Set by the caller (main_shell) so the typing event self-check above can
  /// ignore our own typing echoes without needing AuthProvider injected here.
  String? _selfIdHint;
  void setSelfId(String? id) => _selfIdHint = id;

  void _scheduleReconnect() {
    _sseSub?.cancel();
    _sseSub = null;
    _sseClient?.close();
    _sseClient = null;
    if (!ApiService.isLoggedIn) return;
    Future.delayed(const Duration(seconds: 4), () {
      if (_sseSub == null) _openSse();
    });
  }

  void disconnectStream() {
    _sseSub?.cancel();
    _sseSub = null;
    _sseClient?.close();
    _sseClient = null;
    _presenceTimer?.cancel();
    _presenceTimer = null;
  }

  @override
  void dispose() {
    disconnectStream();
    _typingStopTimer?.cancel();
    super.dispose();
  }
}
