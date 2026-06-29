import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../theme/app_theme.dart';
import '../providers/auth_provider.dart';
import '../services/api_service.dart';

class ChatScreen extends StatefulWidget {
  const ChatScreen({super.key});

  @override
  State<ChatScreen> createState() => _ChatScreenState();
}

class _ChatScreenState extends State<ChatScreen> {
  final _msgCtrl = TextEditingController();
  final _scrollCtrl = ScrollController();
  List<Map<String, dynamic>> _messages = [];
  List<Map<String, dynamic>> _conversations = [];
  bool _loading = true;
  Map<String, dynamic>? _activeConversation;

  @override
  void initState() {
    super.initState();
    _loadConversations();
  }

  Future<void> _loadConversations() async {
    try {
      final data = await ApiService.get('/api/conversations') as List;
      setState(() {
        _conversations = data.cast<Map<String, dynamic>>();
        _loading = false;
      });
    } catch (_) {
      setState(() => _loading = false);
    }
  }

  Future<void> _sendMessage() async {
    final text = _msgCtrl.text.trim();
    if (text.isEmpty || _activeConversation == null) return;
    _msgCtrl.clear();
    final tempMsg = {'content': text, 'role': 'user', 'createdAt': DateTime.now().toIso8601String()};
    setState(() => _messages.add(tempMsg));
    _scrollToBottom();
    try {
      final res = await ApiService.post('/api/ai/chat', {
        'message': text,
        'conversationId': _activeConversation!['id'],
      }) as Map<String, dynamic>;
      setState(() => _messages.add(res['message'] as Map<String, dynamic>? ?? {'content': res['reply'], 'role': 'assistant'}));
      _scrollToBottom();
    } catch (_) {}
  }

  void _scrollToBottom() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (_scrollCtrl.hasClients) {
        _scrollCtrl.animateTo(_scrollCtrl.position.maxScrollExtent, duration: const Duration(milliseconds: 300), curve: Curves.easeOut);
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    final user = context.watch<AuthProvider>().user;
    if (_activeConversation == null) {
      return _conversationList(user);
    }
    return _chatView();
  }

