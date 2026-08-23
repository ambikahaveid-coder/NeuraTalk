import 'package:flutter/material.dart';
import 'package:flutter_contacts/flutter_contacts.dart';
import 'package:provider/provider.dart';
import 'package:share_plus/share_plus.dart';
import '../theme/app_theme.dart';
import '../providers/personal_chat_provider.dart';
import '../services/api_service.dart';
import '../services/call_service.dart';
import 'conversation_screen.dart';
import 'call_screen.dart';

/// Privacy-preserving contacts sync: reads the device address book locally,
/// sends ONLY phone numbers to the server (never names/photos/emails --
/// see server/contact-routes.ts:match-phones), and shows which of those
/// numbers are already NeuraTalk users. Non-matching contacts are never
/// claimed to be NeuraTalk users and their data never leaves the device
/// beyond the phone-number lookup.
class ContactsScreen extends StatefulWidget {
  const ContactsScreen({super.key});

  @override
  State<ContactsScreen> createState() => _ContactsScreenState();
}

class _ContactsScreenState extends State<ContactsScreen> {
  bool _loading = true;
  bool _permissionDenied = false;
  List<Map<String, dynamic>> _neuraTalkContacts = [];
  List<Contact> _otherContacts = [];

  // Real gap found from physical-device testing: this screen's call buttons
  // had no double-tap guard and no visual feedback at all while the ~1-4s
  // call-creation round trip ran -- a slow network made a tap here look
  // like it silently did nothing. Tracked per-contact (not a single bool)
  // since this is a list of many contacts, not one dial pad.
  int? _callingContactId;

  @override
  void initState() {
    super.initState();
    _sync();
  }

  String _digitsOnly(String s) => s.replaceAll(RegExp(r'\D'), '');

