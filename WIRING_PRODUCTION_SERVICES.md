# 🔌 WIRING PRODUCTION SERVICES TO UI

**Status**: Step-by-Step Integration Guide  
**Duration**: 30-45 minutes to complete all wiring  
**Verification**: Use production-readiness checklist at end  

---

## CRITICAL: Files That MUST Be Updated

### 1️⃣ MAIN APP ENTRY POINT

**File**: `flutter_app/lib/main.dart`

**Current State** ❌:
```dart
providers: [
  ChangeNotifierProvider(create: (_) => AuthService()),        // ❌ OLD
  Provider(create: (_) => ApiService()),                       // ❌ OLD
  ChangeNotifierProvider(create: (_) => WebRTCService()),      // ❌ OLD
  ChangeNotifierProvider(create: (_) => RazorpayService()),    // ❌ OLD
]
```

**Change To** ✅:
```dart
// Import production services
import 'services/auth_service_production.dart';
import 'services/api_service_production.dart';
import 'services/call_service_production.dart';
import 'services/razorpay_service_production.dart';

providers: [
  ChangeNotifierProvider(create: (_) => AuthServiceProduction()),  // ✅ REAL
  Provider(create: (_) => ApiServiceProduction()),                 // ✅ REAL
  ChangeNotifierProvider(create: (_) => CallServiceProduction()),  // ✅ REAL
  ChangeNotifierProvider(
    create: (_) => RazorpayServiceProduction(
      context.read<ApiServiceProduction>(),
    ),
  ),                                                                // ✅ REAL
]
```

**Additional Changes in main()**:
```dart
void main() async {
  WidgetsFlutterBinding.ensureInitialized();
  
  // ✅ ADD: Enable Crashlytics
  await Firebase.initializeApp();
  await FirebaseCrashlytics.instance.setCrashlyticsCollectionEnabled(true);
  
  // ✅ ADD: Global error handlers
  FlutterError.onError = (errorDetails) {
    FirebaseCrashlytics.instance.recordFlutterError(errorDetails);
  };
  
  PlatformDispatcher.instance.onError = (error, stack) {
    FirebaseCrashlytics.instance.recordError(error, stack, fatal: true);
    return true;
  };
  
  // ... rest of main
}
```

---

### 2️⃣ LOGIN SCREEN

**File**: `flutter_app/lib/screens/login_screen.dart`

**Line 4 - Change Import**:
```dart
// BEFORE
import '../services/auth_service.dart';

// AFTER
import '../services/auth_service_production.dart';
```

**Line 19 - Change Variable Type**:
```dart
// BEFORE
late AuthService _authService;

// AFTER
late AuthServiceProduction _authService;
```

**Lines 33-36 - Change Provider Read**:
```dart
// BEFORE
_authService = context.read<AuthService>();

// AFTER
_authService = context.read<AuthServiceProduction>();
```

**Line 82 - Change Provider Read in _sendOTP()**:
```dart
// BEFORE
final authService = context.read<AuthService>();

// AFTER
final authService = context.read<AuthServiceProduction>();
```

**Line 118 - Change Provider Read in _verifyOTP()**:
```dart
// BEFORE
final authService = context.read<AuthService>();

// AFTER
final authService = context.read<AuthServiceProduction>();
```

**What This Does**: 
- Login screen now uses REAL Firebase Phone Auth
- OTP arrives via Firebase SMS (not backend mock)
- Automatic retry with backoff on network errors

---

### 3️⃣ HOME SCREEN

**File**: `flutter_app/lib/screens/home_screen.dart`

**Line 6 - Change Import** (if using auth):
```dart
// BEFORE
import '../services/auth_service.dart';

// AFTER
import '../services/auth_service_production.dart';
```

**Note**: Home screen primarily navigates to other screens. No changes needed to logic if only displaying.

---

### 4️⃣ CALL SCREEN

