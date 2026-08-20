import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../theme/app_theme.dart';
import '../providers/auth_provider.dart';
import '../providers/personal_chat_provider.dart';
import '../services/api_service.dart';
import '../services/call_service.dart';
import 'call_screen.dart';

/// Real 1:1 conversation with another NeuraTalk user — server/personal-
/// chat-routes.ts. Separate from the NEURA AI assistant screen/data.
class ConversationScreen extends StatefulWidget {
  final Map<String, dynamic> thread;
  const ConversationScreen({super.key, required this.thread});

  @override
  State<ConversationScreen> createState() => _ConversationScreenState();
}

class _ConversationScreenState extends State<ConversationScreen> with WidgetsBindingObserver {
  final _msgCtrl = TextEditingController();
  final _scrollCtrl = ScrollController();
  bool _calling = false;

  int get _threadId => widget.thread['id'] as int;
  Map<String, dynamic> get _peer => (widget.thread['peer'] as Map<String, dynamic>?) ?? const {};

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    final provider = context.read<PersonalChatProvider>();
    provider.setSelfId(context.read<AuthProvider>().user?['id']?.toString());
    provider.openThread(_threadId).then((_) => _scrollToBottom());
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) {
      context.read<PersonalChatProvider>().openThread(_threadId);
    }
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    context.read<PersonalChatProvider>().closeThread();
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
    context.read<PersonalChatProvider>().sendMessage(_threadId, text);
    context.read<PersonalChatProvider>().onTextChanged(_threadId, '');
    _scrollToBottom();
  }

  Future<void> _startCall({required bool video}) async {
    final identifier = _peer['identifier']?.toString();
    if (identifier == null || identifier.isEmpty || _calling) return;
    setState(() => _calling = true);

    final navigator = Navigator.of(context);
    final messenger = ScaffoldMessenger.of(context);
    final callService = context.read<CallService>();

    try {
      final session = await callService.startCall(
        calleeIdentifier: identifier,
        callType: video ? 'video' : 'voice',
      );
      if (!mounted) return;
      navigator.push(MaterialPageRoute(builder: (_) => CallScreen(session: session, callService: callService)));
    } catch (e) {
      final message = e is CallServiceException
          ? e.message
          : (e is ApiException ? e.message : 'Could not start the call. Please try again.');
      messenger.showSnackBar(SnackBar(content: Text(message)));
    } finally {
      if (mounted) setState(() => _calling = false);
    }
  }

  String _presenceLabel(PersonalChatProvider p) {
    if (p.peerTyping) return 'typing…';
    if (p.peerRecentlyActive) return 'Online';
    final last = p.peerLastActiveAt;
    if (last == null) return '';
    final diff = DateTime.now().difference(last);
    if (diff.inMinutes < 1) return 'Last seen just now';
    if (diff.inHours < 1) return 'Last seen ${diff.inMinutes}m ago';
    if (diff.inHours < 24 && last.day == DateTime.now().day) {
      return 'Last seen today at ${last.hour.toString().padLeft(2, '0')}:${last.minute.toString().padLeft(2, '0')}';
    }
    if (diff.inDays < 7) return 'Last seen ${diff.inDays}d ago';
    return '';
  }

  @override
  Widget build(BuildContext context) {
    final provider = context.watch<PersonalChatProvider>();
    final avatarUrl = _peer['avatarUrl'] as String?;
    final displayName = _peer['displayName']?.toString() ?? 'Chat';

    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(
        titleSpacing: 0,
        title: Row(
          children: [
            CircleAvatar(
              radius: 18,
              backgroundColor: AppColors.cyan.withOpacity(0.15),
              backgroundImage: avatarUrl != null ? NetworkImage('${ApiService.baseUrl}$avatarUrl') : null,
              child: avatarUrl == null ? const Icon(Icons.person, color: AppColors.cyan, size: 18) : null,
            ),
            const SizedBox(width: 10),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text(displayName, style: const TextStyle(color: AppColors.white, fontSize: 16, fontWeight: FontWeight.w600), overflow: TextOverflow.ellipsis),
                  Text(_presenceLabel(provider), style: TextStyle(color: provider.peerTyping ? AppColors.cyan : AppColors.textMuted, fontSize: 11)),
                ],
              ),
            ),
          ],
        ),
        actions: [
          IconButton(
            icon: const Icon(Icons.call_outlined),
            onPressed: _calling ? null : () => _startCall(video: false),
          ),
          IconButton(
            icon: const Icon(Icons.videocam_outlined),
            onPressed: _calling ? null : () => _startCall(video: true),
          ),
        ],
      ),
      body: Column(
        children: [
          Expanded(
            child: provider.loadingMessages
                ? const Center(child: CircularProgressIndicator(color: AppColors.cyan))
                : provider.messagesError != null
                    ? Center(child: Text(provider.messagesError!, style: const TextStyle(color: AppColors.red)))
                    : provider.messages.isEmpty
                        ? const Center(child: Text('Say hello 👋', style: TextStyle(color: AppColors.textMuted)))
                        : ListView.builder(
                            controller: _scrollCtrl,
                            padding: const EdgeInsets.all(16),
                            itemCount: provider.messages.length,
                            itemBuilder: (_, i) => _PersonalMessageBubble(
                              message: provider.messages[i],
                              onRetry: () => context.read<PersonalChatProvider>().retryMessage(_threadId, provider.messages[i]),
                            ),
                          ),
          ),
          if (provider.peerTyping)
            const Padding(
              padding: EdgeInsets.symmetric(horizontal: 16, vertical: 4),
              child: Align(alignment: Alignment.centerLeft, child: Text('typing…', style: TextStyle(color: AppColors.cyan, fontSize: 12))),
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
              onChanged: (text) => context.read<PersonalChatProvider>().onTextChanged(_threadId, text),
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

class _PersonalMessageBubble extends StatelessWidget {
  final Map<String, dynamic> message;
  final VoidCallback onRetry;
  const _PersonalMessageBubble({required this.message, required this.onRetry});

  @override
  Widget build(BuildContext context) {
    final isOwn = message['isOwn'] == true;
    final status = message['deliveryStatus']?.toString();
    final showingTranslated = message['showingTranslated'] == true;
    final content = message['displayContent']?.toString() ?? message['originalContent']?.toString() ?? '';

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
            Text(content, style: TextStyle(color: isOwn ? AppColors.background : AppColors.textPrimary, fontSize: 14, height: 1.4)),
            if (showingTranslated) ...[
              const SizedBox(height: 4),
              Text(
                'Translated · original: ${message['originalContent']}',
                style: TextStyle(color: (isOwn ? AppColors.background : AppColors.textPrimary).withOpacity(0.6), fontSize: 10, fontStyle: FontStyle.italic),
              ),
            ],
            if (isOwn && status == 'failed') ...[
              const SizedBox(height: 4),
              GestureDetector(
                onTap: onRetry,
                child: const Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Icon(Icons.error_outline, size: 12, color: AppColors.red),
                    SizedBox(width: 4),
                    Text('Failed — tap to retry', style: TextStyle(color: AppColors.red, fontSize: 10)),
                  ],
                ),
              ),
            ] else if (isOwn && status == 'sending') ...[
              const SizedBox(height: 4),
              const Text('Sending…', style: TextStyle(color: AppColors.textMuted, fontSize: 10)),
            ] else if (isOwn && status == 'seen') ...[
              const SizedBox(height: 4),
              const Text('Seen', style: TextStyle(color: AppColors.textMuted, fontSize: 10)),
            ] else if (isOwn && status == 'delivered') ...[
              const SizedBox(height: 4),
              const Text('Delivered', style: TextStyle(color: AppColors.textMuted, fontSize: 10)),
            ],
          ],
        ),
      ),
    );
  }
}
