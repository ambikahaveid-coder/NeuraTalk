# Communication API Platform

Production-focused app-to-app calling platform for logistics, delivery, and mobility apps with masked calling, WebRTC transport, PSTN fallback, and per-second billing.

## Architecture

```text
Mobile App / Driver App / Web SDK
        | REST + WSS
        v
  Communication API Gateway
        | API key auth + rate limit + permission checks
        v
  Session Orchestrator
   |             |                |
   |             |                |
   v             v                v
LiveKit       Redis          Billing Runtime
WebRTC        session        per-second counters
rooms/tokens  presence       prepaid/postpaid
   |             |                |
   |             |                v
   |             |          PostgreSQL
   |             |          sessions/usage/invoices
   |             |
   v             v
Number Masking   WebSocket Status Stream
virtual numbers  call + billing updates
   |
   v
MSG91 PSTN fallback / SIP bridge
```

## Core APIs

- `POST /api/communication/create-call-session`
- `POST /api/communication/end-call`
- `GET /api/communication/call-status/:sessionId`
- `POST /api/communication/call-status/:sessionId`
- `GET /api/communication/usage`
- `GET /api/communication/billing`
- `POST /api/communication/sessions/:sessionId/fallback`
- `POST /api/communication/livekit-webhook`
- `POST /api/communication/pstn-webhook/:sessionId`
- `WS /ws/communication-api?session_id=<id>&api_key=<key>`

## Request Model

`POST /api/communication/create-call-session`

```json
{
  "caller": {
    "externalId": "user_123",
    "phoneNumber": "+919999999999",
    "displayName": "Customer",
    "language": "en-IN"
  },
  "callee": {
    "externalId": "driver_456",
    "phoneNumber": "+918888888888",
    "displayName": "Driver",
    "language": "hi-IN"
  },
  "callType": "voice",
  "transportPreference": "auto",
  "enableRecording": false,
  "enableAiAssistant": false,
  "metadata": {
    "orderId": "ORD-1001",
    "tenant": "rapido-like-demo"
  }
}
```

Response includes:

- LiveKit room + participant tokens
- masked number assignment
- per-second pricing
- websocket endpoint for status + live billing

## WebSocket Events

The `/ws/communication-api` stream emits:

- `snapshot`
- `event`
- `error`

Typical event types:

- `session.created`
- `session.ringing`
- `session.connected`
- `billing.tick`
- `participant.joined`
- `participant.left`
- `pstn.fallback.activated`
- `session.ended`

## Billing Model

### Prepaid

- Per-second debit from API-key pricing wallet or active subscription balance
- Calls are blocked if balance is not enough to start
- Running calls stop automatically when balance is exhausted

### Postpaid

- Per-second usage accumulates against configured credit limit
- `GET /api/communication/billing` returns invoice preview for current cycle
- Usage is persisted into `usage_records` for invoice generation

### Dynamic Pricing per API key

Use table `communication_api_key_pricing` to override:

- `voice_rate_per_second_paise`
- `video_rate_per_second_paise`
- `pstn_fallback_rate_per_second_paise`
- `connection_fee_paise`
- `prepaid_balance_paise`
- `postpaid_credit_limit_paise`
- `max_concurrent_sessions`

## Number Masking

- Virtual numbers come from `communication_virtual_numbers`
- Session mappings live in `communication_masked_number_mappings`
- Mapping expires automatically after session end / TTL expiry
- Real numbers are not returned by partner-facing APIs

## Database Tables Added

- `communication_virtual_numbers`
- `communication_masked_number_mappings`
- `communication_api_key_pricing`
- `communication_sessions`
- `communication_session_events`

## Environment Variables

Required for production:

```env
DATABASE_URL=
REDIS_URL=
APP_BASE_URL=https://your-api.example.com

LIVEKIT_URL=wss://livekit.yourdomain.com
LIVEKIT_API_KEY=
LIVEKIT_API_SECRET=
LIVEKIT_SIP_DOMAIN=sip.livekit.yourdomain.com

MSG91_AUTH_KEY=
MSG91_VOICE_CALLER_ID=+91XXXXXXXXXX
MSG91_VOICE_URL=https://your-api.example.com/api/communication/pstn-webhook

COMMUNICATION_MASKING_TTL_MINUTES=120
```

Recommended India deployment:

- App/API: AWS `ap-south-1` or Azure Central India / South India
- Redis: Mumbai region, same VPC
- PostgreSQL: Mumbai region, private networking
- LiveKit: India edge, low-latency TURN enabled

## Deployment Steps

1. Run schema sync: `npm run db:push`
2. Seed billing plans and admin data: app startup already does this
3. Provision LiveKit with India-hosted ingress and webhook target
4. Provision Redis in Mumbai and set `REDIS_URL`
5. Add masked/virtual numbers into `communication_virtual_numbers`
6. Create enterprise API key from admin panel
7. Add optional row in `communication_api_key_pricing` for custom pricing/wallet
8. Point SDKs to `/api/communication/*` and `/ws/communication-api`
9. Configure LiveKit webhook to `/api/communication/livekit-webhook`
10. Configure MSG91 callback to `/api/communication/pstn-webhook/:sessionId`

## Mobile Network Optimizations

- WebRTC primary path with short room TTL and low setup overhead
- Redis-backed active session counters
- Small control payloads over WebSocket
- PSTN fallback endpoint for failed mobile data paths
- Per-session masked number cached for fast reconnect

## Future-ready hooks

- `enableAiAssistant` persisted on session for AI copilot insertion
- `enableRecording` persisted for compliant recording workflows
- LiveKit webhook integration keeps room-based automation possible
