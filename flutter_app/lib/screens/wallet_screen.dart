import 'package:flutter/material.dart';
import '../theme/app_theme.dart';
import '../services/api_service.dart';

class WalletScreen extends StatefulWidget {
  const WalletScreen({super.key});

  @override
  State<WalletScreen> createState() => _WalletScreenState();
}

class _WalletScreenState extends State<WalletScreen> {
  Map<String, dynamic>? _wallet;
  List<Map<String, dynamic>> _plans = [];
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final plans = await ApiService.get('/api/billing/plans') as List;
      setState(() {
        _plans = plans.cast<Map<String, dynamic>>();
        _loading = false;
      });
    } catch (_) {
      setState(() => _loading = false);
    }
    try {
      final w = await ApiService.get('/api/billing/wallet') as Map<String, dynamic>;
      setState(() => _wallet = w);
    } catch (_) {}
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(title: const Text('Billing & Wallet')),
      body: _loading
          ? const Center(child: CircularProgressIndicator(color: AppColors.cyan))
          : SingleChildScrollView(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  _walletCard(),
                  const SizedBox(height: 24),
                  const Text('Plans', style: TextStyle(color: AppColors.white, fontSize: 18, fontWeight: FontWeight.w700)),
                  const SizedBox(height: 12),
                  ..._plans.map((p) => _PlanCard(plan: p)),
                ],
              ),
            ),
    );
  }

  Widget _walletCard() {
    final balance = _wallet?['balancePaise'] != null ? (_wallet!['balancePaise'] as num) / 100 : 0.0;
    final minutes = _wallet?['remainingMinutes'] ?? 0;
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(24),
      decoration: BoxDecoration(
        gradient: LinearGradient(
          colors: [AppColors.teal, AppColors.teal.withOpacity(0.5)],
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
        ),
        borderRadius: BorderRadius.circular(20),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text('Wallet Balance', style: TextStyle(color: AppColors.textSecondary, fontSize: 13)),
          const SizedBox(height: 8),
          Text('₹${balance.toStringAsFixed(2)}', style: const TextStyle(color: AppColors.white, fontSize: 36, fontWeight: FontWeight.w800)),
          const SizedBox(height: 4),
          Text('$minutes minutes remaining', style: const TextStyle(color: AppColors.textSecondary, fontSize: 13)),
          const SizedBox(height: 20),
          ElevatedButton(
            onPressed: () {},
            style: ElevatedButton.styleFrom(
              backgroundColor: AppColors.white,
              foregroundColor: AppColors.teal,
              minimumSize: const Size(140, 44),
            ),
            child: const Text('Add Credits', style: TextStyle(fontWeight: FontWeight.w700)),
          ),
        ],
      ),
    );
  }
}

class _PlanCard extends StatelessWidget {
  final Map<String, dynamic> plan;
  const _PlanCard({required this.plan});

  @override
  Widget build(BuildContext context) {
    final name = plan['displayName'] ?? plan['name'] ?? 'Plan';
    final price = plan['priceFormatted'] ?? '₹0';
    final minutes = plan['callMinutesIncluded'] ?? 0;
    final features = (plan['featureHighlights'] as List?)?.cast<String>() ?? [];

    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: AppColors.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text(name, style: const TextStyle(color: AppColors.white, fontSize: 16, fontWeight: FontWeight.w700)),
              Text(price, style: const TextStyle(color: AppColors.cyan, fontSize: 18, fontWeight: FontWeight.w800)),
            ],
          ),
          const SizedBox(height: 4),
          Text('$minutes minutes included', style: const TextStyle(color: AppColors.textMuted, fontSize: 12)),
          if (features.isNotEmpty) ...[
            const SizedBox(height: 12),
            ...features.take(3).map((f) => Padding(
              padding: const EdgeInsets.only(bottom: 4),
              child: Row(children: [
                const Icon(Icons.check_circle_outline, color: AppColors.cyan, size: 14),
                const SizedBox(width: 8),
                Text(f, style: const TextStyle(color: AppColors.textSecondary, fontSize: 12)),
              ]),
            )),
          ],
          const SizedBox(height: 16),
          SizedBox(
            width: double.infinity,
            child: OutlinedButton(
              onPressed: () {},
              style: OutlinedButton.styleFrom(
                side: const BorderSide(color: AppColors.cyan),
                foregroundColor: AppColors.cyan,
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
              ),
              child: const Text('Choose Plan'),
            ),
          ),
        ],
      ),
    );
  }
}
