# Telecom Validation 30-Day Tracker

Use this tracker to keep the validation program honest. Update one row per day.

## Status Values

- `NOT_STARTED`
- `IN_PROGRESS`
- `BLOCKED`
- `DONE`

## Day-by-Day Tracker

| Day | Focus | Primary Deliverable | Status | Evidence Link | Blocking Issues |
| --- | --- | --- | --- | --- | --- |
| 1 | Week 1 setup | Azure-first path confirmed, legacy path quarantine confirmed | NOT_STARTED |  |  |
| 2 | Week 1 modes | Original Voice, Subtitles, Translated Voice checks | NOT_STARTED |  |  |
| 3 | Week 1 metrics | Runtime metric collection verified | NOT_STARTED |  |  |
| 4 | Week 1 field runs | WiFi and 4G/5G call evidence | NOT_STARTED |  |  |
| 5 | Week 1 mixed language | Hinglish and Tenglish evidence | NOT_STARTED |  |  |
| 6 | Week 1 fixes | Stability blocker reruns | NOT_STARTED |  |  |
| 7 | Week 1 gate | Field metrics pack complete or `NOT FIELD VERIFIED` | NOT_STARTED |  |  |
| 8 | Week 2 soak | 30-minute soak evidence | NOT_STARTED |  |  |
| 9 | Week 2 soak | 1-hour soak evidence | NOT_STARTED |  |  |
| 10 | Week 2 switching | Multilingual and interruption-heavy session evidence | NOT_STARTED |  |  |
| 11 | Week 2 chaos | Websocket and LiveKit reconnect storm evidence | NOT_STARTED |  |  |
| 12 | Week 2 chaos | Packet loss, delayed RTP, worker crash evidence | NOT_STARTED |  |  |
| 13 | Week 2 recovery | Recovery metrics and collapse metrics | NOT_STARTED |  |  |
| 14 | Week 2 gate | Soak and reconnect-chaos decision | NOT_STARTED |  |  |
| 15 | Week 3 PSTN setup | One-provider-path validation ready | NOT_STARTED |  |  |
| 16 | Week 3 PSTN field runs | Android and iPhone PSTN evidence | NOT_STARTED |  |  |
| 17 | Week 3 PSTN field runs | Multilingual app-to-number evidence | NOT_STARTED |  |  |
| 18 | Week 3 degraded audio | Weak signal and noisy outdoor evidence | NOT_STARTED |  |  |
| 19 | Week 3 webhook chaos | Replay and delayed webhook evidence | NOT_STARTED |  |  |
| 20 | Week 3 failover | PSTN failover and outage evidence | NOT_STARTED |  |  |
| 21 | Week 3 gate | PSTN decision or `LIMITED BETA ONLY` restriction | NOT_STARTED |  |  |
| 22 | Week 4 dashboards | Grafana and Prometheus verification | NOT_STARTED |  |  |
| 23 | Week 4 dashboards | Latency, reconnect, backlog, failover views verified | NOT_STARTED |  |  |
| 24 | Week 4 alerts | Alert fire verification | NOT_STARTED |  |  |
| 25 | Week 4 traces | Reconnect and failover trace continuity proof | NOT_STARTED |  |  |
| 26 | Week 4 incidents | Azure/OpenAI/Redis incident drill evidence | NOT_STARTED |  |  |
| 27 | Week 4 incidents | Reconnect storm and worker crash drill evidence | NOT_STARTED |  |  |
| 28 | Final reruns | Highest-risk scenario reruns after fixes | NOT_STARTED |  |  |
| 29 | Evidence pack | Final graphs, screenshots, and CSVs assembled | NOT_STARTED |  |  |
| 30 | Readiness gate | Final Day 30 report completed | NOT_STARTED |  |  |

## Weekly Exit Conditions

### Week 1

- field metrics captured
- duplicate-turn and stale-transcript rates known
- reconnect and interruption recovery timings known

### Week 2

- soak graphs complete
- reconnect chaos complete
- no monotonic unbounded growth without explanation

### Week 3

- PSTN latency and webhook behavior measured
- degraded audio behavior measured
- provider failover behavior measured or restricted

### Week 4

- dashboards verified live
- alerts verified live
- incident-debugging workflow proven

## Final Gate Truth Labels

- `NOT FIELD VERIFIED`
- `NOT SAFE FOR GA`
- `NOT VERIFIED UNDER RECONNECT CHAOS`
- `OBSERVABILITY NOT PROVEN`
