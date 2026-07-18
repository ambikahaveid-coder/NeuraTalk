# Telecom Validation Master Index

This is the authoritative entry point for the 30-day telecom validation program.

Strategic realtime doctrine:
- [REALTIME_300MS_CLASS_BATTLE_PLAN.md](C:/Users/kiran/Downloads/Neura-Talk%20(1)/Neura-Talk/docs/REALTIME_300MS_CLASS_BATTLE_PLAN.md)

Use this file to decide:

- what to run today
- where to record evidence
- what counts as a blocker
- when the system must remain `INTERNAL ONLY`

## Program Order

1. Week 1: app-to-app field validation
2. Week 2: soak and reconnect chaos
3. Week 3: PSTN hardening
4. Week 4: ops and incident proof
5. Day 30: final readiness decision

## Core Rules

- No feature work during this program.
- Evidence beats architecture claims.
- Every failed run needs a timestamp, call ID, and correlation ID.
- If field metrics are incomplete, mark `NOT FIELD VERIFIED`.
- If soak evidence is incomplete, mark `NOT SAFE FOR GA`.
- If reconnect chaos is incomplete, mark `NOT VERIFIED UNDER RECONNECT CHAOS`.
- If dashboards and alerts are not proven live, mark `OBSERVABILITY NOT PROVEN`.

## Week 1

Runbook:
- [WEEK1_APP_TO_APP_VALIDATION_RUNBOOK.md](C:/Users/kiran/Downloads/Neura-Talk%20(1)/Neura-Talk/docs/WEEK1_APP_TO_APP_VALIDATION_RUNBOOK.md)

Results template:
- [WEEK1_APP_TO_APP_RESULTS_TEMPLATE.csv](C:/Users/kiran/Downloads/Neura-Talk%20(1)/Neura-Talk/docs/WEEK1_APP_TO_APP_RESULTS_TEMPLATE.csv)

Goal:
- prove one app-to-app realtime path is stable

Mandatory outputs:
- transcript latency p50/p95/p99
- reconnect recovery timing
- interruption recovery timing
- transcript confidence distribution
- duplicate-turn metrics
- stale transcript metrics

## Week 2

Runbook:
- [WEEK2_SOAK_AND_RECONNECT_CHAOS_RUNBOOK.md](C:/Users/kiran/Downloads/Neura-Talk%20(1)/Neura-Talk/docs/WEEK2_SOAK_AND_RECONNECT_CHAOS_RUNBOOK.md)

Results template:
- [WEEK2_SOAK_AND_RECONNECT_RESULTS_TEMPLATE.csv](C:/Users/kiran/Downloads/Neura-Talk%20(1)/Neura-Talk/docs/WEEK2_SOAK_AND_RECONNECT_RESULTS_TEMPLATE.csv)

Goal:
- prove the system survives time, reconnect instability, and chaos

Automatic GA blockers:
- monotonic heap growth
- reconnect loop accumulation
- stale audio replay
- unbounded transcript queue growth
- unbounded audio queue growth

## Week 3

Runbook:
- [WEEK3_PSTN_HARDENING_RUNBOOK.md](C:/Users/kiran/Downloads/Neura-Talk%20(1)/Neura-Talk/docs/WEEK3_PSTN_HARDENING_RUNBOOK.md)

Results template:
- [WEEK3_PSTN_RESULTS_TEMPLATE.csv](C:/Users/kiran/Downloads/Neura-Talk%20(1)/Neura-Talk/docs/WEEK3_PSTN_RESULTS_TEMPLATE.csv)

Supporting execution sheet:
- [CALL_REALITY_EXECUTION_SHEET.md](C:/Users/kiran/Downloads/Neura-Talk%20(1)/Neura-Talk/docs/CALL_REALITY_EXECUTION_SHEET.md)

Goal:
- prove or restrict the app-to-PSTN path

Rule:
- if PSTN remains unstable, keep PSTN at `LIMITED BETA ONLY`

## Week 4

Runbook:
- [WEEK4_OPS_AND_INCIDENT_PROOF_RUNBOOK.md](C:/Users/kiran/Downloads/Neura-Talk%20(1)/Neura-Talk/docs/WEEK4_OPS_AND_INCIDENT_PROOF_RUNBOOK.md)

Results template:
- [WEEK4_INCIDENT_DRILL_RESULTS_TEMPLATE.csv](C:/Users/kiran/Downloads/Neura-Talk%20(1)/Neura-Talk/docs/WEEK4_INCIDENT_DRILL_RESULTS_TEMPLATE.csv)

Goal:
- prove operators can detect, debug, and recover incidents

Mandatory proof:
- working dashboards
- alert fires
- reconnect trace continuity
- failover visibility
- stuck-session visibility

## Day 30

Final report template:
- [DAY30_FINAL_READINESS_TEMPLATE.md](C:/Users/kiran/Downloads/Neura-Talk%20(1)/Neura-Talk/docs/DAY30_FINAL_READINESS_TEMPLATE.md)

Do not publish a readiness score unless:
- Week 1 evidence is complete
- Week 2 evidence is complete
- Week 3 evidence is complete or explicitly restricted
- Week 4 operational proof is complete

## Recommended Daily Flow

1. Pick the current week from the program order above.
2. Open the matching runbook.
3. Execute each scenario exactly as written.
4. Record evidence in the matching CSV immediately after each run.
5. Copy severe failures into the incident tracker with correlation IDs.
6. Re-run only after the stability fix is in place.

## Minimum Evidence Per Failure

- date and time
- scenario ID
- call ID
- room ID or session ID
- correlation ID
- provider path
- network type
- user-visible symptom
- metric snapshot
- replay trace or logs
