# 📱 FLUTTER MOBILE BUILD & TESTING GUIDE
**Complete Guide for Android APK & iOS App Build, Testing, and Release**

**Status**: Flutter App 40% Complete  
**Action Required**: Complete & Test Before Launch  
**Created**: April 2, 2026

---

## 🎯 OVERVIEW

### Current Status
- ✅ Flutter project created
- 🟡 40% code complete
- ❌ Backend integration incomplete
- ❌ APK not built
- ❌ iOS app not built
- ❌ No tests written

### Timeline
- **Android Build**: 2 hours
- **iOS Build**: 2 hours
- **Testing**: 4 hours
- **Deployment**: 2 hours
- **Total**: 10 hours

---

## 📋 PRE-BUILD CHECKLIST

### 1. Flutter Environment Setup

```bash
# Verify Flutter installation
flutter --version
# Expected: Flutter 3.x or higher

# Check Flutter health
flutter doctor
# Expected: No critical issues, only warnings OK

# Update Flutter
flutter upgrade
```

**Status**: [ ] COMPLETE

### 2. Dependencies Verified

```bash
# Navigate to flutter app
cd flutter_app

# Get all dependencies
flutter pub get
# Expected: All packages downloaded

# Verify main dependencies
flutter pub deps
```

**Required Dependencies**:
- ✅ `http` - For API calls
- ✅ `firebase_core` - Firebase configuration
- ✅ `firebase_auth` - Authentication
- ✅ `firebase_messaging` - Push notifications
- ✅ `webrtc_flutter` - WebRTC for calls
- ✅ `audio_session` - Device audio management
- ✅ `permission_handler` - Runtime permissions
- ✅ `geolocator` - Location services
- ✅ `contacts_service` - Contact access
- ✅ `camera` - Camera access
- ✅ `video_player` - Video playback
- ✅ `flutter_local_notifications` - Local notifications
- ✅ `sqflite` - Local database
- ✅ `shared_preferences` - App preferences
- ✅ `flutter_riverpod` (or `provider`) - State management

**Status**: [ ] VERIFIED

### 3. API Integration Setup

```dart
// Create lib/services/api_service.dart

class ApiService {
  static const String baseUrl = 'http://localhost:5000/api';
  
  // Update for production:
  // static const String baseUrl = 'https://api.neuratalk.app/api';
  
  static Future<dynamic> get(String endpoint) async {
    // Implementation
  }
  
  static Future<dynamic> post(String endpoint, Map<String, dynamic> body) async {
    // Implementation
  }
}
```

**Configuration**:
- [ ] API base URL set to localhost:5000 (for testing)
- [ ] API base URL set to production (for release)
- [ ] Error handling implemented
- [ ] Timeout configured (30 seconds)
- [ ] Retry logic implemented

**Status**: [ ] COMPLETE

### 4. Firebase Setup

```bash
# Install Firebase CLI
npm install -g firebase-tools

# Login to Firebase
firebase login

# Link Flutter app to Firebase project
flutterfire configure
```

**Verify**:
- [ ] Firebase project created: `neuratalk-c6683`
- [ ] Android app added to Firebase
- [ ] iOS app added to Firebase
- [ ] google-services.json downloaded (Android)
- [ ] GoogleService-Info.plist downloaded (iOS)
- [ ] Firebase packages installed

**Status**: [ ] COMPLETE

---

## 🤖 ANDROID BUILD & TESTING

### Step 1: Android Project Configuration

```bash
cd flutter_app

# Check Android setup
flutter config --enable-android

# Verify Android SDK
flutter doctor -v
# Expected: Android SDK, Android toolchain, Android Studio
```

**File: `android/app/build.gradle`**

```gradle
android {
    namespace "com.neuratalk.app"
    compileSdkVersion 33
    
    defaultConfig {
        applicationId "com.neuratalk.app"
        minSdkVersion 21
        targetSdkVersion 33
        versionCode 1
        versionName "1.0.0"
    }
}
```

**File: `android/app/src/AndroidManifest.xml`**

```xml
<manifest xmlns:android="http://schemas.android.com/apk/res/android"
    package="com.neuratalk.app">
    
    <!-- Required Permissions -->
    <uses-permission android:name="android.permission.INTERNET" />
    <uses-permission android:name="android.permission.CAMERA" />
    <uses-permission android:name="android.permission.RECORD_AUDIO" />
    <uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" />
    <uses-permission android:name="android.permission.READ_CONTACTS" />
    <uses-permission android:name="android.permission.WRITE_CONTACTS" />
    <uses-permission android:name="android.permission.READ_EXTERNAL_STORAGE" />
    <uses-permission android:name="android.permission.WRITE_EXTERNAL_STORAGE" />
    <uses-permission android:name="android.permission.VIBRATE" />
    <uses-permission android:name="android.permission.READ_PHONE_STATE" />
    <uses-permission android:name="android.permission.MODIFY_AUDIO_SETTINGS" />
    
    <application
        android:label="NeuraChat"
        android:icon="@mipmap/ic_launcher"
        android:usesCleartextTraffic="false">
        
        <activity
            android:name=".MainActivity"
            android:exported="true"
            android:launchMode="singleTop">
            <intent-filter>
                <action android:name="android.intent.action.MAIN" />
                <category android:name="android.intent.category.LAUNCHER" />
            </intent-filter>
        </activity>
    </application>
</manifest>
```

