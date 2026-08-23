# Message Sender Identity Architecture

Read-only architecture analysis. No code, no migration, no deployment. Extends [24_CANONICAL_MESSAGING_FOUNDATION.md](24_CANONICAL_MESSAGING_FOUNDATION.md) and its P1 sender-identity fix (commit `75a6841`) to cover non-human senders.

## 1. Current human sender model (as built, commits `54895d2` + `75a6841`)

```
Authenticated HTTP session (req.user.id)
   ↓ (requireAuth + requireCompanyAccess + requirePermission — existing middleware, unchanged)
Business membership confirmed (req.user.organizationId === :businessId)
   ↓
messaging_participants row WHERE conversationId=X AND participantType='user' AND participantId=req.user.id
   ↓ (must already exist -- Phase 0 does not auto-join)
Resolved sender participant
   ↓
Canonical Message (senderParticipantId = the resolved row's id, never client-supplied)
```

The load-bearing property, established by the P1 fix and preserved by everything below: **sender identity is a lookup keyed by trusted server-side context, never a value accepted from the request.** For humans, "trusted server-side context" is the authenticated session. This document's job is to define the equivalent trusted context for every sender kind that isn't a human.

## 2. Problem statement

Phase 0 only has one resolution path (session → user participant). Future capabilities need messages whose sender is not a logged-in human: OTP delivery, utility event triggers, marketing campaigns, AI agents, business automation flows, and platform system notifications. Naively extending the existing pattern by letting a request specify `participantType: 'system'` (or similar) would reopen exactly the impersonation hole the P1 fix just closed — a client could claim to be "the system" or "an AI agent" with no more effort than claiming to be another user. The fix must generalize the *principle* (server-resolved, never client-asserted), not just add more accepted enum values to an open field.

## 3. Options considered

**A. `SYSTEM` participant** — a single generic non-human participant type for anything platform-automated. Simple, but conflates OTP/utility/campaign/notification into one bucket with no way to distinguish *which* system process sent a given message without digging into a payload blob.