**File**: `flutter_app/lib/screens/call_screen.dart`

**Lines 7-8 - Change Imports**:
```dart
// BEFORE
import '../services/api_service.dart';

// AFTER
import '../services/api_service_production.dart';
```

**Line 17 - Change Variable Type**:
```dart
// BEFORE
final ApiService _api = ApiService();

// AFTER
final ApiServiceProduction _api = ApiServiceProduction();
```

**Line 37 in _initializeCall()** (if calling API):
```dart
// BEFORE
_conversationId = await _api.createConversation(_language);

// AFTER
try {
  final response = await _api.makeRequest(
    () async => await _httpClient.post(
      Uri.parse('${_api.baseUrl}/api/conversations/create'),
      body: jsonEncode({'language': _language}),
    ),
    operationName: 'Create Conversation',
  );
  _conversationId = response['id'];
} catch (e) {
  FirebaseCrashlytics.instance.recordError(e, StackTrace.current);
  _showError('Failed to create conversation');
}
```

**What This Does**:
- Call screen uses real API with retry logic
- Network errors automatically retry 3x with backoff
- All failures logged to Crashlytics

---

### 5️⃣ SUBSCRIPTION SCREEN (For Payments)

**File**: `flutter_app/lib/screens/subscription_screen.dart` or `billing_screen.dart`

**Import Change**:
```dart
// BEFORE
import '../services/razorpay_service.dart';

// AFTER
import '../services/razorpay_service_production.dart';
```

**Provider Usage**:
```dart
// BEFORE
final razorpay = context.read<RazorpayService>();

// AFTER
final razorpay = context.read<RazorpayServiceProduction>();
```

**What This Does**:
- Payment screen uses REAL Razorpay SDK
- Signature verification prevents fraud
- Payment history tracked correctly

---

## IMPLEMENTATION CHECKLIST

### Step 1: Update main.dart ✅

```bash
# Update imports at top of file
# Replace AuthService with AuthServiceProduction
# Replace ApiService with ApiServiceProduction
# Replace WebRTCService with CallServiceProduction
# Replace RazorpayService with RazorpayServiceProduction

# Add to main() function:
# - Firebase.initializeApp()
# - FirebaseCrashlytics setup
# - Global error handlers
```

**Verification**:
```bash
cd flutter_app
flutter analyze
# Should show NO errors related to imports
```

### Step 2: Update login_screen.dart ✅

```bash
# Delete: import '../services/auth_service.dart';
# Add: import '../services/auth_service_production.dart';
# Replace: late AuthService _authService;
# With: late AuthServiceProduction _authService;
# Replace: context.read<AuthService>()
# With: context.read<AuthServiceProduction>()
```

**Verification**:
```bash
flutter build apk --debug
# Should compile without errors
```

### Step 3: Update call_screen.dart ✅

```bash
# Delete: import '../services/api_service.dart';
# Add: import '../services/api_service_production.dart';
# Replace: final ApiService _api = ApiService();
# With: final ApiServiceProduction _api = ApiServiceProduction();
```

**Verification**:
```bash
flutter build apk --debug
# Should show no errors in CallScreen
```

### Step 4: Update subscription/billing screens ✅

```bash
# Delete: import '../services/razorpay_service.dart';
# Add: import '../services/razorpay_service_production.dart';
# Replace: context.read<RazorpayService>()
# With: context.read<RazorpayServiceProduction>()
```

### Step 5: Build Debug APK ✅

```bash
cd flutter_app
flutter clean
flutter pub get
flutter build apk --debug --verbose

# Output file:
# build/app/outputs/flutter-apk/app-debug.apk (~95MB)
```

### Step 6: Verify Compilation ✅

```bash
# Check no warnings about deprecated imports
flutter analyze

# Expected: No error/warning outputs
```

---

## QUICK CHANGE SUMMARY

