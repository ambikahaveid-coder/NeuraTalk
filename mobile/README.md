# NeuraTalk Mobile App

React Native mobile application for NeuraTalk - Voice AI Communication Platform.

## Features

- **SIM-to-SIM Call Bridging**: Route real phone calls through NeuraTalk for translation
- **Real-Time Translation**: Live voice translation during calls
- **Emotion Preservation**: Emotional tone is preserved in translations
- **Native Integration**: Android TelecomManager/InCallService, iOS CallKit

## Architecture

```
mobile/
├── src/
│   ├── components/          # Reusable UI components
│   │   ├── EmotionIndicator.tsx
│   │   └── TranslationSubtitles.tsx
│   ├── screens/             # App screens
│   │   ├── LoginScreen.tsx
│   │   ├── HomeScreen.tsx
│   │   ├── CallScreen.tsx
│   │   └── ConsentScreen.tsx
│   ├── hooks/               # Custom React hooks
│   │   ├── useAuth.ts
│   │   └── useCall.ts
│   ├── services/            # API and service layer
│   │   ├── api.ts
│   │   └── signaling.ts
│   ├── native/              # Native module TypeScript interfaces
│   │   └── telephony.ts
│   └── types/               # TypeScript type definitions
│       └── index.ts
├── android/                 # Android native code
│   └── app/src/main/java/com/neuratalk/telephony/
│       ├── NeuraTalkTelephonyModule.java
│       └── NeuraTalkTelephonyPackage.java
├── ios/                     # iOS native code
│   └── NeuraTalk/
│       ├── NeuraTalkTelephony.swift
│       └── NeuraTalkTelephony.m
├── App.tsx                  # Main app entry point
├── package.json
└── tsconfig.json
```

## Native Modules

### Android (TelecomManager + InCallService)

The Android native module provides:
- `initialize()`: Initialize the telephony module
- `showIncomingCallNotification()`: Display incoming call UI
- `answerCall()`: Answer an incoming call
- `endCall()`: End an active call
- `startOutgoingCall()`: Initiate an outgoing call
- `setMuted()`: Toggle mute state
- `setSpeaker()`: Toggle speakerphone
- `setAudioRoute()`: Change audio routing (earpiece/speaker/bluetooth)
- `getPhoneAccounts()`: Get available phone accounts

### iOS (CallKit)

The iOS native module provides:
- `initialize()`: Initialize CallKit provider
- `reportIncomingCall()`: Report incoming call to CallKit
- `answerCall()`: Answer via CallKit
- `endCall()`: End via CallKit
- `startOutgoingCall()`: Start outgoing call with CallKit UI
- `setMuted()`: Toggle mute
- `setSpeaker()`: Toggle speaker
- `setAudioRoute()`: Audio routing

## Setup

### Prerequisites

- Node.js 18+
- React Native CLI
- Xcode 15+ (for iOS)
- Android Studio (for Android)

### Installation

```bash
cd mobile
npm install

# iOS
cd ios && pod install && cd ..

# Android - no additional setup needed
```

### Running

```bash
# iOS
npm run ios

# Android
npm run android
```

## API Integration

The app connects to the NeuraTalk backend via:
- REST API for auth, consent, device registration
- WebSocket signaling for call coordination

Configure the API URL in `src/services/api.ts`.

## Permissions

### Android

```xml
<uses-permission android:name="android.permission.CALL_PHONE" />
<uses-permission android:name="android.permission.READ_PHONE_STATE" />
<uses-permission android:name="android.permission.RECORD_AUDIO" />
<uses-permission android:name="android.permission.FOREGROUND_SERVICE" />
```

### iOS

```
NSMicrophoneUsageDescription
NSCameraUsageDescription (if video)
```

## Privacy & Compliance

- All call processing uses self-hosted infrastructure
- No third-party telecom services (no Twilio/Vonage)
- User consent required before first call
- Call content not stored without explicit consent
- GDPR/telecom regulation compliant

## License

Proprietary - 2026 Mindwhile It Solutions Pvt Ltd
