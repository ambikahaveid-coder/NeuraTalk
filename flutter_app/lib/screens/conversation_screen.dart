import 'dart:async';
import 'dart:io';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart' show Clipboard, ClipboardData;
import 'package:provider/provider.dart';
import 'package:image_picker/image_picker.dart';
import 'package:file_picker/file_picker.dart';
import 'package:emoji_picker_flutter/emoji_picker_flutter.dart';
import '../widgets/location_share.dart';
import 'package:record/record.dart';
import 'package:audioplayers/audioplayers.dart';
import 'package:path_provider/path_provider.dart';
import 'package:share_plus/share_plus.dart';
import '../theme/app_theme.dart';
import '../services/media_store.dart';
import '../widgets/chat_attachments.dart';
import '../widgets/nt_ui.dart';
import 'language_preferences_screen.dart';
import '../utils/languages.dart';
import '../providers/auth_provider.dart';
import '../providers/personal_chat_provider.dart';
import '../services/api_service.dart';
import '../services/call_service.dart';
import '../services/contact_resolver.dart';
import 'call_screen.dart';
import 'contact_info_screen.dart';
import '../widgets/link_preview.dart';
import '../widgets/chat_extras.dart';
import '../widgets/chat_lock.dart';

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
  double _uploadProgress = 0;
  String? _uploadFileName;
  UploadCancelToken? _uploadCancelToken;
  bool _recording = false;
  DateTime? _recordingStartedAt;
  Map<String, dynamic>? _replyingTo;
  bool _blockedByMe = false;
  late final StarStore _stars = StarStore('personal', _threadId);
  final Map<int, GlobalKey> _itemKeys = {};
  int? _highlightId;

  String get _apiBase => '/api/personal-chats/$_threadId';

  int get _threadId => widget.thread['id'] as int;
  Map<String, dynamic> get _peer => (widget.thread['peer'] as Map<String, dynamic>?) ?? const {};
  int? get _peerId => _peer['id'] as int?;

  late final PersonalChatProvider _chats;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    final provider = context.read<PersonalChatProvider>();
    _chats = provider;
    provider.setSelfId(context.read<AuthProvider>().user?['id']?.toString());
    provider.openThread(_threadId).then((_) => _scrollToBottom());
    _loadBlockStatus();
    _stars.addListener(_onStars);
    _stars.load();
    // A locked chat opened from a notification still asks for the secret code.
    WidgetsBinding.instance.addPostFrameCallback((_) async {
      await ChatLock.instance.load();
      if (!mounted || !ChatLock.instance.isLocked('p:$_threadId')) return;
      if (!await ChatLock.instance.verify(context) && mounted) Navigator.pop(context);
    });
    // Best-effort -- if contacts permission isn't already granted this is a
    // no-op (ContactResolver never itself prompts); if it is, this makes
    // the real saved name available for the header below instead of a raw
    // phone number.
    unawaited(ContactResolver.instance.ensureLoaded().then((_) {
      if (mounted) setState(() {});
    }));
  }

  Future<void> _loadBlockStatus() async {
    final peerId = _peerId;
    if (peerId == null) return;
    try {
      final res = await ApiService.get('/api/users/$peerId/blocked-status') as Map<String, dynamic>;
      if (mounted) setState(() => _blockedByMe = res['blockedByMe'] == true);
    } catch (_) {}
  }

  Future<void> _toggleBlock() async {
    final peerId = _peerId;
    if (peerId == null) return;
    final wasBlocked = _blockedByMe;
    try {
      if (wasBlocked) {
        await ApiService.delete('/api/users/$peerId/block');
      } else {
        await ApiService.post('/api/users/$peerId/block', {});
      }
      if (mounted) {
        setState(() => _blockedByMe = !wasBlocked);
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(wasBlocked ? 'Unblocked' : 'Blocked')));
      }
    } catch (_) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Could not update block status.')));
    }
  }

  Future<void> _showReportDialog() async {
    const categories = ['harassment', 'spam', 'fraud', 'inappropriate', 'other'];
    String selected = categories.first;
    final descCtrl = TextEditingController();

    final submitted = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => StatefulBuilder(
        builder: (dialogContext, setDialogState) => AlertDialog(
          backgroundColor: AppColors.surface,
          title: Text('Report user', style: TextStyle(color: AppColors.ink)),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              DropdownButton<String>(
                value: selected,
                dropdownColor: AppColors.surface,
                isExpanded: true,
                items: categories.map((c) => DropdownMenuItem(value: c, child: Text(c, style: TextStyle(color: AppColors.ink)))).toList(),
                onChanged: (v) => setDialogState(() => selected = v ?? selected),
              ),
              const SizedBox(height: 12),
              TextField(
                controller: descCtrl,
                maxLines: 3,
                style: TextStyle(color: AppColors.ink),
                decoration: InputDecoration(
                  hintText: 'What happened? (optional)',
                  hintStyle: TextStyle(color: AppColors.textMuted),
                  filled: true,
                  fillColor: AppColors.background,
                  border: OutlineInputBorder(borderRadius: BorderRadius.circular(10), borderSide: BorderSide.none),
                ),
              ),
            ],
          ),
          actions: [
            TextButton(onPressed: () => Navigator.pop(dialogContext, false), child: const Text('Cancel')),
            TextButton(onPressed: () => Navigator.pop(dialogContext, true), child: Text('Submit', style: TextStyle(color: AppColors.cyan))),
          ],
        ),
      ),
    );

    if (submitted != true || !mounted) return;
    final peerId = _peerId;
    try {
      await ApiService.post('/api/abuse/report', {
        'reportedUserId': peerId,
        'reportedEntityType': 'user',
        'category': selected,
        if (descCtrl.text.trim().isNotEmpty) 'description': descCtrl.text.trim(),
      });
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Report submitted. Thank you.')));
    } catch (_) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Could not submit report.')));
    }
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
    // context is no longer safe to use here; use the reference saved in initState.
    _chats.closeThread();
    _stars.removeListener(_onStars);
    _msgCtrl.dispose();
    _scrollCtrl.dispose();
    _focusNode.dispose();
    _recorder.dispose();
    super.dispose();
  }

  void _onStars() {
    if (mounted) setState(() {});
  }

  Future<void> _toggleStar(Map<String, dynamic> message) async {
    final id = message['id'];
    if (id is! int) return;
    try {
      final starred = await _stars.toggle(id);
      _toast(starred ? 'Starred' : 'Unstarred');
    } catch (_) {
      _toast('Could not update the star. Check your connection.');
    }
  }

  /// Search in this chat, then scroll to the picked message and flash it.
  Future<void> _openSearch(String title) async {
    final id = await Navigator.push<int>(context, MaterialPageRoute(builder: (_) => ChatSearchScreen(apiBase: _apiBase, title: title)));
    if (id == null || !mounted) return;
    final list = context.read<PersonalChatProvider>().messages;
    final index = list.indexWhere((m) => m['id'] == id);
    if (index == -1) {
      _toast('That message is older than what is loaded here.');
      return;
    }
    setState(() => _highlightId = id);
    if (_itemKeys[id]?.currentContext == null && _scrollCtrl.hasClients) {
      // Not built yet: jump near it first.
      _scrollCtrl.jumpTo(_scrollCtrl.position.maxScrollExtent * (index / (list.length == 0 ? 1 : list.length)));
      await Future<void>.delayed(const Duration(milliseconds: 60));
    }
    final ctx = _itemKeys[id]?.currentContext;
    if (ctx != null && ctx.mounted) {
      await Scrollable.ensureVisible(ctx, alignment: 0.4, duration: const Duration(milliseconds: 300));
    }
    Future.delayed(const Duration(seconds: 2), () {
      if (mounted && _highlightId == id) setState(() => _highlightId = null);
    });
  }

  Future<void> _sendPoll() async {
    final poll = await showCreatePollSheet(context);
    if (poll == null || !mounted) return;
    await context.read<PersonalChatProvider>().sendMessage(_threadId, poll['question'] as String, messageType: 'poll', extra: {'poll': poll});
    _scrollToBottom();
  }

  Future<void> _sendContact() async {
    final contact = await pickContactToShare(context);
    if (contact == null || !mounted) return;
    await context.read<PersonalChatProvider>().sendMessage(_threadId, contact['name'] as String, messageType: 'contact', extra: {'contact': contact});
    _scrollToBottom();
  }

  Future<void> _sendSticker() async {
    final path = await showStickerPicker(context);
    if (path == null || !mounted) return;
    await context.read<PersonalChatProvider>().sendMessage(_threadId, 'Sticker', messageType: 'sticker', attachmentUrl: path, attachmentTitle: 'sticker');
    _scrollToBottom();
  }

  Future<void> _sendViewOnce() async {
    final picked = await pickViewOnceMedia(context);
    if (picked == null || !mounted) return;
    final (file, name) = picked;
    await _uploadAndSend(file, name, await file.length(), viewOnce: true);
  }

  Future<void> _openChatWith(int userId) async {
    if (userId == _peerId) return;
    final thread = await startChatWithUser(context, userId);
    if (thread == null || !mounted) return;
    Navigator.push(context, MaterialPageRoute(builder: (_) => ConversationScreen(thread: thread)));
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

  static const _quickReactions = ['👍', '❤️', '😂', '😮', '😢', '🙏'];
  static const _editWindow = Duration(minutes: 15);

  String? get _myUserId => context.read<AuthProvider>().user?['id']?.toString();

  Future<void> _react(Map<String, dynamic> message, String emoji) async {
    final id = message['id'];
    final me = _myUserId;
    if (id is! int || me == null) return;
    final mine = ((message['reactions'] as Map?) ?? const {})[me]?.toString();
    try {
      // Tapping the same emoji again takes it back, like other messengers.
      await context.read<PersonalChatProvider>().reactToMessage(_threadId, id, mine == emoji ? null : emoji, myUserId: me);
    } catch (_) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Could not react. Check your connection.')));
    }
  }

  bool _canEdit(Map<String, dynamic> message) {
    if (message['isOwn'] != true || message['isDeleted'] == true) return false;
    if ((message['messageType']?.toString() ?? 'text') != 'text' || message['id'] is! int) return false;
    final sent = DateTime.tryParse(message['createdAt']?.toString() ?? '');
    return sent != null && DateTime.now().difference(sent.toLocal()) < _editWindow;
  }

  Future<void> _editMessage(Map<String, dynamic> message) async {
    final ctrl = TextEditingController(text: message['originalContent']?.toString() ?? '');
    final next = await showDialog<String>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        backgroundColor: AppColors.surface,
        title: Text('Edit message', style: TextStyle(color: AppColors.ink)),
        content: TextField(
          controller: ctrl,
          autofocus: true,
          minLines: 1,
          maxLines: 6,
          maxLength: 4000,
          style: TextStyle(color: AppColors.ink),
          decoration: const InputDecoration(counterText: ''),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(dialogContext), child: const Text('Cancel')),
          FilledButton(onPressed: () => Navigator.pop(dialogContext, ctrl.text.trim()), child: const Text('Save')),
        ],
      ),
    );
    ctrl.dispose();
    if (next == null || next.isEmpty || next == message['originalContent']?.toString() || !mounted) return;
    try {
      await context.read<PersonalChatProvider>().editMessage(_threadId, message['id'] as int, next);
    } on ApiException catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.message.isNotEmpty ? e.message : 'Could not edit message.')));
    } catch (_) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Could not edit message.')));
    }
  }

  Future<void> _openContactInfo(PersonalChatProvider provider, String displayName, String? avatarUrl) async {
    final thread = provider.activeThread ?? widget.thread;
    final action = await Navigator.push<ContactInfoAction>(context, MaterialPageRoute(
      builder: (_) => ContactInfoScreen(
        threadId: _threadId,
        name: displayName,
        phone: _peer['phone']?.toString(),
        avatarUrl: avatarUrl,
        language: _peerLanguage(provider),
        presence: _presenceLabel(provider),
        muted: thread['isMuted'] == true,
        blockedByMe: _blockedByMe,
        disappearingSeconds: (thread['disappearingSeconds'] as num?)?.toInt(),
        messages: provider.messages,
      ),
    ));
    if (!mounted || action == null) return;
    switch (action) {
      case ContactInfoAction.call:
        await _startCall(video: false);
      case ContactInfoAction.video:
        await _startCall(video: true);
      case ContactInfoAction.disappearing:
        await _showDisappearingDialog();
      case ContactInfoAction.block:
        await _toggleBlock();
      case ContactInfoAction.report:
        await _showReportDialog();
    }
  }

  /// Pick up to 5 of my chats and forward this message to them.
  Future<void> _forward(Map<String, dynamic> message) async {
    final id = message['id'];
    if (id is! int) return;
    final provider = context.read<PersonalChatProvider>();
    if (provider.threads.isEmpty) await provider.loadThreads();
    if (!mounted) return;
    final targets = provider.threads.where((t) => t['id'] != _threadId && t['id'] is int).toList();
    final picked = await showModalBottomSheet<List<int>>(
      context: context,
      isScrollControlled: true,
      backgroundColor: AppColors.surface,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(20))),
      builder: (_) => _ForwardPicker(threads: targets),
    );
    if (picked == null || picked.isEmpty || !mounted) return;
    try {
      final res = await ApiService.post('/api/personal-chats/$_threadId/messages/$id/forward', {'targetThreadIds': picked});
      final done = (res['forwarded'] as List?)?.length ?? 0;
      final failed = (res['failed'] as List?)?.length ?? 0;
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(
          failed == 0 ? 'Forwarded to $done chat${done == 1 ? '' : 's'}' : 'Forwarded to $done, could not send to $failed',
        )));
      }
      unawaited(provider.loadThreads());
    } on ApiException catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.message.isNotEmpty ? e.message : 'Could not forward.')));
    } catch (_) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Could not forward. Check your connection.')));
    }
  }

  void _showMessageActions(Map<String, dynamic> message) {
    final isOwn = message['isOwn'] == true;
    final isDeleted = message['isDeleted'] == true;
    if (isDeleted) return;
    final canReact = message['id'] is int;
    final mine = ((message['reactions'] as Map?) ?? const {})[_myUserId]?.toString();
    final special = message['viewOnce'] == true || message['messageType'] == 'poll';
    showModalBottomSheet(
      context: context,
      backgroundColor: AppColors.surface,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(20))),
      builder: (sheetContext) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            if (canReact)
              Padding(
                padding: const EdgeInsets.fromLTRB(12, 14, 12, 6),
                child: Row(
                  mainAxisAlignment: MainAxisAlignment.spaceEvenly,
                  children: [
                    for (final emoji in _quickReactions)
                      Semantics(
                        button: true,
                        label: 'React $emoji',
                        child: InkWell(
                          customBorder: const CircleBorder(),
                          onTap: () {
                            Navigator.pop(sheetContext);
                            _react(message, emoji);
                          },
                          child: Container(
                            width: 46,
                            height: 46,
                            alignment: Alignment.center,
                            decoration: BoxDecoration(
                              shape: BoxShape.circle,
                              color: mine == emoji ? AppColors.blueTint : Colors.transparent,
                            ),
                            child: Text(emoji, style: const TextStyle(fontSize: 26)),
                          ),
                        ),
                      ),
                  ],
                ),
              ),
            if (canReact) Divider(height: 1, color: AppColors.border),
            ListTile(
              leading: Icon(Icons.reply, color: AppColors.cyan),
              title: Text('Reply', style: TextStyle(color: AppColors.ink)),
              onTap: () {
                Navigator.pop(sheetContext);
                _startReply(message);
              },
            ),
            if (message['id'] is int)
              ListTile(
                leading: Icon(_stars.has(message['id']) ? Icons.star : Icons.star_border, color: AppColors.orange),
                title: Text(_stars.has(message['id']) ? 'Unstar' : 'Star', style: TextStyle(color: AppColors.ink)),
                onTap: () {
                  Navigator.pop(sheetContext);
                  _toggleStar(message);
                },
              ),
            if (!isOwn && message['messageType'] == 'sticker' && message['id'] is int)
              ListTile(
                leading: Icon(Icons.bookmark_add_outlined, color: AppColors.cyan),
                title: Text('Save sticker', style: TextStyle(color: AppColors.ink)),
                onTap: () {
                  Navigator.pop(sheetContext);
                  saveStickerFromChat(context, 'personal', _threadId, message['id'] as int);
                },
              ),
            if (message['viewOnce'] != true && message['messageType'] != 'sticker')
              ListTile(
                leading: Icon(Icons.copy_outlined, color: AppColors.cyan),
                title: Text('Copy', style: TextStyle(color: AppColors.ink)),
                onTap: () {
                  Navigator.pop(sheetContext);
                  _copyMessage(message);
                },
              ),
            if (message['id'] is int && !special)
              ListTile(
                leading: Icon(Icons.shortcut, color: AppColors.cyan),
                title: Text('Forward', style: TextStyle(color: AppColors.ink)),
                onTap: () {
                  Navigator.pop(sheetContext);
                  _forward(message);
                },
              ),
            if (_canEdit(message))
              ListTile(
                leading: Icon(Icons.edit_outlined, color: AppColors.cyan),
                title: Text('Edit', style: TextStyle(color: AppColors.ink)),
                onTap: () {
                  Navigator.pop(sheetContext);
                  _editMessage(message);
                },
              ),
            if (isOwn)
              ListTile(
                leading: const Icon(Icons.delete_outline, color: AppColors.red),
                title: const Text('Delete for everyone', style: TextStyle(color: AppColors.red)),
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
        title: Text('Clear chat?', style: TextStyle(color: AppColors.ink)),
        content: Text(
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

  static const _disappearingOptions = {
    0: 'Off',
    86400: '24 hours',
    604800: '7 days',
    7776000: '90 days',
  };

  Future<void> _showDisappearingDialog() async {
    final provider = context.read<PersonalChatProvider>();
    int selected = (provider.activeThread?['disappearingSeconds'] as int?) ?? 0;

    final chosen = await showDialog<int>(
      context: context,
      builder: (dialogContext) => StatefulBuilder(
        builder: (dialogContext, setDialogState) => AlertDialog(
          backgroundColor: AppColors.surface,
          title: Text('Disappearing messages', style: TextStyle(color: AppColors.ink)),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            children: _disappearingOptions.entries.map((entry) => RadioListTile<int>(
              value: entry.key,
              groupValue: selected,
              activeColor: AppColors.cyan,
              title: Text(entry.value, style: TextStyle(color: AppColors.ink)),
              onChanged: (v) => setDialogState(() => selected = v ?? selected),
            )).toList(),
          ),
          actions: [
            TextButton(onPressed: () => Navigator.pop(dialogContext), child: const Text('Cancel')),
            TextButton(onPressed: () => Navigator.pop(dialogContext, selected), child: Text('Save', style: TextStyle(color: AppColors.cyan))),
          ],
        ),
      ),
    );

    if (chosen == null || !mounted) return;
    try {
      await provider.setDisappearing(_threadId, chosen);
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Disappearing messages: ${_disappearingOptions[chosen]}')));
    } catch (_) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Could not update this setting.')));
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

  // Attachments: see MediaStore for file types, size limit and blocked types.
  static const _maxGalleryItems = 10;

  void _showAttachMenu() {
    Widget item(IconData icon, String label, Color color, VoidCallback onTap) {
      return InkWell(
        borderRadius: BorderRadius.circular(16),
        onTap: () {
          Navigator.pop(context);
          onTap();
        },
        child: Padding(
          padding: const EdgeInsets.symmetric(vertical: 10),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Container(
                width: 60,
                height: 60,
                decoration: BoxDecoration(
                  color: color.withValues(alpha: AppColors.isDark ? 0.22 : 0.12),
                  borderRadius: BorderRadius.circular(18),
                ),
                child: Icon(icon, color: color, size: 28),
              ),
              const SizedBox(height: 8),
              Text(label, style: TextStyle(color: AppColors.ink, fontSize: 13.5, fontWeight: FontWeight.w500)),
            ],
          ),
        ),
      );
    }

    showModalBottomSheet(
      context: context,
      showDragHandle: true,
      builder: (sheetContext) => SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
          child: GridView.count(
            crossAxisCount: 3,
            shrinkWrap: true,
            physics: const NeverScrollableScrollPhysics(),
            children: [
              item(Icons.photo_library, 'Gallery', const Color(0xFF7C3AED), _pickFromGallery),
              item(Icons.photo_camera, 'Camera', const Color(0xFFDB2777), () => _capture(video: false)),
              item(Icons.videocam, 'Video', const Color(0xFFEA580C), () => _capture(video: true)),
              item(Icons.insert_drive_file, 'Document', const Color(0xFF2563EB), _pickDocuments),
              item(Icons.location_on, 'Location', const Color(0xFF16A34A), _shareCurrentLocation),
              item(Icons.poll_outlined, 'Poll', const Color(0xFF0891B2), _sendPoll),
              item(Icons.emoji_emotions_outlined, 'Sticker', const Color(0xFFCA8A04), _sendSticker),
              item(Icons.person_outline, 'Contact', const Color(0xFF0D9488), _sendContact),
              item(Icons.looks_one_outlined, 'View once', const Color(0xFFB45309), _sendViewOnce),
            ],
          ),
        ),
      ),
    );
  }

  Future<void> _shareCurrentLocation() async {
    final provider = context.read<PersonalChatProvider>();
    await showShareLocationSheet(context, onSend: (lat, lng, address) async {
      await provider.sendMessage(
        _threadId,
        address ?? 'Location',
        messageType: 'location',
        attachmentUrl: 'geo:$lat,$lng',
        attachmentTitle: address ?? 'Shared location',
      );
      _scrollToBottom();
    });
  }

  void _toast(String text) {
    if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(text)));
  }

  /// Photos and videos from the gallery, up to 10 at once. Sent as the original
  /// files, so GIFs stay animated and photos keep full quality.
  Future<void> _pickFromGallery() async {
    // The system Photo Picker needs no permission.
    List<XFile> picked;
    try {
      picked = await ImagePicker().pickMultipleMedia(limit: _maxGalleryItems);
    } catch (e) {
      _toast('Could not open your gallery.');
      return;
    }
    if (picked.isEmpty) return;
    if (picked.length > _maxGalleryItems) {
      _toast('Sending the first $_maxGalleryItems items.');
      picked = picked.take(_maxGalleryItems).toList();
    }
    await _sendFiles([for (final x in picked) (File(x.path), _nameOf(x))]);
  }

  /// A new photo or video from the camera.
  Future<void> _capture({required bool video}) async {
    XFile? shot;
    try {
      shot = video
          ? await ImagePicker().pickVideo(source: ImageSource.camera, maxDuration: const Duration(minutes: 5))
          : await ImagePicker().pickImage(source: ImageSource.camera, imageQuality: 88, maxWidth: 2560);
    } catch (e) {
      _toast('Could not open the camera. Check that NeuraTalk is allowed to use it.');
      return;
    }
    if (shot == null) return;
    await _sendFiles([(File(shot.path), _nameOf(shot))]);
  }

  /// Any documents: PDF, Word, Excel, PowerPoint, ZIP, music, anything else.
  Future<void> _pickDocuments() async {
    FilePickerResult? result;
    try {
      result = await FilePicker.platform.pickFiles(allowMultiple: true, withData: false);
    } catch (e) {
      _toast('Could not open your files.');
      return;
    }
    if (result == null || result.files.isEmpty) return;
    await _sendFiles([
      for (final f in result.files.take(_maxGalleryItems))
        if (f.path != null) (File(f.path!), f.name),
    ]);
  }

  String _nameOf(XFile x) {
    final name = x.name.isNotEmpty ? x.name : x.path.split(Platform.pathSeparator).last;
    return name.contains('.') ? name : '$name.jpg';
  }

  /// Checks then sends each file in order, showing "2 of 5".
  Future<void> _sendFiles(List<(File, String)> files) async {
    final ok = <(File, String, int)>[];
    for (final (file, name) in files) {
      if (MediaStore.isBlocked(name)) {
        _toast('"$name" can\'t be sent: apps and scripts are blocked for safety.');
        continue;
      }
      final size = await file.length();
      if (size == 0) continue;
      if (size > MediaStore.maxUploadBytes) {
        _toast('"$name" is ${MediaStore.formatSize(size)}. The limit is ${MediaStore.formatSize(MediaStore.maxUploadBytes)}.');
        continue;
      }
      ok.add((file, name, size));
    }
    for (var i = 0; i < ok.length; i++) {
      if (!mounted) return;
      final (file, name, size) = ok[i];
      final sent = await _uploadAndSend(file, name, size, position: ok.length > 1 ? '${i + 1} of ${ok.length}' : null);
      if (!sent) break;
    }
  }

  /// Uploads one file with real progress (cancellable) and sends it. Offers Retry on failure.
  Future<bool> _uploadAndSend(File file, String name, int size, {String? position, bool viewOnce = false}) async {
    final mime = MediaStore.contentTypeFor(name);
    final kind = MediaStore.kindOf(name);
    setState(() {
      _uploading = true;
      _uploadProgress = 0;
      _uploadFileName = position == null ? name : 'Sending $position · $name';
      _uploadCancelToken = UploadCancelToken();
    });
    try {
      final objectPath = await MediaStore.upload(file, name, cancelToken: _uploadCancelToken, onProgress: (p) {
        if (mounted) setState(() => _uploadProgress = p);
      });
      if (!mounted) return false;
      await context.read<PersonalChatProvider>().sendMessage(
            _threadId,
            kind == MediaKind.image ? 'Photo' : (kind == MediaKind.video ? 'Video' : name),
            messageType: kind == MediaKind.image ? 'attachment' : 'file',
            attachmentUrl: objectPath,
            attachmentTitle: name,
            attachmentSize: size,
            attachmentMime: mime,
            extra: viewOnce ? {'viewOnce': true} : null,
          );
      _scrollToBottom();
      return true;
    } catch (e) {
      if (!mounted) return false;
      final wasCancelled = _uploadCancelToken?.cancelled == true;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(
        content: Text(wasCancelled ? 'Upload cancelled.' : 'Could not send "$name". Check your internet and try again.'),
        action: wasCancelled ? null : SnackBarAction(label: 'Retry', onPressed: () => _uploadAndSend(file, name, size, viewOnce: viewOnce)),
      ));
      return false;
    } finally {
      if (mounted) {
        setState(() {
          _uploading = false;
          _uploadProgress = 0;
          _uploadFileName = null;
          _uploadCancelToken = null;
        });
      }
    }
  }

  // Real bug found from physical-device testing: this used to be a
  // press-and-hold gesture (onLongPress/onLongPressUp). hasPermission()
  // shows a real OS permission dialog on first use, which steals touch
  // focus while the finger is still down -- the held gesture gets
  // cancelled by the OS instead of delivering onLongPressUp, so recording
  // started but could never be stopped/sent from that gesture again (the
  // recording bar only ever had a Cancel button, no Send). A plain tap to
  // start and a second tap to stop has no "held" gesture to lose, so
  // nothing here is time-sensitive to touch focus anymore.
  bool _startingRecording = false;

  Future<void> _startRecording() async {
    if (_startingRecording || _recording) return;
    _startingRecording = true;
    try {
      if (!await _recorder.hasPermission()) {
        if (mounted) ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Microphone permission is required for voice messages.')));
        return;
      }
      final dir = await getTemporaryDirectory();
      final path = '${dir.path}/voice_${DateTime.now().microsecondsSinceEpoch}.m4a';
      await _recorder.start(const RecordConfig(encoder: AudioEncoder.aacLc), path: path);
      if (mounted) {
        setState(() {
          _recording = true;
          _recordingStartedAt = DateTime.now();
        });
      }
    } catch (_) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Could not start recording. Please try again.')));
    } finally {
      _startingRecording = false;
    }
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
      final voiceFile = File(path);
      final objectPath = await MediaStore.upload(voiceFile, 'voice-note.m4a');
      final voiceSize = await voiceFile.length();
      if (!mounted) return;
      final seconds = duration.inSeconds.clamp(1, 3599);
      await context.read<PersonalChatProvider>().sendMessage(
            _threadId,
            'Voice note',
            messageType: 'voice_note',
            attachmentUrl: objectPath,
            attachmentTitle: '${seconds ~/ 60}:${(seconds % 60).toString().padLeft(2, '0')}',
            attachmentSize: voiceSize,
            attachmentMime: 'audio/mp4',
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
      messenger.showSnackBar(SnackBar(content: Text(friendlyCallError(e))));
    } finally {
      if (mounted) setState(() => _calling = false);
    }
  }

  String? _myLanguage(PersonalChatProvider p) =>
      (p.activeThread?['viewerLanguage'] ?? widget.thread['viewerLanguage'] ?? context.read<AuthProvider>().user?['preferredLanguage'])
          ?.toString();
  String? _peerLanguage(PersonalChatProvider p) => (p.activeThread?['peerLanguage'] ?? widget.thread['peerLanguage'])?.toString();

  /// "🇮🇳 Telugu ⇄ 🇬🇧 English · ● Live translation". Tapping my language changes it;
  /// the other person always picks their own.
  Widget _languageBar(PersonalChatProvider provider) {
    final mine = _myLanguage(provider);
    final theirs = _peerLanguage(provider);
    if (mine == null || theirs == null) return const SizedBox.shrink();
    final same = Languages.of(mine).code == Languages.of(theirs).code;
    final on = provider.isTranslationOn(_threadId);
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.fromLTRB(10, 4, 12, 4),
      decoration: BoxDecoration(color: AppColors.background, border: Border(bottom: BorderSide(color: AppColors.border))),
      child: Row(children: [
        // Shrinks on narrow phones / large text instead of pushing the
        // Translate switch off the screen.
        Flexible(
          child: FittedBox(
            fit: BoxFit.scaleDown,
            alignment: Alignment.centerLeft,
            child: LanguagePairChip(
              mine: mine,
              theirs: theirs,
              onTapMine: () async {
                await Navigator.push(context, MaterialPageRoute(builder: (_) => const LanguagePreferencesScreen()));
                if (mounted) context.read<PersonalChatProvider>().openThread(_threadId);
              },
            ),
          ),
        ),
        const SizedBox(width: 4),
        if (same)
          const Padding(padding: EdgeInsets.only(right: 8), child: LiveBadge(on: false, label: 'Same language'))
        else
          // Translation is automatic; this lets someone read the original
          // words in this chat (e.g. both understand each other's language).
          Semantics(
            label: on ? 'Translation on' : 'Translation off',
            child: InkWell(
              borderRadius: BorderRadius.circular(20),
              onTap: () => provider.setTranslationOn(_threadId, !on),
              child: Padding(
                padding: const EdgeInsets.fromLTRB(8, 2, 0, 2),
                child: Row(mainAxisSize: MainAxisSize.min, children: [
                  Icon(Icons.translate, size: 16, color: on ? AppColors.cyan : AppColors.textMuted),
                  const SizedBox(width: 4),
                  Text('Translate', style: TextStyle(color: AppColors.textSecondary, fontSize: 13, fontWeight: FontWeight.w600)),
                  // Sized to what it shows (Transform.scale kept the full-size width).
                  SizedBox(
                    height: 28,
                    child: FittedBox(child: Switch(value: on, onChanged: (v) => provider.setTranslationOn(_threadId, v))),
                  ),
                ]),
              ),
            ),
          ),
      ]),
    );
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
    final displayName = ContactResolver.instance.nameFor(_peer['phone']?.toString()) ?? _peer['displayName']?.toString() ?? 'Chat';

    return PopScope(
      canPop: !_showEmoji,
      onPopInvokedWithResult: (didPop, _) {
        if (!didPop && _showEmoji) setState(() => _showEmoji = false);
      },
      child: Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(
        titleSpacing: 0,
        // Tapping the name opens the contact page, like every messenger.
        title: InkWell(
          onTap: () => _openContactInfo(provider, displayName, avatarUrl),
          child: Row(
            children: [
              NtAvatar(name: displayName, avatarUrl: avatarUrl, size: 40, online: provider.peerRecentlyActive),
              const SizedBox(width: 10),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text(displayName, style: TextStyle(color: AppColors.ink, fontSize: 17, fontWeight: FontWeight.w700), overflow: TextOverflow.ellipsis),
                    Text(_presenceLabel(provider), style: TextStyle(color: provider.peerTyping ? AppColors.cyan : AppColors.textSecondary, fontSize: 12.5)),
                  ],
                ),
              ),
            ],
          ),
        ),
        actions: [
          // Real UX gap found from physical-device testing: tapping either
          // call button only disabled it (a barely-visible opacity change)
          // while the ~1-4s call-creation round trip ran -- nothing told the
          // user their tap had actually registered, so a slow network made
          // it look like the button simply didn't work. A real spinner in
          // place of the icon is immediate, unambiguous feedback that
          // doesn't require the server response to appear.
          IconButton(
            icon: _calling
                ? SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2, color: AppColors.cyan))
                : Icon(Icons.call_outlined, color: AppColors.cyan),
            tooltip: 'Voice call',
            onPressed: _calling ? null : () => _startCall(video: false),
          ),
          IconButton(
            icon: _calling
                ? SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2, color: AppColors.cyan))
                : Icon(Icons.videocam_outlined, color: AppColors.cyan),
            tooltip: 'Video call',
            onPressed: _calling ? null : () => _startCall(video: true),
          ),
          PopupMenuButton<String>(
            icon: Icon(Icons.more_vert, color: AppColors.textSecondary),
            color: AppColors.surface,
            onSelected: (value) {
              switch (value) {
                case 'search':
                  _openSearch(displayName);
                  break;
                case 'starred':
                  Navigator.push(context, MaterialPageRoute(builder: (_) => const StarredMessagesScreen()));
                  break;
                case 'export':
                  shareChatExport(context, displayName, [
                    for (final m in provider.messages)
                      exportLine(m['createdAt'], m['isOwn'] == true ? 'You' : displayName,
                          exportText(m, (m['displayContent'] ?? m['originalContent'] ?? '').toString())),
                  ]);
                  break;
                case 'lock':
                  ChatLock.instance.isLocked('p:$_threadId')
                      ? ChatLock.instance.unlockChat(context, 'p:$_threadId').then((_) { if (mounted) setState(() {}); })
                      : ChatLock.instance.lock(context, 'p:$_threadId').then((_) { if (mounted) setState(() {}); });
                  break;
                case 'clear':
                  _confirmClearChat();
                  break;
                case 'disappearing':
                  _showDisappearingDialog();
                  break;
                case 'block':
                  _toggleBlock();
                  break;
                case 'report':
                  _showReportDialog();
                  break;
              }
            },
            itemBuilder: (_) => [
              PopupMenuItem(value: 'search', child: Text('Search', style: TextStyle(color: AppColors.ink))),
              PopupMenuItem(value: 'starred', child: Text('Starred messages', style: TextStyle(color: AppColors.ink))),
              PopupMenuItem(value: 'clear', child: Text('Clear chat', style: TextStyle(color: AppColors.ink))),
              PopupMenuItem(value: 'export', child: Text('Export chat', style: TextStyle(color: AppColors.ink))),
              PopupMenuItem(value: 'lock', child: Text(ChatLock.instance.isLocked('p:$_threadId') ? 'Unlock chat' : 'Lock chat', style: TextStyle(color: AppColors.ink))),
              PopupMenuItem(value: 'disappearing', child: Text('Disappearing messages', style: TextStyle(color: AppColors.ink))),
              PopupMenuItem(
                value: 'block',
                child: Text(_blockedByMe ? 'Unblock' : 'Block', style: TextStyle(color: _blockedByMe ? AppColors.ink : AppColors.red)),
              ),
              const PopupMenuItem(value: 'report', child: Text('Report', style: TextStyle(color: AppColors.red))),
            ],
          ),
        ],
      ),
      body: Column(
        children: [
          _languageBar(provider),
          Expanded(
            child: provider.loadingMessages
                ? Center(child: CircularProgressIndicator(color: AppColors.cyan))
                : provider.messagesError != null
                    ? Center(child: Text(provider.messagesError!, style: const TextStyle(color: AppColors.red)))
                    : provider.messages.isEmpty
                        ? Center(child: Text('Say hello 👋', style: TextStyle(color: AppColors.textMuted)))
                        : ListView.builder(
                            controller: _scrollCtrl,
                            padding: const EdgeInsets.all(16),
                            itemCount: provider.messages.length,
                            itemBuilder: (_, i) => Column(
                              key: provider.messages[i]['id'] is int ? (_itemKeys[provider.messages[i]['id'] as int] ??= GlobalKey()) : null,
                              crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                              if (ntDayDivider(i == 0 ? null : provider.messages[i - 1]['createdAt'], provider.messages[i]['createdAt']) case final divider?) divider,
                              AnimatedContainer(
                              duration: const Duration(milliseconds: 300),
                              color: _highlightId != null && provider.messages[i]['id'] == _highlightId ? AppColors.cyan.withValues(alpha: 0.18) : Colors.transparent,
                              child: _PersonalMessageBubble(
                              apiBase: _apiBase,
                              starred: _stars.has(provider.messages[i]['id']),
                              myUserId: int.tryParse(_myUserId ?? ''),
                              onOpenChat: _openChatWith,
                              onChanged: () => context.read<PersonalChatProvider>().openThread(_threadId),
                              message: provider.messages[i],
                              onRetry: () => context.read<PersonalChatProvider>().retryMessage(_threadId, provider.messages[i]),
                              onLongPress: () => _showMessageActions(provider.messages[i]),
                              repliedMessage: _findMessageById(_asMessageId(provider.messages[i]['replyToId'])),
                              peerLanguage: _peerLanguage(provider),
                              myLanguage: _myLanguage(provider),
                              translationOn: provider.isTranslationOn(_threadId),
                            ),
                            ),
                            ]),
                          ),
          ),
          if (provider.peerTyping)
            Padding(
              padding: EdgeInsets.symmetric(horizontal: 16, vertical: 4),
              child: Align(alignment: Alignment.centerLeft, child: Text('typing…', style: TextStyle(color: AppColors.cyan, fontSize: 12))),
            ),
          if (_uploading)
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
              child: Row(
                children: [
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          _uploadFileName ?? 'Uploading…',
                          overflow: TextOverflow.ellipsis,
                          style: TextStyle(color: AppColors.textMuted, fontSize: 12),
                        ),
                        const SizedBox(height: 4),
                        ClipRRect(
                          borderRadius: BorderRadius.circular(4),
                          child: LinearProgressIndicator(
                            value: _uploadProgress > 0 ? _uploadProgress : null,
                            minHeight: 4,
                            backgroundColor: AppColors.surface,
                            color: AppColors.cyan,
                          ),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(width: 8),
                  Text('${(_uploadProgress * 100).toInt()}%', style: TextStyle(color: AppColors.textMuted, fontSize: 12)),
                  IconButton(
                    icon: Icon(Icons.close, color: AppColors.textMuted, size: 18),
                    onPressed: () => _uploadCancelToken?.cancel(),
                    tooltip: 'Cancel upload',
                  ),
                ],
              ),
            ),
          if (_recording) _recordingBar(),
          if (_replyingTo != null) _replyPreviewBar(),
          if (_blockedByMe)
            Container(
              width: double.infinity,
              padding: const EdgeInsets.all(16),
              color: AppColors.backgroundMid,
              child: Text(
                'You blocked this user. Unblock to send messages.',
                style: TextStyle(color: AppColors.textMuted, fontSize: 13),
                textAlign: TextAlign.center,
              ),
            )
          else
            _inputBar(),
          if (_showEmoji)
            SizedBox(
              height: 300,
              child: EmojiPicker(
                textEditingController: _msgCtrl,
                onEmojiSelected: (_, __) => context.read<PersonalChatProvider>().onTextChanged(_threadId, _msgCtrl.text),
                onBackspacePressed: () => context.read<PersonalChatProvider>().onTextChanged(_threadId, _msgCtrl.text),
                config: ntEmojiConfig(),
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
                Text('Replying to', style: TextStyle(color: AppColors.cyan, fontSize: 11, fontWeight: FontWeight.w700)),
                Text(text, style: TextStyle(color: AppColors.textSecondary, fontSize: 12), maxLines: 1, overflow: TextOverflow.ellipsis),
              ],
            ),
          ),
          IconButton(
            icon: Icon(Icons.close, color: AppColors.textMuted, size: 18),
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
          Expanded(child: Text('Recording… tap the mic button to send', style: TextStyle(color: AppColors.textPrimary, fontSize: 13))),
          TextButton(
            onPressed: () => _stopRecordingAndSend(cancel: true),
            child: Text('Cancel', style: TextStyle(color: AppColors.textMuted)),
          ),
        ],
      ),
    );
  }

  Widget _inputBar() {
    return Container(
      padding: const EdgeInsets.fromLTRB(8, 6, 8, 8),
      decoration: BoxDecoration(
        color: AppColors.background,
        border: Border(top: BorderSide(color: AppColors.border)),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.end,
        children: [
          Expanded(
            child: Container(
              decoration: BoxDecoration(
                color: AppColors.backgroundMid,
                borderRadius: BorderRadius.circular(26),
                border: Border.all(color: AppColors.border),
              ),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.end,
                children: [
                  IconButton(
                    visualDensity: VisualDensity.compact,
                    tooltip: _showEmoji ? 'Keyboard' : 'Emoji',
                    icon: Icon(_showEmoji ? Icons.keyboard : Icons.emoji_emotions_outlined, color: AppColors.textMuted),
                    onPressed: _toggleEmoji,
                  ),
                  Expanded(
                    child: TextField(
                      controller: _msgCtrl,
                      focusNode: _focusNode,
                      minLines: 1,
                      maxLines: 5,
                      style: TextStyle(color: AppColors.ink, fontSize: 16),
                      onTap: () {
                        if (_showEmoji) setState(() => _showEmoji = false);
                      },
                      onChanged: (text) => context.read<PersonalChatProvider>().onTextChanged(_threadId, text),
                      decoration: InputDecoration(
                        hintText: 'Message',
                        hintMaxLines: 1,
                        hintStyle: TextStyle(color: AppColors.textMuted),
                        border: InputBorder.none,
                        enabledBorder: InputBorder.none,
                        focusedBorder: InputBorder.none,
                        filled: false,
                        isDense: true,
                        contentPadding: EdgeInsets.symmetric(vertical: 11),
                      ),
                      onSubmitted: (_) => _send(),
                    ),
                  ),
                  IconButton(
                    visualDensity: VisualDensity.compact,
                    tooltip: 'Attach',
                    icon: Icon(Icons.attach_file, color: AppColors.textMuted),
                    onPressed: _uploading ? null : _showAttachMenu,
                  ),
                  IconButton(
                    visualDensity: VisualDensity.compact,
                    tooltip: 'Photo',
                    icon: Icon(Icons.photo_camera_outlined, color: AppColors.textMuted),
                    onPressed: _uploading ? null : () => _capture(video: false),
                  ),
                ],
              ),
            ),
          ),
          const SizedBox(width: 8),
          ValueListenableBuilder<TextEditingValue>(
            valueListenable: _msgCtrl,
            builder: (_, value, __) {
              final hasText = value.text.trim().isNotEmpty;
              return GestureDetector(
                onTap: hasText
                    ? _send
                    : _uploading
                        ? null
                        : (_recording ? () => _stopRecordingAndSend(cancel: false) : _startRecording),
                child: Container(
                  width: 44,
                  height: 44,
                  decoration: BoxDecoration(color: _recording ? AppColors.red : AppColors.cyan, shape: BoxShape.circle),
                  child: Icon(
                    hasText ? Icons.send : (_recording ? Icons.stop : Icons.mic),
                    color: AppColors.onAccent,
                    size: 22,
                    semanticLabel: hasText ? 'Send' : (_recording ? 'Stop recording' : 'Record voice message'),
                  ),
                ),
              );
            },
          ),
        ],
      ),
    );
  }
}

