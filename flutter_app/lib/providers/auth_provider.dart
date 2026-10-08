import 'dart:async';
import 'dart:io';
import 'package:flutter/foundation.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../services/api_service.dart';

class AuthProvider extends ChangeNotifier {
  Map<String, dynamic>? _user;
  bool _loading = false;
  bool _ready = false;
  bool _onboardingDone = false;
  static const _onboardingKey = 'onboarding_done_v1';
  String? _error;
  String? _verificationId;

  Map<String, dynamic>? get user => _user;
  bool get loading => _loading;
  /// False until the saved session has been checked at startup (the router shows the splash meanwhile).
  bool get ready => _ready;
  /// True once the intro slides were seen on this device (then logged-out users see Login directly).
  bool get onboardingDone => _onboardingDone;

  Future<void> markOnboardingDone() async {
    _onboardingDone = true;
    notifyListeners();
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setBool(_onboardingKey, true);
    } catch (_) {}
  }
  String? get error => _error;
  bool get isLoggedIn => ApiService.isLoggedIn && _user != null;

  Future<void> init() async {
    try {
      try {
        final prefs = await SharedPreferences.getInstance();
        _onboardingDone = prefs.getBool(_onboardingKey) ?? false;
      } catch (_) {}
      await ApiService.init();
      if (ApiService.isLoggedIn) {
        await fetchProfile();
      }
    } finally {
      _ready = true;
      notifyListeners();
    }
  }

  // Firebase's Android device verification rejects builds Google Play doesn't
  // recognise (APKs installed directly) with these codes. The login screen
  // then switches to the in-app web OTP flow, which works on those builds.
  static const _deviceVerificationCodes = {'missing-client-identifier', 'app-not-authorized'};

  // Fictional numbers registered in Firebase Console → Authentication →
  // Sign-in method → Phone → "Phone numbers for testing". Firebase only
  // accepts these with their fixed test code and never sends an SMS, so app
  // verification (Play Integrity / reCAPTCHA) can be skipped for them. This
  // lets internal testers log in on sideloaded builds. Real numbers are
  // unaffected. Remove before a public release.
  static const _firebaseTestNumbers = {'+919999900001', '+919999900002'};

  /// Step 1: Send OTP via Firebase Phone Auth
  Future<void> sendFirebaseOtp(
    String phone, {
    required void Function(String verificationId) onCodeSent,
    required void Function(String error) onError,
    void Function(PhoneAuthCredential)? onAutoVerify,
    void Function()? onDeviceVerificationFailed,
  }) async {
    _loading = true;
    _error = null;
    notifyListeners();

    try {
      // Drop any stale Firebase session (e.g. a different number from an
      // earlier attempt) so _doSignIn can safely reuse currentUser.
      _verificationId = null;
      await FirebaseAuth.instance.signOut();
      final isTestNumber = _firebaseTestNumbers.contains(phone);
      await FirebaseAuth.instance.setSettings(appVerificationDisabledForTesting: isTestNumber);
      await FirebaseAuth.instance.verifyPhoneNumber(
        phoneNumber: phone,
        timeout: const Duration(seconds: 60),
        verificationCompleted: (credential) async {
          // Android auto-retrieval
          onAutoVerify?.call(credential);
        },
        verificationFailed: (e) {
          if (onDeviceVerificationFailed != null && _deviceVerificationCodes.contains(e.code)) {
            _loading = false;
            notifyListeners();
            onDeviceVerificationFailed();
            return;
          }
          _loading = false;
          _error = _friendlyFirebaseError(e);
          notifyListeners();
          onError(_error!);
        },
        codeSent: (verificationId, resendToken) {
          _verificationId = verificationId;
          _loading = false;
          notifyListeners();
          onCodeSent(verificationId);
        },
        codeAutoRetrievalTimeout: (_) {
          _loading = false;
          notifyListeners();
        },
      );
    } catch (e) {
      _loading = false;
      _error = e.toString();
      notifyListeners();
      onError(_error!);
    }
  }

  /// Step 2: Verify OTP code and exchange Firebase token for NeuraTalk session
  Future<void> verifyFirebaseOtp(String smsCode) async {
    if (_verificationId == null) {
      throw Exception('No verification in progress. Request OTP first.');
    }
    _loading = true;
    _error = null;
    notifyListeners();

    try {
      final credential = PhoneAuthProvider.credential(
        verificationId: _verificationId!,
        smsCode: smsCode,
      );
      await _signInWithCredential(credential);
    } catch (e) {
      _error = _friendlyFirebaseError(e);
      rethrow;
    } finally {
      _loading = false;
      notifyListeners();
    }
  }

  /// Used for auto-verified credentials (Android only). Rethrows so the
  /// caller never navigates into the app without a NeuraTalk session.
  Future<void> signInWithAutoCredential(PhoneAuthCredential credential) async {
    _loading = true;
    _error = null;
    notifyListeners();
    try {
      await _signInWithCredential(credential);
    } catch (e) {
      _error = _friendlyFirebaseError(e);
      rethrow;
    } finally {
      _loading = false;
      notifyListeners();
    }
  }

  // Shared in-flight sign-in, so Android auto-retrieval and a manual "Verify"
  // tap racing each other don't consume the same verification twice (the
  // loser would otherwise fail with session-expired / invalid code).
  Future<void>? _signInInFlight;

  Future<void> _signInWithCredential(PhoneAuthCredential credential) {
    return _signInInFlight ??= _doSignIn(credential).whenComplete(() => _signInInFlight = null);
  }

  Future<void> _doSignIn(PhoneAuthCredential credential) async {
    // An SMS code can only be redeemed once. If Firebase is already signed in
    // (auto-retrieval finished, or a previous attempt got past Firebase but
    // the backend exchange failed), reuse that session instead of redeeming
    // the code again.
    User? fbUser = FirebaseAuth.instance.currentUser;
    if (fbUser == null || fbUser.phoneNumber == null) {
      final userCred = await FirebaseAuth.instance.signInWithCredential(credential);
      fbUser = userCred.user;
    }
    final idToken = await fbUser?.getIdToken(true);
    if (idToken == null) throw Exception('Firebase sign-in succeeded but no ID token returned.');

    final res = await ApiService.post('/api/auth/firebase-verify', {'idToken': idToken});
    final token = res['token'] as String?;
    if (token == null) throw Exception('Login failed: server did not return a session.');
    await ApiService.saveToken(token);
    _user = res['user'] as Map<String, dynamic>?;
  }

  /// Completes a login done through the in-app web OTP page, which already
  /// exchanged the Firebase token for a NeuraTalk session on the server.
  Future<void> completeWebLogin(String token, Map<String, dynamic>? user) async {
    await ApiService.saveToken(token);
    _user = user;
    _error = null;
    if (_user == null) {
      await fetchProfile();
    }
    notifyListeners();
  }

  Future<void> fetchProfile() async {
    try {
      final res = await ApiService.get('/api/auth/me') as Map<String, dynamic>;
      _user = res;
      notifyListeners();
    } on ApiException catch (e) {
      // Only an expired/invalid session signs you out. A network blip or a
      // server hiccup used to log people out at random.
      if (e.statusCode == 401) await ApiService.clearToken();
    } catch (_) {
      // Offline etc.: keep the session and the last known profile.
    }
  }

  /// Saved chats on this phone belong to the signed-in person only.
  static Future<void> _clearSavedChats() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      for (final key in prefs.getKeys().toList()) {
        if (key.startsWith('chat_threads_cache_v1') || key.startsWith('chat_messages_cache_v1_') || key == 'chat_translation_off_v1') {
          await prefs.remove(key);
        }
      }
    } catch (_) {}
  }

  Future<void> logout() async {
    try {
      await ApiService.post('/api/auth/logout', {});
    } catch (_) {}
    try {
      await FirebaseAuth.instance.signOut();
    } catch (_) {}
    await ApiService.clearToken();
    await _clearSavedChats();
    _user = null;
    notifyListeners();
  }

  String _friendlyFirebaseError(Object e) {
    if (e is FirebaseAuthException) {
      return switch (e.code) {
        'invalid-verification-code' => 'Wrong OTP. Please try again.',
        'session-expired' => 'OTP expired. Request a new one.',
        'too-many-requests' => 'Too many attempts. Try again later.',
        'quota-exceeded' => 'SMS quota exceeded. Contact support.',
        'invalid-phone-number' => 'That phone number is not valid. Please check it.',
        'missing-client-identifier' || 'app-not-authorized' || 'captcha-check-failed' =>
          'Could not verify this device. Please update Google Chrome and Google Play services, then try again. (${e.code})',
        'web-context-canceled' => 'Verification was closed before it finished. Please try again.',
        'network-request-failed' => 'No internet connection. Please try again.',
        _ => '${e.message ?? 'Phone verification failed.'} (${e.code})',
      };
    }
    if (e is ApiException) {
      // Server sent a specific reason (e.g. FIREBASE_TOKEN_EXPIRED) — its
      // message is already user-facing.
      if (e.code != null) return e.message;
      if (e.statusCode == 401) return 'Server could not verify your login. Please request a new OTP.';
      if (e.statusCode == 403) return e.message;
      if (e.statusCode >= 500) return 'Server error while logging in. Please try again.';
      return e.message;
    }
    if (e is TimeoutException) return 'Server is not responding. Check your internet and try again.';
    if (e is SocketException) return 'No internet connection.';
    return e.toString().replaceFirst('Exception: ', '');
  }
}
