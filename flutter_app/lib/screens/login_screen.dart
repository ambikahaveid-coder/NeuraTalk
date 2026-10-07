import 'dart:async';
import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';
import 'package:webview_flutter/webview_flutter.dart';
import 'package:webview_flutter_android/webview_flutter_android.dart';
import '../theme/app_theme.dart';
import '../widgets/brand_logo.dart';
import '../providers/auth_provider.dart';
import '../services/api_service.dart';

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

  // Phones that can't pass Google's app check (APKs not installed from Play)
  // send the SMS through the website's invisible reCAPTCHA instead. That page
  // stays hidden: the user only ever sees these native screens and types the
  // code here. It is shown only if Google asks for a "not a robot" check.
  WebViewController? _bridge;
  bool _bridgeChallenge = false;
  bool _completing = false;
  Timer? _challengeTimer;
  static bool _nativeCheckFailed = false;

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

    // Already known that this phone can't use the native check: go straight
    // to the hidden page (and reuse it for "Resend").
    if (_nativeCheckFailed) {
      _startBridge(digitsOnly);
      return;
    }

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
        _nativeCheckFailed = true;
        _startBridge(digitsOnly);
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

  void _startBridge(String digits) {
    _challengeTimer?.cancel();
    setState(() {
      _step = LoginStep.otp;
      _loading = true;
      _error = null;
      _bridgeChallenge = false;
    });
    final bridge = _bridge;
    if (bridge != null) {
      // Resend through the page that's already open.
      unawaited(bridge.runJavaScript('window.neuratalkResend && window.neuratalkResend()'));
    } else {
      final uri = Uri.parse('${ApiService.baseUrl}/app-login').replace(queryParameters: {'mode': 'bridge', 'phone': digits});
      final controller = WebViewController()
        ..setJavaScriptMode(JavaScriptMode.unrestricted)
        ..setBackgroundColor(Colors.white)
        ..addJavaScriptChannel('NeuraTalkApp', onMessageReceived: _onBridgeMessage)
        ..setNavigationDelegate(NavigationDelegate(
          onWebResourceError: (error) {
            if (error.isForMainFrame == true && mounted) {
              setState(() { _loading = false; _error = "Couldn't reach NeuraTalk. Check your internet and try again."; });
            }
          },
          // Only our site and Google's verification pages may load here.
          onNavigationRequest: (request) {
            final host = Uri.tryParse(request.url)?.host ?? '';
            final allowed = host == uri.host ||
                host.endsWith('google.com') ||
                host.endsWith('gstatic.com') ||
                host.endsWith('recaptcha.net') ||
                host.endsWith('firebaseapp.com') ||
                host.endsWith('googleapis.com');
            return allowed ? NavigationDecision.navigate : NavigationDecision.prevent;
          },
        ));
      // reCAPTCHA needs google.com cookies inside its frame.
      final platform = controller.platform;
      if (platform is AndroidWebViewController) {
        AndroidWebViewCookieManager(const PlatformWebViewCookieManagerCreationParams())
            .setAcceptThirdPartyCookies(platform, true);
      }
      controller.loadRequest(uri);
      setState(() => _bridge = controller);
    }
    // No answer after a while usually means Google wants a "not a robot" tap.
    _challengeTimer = Timer(const Duration(seconds: 10), () {
      if (mounted && _loading && !_completing) setState(() => _bridgeChallenge = true);
    });
  }

  Future<void> _onBridgeMessage(JavaScriptMessage message) async {
    Map<String, dynamic> data;
    try {
      final decoded = jsonDecode(message.message);
      if (decoded is! Map<String, dynamic>) return;
      data = decoded;
    } catch (_) {
      return;
    }
    if (!mounted) return;
    switch (data['type']) {
      case 'codeSent':
        _challengeTimer?.cancel();
        setState(() { _loading = false; _bridgeChallenge = false; _error = null; });
        break;
      case 'error':
      case 'verifyError':
        _challengeTimer?.cancel();
        setState(() { _loading = false; _bridgeChallenge = false; _error = data['message']?.toString() ?? 'Something went wrong. Please try again.'; });
        break;
      case 'login':
        final token = data['token'];
        if (token is! String || token.isEmpty || _completing) return;
        _completing = true;
        try {
          final user = data['user'] is Map<String, dynamic> ? data['user'] as Map<String, dynamic> : null;
          await context.read<AuthProvider>().completeWebLogin(token, user);
          if (!mounted) return;
          // Signed in: the app root (main.dart) now shows the home screen.
          Navigator.of(context).popUntil((route) => route.isFirst);
        } catch (_) {
          _completing = false;
          if (mounted) setState(() { _loading = false; _error = 'Login could not be completed. Please try again.'; });
        }
        break;
    }
  }

  Future<void> _verifyOtp() async {
    final code = _otpCtrl.text.replaceAll(RegExp(r'\D'), '');
    if (code.length != 6) {
      setState(() => _error = 'Enter the 6-digit code');
      return;
    }
    final bridge = _bridge;
    if (bridge != null) {
      setState(() { _loading = true; _error = null; });
      // code is 6 digits only, safe to inline.
      await bridge.runJavaScript("window.neuratalkVerify && window.neuratalkVerify('$code')");
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
    final screen = MediaQuery.of(context).size;
    return Scaffold(
      backgroundColor: AppColors.background,
      body: Stack(children: [
        SafeArea(
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
        if (_bridge != null && _bridgeChallenge)
          Positioned.fill(child: ColoredBox(color: Colors.black.withValues(alpha: 0.55))),
        if (_bridge != null && _bridgeChallenge)
          Positioned(
            left: 20,
            right: 20,
            top: screen.height * 0.12,
            child: Material(
              color: AppColors.surface,
              borderRadius: BorderRadius.circular(16),
              child: Padding(
                padding: const EdgeInsets.fromLTRB(16, 14, 8, 10),
                child: Row(children: [
                  Expanded(
                    child: Text('Quick check from Google: tap the box below to get your code.',
                        style: TextStyle(color: AppColors.ink, fontSize: 15, fontWeight: FontWeight.w600)),
                  ),
                  IconButton(
                    tooltip: 'Cancel',
                    icon: Icon(Icons.close, color: AppColors.textMuted),
                    onPressed: () {
                      _challengeTimer?.cancel();
                      setState(() { _bridgeChallenge = false; _loading = false; });
                    },
                  ),
                ]),
              ),
            ),
          ),
        if (_bridge != null)
          Positioned(
            left: _bridgeChallenge ? 20 : 0,
            top: _bridgeChallenge ? screen.height * 0.12 + 76 : 0,
            width: _bridgeChallenge ? screen.width - 40 : 1,
            height: _bridgeChallenge ? 480 : 1,
            child: IgnorePointer(
              ignoring: !_bridgeChallenge,
              child: Opacity(
                opacity: _bridgeChallenge ? 1 : 0.01,
                child: ClipRRect(borderRadius: BorderRadius.circular(16), child: WebViewWidget(controller: _bridge!)),
              ),
            ),
          ),
      ]),
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
          // A new number needs a fresh hidden page (it sends to the number it opened with).
          onTap: () => setState(() {
            _step = LoginStep.phone;
            _otpCtrl.clear();
            _error = null;
            _loading = false;
            _bridge = null;
            _bridgeChallenge = false;
            _challengeTimer?.cancel();
          }),
          child: Icon(Icons.arrow_back, color: AppColors.textSecondary),
        ),
        const SizedBox(height: 20),
        Text('Enter the code', style: TextStyle(color: AppColors.ink, fontSize: 26, fontWeight: FontWeight.w800)),
        const SizedBox(height: 4),
        Text(
            _loading && _otpCtrl.text.isEmpty && _bridge != null
                ? 'Sending a 6-digit code to +91 ${_phoneCtrl.text}…'
                : 'We sent a 6-digit code to +91 ${_phoneCtrl.text}',
            style: TextStyle(color: AppColors.textSecondary, fontSize: 15)),
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
    _challengeTimer?.cancel();
    _phoneCtrl.dispose();
    _otpCtrl.dispose();
    super.dispose();
  }
}
