import 'dart:async';

import 'package:connectivity_plus/connectivity_plus.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:permission_handler/permission_handler.dart';
import 'package:webview_flutter/webview_flutter.dart';
import 'package:webview_flutter_android/webview_flutter_android.dart';

import 'shell_config.dart';

class LiveShellPage extends StatefulWidget {
  const LiveShellPage({super.key});

  @override
  State<LiveShellPage> createState() => _LiveShellPageState();
}

class _LiveShellPageState extends State<LiveShellPage>
    with WidgetsBindingObserver {
  final Connectivity _connectivity = Connectivity();
  late final WebViewController _controller;

  StreamSubscription<ConnectivityResult>? _connectivitySubscription;
  Widget? _fullscreenWidget;
  VoidCallback? _hideFullscreenWidget;

  ConnectivityResult _connectivityStatus = ConnectivityResult.none;
  double _progress = 0;
  bool _isLoading = true;
  String? _errorMessage;
  String? _currentUrl;

  Uri? get _initialUri => ShellConfig.initialUri;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _controller = _buildController();
    _connectivitySubscription =
        _connectivity.onConnectivityChanged.listen(_handleConnectivityChanged);
    unawaited(_bootstrap());
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _connectivitySubscription?.cancel();
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) {
      unawaited(_refreshConnectivity());
    }
  }

  WebViewController _buildController() {
    PlatformWebViewControllerCreationParams params =
        const PlatformWebViewControllerCreationParams();

    if (WebViewPlatform.instance is AndroidWebViewPlatform) {
      params = AndroidWebViewControllerCreationParams
          .fromPlatformWebViewControllerCreationParams(params);
    }

    final WebViewController controller =
        WebViewController.fromPlatformCreationParams(
      params,
      onPermissionRequest: (WebViewPermissionRequest request) {
        unawaited(_handleWebViewPermissionRequest(request));
      },
    )
          ..setJavaScriptMode(JavaScriptMode.unrestricted)
          ..setBackgroundColor(Colors.black)
          ..setNavigationDelegate(
            NavigationDelegate(
              onNavigationRequest: (NavigationRequest request) {
                _currentUrl = request.url;
                return NavigationDecision.navigate;
              },
              onPageStarted: (String url) {
                if (!mounted) {
                  return;
                }
                setState(() {
                  _currentUrl = url;
                  _isLoading = true;
                  _errorMessage = null;
                });
              },
              onProgress: (int progress) {
                if (!mounted) {
                  return;
                }
                setState(() {
                  _progress = progress / 100;
                });
              },
              onPageFinished: (String url) {
                if (!mounted) {
                  return;
                }
                setState(() {
                  _currentUrl = url;
                  _progress = 1;
                  _isLoading = false;
                  _errorMessage = null;
                });
              },
              onWebResourceError: (WebResourceError error) {
                if (error.isForMainFrame == false) {
                  return;
                }

                if (!mounted) {
                  return;
                }

                setState(() {
                  _isLoading = false;
                  _errorMessage = error.description.isEmpty
                      ? 'Unable to reach the live NeuraTalk platform.'
                      : error.description;
                });
              },
            ),
          );

    if (controller.platform is AndroidWebViewController) {
      final AndroidWebViewController androidController =
          controller.platform as AndroidWebViewController;

      unawaited(AndroidWebViewController.enableDebugging(kDebugMode));
      unawaited(androidController.setMediaPlaybackRequiresUserGesture(false));
      unawaited(
        androidController.setGeolocationPermissionsPromptCallbacks(
          onShowPrompt: (_) async {
            final PermissionStatus status =
                await Permission.locationWhenInUse.request();
            final bool allow = status.isGranted;
            return GeolocationPermissionsResponse(
              allow: allow,
              retain: allow,
            );
          },
        ),
      );
      unawaited(
        androidController.setCustomWidgetCallbacks(
          onShowCustomWidget: (Widget widget, VoidCallback onHidden) {
            if (!mounted) {
              return;
            }

            setState(() {
              _fullscreenWidget = widget;
              _hideFullscreenWidget = onHidden;
            });
          },
          onHideCustomWidget: () {
            if (!mounted) {
              return;
            }

            setState(() {
              _fullscreenWidget = null;
              _hideFullscreenWidget = null;
            });
          },
        ),
      );
    }

    return controller;
  }

  Future<void> _bootstrap() async {
    await _refreshConnectivity();
    await _loadLivePlatform(forceReload: true);
  }

  Future<void> _refreshConnectivity() async {
    final ConnectivityResult result = await _connectivity.checkConnectivity();
    await _handleConnectivityChanged(result);
  }

  Future<void> _handleConnectivityChanged(ConnectivityResult result) async {
    if (!mounted) {
      return;
    }

    final bool recovered =
        _connectivityStatus == ConnectivityResult.none &&
            result != ConnectivityResult.none;

    setState(() {
      _connectivityStatus = result;
    });

    if (recovered && _errorMessage != null) {
      await _loadLivePlatform(forceReload: true);
    }
  }

  Future<void> _loadLivePlatform({required bool forceReload}) async {
    final Uri? uri = _initialUri;
    if (uri == null) {
      if (!mounted) {
        return;
      }

      setState(() {
        _isLoading = false;
        _errorMessage =
            'Invalid NEURATALK_APP_URL. Set a valid https://.../app URL.';
      });
      return;
    }

    if (!mounted) {
      return;
    }

    setState(() {
      _isLoading = true;
      _progress = 0;
      _errorMessage = null;
      _currentUrl = uri.toString();
    });

    try {
      if (forceReload) {
        await _controller.clearCache();
      }

      await _controller.loadRequest(
        uri,
        headers: ShellConfig.noCacheHeaders,
      );
    } catch (error) {
      if (!mounted) {
        return;
      }

      setState(() {
        _isLoading = false;
        _errorMessage = error.toString();
      });
    }
  }

  Future<void> _handleWebViewPermissionRequest(
    WebViewPermissionRequest request,
  ) async {
    final List<Permission> permissions = <Permission>[];

    if (request.types.contains(WebViewPermissionResourceType.camera)) {
      permissions.add(Permission.camera);
    }

    if (request.types.contains(WebViewPermissionResourceType.microphone)) {
      permissions.add(Permission.microphone);
    }

    if (permissions.isEmpty) {
      await request.grant();
      return;
    }

    final Map<Permission, PermissionStatus> statuses =
        await permissions.request();
    final bool granted = statuses.values.every((PermissionStatus status) {
      return status.isGranted;
    });

    if (granted) {
      await request.grant();
      return;
    }

    await request.deny();

    if (!mounted) {
      return;
    }

    final bool permanentlyDenied = statuses.values.any(
      (PermissionStatus status) => status.isPermanentlyDenied,
    );

    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(
          permanentlyDenied
              ? 'Camera/microphone permission is blocked. Open app settings to enable calling.'
              : 'Camera/microphone permission is required for live calls.',
        ),
        action: permanentlyDenied
            ? SnackBarAction(
                label: 'Settings',
                onPressed: () {
                  openAppSettings();
                },
              )
            : null,
      ),
    );
  }

  Future<bool> _handleBackPress() async {
    if (_fullscreenWidget != null) {
      _hideFullscreenWidget?.call();
      return false;
    }

    if (await _controller.canGoBack()) {
      await _controller.goBack();
      return false;
    }

    return true;
  }

  @override
  Widget build(BuildContext context) {
    return PopScope<Object?>(
      canPop: false,
      onPopInvokedWithResult: (bool didPop, Object? result) async {
        if (didPop) {
          return;
        }

        final bool shouldExit = await _handleBackPress();
        if (shouldExit) {
          await SystemNavigator.pop();
        }
      },
      child: Scaffold(
        backgroundColor: Colors.black,
        body: Stack(
          children: <Widget>[
            Positioned.fill(
              child: WebViewWidget(
                controller: _controller,
              ),
            ),
            if (_isLoading)
              Positioned(
                top: 0,
                left: 0,
                right: 0,
                child: LinearProgressIndicator(
                  value: _progress < 1 ? _progress : null,
                  minHeight: 3,
                  backgroundColor: Colors.white12,
                ),
              ),
            if (_connectivityStatus == ConnectivityResult.none)
              const _StatusBanner(
                message: 'Offline. Waiting for the NeuraTalk platform...',
                icon: Icons.wifi_off_rounded,
              ),
            if (_errorMessage != null)
              Positioned.fill(
                child: _ErrorView(
                  url: _currentUrl ?? ShellConfig.rawAppUrl,
                  message: _errorMessage!,
                  onRetry: () {
                    unawaited(_loadLivePlatform(forceReload: true));
                  },
                ),
              ),
            if (_fullscreenWidget != null)
              Positioned.fill(child: _fullscreenWidget!),
          ],
        ),
      ),
    );
  }
}

