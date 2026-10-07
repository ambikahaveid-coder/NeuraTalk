import 'package:flutter/material.dart';
import '../theme/app_theme.dart';
import '../services/api_service.dart';
import '../widgets/brand_logo.dart';

/// NEURA AI assistant (brand mockup 07).
///
/// Server API (server/ai_integrations/chat/routes.ts):
///   POST /api/conversations                → { id, title }
///   POST /api/conversations/:id/messages   → SSE stream of { content } chunks, then { done }
///   GET  /api/conversations                → past conversations
///   GET  /api/conversations/:id            → { ..., messages }
class ChatScreen extends StatefulWidget {
  const ChatScreen({super.key});

  @override
  State<ChatScreen> createState() => _ChatScreenState();
}

class _Action {
  final IconData icon;
  final Color color;
  final String title;
  final String subtitle;
  final String prompt;
  const _Action(this.icon, this.color, this.title, this.subtitle, this.prompt);
}

const _actions = [
  _Action(Icons.translate, Color(0xFF1E66F5), 'Translate', 'Into any of 20 languages', 'Translate this into Telugu: '),
  _Action(Icons.reply, Color(0xFF16A34A), 'Draft a reply', 'Paste a message, get a good answer', 'Write a short, polite reply to this message: '),
  _Action(Icons.tune, Color(0xFF7C3AED), 'Rewrite or change tone', 'More polite, formal or friendly', 'Rewrite this to sound polite and professional: '),
  _Action(Icons.lightbulb_outline, Color(0xFFEA580C), 'Explain a message', 'What does it really mean?', 'Explain what this message means, in simple words: '),
  _Action(Icons.short_text, Color(0xFF0891B2), 'Summarize', 'Long text in 3 points', 'Summarize this in 3 short points: '),
];

const _suggestions = [
  'Write a polite leave request to my manager in Hindi',
  'How do I say "the payment is done" in Tamil?',
  'Make this sound friendlier: Send the report today.',
];

class _ChatScreenState extends State<ChatScreen> {
  final _msgCtrl = TextEditingController();
  final _scrollCtrl = ScrollController();
  final _focus = FocusNode();
  final List<Map<String, String>> _messages = [];
  int? _conversationId;
  bool _sending = false;

