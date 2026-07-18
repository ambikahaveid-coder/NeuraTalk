# Neura Talk — 300ms Class Realtime Conversation Battle Plan

## Core Principle

We are not building:

- a translator app
- a chatbot
- a demo AI experience

We are building:

- a realtime multilingual conversation engine

Success condition:
- humans feel like they are naturally talking

Failure condition:
- robotic lag
- delayed replies
- stale audio
- duplicate turns
- interruption failure
- reconnect confusion

## Phase 1 — Latency Profiling

First rule:
- do not guess latency
- measure every stage

Measure:
1. microphone capture
2. audio encode
3. websocket transport
4. STT partial latency
5. translation latency
6. TTS first-byte latency
7. PCM playback start
8. interruption cancel latency
9. reconnect recovery latency

Capture:
- p50
- p95
- p99

Slice by:
- language
- network type
- device type
- provider
- reconnect scenario

## Phase 2 — Remove Biggest Latency Killers

Remove:
- sentence-level waiting
- full transcript buffering
- large websocket payload batching
- blocking orchestration paths
- delayed TTS generation
- stale queue playback

Mandatory:
- incremental transcript streaming
- phrase-level translation
- chunked TTS
- immediate playback
- aggressive cancellation

## Phase 3 — Interruption Correctness

Target:
- conversation should behave like humans

Need:
- instant barge-in detection
- immediate TTS stop
- stale transcript invalidation
- turn ownership reset
- stale queue flush

Hard rule:
- interrupted turns must never continue speaking

Metrics:
- cancel latency
- overlap duration
- duplicate turn rate
- stale replay rate

## Phase 4 — Audio Pipeline Optimization

Optimize:
- Azure streaming chunk size
- websocket flush cadence
- LiveKit audio frame timing
- PCM chunk sizing
- playback scheduling
- audio serialization overhead

Need:
- low jitter
- low buffering
- low queue accumulation

## Phase 5 — Bluetooth-First Face-to-Face

Preferred mode:
- Bluetooth earbuds/headsets

Why:
- echo reduction
- lower recapture
- cleaner STT
- lower conversational collapse

Need:
- hardware echo cancellation
- adaptive gain control
- ducking
- route recovery
- stale playback suppression

Speakerphone mode:
- secondary and harder

## Phase 6 — Conversational Collapse Prevention

Implement explicit detectors for:
- stale transcript replay
- duplicate assistant turns
- delayed cancellation
- transcript regression
- reconnect desync
- ghost audio
- queue overflow

Need:
- automatic mitigation
- operator visibility
- fallback emission
- structured traces

## Phase 7 — Field Validation

Real tests only.

Mandatory:
- Android
- iPhone
- WiFi
- 4G/5G
- weak network
- noisy rooms
- moving network
- Bluetooth
- speakerphone

Languages:
- Telugu
- Hindi
- English
- Hinglish
- Tenglish

Measure:
- real latency
- reconnect recovery
- interruption recovery
- transcript confidence
- collapse rate

If not measured:
- `NOT FIELD VERIFIED`

## Phase 8 — Chaos Engineering

Run:
- websocket storms
- reconnect storms
- packet loss
- Azure timeout storms
- OpenAI timeout storms
- Redis degradation
- worker crashes

Measure:
- recovery time
- retry amplification
- reconnect success
- stale replay
- collapse rate

If not executed:
- `NOT VERIFIED UNDER RECONNECT CHAOS`

## Phase 9 — What To Reject

Do not prioritize:
- fancy avatars
- cosmetic UI
- voice cloning
- premium voice styles
- marketing demos
- unnecessary AI layers

Before:
- latency
- interruption correctness
- recoverability
- observability
- stability

## Phase 10 — Ship Strategy

1. App-to-app perfection
2. Controlled beta
3. Bluetooth face-to-face hardening
4. PSTN limited beta
5. Telecom chaos proof
6. Premium naturalness later

## Final Principle

The moat is not:
- translation

The moat is:
- stable realtime multilingual human conversation

Every engineering decision must answer:
- does this reduce latency, reduce collapse, improve interruption correctness, or improve recoverability?

If not:
- do not build it
