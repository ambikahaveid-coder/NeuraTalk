import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../theme/app_theme.dart';
import '../providers/group_chat_provider.dart';
import '../providers/auth_provider.dart';

/// Real group conversation -- server/group-chats.ts. Polls for new messages
/// (that backend has no SSE stream, unlike 1:1 chat).
class GroupConversationScreen extends StatefulWidget {
  final int groupId;
  const GroupConversationScreen({super.key, required this.groupId});

  @override
  State<GroupConversationScreen> createState() => _GroupConversationScreenState();
}

class _GroupConversationScreenState extends State<GroupConversationScreen> {
  final _msgCtrl = TextEditingController();
  final _scrollCtrl = ScrollController();

  @override
  void initState() {
    super.initState();
    context.read<GroupChatProvider>().openGroup(widget.groupId).then((_) => _scrollToBottom());
  }

  @override
  void dispose() {
    context.read<GroupChatProvider>().closeGroup();
    _msgCtrl.dispose();
    _scrollCtrl.dispose();
    super.dispose();
  }

  void _scrollToBottom() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (_scrollCtrl.hasClients) {
        _scrollCtrl.animateTo(_scrollCtrl.position.maxScrollExtent, duration: const Duration(milliseconds: 250), curve: Curves.easeOut);
      }
    });
  }

  void _send() {
    final text = _msgCtrl.text.trim();
    if (text.isEmpty) return;
    _msgCtrl.clear();
    context.read<GroupChatProvider>().sendMessage(widget.groupId, text);
    _scrollToBottom();
  }

  @override
  Widget build(BuildContext context) {
    final provider = context.watch<GroupChatProvider>();
    final selfId = context.read<AuthProvider>().user?['id'];
    final groupName = provider.activeGroup?['name']?.toString() ?? 'Group';
    final members = (provider.activeGroup?['members'] as List?) ?? const [];

    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(
        title: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(groupName, style: const TextStyle(color: AppColors.white, fontSize: 16, fontWeight: FontWeight.w600)),
            Text('${members.length} member${members.length == 1 ? '' : 's'}', style: const TextStyle(color: AppColors.textMuted, fontSize: 11)),
          ],
        ),
      ),
      body: Column(
        children: [
          Expanded(
            child: provider.loadingMessages
                ? const Center(child: CircularProgressIndicator(color: AppColors.cyan))
                : provider.messagesError != null
                    ? Center(child: Text(provider.messagesError!, style: const TextStyle(color: AppColors.red)))
                    : provider.messages.isEmpty
                        ? const Center(child: Text('No messages yet — say hello 👋', style: TextStyle(color: AppColors.textMuted)))
                        : ListView.builder(
                            controller: _scrollCtrl,
                            padding: const EdgeInsets.all(16),
                            itemCount: provider.messages.length,
                            itemBuilder: (_, i) => _GroupMessageBubble(
                              message: provider.messages[i],
                              isOwn: provider.messages[i]['senderId'] == selfId || provider.messages[i]['senderId'] == -1,
                            ),
                          ),
          ),
          _inputBar(),
        ],
      ),
    );
  }

  Widget _inputBar() {
    return Container(
      padding: const EdgeInsets.fromLTRB(16, 8, 16, 16),
      color: AppColors.backgroundMid,
      child: Row(
        children: [
          Expanded(
            child: TextField(
              controller: _msgCtrl,
              style: const TextStyle(color: AppColors.white),
              decoration: const InputDecoration(
                hintText: 'Message...',
                hintStyle: TextStyle(color: AppColors.textMuted),
                border: OutlineInputBorder(borderRadius: BorderRadius.all(Radius.circular(24)), borderSide: BorderSide.none),
                filled: true,
                fillColor: AppColors.surface,
                contentPadding: EdgeInsets.symmetric(horizontal: 20, vertical: 12),
              ),
              onSubmitted: (_) => _send(),
            ),
          ),
          const SizedBox(width: 8),
          GestureDetector(
            onTap: _send,
            child: Container(
              padding: const EdgeInsets.all(14),
              decoration: const BoxDecoration(color: AppColors.cyan, shape: BoxShape.circle),
              child: const Icon(Icons.send, color: AppColors.background, size: 20),
            ),
          ),
        ],
      ),
    );
  }
}

class _GroupMessageBubble extends StatelessWidget {
  final Map<String, dynamic> message;
  final bool isOwn;
  const _GroupMessageBubble({required this.message, required this.isOwn});

  @override
  Widget build(BuildContext context) {
    final content = message['displayContent']?.toString() ?? message['originalContent']?.toString() ?? '';
    final senderName = (message['sender'] as Map<String, dynamic>?)?['username']?.toString();
    final showingTranslated = message['originalLanguage'] != null &&
        message['displayContent'] != null &&
        message['displayContent'] != message['originalContent'];

    return Align(
      alignment: isOwn ? Alignment.centerRight : Alignment.centerLeft,
      child: Container(
        margin: const EdgeInsets.symmetric(vertical: 4),
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
        constraints: BoxConstraints(maxWidth: MediaQuery.of(context).size.width * 0.75),
        decoration: BoxDecoration(
          color: isOwn ? AppColors.cyan : AppColors.surface,
          borderRadius: BorderRadius.only(
            topLeft: const Radius.circular(18),
            topRight: const Radius.circular(18),
            bottomLeft: Radius.circular(isOwn ? 18 : 4),
            bottomRight: Radius.circular(isOwn ? 4 : 18),
          ),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisSize: MainAxisSize.min,
          children: [
            if (!isOwn && senderName != null)
              Padding(
                padding: const EdgeInsets.only(bottom: 2),
                child: Text(senderName, style: const TextStyle(color: AppColors.cyan, fontSize: 11, fontWeight: FontWeight.w700)),
              ),
            Text(content, style: TextStyle(color: isOwn ? AppColors.background : AppColors.textPrimary, fontSize: 14, height: 1.4)),
            if (showingTranslated) ...[
              const SizedBox(height: 4),
              Text(
                'Translated · original: ${message['originalContent']}',
                style: TextStyle(color: (isOwn ? AppColors.background : AppColors.textPrimary).withOpacity(0.6), fontSize: 10, fontStyle: FontStyle.italic),
              ),
            ],
            if (message['_pending'] == true) ...[
              const SizedBox(height: 4),
              const Text('Sending…', style: TextStyle(color: AppColors.textMuted, fontSize: 10)),
            ],
          ],
        ),
      ),
    );
  }
}
