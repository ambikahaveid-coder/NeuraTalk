import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';
import 'package:share_plus/share_plus.dart';
import '../theme/app_theme.dart';
import '../providers/auth_provider.dart';
import '../services/api_service.dart';
import 'edit_profile_screen.dart';
import 'settings_screen.dart';
import 'teams_screen.dart';
import 'transcript_history_screen.dart';
import 'wallet_screen.dart';

/// Profile / Subscription (brand mockup 13). Plan and minutes come from GET /api/billing/wallet.
class ProfileScreen extends StatefulWidget {
  const ProfileScreen({super.key});

  @override
  State<ProfileScreen> createState() => _ProfileScreenState();
}

class _ProfileScreenState extends State<ProfileScreen> {
  Map<String, dynamic>? _wallet;
  bool _walletFailed = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final w = await ApiService.get('/api/billing/wallet');
      if (mounted && w is Map<String, dynamic>) setState(() => _wallet = w);
    } catch (_) {
      if (mounted) setState(() => _walletFailed = true);
    }
  }

  void _go(Widget screen) => Navigator.push(context, MaterialPageRoute(builder: (_) => screen));

  static String _date(dynamic raw) {
    final dt = DateTime.tryParse(raw?.toString() ?? '')?.toLocal();
    if (dt == null) return '';
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return '${dt.day} ${months[dt.month - 1]} ${dt.year}';
  }

  @override
  Widget build(BuildContext context) {
    final user = context.watch<AuthProvider>().user;
    final contact = (user?['phone'] ?? user?['email'] ?? '').toString();
    final username = (user?['username'] ?? '').toString();
    final hasName = username.isNotEmpty && username != contact;
    final avatarUrl = user?['avatarUrl'] as String?;
    final business = SettingsScreen.isBusiness(user);

    return AnnotatedRegion<SystemUiOverlayStyle>(
      value: SystemUiOverlayStyle.light,
      child: Scaffold(
        backgroundColor: AppColors.backgroundMid,
        body: RefreshIndicator(
          onRefresh: _load,
          color: AppColors.cyan,
          child: ListView(
            padding: EdgeInsets.zero,
            children: [
              Stack(
                clipBehavior: Clip.none,
                children: [
                  Container(
                    height: 250,
                    decoration: const BoxDecoration(
                      gradient: RadialGradient(
                        center: Alignment(0.6, 1.4),
                        radius: 1.3,
                        colors: [Color(0xFF2453C9), Color(0xFF13245A), AppColors.navy],
                        stops: [0, 0.45, 1],
                      ),
                    ),
                    child: SafeArea(
                      bottom: false,
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          IconButton(
                            icon: const Icon(Icons.arrow_back, color: AppColors.onAccent),
                            onPressed: () => Navigator.maybePop(context),
                          ),
                          Padding(
                            padding: const EdgeInsets.fromLTRB(20, 4, 20, 0),
                            child: Row(
                              children: [
                                GestureDetector(
                                  onTap: () => _go(const EditProfileScreen()),
                                  child: Container(
                                    padding: const EdgeInsets.all(3),
                                    decoration: const BoxDecoration(color: AppColors.onAccent, shape: BoxShape.circle),
                                    child: CircleAvatar(
                                      radius: 34,
                                      backgroundColor: AppColors.navySoft,
                                      backgroundImage: avatarUrl != null ? NetworkImage('${ApiService.baseUrl}$avatarUrl') : null,
                                      child: avatarUrl == null
                                          ? Text(hasName ? username.characters.first.toUpperCase() : '?',
                                              style: const TextStyle(color: AppColors.onAccent, fontSize: 26, fontWeight: FontWeight.w700))
                                          : null,
                                    ),
                                  ),
                                ),
                                const SizedBox(width: 16),
                                Expanded(
                                  child: Column(
                                    crossAxisAlignment: CrossAxisAlignment.start,
                                    children: [
                                      Text(hasName ? username : 'Add your name', maxLines: 1, overflow: TextOverflow.ellipsis,
                                          style: const TextStyle(color: AppColors.onAccent, fontSize: 22, fontWeight: FontWeight.w700)),
                                      const SizedBox(height: 2),
                                      Text(business ? 'Business Account' : 'Personal Account',
                                          style: const TextStyle(color: Color(0xCCFFFFFF), fontSize: 14)),
                                      if (contact.isNotEmpty)
                                        Text(contact, style: const TextStyle(color: Color(0x99FFFFFF), fontSize: 13.5)),
                                    ],
                                  ),
                                ),
                              ],
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                  Positioned(left: 16, right: 16, top: 200, child: _planCard()),
                ],
              ),
              const SizedBox(height: 96),
              Padding(padding: const EdgeInsets.symmetric(horizontal: 16), child: _stats()),
              const SizedBox(height: 16),
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 16),
                child: Material(
                  color: AppColors.surface,
                  clipBehavior: Clip.antiAlias,
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(18), side: BorderSide(color: AppColors.border)),
                  child: Column(
                    children: [
                      _row(Icons.workspace_premium_outlined, 'Manage Subscription', () => _go(const WalletScreen())),
                      const Divider(height: 1, indent: 60),
                      _row(Icons.edit_outlined, hasName ? 'Edit Profile' : 'Add Name & Photo', () => _go(const EditProfileScreen())),
                      const Divider(height: 1, indent: 60),
                      _row(Icons.history, 'Call History & Transcripts', () => _go(const TranscriptHistoryScreen())),
                      const Divider(height: 1, indent: 60),
                      if (business) ...[
                        _row(Icons.groups_outlined, 'Teams', () => _go(const TeamsScreen())),
                        const Divider(height: 1, indent: 60),
                      ],
                      _row(Icons.person_add_alt_1_outlined, 'Invite Friends', () {
                        Share.share("I use NeuraTalk for calls and chat translated live into my language. Try it: https://neuratalk.in");
                      }),
                      const Divider(height: 1, indent: 60),
                      ListTile(
                        leading: const Icon(Icons.logout, color: AppColors.red),
                        title: const Text('Logout', style: TextStyle(color: AppColors.red, fontWeight: FontWeight.w700)),
                        onTap: () => SettingsScreen.confirmLogout(context),
                      ),
                    ],
                  ),
                ),
              ),
              const SizedBox(height: 32),
            ],
          ),
        ),
      ),
    );
  }

  Widget _planCard() {
    final sub = _wallet?['subscription'] as Map<String, dynamic>?;
    final active = sub != null;
    final title = _wallet == null
        ? (_walletFailed ? 'Plan unavailable' : 'Loading plan…')
        : (active ? (sub['planName']?.toString() ?? 'Active plan') : 'Free account');
    final subtitle = active
        ? (_date(sub['expiresAt']).isNotEmpty ? 'Valid till ${_date(sub['expiresAt'])}' : 'Active')
        : 'Choose a plan for more translated minutes';
    return Material(
      color: AppColors.surface,
      elevation: 6,
      shadowColor: AppColors.navy.withValues(alpha: 0.25),
      borderRadius: BorderRadius.circular(18),
      child: InkWell(
        borderRadius: BorderRadius.circular(18),
        onTap: () => _go(const WalletScreen()),
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Row(
            children: [
              Container(
                width: 48,
                height: 48,
                decoration: BoxDecoration(color: const Color(0xFFF59E0B).withValues(alpha: 0.15), borderRadius: BorderRadius.circular(14)),
                child: const Icon(Icons.workspace_premium, color: Color(0xFFF59E0B), size: 28),
              ),
              const SizedBox(width: 14),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(title, style: TextStyle(color: AppColors.ink, fontSize: 17, fontWeight: FontWeight.w700)),
                    const SizedBox(height: 2),
                    Text(subtitle, style: TextStyle(color: AppColors.textSecondary, fontSize: 13.5)),
                  ],
                ),
              ),
              if (active)
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                  decoration: BoxDecoration(color: AppColors.green, borderRadius: BorderRadius.circular(20)),
                  child: const Text('Active', style: TextStyle(color: AppColors.onAccent, fontSize: 12.5, fontWeight: FontWeight.w700)),
                )
              else if (_wallet != null)
                Text('Upgrade', style: TextStyle(color: AppColors.cyan, fontWeight: FontWeight.w700)),
            ],
          ),
        ),
      ),
    );
  }

  Widget _stats() {
    String fmt(num? n) {
      if (n == null) return '–';
      if (n >= 1000) return '${(n / 1000).toStringAsFixed(n >= 10000 ? 0 : 1)}K';
      return n.toStringAsFixed(0);
    }

    final left = (_wallet?['minutesRemaining'] ?? _wallet?['remainingMinutes']) as num?;
    final used = _wallet?['minutesUsed'] as num?;
    final balance = (_wallet?['balanceInr'] as num?) ?? ((_wallet?['balancePaise'] as num?) != null ? (_wallet!['balancePaise'] as num) / 100 : null);
    final items = [
      (fmt(left), 'Minutes left'),
      (fmt(used), 'Minutes used'),
      (balance == null ? '–' : '₹${balance.toStringAsFixed(0)}', 'Wallet'),
    ];
    return Container(
      padding: const EdgeInsets.symmetric(vertical: 16),
      decoration: BoxDecoration(color: AppColors.surface, borderRadius: BorderRadius.circular(18), border: Border.all(color: AppColors.border)),
      child: Row(
        children: [
          for (var i = 0; i < items.length; i++) ...[
            Expanded(
              child: Column(
                children: [
                  Text(items[i].$1, style: TextStyle(color: AppColors.ink, fontSize: 22, fontWeight: FontWeight.w800)),
                  const SizedBox(height: 2),
                  Text(items[i].$2, style: TextStyle(color: AppColors.textSecondary, fontSize: 12.5)),
                ],
              ),
            ),
            if (i < items.length - 1) Container(width: 1, height: 36, color: AppColors.border),
          ],
        ],
      ),
    );
  }

  Widget _row(IconData icon, String title, VoidCallback onTap) {
    return ListTile(
      leading: Icon(icon, color: AppColors.ink),
      title: Text(title, style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w600)),
      trailing: Icon(Icons.chevron_right, color: AppColors.textMuted),
      onTap: onTap,
    );
  }
}
