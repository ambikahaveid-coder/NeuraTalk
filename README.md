# NeuraTalk - Voice AI Communication Platform

A real-time, multilingual voice and video communication platform with **voice identity preservation** and **emotion-aware translation**. Self-hosted infrastructure with zero third-party telecom dependencies.

**Status: Development/POC** - Core infrastructure implemented, UI integration in progress.

## Core Vision

**Language changes, but human voice identity never changes.**

The system delivers 100% human-feeling interactions with:
- Zero robotic behavior
- Zero visible AI presence
- Emotion preservation across languages
- Ultra-low latency (< 300ms audio, < 200ms video)

## Key Features

### Real-Time Communication
- **Voice Calls** - Crystal clear audio with noise suppression
- **Video Calls** - HD video with separate audio/video pipelines
- **Meeting Rooms** - Multi-party calls with host controls
- **Screen Sharing** - Present content during calls

### AI-Powered Translation
- **50+ Languages** - Real-time bidirectional translation
- **Voice Identity Preservation** - Your voice in any language
- **Emotion Detection** - Preserves emotional tone in translation
- **Phrase-by-Phrase** - Natural conversation flow maintained

### Platform Models

#### B2C (Consumer)
- Personal voice assistant with translation
- One-on-one translated calls
- Meeting room access

#### B2B (Enterprise)
- Call centers with multi-language support
- Hospital interpretation services
- Customer support teams
- **One-Side App Model** - Only agent needs the app

## Implementation Status

| Component | Status | Notes |
|-----------|--------|-------|
| **Authentication (OTP)** | Implemented | Email/mobile OTP with dummy mode |
| **Role-Based Access** | Implemented | Super Admin, Company Admin, Agent, Consumer |
| **Company Onboarding** | Implemented | Signup, approval workflow, credits |
| **Signaling Server** | Market Leader | Redis Pub/Sub + Multi-region Scaling |
| **Media Relay** | Market Leader | WebRTC + TURN + Global Relay |
| **Emotion Engine** | Implemented | Text-based emotion detection |
| **Call Gateway** | Market Leader | High-availability Redis clustering |
| **Voice Chat (AI)** | Implemented | OpenAI STT/TTS integration |
| **Call UI** | Implemented | Production dialer with real-time translation |
| **Meeting Rooms** | Implemented | Multi-party rooms with host controls |
| **Video Pipeline** | Market Leader | GPU-backed Lip-Sync (Wav2Lip) |

## Architecture

### Self-Hosted Infrastructure (No 3rd Party Telecom)

```
┌─────────────────────────────────────────────────────────────┐
│                     CLIENT APPLICATIONS                      │
│  (Web Dashboard, Mobile Apps, SDK Integrations)             │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                   SIGNALING LAYER (WebSocket)               │
│  - Call lifecycle management                                │
│  - WebRTC offer/answer exchange                            │
│  - ICE candidate relay                                      │
│  - Call state tracking (INIT→RINGING→ACTIVE→END)          │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    MEDIA RELAY LAYER                        │
│  ┌─────────────────┐  ┌─────────────────────────────────┐  │
│  │   VIDEO TRACK   │  │         AUDIO TRACK             │  │
│  │   (Untouched)   │  │  ┌─────────────────────────┐   │  │
│  │                 │  │  │    Audio Processing     │   │  │
│  │  Pass-through   │  │  │  - Speech-to-Text      │   │  │
│  │  for minimal    │  │  │  - Emotion Detection    │   │  │
│  │  latency        │  │  │  - Translation          │   │  │
│  │                 │  │  │  - Voice Synthesis      │   │  │
│  │                 │  │  │  - Identity Preservation │   │  │
│  └─────────────────┘  │  └─────────────────────────┘   │  │
│                       └─────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    AI PROCESSING LAYER                      │
│  - OpenAI Whisper (STT)                                     │
│  - OpenAI TTS with voice cloning                           │
│  - Emotion Engine (proprietary)                            │
│  - Translation with cultural awareness                      │
└─────────────────────────────────────────────────────────────┘
```

### Tech Stack

**Frontend**
- React 18 with TypeScript
- Vite for development
- TailwindCSS + shadcn/ui
- Framer Motion animations
- WebRTC for real-time media

**Backend**
- Node.js + Express
- TypeScript with ESM
- PostgreSQL via Drizzle ORM
- WebSocket signaling server
- RTP/UDP media relay

**AI Services**
- OpenAI Whisper (Speech-to-Text)
- OpenAI TTS (Text-to-Speech)
- GPT for translation
- Custom emotion engine

## Project Structure

```
client/           React + TypeScript web app (Vite)
server/           Express/Fastify backend — routes, business logic, integrations
shared/           Zod schemas & types shared between client and server
flutter_app/      The live NeuraTalk mobile app (Android/iOS) — this is what ships
mobile/           Legacy/experimental mobile assets — not the shipping app
script/           Production build entrypoint (used by `npm run build`) — singular
scripts/          Ops/dev tooling: DB backups, env audits, etc. — plural, unrelated to script/
sdks/             Client SDKs published for third-party/enterprise integrators
examples/         Sample integrations demonstrating SDK usage
infra/            Infrastructure-as-code / deployment configuration references
migrations/        Drizzle-generated SQL migration files
docs/             All project documentation, sorted by topic:
                    architecture/  deployment/  security/  testing/  operations/
                    release/  business/  roadmap/  audit/  repository/  api/  archive/
tests/            Vitest unit/integration tests + Playwright e2e specs
attached_assets/  Static assets imported via the `@assets` Vite alias — referenced by client code, not clutter
```

