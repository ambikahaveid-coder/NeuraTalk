# NeuraTalk — Complete System Audit
# DB + Connections + Sync + Market Launch Docs

**Audit Date:** June 23, 2026
**Branch:** neuratalk-clean-release
**Audited By:** Claude Code (Full Codebase Scan)

---

## SECTION 1 — DATABASE STATUS

### Connection Setup — SOLID

| Item | Status | Details |
|------|--------|---------|
| DB Client | PostgreSQL via `pg` Pool | `server/db.ts` |
| ORM | Drizzle ORM 0.39.3 | Type-safe queries |
| Connection Pool | Max 20 connections | Idle timeout 30s |
| Neon Cold Start | 15s timeout set | Handles cold wakeup |
| SSL | Auto-detect | Enabled for non-localhost |
| Graceful Shutdown | SIGTERM + SIGINT | Pool closed cleanly |
| Health Check | `assertDatabaseReady()` | Runs `SELECT 1` on startup |
| Schema File | `shared/schema.ts` | 2513 lines |
| Migrations Folder | `migrations/` | 1 migration file exists |

### Migration Status — WARNING

```
migrations/
  0001_b2b_agent_skills_and_org_dids.sql   ✅ exists
```

**Problem:** Only 1 migration file exists. But schema has 78 tables.
- This means ALL 78 tables were created by `npx drizzle-kit push` (push mode)
- Push mode is fine for dev. For production: push overwrites, no rollback possible.
- **Action needed:** Run `npx drizzle-kit generate` to generate migration history before going to market.

### All 78 Database Tables — Full List

#### Authentication & Users
| Table | Purpose |
|-------|---------|
| `users` | All users (consumer, company_admin, agent, super_admin, investor) |
| `otpChallenges` | OTP codes for phone/email verification |
| `userSessions` | Database-backed HTTP sessions |
| `registeredDevices` | FCM/APNs push notification tokens |
| `userConsents` | GDPR consent records |
| `userSuspensions` | Banned/suspended user records |
| `userAccessibilityPrefs` | Accessibility settings per user |
| `userAnalytics` | Per-user usage analytics |
| `userContacts` | Contact book (who called who) |

#### Organizations (B2B)
| Table | Purpose |
|-------|---------|
| `organizations` | Companies — with approval workflow (pending/approved/rejected) |
| `orgMembers` | User-to-org membership + role |
| `customRoles` | Custom RBAC roles per org |
| `billingSettings` | Per-org billing preferences |
| `billingAccounts` | Per-org billing account (prepaid/postpaid) |
| `agentSkills` | B2B agent skill tags for routing |
| `orgDIDNumbers` | DID phone numbers assigned to orgs |
| `dataResidencyPolicies` | Which region data must stay in |
| `tenantDatabases` | Multi-tenant DB configs |
| `tenantSecurityPolicies` | Per-tenant security rules |

#### Calls — Core Product
| Table | Purpose |
|-------|---------|
| `bridgedCalls` | Every call session (CDR) |
| `callParticipants` | Each participant in a call |
| `callTranslations` | Translation utterances during calls |
| `callConsents` | Recording consent per call |
| `callTelemetry` | Real-time call quality metrics |
| `callBillingRecords` | Per-second billing entries |
| `signalingSessions` | WebSocket signaling state |

#### Meetings
| Table | Purpose |
|-------|---------|
| `meetingRooms` | Scheduled meeting rooms |
| `meetingParticipants` | Who joined each meeting |

#### Chat & Messaging
| Table | Purpose |
|-------|---------|
| `conversations` | 1-to-1 or group conversation threads |
| `messages` | Individual chat messages |
| `personalChatThreads` | Direct message threads |
| `personalChatMessages` | Direct messages |
| `groupChats` | Group chat rooms |
| `groupChatMembers` | Group membership |
| `groupChatMessages` | Group messages |
| `voiceMemos` | Voice note messages |

#### Voice Profiles (AI)
| Table | Purpose |
|-------|---------|
| `voiceProfiles` | User voice clone profiles |
| `voiceSamples` | Audio samples for voice training |
| `aiPersonas` | Custom AI persona configs |

