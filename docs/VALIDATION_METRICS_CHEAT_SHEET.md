# Validation Metrics Cheat Sheet

Use this during live telecom validation to quickly pull the right evidence from the system.

References:
- [TELECOM_VALIDATION_MASTER_INDEX.md](C:/Users/kiran/Downloads/Neura-Talk%20(1)/Neura-Talk/docs/TELECOM_VALIDATION_MASTER_INDEX.md)
- [WEEK1_APP_TO_APP_VALIDATION_RUNBOOK.md](C:/Users/kiran/Downloads/Neura-Talk%20(1)/Neura-Talk/docs/WEEK1_APP_TO_APP_VALIDATION_RUNBOOK.md)
- [WEEK2_SOAK_AND_RECONNECT_CHAOS_RUNBOOK.md](C:/Users/kiran/Downloads/Neura-Talk%20(1)/Neura-Talk/docs/WEEK2_SOAK_AND_RECONNECT_CHAOS_RUNBOOK.md)
- [WEEK4_OPS_AND_INCIDENT_PROOF_RUNBOOK.md](C:/Users/kiran/Downloads/Neura-Talk%20(1)/Neura-Talk/docs/WEEK4_OPS_AND_INCIDENT_PROOF_RUNBOOK.md)

## Primary Evidence Surfaces

- `GET /api/admin/call-metrics`
- `GET /metrics`
- `WS /ws/admin-monitor`

Use:
- `/api/admin/call-metrics` for operator-friendly JSON snapshots
- `/metrics` for Prometheus-style counters and percentiles
- `admin-monitor` for live event watching during calls and incidents

## `/api/admin/call-metrics`

Primary sections:
- `pipeline`
- `voice`

Backward-compatible flat keys also exist:
- `stt`
- `translation`
- `tts`
- `total`

### Pipeline Fields To Read

- `pipeline.stt.p50`
- `pipeline.stt.p95`
- `pipeline.stt.p99`
- `pipeline.translation.p50`
- `pipeline.translation.p95`
- `pipeline.translation.p99`
- `pipeline.tts.p50`
- `pipeline.tts.p95`
- `pipeline.tts.p99`
- `pipeline.total.p50`
- `pipeline.total.p95`
- `pipeline.total.p99`

Meaning:
- `stt`: speech-to-text latency
- `translation`: model/orchestration latency
- `tts`: text-to-speech latency
- `total`: end-to-end processing latency

### Voice Fields To Read

- `voice.transcriptConfidence.p50`
- `voice.transcriptConfidence.p95`
- `voice.transcriptConfidence.p99`
- `voice.reconnectRecoveryMs.p50`
- `voice.reconnectRecoveryMs.p95`
- `voice.reconnectRecoveryMs.p99`
- `voice.interruptionRecoveryMs.p50`
- `voice.interruptionRecoveryMs.p95`
- `voice.interruptionRecoveryMs.p99`
- `voice.rates.duplicateTurnRate`
- `voice.rates.staleTranscriptRate`
- `voice.rates.transcriptRegressionRate`
- `voice.rates.overlapRate`
- `voice.rates.reconnectRecoveryRate`
- `voice.rates.confidenceCoverageRate`
- `voice.counters.translation_fallbacks`
- `voice.counters.stale_tts_segments`
- `voice.counters.audio_backlog_events`
- `voice.counters.ghost_audio_drops`
- `voice.counters.turn_order_mismatches`

Meaning:
- `transcriptConfidence`: STT confidence distribution
- `reconnectRecoveryMs`: time to become usable after reconnect
- `interruptionRecoveryMs`: time to recover after barge-in
- `duplicateTurnRate`: repeated final response symptom rate
- `staleTranscriptRate`: replay of old transcript symptom rate
- `transcriptRegressionRate`: out-of-order or regressed partial transcript symptom rate
- `overlapRate`: overlap or barge-in pressure rate
- `reconnectRecoveryRate`: reconnect success quality
- `confidenceCoverageRate`: how often confidence is actually present
- `translation_fallbacks`: controlled degradations where voice playback fell back to text-safe delivery
- `stale_tts_segments`: queued TTS chunks dropped before synthesis because they aged past realtime-safe limits
- `audio_backlog_events`: watchdog resets triggered to avoid delayed/stacked audio
- `ghost_audio_drops`: stale queued audio dropped during interruption/recovery
- `turn_order_mismatches`: stale turn callbacks blocked after turn advancement or reconnect

## `/metrics`

Prometheus-style series to capture during validation:

