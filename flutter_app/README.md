# NeuraTalk Flutter App

Cross-platform mobile application for NeuraTalk - Voice AI Communication Platform with Real-Time Translation.

Built with Flutter for iOS & Android from a single codebase.

## Features

- **OTP Login** - Passwordless phone authentication via Firebase
- **AI Voice Chat** - Talk to AI assistant in 20+ languages
- **Video Translation Calls** - Real-time video calls with translation overlay
- **Voice Calls with Translation** - Real-time voice translation during calls
- **WebRTC Support** - Peer-to-peer video and audio calls
- **Native Call Integration** - CallKit (iOS) & TelecomManager (Android)
- **Emotion Preservation** - Emotional tone preserved in translations
- **Offline Capable** - Works with cached data when offline

## Supported Languages

English, Spanish, French, German, Italian, Portuguese, Russian, Japanese, Korean, Chinese, Arabic, Hindi, Telugu, Tamil, Kannada, Malayalam, Marathi, Gujarati, Bengali, Punjabi

## Setup

### Prerequisites

- Flutter SDK 3.0+
- Dart 3.0+
- Xcode 15+ (for iOS)
- Android Studio (for Android)

### Installation

```bash
cd flutter_app

# Install dependencies
flutter pub get

# Run on iOS
flutter run -d ios

# Run on Android
flutter run -d android

# Build release APK
flutter build apk --release

# Build iOS IPA
flutter build ios --release
```

### Configuration

1. Update the API base URL in `lib/services/api_service.dart`:
```dart
static const String baseUrl = 'https://neuratalk.in';
```

2. For production, configure:
   - Firebase for Phone Auth
   - Push notifications
   - App signing keys

## Project Structure

```
flutter_app/
â”œâ”€â”€ lib/
â”‚   â”œâ”€â”€ main.dart           # App entry point & theme
â”‚   â”œâ”€â”€ models/             # Data models
â”‚   â”‚   â””â”€â”€ user.dart
â”‚   â”œâ”€â”€ screens/            # App screens
â”‚   â”‚   â”œâ”€â”€ login_screen.dart
â”‚   â”‚   â”œâ”€â”€ home_screen.dart
â”‚   â”‚   â””â”€â”€ call_screen.dart
â”‚   â”œâ”€â”€ services/           # API & business logic
â”‚   â”‚   â”œâ”€â”€ api_service.dart
â”‚   â”‚   â”œâ”€â”€ auth_service.dart
â”‚   â”‚   â””â”€â”€ audio_service.dart
â”‚   â””â”€â”€ widgets/            # Reusable widgets
â”‚       â””â”€â”€ waveform_visualizer.dart
â”œâ”€â”€ pubspec.yaml            # Dependencies
â””â”€â”€ README.md
```

## Dependencies

| Package | Purpose |
|---------|---------|
| provider | State management |
| http | API requests |
| flutter_secure_storage | Token storage |
| record | Audio recording |
| just_audio | Audio playback |
| permission_handler | Runtime permissions |
| flutter_callkit_incoming | iOS CallKit |
| google_fonts | Typography |
| flutter_animate | Animations |

## API Endpoints

The app connects to your NeuraTalk backend:

- `POST /api/auth/send-otp` - Send OTP
- `POST /api/auth/verify-otp` - Verify OTP & get token
- `GET /api/auth/me` - Get current user
- `POST /api/conversations` - Create conversation
- `POST /api/audio/voice-chat` - AI voice chat
- `POST /api/audio/speech` - Text-to-speech
- `POST /api/calls/initiate` - Initiate phone call
- `POST /api/translate/speech` - Translate speech

## Permissions

### Android (android/app/src/main/AndroidManifest.xml)
```xml
<uses-permission android:name="android.permission.INTERNET"/>
<uses-permission android:name="android.permission.RECORD_AUDIO"/>
<uses-permission android:name="android.permission.CALL_PHONE"/>
<uses-permission android:name="android.permission.READ_PHONE_STATE"/>
```

### iOS (ios/Runner/Info.plist)
```xml
<key>NSMicrophoneUsageDescription</key>
<string>NeuraTalk needs microphone access for voice chat</string>
```

## Building for Production

### Android

```bash
# Generate keystore (one-time)
keytool -genkey -v -keystore neuratalk.keystore -alias neuratalk -keyalg RSA -keysize 2048 -validity 10000

# Build release APK
flutter build apk --release

# Build release AAB (for Play Store)
flutter build appbundle --release
```

### iOS

```bash
# Build for App Store
flutter build ios --release

# Open in Xcode for archive
open ios/Runner.xcworkspace
```

## New Services Added

### WebRTC Service (`lib/services/webrtc_service.dart`)
- Full WebRTC implementation for video/voice calls
- Automatic ICE candidate handling
- Camera switching support
- Mute/unmute controls

### Translation Service (`lib/services/translation_service.dart`)
- Real-time speech translation
- 20+ language support
- Text-to-speech integration
- Language auto-detection

### Video Call Screen (`lib/screens/video_call_screen.dart`)
- Full-screen video call UI
- Translation overlay during calls
- Push-to-talk for translation
- Camera controls

## Environment Configuration

Update `lib/services/api_service.dart` with your backend URL:

```dart
static const String baseUrl = 'https://neuratalk.in';
```

## Firebase Setup

1. Create a Firebase project at https://console.firebase.google.com
2. Enable Phone Authentication
3. Download `google-services.json` (Android) and `GoogleService-Info.plist` (iOS)
4. Place files in respective platform directories

## License

Proprietary - 2026 Mindwhile IT Solutions Pvt Ltd