| File | Change | Impact |
|------|--------|--------|
| `main.dart` | Use production providers | All services use REAL implementations |
| `login_screen.dart` | AuthServiceProduction | OTP via Firebase, not backend mock |
| `call_screen.dart` | ApiServiceProduction | API calls retry on failure |
| `subscription_screen.dart` | RazorpayServiceProduction | Real payments with signature verification |

---

## SERVICE WIRING FLOW

### Authentication Flow (OTP)

```
User enters phone
    ↓
LoginScreen calls: authService.sendOTP(phone)
    ↓
AuthServiceProduction.sendOTP():
  1. Format phone number (+91XXXXXXXXXX)
  2. Call Firebase.verifyPhoneNumber()
  3. Firebase SMS service sends OTP
  4. User receives SMS in 5-10 seconds ✅
    ↓
User enters OTP code from SMS
    ↓
LoginScreen calls: authService.verifyOTP(phone, code)
    ↓
AuthServiceProduction.verifyOTP():
  1. Firebase verifies code locally
  2. Returns ID token
  3. Gets user from backend
  4. Stores JWT token in secure storage
    ↓
AuthWrapper detects logged in state
    ↓
Redirects to HomeScreen ✅
```

### API Call Flow (With Retry)

```
HomeScreen needs data
    ↓
Calls: apiService.getCurrentUser()
    ↓
ApiServiceProduction.makeRequest():
  Attempt 1:
  - Send HTTP request (timeout: 15s)
  - Success → Return data ✅
  
  On network error/timeout:
  - Wait 1 second
  - Attempt 2 (same request)
  - Success → Return data ✅
  
  Still fails:
  - Wait 2 seconds
  - Attempt 3
  - Success → Return data ✅
  
  Still fails after 3x:
  - Log error to Crashlytics
  - Show "Network timeout" message to user
  - No crash ✅
    ↓
HomeScreen displays data
```

### Payment Flow

```
User taps "Buy Pro Plan"
    ↓
SubscriptionScreen calls: razorpay.createOrder(amount, planId)
    ↓
RazorpayServiceProduction:
  1. Call /api/payments/create-order (with retry)
  2. Backend creates real Razorpay order
  3. Returns orderId
    ↓
Razorpay payment modal opens
    ↓
User enters payment details
    ↓
Razorpay processes payment
    ↓
Backend webhook triggered (when real payments configured)
    ↓
SubscriptionScreen calls: razorpay.confirmPayment(signature)
    ↓
RazorpayServiceProduction:
  1. Verify HMAC-SHA256 signature
  2. Confirm order on Razorpay
  3. Update user subscription in database
    ↓
User sees "Subscription activated" ✅
```

### Crash Handling Flow

```
Any error occurs:
  - Null pointer
  - Network timeout
  - Invalid data
  - API error
    ↓
Try-catch block OR error handler intercepts
    ↓
Error logged to Firebase Crashlytics:
  - Error message
  - Stack trace
  - Device info (Android version, RAM, etc.)
  - User session ID
    ↓
Dashboard updated in real-time:
  https://console.firebase.google.com → Crashlytics
    ↓
Different behavior by error:
  - Network error → Show "Retry" button
  - Validation error → Show "Invalid input" message
  - Server error → Show "Try again later" message
  - Unknown error → Show generic error + log to support
    ↓
No app crash ✅
```

---

## TESTING AFTER WIRING

### Test 1: OTP Flow (5 minutes)

```bash
adb install build/app/outputs/flutter-apk/app-debug.apk

# On device:
# 1. Open app
# 2. Enter phone: +919876543210
# 3. Tap "Send OTP"
# ✅ Expect: SMS arrives in 5-10 seconds
# ✅ Enter OTP from SMS
# ✅ Tap "Verify"
# ✅ Should see "Login Successful" and redirect to Home
```

### Test 2: Crash Reporting (2 minutes)

