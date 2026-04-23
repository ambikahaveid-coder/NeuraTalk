# 🔍 APK VERIFICATION & TESTING GUIDE

**Purpose**: Verify APK meets international standards before Play Store submission  
**Timeline**: 30-45 minutes  
**Status**: Ready to execute once `app-release.apk` is built  

---

## 📊 PART 1: APK FILE VERIFICATION

### Step 1: Verify APK Exists and Size

```bash
# Navigate to build output
cd flutter_app/build/app/outputs/apk/release/

# List APK file
ls -lh app-release.apk

# Check file size
# Expected: 45-60 MB (anything larger indicates optimization issue)
```

**Success Criteria**:
```
✅ File exists: app-release.apk
✅ File size: 45-60 MB
✅ Not corrupted (can install)
```

---

### Step 2: Extract & Verify APK Contents

```bash
# APKs are ZIP files - can inspect with standard tools
unzip -l app-release.apk | head -50

# Expected structure:
✅ classes.dex (Dart code)
✅ classes2.dex (dependencies - due to MultiDex)
✅ lib/arm64-v8a/ (64-bit ARM)
✅ lib/armeabi-v7a/ (32-bit ARM - optional)
✅ res/ (resources: strings, layouts, images)
✅ AndroidManifest.xml (permissions & metadata)
✅ resources.arsc (compiled resources)
```

---

### Step 3: Verify Digital Signature

```bash
# Check APK is properly signed
jarsigner -verify -verbose -certs app-release.apk

# Expected output:
# - jar verified.
# - signer "CN=..." (trustedCert)
# - No issues found

# Get signing certificate details
keytool -printcert -jarfile app-release.apk | head -20

# Look for:
✅ Owner: CN=NeuraChat (or your name)
✅ Issuer: Same as owner (self-signed is fine for first build)
✅ Algorithm: SHA256withRSA
✅ Key size: 2048 or higher
✅ Valid from: Today or earlier
✅ Valid until: Many years in future (10000+ days)
```

---

### Step 4: Inspect AndroidManifest.xml

```bash
# Extract manifest
unzip -p app-release.apk AndroidManifest.xml > manifest.xml

# Requires conversion from binary XML (Flutter can show it directly)
# Check contains:
✅ application ID: com.Mindwhile.neuratalk
✅ version code: 1
✅ version name: 1.0.0
✅ minSdkVersion: 24 (Android 7.0)
✅ targetSdkVersion: 34 (Android 14)

# View with aapt tool if available:
# aapt dump badging app-release.apk | grep -E "package|versionCode|minSdk|targetSdk"
```

---

## 🏗️ PART 2: ARCHITECTURE & COMPATIBILITY VERIFICATION

### Supported Architectures

```bash
# Extract native libraries
unzip app-release.apk 'lib/*' -d extracted/

# Check architectures
ls extracted/lib/

# Expected:
✅ arm64-v8a/ (required - 64-bit ARM)
   ├── libflutter.so
   ├── libapp.so
   └── [other native libs]
   
✅ armeabi-v7a/ (optional - 32-bit ARM)
   ├── libflutter.so
   └── [32-bit versions]
```

**International Compatibility**:
```
64-bit ARM (arm64-v8a):
✅ 99.9% of modern Android devices
✅ Required for Google Play Store
✅ Better performance

32-bit ARM (armeabi-v7a):
⚠️ Older devices (pre-2015)
⚠️ Smaller audience (< 1%)
⚠️ Can be omitted to reduce APK size
```

---

### Android API Levels

```
Target: Android 14 (API 34)
Minimum: Android 7.0 (API 24)
Compile: Android 15 (API 36)

Device Coverage by API Level:
📱 API 24-27 (Android 7-8): ~10% of devices (older)
📱 API 28-30 (Android 9-11): ~20% of devices
📱 API 31-34 (Android 12-14): ~70% of devices (modern)

Total Addressable Market: 99.5% of Android users
```

---

## 📱 PART 3: DEVICE INSTALLATION & TESTING

### Prerequisites

```
✅ Android device (API 24+)
   OR Android emulator with API 24-34
✅ USB debugging enabled (if physical device)
✅ Latest Google Play Services installed
✅ Minimum 100MB free storage
```

### Installation via ADB

```bash
# Connect device
adb devices
# Expected: device SERIAL_NUMBERS attached

# Install APK
adb install app-release.apk

# Expected output:
# Success
# [100%] Success
```

### Or: Manual Installation

```
1. Transfer APK to device (via email, cloud, USB)
2. Open Files app on device
3. Tap APK file
4. Tap "Install"
5. Wait for installation
6. Tap "Open" or find app in launcher
```

---

## ✅ PART 4: FUNCTIONAL TESTING CHECKLIST

### Launch & Onboarding (2 minutes)

