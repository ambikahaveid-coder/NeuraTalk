# Architecture Decision Records

Format per ADR convention: Problem, Context, Options, Decision, Consequences, Migration Impact.

---

## ADR-001: Consolidate messaging before extending it

**Problem:** Three independent messaging systems exist (AI chat, personal chat, group chat) with no shared model.

**Context:** Each new cross-cutting messaging feature (translation, search, moderation, business conversations) currently must be built three times or drifts. This is already visible: translation is implemented separately in `personal-chat-routes.ts` and `group-chats.ts`.

**Options considered:**
1. Leave as-is, keep triple-implementing features.
2. Consolidate now, before Business Platform work adds a fourth system.
3. Rewrite messaging from scratch.

**Decision:** Option 2. Consolidate into one canonical `CONVERSATION`/`PARTICIPANT`/`MESSAGE` model (`03_MESSAGING_CONSOLIDATION_PLAN.md`), via dual-write migration, not a rewrite.

**Consequences:** Short-term migration cost (dual-write period, backfill, reconciliation). Long-term: Business conversations (Phase 7+) become participants in the same model instead of a fourth system.

**Migration impact:** Additive during migration (legacy tables untouched until cutover); see `03` for the full rollback-safe sequence.

---

## ADR-002: Build the AI Model Gateway before any business-facing AI feature

**Problem:** 13+ files hardcode direct provider calls (`new OpenAI()`, ad hoc Azure/Deepgram/Sarvam/ElevenLabs calls).

**Context:** The business-platform brief describes AI agents, campaign generation, and recommendations — all AI consumers. Building these against direct provider calls, the established pattern, would produce a 20th+ hardcoded integration instead of fixing the underlying problem.

**Options considered:**
1. Build Business AI Agents first (higher visible product value), retrofit a gateway later.
2. Build the gateway first, before the first business-facing AI feature.

**Decision:** Option 2. See `05_AI_MODEL_GATEWAY_ARCHITECTURE.md`, sequenced as Phase 4 ahead of Phase 9 (agents) in `10_MASTER_MIGRATION_ROADMAP.md`.

**Consequences:** Delays the most demo-visible feature (a working AI agent) in favor of infrastructure with no standalone user-facing surface. This is a deliberate tradeoff against "chasing demos," per the source brief's own final directive.

**Migration impact:** Existing AI call sites migrate opportunistically (translation and call-translation first, as the highest-risk/highest-value cases); no forced migration deadline for lower-risk existing AI features.

---

## ADR-003: `Business` is a new entity, not a repurposed `organizations` table

**Problem:** Should a consumer-facing "business profile" reuse the existing `organizations` table (which already represents B2B tenants)?

**Context:** `organizations` is shaped for enterprise call-center tenants: departments, IVR menus, DID numbers, business hours as call-routing configuration. A small shop owner creating a public storefront page does not need any of that.

**Options considered:**
1. Extend `organizations` with nullable consumer-storefront fields.
2. Create a new `Business` entity as a sibling concept, with `BusinessMember`/`BusinessProfile`/`BusinessPage` alongside it.

**Decision:** Option 2. See `09_BUSINESS_PLATFORM_ARCHITECTURE.md`.

**Consequences:** A large enterprise can have both an `Organization` (internal call-center operations) and a `Business` (public storefront) — this models reality more accurately than forcing one table to represent both. Avoids adding to the config-sprawl pattern already flagged in `01_CURRENT_STATE_ARCHITECTURE.md`.

**Migration impact:** None to existing `organizations` data — purely additive.

---

## ADR-004: Chat/message content is not claimed as end-to-end encrypted

**Problem:** Is the current system E2E encrypted? (It was previously at risk of being informally described that way.)

**Context:** Direct code inspection shows only one narrow field (group voice-message audio path) is encrypted, server-side, with a key the server holds. Message text is plaintext. The standing rule (`23. NO FALSE GREEN` in the source brief) prohibits claiming E2E without evidence.

**Decision:** Explicitly document current state as NOT E2E (`08_E2E_PRIVACY_ARCHITECTURE.md`). Design four privacy modes (PRIVATE/AI-ASSISTED/BUSINESS/TELECOM) rather than retrofitting a blanket E2E claim onto a product whose core value (translation) requires server-side content access.

**Consequences:** True E2E (PRIVATE mode) becomes an opt-in that disables AI features for that conversation, not a universal guarantee — an honest tradeoff rather than a false claim.

**Migration impact:** Server-side encryption at rest for all message content (not just the one audio field) is treated as an immediate, independent improvement, not blocked on the full four-mode design landing.

---

## ADR-005: Advertising is sequenced last among Business Platform phases

**Problem:** Where does Advertising fit in the roadmap relative to Business Profiles, Templates, Campaigns, and Commerce?

**Context:** No evidence exists in this codebase or product's current usage of demand for an advertising surface. Building it early would be speculative relative to Catalog/Commerce, which have a clearer near-term business case (payments infrastructure is already real and production-grade).

**Decision:** Advertising is Phase 11, after Business Pages (7) and Templates (8), and does not block Commerce (12). See `10_MASTER_MIGRATION_ROADMAP.md`.

**Consequences:** Advertising ships only once there are real Business Pages to place ads against and real usage data to validate demand — reduces risk of building unused infrastructure.

**Migration impact:** None — greenfield, no dependency on it from other phases.
