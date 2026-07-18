# NeuraTalk Employee Guide

**Mindwhile It Solutions Pvt Ltd**
4th Floor, Mayuri Tech Park, Mangalagiri, Guntur, Andhra Pradesh 522503, India

Last Updated: February 2026

---

## Table of Contents

1. [Platform Overview](#1-platform-overview)
2. [System Architecture](#2-system-architecture)
3. [Role-Based Access Control](#3-role-based-access-control)
4. [Authentication Flow](#4-authentication-flow)
5. [Dashboards by Role](#5-dashboards-by-role)
6. [Call Types & Communication](#6-call-types--communication)
7. [Meetings Hub](#7-meetings-hub)
8. [Billing System](#8-billing-system)
9. [Voice Translation Pipeline](#9-voice-translation-pipeline)
10. [API Reference](#10-api-reference)
11. [Flutter Mobile App](#11-flutter-mobile-app)
12. [Environment Variables](#12-environment-variables)
13. [Troubleshooting](#13-troubleshooting)

---

## 1. Platform Overview

NeuraTalk is a voice-first AI communication platform that provides real-time speech-to-text, translation, and text-to-speech capabilities across 20+ languages. It serves both B2B (enterprise call centers, multi-tenant organizations) and B2C (individual consumer subscriptions) markets.

### Core Vision

- Build emotional trust through culturally aware, emotionally intelligent conversations
- Self-hosted infrastructure with zero dependency on third-party telecom or SaaS for core functions ("Dependency Zero Policy")
- Support mixed-language contexts with sub-second translation latency
- Available as a web app (PWA-enabled), and a Flutter mobile app for Android/iOS

### Key Capabilities

- Real-time voice translation during calls (SIM, video, face-to-face, AI assistant)
- Emotion detection and preservation across translations
- Voice cloning to preserve a speaker's natural voice in translated output
- WebRTC-based browser-to-browser and SIM-to-SIM call bridging
- Multi-tenant B2B platform with credit-based billing
- B2C subscriptions with time-based plans
- Enterprise compliance features (GDPR, DPDP Act, audit logging, IP whitelisting)

---

## 2. System Architecture

### Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18, TypeScript, Vite, Tailwind CSS, shadcn/ui, Framer Motion |
| Routing (FE) | Wouter |
| State Management | TanStack React Query v5 |
| Backend | Node.js 20, Express, TypeScript (ESM) |
| Database | PostgreSQL (Neon-backed) via Drizzle ORM |
| Scale Layer | Redis Pub/Sub for WebSockets |
| Build | esbuild (backend), Vite (frontend) |
| Real-time | Redis-backed WebSocket signaling (port 5001) |
| Media | WebRTC with Mandatory TURN (TCP/443 relay) |
| Payment | Razorpay (USD & INR) |
| Mobile | Flutter SDK 3.0+ |

### Deployment Topology

```
                +-----------------+
                |  Load Balancer  |
                | (DigitalOcean) |
                +--------+--------+
                         |
          +--------------+--------------+
          |              |              |
     +----v----+   +-----v-----+  +-----v-----+
     | Web App |   | WebSocket |  |  Static   |
     | :5000   |   | :5001     |  |  Assets   |
     +----+----+   +-----+-----+  +-----------+
          |              |
          +------+-------+
                 |
          +------v------+
          | PostgreSQL  |
          | (Neon)      |
          +-------------+
```

- **Port 5000**: Express serves both the API and the Vite-built React frontend
- **Port 5001**: WebSocket signaling server for WebRTC call setup and real-time events
- **PostgreSQL**: All persistent data (users, orgs, billing, calls, voice profiles, audit logs)

### Key Directories

| Path | Purpose |
|------|---------|
| `client/src/pages/` | React page components (dashboards, call screens, auth) |
| `client/src/hooks/` | Custom hooks (auth, WebRTC, signaling, translation, voice) |
| `client/src/components/` | Reusable UI components (shadcn/ui, TranslationSubtitles, EmotionIndicator) |
| `server/` | Express routes, middleware, storage, WebSocket servers |
| `shared/schema.ts` | Drizzle ORM schema and Zod validation types |
| `shared/sdk-types.ts` | TypeScript SDK types for external consumers |
| `flutter_app/` | Flutter mobile application |
| `flutter_app/lib/services/` | Flutter services (API, SIM call, WebRTC, translation, app config) |
| `flutter_app/lib/screens/` | Flutter screen widgets |

---

## 3. Role-Based Access Control

NeuraTalk uses a five-tier role hierarchy. Each role has specific permissions enforced by server-side middleware (`server/role-middleware.ts`).

### Role Hierarchy

| Role | Scope | Description |
|------|-------|-------------|
| `super_admin` | Platform-wide | Platform owner. Full access to all organizations, users, billing, system settings, and analytics. Can impersonate any role. |
| `investor` | Read-only analytics | View-only access to platform-wide growth metrics, user distribution, and platform health. No data modification capabilities. |
| `company_admin` | Organization-level | Manages a single B2B organization. Can invite/manage agents, purchase credits, view organization analytics, configure translation settings. |
| `agent` | Organization-level | Staff member of a B2B organization. Can make/receive calls, use translation features. Access scoped to their organization. |
| `consumer` | Individual | B2C end user. Manages personal subscription, makes calls, accesses AI assistant. No organization-level access. |

### Permission Enforcement

- Every authenticated API request includes a Bearer token checked by `server/role-middleware.ts`
- The `requireRole(role)` middleware restricts endpoints to specific roles
- The `requireOrgAccess` middleware ensures B2B users can only access their own organization's data
- Super admins bypass all role checks and can access any endpoint

---

## 4. Authentication Flow

NeuraTalk uses OTP-based passwordless authentication. There are no username/password credentials.

### Login Process

1. **User requests OTP**: `POST /api/auth/otp/request`
   - Body: `{ "identifier": "email@example.com", "channel": "email" }` or `{ "identifier": "+1234567890", "channel": "sms" }`
   - In development mode, the OTP is always **`123456`**
   - In production, if Firebase Phone Auth is configured, a real SMS is sent

2. **User verifies OTP**: `POST /api/auth/otp/verify`
   - Body: `{ "identifier": "email@example.com", "channel": "email", "code": "123456" }`
   - Returns a Bearer token (JWT-like) with 24-hour rolling expiry
   - Also returns the user object with role information

3. **Subsequent requests**: Include `Authorization: Bearer <token>` header

### Login URLs by Role

| Role | Login URL | Dashboard URL |
|------|-----------|---------------|
| Super Admin | `/admin/login` | `/admin` |
| Investor | `/investor/login` | `/investor/dashboard` |
| Company Admin | `/company/login` | `/company/dashboard` |
| Agent | (via Company Admin invite) | `/company/dashboard` (scoped) |
| Consumer | `/login` | `/dashboard` |
| Enterprise | `/enterprise/login` | `/enterprise/dashboard` |

### Dev Testing Shortcut

For local development and testing, use OTP code **`123456`** for any identifier. This is hardcoded in the backend when Firebase is not configured.

### Token Storage

- Tokens are stored in `localStorage` under the key `auth_token`
- The `useAuth()` hook manages token lifecycle on the frontend
- Tokens auto-refresh; expired tokens redirect users to login

---

## 5. Dashboards by Role

### Super Admin Dashboard (`/admin`)

The most comprehensive dashboard with full platform control.

**Tabs:**
- **Overview**: Total users, organizations, revenue summary, recent activity
- **Users**: Search, filter, and manage all platform users. Change roles, disable accounts
- **Organizations**: Approve/reject organization signups, view credit balances, manage org settings
- **Billing**: View all transactions, invoices, subscription statuses, revenue breakdown
- **System**: Platform health, WebRTC infrastructure status, API metrics
- **Settings**: Global platform configuration, GST settings, plan management

**Key Actions:**
- Approve or reject organization registration requests
- Assign/change user roles
- Adjust organization credit balances
- View and export platform-wide analytics
- Configure billing plans and pricing

### Investor Dashboard (`/investor/dashboard`)

Read-only analytics dashboard for stakeholders.

**Sections:**
- **Total Users**: Count with 30-day signup trend
- **Organizations**: Total, active, and pending counts
- **User Growth**: 30-day growth rate percentage
- **Platform Status**: Health status, uptime, average response time
- **User Distribution**: Breakdown by type (Consumers, Company Admins, Agents)
- **Platform Performance**: Response time, uptime, organization growth rate
- **Platform Highlights**: Real-time translation capabilities, self-hosted infrastructure, B2B + B2C model

API: `GET /api/investor/metrics` (requires investor or super_admin role)

### Company Admin Dashboard (`/company/dashboard`)

Organization management for B2B customers.

**Tabs:**
- **Overview**: Organization stats, credit balance, agent count, recent calls
- **Agents**: Invite, manage, and monitor agents. View per-agent call statistics
- **Credits**: Purchase credits, view usage history, top-up balance
- **Analytics**: Call volume, language distribution, emotion breakdown, cost analysis
- **Settings**: Organization profile, translation preferences, notification settings

**Key Actions:**
- Invite new agents via email
- Monitor real-time agent activity
- Purchase translation credits
- Export call records and analytics
- Configure organization-level translation settings

### Consumer Dashboard (`/dashboard`)

Personal dashboard for B2C users.

**Quick Actions (2x2 Grid):**
- **SIM Call**: Make a phone call with real-time translation (`/calls/sim`)
- **Meetings**: Create or join a video/audio meeting (`/meetings`)
- **Face-to-Face**: In-person interpreter mode (`/calls/face-to-face`)
- **AI Assistant**: Voice-based AI chat (`/calls/voice-translation`)

**Additional Sections:**
- Current subscription plan and usage
- Recent call history
- Voice profile management
- Language preferences

### Enterprise Dashboard (`/enterprise/dashboard`)

Advanced dashboard for enterprise-tier customers.

**Tabs:**
- **Analytics**: Comprehensive usage metrics with date range filters (24h, 7d, 30d, 90d). Shows total calls, minutes, translation minutes, active users, calls today, average duration. Includes charts for calls by day, top languages, emotion analysis, system health
- **Team Management**: Search, filter, and manage team members. Stats for total, active, admins, managers, agents. Invite new members
- **Audit Logs**: Filterable activity log tracking logins, settings changes, user creation, credit adjustments, approvals, deletions. Includes user, action, resource, IP, timestamp, and status
- **Recordings**: Call recordings with consent tracking, playback, and export
- **Enterprise Settings**: Branding, security, API configuration, notification preferences

---

## 6. Call Types & Communication

NeuraTalk supports five distinct call modes, each with real-time translation capabilities.

### SIM Call (`/calls/sim`)

Traditional phone call with live translation overlay.

- User enters a phone number and selects source/target languages
- Backend bridges the call via Twilio PSTN
- Audio streams bidirectionally over WebSocket
- Server performs STT, translation, and TTS in real-time
- Translated audio is played back to both parties
- Supports emotion detection and voice cloning

**Backend**: `server/twilio-sim-bridge.ts`, `server/sim-call-routes.ts`

### Video Translation Call (`/calls/video-translation`)

Browser-based video call with real-time audio translation.

- WebRTC peer-to-peer connection with STUN/TURN
- Local and remote video streams displayed side-by-side
- Audio captured via MediaRecorder, sent to server for translation
- Translation subtitles rendered as overlay
- Features: mute, camera toggle, screen sharing, speaker control
- Room-based: create a room, share link, guest joins
- Shareable to WhatsApp, Google Meet, Teams, Zoom
- Per-participant voice identity detection and preservation

**Key Hooks**: `use-webrtc.ts`, `use-signaling.ts`, `use-call-translation.ts`, `use-voice-profiles.ts`

### Face-to-Face Interpreter (`/calls/face-to-face`)

In-person interpreter mode for two people sharing one device.

- Split-screen UI: top half for Person A, bottom half for Person B
- Hold-to-speak interaction: press and hold to record speech
- Released audio is transcribed, translated, and spoken in the other person's language
- Ideal for in-person meetings where participants speak different languages

### Voice Translation Call (`/calls/voice-translation`)

Audio-only call with translation (no video).

- Same WebRTC infrastructure as video calls, but audio-only
- Lower bandwidth requirements
- Full translation, emotion detection, and voice preservation features

### AI Voice Assistant

AI-powered conversational assistant.

- Voice-based interaction with OpenAI GPT
- Streaming responses with TTS playback
- Emotion-aware response adaptation
- Supports conversation history and context

### Common Features Across All Call Types

| Feature | Description |
|---------|-------------|
| Language Selection | 14+ languages: English, Spanish, French, German, Chinese, Japanese, Hindi, Telugu, Tamil, Kannada, Arabic, Portuguese, Russian, Korean |
| Emotion Detection | Detects caller emotional state (calm, happy, neutral, stressed, sad) |
| Emotion Preservation | Maintains emotional tone across translation |
| Voice Cloning | Optional: preserves speaker's natural voice characteristics in translated output |
| Subtitles | Real-time translation subtitles overlay |
| Ultra-Low Latency | Streaming pipeline targeting <300ms end-to-end |
| Noise Suppression | Client-side 80Hz high-pass filter + noise gate via Web Audio API |

---

## 7. Meetings Hub

The Meetings Hub (`/meetings`) is a centralized page for creating, joining, and scheduling meetings.
Important: video/audio meeting transport is a legacy path and is disabled by default in the primary production stack. Face-to-face remains the primary-safe meeting mode.

### Features

**New Meeting**: Creates a room on the server (`POST /api/rooms/create`), copies the join link to clipboard, and navigates the host directly into the call. If legacy meeting transport is disabled, only Face-to-Face rooms are allowed on the primary path.

**Join Meeting**: Enter a room code or full join link. The system validates the room exists (`GET /api/rooms/:token`) and navigates the user to the appropriate call screen. Legacy `/join/:token` behavior is disabled unless legacy meeting transport is explicitly enabled.

**Schedule Meeting**: Creates a room in advance without joining immediately. The link can be shared and used later. Scheduled meetings appear in a list with copy/share/start actions. Video/audio scheduled meetings require legacy meeting transport to be enabled.

### Meeting Types

| Type | Route | Description |
|------|-------|-------------|
| Video Call | `/calls/video-translation` | Legacy meeting transport; disabled by default |
| Audio Only | `/calls/voice-translation` | Legacy meeting transport; disabled by default |
| Face-to-Face | `/calls/face-to-face` | Primary-safe in-person interpreter mode |

### External Platform Integration

Quick-launch links to external meeting platforms:

| Platform | Action |
|----------|--------|
| Google Meet | Opens `meet.google.com/new` |
| Microsoft Teams | Opens Teams meeting creation |
| Zoom | Opens Zoom join page |
| WhatsApp | Opens WhatsApp call link |

API Endpoints:
- `GET /api/meetings/platforms` - List supported external platforms
- `POST /api/meetings/external-link` - Generate deep links for external platforms

---

### 7.1 External Bridge Logic
To integrate with WhatsApp or Zoom, NeuraTalk deploys a "Media Bridge Bot". 
- **WhatsApp**: Requires Meta Cloud API credentials per organization.
- **Zoom/Teams**: NeuraTalk bot joins as a silent participant to capture and translate audio in real-time.

## 8. Billing System

NeuraTalk has separate billing models for B2C and B2B customers, all priced in USD.

### B2C Subscription Plans

| Plan | Price | Duration | Features |
|------|-------|----------|----------|
| Free Trial | $0.00 | 7 days | Limited minutes, basic translation |
| Weekly | $4.99 | 7 days | Full access, standard minutes |
| Monthly | $14.99 | 30 days | Full access, extended minutes |
| Quarterly | $34.99 | 90 days | Full access, priority support |
| Yearly | $99.99 | 365 days | Full access, premium support |

### B2B Credit Plans

| Plan | Price | Credits | Features |
|------|-------|---------|----------|
| Starter | $49.99 | Prepaid credits | Basic translation, limited agents |
| Business | $149.99 | Prepaid credits | Full features, more agents |
| Professional | $299.99 | Prepaid credits | Priority support, all features |
| Enterprise | Contact Sales | Custom | WhatsApp Bridge, Zoom/Teams Integration, Lip-Sync |

### Billing Flow

1. User selects a plan on `/pricing` or from their dashboard
2. `POST /api/razorpay/create-order` creates a Razorpay order
3. User completes payment via Razorpay checkout popup
4. `POST /api/razorpay/verify-payment` verifies signature and activates subscription
5. Backend activates subscription/credits and generates invoice
6. Invoice available for download with GST details (if applicable)

### Key Billing Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/billing/plans` | GET | List all available plans |
| `/api/billing/plans/b2c` | GET | List B2C plans only |
| `/api/razorpay/create-order` | POST | Create Razorpay payment order |
| `/api/razorpay/verify-payment` | POST | Verify payment and activate subscription |
| `/api/razorpay/subscription` | GET | Get current user subscription |
| `/api/billing/invoices` | GET | List user invoices |

### GST Compliance (India)

- Organizations can set GST number and billing address
- Invoices auto-include GST calculations
- Configurable via Super Admin settings panel

---

## 9. Voice Translation Pipeline

The core translation pipeline processes speech in real-time through multiple stages.

### Pipeline Flow

```
Speaker Audio
    |
    v
[1. Audio Capture] -- MediaRecorder / AudioWorklet (PCM16, 16kHz)
    |
    v
[2. Noise Suppression] -- 80Hz high-pass filter + noise gate (Web Audio API)
    |
    v
[3. Silence Detection] -- Skip empty audio segments
    |
    v
[4. Speech-to-Text (STT)] -- OpenAI Whisper (cloud) or Local Whisper (self-hosted, ~50-100ms GPU)
    |
    v
[5. Language Detection] -- Auto-detect source language
    |
    v
[6. Translation] -- OpenAI or LibreTranslate/NLLB (self-hosted, ~30-80ms GPU)
    |
    v
[7. Emotion Detection] -- Analyze emotional tone (calm, happy, neutral, stressed, sad)
    |
    v
[8. Voice Identity] -- Detect speaker gender/characteristics via pitch analysis
    |
    v
[9. Voice Cloning (Optional)] -- RVC/XTTS v2 (self-hosted GPU) to preserve original voice
    |
    v
[10. Text-to-Speech (TTS)] -- OpenAI TTS with emotion-matched voice selection
    |                          Voices: alloy (neutral), echo (male), fable (male),
    |                                  onyx (male), nova (female), shimmer (female)
    |
    v
[11. Audio Playback] -- Base64 audio streamed back to client, queued for playback
```

### Latency Targets

| Mode | Target | Components |
|------|--------|-----------|
| Standard | <500ms | Cloud STT + Cloud Translation + Cloud TTS |
| Ultra-Low | <300ms | Streaming STT + Speculative Translation + Streaming TTS |
| Self-Hosted | <100ms | Local Whisper + Local NLLB + Local TTS on GPU |

### Voice Identity System

- `POST /api/call/detect-voice`: Analyzes audio to detect speaker gender from pitch
- Assigns a consistent OpenAI voice ID per participant throughout a call
- Male voices: echo, onyx, fable
- Female voices: nova, shimmer, alloy
- Users can manually override with voice preference selectors

### Emotion-Aware TTS

The system selects TTS voice characteristics based on detected emotion:
- Happy: "nova" voice (brighter tone)
- Sad: "onyx" voice (deeper tone)
- Default/Neutral: "alloy" voice

---

## 10. API Reference

### Authentication

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/api/auth/otp/request` | POST | No | Request OTP code |
| `/api/auth/otp/verify` | POST | No | Verify OTP and get token |

### Health & Status

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/api/health` | GET | No | Basic health check |
| `/api/rtc/status` | GET | No | WebRTC infrastructure status |
| `/api/rtc/ice-servers` | GET | No | STUN/TURN server configuration |
| `/api/lipsync/status` | GET | Yes | Lip-sync service status |
| `/api/sla/status` | GET | No | SLA status page |

### Translation & Voice

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/api/translate` | POST | Yes | Translate text between languages |
| `/api/audio/speech` | POST | Yes | Text-to-speech synthesis |
| `/api/voice-memos/languages` | GET | No | List supported languages (20+) |
| `/api/call/detect-voice` | POST | Yes | Detect speaker voice characteristics |
| `/api/call/translate` | POST | Yes | Translate call audio with voice ID |

### Rooms & Meetings

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/api/rooms/create` | POST | Optional | Create a room; video/audio requires legacy transport, f2f is primary-safe |
| `/api/rooms/:token` | GET | No | Get room details by token; legacy video/audio rooms return guard info when disabled |
| `/api/meetings/platforms` | GET | No | List external meeting platforms |
| `/api/meetings/external-link` | POST | Yes | Generate external platform deep link |

### Billing

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/api/billing/plans` | GET | No | List all billing plans |
| `/api/billing/plans/b2c` | GET | No | List B2C plans only |
| `/api/razorpay/create-order` | POST | Yes | Create Razorpay payment order |
| `/api/razorpay/verify-payment` | POST | Yes | Verify payment and activate subscription |
| `/api/razorpay/subscription` | GET | Yes | Get user subscription |
| `/api/billing/invoices` | GET | Yes | List user invoices |

### B2B / Organization

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/api/b2b/register` | POST | No | Register new organization |
| `/api/b2b/organization` | GET | Yes | Get organization details |
| `/api/b2b/agents` | GET | Yes | List organization agents |
| `/api/b2b/agents` | POST | Yes | Invite a new agent |
| `/api/b2b/credits` | GET | Yes | Get credit balance |
| `/api/b2b/credits/purchase` | POST | Yes | Purchase credits |

### Investor

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/api/investor/metrics` | GET | Yes | Platform-wide analytics |

### Enterprise

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/api/enterprise/analytics` | GET | Yes | Enterprise analytics with date range |
| `/api/enterprise/team` | GET | Yes | Team member list |
| `/api/enterprise/audit-logs` | GET | Yes | Audit log entries |

### API Documentation

- **Swagger UI**: Available at `/api/docs`
- **OpenAPI Spec**: Available at `/api/openapi.json`
- **SDK Types**: TypeScript types in `shared/sdk-types.ts`

---

## 11. Flutter Mobile App

The Flutter app is located in `flutter_app/` and provides a native mobile experience.

### Architecture

| Component | File | Purpose |
|-----------|------|---------|
| App Config | `lib/services/app_config.dart` | Configurable API base URL, language list, HTTP client |
| API Service | `lib/services/api_service.dart` | REST API communication |
| SIM Call Service | `lib/services/sim_call_service.dart` | WebSocket-based SIM call bridging |
| WebRTC Service | `lib/services/webrtc_service.dart` | Video/voice call implementation |
| Translation Service | `lib/services/translation_service.dart` | 20+ language translation |
| Firebase Auth | (configured in project) | Phone OTP authentication |

### Screens

| Screen | File | Description |
|--------|------|-------------|
| Home | `lib/screens/home_screen.dart` | 2x2 grid: SIM Call, Video Call, Face-to-Face, AI Assistant |
| SIM Call | `lib/screens/sim_call_screen.dart` | Real-time subtitles, latency display, emotion indicators |
| Video Call | `lib/screens/video_call_screen.dart` | Full-screen video with translation overlay |
| Face-to-Face | `lib/screens/face_to_face_screen.dart` | Hold-to-speak split UI |
| Billing | `lib/screens/billing_screen.dart` | USD plans from server API |

### SIM Call Audio Pipeline (Flutter)

**Mobile Polish Update**: All Flutter calls now utilize `flutter_callkit_incoming` and `android_intent_plus`.
1. Incoming/Outgoing call triggers System UI.
2. Call is registered with `ConnectionService` (Android) to ensure high CPU priority.
3. Background execution is maintained via a Foreground Service.

### Voice Translation Pipeline

```
PCM16 16kHz Recording
    |
    v
WebSocket Streaming to Server
    |
    v
Server-side STT + Translation + Emotion-aware TTS
    |
    v
Base64 Audio Response via WebSocket
    |
    v
Queue-based Playback on Device
```

### Build Commands

```bash
cd flutter_app
flutter pub get
flutter build apk --release    # Android APK
flutter build ios --release     # iOS (requires Mac + Xcode)
```

### Requirements

- Flutter SDK 3.0+
- Android Studio (Android builds)
- Xcode (iOS builds, Mac only)
- Firebase project configuration

### Configuration

Update the API base URL in `flutter_app/lib/services/app_config.dart` to point to your deployment URL.

---

## 12. Environment Variables

### Core (Required)

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | PostgreSQL connection string (from Neon PostgreSQL) |
| `SESSION_SECRET` | Session encryption key (32+ characters). Generate: `openssl rand -base64 32` |

### Authentication (Optional)

| Variable | Description |
|----------|-------------|
| `SUPER_ADMIN_EMAIL` | Auto-provision super admin account on startup |
| `SUPER_ADMIN_PHONE` | Super admin phone number |
| `FIREBASE_SERVICE_ACCOUNT_JSON` | Firebase Phone Auth config (for real SMS OTP) |

### Payment (For Live Billing)

| Variable | Description |
|----------|-------------|
| `RAZORPAY_KEY_ID` | Razorpay API key ID (live mode) |
| `RAZORPAY_KEY_SECRET` | Razorpay API secret key |

### WebRTC (For Production Calls)

| Variable | Description |
|----------|-------------|
| `TURN_SERVER_URL` | TURN server URL for NAT traversal |
| `TURN_SERVER_USERNAME` | TURN server credentials |
| `TURN_SERVER_CREDENTIAL` | TURN server credentials |

### OpenAI

| Variable | Description |
|----------|-------------|
| `OPENAI_API_KEY` | OpenAI API key for STT, TTS, chat, and translation fallback |

---

## 13. Troubleshooting

### Common Issues

**"OTP not working"**
- In development, always use code `123456`
- If Firebase is configured, check `FIREBASE_SERVICE_ACCOUNT_JSON` is valid JSON
- Verify the identifier (email/phone) format is correct

**"Cannot access dashboard after login"**
- Check that the user's role matches the dashboard URL
- Consumer role users should be at `/dashboard`, not `/admin`
- Verify the auth token is stored in localStorage (`auth_token` key)

**"Calls fail to connect"**
- WebRTC requires HTTPS in production (except localhost)
- Check browser permissions for camera/microphone
- If on a restrictive network, TURN server configuration is required
- Verify WebSocket server (port 5001) is accessible
- Check `/api/rtc/status` for signaling server health

**"Translation not working during calls"**
- Verify `OPENAI_API_KEY` is set (used for STT and TTS)
- Check `/api/translate` endpoint returns valid responses
- Ensure microphone permissions are granted
- Look for "silence detection" in console: audio may be too quiet

**"Billing shows 'not configured'"**
- Set `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET`
- Run the app once to auto-seed billing plans
- Verify plans exist: `GET /api/billing/plans`

**"Razorpay payments not working"**
- Verify `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET` are set correctly
- Check Razorpay dashboard for order/payment status
- Ensure live keys are used in production (not test keys)

**"Video/audio quality is poor"**
- Check network bandwidth (recommended: 2+ Mbps for video)
- Client-side noise suppression is active by default (80Hz high-pass + noise gate)
- Consider enabling ultra-low latency mode for faster translation

**"Cannot find a user or organization in admin panel"**
- Use the search/filter functionality in the Super Admin dashboard
- Check if the organization is in "pending" state (needs approval)
- Verify the database has the expected records: check `/api/health`

**"Flutter app cannot connect to server"**
- Update `AppConfig.apiBaseUrl` in `flutter_app/lib/services/app_config.dart`
- Ensure the server URL is accessible from the device's network
- For local development, use your machine's IP address (not `localhost`)

### Health Check Endpoints

| Endpoint | What It Checks |
|----------|---------------|
| `GET /api/health` | Server running, database connected |
| `GET /api/rtc/status` | WebRTC signaling server status |
| `GET /api/lipsync/status` | Lip-sync service availability (auth required) |
| `GET /api/sla/status` | SLA compliance and uptime metrics |

### Database Operations

- **Run migrations**: `npm run db:push`
- **Seed billing plans**: Plans auto-seed on first application start
- **Backup**: Use `pg_dump` or Neon's built-in point-in-time recovery

### Log Locations

- **Server logs**: stdout/stderr in DigitalOcean App logs
- **Frontend errors**: Browser developer console
- **WebSocket events**: Logged to server console with connection/disconnect events
- **Audit logs**: Stored in database, viewable via Enterprise Dashboard or Super Admin

---

## Quick Reference Card

| Task | Where |
|------|-------|
| Log in as any role (dev) | Use OTP code `123456` |
| View platform analytics | `/admin` (super_admin) or `/investor/dashboard` |
| Manage an organization | `/company/dashboard` (company_admin) |
| Make a translated call | `/dashboard` > Quick Actions (consumer) |
| Create a meeting room | `/meetings` > New Meeting (Face-to-Face primary-safe; video/audio requires legacy transport) |
| View billing plans | `/pricing` or `GET /api/billing/plans` |
| Check API docs | `/api/docs` (Swagger UI) |
| Check system health | `GET /api/health` |
| Build Flutter APK | `cd flutter_app && flutter build apk --release` |