```
🟢 APP STARTUP:
[ ] App launches without crash
[ ] App loads within 3 seconds
[ ] No splash screen freeze
[ ] App is responsive (not ANR)

🟢 INITIAL SCREEN:
[ ] Language selection appears (if applicable)
[ ] Default language matches device locale
[ ] All 15 language options visible
[ ] No UI glitches or overlapping text
```

### Authentication (5 minutes)

```
🟢 SIGN UP:
[ ] Sign up form appears
[ ] Phone number field shows country code
[ ] OTP received within 2 minutes
[ ] Submit OTP succeeds
[ ] Profile creation works
[ ] Profile saves to backend

🟢 SIGN IN:
[ ] Login form appears
[ ] Can login with correct credentials
[ ] Invalid credentials show error
[ ] Login timeout is reasonable (< 10s)
[ ] Session persists (not logged out on restart)
```

### Permissions (3 minutes)

```
🟢 CAMERA PERMISSION:
[ ] Permission request shows when needed
[ ] Rationale displayed: "Camera needed for video calls"
[ ] Can grant and deny
[ ] App handles denial gracefully
[ ] Shows "camera off" indicator if denied

🟢 MICROPHONE PERMISSION:
[ ] Permission request shows for calls
[ ] Rationale displayed: "Microphone for calls"
[ ] Can toggle on/off in settings
[ ] Works correctly when granted/denied

🟢 LOCATION PERMISSION (if applicable):
[ ] Request shows: "Precise" or "Approximate"
[ ] Only requested when needed
[ ] User can revoke in Settings
[ ] App doesn't crash if denied

🟢 CONTACTS PERMISSION (if applicable):
[ ] Request shows when importing contacts
[ ] User can skip/cancel
[ ] Works correctly if granted
[ ] Falls back if denied
```

### Calls Feature (15 minutes)

```
🟢 INCOMING CALL:
[ ] Call notification appears
[ ] Sound plays (if volume on)
[ ] Vibration works (if enabled)
[ ] Accept button works
[ ] Decline button works
[ ] Call connects in < 3 seconds
[ ] Both video/audio transmitting
[ ] No black screen
[ ] No audio feedback loop

🟢 OUTGOING CALL:
[ ] Select contact to call
[ ] Ringing screen appears
[ ] Other device shows incoming call
[ ] Accept on other device connects
[ ] Can see video both ways
[ ] Can hear audio both ways
[ ] HQ voice/video quality
[ ] No lag or delay

🟢 DURING CALL:
[ ] Can toggle video on/off
[ ] Can toggle audio on/off (mute)
[ ] Can switch camera (front/back)
[ ] Volume controls work
[ ] Speaker toggle works
[ ] End call button responsive
[ ] Can see call duration
[ ] Connection quality indicator visible
```

### Translation Feature (10 minutes)

```
🟢 TRANSLATION SETTINGS:
[ ] Can select translation language
[ ] 15 languages available
[ ] Selection persists
[ ] UI doesn't freeze during selection

🟢 REAL-TIME TRANSLATION:
[ ] Incoming audio transcribed
[ ] Text appears within 300ms
[ ] Translation appears within 500ms
[ ] Translation accuracy acceptable
[ ] Can read or hear translation
[ ] Switching languages works
[ ] No crashes with long messages

🟢 PERFORMANCE:
[ ] Translation doesn't slow call
[ ] Video quality doesn't degrade
[ ] CPU usage reasonable
[ ] Battery drain acceptable
```

### UI Quality (5 minutes)

```
🟢 SCREEN ORIENTATIONS:
[ ] Portrait mode works
[ ] Landscape mode works
[ ] Rotation smooth (no freeze)
[ ] UI adapts to screen size
[ ] Buttons repositioned correctly

🟢 TABLET SUPPORT (if available):
[ ] App uses full screen width
[ ] UI scales nicely
[ ] No wasted space
[ ] Controls appropriately positioned

🟢 DARK MODE:
[ ] App respects system dark mode setting
[ ] All text readable on dark background
[ ] Images visible
[ ] Buttons/interactive elements clear

🟢 TEXT SCALING:
[ ] Can increase system font size in Settings (120%, 150%)
[ ] App text scales appropriately
[ ] No overlapping text
[ ] Layout doesn't break
```

### Error Handling (5 minutes)

```
🟢 NETWORK ERRORS:
[ ] Turn off Wi-Fi
[ ] App shows offline notification
[ ] Calls don't attempt (graceful failure)
[ ] Reconnect auto-retry
[ ] Turn Wi-Fi back on → auto-reconnect

🟢 LOW STORAGE (if testable):
[ ] App shows warning if storage < 50MB
[ ] App shuts down gracefully if storage full
[ ] No data corruption

🟢 BATTERY SAVER MODE:
[ ] Enable battery saver
[ ] App runs (may have reduced features)
[ ] No crash on enable/disable
[ ] Call quality reduced if needed
```

