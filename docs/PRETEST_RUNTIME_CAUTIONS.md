# Pretest Runtime Cautions

Use this before starting field validation.

Goal:
- prevent operator confusion about which realtime path is actually live
- separate real runtime risk from leftover naming noise

## What Is Actually True Right Now

- Azure-first STT is the intended default runtime path.
- Deepgram is retained as optional fallback only.
- LiveKit is the authoritative production realtime transport.
- legacy signaling is not supposed to be the production path.

## What Is Still Confusing In The Codebase

These leftovers still exist and should not be misread as proof that Deepgram is primary:

- variable names like `deepgram`
- helper names like `ensureDeepgram` and `reconnectDeepgram`
- some comments and internal section labels
- optional admin/config surfaces that still list Deepgram as an integration

These are naming leftovers from the earlier migration path.

## What Operators Should Verify Before Tests

Before a field run, explicitly confirm:

- active route is app-to-app or PSTN as planned
- Azure STT is selected as primary
- Deepgram is fallback only
- legacy signaling is not the exercised path

If that confirmation is missing:
- stop and mark the run `BLOCKED`

## Real Risks vs Cosmetic Risks

Real risk:
- testing the wrong transport or provider path without realizing it

Cosmetic risk:
- seeing `deepgram` in method names or fields and assuming Azure-first is not active

Treat naming leftovers as caution signs, not final evidence.

## Known Operator Truth

Do not upgrade readiness based on code naming.

Upgrade only on measured runtime evidence.
