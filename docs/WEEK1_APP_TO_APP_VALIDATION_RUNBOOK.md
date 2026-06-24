# Week 1 App-to-App Validation Runbook

Purpose:
- produce real Week 1 field evidence for the primary Neura Talk product path
- validate one stable path only: `app-to-app`, `LiveKit-first`, `Azure-first`
- capture the new runtime metrics already exposed by `/metrics`, `/api/admin/call-metrics`, and admin monitor

Scope:
- Android and iPhone
- WiFi and 4G/5G
- network switching
- noisy room
- speakerphone
- Bluetooth audio
- Telugu, Hindi, English, Hinglish, Tenglish

Not in scope:
- PSTN
- premium voice
- voice cloning
- UI polish
- roadmap work

## Tools

Required surfaces:
- `GET /metrics`
- `GET /api/admin/call-metrics`
- `WS /ws/admin-monitor`

Recommended capture:
- screen recording on both devices
- server logs with timestamps
- one operator observing admin metrics
- one operator noting user-visible failures

## Metrics To Record

From `voice` metrics:
- `transcriptConfidence.p50`
- `transcriptConfidence.p95`
- `transcriptConfidence.p99`
- `reconnectRecoveryMs.p50`
- `reconnectRecoveryMs.p95`
- `reconnectRecoveryMs.p99`
- `interruptionRecoveryMs.p50`
- `interruptionRecoveryMs.p95`
- `interruptionRecoveryMs.p99`
- `rates.duplicateTurnRate`
- `rates.staleTranscriptRate`
- `rates.transcriptRegressionRate`
- `rates.overlapRate`
- `rates.reconnectRecoveryRate`
- `rates.confidenceCoverageRate`
- `counters.translation_fallbacks`
- `counters.stale_tts_segments`
- `counters.audio_backlog_events`
- `counters.ghost_audio_drops`
- `counters.turn_order_mismatches`

From `pipeline` metrics:
- `stt.p50`
- `stt.p95`
- `stt.p99`
- `translation.p50`
- `translation.p95`
- `translation.p99`
- `tts.p50`
- `tts.p95`
- `tts.p99`
- `total.p50`
- `total.p95`
- `total.p99`

Manual observations:
- user-visible collapse event count
- ghost audio after reconnect: yes/no
- duplicate assistant turns heard: yes/no
- stale transcript replay seen: yes/no
- subtitle drift seen: yes/no
- interruption felt natural: yes/no

## Test Matrix

Languages:
- Telugu
- Hindi
- English
- Hinglish
- Tenglish

Modes:
- Original Voice
- Subtitles
- Translated Voice

Network profiles:
- WiFi
- 4G/5G
- WiFi to 4G switch
- 4G to WiFi switch

Audio environments:
- quiet room
- noisy room
- speakerphone
- Bluetooth headset

## Minimum Week 1 Execution

Run at least these 12 calls:

1. Telugu, Subtitles, WiFi, quiet room
2. Telugu, Translated Voice, WiFi, quiet room
3. Hindi, Subtitles, 4G/5G, quiet room
4. Hindi, Translated Voice, 4G/5G, quiet room
5. English, Original Voice, WiFi, quiet room
6. Hinglish, Translated Voice, WiFi, noisy room
7. Tenglish, Translated Voice, 4G/5G, noisy room
8. Telugu, Translated Voice, speakerphone
9. Hindi, Translated Voice, Bluetooth
10. Hinglish, Subtitles, WiFi to 4G switch
11. Tenglish, Subtitles, 4G to WiFi switch
12. English, Translated Voice, interruption-heavy session

For each call:
- duration: `5 minutes`
- include at least `3 interruptions`
- include at least `2 silence gaps > 3 seconds`
- include at least `1 fast-speech burst`
- include at least `1 overlapping-speech moment`

## Step Sequence Per Call

1. Reset operator notes row in the CSV template.
2. Start admin monitor and note baseline counters from `/api/admin/call-metrics`.
3. Start the app-to-app call.
4. Verify selected mode: Original Voice, Subtitles, or Translated Voice.
5. Speak the prepared phrase list for that language pair.
6. Trigger the planned condition:
   - interruption
   - silence gap
   - overlap
   - network switch
   - noisy room
7. End the call after at least 5 minutes.
8. Immediately capture:
   - `/api/admin/call-metrics`
   - `/metrics`
   - any notable server warnings/errors
9. Record user-visible failures and pass/fail result.

## Phrase Guidance

Use realistic phrases, not lab speech:
- normal greeting
- fast colloquial sentence
- mixed-language sentence
- one correction or self-interruption
- one question
- one longer explanation sentence

Examples:
- Telugu: natural colloquial daily phrases
- Hindi: daily conversation and quick-switch phrases
- Hinglish: mixed Hindi-English slang
- Tenglish: mixed Telugu-English slang

Do not use only slow clean textbook speech.

## Week 1 Pass Gates

Mark `pass` for a call only if all are true:
- no call drop
- no ghost audio after reconnect
- no repeated final translated turn heard by listener
- no stale transcript replay visible
- `translation_fallbacks` stays `0`
- `stale_tts_segments` stays `0`
- `audio_backlog_events` stays `0`
- `ghost_audio_drops` stays `0`
- `turn_order_mismatches` stays `0`
- interruption recovers without obvious stuck TTS
- translated voice or subtitles remain usable

Mark `fail` if any are true:
- permanent mute
- reconnect never recovers
- duplicate assistant/translation final turn is heard
- stale transcript reappears after newer speech
- translated voice continues after clear barge-in
- backlog watchdog resets audio during a normal clean-network call
- turn-order mismatch counter rises and users hear stale or reordered output
- subtitles drift so badly that conversation becomes unusable

## Week 1 Overall Gate

Week 1 is `NOT FIELD VERIFIED` unless all exist:
- p50/p95/p99 transcript latency
- reconnect recovery timing
- interruption recovery timing
- transcript confidence distribution
- duplicate-turn metrics
- stale-transcript metrics
- transcript-regression metrics
- translation-fallback counters
- stale-tts-segment counters
- audio-backlog / ghost-audio / turn-order counters
- overlap metrics
- per-language operator notes

## Reporting Format

At the end of each test day produce:
- completed call count
- passed call count
- failed call count
- top 3 failure patterns
- current metric snapshot
- recommended next-day fixes

At end of Week 1 produce:
- summary table by language
- summary table by mode
- summary table by network profile
- exact blockers for Week 2 soak/chaos
