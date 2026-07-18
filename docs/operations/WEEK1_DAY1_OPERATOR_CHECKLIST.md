# Week 1 Day 1 Operator Checklist

Use this on the first execution day of the telecom validation program.

Purpose:
- verify the primary realtime path is the one actually under test
- prepare the operator surfaces
- complete the first app-to-app validation calls with evidence

Reference documents:
- [TELECOM_VALIDATION_MASTER_INDEX.md](C:/Users/kiran/Downloads/Neura-Talk%20(1)/Neura-Talk/docs/TELECOM_VALIDATION_MASTER_INDEX.md)
- [WEEK1_APP_TO_APP_VALIDATION_RUNBOOK.md](C:/Users/kiran/Downloads/Neura-Talk%20(1)/Neura-Talk/docs/WEEK1_APP_TO_APP_VALIDATION_RUNBOOK.md)
- [WEEK1_APP_TO_APP_RESULTS_TEMPLATE.csv](C:/Users/kiran/Downloads/Neura-Talk%20(1)/Neura-Talk/docs/WEEK1_APP_TO_APP_RESULTS_TEMPLATE.csv)
- [TESTER_CALL_SCRIPTS.md](C:/Users/kiran/Downloads/Neura-Talk%20(1)/Neura-Talk/docs/TESTER_CALL_SCRIPTS.md)

## Day 1 Exit Goal

By the end of Day 1, the team must have:

- confirmed Azure-first app-to-app is the active validation path
- confirmed legacy signaling is not the path being exercised
- opened all operator evidence surfaces
- completed at least 2 real app-to-app calls
- recorded the first evidence rows in the Week 1 CSV

## Roles

- operator 1: caller device
- operator 2: callee device
- operator 3: admin metrics observer
- operator 4: note taker and evidence collector

If fewer people are available:
- one person may combine admin metrics and note taking

## Before The First Call

1. Confirm today is Week 1 app-to-app validation only.
2. Confirm this is not a PSTN test day.
3. Confirm the selected mode for the first call.
4. Open the Week 1 CSV and create today’s rows.
5. Open:
   - `GET /api/admin/call-metrics`
   - `GET /metrics`
   - `WS /ws/admin-monitor`
6. Start screen recording on both devices if available.
7. Start timestamped server log capture.

## Primary Path Confirmation

Before live calls, explicitly verify:

- route under test is `app-to-app`
- Azure STT is primary
- Deepgram is fallback only
- legacy signaling is not enabled for this validation run

If any of the above is unclear:
- stop and mark the session `BLOCKED`

## Day 1 Minimum Calls

Run these first 2 calls before doing anything else:

1. Telugu, Subtitles, WiFi, quiet room, 5 minutes
2. English, Original Voice, WiFi, quiet room, 5 minutes

For each call include:

- 1 interruption
- 1 silence gap over 3 seconds
- 1 fast-speech burst
- 1 overlapping-speech moment

If the first 2 calls are stable, add:

3. Telugu, Translated Voice, WiFi, quiet room, 5 minutes
4. Hindi, Subtitles, 4G/5G, quiet room, 5 minutes

## Per-Call Steps

1. Note baseline counters from `/api/admin/call-metrics`.
2. Start the call.
3. Confirm selected mode is actually active.
4. Speak natural phrases, not slow textbook speech.
5. Trigger the planned interruption, silence gap, fast-speech burst, and overlap.
6. End after 5 minutes or more.
7. Capture:
   - `/api/admin/call-metrics`
   - `/metrics`
   - admin monitor observations
   - any user-visible failure
8. Fill the CSV row immediately.

## Metrics To Record Today

From `voice`:

- `transcriptConfidence.p50`
- `transcriptConfidence.p95`
- `transcriptConfidence.p99`
- `reconnectRecoveryMs.p50`
- `interruptionRecoveryMs.p50`
- `rates.duplicateTurnRate`
- `rates.staleTranscriptRate`
- `rates.overlapRate`
- `rates.confidenceCoverageRate`

From `pipeline`:

- `stt.p50`
- `translation.p50`
- `tts.p50`
- `total.p50`

Manual observations:

- translation engaged: yes/no
- duplicate turn heard: yes/no
- stale transcript seen: yes/no
- ghost audio: yes/no
- subtitle drift: yes/no
- interruption felt natural: yes/no

## Day 1 Fail Conditions

Mark a call `FAIL` if any happen:

- call drops unexpectedly
- translation mode does not engage when expected
- duplicate final translated turn is heard
- stale transcript reappears after newer speech
- translated voice keeps talking after a clear interruption
- ghost audio appears after reconnect
- subtitles become unusable

## Day 1 Report

At the end of Day 1, write a short summary with:

- total calls attempted
- passed calls
- failed calls
- top 3 failure patterns
- latest metric snapshot
- go/no-go for Day 2 expansion

## Day 1 Truth Rule

Do not claim field validation from Day 1 alone.

If Day 1 ends without completed evidence rows and captured metrics:
- mark status `NOT FIELD VERIFIED`
