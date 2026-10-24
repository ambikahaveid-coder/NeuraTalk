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
            const _Section('Your business'),
            _tool(Icons.storefront_outlined, 'Business profile', 'Logo, about, address, website', () => open(const BusinessProfileScreen())),
            _tool(Icons.shopping_bag_outlined, 'Catalog', 'Products and services with prices', () => open(const BusinessCatalogScreen())),
            _tool(Icons.qr_code_2, 'Short link & QR code', 'Let customers start a chat with you', () => open(const BusinessLinkScreen())),
            const _Section('Messaging'),
            _tool(Icons.waving_hand_outlined, 'Greeting message', 'Welcome new customers automatically', () => open(const GreetingMessageScreen())),
            _tool(Icons.schedule_outlined, 'Away message & hours', 'Reply when you are closed', () => open(const AwayMessageScreen())),
            _tool(Icons.bolt_outlined, 'Quick replies', 'Type / in a chat to send saved answers', () => open(const QuickRepliesScreen())),
            _tool(Icons.insights_outlined, 'Statistics', 'Messages sent, delivered, read, received', () => open(const BusinessStatsScreen())),
            const _Section('More'),
            _tool(Icons.campaign_outlined, 'Broadcasts, templates & team', 'On neuratalk.in → Company dashboard → Messaging', null),
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
              Text([b['category'], b['city']].where((v) => v != null && '$v'.isNotEmpty).join(' · '),
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
    setState(() => _sending = true);
    try {
      await ApiService.post('${account.base}/verification-request', {});
      await account.load();
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Sent. NeuraTalk will check your business.')));
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e is ApiException ? e.message : 'Could not send. Try again.')));
    } finally {
      if (mounted) setState(() => _sending = false);
    }
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
                      : 'Customers trust businesses with the blue tick. Add your logo and about, then ask NeuraTalk to check.',
              style: TextStyle(color: AppColors.textSecondary, fontSize: 13.5),
            ),
            if (!verified && !requested) ...[
              const SizedBox(height: 8),
              FilledButton.tonal(
                onPressed: _sending ? null : _request,
                child: _sending ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2)) : const Text('Request verification'),
              ),
            ],
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
