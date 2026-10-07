import 'package:flutter/material.dart';
import 'package:flutter/services.dart' show Clipboard, ClipboardData;
import 'package:provider/provider.dart';
import '../theme/app_theme.dart';
import '../providers/group_chat_provider.dart';
import '../providers/auth_provider.dart';
import '../services/api_service.dart';
import '../services/media_store.dart';
import '../widgets/attachment_picker.dart';
import '../widgets/chat_attachments.dart';
import 'group_info_screen.dart';

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
  // Current upload ("Sending 2 of 3 · photo.jpg").
  String? _uploadLabel;
  double _uploadProgress = 0;
  UploadCancelToken? _uploadCancel;

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

  Future<void> _attach() async {
    if (_uploadLabel != null) return;
    final files = await AttachmentPicker.show(context);
    for (var i = 0; i < files.length; i++) {
      if (!mounted) return;
      final (file, name) = files[i];
      setState(() {
        _uploadLabel = files.length > 1 ? 'Sending ${i + 1} of ${files.length} · $name' : name;
        _uploadProgress = 0;
        _uploadCancel = UploadCancelToken();
      });
      try {
        await context.read<GroupChatProvider>().sendAttachment(widget.groupId, file, name, cancelToken: _uploadCancel,
            onProgress: (p) {
          if (mounted) setState(() => _uploadProgress = p);
        });
        _scrollToBottom();
      } catch (_) {
        if (mounted) {
          final cancelled = _uploadCancel?.cancelled == true;
          ScaffoldMessenger.of(context).showSnackBar(SnackBar(
            content: Text(cancelled ? 'Upload cancelled.' : 'Could not send "$name". Check your internet and try again.'),
          ));
        }
        break;
      } finally {
        if (mounted) setState(() => _uploadLabel = null);
      }
    }
  }

  bool get _selfIsAdmin {
    final selfId = context.read<AuthProvider>().user?['id'];
    final members = (context.read<GroupChatProvider>().activeGroup?['members'] as List?) ?? const [];
    for (final m in members) {
      if ((m as Map)['userId'] == selfId) return m['role'] == 'admin';
    }
    return false;
  }

  Future<void> _copyMessage(Map<String, dynamic> message) async {
    final text = message['displayContent']?.toString() ?? message['originalContent']?.toString() ?? '';
    await Clipboard.setData(ClipboardData(text: text));
    if (mounted) ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Copied')));
  }

  Future<void> _deleteMessage(Map<String, dynamic> message) async {
    final id = message['id'];
    if (id is! int) return;
    try {
      await context.read<GroupChatProvider>().deleteMessage(widget.groupId, id);
    } catch (_) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Could not delete message.')));
    }
  }

  void _showMessageActions(Map<String, dynamic> message, bool isOwn) {
    final canDelete = isOwn || _selfIsAdmin;
    showModalBottomSheet(
      context: context,
      backgroundColor: AppColors.surface,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(20))),
      builder: (sheetContext) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            ListTile(
              leading: Icon(Icons.copy_outlined, color: AppColors.cyan),
              title: Text('Copy', style: TextStyle(color: AppColors.ink)),
              onTap: () {
                Navigator.pop(sheetContext);
                _copyMessage(message);
              },
            ),
            if (canDelete)
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

  @override
  Widget build(BuildContext context) {
    final provider = context.watch<GroupChatProvider>();
    final selfId = context.read<AuthProvider>().user?['id'];
    final groupName = provider.activeGroup?['name']?.toString() ?? 'Group';
    final members = (provider.activeGroup?['members'] as List?) ?? const [];

    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(
        title: InkWell(
          onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => GroupInfoScreen(groupId: widget.groupId))),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(groupName, style: TextStyle(color: AppColors.ink, fontSize: 16, fontWeight: FontWeight.w600)),
              Text('${members.length} member${members.length == 1 ? '' : 's'}', style: TextStyle(color: AppColors.textMuted, fontSize: 11)),
            ],
          ),
        ),
        actions: [
          IconButton(
            icon: const Icon(Icons.group_outlined),
            tooltip: 'Group Info',
            onPressed: () => Navigator.push(context, MaterialPageRoute(builder: (_) => GroupInfoScreen(groupId: widget.groupId))),
          ),
        ],
      ),
      body: Column(
        children: [
          Expanded(
            child: provider.loadingMessages
                ? Center(child: CircularProgressIndicator(color: AppColors.cyan))
                : provider.messagesError != null
                    ? Center(child: Text(provider.messagesError!, style: const TextStyle(color: AppColors.red)))
                    : provider.messages.isEmpty
                        ? Center(child: Text('No messages yet — say hello 👋', style: TextStyle(color: AppColors.textMuted)))
                        : ListView.builder(
                            controller: _scrollCtrl,
                            padding: const EdgeInsets.all(16),
                            itemCount: provider.messages.length,
                            itemBuilder: (_, i) {
                              final msg = provider.messages[i];
                              final isOwn = msg['senderId'] == selfId || msg['senderId'] == -1;
                              return _GroupMessageBubble(
                                message: msg,
                                isOwn: isOwn,
                                onLongPress: msg['_pending'] == true ? null : () => _showMessageActions(msg, isOwn),
                              );
                            },
                          ),
          ),
          if (_uploadLabel != null)
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 6, 8, 2),
              child: Row(children: [
                Expanded(
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Text(_uploadLabel!, maxLines: 1, overflow: TextOverflow.ellipsis,
                        style: TextStyle(color: AppColors.textSecondary, fontSize: 13)),
                    const SizedBox(height: 4),
                    LinearProgressIndicator(value: _uploadProgress > 0 ? _uploadProgress : null, minHeight: 4,
                        borderRadius: BorderRadius.circular(2)),
                  ]),
                ),
                IconButton(
                  tooltip: 'Cancel upload',
                  icon: Icon(Icons.close, color: AppColors.textMuted),
                  onPressed: () => _uploadCancel?.cancel(),
                ),
              ]),
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
          IconButton(
            tooltip: 'Attach photo, video or file',
            icon: Icon(Icons.attach_file, color: AppColors.textMuted),
            onPressed: _uploadLabel != null ? null : _attach,
          ),
          Expanded(
            child: TextField(
              controller: _msgCtrl,
              style: TextStyle(color: AppColors.ink),
              decoration: InputDecoration(
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
              decoration: BoxDecoration(color: AppColors.cyan, shape: BoxShape.circle),
              child: Icon(Icons.send, color: AppColors.background, size: 20),
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
  final VoidCallback? onLongPress;
  const _GroupMessageBubble({required this.message, required this.isOwn, this.onLongPress});

  static String _clock(dynamic raw) {
    final dt = DateTime.tryParse(raw?.toString() ?? '')?.toLocal();
    if (dt == null) return '';
    final hour12 = dt.hour % 12 == 0 ? 12 : dt.hour % 12;
    return '$hour12:${dt.minute.toString().padLeft(2, '0')} ${dt.hour < 12 ? 'AM' : 'PM'}';
  }

  @override
  Widget build(BuildContext context) {
    final content = message['displayContent']?.toString() ?? message['originalContent']?.toString() ?? '';
    final senderName = (message['sender'] as Map<String, dynamic>?)?['username']?.toString();
    final messageType = message['messageType']?.toString() ?? 'text';
    final attachmentUrl = message['attachmentUrl']?.toString();
    final attachmentTitle = message['attachmentTitle']?.toString();
    final attachmentSize = (message['attachmentSize'] as num?)?.toInt();
    final attachmentMime = message['attachmentMime']?.toString();
    final showingTranslated = message['originalLanguage'] != null &&
        message['displayContent'] != null &&
        message['displayContent'] != message['originalContent'];
    final fg = AppColors.textPrimary;

    return Align(
      alignment: isOwn ? Alignment.centerRight : Alignment.centerLeft,
      child: GestureDetector(
      onLongPress: onLongPress,
      child: Container(
        margin: const EdgeInsets.symmetric(vertical: 4),
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
        constraints: BoxConstraints(maxWidth: MediaQuery.of(context).size.width * 0.75),
        decoration: BoxDecoration(
          color: isOwn ? AppColors.blueTint : AppColors.surfaceElevated,
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
                child: Text(senderName, style: TextStyle(color: AppColors.cyan, fontSize: 13, fontWeight: FontWeight.w700)),
              ),
            if (attachmentUrl != null && messageType == 'attachment')
              ChatImageAttachment(objectPath: attachmentUrl, name: attachmentTitle ?? 'photo.jpg')
            else if (attachmentUrl != null && messageType == 'file' && MediaStore.kindOf(attachmentTitle ?? '', mime: attachmentMime) == MediaKind.video)
              ChatVideoAttachment(objectPath: attachmentUrl, name: attachmentTitle ?? 'video.mp4', size: attachmentSize)
            else if (attachmentUrl != null && messageType == 'file')
              ChatFileAttachment(objectPath: attachmentUrl, name: attachmentTitle ?? 'file', size: attachmentSize, mime: attachmentMime)
            else
              Text(content, style: TextStyle(color: fg, fontSize: 16, height: 1.35)),
            if (showingTranslated) ...[
              const SizedBox(height: 6),
              Container(
                padding: const EdgeInsets.only(top: 6),
                decoration: BoxDecoration(border: Border(top: BorderSide(color: fg.withValues(alpha: 0.18)))),
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Padding(
                      padding: const EdgeInsets.only(top: 2),
                      child: Icon(Icons.translate, size: 13, color: fg.withValues(alpha: 0.7)),
                    ),
                    const SizedBox(width: 5),
                    Flexible(
                      child: Text('${message['originalContent']}', style: TextStyle(color: fg.withValues(alpha: 0.75), fontSize: 13, height: 1.3)),
                    ),
                  ],
                ),
              ),
            ],
            const SizedBox(height: 4),
            Align(
              alignment: Alignment.centerRight,
              widthFactor: 1,
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text(_clock(message['createdAt']), style: TextStyle(color: fg.withValues(alpha: 0.7), fontSize: 11.5)),
                  if (isOwn && message['_pending'] == true) ...[
                    const SizedBox(width: 4),
                    Icon(Icons.schedule, size: 14, color: fg.withValues(alpha: 0.7), semanticLabel: 'sending'),
                  ],
                ],
              ),
            ),
          ],
        ),
      ),
      ),
    );
  }
}
