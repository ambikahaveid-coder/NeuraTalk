import 'dart:io';
import 'dart:async';
import 'package:flutter/foundation.dart';
import '../services/api_service.dart';
import '../services/media_store.dart';

/// Real group chat state — wired to server/group-chats.ts. That backend has
/// no SSE stream (unlike personal-chat-routes.ts), so new messages arrive
/// via polling while a group conversation is open.
class GroupChatProvider extends ChangeNotifier {
  List<Map<String, dynamic>> groups = [];
  bool loadingGroups = false;
  String? groupsError;

  Map<String, dynamic>? activeGroup;
  List<Map<String, dynamic>> messages = [];
  bool loadingMessages = false;
  String? messagesError;

  Timer? _pollTimer;

  Future<void> loadGroups() async {
    // Screens start loading from initState; never notify listeners while a frame is building.
    await Future<void>.microtask(() {});
    loadingGroups = true;
    groupsError = null;
    notifyListeners();
    try {
      final res = await ApiService.get('/api/group-chats/my-groups') as List;
      groups = res.cast<Map<String, dynamic>>();
    } catch (e) {
      groupsError = 'Could not load groups.';
    } finally {
      loadingGroups = false;
      notifyListeners();
    }
  }

  Future<Map<String, dynamic>?> createGroup(String name) async {
    final res = await ApiService.post('/api/group-chats', {'name': name});
    await loadGroups();
    return res;
  }

  Future<void> addMember(int groupId, int userId, {String preferredLanguage = 'en'}) async {
    await ApiService.post('/api/group-chats/$groupId/members', {
      'userId': userId,
      'preferredLanguage': preferredLanguage,
    });
  }

  /// Admin-only role change -- server/group-chats.ts's PATCH enforces this
  /// server-side too; the client-side admin check in the UI is just for a
  /// better error-free experience, not the real security boundary.
  Future<void> setMemberRole(int groupId, int userId, String role) async {
    await ApiService.patch('/api/group-chats/$groupId/members/$userId', {'role': role});
  }

  /// Removes another member (admin-only) or leaves the group yourself
  /// (userId == your own id, allowed for anyone) -- same endpoint, same
  /// distinction server/group-chats.ts's DELETE handler makes.
  Future<void> removeMember(int groupId, int userId) async {
    await ApiService.delete('/api/group-chats/$groupId/members/$userId');
  }

  Future<Map<String, dynamic>> fetchGroupDetail(int groupId) async {
    return await ApiService.get('/api/group-chats/$groupId') as Map<String, dynamic>;
  }

  Future<void> openGroup(int groupId) async {
    // Screens start loading from initState; never notify listeners while a frame is building.
    await Future<void>.microtask(() {});
    loadingMessages = true;
    messagesError = null;
    messages = [];
    notifyListeners();
    try {
      final group = await ApiService.get('/api/group-chats/$groupId') as Map<String, dynamic>;
      activeGroup = group;
      await _fetchMessages(groupId);
      _startPolling(groupId);
    } catch (e) {
      messagesError = 'Could not load this group.';
    } finally {
      loadingMessages = false;
      notifyListeners();
    }
  }

  Future<void> _fetchMessages(int groupId) async {
    try {
      final res = await ApiService.get('/api/group-chats/$groupId/messages') as List;
      messages = res.cast<Map<String, dynamic>>();
      notifyListeners();
    } catch (_) {}
  }

  void _startPolling(int groupId) {
    _pollTimer?.cancel();
    _pollTimer = Timer.periodic(const Duration(seconds: 4), (_) => _fetchMessages(groupId));
  }

  void closeGroup() {
    activeGroup = null;
    messages = [];
    _pollTimer?.cancel();
    _pollTimer = null;
  }

  Future<void> sendMessage(int groupId, String content) async {
    final clientKey = DateTime.now().microsecondsSinceEpoch;
    final optimistic = {
      'id': clientKey,
      'senderId': -1, // marks own optimistic bubble; replaced on refetch
      'displayContent': content,
      'originalContent': content,
      'messageType': 'text',
      'createdAt': DateTime.now().toIso8601String(),
      '_pending': true,
    };
    messages = [...messages, optimistic];
    notifyListeners();
    try {
      await ApiService.post('/api/group-chats/$groupId/messages', {
        'content': content,
        'messageType': 'text',
      });
    } finally {
      await _fetchMessages(groupId);
    }
  }

  /// Uploads a photo/video/file and posts it to the group (see MediaStore).
  Future<void> sendAttachment(
    int groupId,
    File file,
    String name, {
    void Function(double progress)? onProgress,
    UploadCancelToken? cancelToken,
  }) async {
    final size = await file.length();
    final mime = MediaStore.contentTypeFor(name);
    final kind = MediaStore.kindOf(name);
    final objectPath = await MediaStore.upload(file, name, onProgress: onProgress, cancelToken: cancelToken);
    try {
      await ApiService.post('/api/group-chats/$groupId/messages', {
        'content': kind == MediaKind.image ? 'Photo' : (kind == MediaKind.video ? 'Video' : name),
        'messageType': kind == MediaKind.image ? 'attachment' : 'file',
        'attachmentUrl': objectPath,
        'attachmentTitle': name,
        'attachmentSize': size,
        'attachmentMime': mime,
      });
    } finally {
      await _fetchMessages(groupId);
    }
  }

  Future<void> deleteMessage(int groupId, int messageId) async {
    await ApiService.delete('/api/group-chats/$groupId/messages/$messageId');
    messages.removeWhere((m) => m['id'] == messageId);
    notifyListeners();
  }

  @override
  void dispose() {
    _pollTimer?.cancel();
    super.dispose();
  }
}
