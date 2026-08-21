import 'dart:async';
import 'package:flutter/foundation.dart';
import '../services/api_service.dart';

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

  Future<void> openGroup(int groupId) async {
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

  @override
  void dispose() {
    _pollTimer?.cancel();
    super.dispose();
  }
}