### Settings & Profile (3 minutes)

```
🟢 PROFILE EDITING:
[ ] Can edit name
[ ] Can upload/change avatar
[ ] Changes save to backend
[ ] Avatar displays correctly

🟢 SECURITY SETTINGS:
[ ] Password change option visible
[ ] Current password verification works
[ ] New password validated
[ ] Can set 2FA if available
[ ] Session management option

🟢 NOTIFICATION SETTINGS:
[ ] Can toggle call notifications
[ ] Can toggle message notifications
[ ] Changes persist
[ ] Notification(s) respect settings

🟢 PRIVACY SETTINGS:
[ ] Can view privacy policy
[ ] Can view terms of service
[ ] Can access data deletion
[ ] Can export personal data (if GDPR required)
```

### Logout & Session (2 minutes)

```
🟢 LOGOUT:
[ ] Logout button visible in settings
[ ] Logout clears all data from device
[ ] Logout clears session token
[ ] Cannot use app after logout
[ ] Must re-login to continue

🟢 SESSION TIMEOUT:
[ ] App logs out after 30 min inactivity
[ ] Warning shown before timeout
[ ] Can extend session or logout
```

---

## 🐛 PART 5: CRASH & STABILITY TESTING

### Stress Tests

```
🟢 RAPID TAPS:
[ ] Tap buttons rapidly (10+ times/second)
[ ] App doesn't crash
[ ] Doesn't execute action multiple times
[ ] Shows loading state only once

🟢 RAPID ORIENTATION CHANGES:
[ ] Rotate device rapidly (portrait ↔ landscape 10x)
[ ] App doesn't crash
[ ] No memory leaks
[ ] UI redraws correctly

🟢 LONG RUNNING:
[ ] Keep app open for 30 minutes
[ ] Make multiple calls
[ ] Switch screens repeatedly
[ ] App doesn't slow down
[ ] No memory leaks
[ ] Battery reasonable

🟢 LOW MEMORY:
[ ] Enable memory limit in developer options
[ ] Force low memory scenario
[ ] App handles gracefully
[ ] Doesn't immediately crash
[ ] Shows error message
```

### Crash Monitoring

```
Check LogCat for crashes:

adb logcat | grep -i "fatal\|crash\|exception"

Expected: No output (no crashes)

If crashes occur:
✅ Document full stack trace
✅ Note how to reproduce
✅ Fix before Play Store submission
```

---

## 📊 PART 6: PERFORMANCE METRICS

### Startup Time

```
Measure:
adb shell am start -W com.Mindwhile.neuratalk/.MainActivity

Look for "TotalTime: XXXXX"

Success: < 3000ms (3 seconds)
Acceptable: 3-5 seconds
Poor: > 5 seconds

Breakdown:
Cold start (first launch): ~4-5 seconds
Warm start (after Home): ~2-3 seconds
Hot start (back from recent): ~1-2 seconds
```

### Call Connect Time

```
Measure: Time from "Call" button to showing "Connected"

Success: < 2 seconds
Acceptable: 2-3 seconds
Poor: > 3 seconds

Network Factors:
✅ Wi-Fi (2.4GHz): ~1.5 seconds
✅ Wi-Fi (5GHz): ~1.2 seconds
✅ 4G LTE: ~1.8 seconds
⚠️ 3G: ~2.5-3 seconds
```

### Battery Drain

```
Measure: Battery % lost during 30-minute call

Success: < 10% drain
Acceptable: 10-15% drain
Poor: > 15% drain

Factors:
✅ Screen on: ~60% drain over 30min (video call)
✅ Screen off: ~10-15% drain (audio call)
✅ With translation: +5-10% drain
✅ High quality video: +5% drain
```

### Network Usage

```
Measure: Data consumed during 10-minute call

Success: < 20MB
Acceptable: 20-30MB
Poor: > 30MB

Connection Type:
✅ Audio only: 3-5 MB per 10min
✅ Video 480p: 15-20 MB per 10min
✅ Video 720p: 25-35 MB per 10min
✅ With translation: +5-10 MB

Transfer Breakdown:
- Voice: ~100-200 kbps
- HD Video: ~1-2 mbps
- Translation data: ~1-5 kbps
```

### Memory Usage

```
Measure: RAM used during call

adb shell dumpsys meminfo com.Mindwhile.neuratalk

Look for: "Total Pixels:" line and memory sections

Success: < 400MB during call
Acceptable: 400-500MB
Poor: > 500MB

Expected:
Idle app: ~80-100MB
After login: ~120-150MB
During call: ~300-400MB
After multiple calls: ~350-450MB
```

---