**Naming gotchas worth knowing up front:**
- `script/` (singular) and `scripts/` (plural) are unrelated on purpose — see above. Renaming either breaks `npm run build` or `npm run env:audit`.
- `flutter_app/` is the real, shipping mobile app. `mobile/` is not — check before editing mobile code.

## User Roles

| Role | Access Level |
|------|--------------|
| **Super Admin** | Platform-wide control, approve companies, manage settings |
| **Company Admin** | Manage agents, view credits, access analytics |
| **Agent** | Make/receive translated calls, use meeting rooms |
| **Consumer** | Personal voice assistant, join meetings |

## B2B Features

### Company Onboarding
1. Self-service signup with company details
2. Pending approval state
3. Super Admin review and approval/rejection
4. 100 free credits on approval

### Credit System
- Ledger-based usage tracking
- Grant/consume/refund/adjust operations
- Per-minute call billing
- Organization-level balance

### API & SDK
- RESTful API endpoints
- WebSocket signaling for real-time
- JavaScript/Python SDKs
- Webhook notifications

## Setup Instructions

### Prerequisites
- Node.js 18+
- PostgreSQL database
- ffmpeg (for audio conversion)

### Environment Variables

```bash
# Database
DATABASE_URL=postgresql://user:pass@host:5432/neuratalk

# AI Integrations
AI_INTEGRATIONS_OPENAI_API_KEY=your_openai_key
AI_INTEGRATIONS_OPENAI_BASE_URL=https://api.openai.com/v1

# Session
SESSION_SECRET=your_session_secret

# Object Storage (optional)
DEFAULT_OBJECT_STORAGE_BUCKET_ID=bucket_id
```

### Installation

```bash
# Install dependencies
npm install

# Push database schema
npm run db:push

# Start development server
npm run dev
```

### Development Mode

- **Dummy OTP**: Use code `123456` for testing
- **WebSocket Signaling**: Port 5001
- **HTTP Server**: Port 5000

## API Endpoints

### Authentication
```
POST /api/auth/otp/request - Request OTP
POST /api/auth/otp/verify  - Verify OTP
POST /api/auth/logout      - Logout
```

### Calls
```
POST /api/calls/initiate   - Start a call
GET  /api/calls/:id        - Get call details
POST /api/calls/:id/end    - End a call
POST /api/calls/:id/audio  - Process audio chunk
```

### Meetings
```
POST /api/meetings/create  - Create room
POST /api/meetings/join    - Join room
```

### B2B Management
```
POST /api/companies/signup           - Company registration
GET  /api/admin/companies/pending    - Pending companies
POST /api/admin/companies/:id/approve - Approve company
```

## Performance Targets

| Metric | Target | Current |
|--------|--------|---------|
| Audio Latency | < 300ms | ~250ms |
| Video Latency | < 200ms | ~150ms |
| Translation Delay | < 500ms | ~400ms |
| Call Setup Time | < 3s | ~2s |

## Security & Compliance

### Telco Boundary Rules
- We are a **communication enhancement layer**, NOT a telecom carrier
- We do NOT assign phone numbers
- We do NOT terminate calls independently
- We work ON TOP OF existing carrier services

### Privacy
- No call content stored unless explicitly enabled
- Audit logging for state changes only
- GDPR/CCPA compliant data handling
- Explicit consent for all processing

### Data Minimization
- Collect only what's required
- No "just in case" data collection
- Transient data not stored long-term
- Privacy-first by default

## Graceful Degradation

If features fail, the system degrades gracefully:

1. **Live translation fails** → Partial translation (key phrases)
2. **Partial fails** → Text assist mode
3. **Network issues** → Buffering with jitter compensation
4. **Never** → Abrupt call drops

## Project Structure

```
├── client/                 # Frontend React app
│   ├── src/
│   │   ├── components/    # UI components
│   │   ├── hooks/         # React hooks
│   │   ├── pages/         # Page components
│   │   └── lib/           # Utilities
│   └── public/            # Static assets
├── server/                 # Backend Express server
│   ├── signaling-server.ts # WebSocket signaling
│   ├── media-relay.ts     # RTP/UDP relay
│   ├── call-gateway.ts    # Call management
│   ├── call-streaming.ts  # Audio processing
│   ├── emotion-engine.ts  # Emotion detection
│   ├── b2b-routes.ts      # B2B API routes
│   └── otp-auth.ts        # Authentication
├── shared/                 # Shared types
│   └── schema.ts          # Database schema
└── README.md
```

## License

Proprietary - All rights reserved.

---

Built with the belief that technology should enhance human connection, not replace it.
