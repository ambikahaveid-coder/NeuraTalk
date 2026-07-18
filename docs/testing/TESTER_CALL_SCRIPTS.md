# Tester Call Scripts

Use these scripts exactly during final live validation. Capture evidence for every step.

## 1. C2C App-to-App Voice

1. Login on two separate app accounts.
2. On caller device, set `I speak` and `They speak`.
3. Start a voice call to the second user.
4. Confirm callee sees incoming ring.
5. Accept on callee device.
6. Speak for 30-60 seconds on both sides.
7. End the call from caller side.

Record:
- call ID
- route used
- caller identity mode
- UI duration on both sides
- backend duration
- billed amount

## 2. C2C App-to-App Translation

1. Caller sets language `en`.
2. Callee sets language `te`.
3. Ensure translation toggle is ON before dialing.
4. Place the call and exchange 3-4 lines each.
5. Confirm translated audio/text behavior is present.
6. End the call and compare billing with duration.

Record:
- whether translation actually engaged
- any fallback or passthrough behavior
- latency issues

## 3. C2C/PSTN Outbound

1. Start a call from app to a real phone number.
2. Capture recipient caller ID screenshot before answer if possible.
3. Answer the call on the mobile device.
4. Speak from both sides for 60+ seconds.
5. End the call from the app side.

Record:
- expected `callerIdentityMode`
- actual number displayed
- audio both directions
- route used
- billed duration and amount

## 4. B2B Outbound from Control Room

1. Login as company admin.
2. Open B2B control room.
3. Select a specific agent.
4. Enter customer identifier/number.
5. Start the outbound call.
6. Verify selected agent card reflects live current call state.
7. End the call and confirm cleanup.

Record:
- selected agent
- actual agent shown on current call
- update delay in seconds
- post-call cleanup delay

## 5. B2B Queue Assign

1. Create or wait for a queued call.
2. Select an agent.
3. Click `Assign`.
4. Verify only that agent reflects the assignment.
5. Verify queue item leaves pending state.

Record:
- queue item ID
- assigned agent ID
- stale UI mismatch if any

## 6. B2B Auto-Route

1. Prepare a queued call with known language.
2. Trigger `Auto-Route`.
3. Verify selected agent has matching skill/language expectation.
4. Confirm queue and agent panels update correctly.

Record:
- queue language
- routed agent
- route latency

## 7. Billing Cross-Check

For 5 completed calls:

1. Note UI timer when call ends.
2. Fetch backend duration from logs/admin.
3. Compare billed amount with expected rate.

Mark `FAIL` if:
- duration drift is greater than 2 seconds
- billed amount does not match plan/rate logic
- caller identity mode and displayed number conflict without provider explanation