## ✨ PART 7: INTERNATIONAL STANDARDS COMPLIANCE

### Google Play Console Requirements

```
MANDATORY REQUIREMENTS:

Target SDK: 34+ ✅
Minimum SDK: 21+ ✅ (we use 24)
64-bit support: arm64-v8a ✅
All content rating flags ✅
Privacy policy link ✅
Secure HTTPS only ✅

CRITICAL BLOCKERS (will be rejected):
❌ Hardcoded API keys
❌ Malware detected by Google Play Protect
❌ Impersonation or fraud
❌ Unauthorized collection of personal data
❌ Dangerous permissions without justification
```

### WCAG 2.1 Accessibility Compliance

```
PERCEIVABLE:
✅ Color contrast > 4.5:1 for text
✅ No color-only information (also use icons)
✅ Images have alt text where applicable
✅ Videos have captions

OPERABLE:
✅ All controls via keyboard
✅ Touch targets minimum 48x48 dp
✅ No flashing > 3 per second
✅ Skip links for repetitive content
✅ Clear focus indicators

UNDERSTANDABLE:
✅ Simple language (no jargon)
✅ Consistent navigation
✅ Error messages clear
✅ Instructions available

ROBUST:
✅ No deprecated APIs
✅ Correct XML structure
✅ Valid HTML (web components)
```

### Regional Compliance

```
INDIA (DPDP Act):
✅ Data only collected with consent
✅ Privacy policy linked in app
✅ User can export personal data
✅ User can request deletion
✅ No unlawful tracking
⚠️ Parents must consent for users < 18

US (COPPA):
✅ If targeting < 13 years: ParentalGates
✅ Limited data collection for kids
✅ No behavioral advertising
✅ Parents can access child data

EU (GDPR):
✅ Privacy policy linked and accepted
✅ Legitimate interest documented
✅ User can delete account
✅ User can export data
✅ Right to be forgotten respected
```

---

## 🎯 SIGN-OFF CHECKLIST

### Before Play Store Submission

```
[ ] APK file exists and is 45-60MB
[ ] APK signature verified
[ ] Installed on 5+ devices/emulators successfully
[ ] All permissions granted and handled
[ ] App launches in < 3 seconds
[ ] No crashes in 30+ minute testing
[ ] Login/authentication working
[ ] At least 1 test call successful
[ ] Translation feature working
[ ] UI renders correctly (no overlaps)
[ ] Dark mode working
[ ] Permissions dialogs shown correctly
[ ] Error handling working (no infinite spinners)
[ ] Battery drain acceptable
[ ] Network errors handled
[ ] WCAG accessibility baseline met
[ ] Privacy policy linked
[ ] Terms of Service linked
[ ] Support email functioning
[ ] Firebase Crashlytics configured
[ ] Firebase Analytics working
```

### Final Verification

```
✅ Team approval obtained
✅ Legal review completed
✅ Security audit passed
✅ Performance tested
✅ Internationalization verified
✅ Ready for production
```

---

## 📝 TEST REPORT TEMPLATE

Save as: `APK_TEST_REPORT_YYYY-MM-DD.md`

```markdown
# APK Testing Report

**Date**: YYYY-MM-DD
**Tester**: [Name]
**APK Version**: 1.0.0 (Build 1)
**Device Tested**: [Model] Android [Version]

## File Verification
- Size: ____ MB (Target: 45-60 MB)
- Signature: ✅ Valid / ❌ Invalid
- Installation: ✅ Success / ❌ Failed

## Functional Testing
- Launch: ✅ Pass / ⚠️ Slow / ❌ Fail
- Authentication: ✅ Pass / ❌ Fail
- Permissions: ✅ Pass / ❌ Fail
- Calls: ✅ Pass / ⚠️ Issues / ❌ Fail
- Translation: ✅ Pass / ⚠️ Slow / ❌ Fail

## Performance
- Startup: ____ ms
- Call Connect: ____ ms
- Battery (30min call): ____ % drain
- Memory: ____ MB peak

## Issues Found
1. [Issue 1]
2. [Issue 2]

## Recommendation
☐ Ready for Play Store
☐ Fix issues first
☐ Needs redesign

Signed: __________ Date: __________
```

---

## ⏭️ NEXT STEPS

Once APK is ready:

1. ✅ Run Part 1-7 above
2. ✅ Document any issues
3. ✅ Fix critical issues
4. ✅ Submit test report
5. ✅ Proceed to Play Store submission
6. ✅ Create store listing
7. ✅ Upload APK & graphics
8. ✅ Submit for review
9. ✅ Monitor for approval
10. ✅ Launch to 5% of users (staged rollout)

---

**Status**: Ready to execute once APK built 🔨  
**Estimated Time**: 45 minutes  
**Success Criteria**: All sections ✅ Pass

