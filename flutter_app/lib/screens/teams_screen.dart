import 'package:flutter/material.dart';
import '../theme/app_theme.dart';
import '../services/api_service.dart';

class TeamsScreen extends StatefulWidget {
  const TeamsScreen({super.key});

  @override
  State<TeamsScreen> createState() => _TeamsScreenState();
}

class _TeamsScreenState extends State<TeamsScreen> {
  List<Map<String, dynamic>> _teams = [];
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _loadTeams();
  }

  Future<void> _loadTeams() async {
    try {
      final data = await ApiService.get('/api/organizations/teams') as List;
      setState(() {
        _teams = data.cast<Map<String, dynamic>>();
        _loading = false;
      });
    } catch (_) {
      setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(title: const Text('Team Calls')),
      body: _loading
          ? const Center(child: CircularProgressIndicator(color: AppColors.cyan))
          : _teams.isEmpty
              ? _emptyState()
              : ListView.builder(
                  padding: const EdgeInsets.all(16),
                  itemCount: _teams.length,
                  itemBuilder: (_, i) => _TeamCard(team: _teams[i]),
                ),
    );
  }

  Widget _emptyState() {
    return Center(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Container(
            padding: const EdgeInsets.all(24),
            decoration: BoxDecoration(color: AppColors.cyan.withOpacity(0.1), shape: BoxShape.circle),
            child: const Icon(Icons.group_outlined, color: AppColors.cyan, size: 40),
          ),
          const SizedBox(height: 20),
          const Text('No Teams Yet', style: TextStyle(color: AppColors.white, fontSize: 20, fontWeight: FontWeight.w700)),
          const SizedBox(height: 8),
          const Text('Teams will appear here once your\nadmin sets them up', textAlign: TextAlign.center, style: TextStyle(color: AppColors.textSecondary, fontSize: 14)),
        ],
      ),
    );
  }
}

class _TeamCard extends StatelessWidget {
  final Map<String, dynamic> team;
  const _TeamCard({required this.team});

  @override
  Widget build(BuildContext context) {
    final name = team['name'] ?? 'Team';
    final members = team['memberCount'] ?? team['members']?.length ?? 0;
    final aiEnabled = team['aiEnabled'] ?? true;

    return Container(
      margin: const EdgeInsets.only(bottom: 16),
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: AppColors.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                width: 48,
                height: 48,
                decoration: BoxDecoration(
                  color: AppColors.teal.withOpacity(0.3),
                  shape: BoxShape.circle,
                ),
                child: const Icon(Icons.group, color: AppColors.cyan, size: 24),
              ),
              const SizedBox(width: 14),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(name, style: const TextStyle(color: AppColors.white, fontSize: 16, fontWeight: FontWeight.w700)),
                    const SizedBox(height: 2),
                    Text(
                      '$members Members${aiEnabled ? ' · Live Translator Enabled' : ''}',
                      style: const TextStyle(color: AppColors.textMuted, fontSize: 12),
                    ),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: 16),
          Row(
            children: [
              Expanded(
                child: _CallButton(
                  label: 'Group Voice',
                  icon: Icons.call,
                  onTap: () => _startCall(context, 'voice', team),
                  filled: true,
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: _CallButton(
                  label: 'Group Video',
                  icon: Icons.videocam,
                  onTap: () => _startCall(context, 'video', team),
                  filled: false,
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }

  void _startCall(BuildContext context, String type, Map<String, dynamic> team) {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text('Starting ${team['name']} $type call...'),
        backgroundColor: AppColors.surface,
        behavior: SnackBarBehavior.floating,
      ),
    );
  }
}

class _CallButton extends StatelessWidget {
  final String label;
  final IconData icon;
  final VoidCallback onTap;
  final bool filled;

  const _CallButton({required this.label, required this.icon, required this.onTap, required this.filled});

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.symmetric(vertical: 12),
        decoration: BoxDecoration(
          color: filled ? AppColors.cyan : Colors.transparent,
          borderRadius: BorderRadius.circular(30),
          border: filled ? null : Border.all(color: AppColors.cyan),
        ),
        child: Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(icon, size: 18, color: filled ? AppColors.background : AppColors.cyan),
            const SizedBox(width: 6),
            Text(label, style: TextStyle(color: filled ? AppColors.background : AppColors.cyan, fontWeight: FontWeight.w700, fontSize: 13)),
          ],
        ),
      ),
    );
  }
}