- `neuratalk_pipeline_latency_ms`
- `neuratalk_voice_latency_ms`
- `neuratalk_voice_signal_total`
- `neuratalk_voice_signal_rate`
- `neuratalk_provider_health_score`
- `neuratalk_provider_circuit_breaker_open`

### Key Labels

Pipeline metric labels:
- `stage=stt`
- `stage=translation`
- `stage=tts`
- `stage=total`
- `quantile=p50|p95|p99`

Voice latency metric labels:
- `metric=reconnect_recovery_ms`
- `metric=interruption_recovery_ms`
- `quantile=p50|p95|p99`

Voice signal counter labels:
- `metric=transcript_events`
- `metric=transcript_finals`
- `metric=transcript_confidence_samples`
- `metric=transcript_confidence_missing`
- `metric=transcript_regressions`
- `metric=translation_fallbacks`
- `metric=stale_tts_segments`
- `metric=duplicate_turns`
- `metric=audio_backlog_events`
- `metric=ghost_audio_drops`
- `metric=turn_order_mismatches`
- `metric=stale_transcripts`
- `metric=overlap_events`
- `metric=reconnect_started`
- `metric=reconnect_recovered`

Voice signal rate labels:
- `metric=duplicate_turn_rate`
- `metric=stale_transcript_rate`
- `metric=transcript_regression`
- `metric=overlap_rate`
- `metric=reconnect_recovery_rate`
- `metric=confidence_coverage_rate`

## Field-Test Thresholds

Use these as the default pass/fail thresholds until replaced by measured production baselines.

### Week 1 App-to-App

- `duplicateTurnRate`: beta target `<= 1.0%`, GA target `<= 0.2%`
- `staleTranscriptRate`: beta target `<= 1.0%`, GA target `<= 0.2%`
- `transcriptRegressionRate`: beta target `<= 2.0%`, GA target `<= 0.5%`
- `translation_fallbacks`: normal calls target `0`, soak target `<= 1` per 30 minutes if text translation remains usable
- `stale_tts_segments`: normal calls target `0`, chaos target `<= 1` only if no user-audible stale playback occurs
- `audio_backlog_events`: normal calls target `0`, soak target `<= 1` per 30 minutes
- `ghost_audio_drops`: normal calls target `0`, chaos target `<= 1` if no user-visible collapse
- `turn_order_mismatches`: normal calls target `0`, reconnect-chaos target `<= 1` if no stale replay is heard

### Automatic Blockers

- any `audio_backlog_events > 0` during a short clean-network demo call
- any repeated `translation_fallbacks` in normal clean-network app-to-app usage
- any repeated `ghost_audio_drops` in normal app-to-app usage
- any audible stale replay after reconnect even if `turn_order_mismatches` stays low
- any monotonic increase of backlog/ghost counters during soak tests

### Logging Rule

Whenever any of these counters increments:

1. capture `/api/admin/call-metrics`
2. capture `/metrics`
3. note call ID / room ID
4. note whether the user heard delayed audio, stale replay, or interruption failure

## What To Capture By Week

### Week 1

Capture after every call:
- `pipeline.stt/translation/tts/total` p50/p95/p99
- `voice.transcriptConfidence` p50/p95/p99
- `voice.reconnectRecoveryMs` p50/p95/p99
- `voice.interruptionRecoveryMs` p50/p95/p99
- duplicate, stale, overlap, reconnect, confidence rates

Manual notes:
- translation engaged
- ghost audio
- duplicate turn heard
- stale transcript seen
- subtitle drift
- interruption felt natural

### Week 2

Capture during and after soak/chaos:
- reconnect recovery percentiles
- duplicate and stale rates
- overlap rate
- provider health score
- circuit breaker open state if triggered

Add system counters from dashboards:
- heap
- websocket count
- listener count
- transcript queue depth
- audio queue depth

### Week 3

Capture for PSTN:
- pipeline latency under degraded audio
- reconnect timing if applicable
- duplicate/stale symptom rates
- provider health and failover visibility

Add manual PSTN evidence:
- caller ID behavior
- webhook replay behavior
- carrier delay timing
- degraded audio symptoms

### Week 4

Capture during incident drills:
- provider health score changes
- circuit breaker state
- reconnect recovery timing
- alert fire timing
- trace continuity observations

## Minimum Snapshot Discipline

For every significant pass or fail:

1. take `/api/admin/call-metrics` snapshot
2. take `/metrics` snapshot
3. note the correlation ID
4. note call ID or room ID
5. note visible symptom

## Truth Labels

Use these exactly when evidence is incomplete:

- `NOT FIELD VERIFIED`
- `NOT SAFE FOR GA`
- `NOT VERIFIED UNDER RECONNECT CHAOS`
- `OBSERVABILITY NOT PROVEN`
