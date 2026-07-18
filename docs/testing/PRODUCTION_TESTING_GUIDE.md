# 🧪 Production Testing Guide - NeuraTalk

**Objective**: Validate that all critical features work in real-world conditions  
**Scope**: OTP, Calls, Payments, API Reliability, Crash Handling  
**Duration**: 1-2 hours for full test suite  

---

## PREREQUISITE CHECKLIST

Before testing, ensure:

- [ ] Android device with:
  - Minimum Android 10 (API 29)
  - At least 2GB RAM
  - Phone number that can receive SMS
  - USB debugging enabled
  - Developer mode enabled
- [ ] Production APK built: `flutter build apk --release`
- [ ] Backend server running (local or production)
- [ ] API keys configured in backend (.env file)
- [ ] Firebase project connected with Crashlytics
- [ ] Network: WiFi connection (for first test)

---

## TEST SUITE 1: AUTHENTICATION (OTP)

### Test 1.1: OTP Request on WiFi

**Duration**: 5 minutes  
**Pass Criteria**: OTP arrives in < 10 seconds

```
STEPS:
1. Uninstall app if previously installed
   adb uninstall com.neuratalk

2. Install release APK
   adb install build/app/outputs/apk/release/app-release.apk

3. Open app → Tap "Continue with Phone"

4. Enter phone number in format: +91XXXXXXXXXX
   Example: +919876543210

5. Tap "Send OTP"

6. MEASURE TIME from tap to SMS arrival
   ✅ PASS: SMS arrives in 5-10 seconds
   ❌ FAIL: SMS doesn't arrive or takes > 15 seconds

7. If SMS arrives:
   - Copy 6-digit code from SMS
   - Paste into OTP field in app
   - Tap "Verify"

8. Wait for screen to show "Login Successful"
   ✅ PASS: Token stored, redirected to home
   ❌ FAIL: Error message or no redirect
```

**Debugging if fails**:
```bash
# Check Twilio logs
curl https://api.twilio.com/2010-04-01/Accounts/{SID}/Messages.json \
  -u {SID}:{TOKEN} | jq '.messages[-5:] | .[] | {to, status, error_message}'

# If status is "failed":
# - Check phone number format (must be E.164)
# - Verify Twilio account has available credits
# - Check if number is in verified list

# Check app logs
adb logcat | grep -i "auth\|otp\|firebase"
```

### Test 1.2: OTP Retry (Request New OTP)

**Duration**: 3 minutes  
**Pass Criteria**: Can request new OTP after 60 seconds

```
STEPS:
1. From previous test, open Login screen (logout first)

2. Enter same phone number

3. Tap "Send OTP"

4. Immediately tap "Resend OTP"
   ✅ PASS: See "Resend available in 60 sec" message
   ❌ FAIL: OTP sent again immediately

5. Wait 65 seconds

6. Tap "Resend OTP" again
   ✅ PASS: OTP code changes (verify by receiving new SMS)
   ❌ FAIL: Same OTP code or request fails
```

### Test 1.3: OTP Expiry

**Duration**: 12 minutes  
**Pass Criteria**: OTP expires after 10 minutes

```
STEPS:
1. Request OTP (from Test 1.1)

2. Do not enter OTP for 10+ minutes

3. After 10 minutes, try to enter the OTP
   ✅ PASS: Error "OTP expired. Request new OTP."
   ❌ FAIL: Accepts expired OTP or no error shown

4. Request new OTP and verify it works
   ✅ PASS: New OTP arrives and verifies successfully
```

### Test 1.4: Wrong OTP (Multiple Attempts)

**Duration**: 2 minutes  
**Pass Criteria**: Blocks after 5 wrong attempts

```
STEPS:
1. Request OTP

2. Intentionally enter WRONG code (e.g., 000000)

3. Tap "Verify"
   ✅ PASS: Error "Invalid OTP. 4 attempts remaining."

4. Repeat 4 more times (5 total wrong attempts)
   ✅ PASS: After 5 attempts, error "Too many attempts. Request new OTP."
   ❌ FAIL: Still accepts attempts or no limit enforced
```

