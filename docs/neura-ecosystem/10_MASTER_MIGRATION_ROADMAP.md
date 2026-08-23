# Master Migration Roadmap

Dependency-ordered. No phase begins before the ones it depends on are production-certified per `31. PRODUCTION RELEASE GATE` (source brief) — functional, security-reviewed, data-migrated-and-verified, performance-tested, observable, failure-tested, rollback-documented, real-integrations-tested, and manually UX-verified.

This ordering matches the source brief's own Section 32 sequence. Repository evidence gathered in `01_CURRENT_STATE_ARCHITECTURE.md` does not surface a reason to deviate from it — if anything, the evidence reinforces it: building Business/Marketing/Commerce (Phases 7-12) on top of today's fragmented messaging model or ad hoc AI provider calls would multiply, not reduce, the debt already found.

| Phase | Scope | Depends on | Why this position, per evidence |
|---|---|---|---|
| **0** | Architecture + audit + dependency map | — | This document set. Complete. |
| **1** | Translation live validation | — | The product's stated north star (multilingual communication) has real code and real configured infrastructure but has *never once run end-to-end* — every test account shared one language until this session's live test. Nothing downstream should be built on an unproven core claim. See `12_PRODUCTION_RISK_REGISTER.md` R2. |
| **2** | Messaging consolidation | Phase 1 (needs stable messaging behavior to migrate safely) | Three parallel systems today (`01`, `03`). Fix while the surface area is still small — every phase after this that touches messages would otherwise need to be built three times. |
| **3** | Call architecture consolidation | Phase 1 | Overlapping call-session models with weak FK integrity (`01`, `04`). Same rationale as Phase 2, for calls. |
| **4** | AI Model Gateway | Phases 2-3 not required, but soon after for consistency | 13+ hardcoded provider integrations today. Every subsequent AI feature (Phases 5, 9, 10, 11) must be a gateway *consumer*, never another direct provider call — this is the single highest-leverage build in the whole roadmap. |
| **5** | RAG + Memory + AI permission framework | Phase 4 | Business AI Agents (Phase 9) have nothing to retrieve from or be safely gated by without this. Building agents before this exists would repeat the exact "build it ad hoc per feature" mistake the gateway (Phase 4) was meant to end. |
| **6** | E2E / privacy architecture | Phase 2 (needs canonical message model to attach privacy modes to) | Current state is server-side-only encryption on one narrow field, falsely adjacent to an "E2E" claim if left unaddressed while user-facing trust claims scale up in Phases 7+. |
| **7** | Business identity + Business Pages | Phase 2 | First genuinely new consumer-facing surface. `Business` as a new entity sibling to `Organization`, not a repurposing of the enterprise org model (`09`). |
| **8** | Business messaging + templates | Phase 7 | Templates target a Business; can't exist before Businesses do. |
| **9** | Business AI agents | Phases 4, 5, 7 | Consumes the gateway, RAG/memory, and needs a Business to belong to. |
| **10** | Marketing + campaigns | Phase 8 (templates) | Campaigns send templates to an audience. |
| **11** | Advertising | Phase 7 (needs Business Pages to be a placement target) | Lowest-evidence-of-demand component in the entire brief — no signal in this codebase or its usage data that this is needed yet. Sequenced last among Business Platform items deliberately. |
| **12** | Commerce + bookings | Phase 7 (Catalog belongs to a Business) | Payments infrastructure (Razorpay, wallet, invoices, refunds) is already real and reused as-is — only Cart/Order/Delivery/Booking are new. |
| **13** | Telecom / PSTN / IVR expansion | — (parallelizable with Business Platform phases; blocked only on itself) | IVR routing is documented in the code as never having been ported (`01`); real live SIP/PSTN provisioning is self-reported unverified. This is real, standalone technical work independent of the Business Platform track. |
| **14** | Developer platform + agent ecosystem | Phases 4, 9 | Opens the ecosystem to external builders — a multiplier on everything above, not a prerequisite for any of it, hence last. |

## Continuous, not phased

- **CI/CD and automated regression testing.** Currently a fully manual release protocol (established this session after a stale-build incident: mandatory `flutter clean`, binary inspection, SHA-256 recording). This does not scale across a 14-phase roadmap and should be formalized in parallel with Phase 2 onward, not deferred to the end.
- **Observability** (structured logs, correlation IDs, AI cost/latency, call quality, translation latency) — instrumented incrementally as each phase ships, per `31. PRODUCTION RELEASE GATE`'s observability requirement, not retrofitted later.

## What does NOT wait for this roadmap

Root-cause bug fixes on the existing, real communication stack (calls, chat, translation, notifications) continue under the standing feature-freeze protocol already in effect this session — this roadmap governs new ecosystem capability, not maintenance of what's already shipped.
