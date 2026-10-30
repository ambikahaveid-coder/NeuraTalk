import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';
import 'package:qr_flutter/qr_flutter.dart';
import 'package:share_plus/share_plus.dart';

import '../services/api_service.dart';
import '../theme/app_theme.dart';
import '../widgets/nt_ui.dart';
import 'business_account.dart';
import 'business_catalog_screen.dart';
import 'business_broadcasts_screen.dart';
import 'business_orders_screen.dart';
import 'business_status_screen.dart';
import 'business_verification_screen.dart';
import 'business_categories.dart';
import 'business_messaging_settings.dart';
import 'business_profile_screen.dart';

/// Business tools (WhatsApp Business → Tools): profile, catalog, automatic
/// replies, quick replies, link & QR, statistics and the verified tick.
class BusinessToolsScreen extends StatelessWidget {
  const BusinessToolsScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final account = context.watch<BusinessAccount>();
    // Pushed screens sit above the shell's provider: hand the account on.
    void open(Widget screen) => Navigator.push(context, MaterialPageRoute(
          builder: (_) => ChangeNotifierProvider<BusinessAccount>.value(value: account, child: screen),
        ));
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(title: const Text('Tools')),
      body: RefreshIndicator(
        onRefresh: account.load,
        child: ListView(
          padding: const EdgeInsets.only(bottom: 32),
          children: [
            BusinessIdentityCard(onTap: () => open(const BusinessProfileScreen())),
            const _VerificationCard(),
            const _AccountHealthCard(),
            const _Section('Your business'),
            _tool(Icons.storefront_outlined, 'Business profile', 'Logo, about, address, website', () => open(const BusinessProfileScreen())),
            _tool(Icons.shopping_bag_outlined, 'Catalog', 'Products and services with prices', () => open(const BusinessCatalogScreen())),
            _tool(Icons.receipt_long_outlined, 'Orders', 'Orders customers sent from your catalog', () => open(const BusinessOrdersScreen())),
            _tool(Icons.qr_code_2, 'Short link & QR code', 'Let customers start a chat with you', () => open(const BusinessLinkScreen())),
            const _Section('Messaging'),
            _tool(Icons.waving_hand_outlined, 'Greeting message', 'Welcome new customers automatically', () => open(const GreetingMessageScreen())),
            _tool(Icons.schedule_outlined, 'Away message & hours', 'Reply when you are closed', () => open(const AwayMessageScreen())),
            _tool(Icons.bolt_outlined, 'Quick replies', 'Type / in a chat to send saved answers', () => open(const QuickRepliesScreen())),
            _tool(Icons.insights_outlined, 'Statistics', 'Messages sent, delivered, read, received', () => open(const BusinessStatsScreen())),
            _tool(Icons.campaign_outlined, 'Broadcasts', 'Send offers and updates to your customers', () => open(const BusinessBroadcastsScreen())),
            _tool(Icons.amp_stories_outlined, 'Status', 'Offers and news for 24 hours, in each customer\'s language', () => open(const BusinessStatusScreen())),
            const _Section('More'),
            _tool(Icons.groups_outlined, 'Team & reports', 'On neuratalk.in → Company dashboard', null),
          ],
        ),
      ),
    );
  }

  Widget _tool(IconData icon, String title, String subtitle, VoidCallback? onTap) => ListTile(
        leading: Icon(icon, color: AppColors.cyan),
        title: Text(title, style: TextStyle(color: AppColors.ink, fontWeight: FontWeight.w600)),
        subtitle: Text(subtitle, style: TextStyle(color: AppColors.textSecondary)),
        trailing: onTap == null ? null : const Icon(Icons.chevron_right),
        onTap: onTap,
      );
}

class _Section extends StatelessWidget {
  const _Section(this.title);
  final String title;

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.fromLTRB(16, 20, 16, 4),
        child: Text(title.toUpperCase(), style: TextStyle(color: AppColors.textMuted, fontSize: 12.5, fontWeight: FontWeight.w700, letterSpacing: 0.6)),
      );
}