#### Billing — Full System
| Table | Purpose |
|-------|---------|
| `billingPlans` | Plan definitions (free/pro/enterprise) |
| `subscriptions` | User/org active subscriptions |
| `usageRecords` | Per-minute usage tracking |
| `invoices` | Invoice records |
| `invoiceLineItems` | Invoice line items |
| `billingReservations` | Pre-authorized billing holds |
| `billingLedgerEntries` | Every debit/credit entry |
| `paymentTransactions` | Razorpay payment records |
| `paymentGateways` | Payment gateway configs |
| `gstSettings` | India GST tax settings |
| `billingAnomalies` | Unusual billing patterns flagged |

#### Enterprise & API
| Table | Purpose |
|-------|---------|
| `enterpriseApiKeys` | API keys for enterprise customers |
| `communicationVirtualNumbers` | Virtual numbers pool |
| `communicationMaskedNumberMappings` | Number masking for privacy |
| `communicationApiKeyPricing` | Per-API-key pricing rules |
| `communicationSessions` | Communication API sessions |
| `communicationSessionEvents` | Events in comm sessions |

#### Platform & Admin
| Table | Purpose |
|-------|---------|
| `platformSettings` | Key-value platform config |
| `platformSecrets` | Encrypted secrets storage |
| `featureFlagsDb` | Feature flag definitions |
| `environmentConfigs` | Multi-env configuration |
| `rateLimitRules` | API rate limit definitions |
| `rateLimitBuckets` | Current rate limit state |
| `auditLogs` | Every admin action |
| `abuseReports` | Reported abuse cases |
| `dataSubjectRequests` | GDPR data deletion requests |
| `backupJobs` | DB backup job history |
| `systemHealthLogs` | System health check logs |
| `appVersions` | Mobile app version management |
| `legalContent` | ToS / Privacy page content |
| `supportContacts` | Support ticket contacts |
| `ipWhitelists` | IP allowlist for B2B orgs |

#### Location Data
| Table | Purpose |
|-------|---------|
| `countries` | Country list |
| `states` | State list |
| `districts` | District list |
| `cities` | City list |
| `villages` | Village list |
| `pincodes` | Pincode → city mapping |

#### Misc
| Table | Purpose |
|-------|---------|
| `supportedLanguages` | Language configuration |

### Foreign Key Relationships — All Correct

All key relationships use `references()` with proper cascade rules:

```
users → organizations (orgId)
orgMembers → organizations + users (cascade delete)
messages → conversations (cascade delete)
personalChatMessages → personalChatThreads + users (cascade delete)
groupChatMembers → groupChats + users (cascade delete)
groupChatMessages → groupChats + users (cascade delete)
meetingParticipants → meetingRooms + users
callParticipants → bridgedCalls + users
callTranslations → bridgedCalls
callBillingRecords → subscriptions
subscriptions → billingPlans
invoiceLineItems → invoices
voiceSamples → voiceProfiles + users
```

**Status: FK relations are properly defined in Drizzle schema.**

---

## SECTION 2 — REDIS STATUS

### Connection Setup — SOLID WITH SMART FALLBACK

File: `server/redis-client.ts` (fully reviewed)

| Mode | When Used | Status |
|------|-----------|--------|
| Remote Redis (production) | `REDIS_URL` set to real Redis server | Proper ioredis client, retry logic |
| In-Memory Mock (dev/degraded) | `REDIS_URL` is localhost or missing | `ioredis-mock` shim auto-loaded |
| Force Remote | `USE_REMOTE_REDIS=true` | Skips fallback logic |
| Force Strict | `REDIS_REQUIRED_STARTUP=true` | Crashes if Redis unavailable |

### Redis Features Implemented
- `assertRedisReady()` — health check on startup
- `withRedisLock()` — distributed locking (5s TTL, 100 retries, 50ms retry delay)
- Reconnect strategy: 4 attempts, 500ms to 2s backoff
- Graceful shutdown: `SIGTERM`/`SIGINT` bound

