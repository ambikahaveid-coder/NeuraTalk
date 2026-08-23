# Call Architecture Consolidation Plan

## Current state (evidence)

Multiple overlapping call-session models coexist, and the schema's own comments confirm this is deliberate dual-path support, not an oversight:

| Model | Tables | Status |
|---|---|---|
| Legacy bridged calls | `bridgedCalls` (integer `callSid`) | Legacy telephony bridge path |
| Current smart calls | `communicationSessions`, `communicationSessionEvents`, `signalingSessions` | LiveKit/smart-router path — this session's active development target |
| Bridge | `callTranslations.callId` (legacy int, nullable) / `callTranslations.smartCallId` (current string, nullable) | Explicit dual-path bridge column |
| Participants | `callParticipants` (generic, largely unused — 1 file reference) vs `meetingParticipants` (meeting-specific) | Overlapping join/leave/role/mute semantics |

**Weak referential integrity, specifically on call tables:** `bridgedCalls`, `callParticipants`, `callTelemetry`, and `usageRecords.callId` all use plain integers with no `.references()` constraint — inconsistent with almost every other table in the schema, which is FK-constrained. This is a correctness risk for billing and telemetry that grows with every new call path layered on top (PSTN, conferences, queue transfers).

## Target: one canonical call domain

Per the source brief, the canonical model must represent:

```
CALL              id, type: 'voice' | 'video' | 'conference', createdAt, endedAt, terminationReason
PARTICIPANT       callId, participantType: 'user' | 'pstn' | 'bot', identity, role, joinedAt, leftAt
SESSION           callId, provider: 'livekit' | 'pstn_bridge', providerSessionId
MEDIA_SESSION     sessionId, trackType, codec, bitrate (real-time quality telemetry)
CALL_STATE        callId, state, transitionedAt, transitionReason (canonical state machine — the smart-call lifecycle machine in `server/modules/calls/lifecycle.ts` is the correct existing implementation to generalize from, not replace)
ROUTING           callId, method: 'direct' | 'queue' | 'ivr', queueId, agentId
RECORDING         callId, status, url, consentVerifiedAt
TRANSCRIPT        callId, participantId, text, language, timestamp
TRANSLATION       callId, sourceLanguage, targetLanguage, latencyMs (see `01_CURRENT_STATE_ARCHITECTURE.md` for current unverified status)
AI_PROCESSING     callId, feature: 'translation' | 'coaching' | 'summary', metadata
CONSENT           callId, participantId, consentVersion, grantedAt (existing `callConsents`/`call-privacy.ts` is real and should be the reused implementation)
BILLING           callId, ratePerMinute, durationSeconds, amountCharged (existing `billing-engine.ts` reused, re-pointed at canonical `CALL`)
TERMINATION_REASON callId, reason, reportedBy: 'client' | 'server' | 'watchdog'
```

`bridgedCalls` and `communicationSessions` both become `CALL` rows distinguished by `session.provider`; `callParticipants` and `meetingParticipants` both become `PARTICIPANT` rows distinguished by `participantType`.

## Migration strategy

1. **Add FK constraints first, independent of consolidation.** `bridgedCalls.callSid`, `callParticipants.callId`, `callTelemetry.callId`, `usageRecords.callId` should get proper `.references()` constraints as an isolated, low-risk migration before any model consolidation — this catches orphaned-record bugs immediately and doesn't require touching call logic.
2. **New calls write canonical only.** Rather than a dual-write period (call state is higher-velocity and more failure-sensitive than messages), new calls after a cutover date write directly to the canonical model; historical calls stay in their original tables and are queried through the canonical shape via a read-time adapter.
3. **Backfill for reporting continuity.** Historical `bridgedCalls`/`communicationSessions` rows get a one-time batch migration into `CALL` for unified billing/analytics reporting, preserving original IDs as `legacySourceId`.
4. **Termination-reason instrumentation ships first.** This session already started this (client now reports real LiveKit disconnect reasons instead of a generic "completed" — see git history around commit `0b875c0`). Extending that instrumentation across the consolidated model, rather than redoing it, directly serves the still-open "why did the call end" diagnostic gap.
5. **Rollback:** revert to writing new calls to the legacy tables; canonical tables are additive until the read-path cutover, so rollback at any point before that cutover is a config flip, not a data operation.

## Tests required before cutover

- State-machine parity: every legal transition in the existing `lifecycle.ts` smart-call state machine must be representable and enforced identically in `CALL_STATE`.
- Billing parity: a sample of historical calls, re-computed through the canonical model's `BILLING` records, must match the amounts already charged via `billing-engine.ts`.
- FK integrity test: after adding constraints (step 1), assert zero orphaned rows across `bridgedCalls`, `callParticipants`, `callTelemetry`, `usageRecords`.
- Concurrency test: simultaneous call-waiting / call-transfer scenarios (already a source of past bugs this session — the `CONCURRENT_CALL_RESTRICTED` dangling-lock issue) must not regress under the canonical model.

## Explicitly out of scope

- No change to LiveKit integration, translator-bot behavior, or PSTN provider calls — this is a data-model consolidation underneath already-working call logic, not a rewrite of call handling.