/// Logo + name + verified tick: how customers see this business.
class BusinessIdentityCard extends StatelessWidget {
  const BusinessIdentityCard({super.key, this.onTap});
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final account = context.watch<BusinessAccount>();
    final b = account.business ?? const {};
    return InkWell(
      onTap: onTap,
      child: Padding(
        padding: const EdgeInsets.fromLTRB(16, 8, 16, 12),
        child: Row(children: [
          NtAvatar(name: account.name, avatarUrl: account.logoUrl, size: 64, openOnTap: account.logoUrl != null),
          const SizedBox(width: 14),
          Expanded(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Row(children: [
                Flexible(child: Text(account.name, maxLines: 1, overflow: TextOverflow.ellipsis,
                    style: TextStyle(color: AppColors.ink, fontSize: 19, fontWeight: FontWeight.w800))),
                if (account.verified) Padding(padding: const EdgeInsets.only(left: 4), child: Icon(Icons.verified, size: 20, color: AppColors.cyan)),
              ]),
              const SizedBox(height: 2),
              Text([businessCategoryLabel(b['category']), b['city']].where((v) => v != null && '$v'.isNotEmpty).join(' · '),
                  style: TextStyle(color: AppColors.textSecondary)),
              if (account.logoUrl == null)
                Text('Add your logo →', style: TextStyle(color: AppColors.cyan, fontWeight: FontWeight.w600)),
            ]),
          ),
          if (onTap != null) const Icon(Icons.chevron_right),
        ]),
      ),
    );
  }
}

/// Quality rating and daily messaging limit (server: messaging/account-health).
/// Hidden when the account can't see it (e.g. a team member without access).
class _AccountHealthCard extends StatefulWidget {
  const _AccountHealthCard();

  @override
  State<_AccountHealthCard> createState() => _AccountHealthCardState();
}

class _AccountHealthCardState extends State<_AccountHealthCard> {
  Map<String, dynamic>? _health;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final account = context.read<BusinessAccount>();
    if (account.business == null) return;
    try {
      final res = await ApiService.get('${account.base}/messaging/health');
      if (mounted && res is Map && res['health'] is Map) setState(() => _health = Map<String, dynamic>.from(res['health'] as Map));
    } catch (_) {
      // Not available for this account: show nothing.
    }
  }

  static String _n(Object? v) {
    final n = (v as num?)?.toInt() ?? 0;
    final s = n.toString();
    if (s.length <= 3) return s;
    // Indian grouping: 1,00,000
    final last3 = s.substring(s.length - 3);
    var rest = s.substring(0, s.length - 3);
    final parts = <String>[];
    while (rest.length > 2) {
      parts.insert(0, rest.substring(rest.length - 2));
      rest = rest.substring(0, rest.length - 2);
    }
    if (rest.isNotEmpty) parts.insert(0, rest);
    return '${parts.join(',')},$last3';
  }

  @override
  Widget build(BuildContext context) {
    final h = _health;
    if (h == null) return const SizedBox.shrink();
    final quality = h['quality']?.toString() ?? 'new';
    final (label, color) = switch (quality) {
      'high' => ('High', AppColors.green),
      'medium' => ('Medium', AppColors.orange),
      'low' => ('Low', AppColors.red),
      _ => ('New', AppColors.textSecondary),
    };
    final limit = (h['effectiveLimit'] as num?)?.toInt() ?? 250;
    final used = (h['usedLast24h'] as num?)?.toInt() ?? 0;
    final progress = (used / (limit <= 0 ? 1 : limit)).clamp(0.0, 1.0);
    return Container(
      margin: const EdgeInsets.fromLTRB(16, 12, 16, 0),
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: AppColors.border),
      ),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Row(children: [
          Icon(Icons.health_and_safety_outlined, color: AppColors.cyan),
          const SizedBox(width: 8),
          Expanded(child: Text('Account health', style: TextStyle(color: AppColors.ink, fontWeight: FontWeight.w700))),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 3),
            decoration: BoxDecoration(color: color.withValues(alpha: 0.12), borderRadius: BorderRadius.circular(20)),
            child: Text('Quality $label', style: TextStyle(color: color, fontWeight: FontWeight.w700, fontSize: 12.5)),
          ),
        ]),
        const SizedBox(height: 10),
        Text('You can message ${_n(limit)} customers a day${h['pinned'] == true ? ' (set by NeuraTalk)' : ''}',
            style: TextStyle(color: AppColors.textPrimary)),
        const SizedBox(height: 6),
        ClipRRect(
          borderRadius: BorderRadius.circular(4),
          child: LinearProgressIndicator(
            value: progress,
            minHeight: 6,
            color: progress >= 0.9 ? AppColors.red : AppColors.cyan,
            backgroundColor: AppColors.border,
          ),
        ),
        const SizedBox(height: 4),
        Text('${_n(used)} reached in the last 24 hours', style: TextStyle(color: AppColors.textSecondary, fontSize: 12.5)),
        if (h['restriction'] is Map) ...[
          const SizedBox(height: 10),
          Container(
            width: double.infinity,
            padding: const EdgeInsets.all(10),
            decoration: BoxDecoration(color: AppColors.red.withValues(alpha: 0.08), borderRadius: BorderRadius.circular(10)),
            child: Text('Campaigns paused by NeuraTalk. ${(h['restriction'] as Map)['reason'] ?? ''}',
                style: const TextStyle(color: AppColors.red, fontWeight: FontWeight.w600)),
          ),
        ],
        const SizedBox(height: 8),
        Text(h['advice']?.toString() ?? '', style: TextStyle(color: AppColors.textSecondary, fontSize: 13)),
        for (final n in ((h['notices'] as List?) ?? const []).take(3).whereType<Map>())
          Padding(
            padding: const EdgeInsets.only(top: 6),
            child: Text(
              '${const {'warning': 'Warning', 'restricted': 'Campaigns paused', 'lifted': 'Campaigns resumed'}[n['action']] ?? 'Notice'}: ${n['reason'] ?? ''}',
              style: TextStyle(color: n['action'] == 'lifted' ? AppColors.green : AppColors.orange, fontSize: 12.5),
            ),
          ),
        if (h['prices'] is Map)
          Padding(
            padding: const EdgeInsets.only(top: 8),
            child: Text(
              'Per message: offers ₹${(((h['prices'] as Map)['marketingPaise'] as num? ?? 0) / 100).toStringAsFixed(2)} · '
              'updates ₹${(((h['prices'] as Map)['utilityPaise'] as num? ?? 0) / 100).toStringAsFixed(2)} · '
              'codes ₹${(((h['prices'] as Map)['otpPaise'] as num? ?? 0) / 100).toStringAsFixed(2)}',
              style: TextStyle(color: AppColors.textMuted, fontSize: 12),
            ),
          ),
      ]),
    );
  }
}

