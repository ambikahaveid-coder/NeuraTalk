# Production Risk Register

Severity scale per source brief: **P0** (blocks production trust/claims, act now) · **P1** (high, address in near-term roadmap) · **P2** (medium, address opportunistically) · **P3** (low, track only). Every row is grounded in the six-audit evidence base — no hypothetical risks.

| # | Risk | Category | Severity | Status |
|---|---|---|---|---|
| R1 | Chat text has no end-to-end encryption; server holds all keys. A translation-first product handling private conversations without E2E is a real trust liability. | Security | **P0** | Open — design in `08_E2E_PRIVACY_ARCHITECTURE.md` |
| R2 | The core "live translation" claim has never been proven end-to-end with real users — all test accounts shared one language until this session. | Product | **P0** | Open — live cross-language test in progress |
| R3 | No AI model gateway: 13+ hardcoded provider calls mean total vendor lock-in and no consistent error handling, cost tracking, or observability across AI features. | Technical | **P0** | Open — `05_AI_MODEL_GATEWAY_ARCHITECTURE.md` |
| R4 | No AI safety/risk-tiering framework. Every future "AI takes an action" feature has nothing to build permission-gating on top of. | Security | **P0** | Open — `06_AI_SECURITY_AND_PERMISSION_MODEL.md` |
| R5 | Duplicated call-session models with weak foreign-key integrity — billing and telemetry correctness degrades further with every new call path layered on. | Technical | P1 | Open — `04_CALL_ARCHITECTURE_CONSOLIDATION_PLAN.md` |
| R6 | Three independently-built messaging systems with no shared abstraction — every cross-cutting feature must be built three times or drifts. | Technical | P1 | Open — `03_MESSAGING_CONSOLIDATION_PLAN.md` |
| R7 | No session/device revocation — a lost or stolen phone cannot be remotely logged out. | Security | P1 | Open |
| R8 | PSTN IVR routing doesn't exist — inbound calls silently bypass any configured menu and land in a general queue. | Product | P1 | Open |
| R9 | SIP/PSTN trunk provisioning is self-reported as unverified in code comments — real-world telecom behavior has not been confirmed live. | Compliance | P1 | Open |
| R10 | Business profiles, catalog, templates, campaigns, ads, and business AI agents are 100% unbuilt — the entire "ecosystem" half of the vision has zero existing foundation beyond payments and admin. | Product | P1 | Open — `09_BUSINESS_PLATFORM_ARCHITECTURE.md` scopes the build |
| R11 | No self-serve developer API key issuance — the entire "developer platform" phase is blocked on this alone. | Technical | P2 | Open — Phase 14 |
| R12 | Fraud detection is narrow (velocity + prefix blocking only) and fails open on Redis outage — real toll-fraud exposure once call/PSTN volume grows. | Security | P1 | Open |
| R13 | No RAG/knowledge-base infrastructure — any "business AI agent answers from our own data" feature has nothing to retrieve from. | Technical | P2 | Open — `07_RAG_AND_MEMORY_ARCHITECTURE.md` |
| R14 | A feature freeze is currently active and a live translation test was mid-flight when this ecosystem initiative began — starting implementation without resolving that first would violate the user's own established protocol. | Product | **P0** | **Mitigated** — this document set is architecture-only; no implementation has started |
| R15 | Real financial/regulatory surface already exists (Razorpay, GST invoices, refunds) — any new commerce/marketing/ads work inherits RBI/DPDP/TRAI obligations, not just technical scope. | Compliance | P1 | Open — flag for legal review before Phase 10-12 |
| R16 | Mobile release process is entirely manual (clean build + binary verification) — no CI/CD. Won't scale across a 14-phase roadmap. | Scalability | P2 | Open — recommend addressing in parallel with Phase 2 |
| R17 | Six overlapping settings/config tables — no single source of truth for platform configuration as more admin surfaces get added. | Technical | P2 | Open |
| R18 | Several schema tables show only single-file usage (likely orphaned) and the docs/ folder already contains many prior audit/roadmap documents whose findings weren't fully acted on — evidence of a repeated "build it, half-wire it, move on" pattern in this project specifically. | Technical | P2 | Open — this document set names itself as scoped and dated (`00_README.md`) partly to avoid repeating this pattern |
| R19 | Admin dashboard and org model are enterprise-call-center-shaped, not consumer-business-shaped — "one business page for everyone" needs new UI paradigms, not an extension of the existing admin surface. | Product | P2 | Open — `09_BUSINESS_PLATFORM_ARCHITECTURE.md` ADR-003 |
| R20 | No evidence of an automated test suite or CI gating anywhere in the audit — production changes rely entirely on the manual verification protocol established this session, which will not scale to ecosystem-wide feature surface. | Scalability | P1 | Open |

## P0 items — what "resolved" looks like

- **R1 (E2E):** Four privacy modes designed and PRIVATE mode's cryptographic approach selected against an established protocol, reviewed, before any user-facing claim of "encrypted" changes.
- **R2 (translation unproven):** A completed live test (Telugu↔English, real devices, real network conditions) with recorded STT/translation/TTS results, latency numbers, and error cases — see `12. TRANSLATION — PRODUCTION VALIDATION` in the source brief for the exact test matrix required.
- **R3 (no AI gateway):** Gateway built and translation + call-translation migrated onto it (Phase 4 first-movers per `10_MASTER_MIGRATION_ROADMAP.md`).
- **R4 (no AI safety tiers):** Tiering framework enforced in the gateway's Policy stage before the first EXECUTE/HIGH-RISK-tier AI feature ships.