/// Multi-select list of my chats (up to 5) for forwarding a message.
class _ForwardPicker extends StatefulWidget {
  final List<Map<String, dynamic>> threads;
  const _ForwardPicker({required this.threads});

  @override
  State<_ForwardPicker> createState() => _ForwardPickerState();
}

class _ForwardPickerState extends State<_ForwardPicker> {
  final _selected = <int>{};
  String _query = '';

  @override
  Widget build(BuildContext context) {
    String nameOf(Map<String, dynamic> t) {
      final peer = (t['peer'] as Map?) ?? const {};
      return ContactResolver.instance.nameFor(peer['phone']?.toString()) ?? peer['displayName']?.toString() ?? 'Unknown';
    }
    final visible = widget.threads.where((t) => nameOf(t).toLowerCase().contains(_query.toLowerCase())).toList();
    return SafeArea(
      child: SizedBox(
        height: MediaQuery.of(context).size.height * 0.75,
        child: Column(children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(20, 16, 12, 4),
            child: Row(children: [
              Expanded(child: Text('Forward to…', style: TextStyle(color: AppColors.ink, fontSize: 18, fontWeight: FontWeight.w700))),
              Text('${_selected.length}/5', style: TextStyle(color: AppColors.textSecondary)),
            ]),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 4, 16, 8),
            child: TextField(
              decoration: const InputDecoration(prefixIcon: Icon(Icons.search), hintText: 'Search chats', isDense: true),
              onChanged: (v) => setState(() => _query = v),
            ),
          ),
          Expanded(
            child: visible.isEmpty
                ? Center(child: Text('No other chats yet', style: TextStyle(color: AppColors.textSecondary)))
                : ListView.builder(
                    itemCount: visible.length,
                    itemBuilder: (_, i) {
                      final t = visible[i];
                      final id = t['id'] as int;
                      final peer = (t['peer'] as Map?) ?? const {};
                      final selected = _selected.contains(id);
                      return CheckboxListTile(
                        value: selected,
                        onChanged: (on) => setState(() {
                          if (on == true && _selected.length < 5) {
                            _selected.add(id);
                          } else {
                            _selected.remove(id);
                          }
                        }),
                        secondary: NtAvatar(name: nameOf(t), avatarUrl: peer['avatarUrl'] as String?, size: 42),
                        title: Text(nameOf(t), style: TextStyle(color: AppColors.ink, fontWeight: FontWeight.w600)),
                      );
                    },
                  ),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 8, 16, 12),
            child: SizedBox(
              width: double.infinity,
              child: FilledButton.icon(
                onPressed: _selected.isEmpty ? null : () => Navigator.pop(context, _selected.toList()),
                icon: const Icon(Icons.send),
                label: Text(_selected.isEmpty ? 'Pick chats' : 'Send to ${_selected.length}'),
              ),
            ),
          ),
        ]),
      ),
    );
  }
}