/// The blue tick: what it means, and asking NeuraTalk to check the business.
class _VerificationCard extends StatefulWidget {
  const _VerificationCard();

  @override
  State<_VerificationCard> createState() => _VerificationCardState();
}

class _VerificationCardState extends State<_VerificationCard> {
  bool _sending = false;

  Future<void> _request() async {
    final account = context.read<BusinessAccount>();
    await Navigator.push(context, MaterialPageRoute(builder: (_) => ChangeNotifierProvider<BusinessAccount>.value(
      value: account,
      child: const BusinessVerificationScreen(),
    )));
    if (mounted) await account.load();
  }

  @override
  Widget build(BuildContext context) {
    final account = context.watch<BusinessAccount>();
    if (account.business == null) return const SizedBox.shrink();
    final verified = account.verified;
    final requested = account.verificationRequested;
    return Container(
      margin: const EdgeInsets.symmetric(horizontal: 16),
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: verified ? AppColors.green.withValues(alpha: 0.10) : AppColors.blueTint,
        borderRadius: BorderRadius.circular(14),
      ),
      child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Icon(verified ? Icons.verified : Icons.verified_outlined, color: verified ? AppColors.green : AppColors.cyan),
        const SizedBox(width: 10),
        Expanded(
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(
              verified ? 'Verified business' : requested ? 'Verification requested' : 'Get the verified tick',
              style: TextStyle(color: AppColors.ink, fontWeight: FontWeight.w700),
            ),
            const SizedBox(height: 2),
            Text(
              verified
                  ? 'Customers see the blue tick next to your name.'
                  : requested
                      ? 'NeuraTalk is checking your business. The tick appears once it is approved.'
                      : 'Customers trust businesses with the blue tick. Send your registration and PAN to NeuraTalk.',
              style: TextStyle(color: AppColors.textSecondary, fontSize: 13.5),
            ),
            const SizedBox(height: 8),
            FilledButton.tonal(
              onPressed: _sending ? null : _request,
              child: Text(verified ? 'Details' : requested ? 'See status' : 'Get verified'),
            ),
          ]),
        ),
      ]),
    );
  }
}