  Future<void> _sync() async {
    setState(() {
      _loading = true;
      _permissionDenied = false;
    });

    final granted = await FlutterContacts.requestPermission(readonly: true);
    if (!granted) {
      if (mounted) setState(() { _loading = false; _permissionDenied = true; });
      return;
    }

    try {
      final deviceContacts = await FlutterContacts.getContacts(withProperties: true);
      final phoneToContact = <String, Contact>{};
      final allNumbers = <String>{};
      for (final contact in deviceContacts) {
        for (final phone in contact.phones) {
          final digits = _digitsOnly(phone.number);
          if (digits.length < 6) continue;
          allNumbers.add(phone.number);
          final suffix = digits.length > 10 ? digits.substring(digits.length - 10) : digits;
          phoneToContact[suffix] = contact;
        }
      }

      Map<String, dynamic> matchRes = {'matches': []};
      if (allNumbers.isNotEmpty) {
        try {
          matchRes = await ApiService.post('/api/contacts/match-phones', {'phones': allNumbers.toList()});
        } catch (_) {
          // Sync failing shouldn't block showing local contacts.
        }
      }

      final matches = (matchRes['matches'] as List? ?? []).cast<Map<String, dynamic>>();
      final matchedContactIds = <String>{};
      final neuraTalkContacts = <Map<String, dynamic>>[];

      for (final match in matches) {
        final matchedPhone = match['phone']?.toString() ?? '';
        final digits = _digitsOnly(matchedPhone);
        final suffix = digits.length > 10 ? digits.substring(digits.length - 10) : digits;
        final deviceContact = phoneToContact[suffix];
        if (deviceContact != null) matchedContactIds.add(deviceContact.id);
        neuraTalkContacts.add({
          ...match,
          'localName': deviceContact?.displayName,
        });
      }

      final otherContacts = deviceContacts
          .where((c) => !matchedContactIds.contains(c.id) && c.phones.isNotEmpty)
          .toList()
        ..sort((a, b) => a.displayName.compareTo(b.displayName));

      if (mounted) {
        setState(() {
          _neuraTalkContacts = neuraTalkContacts;
          _otherContacts = otherContacts;
          _loading = false;
        });
      }
    } catch (_) {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _openChat(Map<String, dynamic> match) async {
    try {
      final thread = await context.read<PersonalChatProvider>().startThread(userId: match['id'] as int);
      if (!mounted || thread == null) return;
      Navigator.push(context, MaterialPageRoute(builder: (_) => ConversationScreen(thread: thread)));
    } catch (_) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Could not open chat.')));
    }
  }

  Future<void> _call(Map<String, dynamic> match, {required bool video}) async {
    if (_callingContactId != null) return;
    final contactId = match['id'] as int;
    setState(() => _callingContactId = contactId);
    final callService = context.read<CallService>();
    try {
      final session = await callService.startCall(
        calleeIdentifier: match['username']?.toString() ?? match['phone'].toString(),
        callType: video ? 'video' : 'voice',
      );
      if (!mounted) return;
      Navigator.push(context, MaterialPageRoute(builder: (_) => CallScreen(session: session, callService: callService)));
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(friendlyCallError(e))));
    } finally {
      if (mounted) setState(() => _callingContactId = null);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(title: const Text('Contacts')),
      body: _loading
          ? const Center(child: CircularProgressIndicator(color: AppColors.cyan))
          : _permissionDenied
              ? _permissionDeniedState()
              : RefreshIndicator(
                  onRefresh: _sync,
                  color: AppColors.cyan,
                  child: ListView(
                    children: [
                      if (_neuraTalkContacts.isNotEmpty) ...[
                        _sectionHeader('NeuraTalk Contacts'),
                        ..._neuraTalkContacts.map(_neuraTalkTile),
                      ],
                      if (_otherContacts.isNotEmpty) ...[
                        _sectionHeader('Invite to NeuraTalk'),
                        ..._otherContacts.map(_inviteTile),
                      ],
                      if (_neuraTalkContacts.isEmpty && _otherContacts.isEmpty)
                        const Padding(
                          padding: EdgeInsets.all(32),
                          child: Center(child: Text('No contacts with phone numbers found.', style: TextStyle(color: AppColors.textMuted))),
                        ),
                    ],
                  ),
                ),
    );
  }

  Widget _permissionDeniedState() {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(Icons.contacts_outlined, color: AppColors.textMuted, size: 48),
            const SizedBox(height: 16),
            const Text(
              'NeuraTalk uses your contacts only to find people you know who already use the app. Only phone numbers are sent — never names or photos.',
              style: TextStyle(color: AppColors.textSecondary),
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: 20),
            ElevatedButton(onPressed: _sync, child: const Text('Allow Contacts Access')),
          ],
        ),
      ),
    );
  }

  Widget _sectionHeader(String title) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 16, 16, 4),
      child: Text(title, style: const TextStyle(color: AppColors.textMuted, fontSize: 12, fontWeight: FontWeight.w700)),
    );
  }

  Widget _neuraTalkTile(Map<String, dynamic> match) {
    final avatarUrl = match['avatarUrl'] as String?;
    final name = match['localName']?.toString() ?? match['username']?.toString() ?? 'NeuraTalk user';
    final isCallingThis = _callingContactId == match['id'];
    final anyCallInFlight = _callingContactId != null;
    return ListTile(
      leading: CircleAvatar(
        backgroundColor: AppColors.cyan.withOpacity(0.15),
        backgroundImage: avatarUrl != null ? NetworkImage('${ApiService.baseUrl}$avatarUrl') : null,
        child: avatarUrl == null ? const Icon(Icons.person, color: AppColors.cyan) : null,
      ),
      title: Text(name, style: const TextStyle(color: AppColors.white, fontWeight: FontWeight.w600)),
      subtitle: Text('@${match['username']}', style: const TextStyle(color: AppColors.textMuted, fontSize: 12)),
      onTap: () => _openChat(match),
      trailing: isCallingThis
          ? const Padding(
              padding: EdgeInsets.symmetric(horizontal: 12),
              child: SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2, color: AppColors.cyan)),
            )
          : Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                IconButton(
                  icon: const Icon(Icons.call_outlined, color: AppColors.cyan),
                  onPressed: anyCallInFlight ? null : () => _call(match, video: false),
                ),
                IconButton(
                  icon: const Icon(Icons.videocam_outlined, color: AppColors.cyan),
                  onPressed: anyCallInFlight ? null : () => _call(match, video: true),
                ),
              ],
            ),
    );
  }

  Widget _inviteTile(Contact contact) {
    return ListTile(
      leading: const CircleAvatar(backgroundColor: AppColors.surfaceElevated, child: Icon(Icons.person_outline, color: AppColors.textMuted)),
      title: Text(contact.displayName, style: const TextStyle(color: AppColors.white)),
      trailing: TextButton(
        onPressed: () => Share.share(
          "Let's chat on NeuraTalk — real-time translated voice & video calls. https://neuratalk.in",
        ),
        child: const Text('Invite', style: TextStyle(color: AppColors.cyan)),
      ),
    );
  }
}