  void _scrollToBottom() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (_scrollCtrl.hasClients) {
        _scrollCtrl.animateTo(_scrollCtrl.position.maxScrollExtent, duration: const Duration(milliseconds: 250), curve: Curves.easeOut);
      }
    });
  }

  Future<void> _send([String? preset]) async {
    final text = (preset ?? _msgCtrl.text).trim();
    if (text.isEmpty || _sending) return;
    _msgCtrl.clear();
    setState(() {
      _sending = true;
      _messages.add({'role': 'user', 'content': text});
      _messages.add({'role': 'assistant', 'content': ''});
    });
    _scrollToBottom();
    try {
      _conversationId ??= ((await ApiService.post('/api/conversations', {'title': text.length > 40 ? '${text.substring(0, 40)}…' : text}))['id'] as num).toInt();
      await for (final chunk in ApiService.postStream('/api/conversations/$_conversationId/messages', {'content': text})) {
        if (!mounted) return;
        setState(() => _messages.last['content'] = '${_messages.last['content']}$chunk');
        _scrollToBottom();
      }
      if (mounted && (_messages.last['content'] ?? '').isEmpty) {
        setState(() => _messages.last['content'] = 'Sorry, I could not answer that. Please try again.');
      }
    } catch (_) {
      if (mounted) {
        setState(() {
          _messages.last['content'] = 'Could not reach NEURA AI. Check your internet connection and try again.';
          _messages.last['error'] = 'true';
        });
      }
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  void _usePrompt(String prompt) {
    _msgCtrl.text = prompt;
    _msgCtrl.selection = TextSelection.collapsed(offset: prompt.length);
    _focus.requestFocus();
  }

  Future<void> _showHistory() async {
    List<Map<String, dynamic>> conversations = [];
    try {
      conversations = (await ApiService.get('/api/conversations') as List).cast<Map<String, dynamic>>();
    } catch (_) {}
    if (!mounted) return;
    final picked = await showModalBottomSheet<Map<String, dynamic>>(
      context: context,
      showDragHandle: true,
      builder: (_) => SafeArea(
        child: conversations.isEmpty
            ? Padding(
                padding: EdgeInsets.all(32),
                child: Text('No earlier chats yet.', textAlign: TextAlign.center, style: TextStyle(color: AppColors.textMuted)),
              )
            : ListView(
                shrinkWrap: true,
                children: [
                  const Padding(
                    padding: EdgeInsets.fromLTRB(20, 0, 20, 8),
                    child: Text('Earlier chats', style: TextStyle(fontSize: 18, fontWeight: FontWeight.w700)),
                  ),
                  for (final c in conversations)
                    ListTile(
                      leading: Icon(Icons.chat_bubble_outline, color: AppColors.cyan),
                      title: Text(c['title']?.toString() ?? 'Chat', maxLines: 1, overflow: TextOverflow.ellipsis),
                      onTap: () => Navigator.pop(context, c),
                    ),
                ],
              ),
      ),
    );
    if (picked == null) return;
    try {
      final data = await ApiService.get('/api/conversations/${picked['id']}') as Map<String, dynamic>;
      final msgs = (data['messages'] as List? ?? const []).cast<Map<String, dynamic>>();
      setState(() {
        _conversationId = (picked['id'] as num).toInt();
        _messages
          ..clear()
          ..addAll(msgs.map((m) => {'role': m['role'].toString(), 'content': m['content']?.toString() ?? ''}));
      });
      _scrollToBottom();
    } catch (_) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Could not open that chat.')));
    }
  }

  void _newChat() => setState(() {
        _messages.clear();
        _conversationId = null;
      });

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(
        titleSpacing: 0,
        title: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            const NeuraMark(height: 24),
            const SizedBox(width: 8),
            Text.rich(
              TextSpan(children: [
                TextSpan(text: 'Neura', style: TextStyle(color: AppColors.ink)),
                TextSpan(text: 'Talk Assistant', style: TextStyle(color: AppColors.cyan)),
              ]),
              style: Theme.of(context).appBarTheme.titleTextStyle,
            ),
          ],
        ),
        actions: [
          if (_messages.isNotEmpty) IconButton(tooltip: 'New chat', icon: const Icon(Icons.add_comment_outlined), onPressed: _newChat),
          IconButton(tooltip: 'Earlier chats', icon: const Icon(Icons.history), onPressed: _showHistory),
        ],
      ),
      body: Column(
        children: [
          Expanded(child: _messages.isEmpty ? _welcome() : _thread()),
          _inputBar(),
        ],
      ),
    );
  }

  Widget _welcome() {
    return ListView(
      padding: const EdgeInsets.fromLTRB(20, 8, 20, 16),
      children: [
        Text('What do you want to say?', style: TextStyle(color: AppColors.ink, fontSize: 22, fontWeight: FontWeight.w700)),
        const SizedBox(height: 16),
        for (final a in _actions)
          Padding(
            padding: const EdgeInsets.only(bottom: 10),
            child: Material(
              color: AppColors.surface,
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16), side: BorderSide(color: AppColors.border)),
              child: InkWell(
                borderRadius: BorderRadius.circular(16),
                onTap: () => _usePrompt(a.prompt),
                child: Padding(
                  padding: const EdgeInsets.all(14),
                  child: Row(
                    children: [
                      Container(
                        width: 44,
                        height: 44,
                        decoration: BoxDecoration(color: a.color.withValues(alpha: 0.12), borderRadius: BorderRadius.circular(12)),
                        child: Icon(a.icon, color: a.color),
                      ),
                      const SizedBox(width: 14),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(a.title, style: TextStyle(color: AppColors.ink, fontSize: 16, fontWeight: FontWeight.w600)),
                            const SizedBox(height: 2),
                            Text(a.subtitle, style: TextStyle(color: AppColors.textSecondary, fontSize: 13.5)),
                          ],
                        ),
                      ),
                      Icon(Icons.chevron_right, color: AppColors.textMuted),
                    ],
                  ),
                ),
              ),
            ),
          ),
        const SizedBox(height: 12),
        for (final s in _suggestions)
          Padding(
            padding: const EdgeInsets.only(bottom: 8),
            child: Align(
              alignment: Alignment.centerLeft,
              // A wrapping pill (ActionChip clips long text at the screen edge).
              child: Material(
                color: AppColors.backgroundMid,
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(18), side: BorderSide(color: AppColors.border)),
                child: InkWell(
                  borderRadius: BorderRadius.circular(18),
                  onTap: () => _send(s),
                  child: Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 9),
                    child: Text(s, style: TextStyle(color: AppColors.textPrimary, fontSize: 14, height: 1.3)),
                  ),
                ),
              ),
            ),
          ),
      ],
    );
  }

  Widget _thread() {
    return ListView.builder(
      controller: _scrollCtrl,
      padding: const EdgeInsets.all(16),
      itemCount: _messages.length,
      itemBuilder: (_, i) {
        final m = _messages[i];
        final isUser = m['role'] == 'user';
        final text = m['content'] ?? '';
        final waiting = !isUser && text.isEmpty;
        return Align(
          alignment: isUser ? Alignment.centerRight : Alignment.centerLeft,
          child: Row(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              if (!isUser) ...[
                const Padding(padding: EdgeInsets.only(top: 6), child: NeuraMark(height: 18)),
                const SizedBox(width: 8),
              ],
              Flexible(
                child: Container(
                  margin: const EdgeInsets.symmetric(vertical: 5),
                  padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 11),
                  constraints: BoxConstraints(maxWidth: MediaQuery.of(context).size.width * 0.78),
                  decoration: BoxDecoration(
                    color: isUser ? AppColors.blueTint : AppColors.surfaceElevated,
                    borderRadius: BorderRadius.only(
                      topLeft: const Radius.circular(18),
                      topRight: const Radius.circular(18),
                      bottomLeft: Radius.circular(isUser ? 18 : 4),
                      bottomRight: Radius.circular(isUser ? 4 : 18),
                    ),
                  ),
                  child: waiting
                      ? SizedBox(
                          width: 36,
                          height: 18,
                          child: Center(child: LinearProgressIndicator(minHeight: 3, color: AppColors.cyan, backgroundColor: AppColors.border)),
                        )
                      : SelectableText(
                          text,
                          style: TextStyle(
                            color: m['error'] == 'true' ? AppColors.red : AppColors.textPrimary,
                            fontSize: 16,
                            height: 1.4,
                          ),
                        ),
                ),
              ),
            ],
          ),
        );
      },
    );
  }

  Widget _inputBar() {
    return SafeArea(
      top: false,
      child: Container(
        padding: const EdgeInsets.fromLTRB(12, 8, 12, 10),
        decoration: BoxDecoration(
          color: AppColors.background,
          border: Border(top: BorderSide(color: AppColors.border)),
        ),
        child: Row(
          children: [
            Expanded(
              child: TextField(
                controller: _msgCtrl,
                focusNode: _focus,
                minLines: 1,
                maxLines: 5,
                textInputAction: TextInputAction.send,
                onSubmitted: (_) => _send(),
                decoration: InputDecoration(
                  hintText: 'Ask anything...',
                  filled: true,
                  fillColor: AppColors.backgroundMid,
                  contentPadding: const EdgeInsets.symmetric(horizontal: 18, vertical: 12),
                  border: OutlineInputBorder(borderRadius: BorderRadius.circular(26), borderSide: BorderSide(color: AppColors.border)),
                  enabledBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(26), borderSide: BorderSide(color: AppColors.border)),
                  focusedBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(26), borderSide: BorderSide(color: AppColors.cyan, width: 1.5)),
                ),
              ),
            ),
            const SizedBox(width: 8),
            Material(
              color: AppColors.cyan,
              shape: const CircleBorder(),
              child: InkWell(
                customBorder: const CircleBorder(),
                onTap: _sending ? null : () => _send(),
                child: SizedBox(
                  width: 50,
                  height: 50,
                  child: _sending
                      ? const Padding(
                          padding: EdgeInsets.all(14),
                          child: CircularProgressIndicator(strokeWidth: 2.4, color: AppColors.onAccent),
                        )
                      : const Icon(Icons.arrow_upward, color: AppColors.onAccent, semanticLabel: 'Send'),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  @override
  void dispose() {
    _msgCtrl.dispose();
    _scrollCtrl.dispose();
    _focus.dispose();
    super.dispose();
  }
}
