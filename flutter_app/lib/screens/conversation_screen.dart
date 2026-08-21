import 'dart:io';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart' show Clipboard, ClipboardData;
import 'package:provider/provider.dart';
import 'package:image_picker/image_picker.dart';
import 'package:emoji_picker_flutter/emoji_picker_flutter.dart';
import 'package:record/record.dart';
import 'package:audioplayers/audioplayers.dart';
import 'package:path_provider/path_provider.dart';
import '../theme/app_theme.dart';
import '../providers/auth_provider.dart';
import '../providers/personal_chat_provider.dart';
import '../services/api_service.dart';
import '../services/call_service.dart';
import 'call_screen.dart';
import 'media_viewer_screen.dart';

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
  final _focusNode = FocusNode();
  final _recorder = AudioRecorder();
  bool _calling = false;
  bool _showEmoji = false;
  bool _uploading = false;
  bool _recording = false;
  DateTime? _recordingStartedAt;
  Map<String, dynamic>? _replyingTo;

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
    _focusNode.dispose();
    _recorder.dispose();
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
    final replyId = _replyingTo != null ? _asMessageId(_replyingTo!['id']) : null;
    context.read<PersonalChatProvider>().sendMessage(_threadId, text, replyToId: replyId);
    context.read<PersonalChatProvider>().onTextChanged(_threadId, '');
    setState(() => _replyingTo = null);
    _scrollToBottom();
  }

  int? _asMessageId(dynamic id) => id is int ? id : int.tryParse(id.toString());

  Map<String, dynamic>? _findMessageById(int? id) {
    if (id == null) return null;
    final provider = context.read<PersonalChatProvider>();
    for (final m in provider.messages) {
      if (_asMessageId(m['id']) == id) return m;
    }
    return null;
  }

  void _startReply(Map<String, dynamic> message) {
    setState(() => _replyingTo = message);
    _focusNode.requestFocus();
  }

  Future<void> _copyMessage(Map<String, dynamic> message) async {
    final text = message['displayContent']?.toString() ?? message['originalContent']?.toString() ?? '';
    await Clipboard.setData(ClipboardData(text: text));
    if (mounted) ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Copied')));
  }

  Future<void> _deleteMessage(Map<String, dynamic> message) async {
    final id = _asMessageId(message['id']);
    if (id == null) return;
    try {
      await context.read<PersonalChatProvider>().deleteMessage(_threadId, id);
    } catch (_) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Could not delete message.')));
    }
  }

  void _showMessageActions(Map<String, dynamic> message) {
    final isOwn = message['isOwn'] == true;
    final isDeleted = message['isDeleted'] == true;
    if (isDeleted) return;
    showModalBottomSheet(
      context: context,
      backgroundColor: AppColors.surface,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(20))),
      builder: (sheetContext) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            ListTile(
              leading: const Icon(Icons.reply, color: AppColors.cyan),
              title: const Text('Reply', style: TextStyle(color: AppColors.white)),
              onTap: () {
                Navigator.pop(sheetContext);
                _startReply(message);
              },
            ),
            ListTile(
              leading: const Icon(Icons.copy_outlined, color: AppColors.cyan),
              title: const Text('Copy', style: TextStyle(color: AppColors.white)),
              onTap: () {
                Navigator.pop(sheetContext);
                _copyMessage(message);
              },
            ),
            if (isOwn)
              ListTile(
                leading: const Icon(Icons.delete_outline, color: AppColors.red),
                title: const Text('Delete', style: TextStyle(color: AppColors.red)),
                onTap: () {
                  Navigator.pop(sheetContext);
                  _deleteMessage(message);
                },
              ),
          ],
        ),
      ),
    );
  }

  Future<void> _confirmClearChat() async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        backgroundColor: AppColors.surface,
        title: const Text('Clear chat?', style: TextStyle(color: AppColors.white)),
        content: const Text(
          'This removes all messages from your view. The other person will still see them.',
          style: TextStyle(color: AppColors.textSecondary),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(dialogContext, false), child: const Text('Cancel')),
          TextButton(onPressed: () => Navigator.pop(dialogContext, true), child: const Text('Clear', style: TextStyle(color: AppColors.red))),
        ],
      ),
    );
    if (confirmed != true || !mounted) return;
    try {
      await context.read<PersonalChatProvider>().clearChat(_threadId);
    } catch (_) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Could not clear chat.')));
    }
  }

  void _toggleEmoji() {
    if (_showEmoji) {
      setState(() => _showEmoji = false);
      _focusNode.requestFocus();
    } else {
      _focusNode.unfocus();
      setState(() => _showEmoji = true);
    }
  }

  Future<void> _pickAndSendImage() async {
    final picked = await ImagePicker().pickImage(source: ImageSource.gallery, maxWidth: 1600, imageQuality: 82);
    if (picked == null) return;
    setState(() => _uploading = true);
    try {
      final file = File(picked.path);
      final bytes = await file.readAsBytes();
      final ext = picked.path.split('.').last.toLowerCase();
      final contentType = switch (ext) { 'png' => 'image/png', 'webp' => 'image/webp', _ => 'image/jpeg' };
      final uploadInfo = await ApiService.post('/api/uploads/request-url', {
        'name': 'chat-image.$ext',
        'size': bytes.length,
        'contentType': contentType,
      });
      await ApiService.putBytes(uploadInfo['uploadURL'] as String, bytes, contentType);
      final objectPath = uploadInfo['objectPath'] as String;
      if (!mounted) return;
      await context.read<PersonalChatProvider>().sendMessage(
            _threadId,
            'Photo',
            messageType: 'attachment',
            attachmentUrl: objectPath,
            attachmentTitle: 'Photo',
          );
      _scrollToBottom();
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Could not send image. Please try again.')));
    } finally {
      if (mounted) setState(() => _uploading = false);
    }
  }

  Future<void> _startRecording() async {
    if (!await _recorder.hasPermission()) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Microphone permission is required for voice messages.')));
      return;
    }
    final dir = await getTemporaryDirectory();
    final path = '${dir.path}/voice_${DateTime.now().microsecondsSinceEpoch}.m4a';
    await _recorder.start(const RecordConfig(encoder: AudioEncoder.aacLc), path: path);
    setState(() {
      _recording = true;
      _recordingStartedAt = DateTime.now();
    });
  }

  Future<void> _stopRecordingAndSend({required bool cancel}) async {
    final path = await _recorder.stop();
    final startedAt = _recordingStartedAt;
    setState(() {
      _recording = false;
      _recordingStartedAt = null;
    });
    if (cancel || path == null || startedAt == null) return;
    final duration = DateTime.now().difference(startedAt);
    if (duration.inMilliseconds < 700) return; // too short to be a real message

    setState(() => _uploading = true);
    try {
      final bytes = await File(path).readAsBytes();
      final uploadInfo = await ApiService.post('/api/uploads/request-url', {
        'name': 'voice-note.m4a',
        'size': bytes.length,
        'contentType': 'audio/mp4',
      });
      await ApiService.putBytes(uploadInfo['uploadURL'] as String, bytes, 'audio/mp4');
      final objectPath = uploadInfo['objectPath'] as String;
      if (!mounted) return;
      final seconds = duration.inSeconds.clamp(1, 3599);
      await context.read<PersonalChatProvider>().sendMessage(
            _threadId,
            'Voice note',
            messageType: 'voice_note',
            attachmentUrl: objectPath,
            attachmentTitle: '${seconds ~/ 60}:${(seconds % 60).toString().padLeft(2, '0')}',
          );
      _scrollToBottom();
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Could not send voice message. Please try again.')));
    } finally {
      if (mounted) setState(() => _uploading = false);
    }
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

    return PopScope(
      canPop: !_showEmoji,
      onPopInvokedWithResult: (didPop, _) {
        if (!didPop && _showEmoji) setState(() => _showEmoji = false);
      },
      child: Scaffold(
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
          PopupMenuButton<String>(
            icon: const Icon(Icons.more_vert, color: AppColors.textSecondary),
            color: AppColors.surface,
            onSelected: (value) {
              if (value == 'clear') _confirmClearChat();
            },
            itemBuilder: (_) => const [
              PopupMenuItem(value: 'clear', child: Text('Clear chat', style: TextStyle(color: AppColors.white))),
            ],
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
                              onLongPress: () => _showMessageActions(provider.messages[i]),
                              repliedMessage: _findMessageById(_asMessageId(provider.messages[i]['replyToId'])),
                            ),
                          ),
          ),
          if (provider.peerTyping)
            const Padding(
              padding: EdgeInsets.symmetric(horizontal: 16, vertical: 4),
              child: Align(alignment: Alignment.centerLeft, child: Text('typing…', style: TextStyle(color: AppColors.cyan, fontSize: 12))),
            ),
          if (_uploading)
            const Padding(
              padding: EdgeInsets.symmetric(vertical: 6),
              child: SizedBox(height: 14, width: 14, child: CircularProgressIndicator(strokeWidth: 2, color: AppColors.cyan)),
            ),
          if (_recording) _recordingBar(),
          if (_replyingTo != null) _replyPreviewBar(),
          _inputBar(),
          if (_showEmoji)
            SizedBox(
              height: 280,
              child: EmojiPicker(
                onEmojiSelected: (category, emoji) {
                  _msgCtrl.text += emoji.emoji;
                  _msgCtrl.selection = TextSelection.fromPosition(TextPosition(offset: _msgCtrl.text.length));
                  context.read<PersonalChatProvider>().onTextChanged(_threadId, _msgCtrl.text);
                },
                config: const Config(),
              ),
            ),
        ],
      ),
      ),
    );
  }

  Widget _replyPreviewBar() {
    final reply = _replyingTo!;
    final text = reply['displayContent']?.toString() ?? reply['originalContent']?.toString() ?? '';
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
      color: AppColors.backgroundMid,
      child: Row(
        children: [
          Container(width: 3, height: 32, color: AppColors.cyan),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                const Text('Replying to', style: TextStyle(color: AppColors.cyan, fontSize: 11, fontWeight: FontWeight.w700)),
                Text(text, style: const TextStyle(color: AppColors.textSecondary, fontSize: 12), maxLines: 1, overflow: TextOverflow.ellipsis),
              ],
            ),
          ),
          IconButton(
            icon: const Icon(Icons.close, color: AppColors.textMuted, size: 18),
            onPressed: () => setState(() => _replyingTo = null),
          ),
        ],
      ),
    );
  }

  Widget _recordingBar() {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
      color: AppColors.backgroundMid,
      child: Row(
        children: [
          const Icon(Icons.mic, color: AppColors.red, size: 18),
          const SizedBox(width: 8),
          const Expanded(child: Text('Recording…', style: TextStyle(color: AppColors.textPrimary, fontSize: 13))),
          TextButton(
            onPressed: () => _stopRecordingAndSend(cancel: true),
            child: const Text('Cancel', style: TextStyle(color: AppColors.textMuted)),
          ),
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
          IconButton(
            icon: Icon(_showEmoji ? Icons.keyboard : Icons.emoji_emotions_outlined, color: AppColors.textMuted),
            onPressed: _toggleEmoji,
          ),
          IconButton(
            icon: const Icon(Icons.attach_file, color: AppColors.textMuted),
            onPressed: _uploading ? null : _pickAndSendImage,
          ),
          Expanded(
            child: TextField(
              controller: _msgCtrl,
              focusNode: _focusNode,
              style: const TextStyle(color: AppColors.white),
              onTap: () {
                if (_showEmoji) setState(() => _showEmoji = false);
              },
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
          ValueListenableBuilder<TextEditingValue>(
            valueListenable: _msgCtrl,
            builder: (_, value, __) {
              final hasText = value.text.trim().isNotEmpty;
              return GestureDetector(
                onTap: hasText ? _send : null,
                onLongPress: hasText || _uploading ? null : _startRecording,
                onLongPressUp: hasText || _uploading ? null : () => _stopRecordingAndSend(cancel: false),
                child: Container(
                  padding: const EdgeInsets.all(14),
                  decoration: BoxDecoration(color: _recording ? AppColors.red : AppColors.cyan, shape: BoxShape.circle),
                  child: Icon(hasText ? Icons.send : Icons.mic, color: AppColors.background, size: 20),
                ),
              );
            },
          ),
        ],
      ),
    );
  }
}

