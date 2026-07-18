# Production QA / UAT Checklist

Use this checklist before go-live. Mark each item `PASS`, `FAIL`, or `N/A`, and capture evidence.

## Preflight

- [ ] `npm run check` passes
- [ ] `npm run build` passes
- [ ] `.env` production secrets are present
- [ ] `DATABASE_URL` reachable
- [ ] Redis reachable
- [ ] `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` configured
- [ ] `LIVEKIT_SIP_DOMAIN` configured for PSTN
- [ ] `APP_BASE_URL` configured for webhooks
- [ ] `MSG91_AUTH_KEY` configured for India PSTN
- [ ] `MSG91_WEBHOOK_SECRET` configured in production
- [ ] `OPENAI_API_KEY` or `AI_INTEGRATIONS_OPENAI_API_KEY` configured

## Auth

- [ ] Consumer login via OTP works on web
- [ ] Admin login works on web
- [ ] Company admin login works
- [ ] Session persists after refresh
- [ ] Logout clears session
- [ ] Invalid OTP is rejected
- [ ] Expired OTP is rejected
- [ ] Unauthorized routes return 401/403

## Caller Identity

- [ ] User can request caller-ID verification OTP
- [ ] User can confirm caller-ID verification OTP
- [ ] Verified state is saved on profile
- [ ] UI does not promise unsupported personal-number caller ID behavior
- [ ] Business/org caller ID can be set where required

## C2C App-to-App

- [ ] Voice call starts between two app users
- [ ] Video call starts between two app users
- [ ] Translation toggle changes real call behavior
- [ ] Emotion/lipsync toggle is respected for app-to-app
- [ ] Incoming call ring appears on callee device
- [ ] Accept works
- [ ] Reject works
- [ ] End call works
- [ ] Call history is saved

## App-to-PSTN

- [ ] Voice call from app to real mobile number starts
- [ ] PSTN route uses audio-only behavior
- [ ] Webhook status updates move call through ringing/answered/ended
- [ ] Translation works on bridged audio
- [ ] Billing session starts only after answer
- [ ] Call ends cleanly if provider webhook never arrives
- [ ] If `APP_BASE_URL` is missing, call creation fails fast
- [ ] If `LIVEKIT_SIP_DOMAIN` is missing, call creation fails fast

## PSTN Identity

- [ ] Verify actual displayed caller identity on Android recipient
- [ ] Verify actual displayed caller identity on iPhone recipient
- [ ] Confirm whether display is:
  - user verified number
  - organization caller ID
  - provider/DID caller ID
- [ ] Document provider-side restriction if personal number is not shown

## B2B

- [ ] Company dashboard loads
- [ ] Agent list loads
- [ ] Agent add/edit/delete works
- [ ] B2B outbound call works
- [ ] Queue shows org-scoped calls only
- [ ] Assign action works
- [ ] Auto-route action works
- [ ] Live metrics reflect real queue/call state

## B2C

- [ ] Consumer dashboard loads
- [ ] Subscription purchase flow works
- [ ] Billing status endpoint returns correct plan state
- [ ] Low balance warning appears
- [ ] Expired subscription blocks paid features

## Enterprise

- [ ] Enterprise analytics loads
- [ ] Enterprise team page loads
- [ ] Enterprise call initiate works
- [ ] Translation enable/disable endpoints work
- [ ] Enterprise usage page loads

## Billing

- [ ] Billing dashboard loads
- [ ] Invoice list loads
- [ ] Consumer subscription activation path works
- [ ] Failed billing verification blocks calls in production mode
- [ ] Prepaid balance enforcement works
- [ ] Postpaid credit limit enforcement works
- [ ] Low balance call termination works

## Admin

- [ ] Super admin dashboard loads
- [ ] User management load/create/update/delete works
- [ ] Company approval/rejection works
- [ ] Billing admin pages load
- [ ] Platform config/status pages load
- [ ] Health/admin monitoring pages load

## Mobile

- [ ] Android login works
- [ ] iOS login works
- [ ] Push registration works
- [ ] Incoming app-to-app call works on Android
- [ ] Incoming app-to-app call works on iOS
- [ ] Background/foreground call recovery works

## Security

- [ ] MSG91 webhook without valid signature is rejected in production
- [ ] Protected admin routes reject non-admin users
- [ ] API-key protected enterprise endpoints reject invalid keys
- [ ] Rate limiting triggers on abuse paths
- [ ] Billing guard fail-open behavior is disabled in production

## Production Evidence

- [ ] Save screenshots/video of each major flow
- [ ] Save webhook payload samples
- [ ] Save billing ledger samples for one completed call
- [ ] Save call history samples for app-to-app and app-to-PSTN
- [ ] Record final sign-off owner and date