**Expected Errors** (these are correct):
```
Attempt 1: "Invalid OTP. 4 attempts remaining."
Attempt 2: "Invalid OTP. 3 attempts remaining."
Attempt 3: "Invalid OTP. 2 attempts remaining."
Attempt 4: "Invalid OTP. 1 attempt remaining."
Attempt 5: "Too many attempts. Request new OTP."
```

---

## TEST SUITE 2: NETWORK RESILIENCE

### Test 2.1: OTP with 3G Network

**Duration**: 10 minutes  
**Pass Criteria**: OTP arrives (slower but works)

```
STEPS:
1. Settings → Developer Options → Network Simulator

2. Select "3G Only" (not WiFi)

3. Open app → Request OTP
   ✅ PASS: OTP arrives in 15-30 seconds (slower but works)
   ✅ PASS: Shows "Connecting..." while waiting
   ❌ FAIL: OTP doesn't arrive or app freezes

4. Verify OTP within 3-5 seconds
   ✅ PASS: Verification completes
   ❌ FAIL: Verification timeout or error

5. Switch back to WiFi for remaining tests
```

### Test 2.2: No Network (Offline) Handling

**Duration**: 3 minutes  
**Pass Criteria**: Shows appropriate error (no crash)

```
STEPS:
1. Airplane Mode ON (disconnect all networks)

2. Open app (or if already open, clear app data first)

3. Try to request OTP
   ✅ PASS: Error "Network unavailable. Please check your connection."
   ✅ PASS: App doesn't crash (no red error screen)
   ❌ FAIL: Crashes or shows generic error

4. Turn Airplane Mode OFF

5. Retry OTP request
   ✅ PASS: Works normally
```

### Test 2.3: Network Timeout Recovery

**Duration**: 5 minutes  
**Pass Criteria**: Retries automatically and succeeds

```
STEPS:
1. Settings → Developer Options → Network Simulator

2. Select "RSRP Signal: -140 dBm" (extreme signal loss)

3. Try to request OTP
   ✅ PASS: App shows "Connecting..." then "Retrying..."
   ✅ PASS: Eventually succeeds after 2-3 retries
   ✅ PASS: Shows "Attempt 1/3", "Attempt 2/3", etc.
   ❌ FAIL: App hangs or crashes

4. Normal signal (~-120 dBm) should work immediately
```

---

## TEST SUITE 3: CALLS (STABILITY)

### Test 3.1: Call Screen Opens Without Crash

**Duration**: 2 minutes  
**Pass Criteria**: No crashes, shows UI

```
STEPS:
1. Login successfully (from auth tests)

2. Go to Home → Tap "Start Call" or "Call Feature"

3. Tap "New Call" button
   ✅ PASS: Call screen opens
   ✅ PASS: Shows phone input field + Start Call button
   ❌ FAIL: Crash or blank screen

4. Try to call (will likely show "Feature not available" 
   but should NOT crash)
   ✅ PASS: Shows error message (graceful)
   ✅ FAIL: Crash or freeze
```

### Test 3.2: Call Feature Gracefully Disables

**Duration**: 1 minute  
**Pass Criteria**: Shows "Not Available" (no crash)

```
STEPS:
1. From call screen, tap "Start Call"

2. If backend signaling server not implemented:
   ✅ PASS: Shows message "Real-time calls coming soon"
   ✅ PASS: Button is disabled
   ❌ FAIL: Crash or allows call to start then crash

3. Navigate away from call screen and back
   ✅ PASS: No crash or retained errors
```

---

## TEST SUITE 4: SUBSCRIPTION/PAYMENTS

### Test 4.1: Payment Screen Opens

**Duration**: 2 minutes  
**Pass Criteria**: UI renders, no crashes

```
STEPS:
1. Logged in, Home screen

2. Go to Settings → "Upgrade to Pro"

3. Payment screen should show:
   ✅ PASS: 3 plan options (Free, Pro, Premium)
   ✅ PASS: Price displayed correctly
   ✅ PASS: "Buy Now" button visible
   ❌ FAIL: Crash, blank screen, or missing elements
```

### Test 4.2: Payment Initiation (Cancel at Razorpay)

**Duration**: 5 minutes  
**Pass Criteria**: Razorpay modal opens (can safely cancel)

