import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:firebase_auth/firebase_auth.dart';
import '../theme/app_theme.dart';
import '../widgets/blob_background.dart';
import '../providers/auth_provider.dart';
import 'main_shell.dart';

enum LoginStep { accountType, phone, otp }

class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key});

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  LoginStep _step = LoginStep.accountType;
  String _accountType = 'personal';
  final _phoneCtrl = TextEditingController();
  final _otpCtrl = TextEditingController();
  bool _loading = false;
  String? _error;

  void _selectType(String type) => setState(() => _accountType = type);

  Future<void> _continue() async {
    if (_step == LoginStep.accountType) {
      setState(() => _step = LoginStep.phone);
      return;
    }
    if (_step == LoginStep.phone) {
      await _sendOtp();
    }
  }

  Future<void> _sendOtp() async {
    final phone = _phoneCtrl.text.trim();
    if (phone.isEmpty) {
      setState(() => _error = 'Enter your phone number');
      return;
    }
    // Ensure E.164 format
    final formatted = phone.startsWith('+') ? phone : '+91$phone';
    setState(() { _loading = true; _error = null; });

    await context.read<AuthProvider>().sendFirebaseOtp(
      formatted,
      onCodeSent: (_) {
        if (!mounted) return;
        setState(() { _step = LoginStep.otp; _loading = false; });
      },
      onError: (msg) {
        if (!mounted) return;
        setState(() { _error = msg; _loading = false; });
      },
      onAutoVerify: (credential) async {
        // Android: SMS was auto-read
        if (!mounted) return;
        setState(() { _loading = true; _error = null; });
        try {
          await context.read<AuthProvider>().signInWithAutoCredential(credential);
          if (!mounted) return;
          Navigator.pushReplacement(context, MaterialPageRoute(builder: (_) => const MainShell()));
        } catch (e) {
          if (!mounted) return;
          setState(() { _error = e.toString(); _loading = false; });
        }
      },
    );
  }

  Future<void> _verifyOtp() async {
    final code = _otpCtrl.text.trim();
    if (code.length != 6) {
      setState(() => _error = 'Enter the 6-digit code');
      return;
    }
    setState(() { _loading = true; _error = null; });
    try {
      await context.read<AuthProvider>().verifyFirebaseOtp(code);
      if (!mounted) return;
      Navigator.pushReplacement(context, MaterialPageRoute(builder: (_) => const MainShell()));
    } catch (e) {
      if (!mounted) return;
      setState(() { _error = context.read<AuthProvider>().error ?? e.toString(); });
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: BlobBackground(
        child: SafeArea(
          child: SingleChildScrollView(
            padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 16),
            child: Column(
              children: [
                const SizedBox(height: 40),
                const Text('NeuraTalk', style: TextStyle(
                  color: AppColors.white,
                  fontSize: 38,
                  fontWeight: FontWeight.w800,
                  letterSpacing: -0.5,
                )),
                const SizedBox(height: 8),
                const Text(
                  'Real-time multilingual voice communication\nwith emotion awareness',
                  textAlign: TextAlign.center,
                  style: TextStyle(color: AppColors.textSecondary, fontSize: 14, height: 1.5),
                ),
                const SizedBox(height: 48),
                _buildCard(),
              ],
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildCard() {
    return Container(
      padding: const EdgeInsets.all(24),
      decoration: BoxDecoration(
        color: AppColors.surface.withOpacity(0.85),
        borderRadius: BorderRadius.circular(24),
        border: Border.all(color: AppColors.border),
      ),
      child: switch (_step) {
        LoginStep.accountType => _accountTypeStep(),
        LoginStep.phone => _phoneStep(),
        LoginStep.otp => _otpStep(),
      },
    );
  }

  Widget _accountTypeStep() {
    return Column(
      children: [
        const Text('Get Started', style: TextStyle(color: AppColors.white, fontSize: 20, fontWeight: FontWeight.w700)),
        const SizedBox(height: 4),
        const Text('Choose your account type', style: TextStyle(color: AppColors.textSecondary, fontSize: 14)),
        const SizedBox(height: 24),
        Row(
          children: [
            Expanded(child: _typeCard('personal', Icons.person_outline, 'Personal', 'For individuals')),
            const SizedBox(width: 12),
            Expanded(child: _typeCard('business', Icons.business_center_outlined, 'Business', 'For teams & enterprises')),
          ],
        ),
        const SizedBox(height: 24),
        ElevatedButton(onPressed: _continue, child: const Text('Continue →')),
      ],
    );
  }

  Widget _typeCard(String type, IconData icon, String title, String sub) {
    final selected = _accountType == type;
    return GestureDetector(
      onTap: () => _selectType(type),
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 200),
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(
          color: selected ? AppColors.cyan.withOpacity(0.08) : AppColors.backgroundMid,
          borderRadius: BorderRadius.circular(16),
          border: Border.all(color: selected ? AppColors.cyan : AppColors.border, width: selected ? 1.5 : 1),
        ),
        child: Column(
          children: [
            Icon(icon, color: selected ? AppColors.cyan : AppColors.textMuted, size: 28),
            const SizedBox(height: 8),
            Text(title, style: TextStyle(color: selected ? AppColors.cyan : AppColors.textPrimary, fontWeight: FontWeight.w700, fontSize: 14)),
            const SizedBox(height: 2),
            Text(sub, textAlign: TextAlign.center, style: const TextStyle(color: AppColors.textMuted, fontSize: 11)),
          ],
        ),
      ),
    );
  }

  Widget _phoneStep() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        GestureDetector(
          onTap: () => setState(() => _step = LoginStep.accountType),
          child: const Icon(Icons.arrow_back, color: AppColors.textSecondary),
        ),
        const SizedBox(height: 20),
        const Text('Phone Verification', style: TextStyle(color: AppColors.white, fontSize: 20, fontWeight: FontWeight.w700)),
        const SizedBox(height: 4),
        const Text('We\'ll send a 6-digit OTP to your number', style: TextStyle(color: AppColors.textSecondary, fontSize: 13)),
        const SizedBox(height: 24),
        TextField(
          controller: _phoneCtrl,
          keyboardType: TextInputType.phone,
          style: const TextStyle(color: AppColors.white, fontSize: 16, fontWeight: FontWeight.w600),
          decoration: const InputDecoration(
            hintText: '+91 98765 43210',
            prefixIcon: Icon(Icons.phone_outlined, color: AppColors.cyan),
          ),
          onSubmitted: (_) => _continue(),
        ),
        if (_error != null) ...[
          const SizedBox(height: 12),
          Text(_error!, style: const TextStyle(color: AppColors.red, fontSize: 13)),
        ],
        const SizedBox(height: 20),
        ElevatedButton(
          onPressed: _loading ? null : _continue,
          child: _loading
              ? const SizedBox(height: 20, width: 20, child: CircularProgressIndicator(strokeWidth: 2, color: AppColors.background))
              : const Text('Send OTP'),
        ),
      ],
    );
  }

  Widget _otpStep() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        GestureDetector(
          onTap: () => setState(() { _step = LoginStep.phone; _otpCtrl.clear(); _error = null; }),
          child: const Icon(Icons.arrow_back, color: AppColors.textSecondary),
        ),
        const SizedBox(height: 20),
        const Text('Enter Verification Code', style: TextStyle(color: AppColors.white, fontSize: 20, fontWeight: FontWeight.w700)),
        const SizedBox(height: 4),
        Text('Sent to ${_phoneCtrl.text}', style: const TextStyle(color: AppColors.textSecondary, fontSize: 13)),
        const SizedBox(height: 24),
        TextField(
          controller: _otpCtrl,
          keyboardType: TextInputType.number,
          maxLength: 6,
          textAlign: TextAlign.center,
          autofillHints: const [AutofillHints.oneTimeCode],
          style: const TextStyle(color: AppColors.white, fontSize: 28, fontWeight: FontWeight.w700, letterSpacing: 12),
          decoration: const InputDecoration(hintText: '------', counterText: ''),
          onSubmitted: (_) => _verifyOtp(),
        ),
        if (_error != null) ...[
          const SizedBox(height: 12),
          Text(_error!, style: const TextStyle(color: AppColors.red, fontSize: 13)),
        ],
        const SizedBox(height: 20),
        ElevatedButton(
          onPressed: _loading ? null : _verifyOtp,
          child: _loading
              ? const SizedBox(height: 20, width: 20, child: CircularProgressIndicator(strokeWidth: 2, color: AppColors.background))
              : const Row(mainAxisAlignment: MainAxisAlignment.center, children: [Text('Verify '), Icon(Icons.check, size: 18)]),
        ),
        const SizedBox(height: 12),
        Center(
          child: TextButton.icon(
            onPressed: _loading ? null : _sendOtp,
            icon: const Icon(Icons.refresh, size: 16, color: AppColors.cyan),
            label: const Text('Resend OTP', style: TextStyle(color: AppColors.cyan)),
          ),
        ),
      ],
    );
  }

  @override
  void dispose() {
    _phoneCtrl.dispose();
    _otpCtrl.dispose();
    super.dispose();
  }
}
