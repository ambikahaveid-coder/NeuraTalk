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
              leading: Icon(Icons.reply, color: AppColors.cyan),
              title: Text('Reply', style: TextStyle(color: AppColors.ink)),
              onTap: () {
                Navigator.pop(sheetContext);
                _startReply(message);
              },
            ),
            ListTile(
              leading: Icon(Icons.copy_outlined, color: AppColors.cyan),
              title: Text('Copy', style: TextStyle(color: AppColors.ink)),
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
                width: 56,
                height: 56,
                decoration: BoxDecoration(color: color, shape: BoxShape.circle),
                child: Icon(icon, color: AppColors.onAccent, size: 26),
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
            ],
          ),
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
              ? SnackBarAction(label: 'Open settings', onPressed: Geolocator.openAppSettings)
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

  void _toast(String text) {
    if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(text)));
  }

  /// Photos and videos from the gallery, up to 10 at once. Sent as the original
  /// files, so GIFs stay animated and photos keep full quality.
  Future<void> _pickFromGallery() async {
    final photosStatus = await Permission.photos.status;
    if (photosStatus.isPermanentlyDenied) {
      _toast('Photo access is turned off for NeuraTalk. Turn it on in Settings > Apps > NeuraTalk > Permissions.');
      return;
    }
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
  Future<bool> _uploadAndSend(File file, String name, int size, {String? position}) async {
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
          );
      _scrollToBottom();
      return true;
    } catch (e) {
      if (!mounted) return false;
      final wasCancelled = _uploadCancelToken?.cancelled == true;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(
        content: Text(wasCancelled ? 'Upload cancelled.' : 'Could not send "$name". Check your internet and try again.'),
        action: wasCancelled ? null : SnackBarAction(label: 'Retry', onPressed: () => _uploadAndSend(file, name, size)),
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
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.fromLTRB(12, 6, 12, 8),
      decoration: BoxDecoration(color: AppColors.background, border: Border(bottom: BorderSide(color: AppColors.border))),
      child: Row(children: [
        LanguagePairChip(
          mine: mine,
          theirs: theirs,
          onTapMine: () async {
            await Navigator.push(context, MaterialPageRoute(builder: (_) => const LanguagePreferencesScreen()));
            if (mounted) context.read<PersonalChatProvider>().openThread(_threadId);
          },
        ),
        const Spacer(),
        LiveBadge(on: !same, label: same ? 'Same language' : 'Live translation'),
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
        title: Row(
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
              PopupMenuItem(value: 'clear', child: Text('Clear chat', style: TextStyle(color: AppColors.ink))),
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
                            itemBuilder: (_, i) => _PersonalMessageBubble(
                              message: provider.messages[i],
                              onRetry: () => context.read<PersonalChatProvider>().retryMessage(_threadId, provider.messages[i]),
                              onLongPress: () => _showMessageActions(provider.messages[i]),
                              repliedMessage: _findMessageById(_asMessageId(provider.messages[i]['replyToId'])),
                              peerLanguage: _peerLanguage(provider),
                              myLanguage: _myLanguage(provider),
                            ),
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
      padding: const EdgeInsets.fromLTRB(10, 8, 10, 12),
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
                        hintText: 'Type a message...',
                        hintStyle: TextStyle(color: AppColors.textMuted),
                        border: InputBorder.none,
                        enabledBorder: InputBorder.none,
                        focusedBorder: InputBorder.none,
                        filled: false,
                        isDense: true,
                        contentPadding: EdgeInsets.symmetric(vertical: 14),
                      ),
                      onSubmitted: (_) => _send(),
                    ),
                  ),
                  IconButton(
                    tooltip: 'Attach',
                    icon: Icon(Icons.attach_file, color: AppColors.textMuted),
                    onPressed: _uploading ? null : _showAttachMenu,
                  ),
                  IconButton(
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
                  width: 50,
                  height: 50,
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

class _PersonalMessageBubble extends StatefulWidget {
  final Map<String, dynamic> message;
  final VoidCallback onRetry;
  final VoidCallback? onLongPress;
  final Map<String, dynamic>? repliedMessage;
  /// The other person's language (for "They read …" under my own messages).
  final String? peerLanguage;
  final String? myLanguage;
  const _PersonalMessageBubble({
    required this.message,
    required this.onRetry,
    this.onLongPress,
    this.repliedMessage,
    this.peerLanguage,
    this.myLanguage,
  });

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
    final hasText = !isDeleted && (messageType == 'text' || (isVoice && message['voiceTranscribed'] == true));
    final texts = _texts();
    final fg = AppColors.textPrimary;
    final isMedia = (messageType == 'attachment' || messageType == 'file') && attachmentUrl != null;

    return Align(
      alignment: isOwn ? Alignment.centerRight : Alignment.centerLeft,
      child: GestureDetector(
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
              if (messageType == 'attachment' && attachmentUrl != null)
                ChatImageAttachment(objectPath: attachmentUrl, name: attachmentTitle ?? 'photo.jpg')
              else if (messageType == 'file' && attachmentUrl != null && MediaStore.kindOf(attachmentTitle ?? '', mime: attachmentMime) == MediaKind.video)
                ChatVideoAttachment(objectPath: attachmentUrl, name: attachmentTitle ?? 'video.mp4', size: attachmentSize)
              else if (messageType == 'file' && attachmentUrl != null)
                ChatFileAttachment(objectPath: attachmentUrl, name: attachmentTitle ?? 'file', size: attachmentSize, mime: attachmentMime)
              else if (messageType == 'location' && attachmentUrl != null)
                _location(attachmentUrl, attachmentTitle)
              else if (isVoice)
                _voicePlayer(attachmentUrl, attachmentTitle),
              if (isDeleted)
                Text('This message was deleted', style: TextStyle(color: AppColors.textMuted, fontSize: 15, fontStyle: FontStyle.italic)),
              if (hasText) ...[
                if (isVoice) const SizedBox(height: 8),
                Text(texts.primary, style: TextStyle(color: fg, fontSize: 16, height: 1.35)),
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
      ),
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
      if (texts != null) NtListenButton(text: texts.listenText, language: texts.listenLang),
      if (texts != null) const SizedBox(width: 8),
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

  Widget _location(String attachmentUrl, String? title) {
    return InkWell(
      borderRadius: BorderRadius.circular(14),
      onTap: () async {
        final coords = attachmentUrl.replaceFirst('geo:', '');
        final opened = await launchUrl(Uri.parse('https://www.google.com/maps?q=$coords'), mode: LaunchMode.externalApplication)
            .catchError((_) => false);
        if (!opened && mounted) {
          ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Could not open maps.')));
        }
      },
      child: Container(
        width: 230,
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(color: AppColors.green.withValues(alpha: 0.1), borderRadius: BorderRadius.circular(14)),
        child: Row(children: [
          const Icon(Icons.location_on, color: AppColors.green, size: 30),
          const SizedBox(width: 10),
          Expanded(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, mainAxisSize: MainAxisSize.min, children: [
              Text(title ?? 'Location', style: TextStyle(color: AppColors.ink, fontSize: 14.5, fontWeight: FontWeight.w600)),
              Text('Open in Maps', style: TextStyle(color: AppColors.textSecondary, fontSize: 12.5)),
            ]),
          ),
        ]),
      ),
    );
  }
}
