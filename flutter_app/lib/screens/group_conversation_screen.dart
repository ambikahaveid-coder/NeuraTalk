import 'package:flutter/material.dart';
import 'package:flutter/services.dart' show Clipboard, ClipboardData;
import 'package:provider/provider.dart';
import '../theme/app_theme.dart';
import '../providers/group_chat_provider.dart';
import '../providers/auth_provider.dart';
import '../services/api_service.dart';
import '../services/media_store.dart';
import 'package:emoji_picker_flutter/emoji_picker_flutter.dart';
import '../widgets/attachment_picker.dart';
import '../widgets/location_share.dart';
import '../widgets/chat_attachments.dart';
import '../widgets/nt_ui.dart';
import '../widgets/reactions.dart';
import '../widgets/link_preview.dart';
import '../utils/languages.dart';
import 'group_info_screen.dart';
import 'call_screen.dart';
import '../services/call_service.dart';

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
  final _focusNode = FocusNode();
  bool _showEmoji = false;
  bool _calling = false;
  // Current upload ("Sending 2 of 3 · photo.jpg").
  String? _uploadLabel;
  double _uploadProgress = 0;
  UploadCancelToken? _uploadCancel;

  // @mentions: what is typed after "@" (null when not mentioning), and the
  // people picked so far (name -> user id).
  String? _mentionQuery;
  final Map<String, int> _mentioned = {};

  @override
  void initState() {
    super.initState();
    _groups = context.read<GroupChatProvider>();
    _groups.openGroup(widget.groupId).then((_) => _scrollToBottom());
    _msgCtrl.addListener(_watchForMention);
  }

  /// Other members as (user id, name), for "@" suggestions and highlighting.
  List<(int, String)> _otherMembers() {
    final selfId = context.read<AuthProvider>().user?['id'];
    final members = (context.read<GroupChatProvider>().activeGroup?['members'] as List?) ?? const [];
    return [
      for (final m in members)
        if (m is Map && m['userId'] != selfId && m['userId'] is int)
          (m['userId'] as int, ((m['user'] as Map?)?['username'] ?? '').toString().trim()),
    ].where((e) => e.$2.isNotEmpty).toList();
  }

  void _watchForMention() {
    final value = _msgCtrl.value;
    final cursor = value.selection.baseOffset;
    String? query;
    if (cursor >= 0 && cursor <= value.text.length) {
      final before = value.text.substring(0, cursor);
      final at = before.lastIndexOf('@');
      if (at >= 0 && (at == 0 || RegExp(r'\s').hasMatch(before[at - 1]))) {
        final typed = before.substring(at + 1);
        if (!typed.contains('\n') && typed.length <= 30) query = typed;
      }
    }
    if (query != _mentionQuery) setState(() => _mentionQuery = query);
  }

  void _pickMention(int userId, String name) {
    final value = _msgCtrl.value;
    final cursor = value.selection.baseOffset;
    final before = value.text.substring(0, cursor);
    final at = before.lastIndexOf('@');
    if (at < 0) return;
    final inserted = '@$name ';
    final text = value.text.replaceRange(at, cursor, inserted);
    _mentioned[name] = userId;
    _msgCtrl.value = TextEditingValue(text: text, selection: TextSelection.collapsed(offset: at + inserted.length));
    setState(() => _mentionQuery = null);
  }

  Widget _mentionSuggestions() {
    final q = _mentionQuery;
    if (q == null) return const SizedBox.shrink();
    final matches = _otherMembers().where((m) => m.$2.toLowerCase().contains(q.toLowerCase())).take(5).toList();
    if (matches.isEmpty) return const SizedBox.shrink();
    return Container(
      constraints: const BoxConstraints(maxHeight: 240),
      decoration: BoxDecoration(color: AppColors.surface, border: Border(top: BorderSide(color: AppColors.border))),
      child: ListView(
        shrinkWrap: true,
        padding: EdgeInsets.zero,
        children: [
          for (final (id, name) in matches)
            ListTile(
              dense: true,
              leading: NtAvatar(name: name, size: 32),
              title: Text(name, style: TextStyle(color: AppColors.ink, fontWeight: FontWeight.w600)),
              onTap: () => _pickMention(id, name),
            ),
        ],
      ),
    );
  }

  late final GroupChatProvider _groups;

  @override
  void dispose() {
    // context is no longer safe to use here; use the reference saved in initState.
    _groups.closeGroup();
    _msgCtrl.dispose();
    _scrollCtrl.dispose();
    _focusNode.dispose();
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
    // Only people whose "@Name" is still in the text are mentioned.
    final mentions = [for (final e in _mentioned.entries) if (text.contains('@${e.key}')) e.value];
    _mentioned.clear();
    _msgCtrl.clear();
    context.read<GroupChatProvider>().sendMessage(widget.groupId, text, mentions: mentions);
    _scrollToBottom();
  }

  /// Rings everyone else in the group. Each person hears their own language;
  /// people who share a language hear each other directly.
  Future<void> _startGroupCall({required bool video}) async {
    if (_calling) return;
    final groupName = context.read<GroupChatProvider>().activeGroup?['name']?.toString() ?? 'Group';
    final callService = context.read<CallService>();
    final navigator = Navigator.of(context);
    final messenger = ScaffoldMessenger.of(context);
    setState(() => _calling = true);
    try {
      final session = await callService.startGroupCall(groupId: widget.groupId, groupName: groupName, video: video);
      await navigator.push(MaterialPageRoute(builder: (_) => CallScreen(session: session, callService: callService)));
    } catch (e) {
      messenger.showSnackBar(SnackBar(content: Text(e is ApiException ? e.message : friendlyCallError(e))));
    } finally {
      if (mounted) setState(() => _calling = false);
    }
  }

  Future<void> _shareLocation() async {
    final provider = context.read<GroupChatProvider>();
    await showShareLocationSheet(context, onSend: (lat, lng, address) async {
      await provider.sendLocation(widget.groupId, lat, lng, address);
      _scrollToBottom();
    });
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

  Future<void> _attach() async {
    if (_uploadLabel != null) return;
    final files = await AttachmentPicker.show(context, onLocation: _shareLocation);
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

  String? get _myId => context.read<AuthProvider>().user?['id']?.toString();

  Future<void> _react(Map<String, dynamic> message, String emoji) async {
    final id = message['id'];
    final me = _myId;
    if (id is! int || me == null) return;
    final mine = ((message['reactions'] as Map?) ?? const {})[me]?.toString();
    try {
      await context.read<GroupChatProvider>().reactToMessage(widget.groupId, id, mine == emoji ? null : emoji, myUserId: me);
    } catch (_) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Could not react. Check your connection.')));
    }
  }

  bool _canEdit(Map<String, dynamic> message, bool isOwn) {
    if (!isOwn || message['id'] is! int || (message['messageType']?.toString() ?? 'text') != 'text') return false;
    final sent = DateTime.tryParse(message['createdAt']?.toString() ?? '');
    return sent != null && DateTime.now().difference(sent.toLocal()) < const Duration(minutes: 15);
  }

  Future<void> _edit(Map<String, dynamic> message) async {
    final ctrl = TextEditingController(text: message['originalContent']?.toString() ?? '');
    final next = await showDialog<String>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        backgroundColor: AppColors.surface,
        title: Text('Edit message', style: TextStyle(color: AppColors.ink)),
        content: TextField(controller: ctrl, autofocus: true, minLines: 1, maxLines: 6, maxLength: 4000,
            style: TextStyle(color: AppColors.ink), decoration: const InputDecoration(counterText: '')),
        actions: [
          TextButton(onPressed: () => Navigator.pop(dialogContext), child: const Text('Cancel')),
          FilledButton(onPressed: () => Navigator.pop(dialogContext, ctrl.text.trim()), child: const Text('Save')),
        ],
      ),
    );
    ctrl.dispose();
    if (next == null || next.isEmpty || next == message['originalContent']?.toString() || !mounted) return;
    try {
      await context.read<GroupChatProvider>().editMessage(widget.groupId, message['id'] as int, next);
    } on ApiException catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.message.isNotEmpty ? e.message : 'Could not edit message.')));
    } catch (_) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Could not edit message.')));
    }
  }

  void _showMessageActions(Map<String, dynamic> message, bool isOwn) {
    final canDelete = isOwn || _selfIsAdmin;
    final mine = ((message['reactions'] as Map?) ?? const {})[_myId]?.toString();
    showModalBottomSheet(
      context: context,
      backgroundColor: AppColors.surface,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(20))),
      builder: (sheetContext) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            if (message['id'] is int) ...[
              QuickReactionRow(mine: mine, onPick: (emoji) {
                Navigator.pop(sheetContext);
                _react(message, emoji);
              }),
              Divider(height: 1, color: AppColors.border),
            ],
            ListTile(
              leading: Icon(Icons.copy_outlined, color: AppColors.cyan),
              title: Text('Copy', style: TextStyle(color: AppColors.ink)),
              onTap: () {
                Navigator.pop(sheetContext);
                _copyMessage(message);
              },
            ),
            if (_canEdit(message, isOwn))
              ListTile(
                leading: Icon(Icons.edit_outlined, color: AppColors.cyan),
                title: Text('Edit', style: TextStyle(color: AppColors.ink)),
                onTap: () {
                  Navigator.pop(sheetContext);
                  _edit(message);
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
    final me = context.read<AuthProvider>().user;
    final selfId = me?['id'];
    final myLanguage = me?['preferredLanguage']?.toString() ?? 'en';
    final groupName = provider.activeGroup?['name']?.toString() ?? 'Group';
    final members = (provider.activeGroup?['members'] as List?) ?? const [];
    void openInfo() => Navigator.push(context, MaterialPageRoute(builder: (_) => GroupInfoScreen(groupId: widget.groupId)));

    return PopScope(
      canPop: !_showEmoji,
      onPopInvokedWithResult: (didPop, _) {
        if (!didPop && _showEmoji) setState(() => _showEmoji = false);
      },
      child: Scaffold(
      backgroundColor: AppColors.backgroundMid,
      appBar: AppBar(
        titleSpacing: 0,
        title: InkWell(
          onTap: openInfo,
          child: Row(children: [
            NtAvatar(name: groupName, size: 40),
            const SizedBox(width: 10),
            Expanded(
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, mainAxisSize: MainAxisSize.min, children: [
                Text(groupName, maxLines: 1, overflow: TextOverflow.ellipsis,
                    style: TextStyle(color: AppColors.ink, fontSize: 17, fontWeight: FontWeight.w700)),
                Text('${members.length} member${members.length == 1 ? '' : 's'} · tap for info',
                    style: TextStyle(color: AppColors.textSecondary, fontSize: 12.5)),
              ]),
            ),
          ]),
        ),
        actions: [
          IconButton(
            tooltip: 'Group voice call',
            onPressed: _calling ? null : () => _startGroupCall(video: false),
            icon: _calling
                ? SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2, color: AppColors.cyan))
                : Icon(Icons.call_outlined, color: AppColors.cyan),
          ),
          IconButton(
            tooltip: 'Group video call',
            onPressed: _calling ? null : () => _startGroupCall(video: true),
            icon: Icon(Icons.videocam_outlined, color: AppColors.cyan),
          ),
          IconButton(icon: const Icon(Icons.info_outline), tooltip: 'Group info', onPressed: openInfo),
        ],
      ),
      body: Column(
        children: [
          Container(
            width: double.infinity,
            padding: const EdgeInsets.fromLTRB(16, 8, 16, 8),
            decoration: BoxDecoration(color: AppColors.background, border: Border(bottom: BorderSide(color: AppColors.border))),
            child: Row(children: [
              Text(Languages.of(myLanguage).flag, style: const TextStyle(fontSize: 15)),
              const SizedBox(width: 6),
              Expanded(
                child: Text('You read in ${Languages.name(myLanguage)} · others in theirs',
                    maxLines: 1, overflow: TextOverflow.ellipsis, style: TextStyle(color: AppColors.textSecondary, fontSize: 13)),
              ),
              const LiveBadge(label: 'Live'),
            ]),
          ),
          Expanded(
            child: provider.loadingMessages
                ? Center(child: CircularProgressIndicator(color: AppColors.cyan))
                : provider.messagesError != null
                    ? NtEmptyState(icon: Icons.wifi_off, title: 'Couldn\'t load messages', message: provider.messagesError!, error: true)
                    : provider.messages.isEmpty
                        ? const NtEmptyState(
                            icon: Icons.forum_outlined,
                            title: 'Say hello to the group',
                            message: 'Write in your language. Everyone reads it in theirs.')
                        : ListView.builder(
                            controller: _scrollCtrl,
                            padding: const EdgeInsets.fromLTRB(12, 12, 12, 12),
                            itemCount: provider.messages.length,
                            itemBuilder: (_, i) {
                              final msg = provider.messages[i];
                              final isOwn = msg['senderId'] == selfId || msg['senderId'] == -1;
                              final prev = i > 0 ? provider.messages[i - 1] : null;
                              final divider = ntDayDivider(prev?['createdAt'], msg['createdAt']);
                              final bubble = _GroupMessageBubble(
                                message: msg,
                                isOwn: isOwn,
                                myLanguage: myLanguage,
                                showSender: !isOwn && (prev?['senderId'] != msg['senderId'] || divider != null),
                                memberNames: [
                                  for (final m in members)
                                    if (m is Map) ((m['user'] as Map?)?['username'] ?? '').toString(),
                                ],
                                onLongPress: msg['_pending'] == true ? null : () => _showMessageActions(msg, isOwn),
                              );
                              return divider == null ? bubble : Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [divider, bubble]);
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
          _mentionSuggestions(),
          _inputBar(),
          if (_showEmoji)
            SizedBox(
              height: 300,
              child: EmojiPicker(textEditingController: _msgCtrl, config: ntEmojiConfig()),
            ),
        ],
      ),
    ),
    );
  }

  /// Same composer as one-to-one chat: field with attach inside, round send button.
  Widget _inputBar() {
    return SafeArea(
      top: false,
      child: Container(
        padding: const EdgeInsets.fromLTRB(8, 6, 8, 8),
        decoration: BoxDecoration(color: AppColors.background, border: Border(top: BorderSide(color: AppColors.border))),
        child: Row(crossAxisAlignment: CrossAxisAlignment.end, children: [
          Expanded(
            child: Container(
              decoration: BoxDecoration(
                color: AppColors.backgroundMid,
                borderRadius: BorderRadius.circular(26),
                border: Border.all(color: AppColors.border),
              ),
              child: Row(crossAxisAlignment: CrossAxisAlignment.end, children: [
                IconButton(
                  tooltip: _showEmoji ? 'Keyboard' : 'Emoji',
                  icon: Icon(_showEmoji ? Icons.keyboard : Icons.emoji_emotions_outlined, color: AppColors.textMuted),
                  onPressed: _toggleEmoji,
                ),
                Expanded(
                  child: TextField(
                    controller: _msgCtrl,
                    focusNode: _focusNode,
                    onTap: () {
                      if (_showEmoji) setState(() => _showEmoji = false);
                    },
                    minLines: 1,
                    maxLines: 5,
                    style: TextStyle(color: AppColors.ink, fontSize: 16),
                    decoration: InputDecoration(
                      hintText: 'Message the group · @ to mention', hintMaxLines: 1,
                      hintStyle: TextStyle(color: AppColors.textMuted),
                      border: InputBorder.none,
                      enabledBorder: InputBorder.none,
                      focusedBorder: InputBorder.none,
                      filled: false,
                      isDense: true,
                      contentPadding: const EdgeInsets.symmetric(vertical: 11),
                    ),
                    onSubmitted: (_) => _send(),
                  ),
                ),
                IconButton(
                  tooltip: 'Attach photo, video or file',
                  icon: Icon(Icons.attach_file, color: AppColors.textMuted),
                  onPressed: _uploadLabel != null ? null : _attach,
                ),
              ]),
            ),
          ),
          const SizedBox(width: 8),
          Material(
            color: AppColors.cyan,
            shape: const CircleBorder(),
            child: InkWell(
              customBorder: const CircleBorder(),
              onTap: _send,
              child: const SizedBox(width: 44, height: 44, child: Icon(Icons.send, color: AppColors.onAccent, size: 20, semanticLabel: 'Send')),
            ),
          ),
        ]),
      ),
    );
  }
}

