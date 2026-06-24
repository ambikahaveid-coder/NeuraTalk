# Week 3 PSTN Hardening Runbook

Purpose:
- validate the secondary Neura Talk product path: `app-to-PSTN controlled fallback`
- treat PSTN as a separate telecom validation track, not as an extension of app-to-app assumptions
- generate hard evidence for carrier delay, webhook correctness, degraded-audio handling, and fallback behavior

Scope:
- one PSTN provider path first
- India mobile networks
- Android and iPhone receivers
- multilingual app-to-number calls

Not in scope:
- multi-provider production failover claims
- premium voice
- voice cloning
- PSTN GA claims before evidence exists

## Required Surfaces

- `GET /metrics`
- `GET /api/admin/call-metrics`
- `WS /ws/admin-monitor`
- PSTN provider webhook logs
- server logs with timestamps
- recipient-side screenshots or recordings for caller ID and quality notes

## Core Week 3 Rules

PSTN stays `LIMITED BETA ONLY` if any of these remain unstable:
- delayed webhook processing breaks call state
- duplicate webhooks create duplicate state transitions
- no-answer or failed-call scenarios leave stale sessions
- low-bitrate degraded audio makes translated voice unusable
- carrier delay causes repeated or stale translated turns
- provider outage handling is incomplete

Do not claim:
- telecom-grade PSTN reliability
- production failover guarantees
- carrier-independent behavior

## Metrics To Capture

From `voice`:
- `transcriptConfidence.p50`
- `transcriptConfidence.p95`
- `transcriptConfidence.p99`
- `reconnectRecoveryMs.p50`
- `reconnectRecoveryMs.p95`
- `reconnectRecoveryMs.p99`
- `interruptionRecoveryMs.p50`
- `interruptionRecoveryMs.p95`
- `interruptionRecoveryMs.p99`
- duplicate-turn rate
- stale-transcript rate
- overlap rate

From `pipeline`:
- `stt.p50/p95/p99`
- `translation.p50/p95/p99`
- `tts.p50/p95/p99`
- `total.p50/p95/p99`

Manual PSTN observations:
- caller ID shown correctly yes/no
- audio understandable yes/no
- translated voice understandable yes/no
- severe carrier delay yes/no
- no-answer handled cleanly yes/no
- duplicate webhook side effect yes/no
- user-visible collapse event count

## Minimum PSTN Test Matrix

Run at least these 10 calls:

1. Telugu app-to-number, quiet environment
2. Telugu app-to-number, noisy outdoor environment
3. Hindi app-to-number, quiet environment
4. Hindi app-to-number, weak mobile signal
5. English app-to-number, quiet environment
6. Hinglish app-to-number, noisy environment
7. Tenglish app-to-number, noisy environment
8. Telugu/Hindi mixed fast-speech PSTN call
9. app-to-number no-answer scenario
10. app-to-number delayed webhook / retry observation scenario

For each call:
- duration: `3 to 5 minutes`
- include `2 interruptions`
- include `1 silence gap > 3 seconds`
- include `1 fast-speech burst`
- include `1 overlap moment` where practical

## PSTN Scenario Add-ons

Mandatory focused checks:
- low-bitrate audio handling
- weak-signal audio handling
- outdoor noise handling
- translated voice timing under degraded carrier conditions
- subtitle or text-fallback behavior where applicable

## Per-Call Execution Steps

1. Record baseline `/api/admin/call-metrics`.
2. Record baseline `/metrics`.
3. Start the app-to-number call.
4. Capture recipient-side caller ID if relevant.
5. Run the prepared language script.
6. Trigger the planned condition:
   - outdoor noise
   - weak signal
   - fast speech
   - overlap
   - silence gap
7. End the call cleanly.
8. Capture post-call:
   - `/api/admin/call-metrics`
   - `/metrics`
   - webhook events seen
   - server warnings/errors
9. Record pass/fail and notes.

## Webhook Validation Scenarios

Run separately:

1. duplicate webhook replay
2. delayed webhook arrival
3. no-answer status transition
4. failed-call status transition
5. provider-side retry flood

For each scenario capture:
- duplicate suppression worked yes/no
- stale call state created yes/no
- orphan session created yes/no
- final stored call state correct yes/no

## Provider Failure Scenarios

Run if staging allows:

1. provider timeout
2. provider degraded latency
3. callback delay
4. provider unavailable at call initiation

Capture:
- failure surfaced clearly yes/no
- fallback behavior triggered yes/no
- user-visible collapse count
- stale session count delta

## Week 3 Pass Conditions

Mark a PSTN call `pass` only if:
- call connects or fails cleanly
- call state transitions are correct
- no duplicate webhook side effects
- no stale session remains after call end
- translated voice remains usable enough for conversation
- no severe repeated stale or duplicate translated turns

Mark `fail` if any are true:
- wrong or stuck call state
- duplicate provider event causes duplicate session actions
- no-answer leaves ghost active call
- delayed webhook corrupts final state
- translated voice timing becomes unusable
- carrier delay causes repeated confusing playback

## Week 3 Overall Gate

If PSTN instability exists:
- restrict PSTN to `LIMITED BETA ONLY`

If webhook and degraded-audio behavior are not proven:
- do not claim PSTN reliability

## Required Deliverables End Of Week 3

- PSTN call result table
- webhook replay result table
- carrier delay timing notes
- degraded-audio findings
- exact instability list
- explicit recommendation:
  - PSTN limited beta allowed
  - or PSTN remains internal only
