# Week 2 Soak And Reconnect Chaos Runbook

Purpose:
- prove the primary app-to-app path survives time, reconnect instability, and controlled degradation
- generate hard evidence for memory stability, websocket stability, queue stability, and recovery timing

Scope:
- app-to-app only
- LiveKit-first transport
- Azure-first STT/TTS path
- multilingual switching
- interruption-heavy sessions
- reconnect-heavy sessions

Not in scope:
- PSTN
- premium voice
- UI behavior outside realtime call stability

## Required Surfaces

- `GET /metrics`
- `GET /api/admin/call-metrics`
- `WS /ws/admin-monitor`
- process memory samples from server host
- server logs with timestamps

## Core Week 2 Rules

Any of the following is an automatic GA blocker:
- monotonic heap growth without stabilization
- websocket count that only rises and does not recover
- listener count that only rises and does not recover
- retry accumulation that only rises through reconnect cycles
- reconnect loop accumulation
- transcript queue growth without drain
- audio queue growth without drain
- orphan session accumulation
- stale room accumulation
- stale audio replay

If reconnect chaos is incomplete:
- mark `NOT VERIFIED UNDER RECONNECT CHAOS`

If soak evidence is incomplete:
- mark `NOT SAFE FOR GA`

## Metrics To Capture

From `voice`:
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
- `counters.translation_fallbacks`
- `counters.stale_tts_segments`
- voice counters before and after each run

From `pipeline`:
- `stt.p50/p95/p99`
- `translation.p50/p95/p99`
- `tts.p50/p95/p99`
- `total.p50/p95/p99`

From runtime host:
- heap used
- rss
- event loop lag
- cpu percent if available
- websocket count
- active translator bot count
- active call count

Manual observations:
- call survived yes/no
- reconnect recovered yes/no
- stale audio replay yes/no
- user-visible collapse event count
- duplicate final turn heard yes/no

## Soak Matrix

Run these minimum sessions:

1. `30-minute` Telugu/Hindi alternating session
2. `30-minute` Hinglish/Tenglish switching session
3. `1-hour` English/Telugu translated voice session
4. `1-hour` interruption-heavy bilingual session
5. `30-minute` reconnect-heavy session with planned network changes
6. `concurrent multi-room` run with at least 3 simultaneous active app-to-app sessions for 20 minutes

## Per-Session Requirements

Every soak session must include:
- at least `10 interruptions`
- at least `5 silence gaps > 5 seconds`
- at least `3 overlapping-speech moments`
- at least `2 network changes` for reconnect-focused sessions
- at least `1 mode verification` if testing subtitles vs translated voice

## Sampling Schedule

Capture a snapshot at:
- `T+0`
- `T+5 min`
- `T+10 min`
- `T+15 min`
- `T+20 min`
- `T+30 min`
- `T+45 min`
- `T+60 min`
- end of session

At each sample point record:
- `/api/admin/call-metrics`
- `/metrics`
- heap and rss
- active calls
- active translator bots
- notable warnings/errors

## Reconnect Chaos Scenarios

Run at least these controlled failures:

1. websocket disconnect storm
2. LiveKit reconnect storm
3. WiFi to 4G switch loop
4. 4G to WiFi switch loop
5. packet loss simulation
6. delayed RTP simulation
7. worker crash recovery
8. Azure timeout / degraded latency simulation
9. OpenAI timeout simulation

## Reconnect Chaos Execution Rules

For each chaos run:
1. start a stable app-to-app translated voice call
2. collect baseline metrics
3. inject exactly one failure condition
4. observe recovery for at least 2 minutes
5. capture post-recovery metrics
6. note whether conversation continued without collapse

## Recovery Metrics To Record

- reconnect success yes/no
- recovery start timestamp
- recovery complete timestamp
- recovery duration
- duplicate-turn delta during incident
- stale-transcript delta during incident
- transcript-regression delta during incident
- audio-backlog delta during incident
- translation-fallback delta during incident
- stale-tts-segment delta during incident
- ghost-audio-drop delta during incident
- turn-order-mismatch delta during incident
- overlap delta during incident
- any user-visible collapse

## Week 2 Pass Conditions

Mark a soak session `pass` only if:
- call remains usable for full planned duration
- no unbounded memory growth
- no unbounded websocket/listener growth
- no stale audio replay
- no stuck reconnect loop
- no permanent mute after reconnect
- duplicate final turns remain rare and explainable
- translation fallback events remain `<= 1` per 30 minutes and stay user-safe
- stale queued TTS segment drops remain `<= 1` per chaos run and produce no user-audible stale playback
- backlog watchdog events remain `<= 1` per 30 minutes
- ghost audio drops remain explainable and do not produce user-visible collapse
- turn-order mismatches remain `0` in normal soak and `<= 1` in chaos runs

Mark a chaos run `pass` only if:
- reconnect or failover completes
- conversation resumes
- counters stabilize after incident
- no orphan session remains active after cleanup
- no stale transcript replay is observed
- no repeated backlog resets after recovery

## Required Deliverables End Of Week 2

- soak graphs
- reconnect recovery percentiles
- interruption recovery percentiles
- memory trend chart
- websocket trend chart
- queue trend summary
- orphan session count summary
- chaos run table with recovery times
- exact list of GA blockers found

## Reporting Format

At end of each day:
- sessions run
- sessions passed
- sessions failed
- chaos runs completed
- top 3 failure patterns
- current blockers

At end of Week 2:
- `NOT SAFE FOR GA` if soak proof is incomplete
- `NOT VERIFIED UNDER RECONNECT CHAOS` if reconnect chaos proof is incomplete
- explicit list of monotonic-growth findings