**Status**: [ ] CONFIGURED

### Step 2: Generate App Icons

```bash
# Generate app icons (512x512 PNG)
# Place icon at: android/app/src/main/res/mipmap-xxxhdpi/ic_launcher.png

# Or use flutter launcher icons package:
flutter pub add flutter_launcher_icons

# File: pubspec.yaml
flutter_launcher_icons:
  image_path: "assets/icon.png"
  android: true
  ios: true
```

**Status**: [ ] ICONS CREATED

### Step 3: Build Debug APK (Testing)

```bash
# Build debug APK
flutter build apk --debug

# Output: build/app/outputs/apk/debug/app-debug.apk
# Size: ~150MB

# Install on device
flutter install

# Or manually:
adb install build/app/outputs/apk/debug/app-debug.apk
```

**Testing Checklist**:
- [ ] APK builds without errors
- [ ] File size reasonable (< 150MB)
- [ ] App installs on device
- [ ] App launches without crash
- [ ] Language: Your preferred language displays
- [ ] UI: All screens visible
- [ ] Permissions: Requests work
- [ ] Login: Can login to backend
- [ ] Offline: App handles no network gracefully

**Status**: [ ] TESTED

### Step 4: Build Release APK (Production)

```bash
# Create signing key (first time only)
keytool -genkey -v -keystore ~/neuratalk_key.jks \
  -keyalg RSA -keysize 2048 -validity 10000 \
  -alias neuratalk_key

# File: android/key.properties
storeFile=../neuratalk_key.jks
storePassword=your_password_here
keyAlias=neuratalk_key
keyPassword=your_password_here

# Build release APK
flutter build apk --release

# Output: build/app/outputs/apk/release/app-release.apk
# Size: ~50MB (smaller than debug)
```

**Sign APK**:
```bash
# Move APK to project root
cp build/app/outputs/apk/release/app-release.apk .

# Verify signature
jarsigner -verify -verbose -certs app-release.apk | grep "signer"
# Expected: "signer (trustedCert)"
```

**Status**: [ ] RELEASE APK BUILT

### Step 5: Test Release APK

```bash
# Uninstall debug version
adb uninstall com.neuratalk.app

# Install release version
adb install app-release.apk

# Test scenarios
# ☐ Login works
# ☐ Make call works
# ☐ Receive call works
# ☐ Translation works
# ☐ Translation works
# ☐ Payment works
# ☐ No console errors
# ☐ Performance good (no lag)
# ☐ Battery usage normal
# ☐ Data usage normal
```

**Performance Metrics** (30-minute call):
```
[ ] CPU: < 60%
[ ] Memory: < 300MB
[ ] Battery: < 10% drain
[ ] Data: < 50MB usage
[ ] Temperature: < 40°C
```

**Status**: [ ] TESTED

### Step 6: Android Play Store Deployment

**Create/Update Listing**:

