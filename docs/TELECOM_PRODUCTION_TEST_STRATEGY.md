# Telecom Production Test Strategy

This document is the production-level QA strategy for Neura-Talk across web, mobile, app-to-app, app-to-PSTN, B2B, B2C, and C2C call flows.

Strict rule:

- call audio is primary
- translation is secondary
- translation failure must never break the call

## Scope

Covered systems:

- Web app
- React Native mobile app
- Node.js backend
- LiveKit media layer
- STT -> translation -> TTS pipeline
- PSTN bridge and provider webhook paths

Covered business flows:

- B2B control-room and agent calls
- B2C consumer calls and subscriptions
- C2C direct calls
- app-to-app calls
- app-to-PSTN calls
- PSTN-to-app return/inbound paths where configured

## Phase 1: Test Plan Design

### 1. Call Flow Matrix

#### App-to-App

- A2A-01: same-language voice call, translation disabled by inference
- A2A-02: same-language video call, translation disabled by inference
- A2A-03: cross-language voice call, subtitles mode
- A2A-04: cross-language voice call, voice translation mode
- A2A-05: cross-language video call, voice translation mode
- A2A-06: mid-call switch from `off` -> `subtitles`
- A2A-07: mid-call switch from `subtitles` -> `voice`
- A2A-08: mid-call switch from `voice` -> `off`

#### App-to-PSTN

- PSTN-01: app user calls Android mobile, original voice mode
- PSTN-02: app user calls Android mobile, voice translation mode
- PSTN-03: app user calls iPhone mobile, voice translation mode
- PSTN-04: app user calls real number with unsupported target language fallback
- PSTN-05: app user call rejected by callee
- PSTN-06: provider no-answer timeout
- PSTN-07: provider webhook delayed or missing

#### PSTN-to-App / Return Path

- P2A-01: DID/inbound call wakes app user
- P2A-02: inbound app accept path
- P2A-03: inbound reject path
- P2A-04: inbound translation voice mode

#### B2B

- B2B-01: company admin starts outbound call manually
- B2B-02: selected agent is used as acting caller
- B2B-03: auto-routing enabled call
- B2B-04: queue assignment to specific agent
- B2B-05: two concurrent calls with live status update
- B2B-06: control-room reflects call end without ghost state

#### C2C / B2C

- C2C-01: direct app-to-app voice
- C2C-02: direct app-to-app video
- C2C-03: direct app-to-PSTN fallback
- B2C-01: consumer with active plan initiates paid call
- B2C-02: low-balance consumer blocked or cut safely

### 2. Translation Coverage

Required language pairs:

- TR-TE-EN: Telugu <-> English
- TR-HI-EN: Hindi <-> English
- TR-TE-HI: Telugu <-> Hindi
- TR-MIX-01: Tenglish
- TR-MIX-02: Hinglish
- TR-UNSUP-01: unsupported language fallback

For each pair test:

- clean speech
- fast speech
- noisy environment
- weak network
- same-language auto-disable sanity

### 3. Mode Coverage

For each relevant call flow verify:

- MODE-01: `off`
- MODE-02: `subtitles`
- MODE-03: `voice`

Must confirm:

- `off`: original voice only
- `subtitles`: original voice remains, translated text only
- `voice`: translated audio only after `tts_ready`; no fake suppression before that

### 4. Edge Cases

- EDGE-01: network drop mid-call
- EDGE-02: reconnect on same network
- EDGE-03: WiFi -> mobile switch
- EDGE-04: mobile -> WiFi switch
- EDGE-05: STT low confidence final transcript
- EDGE-06: TTS latency > 3s
- EDGE-07: translation provider failure
- EDGE-08: TTS provider failure
- EDGE-09: remote reject
- EDGE-10: token expiry
- EDGE-11: app backgrounded
- EDGE-12: app killed then reopened

## Phase 2: Structured Execution Test Cases

Use the following format for every test case.

```text
Test ID:
Scenario:
Preconditions:
Steps:
Expected Result:
Pass Criteria:
Fail Criteria:
Evidence Required:
```

### A. Call Quality Cases

#### CQ-01

- Scenario: Two-way app-to-app audio
- Steps:
  1. Start cross-language voice call between two app users
  2. Speak alternately for 2 minutes
  3. Verify both users hear audio
- Expected Result: two-way audio is continuous, no clipping, no unexpected mute
- Pass Criteria: both users hear each other continuously, no drop, no echo loop
- Fail Criteria: silence, one-way audio, severe clipping, repeated reconnect

#### CQ-02

- Scenario: No double audio in voice translation mode
- Steps:
  1. Start cross-language app-to-app call in `voice` mode
  2. Wait for `tts_ready`
  3. Speak in source language
- Expected Result: listener hears translated voice only after ready, not original plus translated overlap
- Pass Criteria: no double voice, no echo, no original foreign speech leak after switch
- Fail Criteria: original + translated audio overlap, or original is muted before translated voice is ready

#### CQ-03

- Scenario: Long-duration stability
- Steps:
  1. Keep an app-to-app call active for 30 minutes
  2. Alternate speaking every minute
- Expected Result: call remains connected and usable
- Pass Criteria: no unplanned disconnect, no media degradation beyond acceptable jitter
- Fail Criteria: drop, memory runaway, or translation pipeline stalls call audio

