import 'dart:async';
import 'dart:io';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart' show Clipboard, ClipboardData;
import 'package:provider/provider.dart';
import 'package:image_picker/image_picker.dart';
import 'package:file_picker/file_picker.dart';
import 'package:permission_handler/permission_handler.dart';
import 'package:geolocator/geolocator.dart';
import 'package:emoji_picker_flutter/emoji_picker_flutter.dart';
import 'package:record/record.dart';
import 'package:audioplayers/audioplayers.dart';
import 'package:path_provider/path_provider.dart';
import 'package:share_plus/share_plus.dart';
import 'package:url_launcher/url_launcher.dart';
import '../theme/app_theme.dart';
import '../providers/auth_provider.dart';
import '../providers/personal_chat_provider.dart';
import '../services/api_service.dart';
import '../services/call_service.dart';
import '../services/contact_resolver.dart';
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
  double _uploadProgress = 0;
  String? _uploadFileName;
  UploadCancelToken? _uploadCancelToken;
  bool _recording = false;
  DateTime? _recordingStartedAt;
  Map<String, dynamic>? _replyingTo;
  bool _blockedByMe = false;

  int get _threadId => widget.thread['id'] as int;
  Map<String, dynamic> get _peer => (widget.thread['peer'] as Map<String, dynamic>?) ?? const {};
  int? get _peerId => _peer['id'] as int?;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    final provider = context.read<PersonalChatProvider>();
    provider.setSelfId(context.read<AuthProvider>().user?['id']?.toString());
    provider.openThread(_threadId).then((_) => _scrollToBottom());
    _loadBlockStatus();
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
          title: const Text('Report user', style: TextStyle(color: AppColors.white)),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              DropdownButton<String>(
                value: selected,
                dropdownColor: AppColors.surface,
                isExpanded: true,
                items: categories.map((c) => DropdownMenuItem(value: c, child: Text(c, style: const TextStyle(color: AppColors.white)))).toList(),
                onChanged: (v) => setDialogState(() => selected = v ?? selected),
              ),
              const SizedBox(height: 12),
              TextField(
                controller: descCtrl,
                maxLines: 3,
                style: const TextStyle(color: AppColors.white),
                decoration: InputDecoration(
                  hintText: 'What happened? (optional)',
                  hintStyle: const TextStyle(color: AppColors.textMuted),
                  filled: true,
                  fillColor: AppColors.background,
                  border: OutlineInputBorder(borderRadius: BorderRadius.circular(10), borderSide: BorderSide.none),
                ),
              ),
            ],
          ),
          actions: [
            TextButton(onPressed: () => Navigator.pop(dialogContext, false), child: const Text('Cancel')),
            TextButton(onPressed: () => Navigator.pop(dialogContext, true), child: const Text('Submit', style: TextStyle(color: AppColors.cyan))),
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
          title: const Text('Disappearing messages', style: TextStyle(color: AppColors.white)),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            children: _disappearingOptions.entries.map((entry) => RadioListTile<int>(
              value: entry.key,
              groupValue: selected,
              activeColor: AppColors.cyan,
              title: Text(entry.value, style: const TextStyle(color: AppColors.white)),
              onChanged: (v) => setDialogState(() => selected = v ?? selected),
            )).toList(),
          ),
          actions: [
            TextButton(onPressed: () => Navigator.pop(dialogContext), child: const Text('Cancel')),
            TextButton(onPressed: () => Navigator.pop(dialogContext, selected), child: const Text('Save', style: TextStyle(color: AppColors.cyan))),
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

  // Mirrors server/ai_integrations/object_storage/routes.ts's allow-list --
  // kept in sync manually since there's no shared schema for it. Anything
  // not in this map is rejected client-side before a wasted round trip.
  static const _contentTypeByExtension = {
    'jpg': 'image/jpeg', 'jpeg': 'image/jpeg', 'png': 'image/png', 'webp': 'image/webp', 'gif': 'image/gif',
    'pdf': 'application/pdf', 'csv': 'text/csv', 'txt': 'text/plain',
    'wav': 'audio/wav', 'mp3': 'audio/mpeg', 'aac': 'audio/aac', 'm4a': 'audio/mp4',
    'mp4': 'video/mp4', 'mov': 'video/quicktime', 'webm': 'video/webm', '3gp': 'video/3gpp',
    'doc': 'application/msword',
    'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'xls': 'application/vnd.ms-excel',
    'xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'ppt': 'application/vnd.ms-powerpoint',
    'pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'zip': 'application/zip',
  };
  static const _maxUploadBytes = 100 * 1024 * 1024;

  void _showAttachMenu() {
    showModalBottomSheet(
      context: context,
      backgroundColor: AppColors.surface,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(20))),
      builder: (sheetContext) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            ListTile(
              leading: const Icon(Icons.photo_outlined, color: AppColors.cyan),
              title: const Text('Photo', style: TextStyle(color: AppColors.white)),
              onTap: () {
                Navigator.pop(sheetContext);
                _pickAndSendImage();
              },
            ),
            ListTile(
              leading: const Icon(Icons.insert_drive_file_outlined, color: AppColors.cyan),
              title: const Text('Document / File', style: TextStyle(color: AppColors.white)),
              onTap: () {
                Navigator.pop(sheetContext);
                _pickAndSendFile();
              },
            ),
            ListTile(
              leading: const Icon(Icons.location_on_outlined, color: AppColors.cyan),
              title: const Text('Current Location', style: TextStyle(color: AppColors.white)),
              onTap: () {
                Navigator.pop(sheetContext);
                _shareCurrentLocation();
              },
            ),
          ],
        ),
      ),
    );
  }

  Future<void> _shareCurrentLocation() async {
    var permission = await Geolocator.checkPermission();
    if (permission == LocationPermission.denied) {
      permission = await Geolocator.requestPermission();
    }
    if (permission == LocationPermission.denied || permission == LocationPermission.deniedForever) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(
          content: const Text('Location permission is required to share your location.'),
          action: permission == LocationPermission.deniedForever
              ? SnackBarAction(label: 'Open Settings', onPressed: Geolocator.openAppSettings)
              : null,
        ));
      }
      return;
    }
    if (!await Geolocator.isLocationServiceEnabled()) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Turn on location services to share your location.')),
        );
      }
      return;
    }

    setState(() => _uploading = true);
    try {
      final position = await Geolocator.getCurrentPosition(
        locationSettings: const LocationSettings(accuracy: LocationAccuracy.high, timeLimit: Duration(seconds: 15)),
      );
      if (!mounted) return;
      await context.read<PersonalChatProvider>().sendMessage(
            _threadId,
            'Location',
            messageType: 'location',
            attachmentUrl: 'geo:${position.latitude},${position.longitude}',
            attachmentTitle: 'My Location',
          );
      _scrollToBottom();
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Could not get your location. Please try again.')),
        );
      }
    } finally {
      if (mounted) setState(() => _uploading = false);
    }
  }

  Future<void> _pickAndSendImage() async {
    // image_picker returning null is ambiguous by itself -- could mean the
    // user backed out of the gallery, or that Android silently refused
    // because photo access isn't granted. Previously this just returned
    // with no feedback either way, which looks identical to "nothing
    // happened" from a real permission denial -- check status explicitly so
    // a real denial gets a real message instead of silence.
    final photosStatus = await Permission.photos.status;
    if (photosStatus.isPermanentlyDenied) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Photo access is disabled for NeuraTalk. Enable it in system Settings > Apps > NeuraTalk > Permissions.')),
        );
      }
      return;
    }
    XFile? picked;
    try {
      picked = await ImagePicker().pickImage(source: ImageSource.gallery, maxWidth: 1600, imageQuality: 82);
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Could not open photos ($e).')),
        );
      }
      return;
    }
    if (picked == null) return;
    final bytes = await File(picked.path).readAsBytes();
    final ext = picked.path.split('.').last.toLowerCase();
    final contentType = switch (ext) { 'png' => 'image/png', 'webp' => 'image/webp', _ => 'image/jpeg' };
    await _uploadAndSend(
      bytes: bytes,
      fileName: 'chat-image.$ext',
      contentType: contentType,
      messageType: 'attachment',
      displayTitle: 'Photo',
    );
  }

  Future<void> _pickAndSendFile() async {
    FilePickerResult? result;
    try {
      result = await FilePicker.platform.pickFiles(withData: false);
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Could not open files ($e).')),
        );
      }
      return;
    }
    if (result == null || result.files.isEmpty) return;
    final picked = result.files.first;
    final path = picked.path;
    if (path == null) return;

    final sizeBytes = await File(path).length();
    if (sizeBytes == 0) return;
    if (sizeBytes > _maxUploadBytes) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('That file is too large (max ${_maxUploadBytes ~/ (1024 * 1024)}MB).')),
        );
      }
      return;
    }

    final ext = (picked.extension ?? path.split('.').last).toLowerCase();
    final contentType = _contentTypeByExtension[ext];
    if (contentType == null) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text("This file type isn't supported.")),
        );
      }
      return;
    }

    final bytes = await File(path).readAsBytes();
    await _uploadAndSend(
      bytes: bytes,
      fileName: picked.name,
      contentType: contentType,
      messageType: contentType.startsWith('image/') ? 'attachment' : 'file',
    );
  }

  /// Shared upload path for images and general files -- real progress
  /// (not an indeterminate spinner), cancellable, and offers a Retry action
  /// on failure without the user having to re-pick the file.
  Future<void> _uploadAndSend({
    required List<int> bytes,
    required String fileName,
    required String contentType,
    required String messageType,
    String? displayTitle,
  }) async {
    setState(() {
      _uploading = true;
      _uploadProgress = 0;
      _uploadFileName = fileName;
      _uploadCancelToken = UploadCancelToken();
    });
    try {
      final uploadInfo = await ApiService.post('/api/uploads/request-url', {
        'name': fileName,
        'size': bytes.length,
        'contentType': contentType,
      });
      await ApiService.putBytesWithProgress(
        uploadInfo['uploadURL'] as String,
        bytes,
        contentType,
        onProgress: (p) {
          if (mounted) setState(() => _uploadProgress = p);
        },
        cancelToken: _uploadCancelToken,
      );
      final objectPath = uploadInfo['objectPath'] as String;
      if (!mounted) return;
      await context.read<PersonalChatProvider>().sendMessage(
            _threadId,
            displayTitle ?? fileName,
            messageType: messageType,
            attachmentUrl: objectPath,
            attachmentTitle: fileName,
          );
      _scrollToBottom();
    } catch (e) {
      if (!mounted) return;
      final wasCancelled = _uploadCancelToken?.cancelled == true;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(
        content: Text(wasCancelled ? 'Upload cancelled.' : 'Could not send "$fileName". Please try again.'),
        action: wasCancelled
            ? null
            : SnackBarAction(
                label: 'Retry',
                onPressed: () => _uploadAndSend(
                  bytes: bytes,
                  fileName: fileName,
                  contentType: contentType,
                  messageType: messageType,
                  displayTitle: displayTitle,
                ),
              ),
      ));
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
      messenger.showSnackBar(SnackBar(content: Text(friendlyCallError(e))));
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
          // Real UX gap found from physical-device testing: tapping either
          // call button only disabled it (a barely-visible opacity change)
          // while the ~1-4s call-creation round trip ran -- nothing told the
          // user their tap had actually registered, so a slow network made
          // it look like the button simply didn't work. A real spinner in
          // place of the icon is immediate, unambiguous feedback that
          // doesn't require the server response to appear.
          IconButton(
            icon: _calling
                ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2, color: AppColors.cyan))
                : const Icon(Icons.call_outlined),
            onPressed: _calling ? null : () => _startCall(video: false),
          ),
          IconButton(
            icon: _calling
                ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2, color: AppColors.cyan))
                : const Icon(Icons.videocam_outlined),
            onPressed: _calling ? null : () => _startCall(video: true),
          ),
          PopupMenuButton<String>(
            icon: const Icon(Icons.more_vert, color: AppColors.textSecondary),
            color: AppColors.surface,
            onSelected: (value) {
              switch (value) {
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
              const PopupMenuItem(value: 'clear', child: Text('Clear chat', style: TextStyle(color: AppColors.white))),
              const PopupMenuItem(value: 'disappearing', child: Text('Disappearing messages', style: TextStyle(color: AppColors.white))),
              PopupMenuItem(
                value: 'block',
                child: Text(_blockedByMe ? 'Unblock' : 'Block', style: TextStyle(color: _blockedByMe ? AppColors.white : AppColors.red)),
              ),
              const PopupMenuItem(value: 'report', child: Text('Report', style: TextStyle(color: AppColors.red))),
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
                          style: const TextStyle(color: AppColors.textMuted, fontSize: 12),
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
                  Text('${(_uploadProgress * 100).toInt()}%', style: const TextStyle(color: AppColors.textMuted, fontSize: 12)),
                  IconButton(
                    icon: const Icon(Icons.close, color: AppColors.textMuted, size: 18),
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
                style: const TextStyle(color: AppColors.textMuted, fontSize: 13),
                textAlign: TextAlign.center,
              ),
            )
          else
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
          const Expanded(child: Text('Recording… tap the mic button to send', style: TextStyle(color: AppColors.textPrimary, fontSize: 13))),
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
            onPressed: _uploading ? null : _showAttachMenu,
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
                onTap: hasText
                    ? _send
                    : _uploading
                        ? null
                        : (_recording ? () => _stopRecordingAndSend(cancel: false) : _startRecording),
                child: Container(
                  padding: const EdgeInsets.all(14),
                  decoration: BoxDecoration(color: _recording ? AppColors.red : AppColors.cyan, shape: BoxShape.circle),
                  child: Icon(
                    hasText ? Icons.send : (_recording ? Icons.stop : Icons.mic),
                    color: AppColors.background,
                    size: 20,
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

  bool _downloading = false;

  /// Downloads the attachment through the app's own authenticated API
  /// (attachments are ACL-gated, not publicly fetchable) then hands it to
  /// the OS share sheet, whose "Save to Files"/"Save to device" action is
  /// the standard modern equivalent of a downloads-folder save on Android
  /// without needing broad storage permissions.
  Future<void> _downloadAndSaveFile(String attachmentUrl, String fileName) async {
    if (_downloading) return;
    setState(() => _downloading = true);
    try {
      final bytes = await ApiService.getBytes(attachmentUrl);
      final dir = await getTemporaryDirectory();
      final safeName = fileName.isEmpty ? 'file' : fileName;
      final file = File('${dir.path}/$safeName');
      await file.writeAsBytes(bytes);
      await Share.shareXFiles([XFile(file.path)], text: safeName);
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Could not download this file.')),
        );
      }
    } finally {
      if (mounted) setState(() => _downloading = false);
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
            else if (messageType == 'file' && attachmentUrl != null)
              GestureDetector(
                onTap: () async {
                  final url = Uri.parse('${ApiService.baseUrl}$attachmentUrl');
                  final opened = await launchUrl(url, mode: LaunchMode.externalApplication).catchError((_) => false);
                  if (!opened && mounted) {
                    ScaffoldMessenger.of(context).showSnackBar(
                      const SnackBar(content: Text('Could not open this file.')),
                    );
                  }
                },
                child: Container(
                  padding: const EdgeInsets.all(10),
                  decoration: BoxDecoration(
                    color: bubbleFg.withOpacity(0.08),
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Icon(Icons.insert_drive_file_outlined, color: bubbleFg, size: 28),
                      const SizedBox(width: 10),
                      Flexible(
                        child: Text(
                          attachmentTitle ?? 'File',
                          style: TextStyle(color: bubbleFg, fontSize: 13),
                          overflow: TextOverflow.ellipsis,
                        ),
                      ),
                      const SizedBox(width: 8),
                      GestureDetector(
                        onTap: () => _downloadAndSaveFile(attachmentUrl, attachmentTitle ?? 'file'),
                        child: _downloading
                            ? SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2, color: bubbleFg))
                            : Icon(Icons.download_outlined, color: bubbleFg, size: 20),
                      ),
                    ],
                  ),
                ),
              )
            else if (messageType == 'location' && attachmentUrl != null)
              GestureDetector(
                onTap: () async {
                  final coords = attachmentUrl.replaceFirst('geo:', '');
                  final url = Uri.parse('https://www.google.com/maps?q=$coords');
                  final opened = await launchUrl(url, mode: LaunchMode.externalApplication).catchError((_) => false);
                  if (!opened && mounted) {
                    ScaffoldMessenger.of(context).showSnackBar(
                      const SnackBar(content: Text('Could not open maps.')),
                    );
                  }
                },
                child: Container(
                  width: 220,
                  padding: const EdgeInsets.all(14),
                  decoration: BoxDecoration(
                    color: bubbleFg.withOpacity(0.08),
                    borderRadius: BorderRadius.circular(14),
                  ),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Icon(Icons.location_on, color: bubbleFg, size: 32),
                      const SizedBox(height: 8),
                      Text(attachmentTitle ?? 'Location', style: TextStyle(color: bubbleFg, fontSize: 13, fontWeight: FontWeight.w600)),
                      const SizedBox(height: 2),
                      Text('Tap to open in Maps', style: TextStyle(color: bubbleFg.withOpacity(0.65), fontSize: 11)),
                    ],
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
