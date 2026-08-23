# AI Security and Permission Model

## Current state

No risk-tiering concept exists anywhere in the codebase. AI calls (billing decisions, translation, voice cloning) execute directly through service functions with no intermediate gate. The only tiering-like pattern present is `role-middleware.ts`'s RBAC — real, but scoped to human users/admins, not to AI-initiated actions.

## The five tiers

Every AI capability, present and future, is classified into exactly one of these before it ships:

| Tier | Definition | Example in this product |
|---|---|---|
| **READ** | Retrieves information, no side effects | AI summarizes a conversation for the user who owns it |
| **SUGGEST** | Generates a recommendation, takes no action | AI drafts a marketing message for a business owner to review |
| **CONFIRM** | Proposes an action; executes only after explicit user approval | AI proposes booking an appointment; user taps confirm |
| **EXECUTE** | Performs an authorized action directly, within pre-granted scope | AI translates a live call (translation was explicitly enabled by both parties via consent — see `call-privacy.ts`) |
| **HIGH-RISK** | Execute-tier action with an irreversible or financial consequence; requires additional confirmation beyond a single tap | AI-initiated campaign spend, AI-initiated refund, AI account-security change |

## Hard rules — AI must never silently:

- spend money
- send mass messages
- delete important records
- change account security
- access unauthorized business data
- access another user's private conversations
- execute privileged admin operations

Any AI code path that would do one of the above without a CONFIRM-or-higher gate having actually executed first is a P0 defect by definition, not a design choice to be reconsidered per-feature.

## Enforcement point

The permission check lives in the AI Gateway's **Policy / Permission** stage (`05_AI_MODEL_GATEWAY_ARCHITECTURE.md`'s pipeline), not scattered in each feature's business logic. A feature declares its action's tier at the call site; the gateway enforces it before the model call is even dispatched for EXECUTE/HIGH-RISK tiers (no point spending an AI call on an action that will be blocked), and before the *result* is applied for CONFIRM tiers (the suggestion generation itself is SUGGEST-tier and always allowed; only the resulting action is gated).

```
Feature declares: action_tier = "HIGH_RISK"
        ↓
Gateway Policy stage checks: does this user/business have HIGH_RISK grant for this action type?
        ↓
   No  → reject before model call, return "requires explicit authorization"
   Yes → proceed, but result is held pending a second explicit confirmation step
         before commit_action() is called
```

## Applying this to the brief's example features

| Brief feature | Tier | Why |
|---|---|---|
| AI answers a customer FAQ from business knowledge | SUGGEST → READ once approved content is reused | First answer to a novel question should be reviewable; repeated known-good answers can be READ-tier |
| AI books an appointment | CONFIRM | Creates a real-world commitment on the business's calendar |
| AI qualifies a lead and updates CRM | EXECUTE | Internal data mutation, no external/financial consequence, reversible |
| AI creates and launches a marketing campaign | CONFIRM for creation, HIGH-RISK for spend | Matches the brief's own rule: "AI can generate recommendations. Human approval required for consequential campaign actions." |
| AI translates a live call | EXECUTE | Pre-authorized via call consent flow, no per-utterance approval is usable in a live conversation |
| AI-initiated refund | HIGH-RISK | Financial, and this product already has real refund infrastructure (`paymentRefunds`, `payment-service.ts`) an AI agent could reach if built carelessly |

## Explicitly out of scope

- This document defines the tiering *framework*. Which specific tier each future feature gets is decided when that feature is designed, using this table as precedent — not enumerated exhaustively here for features that don't exist yet.