  Widget _conversationList(Map<String, dynamic>? user) {
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(
        title: const Text('NeuraTalk AI'),
        actions: [
          IconButton(
            icon: const Icon(Icons.add, color: AppColors.cyan),
            onPressed: () => _startNewChat(user),
          ),
        ],
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator(color: AppColors.cyan))
          : _conversations.isEmpty
              ? _emptyState(user)
              : ListView.builder(
                  itemCount: _conversations.length,
                  itemBuilder: (_, i) {
                    final c = _conversations[i];
                    return ListTile(
                      leading: CircleAvatar(
                        backgroundColor: AppColors.cyan.withOpacity(0.15),
                        child: const Icon(Icons.chat_bubble_outline, color: AppColors.cyan, size: 20),
                      ),
                      title: Text(c['title'] ?? 'Conversation', style: const TextStyle(color: AppColors.textPrimary, fontWeight: FontWeight.w600)),
                      subtitle: Text(c['lastMessage'] ?? '', style: const TextStyle(color: AppColors.textMuted, fontSize: 12), maxLines: 1, overflow: TextOverflow.ellipsis),
                      trailing: const Icon(Icons.chevron_right, color: AppColors.textMuted),
                      onTap: () => _openConversation(c),
                    );
                  },
                ),
    );
  }

  Widget _emptyState(Map<String, dynamic>? user) {
    return Center(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Container(
            padding: const EdgeInsets.all(24),
            decoration: BoxDecoration(
              color: AppColors.cyan.withOpacity(0.1),
              shape: BoxShape.circle,
            ),
            child: const Icon(Icons.auto_awesome, color: AppColors.cyan, size: 40),
          ),
          const SizedBox(height: 20),
          Text('Hello${user != null ? ", ${user['username'] ?? 'there'}" : ""}!', style: const TextStyle(color: AppColors.white, fontSize: 22, fontWeight: FontWeight.w700)),
          const SizedBox(height: 8),
          const Text('Start a conversation with NeuraTalk AI', style: TextStyle(color: AppColors.textSecondary, fontSize: 14)),
          const SizedBox(height: 32),
          ElevatedButton.icon(
            onPressed: () => _startNewChat(user),
            icon: const Icon(Icons.add),
            label: const Text('New Conversation'),
            style: ElevatedButton.styleFrom(minimumSize: const Size(200, 50)),
          ),
        ],
      ),
    );
  }

  void _startNewChat(Map<String, dynamic>? user) {
    setState(() => _activeConversation = {'id': null, 'title': 'New Chat'});
  }

  void _openConversation(Map<String, dynamic> conv) {
    setState(() {
      _activeConversation = conv;
      _messages = [];
    });
    _loadMessages(conv['id']?.toString() ?? '');
  }

  Future<void> _loadMessages(String convId) async {
    try {
      final data = await ApiService.get('/api/conversations/$convId/messages') as List;
      setState(() => _messages = data.cast<Map<String, dynamic>>());
      _scrollToBottom();
    } catch (_) {}
  }

  Widget _chatView() {
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(
        leading: IconButton(
          icon: const Icon(Icons.arrow_back, color: AppColors.textPrimary),
          onPressed: () => setState(() { _activeConversation = null; _messages = []; }),
        ),
        title: Text(_activeConversation?['title'] ?? 'Chat', style: const TextStyle(color: AppColors.white, fontSize: 16, fontWeight: FontWeight.w600)),
      ),
      body: Column(
        children: [
          Expanded(
            child: _messages.isEmpty
                ? const Center(child: Text('Send a message to start', style: TextStyle(color: AppColors.textMuted)))
                : ListView.builder(
                    controller: _scrollCtrl,
                    padding: const EdgeInsets.all(16),
                    itemCount: _messages.length,
                    itemBuilder: (_, i) => _MessageBubble(message: _messages[i]),
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
                hintText: 'Message NeuraTalk AI...',
                hintStyle: TextStyle(color: AppColors.textMuted),
                border: OutlineInputBorder(borderRadius: BorderRadius.all(Radius.circular(24)), borderSide: BorderSide.none),
                filled: true,
                fillColor: AppColors.surface,
                contentPadding: EdgeInsets.symmetric(horizontal: 20, vertical: 12),
              ),
              onSubmitted: (_) => _sendMessage(),
            ),
          ),
          const SizedBox(width: 8),
          IconButton(
            icon: const Icon(Icons.mic_none, color: AppColors.textMuted),
            onPressed: () {},
          ),
          GestureDetector(
            onTap: _sendMessage,
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

  @override
  void dispose() {
    _msgCtrl.dispose();
    _scrollCtrl.dispose();
    super.dispose();
  }
}

class _MessageBubble extends StatelessWidget {
  final Map<String, dynamic> message;
  const _MessageBubble({required this.message});

  @override
  Widget build(BuildContext context) {
    final isUser = message['role'] == 'user';
    return Align(
      alignment: isUser ? Alignment.centerRight : Alignment.centerLeft,
      child: Container(
        margin: const EdgeInsets.symmetric(vertical: 4),
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
        constraints: BoxConstraints(maxWidth: MediaQuery.of(context).size.width * 0.75),
        decoration: BoxDecoration(
          color: isUser ? AppColors.cyan : AppColors.surface,
          borderRadius: BorderRadius.only(
            topLeft: const Radius.circular(18),
            topRight: const Radius.circular(18),
            bottomLeft: Radius.circular(isUser ? 18 : 4),
            bottomRight: Radius.circular(isUser ? 4 : 18),
          ),
        ),
        child: Text(
          message['content']?.toString() ?? '',
          style: TextStyle(color: isUser ? AppColors.background : AppColors.textPrimary, fontSize: 14, height: 1.5),
        ),
      ),
    );
  }
}
