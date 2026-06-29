import 'package:flutter/foundation.dart';
import 'package:firebase_auth/firebase_auth.dart';
import '../services/api_service.dart';

class AuthProvider extends ChangeNotifier {
  Map<String, dynamic>? _user;
  bool _loading = false;
  String? _error;
  String? _verificationId;

  Map<String, dynamic>? get user => _user;
  bool get loading => _loading;
  String? get error => _error;
  bool get isLoggedIn => ApiService.isLoggedIn && _user != null;

  Future<void> init() async {
    await ApiService.init();
    if (ApiService.isLoggedIn) {
      await fetchProfile();
    }
  }

  /// Step 1: Send OTP via Firebase Phone Auth
  Future<void> sendFirebaseOtp(
    String phone, {
    required void Function(String verificationId) onCodeSent,
    required void Function(String error) onError,
    void Function(PhoneAuthCredential)? onAutoVerify,
  }) async {
    _loading = true;
    _error = null;
    notifyListeners();

    try {
      await FirebaseAuth.instance.verifyPhoneNumber(
        phoneNumber: phone,
        timeout: const Duration(seconds: 60),
        verificationCompleted: (credential) async {
          // Android auto-retrieval
          onAutoVerify?.call(credential);
        },
        verificationFailed: (e) {
          _loading = false;
          _error = e.message ?? 'OTP failed. Check Firebase setup.';
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

  /// Used for auto-verified credentials (Android only)
  Future<void> signInWithAutoCredential(PhoneAuthCredential credential) async {
    _loading = true;
    _error = null;
    notifyListeners();
    try {
      await _signInWithCredential(credential);
    } catch (e) {
      _error = _friendlyFirebaseError(e);
    } finally {
      _loading = false;
      notifyListeners();
    }
  }

  Future<void> _signInWithCredential(PhoneAuthCredential credential) async {
    final userCred = await FirebaseAuth.instance.signInWithCredential(credential);
    final idToken = await userCred.user?.getIdToken();
    if (idToken == null) throw Exception('Firebase sign-in succeeded but no ID token returned.');

    final res = await ApiService.post('/api/auth/firebase-verify', {'idToken': idToken}) as Map<String, dynamic>;
    await ApiService.saveToken(res['token'] as String);
    _user = res['user'] as Map<String, dynamic>?;
  }

  Future<void> fetchProfile() async {
    try {
      final res = await ApiService.get('/api/auth/me') as Map<String, dynamic>;
      _user = res;
      notifyListeners();
    } catch (_) {
      await ApiService.clearToken();
    }
  }

  Future<void> logout() async {
    try {
      await ApiService.post('/api/auth/logout', {});
      await FirebaseAuth.instance.signOut();
    } catch (_) {}
    await ApiService.clearToken();
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
        _ => e.message ?? e.code,
      };
    }
    return e.toString();
  }
}
