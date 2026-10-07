import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';
import '../theme/app_theme.dart';
import '../widgets/brand_logo.dart';
import '../providers/auth_provider.dart';
import 'web_otp_login_screen.dart';

enum LoginStep { phone, otp }

class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key});

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  LoginStep _step = LoginStep.phone;
  final _phoneCtrl = TextEditingController();
  final _otpCtrl = TextEditingController();
  bool _loading = false;
  String? _error;

  Future<void> _continue() async {
    if (_step == LoginStep.phone) {
      await _sendOtp();
    }
  }

  Future<void> _sendOtp() async {
    final rawPhone = _phoneCtrl.text.trim();
    if (rawPhone.isEmpty) {
      setState(() => _error = 'Enter your phone number');
      return;
    }
    // Defensive: the field's inputFormatters already restrict to 10 digits,
    // but strip anything non-digit (e.g. a pasted value) and re-validate
    // here too, so a malformed number is caught locally with a clear
    // message instead of round-tripping to Firebase and coming back as an
    // opaque "TOO_LONG"/invalid E.164 error.
    final digitsOnly = rawPhone.replaceAll(RegExp(r'\D'), '');
    if (rawPhone.startsWith('+')) {
      // Already has a country code -- use as typed.
    } else if (digitsOnly.length != 10) {
      setState(() => _error = 'Enter a valid 10-digit mobile number');
      return;
    }
    // Ensure E.164 format
    final formatted = rawPhone.startsWith('+') ? rawPhone : '+91$digitsOnly';
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
      // Google couldn't verify this install (typical for APKs not from the
      // Play Store) — continue with the in-app web OTP flow instead.
      onDeviceVerificationFailed: () {
        if (!mounted) return;
        setState(() { _loading = false; _error = null; });
        Navigator.push(
          context,
          MaterialPageRoute(builder: (_) => WebOtpLoginScreen(phoneDigits: digitsOnly)),
        );
      },
      onAutoVerify: (credential) async {
        // Android: SMS was auto-read
        if (!mounted) return;
        setState(() { _loading = true; _error = null; });
        try {
          await context.read<AuthProvider>().signInWithAutoCredential(credential);
          if (!mounted) return;
          // Signed in: the app root (main.dart) now shows the home screen.
          Navigator.of(context).popUntil((route) => route.isFirst);
        } catch (e) {
          if (!mounted) return;
          setState(() { _error = context.read<AuthProvider>().error ?? e.toString(); _loading = false; });
        }
      },
    );
  }

  Future<void> _verifyOtp() async {
    final code = _otpCtrl.text.replaceAll(RegExp(r'\D'), '');
    if (code.length != 6) {
      setState(() => _error = 'Enter the 6-digit code');
      return;
    }
    setState(() { _loading = true; _error = null; });
    try {
      await context.read<AuthProvider>().verifyFirebaseOtp(code);
      if (!mounted) return;
      // Signed in: the app root (main.dart) now shows the home screen.
          Navigator.of(context).popUntil((route) => route.isFirst);
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
      backgroundColor: AppColors.background,
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              const SizedBox(height: 32),
              const Center(child: NeuraLogo(size: 30, tagline: true, vertical: true)),
              const SizedBox(height: 40),
              switch (_step) {
                LoginStep.phone => _phoneStep(),
                LoginStep.otp => _otpStep(),
              },
              const SizedBox(height: 32),
              Text(
                'By continuing you agree to the NeuraTalk Terms of Service and Privacy Policy.',
                textAlign: TextAlign.center,
                style: TextStyle(color: AppColors.textMuted, fontSize: 13, height: 1.4),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _phoneStep() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text('Welcome', style: TextStyle(color: AppColors.ink, fontSize: 26, fontWeight: FontWeight.w800)),
        const SizedBox(height: 6),
        Text('We\'ll text a login code to this number.',
            style: TextStyle(color: AppColors.textSecondary, fontSize: 15, height: 1.4)),
        const SizedBox(height: 24),
        TextField(
          controller: _phoneCtrl,
          keyboardType: TextInputType.phone,
          inputFormatters: [
            FilteringTextInputFormatter.digitsOnly,
            LengthLimitingTextInputFormatter(10),
          ],
          style: TextStyle(color: AppColors.ink, fontSize: 16, fontWeight: FontWeight.w600),
          decoration: InputDecoration(
            hintText: '98765 43210',
            // Always visible (prefixText only shows once the field is focused).
            prefixIcon: Padding(
              padding: const EdgeInsets.only(left: 14, right: 8),
              child: Row(mainAxisSize: MainAxisSize.min, children: [
                const Text('🇮🇳', style: TextStyle(fontSize: 18)),
                const SizedBox(width: 6),
                Text('+91', style: TextStyle(color: AppColors.ink, fontSize: 16, fontWeight: FontWeight.w600)),
                const SizedBox(width: 10),
                Container(width: 1, height: 22, color: AppColors.borderBright),
              ]),
            ),
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
              ? SizedBox(height: 20, width: 20, child: CircularProgressIndicator(strokeWidth: 2, color: AppColors.background))
              : const Text('Continue'),
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
          child: Icon(Icons.arrow_back, color: AppColors.textSecondary),
        ),
        const SizedBox(height: 20),
        Text('Enter the code', style: TextStyle(color: AppColors.ink, fontSize: 26, fontWeight: FontWeight.w800)),
        const SizedBox(height: 4),
        Text('We sent a 6-digit code to +91 ${_phoneCtrl.text}', style: TextStyle(color: AppColors.textSecondary, fontSize: 15)),
        const SizedBox(height: 24),
        TextField(
          controller: _otpCtrl,
          keyboardType: TextInputType.number,
          // Strip spaces/dashes from pasted or autofilled codes ("123 456")
          // before maxLength truncates them into a wrong 6-char string.
          inputFormatters: [FilteringTextInputFormatter.digitsOnly],
          maxLength: 6,
          textAlign: TextAlign.center,
          autofillHints: const [AutofillHints.oneTimeCode],
          style: TextStyle(color: AppColors.ink, fontSize: 28, fontWeight: FontWeight.w700, letterSpacing: 12),
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
              ? SizedBox(height: 20, width: 20, child: CircularProgressIndicator(strokeWidth: 2, color: AppColors.background))
              : const Row(mainAxisAlignment: MainAxisAlignment.center, children: [Text('Verify '), Icon(Icons.check, size: 18)]),
        ),
        const SizedBox(height: 12),
        Center(
          child: TextButton.icon(
            onPressed: _loading ? null : _sendOtp,
            icon: Icon(Icons.refresh, size: 16, color: AppColors.cyan),
            label: Text('Resend OTP', style: TextStyle(color: AppColors.cyan)),
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