```
STEPS:
1. Payment screen, select "Pro Plan"

2. Tap "Continue to Payment"
   ✅ PASS: Backend creates order (network request)
   ✅ PASS: Razorpay payment modal opens

3. At Razorpay modal:
   - Do NOT enter payment details
   - Close modal
   ✅ PASS: App handles cancellation gracefully
   ✅ PASS: Returns error "Payment cancelled" (no crash)
   ❌ FAIL: App crashes or undefined behavior
```

### Test 4.3: Signature Verification (No Dummy Signatures!)

**Duration**: 2 minutes  
**Pass Criteria**: Wrong signature rejected

```
STEPS:
1. In app code, simulate payment response with WRONG signature:
   - orderId: "order_123"
   - paymentId: "pay_456"
   - signature: "abc123def456" (wrong!)

2. Simulate verification:
   ✅ PASS: Verification fails with "Invalid signature"
   ❌ FAIL: Signature bypass accepted

3. With CORRECT signature:
   ✅ PASS: Verification succeeds
```

---

## TEST SUITE 5: CRASH HANDLING

### Test 5.1: Crashlytics Initialization

**Duration**: 2 minutes  
**Pass Criteria**: Crashes are reported

```
STEPS:
1. App open and logged in

2. Go to Settings → About

3. Tap "Test Crash" button (if exists) OR:
   - In Debug mode, uncomment test line:
     throw Exception('Test crash from Crashlytics');

4. App crashes (expected)

5. Wait 2 minutes

6. Open Firebase Console:
   https://console.firebase.google.com → Crashlytics

7. Check if crash appears:
   ✅ PASS: Crash visible with stack trace
   ✅ PASS: Shows device, Android version, timestamp
   ❌ FAIL: No data or crash not recorded
```

### Test 5.2: Network Error Caught

**Duration**: 3 minutes  
**Pass Criteria**: Network errors don't crash app

```
STEPS:
1. Turn Airplane Mode ON

2. Try to request OTP
   - App shows error message (expected)
   - Does NOT crash
   ✅ PASS: Error handled gracefully

3. Check Crashlytics for any CRASHES
   ❌ FAIL: Any crash reported (should be 0)

4. Turn Airplane Mode OFF

5. Retry OTP
   ✅ PASS: Works again
```

### Test 5.3: UI Error (Invalid Input)

**Duration**: 2 minutes  
**Pass Criteria**: Bad input causes no crash

```
STEPS:
1. Login screen

2. Try entering invalid phone numbers:
   - "abc123"
   - "123"
   - Empty field
   - "++++++"

3. For each:
   ✅ PASS: Shows validation error (if enabled)
   ✅ PASS: Button disabled (if validation enabled)
   ✅ PASS: No crash
   ❌ FAIL: Crash on invalid input
```

---

## TEST SUITE 6: PERFORMANCE & RESOURCES

### Test 6.1: Memory Leak Check

**Duration**: 10 minutes  
**Pass Criteria**: No growing memory usage

```
STEPS:
1. Open Android Studio → Device Monitor OR
   adb logcat | grep -i "memory\|gc"

2. Start app and note baseline memory:
   adb shell dumpsys meminfo com.neuratalk | grep "TOTAL"

3. Repeat 10 times:
   - Login/Logout
   - Open/Close each screen
   - Request OTP (but don't submit)

4. Check memory again:
   ✅ PASS: Memory same or slightly higher (~10-20MB)
   ❌ FAIL: Memory keeps growing (> 50MB increase)

5. Check for ANRs (App Not Responding):
   adb logcat | grep -i "anr"
   ✅ PASS: No ANR errors
   ❌ FAIL: Multiple ANRs mean slow operations
```

### Test 6.2: Startup Time

**Duration**: 2 minutes  
**Pass Criteria**: App starts in < 5 seconds

```
STEPS:
1. Force-stop app:
   adb shell am force-stop com.neuratalk

2. Start app from home screen:
   adb shell am start -n com.neuratalk/.MainActivity

3. Time from launch to "First screen rendered":
   ✅ PASS: 2-5 seconds (fast)
   🟡 ACCEPTABLE: 5-10 seconds (okay)
   ❌ FAIL: > 10 seconds (slow)

4. Check startup logs:
   adb logcat | grep "MainActivity"
```

### Test 6.3: Background Suspension

**Duration**: 5 minutes  
**Pass Criteria**: App resumes without crash

