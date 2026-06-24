# Week 4 Ops And Incident Proof Runbook

Purpose:
- prove Neura Talk is operationally observable, alertable, and debuggable
- validate that operators can detect and understand failures before users report them
- produce the final evidence needed for the 30-day readiness gate

Scope:
- Prometheus metrics
- Grafana dashboards
- admin monitor snapshots
- alert firing
- reconnect trace continuity
- provider failover visibility
- operator debugging workflow

Not in scope:
- new product features
- new provider integrations
- UI polish
- premium voice

## Required Surfaces

- `GET /metrics`
- `GET /api/admin/call-metrics`
- `WS /ws/admin-monitor`
- Grafana dashboards
- alert delivery channel
- Sentry or error-tracking view
- server logs with timestamps

## Operational Proof Rules

If dashboards exist only in code or static config:
- mark `OBSERVABILITY NOT PROVEN`

If alerts do not actually fire during drills:
- mark `OBSERVABILITY NOT PROVEN`

If operators cannot trace a reconnect or failover incident end-to-end:
- mark `OBSERVABILITY NOT PROVEN`

## Dashboards To Verify

Must exist and be usable:
- provider latency dashboard
- transcript latency dashboard
- reconnect dashboard
- audio backlog dashboard
- stuck-session dashboard
- provider failover dashboard
- websocket disconnect dashboard
- active calls / active bots dashboard

Each dashboard check must verify:
- data present
- labels make sense
- timestamps align with incident
- operator can identify the affected call/session

## Alerts To Verify

Must fire during drills:
- Azure timeout alert
- OpenAI timeout alert
- Redis degradation alert
- reconnect storm alert
- worker crash alert
- stuck-session alert
- audio backlog alert
- provider failover alert
- websocket disconnect alert

For each alert capture:
- alert name
- trigger condition
- detection timestamp
- delivery timestamp
- cleared timestamp
- correct routing yes/no
- operator understood root symptom yes/no

## Incident Drill Set

Run these minimum incidents:

1. Azure timeout incident
2. OpenAI timeout incident
3. Redis degradation incident
4. reconnect storm incident
5. worker crash incident

For each incident:
1. start from a known stable app-to-app translated voice call
2. capture baseline dashboards
3. trigger the failure
4. wait for alert
5. confirm alert receipt
6. inspect dashboard and traces
7. confirm recovery or stuck state
8. document what the operator could and could not see

## Evidence To Capture

For every incident:
- screenshot of relevant dashboard
- screenshot or copy of alert
- `/api/admin/call-metrics` snapshot
- `/metrics` snapshot
- correlation ID or call ID used for tracing
- timeline of key events
- operator note on debugging clarity

## Trace Continuity Checks

Must verify:
- correlation ID survives reconnect
- correlation ID survives failover
- provider switch is visible
- reconnect start and reconnect recovery are visible
- duplicate-turn / stale-transcript counters are visible
- session can be followed from alert to logs to metrics

Mark `fail` if:
- operator cannot connect the alert to a specific call/session
- failover happens but is invisible in metrics/logs
- reconnect completes but trace continuity breaks

## Week 4 Pass Conditions

Mark Week 4 `pass` only if all are true:
- dashboards exist and are usable
- alerts actually fire during drills
- operators can identify affected calls/sessions
- reconnect and failover are visible end-to-end
- debugging workflow is documented and repeatable

Mark `fail` if any are true:
- alert never fires
- dashboard is blank or unusable
- correlation breaks during reconnect/failover
- operator cannot explain what happened from available telemetry

## Required Deliverables End Of Week 4

- dashboard screenshot pack
- alert screenshot pack
- incident drill table
- operator debugging notes
- correlation continuity notes
- final observability verdict:
  - proven
  - partially proven
  - not proven

## Final Day-30 Evidence Pack

Collect all of the following:
- Week 1 field CSV
- Week 2 soak/chaos CSV
- Week 3 PSTN CSV
- Week 4 incident CSV
- latest `/api/admin/call-metrics`
- latest `/metrics`
- dashboard screenshots
- alert screenshots
- top unresolved blockers

## Final Day-30 Gate

At day 30 produce only:
- REAL telecom-grade readiness %
- Real field-test confidence %
- Long-call stability %
- Chaos survival confidence %
- Conversational collapse resistance %
- Observability operational proof %
- Biggest proven weaknesses
- Exact beta-safe boundaries
- Exact GA blockers
- Final classification
