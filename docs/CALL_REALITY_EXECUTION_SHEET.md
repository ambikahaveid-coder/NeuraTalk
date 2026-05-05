# Call Reality Execution Sheet

Use this for final B2B, B2C/C2C, and PSTN proof gathering. Every row needs evidence.

## Required Evidence

- screenshot of caller ID where relevant
- call ID
- route used (`app_to_app`, `app_to_pstn`, `conference`)
- caller identity mode (`app_identity`, `organization_caller_id`, `user_verified_number`, `provider_caller_id`)
- UI duration
- backend duration
- billed amount

## Pass/Fail Row Template

```text
Module:
Case:
Call ID:
Route:
Caller Identity Mode:
Expected:
Actual:
UI Duration:
Backend Duration:
Billed Amount:
Status:
Evidence:
Notes:
```

## Minimum Launch Matrix

### C2C

- 5 app-to-app calls
- 2 same-language calls with translation disabled by inference
- 2 cross-language calls with translation enabled
- 1 PSTN fallback call from consumer flow

### B2B

- 5 outbound calls from control room
- 2 queue assign tests
- 2 auto-route tests
- 2 simultaneous agent-presence checks

### PSTN

- 5 outbound calls to Android
- 5 outbound calls to iPhone
- 5 inbound/return-path validations where applicable

## Caller Identity Validation

- confirm screenshot matches reported `callerIdentityMode`
- if `user_verified_number` was attempted but recipient saw another number, log provider/compliance override explicitly
- if `provider_caller_id` appears, verify UI did not promise personal number passthrough

## Duration/Billing Validation

- compare UI timer and backend final duration
- compare backend duration and billed amount
- flag any mismatch greater than 2 seconds or 1 billing unit

## Go-Live Rule

Do not mark production ready unless:

- all critical rows are `PASS`
- no unexplained caller identity mismatch remains
- no unexplained duration/billing mismatch remains
- evidence is attached for every PSTN scenario