```
STEPS:
1. App logged in and on Home screen

2. Start an operation (e.g., request OTP but don't verify)

3. Press Home button (app goes to background)

4. Wait 10 seconds

5. Tap app in recent apps to resume:
   ✅ PASS: App resumes showing home screen
   ✅ PASS: No crash, state preserved
   ❌ FAIL: Black screen, crash, or hung

6. Try to continue using app (request OTP again)
   ✅ PASS: Works normally
```

---

## TEST SUITE 7: SECURITY BASICS

### Test 7.1: Token Storage

**Duration**: 2 minutes  
**Pass Criteria**: Auth token stored securely

```
VERIFICATION (requires debug access):
1. After login, check secure storage:
   adb shell "sqlite3 /data/data/com.neuratalk/databases/flutter_secure.db" \
   "SELECT * FROM flutter_secure_storage;"
   
   ✅ PASS: No clear-text tokens visible
   (Uses encryption via iOS/Android secure storage)

2. Token should only be in secure storage, NOT in:
   - SharedPreferences (plain text)
   - Logcat output
   - Files in app directory
```

### Test 7.2: OTP Never Logged

**Duration**: 2 minutes  
**Pass Criteria**: OTP codes not in logs

```
STEPS:
1. Request OTP and receive SMS

2. Check logcat for OTP code:
   adb logcat | grep "OTP\|[0-9]{6}"
   
   ❌ FAIL: If OTP code appears in logs
   ✅ PASS: If OTP code is masked or absent

3. Check backend logs (if accessible):
   grep "OTP\|[0-9]{6}" server/logs/*
   
   ✅ PASS: OTP code not logged in plain text
```

---

## VALIDATION CHECKLIST

After running all tests, check these boxes:

### Authentication
- [ ] OTP arrives in < 10 seconds on WiFi
- [ ] OTP expires after 10 minutes
- [ ] Wrong OTP blocked after 5 attempts
- [ ] Resend OTP works with 60-second cooldown
- [ ] Firebase Phone Auth initialized correctly

### Network
- [ ] OTP works on 3G (slower but recovers)
- [ ] Offline shows error, doesn't crash
- [ ] Timeouts retry automatically (up to 3x)

### Calls
- [ ] Call screen opens without crash
- [ ] Invalid phone number rejected gracefully
- [ ] Call UI doesn't have unhandled exceptions

### Payments
- [ ] Payment screen renders correctly
- [ ] Razorpay modal can be canceled safely
- [ ] Payment signature verification works
- [ ] Wrong signatures rejected

### Stability
- [ ] Zero crashes in Crashlytics (after tests)
- [ ] All network errors show user-friendly messages
- [ ] Memory doesn't grow unbounded
- [ ] App resumes from background without crash

### Security
- [ ] Auth tokens stored securely
- [ ] OTP codes not exposed in logs
- [ ] No sensitive data in Logcat

---

## TROUBLESHOOTING TEST FAILURES

### If OTP Never Arrives

```
Diagnostic Steps:
1. Check phone has network signal (at least 3G/LTE)
2. Verify number format: +91 is correct for India
3. Check Twilio account:
   - Login to https://www.twilio.com/console
   - Messages → Log → Last 5 messages
   - If error: "Unverified recipient" → Add to verified list
   - If error: "No credit" → Fund account
4. Check backend logs:
   npm start logs | grep "Twilio\|SMS"
   - Should show "OTP sent to +91..."
   - If missing SDK: npm install twilio
   - If no init: Check .env for TWILIO_ACCOUNT_SID
5. Test directly via Twilio CLI:
   twilio api:core:messages:create \
   --to "+919876543210" \
   --from "+1..." \
   --body "Test OTP: 123456"
```

### If OTP Arrives but Verification Fails

```
Diagnostic Steps:
1. Check backend validation:
   - Log into MongoDB database
   - Query: db.otps.findOne({identifier: "+919876543210"})
   - Field "verified" should change from false → true after OTP submit
2. Check Firebase:
   - If using Firebase Phone Auth, verify FirebaseAuth initialized
   - Check google-services.json exists
3. Check JWT token generation:
   - Backend should generate JWT after OTP verified
   - App should store JWT in secure storage
   - Logcat: grep "Authorization: Bearer" should show token present
4. Test endpoint directly:
   curl -X POST http://localhost:5000/api/auth/otp/verify \
   -H "Content-Type: application/json" \
   -d '{"identifier":"+919876543210","code":"123456"}'
```

