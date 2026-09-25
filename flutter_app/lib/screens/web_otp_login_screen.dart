import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:webview_flutter/webview_flutter.dart';
import 'package:webview_flutter_android/webview_flutter_android.dart';

import '../providers/auth_provider.dart';
import '../services/api_service.dart';
import '../theme/app_theme.dart';
import 'main_shell.dart';

/// Phone-OTP login through the website's Firebase flow, shown in-app.
///
/// Native Firebase phone auth on Android needs Google device verification,
/// which rejects builds not installed from Google Play
/// ("missing-client-identifier"). The web reCAPTCHA flow works, so the user
/// verifies on `/app-login` and the page hands the NeuraTalk session token to
/// the app via the in-process `NeuraTalkApp` JavaScript channel.
class WebOtpLoginScreen extends StatefulWidget {
  final String? phoneDigits;
  const WebOtpLoginScreen({super.key, this.phoneDigits});

  @override
  State<WebOtpLoginScreen> createState() => _WebOtpLoginScreenState();
}

class _WebOtpLoginScreenState extends State<WebOtpLoginScreen> {
  late final WebViewController _controller;
  bool _loading = true;
  bool _completing = false;
  String? _loadError;

  @override
  void initState() {
    super.initState();
    final uri = Uri.parse('${ApiService.baseUrl}/app-login').replace(
      queryParameters: {
        if (widget.phoneDigits != null && widget.phoneDigits!.isNotEmpty) 'phone': widget.phoneDigits!,
      },
    );
    _controller = WebViewController()
      ..setJavaScriptMode(JavaScriptMode.unrestricted)
      ..setBackgroundColor(AppColors.background)
      ..addJavaScriptChannel('NeuraTalkApp', onMessageReceived: _onMessage)
      ..setNavigationDelegate(NavigationDelegate(
        onPageFinished: (_) {
          if (mounted) setState(() => _loading = false);
        },
        onWebResourceError: (error) {
          if (error.isForMainFrame == true && mounted) {
            setState(() {
              _loading = false;
              _loadError = 'Could not open the login page. Check your internet and try again.';
            });
          }
        },
        // Only our own site may load in this view; anything else (e.g. a
        // link) opens nowhere rather than inside a view holding the bridge.
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

    // reCAPTCHA relies on google.com cookies inside its iframe; Android
    // WebView blocks third-party cookies by default.
    final platform = _controller.platform;
    if (platform is AndroidWebViewController) {
      AndroidWebViewCookieManager(const PlatformWebViewCookieManagerCreationParams())
          .setAcceptThirdPartyCookies(platform, true);
    }
    _controller.loadRequest(uri);
  }

  Future<void> _onMessage(JavaScriptMessage message) async {
    if (_completing) return;
    try {
      final data = jsonDecode(message.message);
      if (data is! Map || data['type'] != 'login') return;
      final token = data['token'];
      if (token is! String || token.isEmpty) return;
      _completing = true;
      final user = data['user'] is Map<String, dynamic> ? data['user'] as Map<String, dynamic> : null;
      await context.read<AuthProvider>().completeWebLogin(token, user);
      if (!mounted) return;
      Navigator.of(context).pushAndRemoveUntil(
        MaterialPageRoute(builder: (_) => const MainShell()),
        (_) => false,
      );
    } catch (_) {
      _completing = false;
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Login could not be completed. Please try again.')),
        );
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(
        backgroundColor: AppColors.background,
        foregroundColor: AppColors.white,
        title: const Text('Verify your number'),
      ),
      body: Stack(
        children: [
          if (_loadError == null) WebViewWidget(controller: _controller),
          if (_loadError != null)
            Center(
              child: Padding(
                padding: const EdgeInsets.all(24),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text(_loadError!, textAlign: TextAlign.center, style: const TextStyle(color: AppColors.white, fontSize: 18)),
                    const SizedBox(height: 16),
                    ElevatedButton(
                      onPressed: () {
                        setState(() { _loadError = null; _loading = true; });
                        _controller.reload();
                      },
                      child: const Text('Try again'),
                    ),
                  ],
                ),
              ),
            ),
          if (_loading || _completing) const Center(child: CircularProgressIndicator()),
        ],
      ),
    );
  }
}