class _StatusBanner extends StatelessWidget {
  const _StatusBanner({
    required this.message,
    required this.icon,
  });

  final String message;
  final IconData icon;

  @override
  Widget build(BuildContext context) {
    return SafeArea(
      child: Align(
        alignment: Alignment.topCenter,
        child: Container(
          margin: const EdgeInsets.all(16),
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
          decoration: BoxDecoration(
            color: Colors.black.withValues(alpha: 0.82),
            borderRadius: BorderRadius.circular(16),
            border: Border.all(color: Colors.white24),
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: <Widget>[
              Icon(icon, color: Colors.white70),
              const SizedBox(width: 12),
              Flexible(
                child: Text(
                  message,
                  style: const TextStyle(color: Colors.white),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _ErrorView extends StatelessWidget {
  const _ErrorView({
    required this.url,
    required this.message,
    required this.onRetry,
  });

  final String url;
  final String message;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    return ColoredBox(
      color: Colors.black.withValues(alpha: 0.94),
      child: SafeArea(
        child: Center(
          child: Padding(
            padding: const EdgeInsets.all(24),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 420),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: <Widget>[
                  const Icon(
                    Icons.cloud_off_rounded,
                    size: 64,
                    color: Colors.white70,
                  ),
                  const SizedBox(height: 20),
                  const Text(
                    'Live Platform Unreachable',
                    textAlign: TextAlign.center,
                    style: TextStyle(
                      color: Colors.white,
                      fontSize: 24,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                  const SizedBox(height: 12),
                  Text(
                    message,
                    textAlign: TextAlign.center,
                    style: const TextStyle(
                      color: Colors.white70,
                      fontSize: 15,
                    ),
                  ),
                  const SizedBox(height: 12),
                  Text(
                    url,
                    textAlign: TextAlign.center,
                    style: const TextStyle(
                      color: Colors.white54,
                      fontSize: 13,
                    ),
                  ),
                  const SizedBox(height: 24),
                  FilledButton.icon(
                    onPressed: onRetry,
                    icon: const Icon(Icons.refresh_rounded),
                    label: const Text('Retry'),
                  ),
                  const SizedBox(height: 12),
                  const Text(
                    'This APK is a live shell. Once the backend is reachable, the latest platform loads without rebuilding the app.',
                    textAlign: TextAlign.center,
                    style: TextStyle(
                      color: Colors.white54,
                      fontSize: 12,
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}
