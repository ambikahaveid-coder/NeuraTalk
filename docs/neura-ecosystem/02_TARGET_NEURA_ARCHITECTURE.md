# Target NEURA Architecture

## Module tree

```
NEURA CORE
│
├── Identity            Users · Businesses · Organizations · Permissions · Privacy · Search · Notifications · Audit
│
├── COMMUNICATION       Messaging · Voice · Video · Media
│
├── AI                  Model Gateway · Agent Runtime · RAG · Memory · Tools · AI Safety
│
├── LANGUAGE            STT · Translation · TTS
│
├── BUSINESS            Business Profiles · Pages · Catalog · Templates · Campaigns · CRM · Bookings
│
├── COMMERCE            Products · Orders · Payments · Subscriptions
│
├── MARKETING           Audience · Campaigns · Ads · Analytics
│
├── TELECOM             Numbers · SIP · PSTN · IVR · Routing
│
└── PLATFORM            API · SDK · Webhooks · Developer Console
```

This is the shape to grow into, not a rewrite. Identity, Communication's messaging/voice primitives, and most of Commerce's payment layer already have real, production-grade implementations (see `01_CURRENT_STATE_ARCHITECTURE.md`) — they get consolidated and extended, not replaced.

## What has to be true for this to work

Four architectural properties the current system does not yet have, regardless of how many surface features get added on top:

1. **One AI abstraction.** Every AI capability (translation, agents, campaigns, recommendations) calls through a single model gateway with consistent auth, cost tracking, and provider portability — not 13 independent `new OpenAI()` calls. See `05_AI_MODEL_GATEWAY_ARCHITECTURE.md`.
2. **One risk-tiered action model.** Every AI or automated action is classified READ / SUGGEST / CONFIRM / EXECUTE / HIGH-RISK before it exists, so "AI books an appointment" and "AI spends ad budget" share the same safety rail instead of each shipping its own ad hoc guard (or none). See `06_AI_SECURITY_AND_PERMISSION_MODEL.md`.
3. **One identity, one conversation model.** A person, a business, and an AI agent are all addressable participants in the same conversation primitive, not three separate schemas bolted together after the fact. See `03_MESSAGING_CONSOLIDATION_PLAN.md`.
4. **One verified core loop.** Translation, calling, and messaging must be proven to work end-to-end for real users before anything (business pages, campaigns, commerce) is built on top of them as infrastructure. See `01_CURRENT_STATE_ARCHITECTURE.md`'s translation status.

## Layered architecture

```
Clients        Flutter Mobile (real) · React Admin Web (real) · Developer SDKs (missing)
                        │
Core Platform  Auth + RBAC + Sessions (real) · Rate Limiting + Audit (real) · Notifications (real)
                        │
Domain         Messaging (real, fragmented) · Calls/Voice (real) · Billing (real)
Services       Business Profiles + Catalog (missing/partial) · Templates+Campaigns+Ads (missing) · Commerce (missing)
                        │
AI Layer       Model Gateway (missing) · STT Registry (real) · Translation (partial)
               RAG (missing) · Agent Runtime + Safety Tiers (missing)
                        │
Telecom        LiveKit WebRTC (real) · PSTN Providers (partial) · SIP (partial) · IVR (missing) · ACD Queue (real)
                        │
Data           Postgres/Neon (real) · Redis/Upstash (real) · Object Storage (real)
                        │
External       Razorpay · Firebase · Azure Speech/Translator · OpenAI · Deepgram
```

The full visual diagram (mermaid, color-coded by status) is published at:
https://claude.ai/code/artifact/444207ba-36c1-4739-8b30-ae16f208719d

## Success criteria, by actor

**Consumer:** Talk → Translate → Call → Message → AI → Action
**Business:** Create Business Page → Chat → AI Agent → Marketing → Customer Support → Commerce → Payments
**Enterprise:** Organization → Teams → Agents → Workflows → APIs → Analytics
**Developer:** API → SDK → Agent → Webhook → Integration
**Telecom:** Number → Call → AI → Translation → Routing → Compliance

None of these loops fully close today. The Enterprise loop is closest (organization/teams/agents/workflows all have real backing). The Business and Developer loops are the least built.