### What Redis Stores
| Data | TTL | Notes |
|------|-----|-------|
| Incoming call queue | 45s | In-memory Map → Redis migration PENDING |
| Call state (active calls) | Session duration | smart-router uses Redis |
| Session data | Based on session config | HTTP sessions |
| Billing locks | 5s | `withRedisLock()` prevents double-charge |
| Rate limit buckets | Sliding window | Per-user API throttling |

### WARNING: Incoming Call Queue is Still In-Memory

In `server/modules/calls/smart-router.ts` the incoming call notification queue uses an in-memory `Map`. Redis client exists and is ready — but this specific queue **has not been moved to Redis yet**.

- **Impact:** Run 2 servers (auto-scale) → caller rings → callee on different server → call is lost
- **Fix needed before market launch (multi-server deploy)**

---

## SECTION 3 — ALL CONNECTION POINTS

### Server Startup Phases (in order)

```
1. Environment validation (validateEnvironment)
2. Database connection (assertDatabaseReady — 15s timeout, 3 retries in production)
3. Redis connection (assertRedisReady — 5s timeout, in-memory fallback)
4. Config service init
5. Billing engine start (BillingEngine.startRuntimeSupervisor)
6. Communication billing loop (startCommunicationBillingLoop)
7. Smart call watchdog (startSmartCallWatchdog)
8. Routes register (35+ route modules)
9. WebSocket server start (port 5000 ws://)
10. HTTP server listen (port 5000)
```

### External Service Connections

| Service | Connection Point | Required? | Status |
|---------|-----------------|-----------|--------|
| Neon PostgreSQL | `DATABASE_URL` | CRITICAL | Must have |
| Redis | `REDIS_URL` | CRITICAL for prod | Falls back to memory in dev |
| LiveKit | `LIVEKIT_URL + KEY + SECRET` | CRITICAL | Server throws if missing in prod |
| Firebase Admin | `FIREBASE_SERVICE_ACCOUNT_JSON` | CRITICAL | Only mobile OTP method |
| Firebase Client | `VITE_FIREBASE_*` (5 vars) | CRITICAL | Frontend auth broken without |
| Azure Speech (STT/TTS) | `AZURE_SPEECH_KEY + REGION` | CRITICAL | Voice translation broken |
| Azure Translator | `AZURE_TRANSLATOR_KEY + REGION` | CRITICAL | Text translation broken |
| OpenAI | `OPENAI_API_KEY` | CRITICAL | Realtime translation paths |
| Deepgram | `DEEPGRAM_API_KEY` | Important | STT fallback |
| Razorpay | `RAZORPAY_KEY_ID + SECRET` | Important | Payments broken |
| MSG91 | `MSG91_AUTH_KEY` | Optional | PSTN calls fail, app-to-app works |
| Sentry | `SENTRY_DSN` | Optional | Error tracking |
| PostHog | `POSTHOG_API_KEY` | Optional | Analytics |
| ElevenLabs | `ELEVENLABS_API_KEY` | Optional | Premium TTS |

### Internal Service Connections

| Service | Port | Protocol | Status |
|---------|------|----------|--------|
| HTTP API | 5000 | HTTP/REST | Express |
| WebSocket (signaling) | 5000 | ws:// | `/ws/signaling` |
| Fastify server | 5001 | HTTP | Separate — only if `ENABLE_LEGACY_SIGNALING_WS=true` |
| Media relay | 41000 | UDP | Optional TURN helper |

---

## SECTION 4 — SYNC STATUS

### What's in Sync (Working)

| Component | Synced With | Method |
|-----------|------------|--------|
| Call creation → DB | `bridgedCalls` table written immediately | Drizzle insert |
| Call end → Billing | `callBillingRecords` + `usageRecords` updated | Billing engine |
| Call end → CDR | `bridgedCalls.status = ended` + duration | gateway.endCall |
| Translation utterances → DB | `callTranslations` saved per utterance | async insert |
| User signup → DB | `users` table + session created | auth module |
| OTP verify → DB | `otpChallenges.verifiedAt` set | auth module |
| Subscription → DB | `subscriptions` + `billingAccounts` | billing routes |
| Razorpay payment → DB | `paymentTransactions` inserted | payment webhook |
| Admin actions → DB | `auditLogs` table | audit-logging.ts |
| Feature flags → DB | `featureFlagsDb` table | feature-flags.ts |
| Platform settings → DB | `platformSettings` table | config-service.ts |