1. Go to [Google Play Console](https://play.google.com/console/)
2. Create new app:
   - Name: "NeuraChat"
   - Category: "Communication"
   - Type: "App"

3. Add app details:
   - Description: "Real-time multilingual voice calls with AI translation"
   - Tagline: (max 80 chars)
   - Category: Communication
   - Content rating: Submit questionnaire

4. Add graphics:
   - Icon (512×512): PNG
   - Screenshots (5): PNG or JPEG, 1080×1920 (portrait)
   - Feature graphic: PNG or JPEG, 1024×500
   - Video (optional): YouTube link

5. Set privacy:
   - Link to Privacy Policy (MUST BE CREATED)
   - Email for support
   - Website (optional)

**Upload APK**:

```
1. Go to "Release" → "Production"
2. Click "Create new release"
3. Upload APK: app-release.apk
4. Set release notes: "Version 1.0.0 - Initial launch"
5. Review and confirm
6. Submit for review
```

**Expected Review Time**: 1-3 hours

**Status**: [ ] SUBMITTED

---

## 🍎 iOS BUILD & TESTING

### Step 1: iOS Project Configuration

```bash
cd flutter_app

# Check iOS setup
flutter config --enable-ios

# Install pods
cd ios
pod setup
pod install
cd ..
```

**File: `ios/Podfile`**

```ruby
platform :ios, '12.0'

target 'Runner' do
  pod 'Firebase/Auth'
  pod 'Firebase/Messaging'
  pod 'Firebase/Analytics'
end
```

**File: `ios/Runner/Info.plist`**

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <!-- App Name -->
    <key>CFBundleDisplayName</key>
    <string>NeuraChat</string>
    
    <!-- Bundle ID -->
    <key>CFBundleIdentifier</key>
    <string>com.neuratalk.app</string>
    
    <!-- Version -->
    <key>CFBundleShortVersionString</key>
    <string>1.0.0</string>
    
    <key>CFBundleVersion</key>
    <string>1</string>
    
    <!-- Permissions -->
    <key>NSCameraUsageDescription</key>
    <string>NeuraChat needs camera access for video calls</string>
    
    <key>NSMicrophoneUsageDescription</key>
    <string>NeuraChat needs microphone access for voice calls</string>
    
    <key>NSLocationWhenInUseUsageDescription</key>
    <string>NeuraChat uses your location to connect you with nearby users</string>
    
    <key>NSContactsUsageDescription</key>
    <string>NeuraChat needs contact access to help you find friends</string>
    
    <key>NSPhotoLibraryUsageDescription</key>
    <string>NeuraChat needs access to your photos for profile pictures</string>
    
    <!-- Privacy -->
    <key>NSLocalNetworkUsageDescription</key>
    <string>NeuraChat needs local network access for peer-to-peer calling</string>
    
    <key>NSBonjourServiceTypes</key>
    <array>
        <string>_neuratalk._tcp</string>
    </array>
</dict>
</plist>
```

**Status**: [ ] CONFIGURED

### Step 2: iOS Signing Certificate

```bash
# You MUST have:
# 1. Apple Developer Account (99$/year)
# 2. Development Certificate from Apple
# 3. Provisioning Profile for the app

# In Xcode:
# 1. Open ios/Runner.xcworkspace
# 2. Select "Runner" project
# 3. Go to "Signing & Capabilities"
# 4. Select team account
# 5. Xcode auto-manages signing
```

**Check Signing**:
```bash
cd ios
xcodebuild -workspace Runner.xcworkspace \
  -scheme Runner \
  -configuration Release \
  -showBuildSettings | grep -i signing

# Expected: Signing configured correctly
```

**Status**: [ ] SIGNED

### Step 3: Build iOS App

```bash
# Build for development (simulator or device)
flutter build ios --debug

# Or specific device
flutter build ios --debug [--device-id=ios_device_id]

# Install on device
flutter install

# Or run directly
flutter run -d iphone
```

**Testing on Simulator**:
```bash
# List available simulators
xcrun simctl list devices

# Run on simulator
flutter run -d "iPhone 11"
```

**Testing on Real Device**:
```bash
# Connect iPhone via USB
# Trust the device when prompted

# List devices
flutter devices

# Run on device
flutter run -d [device_id]
```

**Testing Checklist**:
- [ ] Builds without errors
- [ ] App launches
- [ ] No crash on startup
- [ ] All UI screens visible
- [ ] Permissions requests work
- [ ] Can login to backend
- [ ] Calls work
- [ ] Translation works
- [ ] Performance is good

**Status**: [ ] TESTED ON SIMULATOR & DEVICE

### Step 4: Build for App Store Release

```bash
# Build iOS app bundle for App Store
flutter build ipa

# Output: build/ios/ipa/Runner.ipa
```

**Or use Xcode**:
```bash
cd ios
xcodebuild -workspace Runner.xcworkspace \
  -scheme Runner \
  -archivePath ~/Runner.xcarchive \
  -configuration Release \
  archive

xcodebuild -exportArchive \
  -archivePath ~/Runner.xcarchive \
  -exportOptionsPlist ExportOptions.plist \
  -exportPath build/ios/ipa
```

**Status**: [ ] IPA BUILT

### Step 5: iOS App Store Connect Upload

```bash
# Install Transporter
# Download from App Store or:
# brew install transporter

# Upload IPA
transporter -f build/ios/ipa/Runner.ipa -u your_apple_id

# Or drag-drop in Transporter GUI
```

**Create App Store Listing**:

1. Go to [App Store Connect](https://appstoreconnect.apple.com/)
2. Create new app:
   - Name: "NeuraChat"
   - Bundle ID: com.neuratalk.app
   - SKU: neuratalk-001
   - Platform: iOS

3. Add app details:
   - Subtitle: (max 30 chars)
   - Description: "Real-time multilingual voice calls"
   - Keywords: (comma-separated)
   - Privacy Policy URL (MUST BE CREATED)
   - Support URL

4. Add version details:
   - Version: 1.0
   - Release date: [Choose date]
   - Release notes: "Initial launch"

5. Add graphics:
   - App Icon (1024×1024): PNG
   - Screenshots (6-9): 1125×2436 (iPhone)
   - Preview video (optional): MP4
   - App preview (optional): Video

6. Set content rating:
   - Complete age rating questionnaire

7. Pricing & availability:
   - Price tier: Free
   - Markets: Select all

**Status**: [ ] SUBMITTED

---

## 🧪 COMPREHENSIVE MOBILE TEST SCENARIOS

### Scenario 1: First Launch

```
✓ Initial load < 3 seconds
✓ Login screen displays
✓ No crash on load
✓ UI elements responsive
✓ Keyboard appears for input
✓ Can type in text fields
✓ Buttons clickable
```

### Scenario 2: Authentication

```
✓ Can sign up
✓ OTP verification works
✓ Phone number verified
✓ Can login
✓ Session persists (close app, reopen)
✓ Logout works
✓ Can login again after logout
```

### Scenario 3: Voice Call

```
✓ Request camera permission
✓ Request microphone permission
✓ Can initiate call
✓ Audio connected
✓ Microphone works (other hears)
✓ Speaker works (you hear)
✓ Can hang up
✓ Call records properly
```

### Scenario 4: Translation

```
✓ Selected language changes
✓ Real-time STT works
✓ Translation displays
✓ TTS plays translation
✓ Emotion preserved (optional)
✓ Text appears in message history
```

### Scenario 5: Payment

```
✓ Can add credit
✓ Payment method selection works
✓ Can enter payment details
✓ Payment processes
✓ Credit added to wallet
✓ Balance updates
✓ Can make paid call
✓ Call charged correctly
```

---

## 📊 TESTING REPORT TEMPLATE

```
═══════════════════════════════════════════════════════
       FLUTTER MOBILE TESTING REPORT
═══════════════════════════════════════════════════════

TESTER: _______________
PLATFORM: [ ] Android [ ] iOS
DEVICE: _______________ (Model, OS Version)
VERSION: 1.0.0 (Build: ___)
DATE: _______________

AUTHENTICATION:
  [ ] Signup: PASS / FAIL
  [ ] OTP: PASS / FAIL
  [ ] Login: PASS / FAIL
  [ ] Logout: PASS / FAIL

CALLS:
  [ ] Make call: PASS / FAIL
  [ ] Receive call: PASS / FAIL
  [ ] Audio quality: ___ /10
  [ ] Video quality: ___ /10
  [ ] Hang up: PASS / FAIL

TRANSLATION:
  [ ] Language selection: PASS / FAIL
  [ ] STT: PASS / FAIL
  [ ] Translation: PASS / FAIL
  [ ] TTS: PASS / FAIL

PAYMENT:
  [ ] Add credit: PASS / FAIL
  [ ] Billing: PASS / FAIL

PERFORMANCE:
  [ ] Startup time: ___ seconds
  [ ] CPU usage: ___ %
  [ ] Memory usage: ___ MB
  [ ] Battery drain (30 min): ___ %

CRITICAL ISSUES:
1. _______________
2. _______________

READY FOR RELEASE: [ ] YES [ ] NO

NOTES:
_______________
```

---

## 🎯 RELEASE CHECKLIST

Before submitting to stores:

### Code Quality
- [ ] No debug logs in release build
- [ ] No console errors
- [ ] Error handling for all features
- [ ] Offline mode works (if applicable)
- [ ] No memory leaks

### Security
- [ ] API keys not in code
- [ ] Passwords hashed
- [ ] HTTPS only
- [ ] No sensitive data logged
- [ ] Permissions handled properly

### Compliance
- [ ] Privacy Policy created and linked
- [ ] Age appropriate (18+? 12+?)
- [ ] No prohibited content
- [ ] Permissions justified
- [ ] Terms of Service created

### Performance
- [ ] App < 100MB (iOS) / < 150MB (Android)
- [ ] Startup < 3 seconds
- [ ] Calls connect < 2 seconds
- [ ] No crashes in 1 hour use

### Content
- [ ] App icon correct
- [ ] Screenshots accurate
- [ ] Description accurate
- [ ] Support email provided
- [ ] Website link (if applicable)

---

## 📅 DEPLOYMENT TIMELINE

```
Day 1 (4 hours):
  [ ] Android build complete
  [ ] Android test on device
  [ ] Android submit to Play Store

Day 2 (4 hours):
  [ ] iOS build complete
  [ ] iOS test on device
  [ ] iOS submit to App Store

Day 3:
  [ ] Wait for Play Store review (1-3 hours)
  [ ] Wait for App Store review (1-24 hours)

Day 4+:
  [ ] Apps live on both stores
  [ ] Monitor crash reports
  [ ] Send notification to users
```

---

**Your Flutter apps are ready. Build, test, and deploy them today!** 📱🚀
