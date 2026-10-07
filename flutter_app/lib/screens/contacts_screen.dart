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
import 'user_discovery_screen.dart';

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

    bool granted;
    try {
      granted = await FlutterContacts.requestPermission(readonly: true);
    } catch (_) {
      granted = false;
    }
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

  int _tab = 0; // 0 All, 1 On NeuraTalk, 2 Invite
  String _query = '';

  static const _avatarColors = [Color(0xFF1E66F5), Color(0xFF16A34A), Color(0xFFEA580C), Color(0xFF6D4AFF), Color(0xFF0EA5E9), Color(0xFFDB2777)];

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.background,
      floatingActionButton: FloatingActionButton(
        heroTag: 'contacts-add',
        tooltip: 'Find people on NeuraTalk',
        backgroundColor: AppColors.cyan,
        foregroundColor: AppColors.onAccent,
        shape: const CircleBorder(),
        elevation: 3,
        focusElevation: 3,
        hoverElevation: 3,
        highlightElevation: 3,
        onPressed: () => Navigator.push(context, MaterialPageRoute(builder: (_) => const UserDiscoveryScreen())),
        child: const Icon(Icons.add, size: 28),
      ),
      body: SafeArea(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 12, 8, 0),
              child: Row(
                children: [
                  Expanded(
                    child: Text('Contacts', style: TextStyle(color: AppColors.ink, fontSize: 30, fontWeight: FontWeight.w800, letterSpacing: -0.5)),
                  ),
                  IconButton(
                    tooltip: 'Refresh',
                    icon: Icon(Icons.sync, color: AppColors.textSecondary),
                    onPressed: _loading ? null : _sync,
                  ),
                ],
              ),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 12, 16, 0),
              child: Row(
                children: [
                  for (final (i, label) in const [(0, 'All'), (1, 'On NeuraTalk'), (2, 'Invite')])
                    Padding(
                      padding: const EdgeInsets.only(right: 8),
                      child: ChoiceChip(
                        label: Text(label),
                        selected: _tab == i,
                        showCheckmark: false,
                        onSelected: (_) => setState(() => _tab = i),
                        labelStyle: TextStyle(
                          color: _tab == i ? AppColors.cyan : AppColors.textSecondary,
                          fontWeight: _tab == i ? FontWeight.w700 : FontWeight.w500,
                          fontSize: 14,
                        ),
                        backgroundColor: AppColors.background,
                        selectedColor: AppColors.blueTint,
                        side: BorderSide(color: _tab == i ? AppColors.blueTint : AppColors.border),
                        shape: const StadiumBorder(),
                      ),
                    ),
                ],
              ),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 12, 16, 4),
              child: TextField(
                onChanged: (v) => setState(() => _query = v),
                decoration: InputDecoration(
                  prefixIcon: Icon(Icons.search, color: AppColors.textMuted),
                  hintText: 'Search contacts...',
                  contentPadding: EdgeInsets.symmetric(vertical: 14),
                ),
              ),
            ),
            Expanded(
              child: _loading
                  ? Center(child: CircularProgressIndicator(color: AppColors.cyan))
                  : _permissionDenied
                      ? _permissionDeniedState()
                      : RefreshIndicator(onRefresh: _sync, color: AppColors.cyan, child: _list()),
            ),
          ],
        ),
      ),
    );
  }

  Widget _list() {
    final q = _query.trim().toLowerCase();
    bool match(String name, String extra) => q.isEmpty || name.toLowerCase().contains(q) || extra.contains(q);

    // One sorted list of entries: NeuraTalk users first in "All" is not how address books work,
    // so everything is sorted A–Z and NeuraTalk users are marked.
    final entries = <(String, Map<String, dynamic>?, Contact?)>[];
    if (_tab != 2) {
      for (final m in _neuraTalkContacts) {
        final name = m['localName']?.toString() ?? m['username']?.toString() ?? 'NeuraTalk user';
        if (match(name, m['phone']?.toString() ?? '')) entries.add((name, m, null));
      }
    }
    if (_tab != 1) {
      for (final c in _otherContacts) {
        final phone = c.phones.isNotEmpty ? c.phones.first.number : '';
        if (match(c.displayName, phone)) entries.add((c.displayName, null, c));
      }
    }
    entries.sort((a, b) => a.$1.toLowerCase().compareTo(b.$1.toLowerCase()));

    if (entries.isEmpty) {
      return ListView(children: [
        Padding(
          padding: const EdgeInsets.all(40),
          child: Center(
            child: Text(
              q.isNotEmpty
                  ? 'No contacts match "$_query"'
                  : _tab == 1
                      ? 'None of your contacts use NeuraTalk yet. Invite them!'
                      : 'No contacts with phone numbers found.',
              textAlign: TextAlign.center,
              style: TextStyle(color: AppColors.textMuted, fontSize: 15),
            ),
          ),
        ),
      ]);
    }

    final children = <Widget>[];
    String? letter;
    for (final e in entries) {
      final first = e.$1.isEmpty ? '#' : e.$1.characters.first.toUpperCase();
      final l = RegExp(r'[A-Z]').hasMatch(first) ? first : '#';
      if (l != letter) {
        letter = l;
        children.add(Padding(
          padding: const EdgeInsets.fromLTRB(20, 14, 20, 4),
          child: Text(l, style: TextStyle(color: AppColors.textMuted, fontSize: 14, fontWeight: FontWeight.w700)),
        ));
      }
      children.add(e.$2 != null ? _neuraTalkTile(e.$2!, e.$1) : _inviteTile(e.$3!));
    }
    children.add(const SizedBox(height: 96));
    return ListView(children: children);
  }

  Widget _avatar(String name, {String? avatarUrl}) {
    final initial = name.isNotEmpty && RegExp(r'[A-Za-z]').hasMatch(name.characters.first) ? name.characters.first.toUpperCase() : null;
    final color = _avatarColors[name.hashCode.abs() % _avatarColors.length];
    return CircleAvatar(
      radius: 24,
      backgroundColor: color.withValues(alpha: 0.14),
      backgroundImage: avatarUrl != null ? NetworkImage('${ApiService.baseUrl}$avatarUrl') : null,
      child: avatarUrl == null
          ? (initial != null
              ? Text(initial, style: TextStyle(color: color, fontSize: 18, fontWeight: FontWeight.w700))
              : Icon(Icons.person, color: color))
          : null,
    );
  }

  Widget _permissionDeniedState() {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(
              padding: const EdgeInsets.all(22),
              decoration: BoxDecoration(color: AppColors.blueTint, shape: BoxShape.circle),
              child: Icon(Icons.contacts_outlined, color: AppColors.cyan, size: 40),
            ),
            const SizedBox(height: 20),
            Text('Find friends on NeuraTalk', style: TextStyle(color: AppColors.ink, fontSize: 20, fontWeight: FontWeight.w700)),
            const SizedBox(height: 8),
            Text(
              'We only check phone numbers to show who already uses NeuraTalk. Names and photos never leave your phone.',
              style: TextStyle(color: AppColors.textSecondary, fontSize: 15, height: 1.4),
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: 24),
            ElevatedButton(onPressed: _sync, child: const Text('Allow contacts access')),
          ],
        ),
      ),
    );
  }

  Widget _neuraTalkTile(Map<String, dynamic> match, String name) {
    final isCallingThis = _callingContactId == match['id'];
    final anyCallInFlight = _callingContactId != null;
    return ListTile(
      contentPadding: const EdgeInsets.fromLTRB(20, 2, 8, 2),
      leading: _avatar(name, avatarUrl: match['avatarUrl'] as String?),
      title: Text(name, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w600)),
      subtitle: Row(children: [
        Icon(Icons.verified, color: AppColors.cyan, size: 14),
        SizedBox(width: 4),
        Text('On NeuraTalk', style: TextStyle(color: AppColors.textSecondary, fontSize: 13.5)),
      ]),
      onTap: () => _openChat(match),
      trailing: isCallingThis
          ? Padding(
              padding: EdgeInsets.symmetric(horizontal: 16),
              child: SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2, color: AppColors.cyan)),
            )
          : Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                IconButton(
                  tooltip: 'Call',
                  icon: Icon(Icons.call_outlined, color: AppColors.cyan),
                  onPressed: anyCallInFlight ? null : () => _call(match, video: false),
                ),
                IconButton(
                  tooltip: 'Message',
                  icon: Icon(Icons.chat_bubble_outline, color: AppColors.cyan),
                  onPressed: () => _openChat(match),
                ),
              ],
            ),
    );
  }

  Widget _inviteTile(Contact contact) {
    return ListTile(
      contentPadding: const EdgeInsets.fromLTRB(20, 2, 12, 2),
      leading: _avatar(contact.displayName),
      title: Text(contact.displayName, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w600)),
      subtitle: Text(contact.phones.isNotEmpty ? contact.phones.first.number : '',
          style: TextStyle(color: AppColors.textSecondary, fontSize: 13.5)),
      trailing: OutlinedButton(
        onPressed: () => Share.share(
          "Let's talk on NeuraTalk: calls and chat translated live into your language. https://neuratalk.in",
        ),
        style: OutlinedButton.styleFrom(
          foregroundColor: AppColors.cyan,
          side: BorderSide(color: AppColors.cyan),
          shape: const StadiumBorder(),
          padding: const EdgeInsets.symmetric(horizontal: 16),
          minimumSize: const Size(0, 36),
        ),
        child: const Text('Invite'),
      ),
    );
  }
}
