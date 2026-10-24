import 'package:flutter/foundation.dart';

import '../services/api_service.dart';

/// The signed-in team's business (name, logo, verified tick, link…), shared by
/// every Business-app screen and refreshed after an edit.
class BusinessAccount extends ChangeNotifier {
  BusinessAccount(this.businessId);

  final int businessId;
  Map<String, dynamic>? business;
  bool loading = false;
  String? error;

  String get base => '/api/business/$businessId';
  String get name => business?['name']?.toString() ?? 'Your business';
  String? get logoUrl => business?['logoUrl'] as String?;
  bool get verified => business?['verified'] == true;
  bool get verificationRequested => business?['verificationRequestedAt'] != null;
  String get link => business?['link']?.toString() ?? '';

  Future<void> load() async {
    loading = business == null;
    notifyListeners();
    try {
      final res = await ApiService.get('$base/account');
      business = Map<String, dynamic>.from(res['business'] as Map);
      error = null;
    } catch (e) {
      error = e is ApiException ? e.message : 'Check your connection and try again.';
    } finally {
      loading = false;
      notifyListeners();
    }
  }
}