```bash
# In code, temporarily add test crash:
# throw Exception('Test crash');

# Run app
# Trigger the crash

# Wait 2-3 minutes

# In Firebase Console:
# https://console.firebase.google.com
# → Project → Crashlytics
# ✅ Expect: Crash appears with full stack trace
```

### Test 3: API Retry (2 minutes)

```
# Turn Airplane Mode ON
# Try to request OTP
# ✅ Expect: Shows "Retrying..." message
# Turn Airplane Mode OFF
# ✅ Expect: Task succeeds after retry
```

### Test 4: Payment Initiation (2 minutes)

```
# Open app (logged in)
# Go to Subscription screen
# Tap "Buy Pro Plan"
# ✅ Expect: Razorpay payment modal opens
# ✅ NO CRASHES
```

---

## TROUBLESHOOTING WIRING

### Problem: "AuthService not found" Error

```
Error:
  The getter '_authService' isn't defined for the class '_LoginScreenState'

Solution:
  1. Check import at top: 
     import '../services/auth_service_production.dart';
  2. Check variable declaration:
     late AuthServiceProduction _authService;
  3. Check initialization:
     _authService = context.read<AuthServiceProduction>();
  4. Run:
     flutter clean && flutter pub get
```

### Problem: "ApiServiceProduction" not provided in context

```
Error:
  Could not find the correct Provider<ApiServiceProduction> above this CallScreen Widget

Solution:
  1. Check main.dart has:
     Provider(create: (_) => ApiServiceProduction())
  2. Make sure it's in MultiProvider, not just one Provider
  3. Verify order: ApiServiceProduction created BEFORE dependent services
  4. Add: Provider in main.dart providers list
```

### Problem: Build fails with "undefined reference"

```
Error:
  undefined: 'AuthServiceProduction'

Solution:
  1. Run: flutter pub get
  2. Verify file exists:
     flutter_app/lib/services/auth_service_production.dart
  3. Check import path is correct:
     import '../services/auth_service_production.dart';
  4. If file missing, copy from documentation
```

### Problem: Crash not appearing in Crashlytics

```
Solution:
  1. Check Firebase initialization in main():
     await Firebase.initializeApp();
     await FirebaseCrashlytics.instance.setCrashlyticsCollectionEnabled(true);
  2. Check google-services.json in android/app/
  3. Wait 2-5 minutes for Crashlytics to process
  4. Force a crash to test:
     throw Exception('Test crash');
  5. Hard refresh dashboard:
     Ctrl+Shift+R in browser
```

---

## VERIFICATION CHECKLIST

Before proceeding to real device testing:

### Code Changes
- [ ] main.dart updated with production providers
- [ ] main.dart has Crashlytics initialization
- [ ] main.dart has global error handlers
- [ ] login_screen.dart imports AuthServiceProduction
- [ ] call_screen.dart imports ApiServiceProduction
- [ ] subscription_screen.dart imports RazorpayServiceProduction
- [ ] No deprecated import warnings

### Build Status
- [ ] `flutter build apk --debug` completes without errors
- [ ] `flutter analyze` shows no import errors
- [ ] APK file created: ~95-100MB
- [ ] No warnings about missing providers

### Service Initialization
- [ ] Providers registered in main.dart
- [ ] Services created with lazy: false (initialize immediately)
- [ ] Firebase initialization before services
- [ ] Crashlytics enabled before services

### Ready for Testing?
✅ **YES** if all above boxes checked
❌ **NO** if any boxes unchecked

---

## NEXT STEP

Once wiring complete and verified:

👉 **Follow**: `PRODUCTION_TESTING_GUIDE.md`
- Real device testing
- OTP delivery validation
- Network resilience tests
- Crash handling verification

Then:

👉 **Implement**: Agora for REAL calls (see `AGORA_INTEGRATION.md`)
- Real-time voice/video
- Screen sharing
- Recording
- Intelligent routing

---

**Status**: 🔌 WIRING READY TO START