class _PersonalMessageBubble extends StatefulWidget {
  final Map<String, dynamic> message;
  final VoidCallback onRetry;
  final VoidCallback? onLongPress;
  final Map<String, dynamic>? repliedMessage;
  /// The other person's language (for "They read …" under my own messages).
  final String? peerLanguage;
  final String? myLanguage;
  /// Off: show exactly what was written, no translation lines.
  final bool translationOn;
  const _PersonalMessageBubble({
    required this.message,
    required this.onRetry,
    this.onLongPress,
    this.repliedMessage,
    this.peerLanguage,
    this.myLanguage,
    this.translationOn = true,
    this.apiBase = '',
    this.starred = false,
    this.myUserId,
    this.onOpenChat,
    this.onChanged,
  });
  final String apiBase;
  final bool starred;
  final int? myUserId;
  final void Function(int userId)? onOpenChat;
  final VoidCallback? onChanged;

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
      // Attachments are private, so download with the session first (cached after the first play).
      final file = await MediaStore.download(attachmentUrl, 'voice-${attachmentUrl.split('/').last}.m4a');
      await _player.play(DeviceFileSource(file.path));
      _player.onPlayerComplete.first.then((_) {
        if (mounted) setState(() => _playing = false);
      });
    } catch (_) {
      if (mounted) setState(() => _playing = false);
    }
  }

  static String _clock(dynamic raw) {
    final dt = DateTime.tryParse(raw?.toString() ?? '')?.toLocal();
    if (dt == null) return '';
    final hour12 = dt.hour % 12 == 0 ? 12 : dt.hour % 12;
    return '$hour12:${dt.minute.toString().padLeft(2, '0')} ${dt.hour < 12 ? 'AM' : 'PM'}';
  }

  /// Main text + the other-language version underneath, and what "Listen" reads.
  ({String primary, String? secondary, String? secondaryLabel, String listenText, String listenLang}) _texts() {
    final m = widget.message;
    final isOwn = m['isOwn'] == true;
    final original = m['originalContent']?.toString() ?? '';
    final originalLang = m['originalLanguage']?.toString() ?? widget.myLanguage ?? 'en';
    if (!widget.translationOn) {
      return (primary: original, secondary: null, secondaryLabel: null, listenText: original, listenLang: originalLang);
    }
    if (!isOwn) {
      final shown = m['displayContent']?.toString() ?? original;
      final translated = m['showingTranslated'] == true && shown != original;
      return (
        primary: shown,
        secondary: translated ? original : null,
        secondaryLabel: translated ? 'Original · ${Languages.name(originalLang)}' : null,
        listenText: shown,
        listenLang: translated ? (m['displayLanguage']?.toString() ?? widget.myLanguage ?? originalLang) : originalLang,
      );
    }
    final peer = widget.peerLanguage;
    final translations = (m['translations'] as Map?)?.cast<String, dynamic>() ?? const {};
    final theirs = peer != null && peer != originalLang ? translations[peer]?.toString() : null;
    final hasTheirs = theirs != null && theirs.trim().isNotEmpty && theirs != original;
    return (
      primary: original,
      secondary: hasTheirs ? theirs : null,
      secondaryLabel: hasTheirs ? 'They read · ${Languages.name(peer)}' : null,
      listenText: hasTheirs ? theirs : original,
      listenLang: hasTheirs ? peer! : originalLang,
    );
  }

  @override
  Widget build(BuildContext context) {
    final message = widget.message;
    final isOwn = message['isOwn'] == true;
    final status = message['deliveryStatus']?.toString();
    final messageType = message['messageType']?.toString() ?? 'text';
    final attachmentUrl = message['attachmentUrl']?.toString();
    final attachmentTitle = message['attachmentTitle']?.toString();
    final attachmentSize = (message['attachmentSize'] as num?)?.toInt();
    final attachmentMime = message['attachmentMime']?.toString();
    final isDeleted = message['isDeleted'] == true;
    final isVoice = messageType == 'voice_note' && attachmentUrl != null;
    final isViewOnce = message['viewOnce'] == true && !isDeleted;
    final poll = !isDeleted && message['poll'] is Map ? Map<String, dynamic>.from(message['poll'] as Map) : null;
    final contact = !isDeleted && message['contact'] is Map ? Map<String, dynamic>.from(message['contact'] as Map) : null;
    final hasText = !isDeleted && poll == null && contact == null && (messageType == 'text' || (isVoice && message['voiceTranscribed'] == true));
    final texts = _texts();
    final fg = AppColors.textPrimary;
    final isMedia = (messageType == 'attachment' || messageType == 'file' || messageType == 'location') && attachmentUrl != null;
    final isPhoto = messageType == 'attachment' && attachmentUrl != null && !isDeleted && !isViewOnce;
    final isSticker = messageType == 'sticker' && attachmentUrl != null && !isDeleted;
    // 1-3 emojis on their own are shown big, without a bubble (like WhatsApp).
    final jumbo = messageType == 'text' && !isDeleted && widget.repliedMessage == null && isEmojiOnly(texts.primary);

    if (jumbo || isPhoto || isSticker) {
      final plain = jumbo || isSticker;
      final time = Row(mainAxisSize: MainAxisSize.min, children: [
        if (widget.starred) ...[Icon(Icons.star, size: 13, color: AppColors.orange), const SizedBox(width: 3)],
        Text(_clock(message['createdAt']), style: TextStyle(color: plain ? AppColors.textMuted : Colors.white, fontSize: 11.5)),
        if (isOwn && status != null) ...[
          const SizedBox(width: 3),
          Icon(status == 'sending' ? Icons.schedule : status == 'sent' ? Icons.done : Icons.done_all,
              size: 15, color: status == 'seen' ? (plain ? AppColors.cyan : const Color(0xFF8FD3FF)) : (plain ? AppColors.textMuted : Colors.white)),
        ],
      ]);
      return Align(
        alignment: isOwn ? Alignment.centerRight : Alignment.centerLeft,
        child: _withReactions(isOwn, GestureDetector(
          onLongPress: widget.onLongPress,
          child: Padding(
            padding: const EdgeInsets.symmetric(vertical: 4),
            child: plain
                ? Column(crossAxisAlignment: isOwn ? CrossAxisAlignment.end : CrossAxisAlignment.start, children: [
                    if (isSticker) StickerImage(objectPath: attachmentUrl) else Text(texts.primary, style: const TextStyle(fontSize: 44, height: 1.15)),
                    if (isOwn && status == 'failed') _footer(isOwn, status, null) else time,
                  ])
                : Container(
                    padding: const EdgeInsets.all(3),
                    decoration: BoxDecoration(
                      color: isOwn ? AppColors.blueTint : AppColors.surface,
                      borderRadius: BorderRadius.circular(17),
                      border: isOwn ? null : Border.all(color: AppColors.border),
                    ),
                    child: Column(crossAxisAlignment: CrossAxisAlignment.start, mainAxisSize: MainAxisSize.min, children: [
                      Stack(children: [
                        ChatImageAttachment(objectPath: attachmentUrl!, name: attachmentTitle ?? 'photo.jpg'),
                        Positioned(
                          right: 8,
                          bottom: 8,
                          child: Container(
                            padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 3),
                            decoration: BoxDecoration(color: Colors.black.withValues(alpha: 0.45), borderRadius: BorderRadius.circular(10)),
                            child: time,
                          ),
                        ),
                      ]),
                      if (isOwn && status == 'failed') Padding(padding: const EdgeInsets.fromLTRB(8, 0, 8, 4), child: _footer(isOwn, status, null)),
                    ]),
                  ),
          ),
        )),
      );
    }

    return Align(
      alignment: isOwn ? Alignment.centerRight : Alignment.centerLeft,
      child: _withReactions(isOwn, GestureDetector(
        onLongPress: widget.onLongPress,
        child: Container(
          margin: const EdgeInsets.symmetric(vertical: 4),
          padding: isMedia ? const EdgeInsets.all(4) : const EdgeInsets.fromLTRB(14, 10, 14, 8),
          constraints: BoxConstraints(maxWidth: MediaQuery.of(context).size.width * 0.8),
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
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: [
              if (message['forwarded'] == true && !isDeleted)
                Padding(
                  padding: EdgeInsets.fromLTRB(isMedia ? 8 : 0, isMedia ? 4 : 0, 0, 4),
                  child: Row(mainAxisSize: MainAxisSize.min, children: [
                    Icon(Icons.shortcut, size: 14, color: AppColors.textMuted),
                    const SizedBox(width: 4),
                    Text('Forwarded', style: TextStyle(color: AppColors.textMuted, fontSize: 12, fontStyle: FontStyle.italic)),
                  ]),
                ),
              if (widget.repliedMessage != null)
                Container(
                  margin: const EdgeInsets.only(bottom: 6),
                  padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                  decoration: BoxDecoration(
                    color: fg.withValues(alpha: 0.06),
                    borderRadius: BorderRadius.circular(8),
                    border: Border(left: BorderSide(color: AppColors.cyan, width: 3)),
                  ),
                  child: Text(
                    widget.repliedMessage!['displayContent']?.toString() ?? widget.repliedMessage!['originalContent']?.toString() ?? '',
                    style: TextStyle(color: AppColors.textSecondary, fontSize: 13),
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
              if (isViewOnce)
                ViewOnceView(message: message, apiBase: widget.apiBase, isOwn: isOwn, onOpened: widget.onChanged)
              else if (poll != null)
                PollCard(poll: poll, question: texts.primary.isNotEmpty ? texts.primary : null, apiBase: widget.apiBase, messageId: message['id'] is int ? message['id'] as int : null, onVoted: widget.onChanged)
              else if (contact != null)
                ContactCardView(contact: contact, myUserId: widget.myUserId, onMessage: widget.onOpenChat)
              else if (messageType == 'attachment' && attachmentUrl != null)
                ChatImageAttachment(objectPath: attachmentUrl, name: attachmentTitle ?? 'photo.jpg')
              else if (messageType == 'file' && attachmentUrl != null && MediaStore.kindOf(attachmentTitle ?? '', mime: attachmentMime) == MediaKind.video)
                ChatVideoAttachment(objectPath: attachmentUrl, name: attachmentTitle ?? 'video.mp4', size: attachmentSize)
              else if (messageType == 'file' && attachmentUrl != null)
                ChatFileAttachment(objectPath: attachmentUrl, name: attachmentTitle ?? 'file', size: attachmentSize, mime: attachmentMime)
              else if (messageType == 'location' && attachmentUrl != null)
                ChatLocationAttachment(geo: attachmentUrl, title: attachmentTitle)
              else if (isVoice)
                _voicePlayer(attachmentUrl, attachmentTitle),
              if (isDeleted)
                Text('This message was deleted', style: TextStyle(color: AppColors.textMuted, fontSize: 15, fontStyle: FontStyle.italic)),
              if (hasText) ...[
                if (isVoice) const SizedBox(height: 8),
                Text(texts.primary, style: TextStyle(color: fg, fontSize: 16, height: 1.35)),
                if (firstLinkIn(texts.primary) != null) LinkPreviewCard(url: firstLinkIn(texts.primary)!),
                if (texts.secondary != null) ...[
                  const SizedBox(height: 6),
                  Text(texts.secondaryLabel!, style: TextStyle(color: AppColors.cyan, fontSize: 11.5, fontWeight: FontWeight.w700, letterSpacing: 0.2)),
                  const SizedBox(height: 2),
                  Text(texts.secondary!, style: TextStyle(color: AppColors.textSecondary, fontSize: 14, height: 1.35)),
                ],
              ],
              if (isMedia) const SizedBox(height: 4),
              Padding(
                padding: isMedia ? const EdgeInsets.symmetric(horizontal: 8) : EdgeInsets.zero,
                child: _footer(isOwn, status, hasText ? texts : null),
              ),
            ],
          ),
        ),
      )),
    );
  }

  /// The small reactions badge hanging off the bottom of a bubble.
  Widget _withReactions(bool isOwn, Widget bubble) {
    final raw = (widget.message['reactions'] as Map?) ?? const {};
    if (raw.isEmpty || widget.message['isDeleted'] == true) return bubble;
    final counts = <String, int>{};
    for (final value in raw.values) {
      final emoji = value?.toString() ?? '';
      if (emoji.isNotEmpty) counts[emoji] = (counts[emoji] ?? 0) + 1;
    }
    if (counts.isEmpty) return bubble;
    final total = counts.values.fold<int>(0, (a, b) => a + b);
    return Column(
      crossAxisAlignment: isOwn ? CrossAxisAlignment.end : CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: [
        bubble,
        Transform.translate(
          offset: const Offset(0, -9),
          child: GestureDetector(
            onTap: widget.onLongPress,
            child: Container(
              margin: const EdgeInsets.symmetric(horizontal: 10),
              padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 2),
              decoration: BoxDecoration(
                color: AppColors.surface,
                borderRadius: BorderRadius.circular(12),
                border: Border.all(color: AppColors.border),
                boxShadow: [BoxShadow(color: Colors.black.withValues(alpha: 0.06), blurRadius: 4, offset: const Offset(0, 1))],
              ),
              child: Text(
                '${counts.keys.join()}${total > 1 ? ' $total' : ''}',
                semanticsLabel: 'Reactions: ${counts.keys.join(' ')}',
                style: TextStyle(fontSize: 14, color: AppColors.textSecondary, fontWeight: FontWeight.w600),
              ),
            ),
          ),
        ),
      ],
    );
  }

  Widget _footer(bool isOwn, String? status, ({String primary, String? secondary, String? secondaryLabel, String listenText, String listenLang})? texts) {
    if (isOwn && status == 'failed') {
      return Padding(
        padding: const EdgeInsets.only(top: 4),
        child: InkWell(
          onTap: widget.onRetry,
          child: Row(mainAxisSize: MainAxisSize.min, children: [
            const Icon(Icons.error_outline, size: 15, color: AppColors.red),
            const SizedBox(width: 4),
            Text('Not sent · Tap to retry', style: TextStyle(color: AppColors.red, fontSize: 12.5, fontWeight: FontWeight.w600)),
          ]),
        ),
      );
    }
    return Row(mainAxisSize: MainAxisSize.min, children: [
      if (widget.starred) ...[
        Icon(Icons.star, size: 13, color: AppColors.orange, semanticLabel: 'Starred'),
        const SizedBox(width: 4),
      ],
      if (texts != null) NtListenButton(text: texts.listenText, language: texts.listenLang),
      if (texts != null) const SizedBox(width: 8),
      if (widget.message['editedAt'] != null && widget.message['isDeleted'] != true)
        Text('Edited · ', style: TextStyle(color: AppColors.textMuted, fontSize: 11.5, fontStyle: FontStyle.italic)),
      Text(_clock(widget.message['createdAt']), style: TextStyle(color: AppColors.textMuted, fontSize: 11.5)),
      if (isOwn && status != null) ...[
        const SizedBox(width: 4),
        Icon(
          status == 'sending' ? Icons.schedule : status == 'sent' ? Icons.done : Icons.done_all,
          size: 15,
          color: status == 'seen' ? AppColors.cyan : AppColors.textMuted,
          semanticLabel: status,
        ),
      ],
    ]);
  }

  Widget _voicePlayer(String attachmentUrl, String? duration) {
    const bars = <double>[6, 12, 18, 10, 22, 14, 8, 20, 26, 16, 10, 22, 12, 8, 18, 24, 12, 16, 8, 14];
    return Row(mainAxisSize: MainAxisSize.min, children: [
      Material(
        color: AppColors.cyan,
        shape: const CircleBorder(),
        child: InkWell(
          customBorder: const CircleBorder(),
          onTap: () => _toggleVoicePlayback(attachmentUrl),
          child: SizedBox(
            width: 42,
            height: 42,
            child: Icon(_playing ? Icons.pause : Icons.play_arrow, color: AppColors.onAccent, size: 26,
                semanticLabel: _playing ? 'Pause voice message' : 'Play voice message'),
          ),
        ),
      ),
      const SizedBox(width: 10),
      for (final h in bars)
        Container(
          width: 3,
          height: h,
          margin: const EdgeInsets.symmetric(horizontal: 1.2),
          decoration: BoxDecoration(
            color: (_playing ? AppColors.cyan : AppColors.textMuted).withValues(alpha: 0.75),
            borderRadius: BorderRadius.circular(2),
          ),
        ),
      const SizedBox(width: 10),
      Text(duration ?? '', style: TextStyle(color: AppColors.textSecondary, fontSize: 13, fontWeight: FontWeight.w600)),
    ]);
  }
}