class _PersonalMessageBubble extends StatefulWidget {
  final Map<String, dynamic> message;
  final VoidCallback onRetry;
  final VoidCallback? onLongPress;
  final Map<String, dynamic>? repliedMessage;
  const _PersonalMessageBubble({required this.message, required this.onRetry, this.onLongPress, this.repliedMessage});

  @override
  State<_PersonalMessageBubble> createState() => _PersonalMessageBubbleState();
}

class _PersonalMessageBubbleState extends State<_PersonalMessageBubble> {
  final _player = AudioPlayer();
  bool _playing = false;

  @override
  void dispose() {
    _player.dispose();
    super.dispose();
  }

  Future<void> _toggleVoicePlayback(String attachmentUrl) async {
    if (_playing) {
      await _player.stop();
      if (mounted) setState(() => _playing = false);
      return;
    }
    setState(() => _playing = true);
    try {
      await _player.play(UrlSource('${ApiService.baseUrl}$attachmentUrl'));
      _player.onPlayerComplete.first.then((_) {
        if (mounted) setState(() => _playing = false);
      });
    } catch (_) {
      if (mounted) setState(() => _playing = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final message = widget.message;
    final onRetry = widget.onRetry;
    final isOwn = message['isOwn'] == true;
    final status = message['deliveryStatus']?.toString();
    final showingTranslated = message['showingTranslated'] == true;
    final content = message['displayContent']?.toString() ?? message['originalContent']?.toString() ?? '';
    final messageType = message['messageType']?.toString() ?? 'text';
    final attachmentUrl = message['attachmentUrl']?.toString();
    final attachmentTitle = message['attachmentTitle']?.toString();
    final bubbleFg = isOwn ? AppColors.background : AppColors.textPrimary;

    return Align(
      alignment: isOwn ? Alignment.centerRight : Alignment.centerLeft,
      child: GestureDetector(
        onLongPress: widget.onLongPress,
        child: Container(
        margin: const EdgeInsets.symmetric(vertical: 4),
        padding: messageType == 'attachment' && attachmentUrl != null
            ? const EdgeInsets.all(4)
            : const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
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
            if (widget.repliedMessage != null)
              Container(
                margin: const EdgeInsets.only(bottom: 6),
                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                decoration: BoxDecoration(
                  color: bubbleFg.withOpacity(0.08),
                  borderRadius: BorderRadius.circular(8),
                  border: Border(left: BorderSide(color: bubbleFg.withOpacity(0.5), width: 3)),
                ),
                child: Text(
                  widget.repliedMessage!['displayContent']?.toString() ?? widget.repliedMessage!['originalContent']?.toString() ?? '',
                  style: TextStyle(color: bubbleFg.withOpacity(0.75), fontSize: 12),
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                ),
              ),
            if (messageType == 'attachment' && attachmentUrl != null)
              GestureDetector(
                onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => MediaViewerScreen(imageUrl: '${ApiService.baseUrl}$attachmentUrl'))),
                child: ClipRRect(
                  borderRadius: BorderRadius.circular(14),
                  child: Image.network(
                    '${ApiService.baseUrl}$attachmentUrl',
                    fit: BoxFit.cover,
                    width: 220,
                    height: 220,
                    loadingBuilder: (ctx, child, progress) => progress == null
                        ? child
                        : const SizedBox(width: 220, height: 220, child: Center(child: CircularProgressIndicator(strokeWidth: 2, color: AppColors.cyan))),
                    errorBuilder: (ctx, err, st) => const SizedBox(width: 220, height: 120, child: Center(child: Icon(Icons.broken_image, color: AppColors.textMuted))),
                  ),
                ),
              )
            else if (messageType == 'voice_note' && attachmentUrl != null)
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 2),
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    GestureDetector(
                      onTap: () => _toggleVoicePlayback(attachmentUrl),
                      child: Icon(_playing ? Icons.pause_circle_filled : Icons.play_circle_fill, color: bubbleFg, size: 32),
                    ),
                    const SizedBox(width: 8),
                    Text(attachmentTitle ?? 'Voice note', style: TextStyle(color: bubbleFg, fontSize: 13)),
                  ],
                ),
              )
            else
              Text(content, style: TextStyle(color: bubbleFg, fontSize: 14, height: 1.4)),
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
      ),
    );
  }
}