### What's NOT in Sync (Problems Found)

| Problem | Impact | Fix |
|---------|--------|-----|
| Incoming call queue — in-memory Map, not Redis | Calls lost on multi-server | Move to Redis |
| 1 migration file vs 78 tables | No rollback path for prod DB | Generate full migration history |
| Fastify server (port 5001) — duplicate HTTP layer | Redundant, potential conflict | Remove or document clearly |
| `signalingSessions` table exists but legacy `use-webrtc` hook also tracks sessions | Two systems, may drift | Consolidate after VideoCall.tsx removed |
| `callTelemetry` table defined but metrics module writes to it inconsistently | Incomplete QoS data | Audit metrics.ts |

---

## SECTION 5 — DOCUMENTS NEEDED FOR MARKET LAUNCH

### A. Legal Documents (All website pages EXIST in code — need real content)

| Document | File | Status | What's Needed |
|----------|------|--------|---------------|
| Terms of Service | `client/src/pages/website/TermsPage.tsx` | Page exists, content needed | Full legal ToS with governing law (India), dispute resolution, account termination clauses |
| Privacy Policy | `client/src/pages/website/PrivacyPage.tsx` | Page exists, content needed | GDPR + India PDPB compliant policy covering: data collected, how used, retention, deletion, third parties |
| Data Processing Agreement | `client/src/pages/website/DPAPage.tsx` | Page exists, content needed | B2B DPA for companies using NeuraTalk (data controller vs processor roles) |
| Cookie Policy | Missing page | Not created | Required for EU users |
| Refund Policy | Missing page | Not created | Required for Razorpay payments |
| Copyright Notice | `client/src/pages/website/CopyrightPage.tsx` | Page exists | Fill in year, company name, trademark info |

### B. Technical Documents (For Developers/API Customers)

| Document | File | Status | What's Needed |
|----------|------|--------|---------------|
| API Documentation | `client/src/pages/ApiDocs.tsx` | Page exists (24KB) | Review accuracy — match actual endpoints |
| SDK Docs | `client/src/pages/website/SDKDocsPage.tsx` | Page exists | Fill with real SDK code examples |
| Webhook Reference | Missing | Not created | Document MSG91, Razorpay, LiveKit webhook formats |
| Rate Limits Guide | Missing | Not created | Document per-endpoint limits |

### C. Business Documents (For Investors & Enterprise)

| Document | Status | What's Needed |
|----------|--------|---------------|
| Investor Dashboard | `InvestorDashboard.tsx` exists | Populate with real metrics |
| Pricing Page | `client/src/pages/website/PricingPage.tsx` exists | Set real prices, INR + USD |
| Enterprise Proposal Template | Missing | Sales collateral for B2B companies |
| SLA Agreement | Missing | Uptime guarantee % for enterprise orgs |

### D. Operational Documents (For Running the App)

| Document | Status | What's Needed |
|----------|--------|---------------|
| Deployment Checklist | `DEPLOYMENT_CHECKLIST.md` exists | Review and update for latest changes |
| Environment Setup Guide | `.env.example` exists | Create a "minimum viable .env" — list only the 12 truly critical vars |
| Database Backup Policy | Missing | Neon automatic backups — document retention period |
| Incident Response Runbook | Missing | What to do when calls fail / billing breaks |
| On-Call Escalation | Missing | Who to call and when |

### E. Compliance Documents (GDPR + India PDPB)

| Document | Status | What's Needed |
|----------|--------|---------------|
| Data Retention Policy | Schema has `dataRetentionDays` column | Write policy doc: calls = 30 days, messages = X days |
| Data Deletion Process | `dataSubjectRequests` table exists | Document how users can request deletion (GDPR Article 17) |
| Data Residency Policy | `dataResidencyPolicies` table exists | Specify: India data stays in `centralindia` region |
| Security Incident Response | Missing | Required for enterprise contracts |
| Penetration Test Report | Missing | Needed before enterprise sales |

---

## SECTION 6 — PRIORITY CHECKLIST BEFORE MARKET LAUNCH

