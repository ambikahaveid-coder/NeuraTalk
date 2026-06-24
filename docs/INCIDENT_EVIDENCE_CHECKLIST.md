# Incident Evidence Checklist

Use this checklist for every serious failure during telecom validation.

Goal:
- make every failure debuggable
- preserve evidence before retrying
- avoid vague reports like "call glitched"

References:
- [VALIDATION_METRICS_CHEAT_SHEET.md](C:/Users/kiran/Downloads/Neura-Talk%20(1)/Neura-Talk/docs/VALIDATION_METRICS_CHEAT_SHEET.md)
- [CALL_REALITY_EXECUTION_SHEET.md](C:/Users/kiran/Downloads/Neura-Talk%20(1)/Neura-Talk/docs/CALL_REALITY_EXECUTION_SHEET.md)
- [DAY30_FINAL_READINESS_TEMPLATE.md](C:/Users/kiran/Downloads/Neura-Talk%20(1)/Neura-Talk/docs/DAY30_FINAL_READINESS_TEMPLATE.md)

## Capture Immediately

- date and time
- scenario ID
- call ID
- room ID or session ID
- correlation ID
- operator name
- route used
- provider path
- device types
- network type

## Capture The Symptom

Pick the clearest symptom label:

- call drop
- reconnect never recovered
- ghost audio
- duplicate assistant turn
- stale transcript replay
- delayed cancellation
- overlap collapse
- silence with active call
- translation never engaged
- PSTN webhook delay
- provider failover confusion

Then write:
- what the user saw
- what the user heard
- whether both sides were affected

## Capture Runtime Evidence

Take snapshots of:

- `GET /api/admin/call-metrics`
- `GET /metrics`
- `WS /ws/admin-monitor` observations

Log:
- latest pipeline latencies
- latest voice rates
- provider health state
- circuit breaker state if visible

## Capture Visual Evidence

- caller device screen recording or screenshot
- callee device screen recording or screenshot
- caller ID screenshot for PSTN where relevant
- dashboard screenshot if an alert or spike is visible

## Capture Logs And Traces

- timestamped server logs around the incident
- relevant warning/error lines
- trace IDs or correlation IDs
- reconnect/failover event sequence

Do not rerun first and collect later.

## Capture Outcome

- did the call recover: yes/no
- recovery time:
- was the issue user-visible the whole time: yes/no
- was manual intervention needed: yes/no
- did retrying hide the issue: yes/no

## Severity Shortcut

Mark as `critical` if any are true:

- call unusable
- reconnect never recovered
- repeated duplicate turns
- stale transcript replay caused wrong conversation state
- queue or session growth continued after call ended
- provider failover was silent and confusing

Mark as `major` if any are true:

- noticeable but recoverable latency spike
- one-sided audio gap
- temporary subtitle drift
- short reconnect recovery issue

Mark as `minor` if any are true:

- cosmetic logging issue
- small dashboard mismatch with no user impact

## Before Retest

Confirm these are recorded:

- evidence link
- CSV row updated
- top-level symptom label
- correlation ID
- metrics snapshot
- pass/fail impact

If not, stop and complete the evidence first.