/// neuratalk.in/b/<slug> + QR: anyone who opens it lands in a chat with you.
class BusinessLinkScreen extends StatelessWidget {
  const BusinessLinkScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final account = context.watch<BusinessAccount>();
    final link = account.link;
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(title: const Text('Short link & QR code')),
      body: link.isEmpty
          ? Center(child: CircularProgressIndicator(color: AppColors.cyan))
          : ListView(padding: const EdgeInsets.all(24), children: [
              Center(
                child: Container(
                  padding: const EdgeInsets.all(18),
                  decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(20), border: Border.all(color: AppColors.border)),
                  child: Column(children: [
                    QrImageView(data: link, size: 220, backgroundColor: Colors.white),
                    const SizedBox(height: 8),
                    Text(account.name, style: const TextStyle(color: Colors.black, fontSize: 17, fontWeight: FontWeight.w700)),
                    const Text('Scan to chat on NeuraTalk', style: TextStyle(color: Colors.black54)),
                  ]),
                ),
              ),
              const SizedBox(height: 20),
              Text('Print it at your shop or share the link. Customers who open it can message you in their own language.',
                  textAlign: TextAlign.center, style: TextStyle(color: AppColors.textSecondary)),
              const SizedBox(height: 20),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 4),
                decoration: BoxDecoration(color: AppColors.surface, borderRadius: BorderRadius.circular(14), border: Border.all(color: AppColors.border)),
                child: Row(children: [
                  Expanded(child: SelectableText(link, style: TextStyle(color: AppColors.ink))),
                  IconButton(
                    tooltip: 'Copy',
                    icon: const Icon(Icons.copy),
                    onPressed: () {
                      Clipboard.setData(ClipboardData(text: link));
                      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Link copied')));
                    },
                  ),
                ]),
              ),
              const SizedBox(height: 16),
              ElevatedButton.icon(
                onPressed: () => Share.share('Chat with ${account.name} on NeuraTalk: $link'),
                icon: const Icon(Icons.share),
                label: const Text('Share link'),
              ),
            ]),
    );
  }
}

/// Last 30 days: what you sent and how it landed, and what customers sent.
class BusinessStatsScreen extends StatefulWidget {
  const BusinessStatsScreen({super.key});

  @override
  State<BusinessStatsScreen> createState() => _BusinessStatsScreenState();
}

class _BusinessStatsScreenState extends State<BusinessStatsScreen> {
  Map<String, dynamic>? _stats;
  String? _error;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _load());
  }

  Future<void> _load() async {
    try {
      final res = await ApiService.get('${context.read<BusinessAccount>().base}/messaging-stats');
      if (mounted) setState(() { _stats = Map<String, dynamic>.from(res['stats'] as Map); _error = null; });
    } catch (e) {
      if (mounted) setState(() => _error = e is ApiException ? e.message : 'Check your connection and try again.');
    }
  }

  @override
  Widget build(BuildContext context) {
    final s = _stats;
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(title: const Text('Statistics')),
      body: _error != null
          ? NtEmptyState(icon: Icons.wifi_off, title: "Couldn't load statistics", message: _error!, error: true, actionLabel: 'Try again', onAction: _load)
          : s == null
              ? Center(child: CircularProgressIndicator(color: AppColors.cyan))
              : RefreshIndicator(
                  onRefresh: _load,
                  child: ListView(padding: const EdgeInsets.all(16), children: [
                    Text('Last 30 days', style: TextStyle(color: AppColors.textMuted)),
                    const SizedBox(height: 12),
                    GridView.count(
                      crossAxisCount: 2,
                      shrinkWrap: true,
                      physics: const NeverScrollableScrollPhysics(),
                      mainAxisSpacing: 12,
                      crossAxisSpacing: 12,
                      childAspectRatio: 1.5,
                      children: [
                        _tile('Sent', s['sent'], Icons.send_outlined),
                        _tile('Delivered', s['delivered'], Icons.done_all),
                        _tile('Read', s['read'], Icons.visibility_outlined),
                        _tile('Received', s['received'], Icons.call_received),
                      ],
                    ),
                    const SizedBox(height: 12),
                    _tile('Customer chats (all time)', s['chats'], Icons.forum_outlined),
                  ]),
                ),
    );
  }

  Widget _tile(String label, dynamic value, IconData icon) => Container(
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(color: AppColors.surface, borderRadius: BorderRadius.circular(16), border: Border.all(color: AppColors.border)),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, mainAxisAlignment: MainAxisAlignment.center, children: [
          Icon(icon, color: AppColors.cyan),
          const SizedBox(height: 6),
          Text('${value ?? 0}', style: TextStyle(color: AppColors.ink, fontSize: 24, fontWeight: FontWeight.w800)),
          Text(label, style: TextStyle(color: AppColors.textSecondary)),
        ]),
      );
}
