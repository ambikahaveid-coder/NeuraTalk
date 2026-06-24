# Week 1 Day 1 Summary Template

Use this after finishing the Day 1 operator checklist.

Reference:
- [WEEK1_DAY1_OPERATOR_CHECKLIST.md](C:/Users/kiran/Downloads/Neura-Talk%20(1)/Neura-Talk/docs/WEEK1_DAY1_OPERATOR_CHECKLIST.md)
- [WEEK1_APP_TO_APP_RESULTS_TEMPLATE.csv](C:/Users/kiran/Downloads/Neura-Talk%20(1)/Neura-Talk/docs/WEEK1_APP_TO_APP_RESULTS_TEMPLATE.csv)

## Day 1 Summary

Date:

Operators:

Environment:
- devices:
- networks:
- audio setup:
- test location:

Primary path confirmed:
- app-to-app: yes/no
- Azure STT primary: yes/no
- Deepgram fallback only: yes/no
- legacy signaling not exercised: yes/no

## Call Count

- total calls attempted:
- passed:
- failed:
- blocked:

## Calls Executed

| Scenario | Mode | Network | Environment | Result | Call ID | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| Telugu quiet |  |  |  |  |  |  |
| English quiet |  |  |  |  |  |  |
| Telugu translated |  |  |  |  |  |  |
| Hindi quiet |  |  |  |  |  |  |

## Metrics Snapshot

From `voice`:

- transcriptConfidence.p50:
- transcriptConfidence.p95:
- transcriptConfidence.p99:
- reconnectRecoveryMs.p50:
- reconnectRecoveryMs.p95:
- interruptionRecoveryMs.p50:
- interruptionRecoveryMs.p95:
- duplicateTurnRate:
- staleTranscriptRate:
- overlapRate:
- reconnectRecoveryRate:
- confidenceCoverageRate:

From `pipeline`:

- stt.p50:
- stt.p95:
- translation.p50:
- translation.p95:
- tts.p50:
- tts.p95:
- total.p50:
- total.p95:

## User-Visible Failures

- duplicate turns heard:
- stale transcript replay seen:
- ghost audio after reconnect:
- subtitle drift:
- delayed barge-in cancellation:
- collapse events:

## Top 3 Failure Patterns

1.
2.
3.

## Evidence Links

- CSV rows:
- screen recordings:
- server logs:
- admin metrics snapshot:
- metrics scrape:
- traces or correlation IDs:

## Day 1 Decision

- go for Day 2 expansion: yes/no
- if no, blocking issue:

## Truth Label

If evidence is incomplete, explicitly mark:

`NOT FIELD VERIFIED`