class _GroupMessageBubble extends StatelessWidget {
  final Map<String, dynamic> message;
  final bool isOwn;
  final bool showSender;
  final String myLanguage;
  final VoidCallback? onLongPress;
  final List<String> memberNames;
  const _GroupMessageBubble({required this.message, required this.isOwn, required this.myLanguage, this.showSender = false, this.onLongPress, this.memberNames = const []});

  static String _clock(dynamic raw) {
    final dt = DateTime.tryParse(raw?.toString() ?? '')?.toLocal();
    if (dt == null) return '';
    final hour12 = dt.hour % 12 == 0 ? 12 : dt.hour % 12;
    return '$hour12:${dt.minute.toString().padLeft(2, '0')} ${dt.hour < 12 ? 'AM' : 'PM'}';
  }

  @override
  Widget build(BuildContext context) {
    final original = message['originalContent']?.toString() ?? '';
    final shown = message['displayContent']?.toString() ?? original;
    final originalLang = message['originalLanguage']?.toString() ?? myLanguage;
    final translated = !isOwn && shown != original && message['originalLanguage'] != null;
    final senderName = (message['sender'] as Map<String, dynamic>?)?['username']?.toString() ?? 'Member';
    final messageType = message['messageType']?.toString() ?? 'text';
    final attachmentUrl = message['attachmentUrl']?.toString();
    final attachmentTitle = message['attachmentTitle']?.toString();
    final attachmentSize = (message['attachmentSize'] as num?)?.toInt();
    final attachmentMime = message['attachmentMime']?.toString();
    final isMedia = attachmentUrl != null && (messageType == 'attachment' || messageType == 'file' || messageType == 'location');
    final jumbo = !isMedia && messageType == 'text' && isEmojiOnly(shown);
    if (jumbo) {
      return Align(
        alignment: isOwn ? Alignment.centerRight : Alignment.centerLeft,
        child: GestureDetector(
          onLongPress: onLongPress,
          child: Padding(
            padding: EdgeInsets.fromLTRB(isOwn ? 0 : 38, 4, 0, 4),
            child: Column(crossAxisAlignment: isOwn ? CrossAxisAlignment.end : CrossAxisAlignment.start, children: [
              if (showSender)
                Text(senderName, style: TextStyle(color: _senderColor(senderName), fontSize: 13, fontWeight: FontWeight.w700)),
              Text(shown, style: const TextStyle(fontSize: 44, height: 1.15)),
              Text(_clock(message['createdAt']), style: TextStyle(color: AppColors.textMuted, fontSize: 11.5)),
            ]),
          ),
        ),
      );
    }
    final pending = message['_pending'] == true;

    final bubble = Container(
      margin: const EdgeInsets.symmetric(vertical: 3),
      padding: isMedia ? const EdgeInsets.all(4) : const EdgeInsets.fromLTRB(14, 10, 14, 8),
      constraints: BoxConstraints(maxWidth: MediaQuery.of(context).size.width * 0.74),
      decoration: BoxDecoration(
        color: isOwn ? AppColors.blueTint : AppColors.surface,
        border: isOwn ? null : Border.all(color: AppColors.border),
        borderRadius: BorderRadius.only(
          topLeft: const Radius.circular(18),
          topRight: const Radius.circular(18),
          bottomLeft: Radius.circular(isOwn ? 18 : 6),
          bottomRight: Radius.circular(isOwn ? 6 : 18),
        ),
      ),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, mainAxisSize: MainAxisSize.min, children: [
        if (showSender)
          Padding(
            padding: EdgeInsets.fromLTRB(isMedia ? 8 : 0, isMedia ? 4 : 0, 0, 3),
            child: Text(senderName, style: TextStyle(color: _senderColor(senderName), fontSize: 13, fontWeight: FontWeight.w700)),
          ),
        if (attachmentUrl != null && messageType == 'location')
          ChatLocationAttachment(geo: attachmentUrl, title: message['attachmentTitle']?.toString())
        else if (attachmentUrl != null && messageType == 'attachment')
          ChatImageAttachment(objectPath: attachmentUrl, name: attachmentTitle ?? 'photo.jpg')
        else if (attachmentUrl != null && messageType == 'file' && MediaStore.kindOf(attachmentTitle ?? '', mime: attachmentMime) == MediaKind.video)
          ChatVideoAttachment(objectPath: attachmentUrl, name: attachmentTitle ?? 'video.mp4', size: attachmentSize)
        else if (attachmentUrl != null && messageType == 'file')
          ChatFileAttachment(objectPath: attachmentUrl, name: attachmentTitle ?? 'file', size: attachmentSize, mime: attachmentMime)
        else ...[
          MentionText(text: shown, names: memberNames, style: TextStyle(color: AppColors.textPrimary, fontSize: 16, height: 1.35)),
          if (firstLinkIn(shown) != null) LinkPreviewCard(url: firstLinkIn(shown)!),
          if (translated) ...[
            const SizedBox(height: 6),
            Text('Original · ${Languages.name(originalLang)}',
                style: TextStyle(color: AppColors.cyan, fontSize: 11.5, fontWeight: FontWeight.w700, letterSpacing: 0.2)),
            const SizedBox(height: 2),
            Text(original, style: TextStyle(color: AppColors.textSecondary, fontSize: 14, height: 1.35)),
          ],
        ],
        const SizedBox(height: 4),
        Padding(
          padding: isMedia ? const EdgeInsets.fromLTRB(8, 0, 8, 4) : EdgeInsets.zero,
          child: Row(mainAxisSize: MainAxisSize.min, children: [
            if (!isMedia && shown.isNotEmpty) ...[
              NtListenButton(text: shown, language: translated ? myLanguage : originalLang),
              const SizedBox(width: 8),
            ],
            if (message['editedAt'] != null)
              Text('Edited · ', style: TextStyle(color: AppColors.textMuted, fontSize: 11.5, fontStyle: FontStyle.italic)),
            Text(_clock(message['createdAt']), style: TextStyle(color: AppColors.textMuted, fontSize: 11.5)),
            if (isOwn && pending) ...[
              const SizedBox(width: 4),
              Icon(Icons.schedule, size: 14, color: AppColors.textMuted, semanticLabel: 'Sending'),
            ],
          ]),
        ),
      ]),
    );

    final decorated = WithReactions(reactions: message['reactions'] as Map?, alignEnd: isOwn, onTap: onLongPress, child: bubble);
    return Align(
      alignment: isOwn ? Alignment.centerRight : Alignment.centerLeft,
      child: GestureDetector(
        onLongPress: onLongPress,
        child: isOwn
            ? decorated
            : Row(crossAxisAlignment: CrossAxisAlignment.end, mainAxisSize: MainAxisSize.min, children: [
                // Avatar only on the first message of a run, like the sender name.
                SizedBox(width: 34, child: showSender ? NtAvatar(name: senderName, size: 30) : null),
                const SizedBox(width: 4),
                Flexible(child: decorated),
              ]),
      ),
    );
  }

  static Color _senderColor(String name) {
    const palette = [Color(0xFF1E66F5), Color(0xFF16A34A), Color(0xFFEA580C), Color(0xFF7C3AED), Color(0xFF0891B2), Color(0xFFDB2777)];
    return palette[name.trim().hashCode.abs() % palette.length];
  }
}