### If App Crashes at Any Point

```
Diagnostic Steps:
1. Check Crashlytics:
   - Firebase Console → Crashlytics
   - Find crash in list
   - Click to see full stack trace
   
2. Check Logcat:
   adb logcat -c  # Clear
   adb logcat | grep -i "exception\|error\|crash"
   
3. Check error class in stack trace:
   - NullPointerException → Variable not initialized
   - TimeoutException → API took too long
   - FirebaseException → Firebase SDK issue
   - SocketException → Network problem

4. Add defensive code:
   - Try-catch around suspicious operation
   - Log before crash point
   - Use defensive null-checks
   
5. Rebuild and test again:
   flutter clean
   flutter build apk --debug
```

### If Crashlytics Shows No Data

```
Diagnostic Steps:
1. Verify Crashlytics initialized:
   - Check FirebaseCrashlytics.instance.recordError() exists
   - Check google-services.json is correct
   
2. Force test crash:
   In code add:
   throw Exception('Test crash');
   
3. Wait 2-3 minutes for sync (not immediate)
   
4. Hard refresh Firebase Console (Ctrl+Shift+R)
   
5. Check if data appears in Crashlytics tab

6. If still no data:
   - Rebuild: flutter clean && flutter build apk
   - Check device has internet
   - Check Firebase project ID matches app
```

---

## FINAL SIGN-OFF

When all tests pass, you can sign off:

```
✅ Authentication: PRODUCTION READY
✅ Network Resilience: PRODUCTION READY
✅ Call Stability: READY (calls feature still needs signaling server)
✅ Payments: DEMO READY (needs real Razorpay account)
✅ Crash Handling: PRODUCTION READY
✅ Performance: PRODUCTION READY
✅ Security: BASIC CHECKS PASS

DEPLOYMENT STATUS: ✅ APPROVED FOR BETA TESTING

Next Steps:
1. Deploy to Google Play Store as "Beta" track
2. Invite 100-500 test users
3. Monitor Crashlytics for 1 week
4. Collect feedback and fix issues
5. Move to "Production" track
```

---

## TEST RESULTS TEMPLATE

Copy and fill this for documentation:

```
TEST EXECUTION REPORT
=====================
Date: ____________________
Tester: ___________________
Device: Android __________ (API Level __)
APK Version: ________________

RESULTS:
Test 1.1 (OTP Request WiFi): ✅ PASS / ❌ FAIL
Test 1.2 (OTP Retry): ✅ PASS / ❌ FAIL
Test 1.3 (OTP Expiry): ✅ PASS / ❌ FAIL
Test 1.4 (Wrong OTP): ✅ PASS / ❌ FAIL
Test 2.1 (3G Network): ✅ PASS / ❌ FAIL
Test 2.2 (Offline): ✅ PASS / ❌ FAIL
Test 2.3 (Timeout): ✅ PASS / ❌ FAIL
Test 3.1 (Call Screen): ✅ PASS / ❌ FAIL
Test 3.2 (Call Graceful): ✅ PASS / ❌ FAIL
Test 4.1 (Payment UI): ✅ PASS / ❌ FAIL
Test 4.2 (Payment Modal): ✅ PASS / ❌ FAIL
Test 4.3 (Signature): ✅ PASS / ❌ FAIL
Test 5.1 (Crashlytics): ✅ PASS / ❌ FAIL
Test 5.2 (Network Error): ✅ PASS / ❌ FAIL
Test 5.3 (UI Error): ✅ PASS / ❌ FAIL
Test 6.1 (Memory): ✅ PASS / ❌ FAIL
Test 6.2 (Startup): ✅ PASS / ❌ FAIL
Test 6.3 (Background): ✅ PASS / ❌ FAIL
Test 7.1 (Token Storage): ✅ PASS / ❌ FAIL
Test 7.2 (OTP Logging): ✅ PASS / ❌ FAIL

ISSUES FOUND:
1. [description]

OVERALL RESULT: ✅ APPROVED / 🟡 NEEDS FIXES / ❌ BLOCKED

Sign-off: ________________________
```

---

Good luck with testing! 🚀
