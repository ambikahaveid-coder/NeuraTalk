import 'package:flutter/foundation.dart';
import 'package:flutter_contacts/flutter_contacts.dart';

/// App-wide local Android-contact name lookup, so a person saved in the
/// user's own address book shows their real name (e.g. "Ravi Kumar")
/// instead of a raw phone number, wherever NeuraTalk would otherwise show
/// just the number. Never sends contact names anywhere -- this only reads
/// the local device address book (contacts_screen.dart's existing
/// privacy-preserving sync already does the same local read for its own
/// purpose; this is the same data, exposed as a shared, app-wide lookup so
/// every screen doesn't have to re-implement the matching).
///
/// Matches by the last 10 digits of a phone number, which is what actually
/// distinguishes India-format numbers regardless of how they're written --
/// "+9194XXXXXXXX", "094XXXXXXXX", and "94XXXXXXXX" all reduce to the same
/// 10-digit suffix. This intentionally does not attempt full E.164
/// normalization (locale-correct country-code parsing), which would need a
/// phone-number-parsing package this app doesn't otherwise depend on --
/// last-10-digits is what contacts_screen.dart already relied on and is
/// correct for the single-country (India) case this product targets today.
class ContactResolver {
  ContactResolver._();
  static final ContactResolver instance = ContactResolver._();

  Map<String, String> _byPhoneSuffix = {};
  bool _loaded = false;
  bool _loading = false;

  String _digitsOnly(String s) => s.replaceAll(RegExp(r'\D'), '');

  String? _suffixOf(String phone) {
    final digits = _digitsOnly(phone);
    if (digits.length < 6) return null;
    return digits.length > 10 ? digits.substring(digits.length - 10) : digits;
  }

  /// Best-effort load -- does nothing if permission isn't already granted
  /// (doesn't itself prompt; contacts_screen.dart owns that UX). Safe to
  /// call repeatedly; only does real work once per app session unless
  /// [force] is set (e.g. after the user grants permission or edits their
  /// address book).
  Future<void> ensureLoaded({bool force = false}) async {
    if ((_loaded && !force) || _loading) return;
    _loading = true;
    try {
      final granted = await FlutterContacts.requestPermission(readonly: true).timeout(
        const Duration(seconds: 5),
        onTimeout: () => false,
      );
      if (!granted) {
        _loaded = true;
        return;
      }
      final contacts = await FlutterContacts.getContacts(withProperties: true);
      final map = <String, String>{};
      for (final contact in contacts) {
        if (contact.displayName.trim().isEmpty) continue;
        for (final phone in contact.phones) {
          final suffix = _suffixOf(phone.number);
          if (suffix != null) map[suffix] = contact.displayName;
        }
      }
      _byPhoneSuffix = map;
      _loaded = true;
    } catch (_) {
      _loaded = true;
    } finally {
      _loading = false;
    }
  }

  /// Synchronous lookup for use directly inside build() methods -- call
  /// ensureLoaded() once during app/screen init so this has data by the
  /// time it's actually rendered; returns null (falls back to whatever the
  /// caller already shows) if contacts aren't loaded yet or there's no
  /// match.
  String? nameFor(String? phoneNumber) {
    if (phoneNumber == null || phoneNumber.isEmpty) return null;
    final suffix = _suffixOf(phoneNumber);
    if (suffix == null) return null;
    return _byPhoneSuffix[suffix];
  }

  /// For call screens, which only ever carry a single `remoteName` string
  /// that's already either a real display name (chat/contact-originated
  /// calls) or a raw dialed number (dial-pad calls) -- no separate phone
  /// field exists on CallSession to look up independently. If it looks like
  /// a phone number, try resolving it against contacts; otherwise it's
  /// already a name, leave it alone.
  String displayNameFor(String remoteName) {
    final looksLikePhone = RegExp(r'^\+?[\d\s-]{6,}$').hasMatch(remoteName);
    if (!looksLikePhone) return remoteName;
    return nameFor(remoteName) ?? remoteName;
  }

  @visibleForTesting
  void debugSeed(Map<String, String> bySuffix) {
    _byPhoneSuffix = bySuffix;
    _loaded = true;
  }
}