**B. `BUSINESS` participant** (already exists) — messages appear to come from "the business" as an undifferentiated entity. Correct for what the *recipient* should see for campaign/automation sends (a customer shouldn't see "NEURA Platform" as the sender of a business's marketing message), but insufficient alone for internal auditability (doesn't answer "which campaign/employee action caused this").

**C. `SERVICE` participant** — a new type specifically for API-key-authenticated business-external callers. Adds a real distinction (business's own backend vs. NEURA's internal engines) but as a *fourth* enum value it still only answers "who does the recipient see," the same limitation as A/B.

**D. `AGENT` participant** — a new type for AI agents specifically. Same shape of limitation as C, and premature: Phase 11 (AI agents) is still gated behind unverified architecture (doc 23 §13), so designing its exact participant shape now risks being wrong before that gate is even reached.

**E. Generic actor abstraction** — separate two questions that Phase 0's single `participantType` field currently conflates:
  1. **Conversational identity** ("who does the recipient see as the sender") — answered by the existing `messagingParticipants.participantType`/`participantId`, which already has enough values (`user`, `business`, `system`, `ai_agent`, `customer`) to cover every case in §4's use-case table. No new participant type is needed.
  2. **Generation provenance** ("what internal mechanism actually produced this message, for audit") — not currently answered by anything in Phase 0. This needs a new, orthogonal concept: a `generationSource` (`{type, id}`, e.g. `{type: 'campaign', id: 42}`) recorded alongside the message, independent of who the conversational sender is.

**F. Another design** — considered and rejected: a single unified "actors" table replacing `messagingParticipants` entirely (one row per possible sender across all types, with a real foreign key per type via a discriminated-union table). This is architecturally cleaner in the abstract but is a breaking rewrite of a table that already has real data-model commitments from Phase 0 (deliveries, read-states, and reactions all key off `messagingParticipants.id`) for a benefit (a single source of truth for "who can this be") that option E achieves without any rewrite, by keeping identity and provenance separate. Rejected as unnecessary churn for the value gained.

## 4. Recommended model: E, generic actor abstraction via identity/provenance separation

**No new participant types.** `messagingParticipants.participantType` keeps its existing 5 values. **No new tables required for Phase 0/1.** Provenance is recorded in `messaging_events.payload` (already a jsonb field, already the message-lifecycle audit trail per doc 24 §12) as a `generationSource: { type, id }` object, where `type` is one of `human | otp_engine | utility_trigger | campaign | automation_flow | ai_agent | system_notification | webhook_event` and `id` references the causing record (a campaign id, an OTP request id, etc. — each of these tables is a later phase's responsibility to create; `generationSource.id` is a forward reference exactly like `messagingMessages.templateId` already is in Phase 0, carrying no DB-level FK until its target table exists).

**Why this is the smallest safe design**: it adds zero columns and zero tables to what's already shipped, reuses the existing audit-event mechanism doc 24 already established, and defers the one genuinely open question (should `generationSource` graduate from a jsonb payload field to a first-class, indexed column once Phase 5's `campaigns` table exists and campaign-performance reporting needs to join against it efficiently) to whichever future phase actually needs that query performance — a real, named tradeoff, not an oversight (see §15).

**The governing rule, stated once so every future phase inherits it**: every non-human send path is its own dedicated internal function (mirroring `createMessage`'s existing shape), and **none of them accept a caller-specified sender type or generation source as an open request parameter** — each function's own code determines both, the same way `createMessage` today hardcodes `category: 'conversational'` and resolves the sender from `req.user.id` rather than trusting a field. A future `sendOtpMessage()`, `sendCampaignMessage()`, `sendUtilityMessage()`, `sendAiAgentMessage()` etc. each independently guarantee this — there is no single generic "send as any type" function for anything to be tricked into calling with attacker-controlled type/id values.

## 5. Entity relationships

```
                    (existing, unchanged)
Business (organizations) ──▶ businessConversations ──▶ messagingConversations
                                                              │
                                                              ▼
                                                     messagingParticipants
                                                     (participantType, participantId)
                                                     -- conversational identity, WHO
                                                     the recipient sees. 5 existing
                                                     values, no new ones needed.
                                                              │
                                                              ▼
                                                       messagingMessages
                                                     (senderParticipantId -- always
                                                      server-resolved, never trusted
                                                      from a request, per P1)
                                                              │
                                                              ▼
                                                        messagingEvents
                                                  (generationSource in payload --
                                                   WHAT internal mechanism produced
                                                   this. New concept, no new table.)
```

Each future authorized-actor kind (OTP engine, campaign engine, AI agent, automation flow, webhook dispatcher) is a **trusted internal code path**, not a data row a client can reference — its "identity" for provenance purposes is simply the type tag plus the id of whatever business-domain record (campaign, OTP request, flow run) caused it to run, both chosen by that code path itself, never read from client input.

## 6. Authorization rules

| Sender kind | Who may cause it | How that's verified (existing mechanism reused) |
|---|---|---|
| `user` | The authenticated human, for themselves only | `requireAuth` + `requireCompanyAccess` + P1's own-participant lookup |
| `business` (campaign/automation, recipient-facing) | The business's own approved campaign/flow, never a raw client request | Approval Center (doc 23 §5) gate on the causing campaign/flow BEFORE the send path is ever invoked; the send function itself is internal-only, not a public route |
| `system` (OTP/utility/notification, recipient-facing as "system" or attributed to the business per §4) | NEURA's own internal engines, invoked either by a business's authenticated API key (OTP/utility) or by platform-internal triggers (notifications) | `enterpriseApiKeys` middleware (existing, real) for API-key-triggered sends; no external trigger at all for pure platform notifications |
| `ai_agent` | A specific, permission-gated AI agent, itself gated behind the unverified AI Gateway/security docs (05/06/07) | Not designed further here -- explicitly blocked on that separate gate (doc 23 §13), inherited unchanged |
| `customer` | Never a *sender* in Phase 0-era flows (customers receive, they don't send through this API surface yet) -- if/when customer-initiated messaging is designed, it needs its own gate (a customer isn't a NEURA user with a session), out of scope here |

**The one rule that applies to every row above**: the *function that performs the send* is the authorization boundary, not a parameter inside a shared function. This is a deliberate rejection of a single flexible `createMessage(senderType, senderId, ...)` API in favor of several narrow, purpose-built functions — narrower surface, easier to audit each one independently, and structurally impossible to smuggle a `senderType` value into a code path that doesn't accept one.

## 7. Human sender flow (unchanged, restated for completeness)

`TRIGGER`: authenticated HTTP `POST .../messages`. `AUTHORIZED ACTOR`: `req.user.id`, confirmed a business member via `requireCompanyAccess`. `SENDER IDENTITY`: the caller's own `user` participant row, resolved server-side (P1 fix). `CANONICAL MESSAGE`: `category: conversational`, `generationSource: { type: 'human', id: <userId> }`.

## 8. System sender flow

`TRIGGER`: an internal platform event with no external request at all (e.g., a low-credit-balance notification NEURA itself decides to send). `AUTHORIZED ACTOR`: platform-internal code, not reachable via any public route. `SENDER IDENTITY`: `system` participant (auto-resolved/created by that internal code the same way the `business` participant is auto-created at conversation-creation today — a forward-looking implementation detail for whichever phase builds this, not designed further here). `CANONICAL MESSAGE`: `category: system`, `generationSource: { type: 'system_notification', id: null }` (no causing business-domain record, since nothing external triggered it).

## 9. AI sender flow

`TRIGGER`: an AI agent's generated response, itself triggered by conversation activity, once the AI Gateway exists. `AUTHORIZED ACTOR`: the specific agent config, permission-checked through the (currently unverified) AI security/permission model. `SENDER IDENTITY`: `ai_agent` participant. `CANONICAL MESSAGE`: `category: ai`, `generationSource: { type: 'ai_agent', id: <agent config id, once that table exists> }`. **Not designed further** — blocked on doc 23 §13's separate gate; this row exists only to show where it plugs into the identity model once unblocked.

## 10. Campaign sender flow

`TRIGGER`: the campaign scheduler firing (time-based) or a manual "run now" action, both internal to the campaign engine (Phase 5/8), never a raw client request per recipient. `AUTHORIZED ACTOR`: the campaign record itself, which was already routed through the Approval Center (doc 23 §5) before it could reach `SCHEDULED`/`RUNNING` state — the send path trusts "this campaign is APPROVED and RUNNING," not any per-message client input. `SENDER IDENTITY`: `business` participant (the recipient should see the business, not "NEURA campaign engine #4213"). `CANONICAL MESSAGE`: `category: marketing`, `generationSource: { type: 'campaign', id: <campaigns.id> }` — this is exactly the field Reporting (doc 23 §15) would join against to attribute message volume back to a specific campaign, which is the concrete reason `generationSource` needs to exist as a real, queryable concept even though it isn't a column yet (§15).

## 11. OTP sender flow

`TRIGGER`: a business's own backend calling NEURA's OTP-send endpoint (Phase 6), authenticated via that business's `enterpriseApiKeys` credential — the existing, real, tested API-key middleware, not a new auth mechanism. `AUTHORIZED ACTOR`: the API key (which is itself business-scoped and permission-scoped, per doc 19's existing API-key architecture). `SENDER IDENTITY`: `system` participant (the OTP engine sends on the business's behalf, but the actual mechanics -- MSG91/Resend delivery, hashed code storage, rate-limit-and-lockout -- are NEURA's own hardened `otp-auth.ts` internals, reused not rebuilt, per doc 23 §8). `CANONICAL MESSAGE`: `category: authentication`, `generationSource: { type: 'otp_engine', id: <business_otp_requests.id, once that table exists> }`. Structural guarantee carried over from doc 24 §6: the OTP send function is incapable of writing any category other than `authentication` — it doesn't accept category as a parameter, the same way the campaign send path (§10) is hardcoded to `marketing` and can't be tricked into sending an authentication-category message through a marketing send call.

## 12. Audit/event model

Kept deliberately separate from the platform's `audit_logs` table, per the explicit instruction and consistent with doc 24 §17/§9's framing: `messaging_events` is the message-lifecycle trail (who/what sent, delivery state transitions), `audit_logs` remains the admin/security-action trail (an admin suspending a business, rotating an API key, etc.). A messaging event answers, for any message: **who/what initiated it** (`senderParticipantId` → `participantType`/`participantId`), **which business owns it** (via `messagingConversations.organizationId` / `businessConversations.businessId`, one join away), **which authorized actor generated it** (`generationSource.id`), **was it human/system/automation/AI** (`generationSource.type`, a closed, code-controlled set of values — never a free-text client field), and **which service/agent/campaign caused it** (same `generationSource` object, resolved to the specific causing record).

## 13. Tenant isolation

Unaffected by this document's recommendation — every non-human send path still operates on a specific `businessConversations` row scoped by `businessId`, using the exact same WHERE-clause-scoped query pattern the P1 fix already established for humans. An API-key-authenticated OTP/utility call is scoped to the API key's own `organizationId` the same way a `requireCompanyAccess` check scopes a human's own `organizationId` — no new tenant-boundary mechanism, the existing one is reused for every actor kind.

## 14. Security model

- **Impersonation**: closed by §6's rule (no shared function accepts a client-specified sender type) plus §4's "no open request parameter" guarantee — structurally, not by convention, matching the standard already set by the P1 fix.
- **IDOR**: unaffected — every future send path still resolves its target conversation via the same `businessId`-scoped lookup pattern.
- **Tenant escape**: unaffected, see §13.
- **Privilege escalation**: a business's API key can only ever produce `system`-attributed sends within that business's own conversations — it cannot, by this design, ever resolve to a `user` participant (API keys aren't tied to a specific human's session) or to another business's conversations.
- **Unauthorized automation**: an automation flow (§10-adjacent, doc 23 §11) can only send once its owning `automation_flows` record exists and is active — same "the causing record's own state is the gate" pattern as campaigns, not a per-message permission check that a compromised single call could bypass.
- **Unauthorized AI sending**: explicitly deferred to the AI Gateway/permission model's own gate (doc 23 §13) — this document does not claim to solve that, only shows where AI plugs into the identity model once that separate gate is cleared.
- **Campaign abuse**: rate limits, frequency caps, consent/opt-out, and credit checks (doc 23 §10's five safety checks) all sit *upstream* of the send path this document describes — they gate whether a campaign is allowed to fire at all; this document only covers what happens to sender identity once a send is already authorized to occur.
- **OTP abuse**: fully inherited from the already-hardened `otp-auth.ts`/`rate-limit.ts` primitives (doc 23 §8) — this document adds no new OTP-specific risk, since it reuses that engine's delivery mechanics unchanged.

## 15. Migration implications

**None required now.** `generationSource` lives in the existing `messaging_events.payload` jsonb column — zero schema change to introduce it. The one real future decision, named rather than silently deferred: **if/when Reporting (doc 23 §15) needs to efficiently aggregate "messages per campaign" or similar at scale, `generationSource` may need to graduate from a jsonb payload field to first-class, indexed columns** (e.g. `messagingEvents.generationSourceType`, `messagingEvents.generationSourceId`) — a small, additive migration at that time, not a redesign. Not done now because no phase yet needs that query performance, and adding indexed columns for a query pattern nothing uses yet would be speculative schema bloat.

## 16. Phase-1 integration rules

For whichever future phase builds the first non-human sender (most likely OTP, Phase 6, since it has the fewest cross-dependencies):
1. Write a dedicated function (`sendOtpMessage()` or equivalent) — do not extend `createMessage` with an optional `senderType` parameter. Extending the existing function reintroduces exactly the "one function trusts too many things" shape the P1 fix moved away from.
2. The new function resolves its own sender participant server-side (auto-creating a `system` participant in the target conversation if none exists yet, the same way the `business` participant is auto-created at conversation-creation) — never accepts a participant id as input.
3. The new function hardcodes its own `category` value (matching §4/§11's structural-governance pattern) — never accepts category as input.
4. `generationSource` is populated by the function itself from its own calling context — never from a request body field.
5. A regression test proving the new function's send path rejects (or simply has no code path for) a client-supplied sender override, mirroring `messaging-phase0-rbac.test.ts`'s existing pattern.

## 17. Acceptance criteria (for this document, not for unbuilt code)

This document is complete when it: (a) resolves the A-F options question with a specific recommendation and named rationale — done, §3-4; (b) shows all 9 requested use cases as concrete trigger→actor→identity→message chains — done, §7-11 cover the representative cases (human, system, AI, campaign, OTP), with utility/automation/scheduled-campaign/webhook-triggered following the same patterns already shown (utility ≅ OTP's flow with a different trigger and category, per doc 23 §9; automation ≅ campaign's flow per doc 23 §11; scheduled campaign is campaign's flow with a time-based trigger; webhook-triggered is utility's flow with a webhook as the specific external trigger — not restated as five more near-duplicate sections); (c) names every security property requested and shows how it's preserved — done, §14; (d) is explicit that nothing here is implemented — true, no code/migration/deployment accompanies this document.

---

**PHASE 0 FOUNDATION + P1 SENDER SECURITY COMPLETE. PHASE 1 NOT STARTED.** This architecture document is read-only analysis — stopping here, waiting for approval before any of it is implemented.