### Critical (Must Fix Before Launch)

- [ ] Run `npx drizzle-kit generate` — create proper migration files for all 78 tables
- [ ] Move incoming call queue from in-memory Map to Redis
- [ ] Set all CRITICAL env vars in production (see Section 3)
- [ ] Test `assertDatabaseReady()` against live Neon DB
- [ ] Test `assertRedisReady()` against live Redis (Upstash / Railway Redis)
- [ ] End-to-end call test: create call → connect → translate → end → check billing record in DB
- [ ] Verify `callBillingRecords` written correctly after test call
- [ ] Verify `usageRecords` written correctly after test call

### Important (Before First Paying Customer)

- [ ] Legal: Fill Terms of Service, Privacy Policy, DPA with real legal content
- [ ] Legal: Add Cookie Policy and Refund Policy pages
- [ ] Billing: Set real Razorpay keys, test payment end-to-end
- [ ] Billing: Verify invoice generated after payment
- [ ] Auth: Test Firebase Phone OTP in production (not dev mode)
- [ ] Verify `otpChallenges.verifiedAt` set after successful OTP

### Good Practice (Before Scale)

- [ ] Generate DB migration files (not just push)
- [ ] Remove Fastify server (port 5001) if not needed — or document its purpose
- [ ] Move `signalingSessions` fully to new signaling system
- [ ] Add `HEALTHCHECK` instruction to Dockerfile
- [ ] Set up DB connection monitoring (Neon dashboard alerts)
- [ ] Set up Redis monitoring (Upstash dashboard alerts)
- [ ] Write DB backup schedule (Neon auto-backup + manual weekly export)

---

## SECTION 7 — MINIMUM ENV VARS (Production Checklist)

These 12 vars MUST be set. Without any one of these, the app either crashes or core feature breaks.

```env
# 1. Database
DATABASE_URL=postgresql://user:pass@host/neuratalk?sslmode=require

# 2. Redis
REDIS_URL=redis://your-upstash-or-railway-redis

# 3. Session
SESSION_SECRET=minimum-32-character-random-string

# 4. LiveKit (calls crash without this)
LIVEKIT_URL=wss://your-livekit-server
LIVEKIT_API_KEY=your-key
LIVEKIT_API_SECRET=your-secret

# 5. Firebase (auth broken without this)
FIREBASE_SERVICE_ACCOUNT_JSON={"type":"service_account",...}
VITE_FIREBASE_API_KEY=your-key
VITE_FIREBASE_PROJECT_ID=your-project
VITE_FIREBASE_APP_ID=your-app-id

# 6. Azure Speech (voice translation broken without this)
AZURE_SPEECH_KEY=your-key
AZURE_SPEECH_REGION=centralindia

# 7. Azure Translator
AZURE_TRANSLATOR_KEY=your-key
AZURE_TRANSLATOR_REGION=centralindia

# 8. OpenAI (realtime translation)
OPENAI_API_KEY=sk-your-key

# 9. Public URL (webhooks need this)
APP_BASE_URL=https://api.neuratalk.app

# 10. Razorpay (payments)
RAZORPAY_KEY_ID=rzp_live_xxx
RAZORPAY_KEY_SECRET=your-secret
```

---

## SUMMARY

| Area | Score | Notes |
|------|-------|-------|
| DB Schema | 9/10 | 78 tables, proper FKs, good design |
| DB Connection | 9/10 | Pool, SSL, cold-start handled |
| Redis Connection | 9/10 | Smart fallback, locks, clean shutdown |
| Migration History | 4/10 | Only 1 file — need proper history |
| Startup Reliability | 8/10 | Phases with timeout, retry logic |
| Sync (DB ↔ App) | 7/10 | Incoming call queue not in Redis |
| Legal Documents | 3/10 | Pages exist, real content missing |
| Technical Docs | 6/10 | API docs page exists, needs accuracy check |
| Compliance Docs | 4/10 | Framework in DB, policies not written |
| Deployment Docs | 7/10 | Multiple guides exist |

**Overall: 7/10 — Strong technical foundation. Legal + one Redis sync issue = the only blockers for market.**