### B. Translation Cases

#### TR-EXEC-01

- Scenario: Telugu to English subtitles
- Steps:
  1. Caller speaks Telugu
  2. Receiver prefers English
  3. Translation mode is `subtitles`
- Expected Result: listener hears original voice and sees English subtitles only
- Pass Criteria: translated text meaning preserved, no fake lines when confidence is low
- Fail Criteria: empty fake subtitles, untranslated junk, or original voice suppressed

#### TR-EXEC-02

- Scenario: Hindi to English voice translation
- Steps:
  1. Start call in `voice` mode
  2. Speaker uses Hindi
  3. Measure time to `tts_ready`
- Expected Result: translated audio delivered within target or call stays on original voice
- Pass Criteria: translated audio heard in under 3 seconds average
- Fail Criteria: silence, audio break, or translation UI shows success without translated audio

#### TR-EXEC-03

- Scenario: mixed-language sentence
- Steps:
  1. Speak Hinglish sentence with slang
  2. Observe translation output
- Expected Result: best-effort semantic translation or safe fallback
- Pass Criteria: understandable meaning preserved
- Fail Criteria: broken literal word salad presented as confident translation

### C. Network Cases

#### NET-01

- Scenario: WiFi to 4G handoff during live app-to-app call
- Steps:
  1. Start active call
  2. Disable WiFi on one device
  3. Continue speaking during handoff
- Expected Result: state moves to reconnecting if needed, then returns to connected
- Pass Criteria: call survives, audio recovers, no permanent mute
- Fail Criteria: call drops or translation path kills primary audio

#### NET-02

- Scenario: 5 percent packet loss
- Steps:
  1. Simulate packet loss in test network
  2. Run voice translation mode
- Expected Result: degraded quality allowed, but audio stays alive and translation can fall back
- Pass Criteria: call continues, fallback triggers logged
- Fail Criteria: total media failure or misleading healthy state

### D. Telecom Validation Cases

#### TEL-01

- Scenario: Caller ID correctness on PSTN
- Steps:
  1. Place app-to-PSTN call
  2. Capture recipient caller ID screenshot
  3. Compare to backend `callerIdentityMode`
- Expected Result: displayed number matches allowed mode or provider override is explicitly observed
- Pass Criteria: evidence aligns with route and UI promise
- Fail Criteria: UI promised personal number but provider ID showed instead without clear disclosure

#### TEL-02

- Scenario: DID inbound call
- Steps:
  1. Call inbound DID or PSTN bridge number
  2. Verify app wake, ring, accept, and connect
- Expected Result: inbound route reaches target user reliably
- Pass Criteria: incoming ring + accept path works
- Fail Criteria: missed routing, no wake, no media

## Phase 3: Real Device Testing

### Android

Test minimum:

- low-end Android with battery optimization on
- low-end Android with battery optimization off
- high-end Android on WiFi
- high-end Android on 4G/5G

Validate:

- OTP login
- push registration
- foreground call
- background incoming call
- app killed incoming call
- Bluetooth switching
- speaker/earpiece switching

### iPhone

Validate:

- OTP login
- APNs / PushKit wake
- CallKit incoming screen
- accept / reject path
- background resume
- Bluetooth and wired headset switching

## Phase 4: Load & Stress Testing

### Concurrency Targets

- 10 simultaneous app-to-app calls
- 10 simultaneous translation subtitle sessions
- 5 simultaneous voice-translation sessions
- 20 quick dial attempts within 60 seconds

### Stress Scenarios

- LOAD-01: call storm of 20 initiation attempts in 1 minute
- LOAD-02: translation provider slowdown under concurrency
- LOAD-03: TTS queue backlog
- LOAD-04: mixed B2B + consumer traffic during active control-room use

### Observe

- CPU
- memory
- WebSocket signaling stability
- LiveKit participant churn
- translation latency percentile
- call success rate under load

## Phase 5: Logging & Metrics

Track per call:

- callId
- flow type
- route used
- callerIdentityMode
- caller language
- callee/listener language
- translationMode
- STT confidence
- translation latency
- TTS latency
- fallback triggered
- reconnect count
- final call outcome

Key KPIs:

- call connect success rate
- post-answer drop rate
- translation success rate
- average translation latency
- P95 translation latency
- TTS failure rate
- fallback frequency

## Phase 6: Failure and Fallback Validation

Must be proven:

- translation failure does not end call
- TTS failure falls back to original voice or subtitles safely
- unsupported language does not break UI or audio
- low-confidence STT does not generate fake confident subtitles
- delayed `tts_ready` does not suppress original voice too early

## Phase 7: Final Report Rules

The final certification report must include:

- pass/fail summary by module
- critical issues
- real-world risk areas
- production readiness score
- go/no-go recommendation

Strict go-live gate:

- zero unresolved critical call-audio issues
- zero unresolved caller-identity truth mismatches
- translation failure proven safe in all tested modes
- at least 15 real successful calls across app/app and PSTN
- at least 3 real payment validations
- Android and iPhone background call paths proven

## Execution Notes

What can be executed from repo-only validation:

- TypeScript compile checks
- build checks
- smoke assertions
- config and route truth audit

What cannot be honestly certified from repo-only validation:

- real caller ID display
- real PSTN media quality
- real push wake behavior
- real background survival on devices
- real translation accuracy under live noise
