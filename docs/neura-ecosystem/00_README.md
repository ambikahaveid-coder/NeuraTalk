# NEURA Ecosystem Architecture — Phase 0

**Status:** Phase 0 (Audit + Architecture) complete. No implementation started under this initiative.
**Date:** 2026-08-23
**Source of truth:** Six parallel codebase audits against `c:\Users\kiran\Downloads\Neura-Talk (1)\Neura-Talk` at commit `0b875c0`, cited with file:line evidence throughout.

## Why this folder exists separately

`docs/architecture/`, `docs/audit/`, and `docs/roadmap/` already contain a large number of prior audit and roadmap documents (`FINAL_ZERO_ASSUMPTION_AUDIT.md`, `MASTER_PRODUCTION_READINESS_CHECKLIST.md`, `PRODUCTION_READINESS_CERTIFICATION.md`, `MASTER_ROADMAP_INDEX.md`, and others). That volume is itself a finding: it's evidence of a repeated pattern in this project — audit gets written, roadmap gets written, implementation doesn't fully follow through, next audit gets written. See `12_PRODUCTION_RISK_REGISTER.md`, risk R18.

This folder is scoped narrowly to the current ecosystem-transformation initiative so it doesn't get lost in or mistaken for that prior body of documents. It supersedes prior architecture docs only where they conflict with the evidence cited here; it does not delete or invalidate them.

## Documents in this initiative

| # | File | Purpose |
|---|---|---|
| 1 | `01_CURRENT_STATE_ARCHITECTURE.md` | What exists today, evidence-classified |
| 2 | `02_TARGET_NEURA_ARCHITECTURE.md` | The ecosystem target, as a module tree |
| 3 | `03_MESSAGING_CONSOLIDATION_PLAN.md` | Collapsing 3 parallel messaging systems into 1 |
| 4 | `04_CALL_ARCHITECTURE_CONSOLIDATION_PLAN.md` | Collapsing overlapping call-session models into 1 |
| 5 | `05_AI_MODEL_GATEWAY_ARCHITECTURE.md` | Single AI abstraction layer, replacing 13+ ad hoc provider calls |
| 6 | `06_AI_SECURITY_AND_PERMISSION_MODEL.md` | READ/SUGGEST/CONFIRM/EXECUTE/HIGH-RISK tiering for every AI action |
| 7 | `07_RAG_AND_MEMORY_ARCHITECTURE.md` | Knowledge retrieval + permission-scoped memory (currently missing) |
| 8 | `08_E2E_PRIVACY_ARCHITECTURE.md` | Honest current-state (not E2E) + 4-mode privacy design |
| 9 | `09_BUSINESS_PLATFORM_ARCHITECTURE.md` | Business profiles, catalog, templates, campaigns, ads, commerce, agents |
| 10 | `10_MASTER_MIGRATION_ROADMAP.md` | Dependency-ordered phase sequence |
| 11 | `11_ARCHITECTURE_DECISION_RECORDS.md` | ADRs for the load-bearing decisions in this initiative |
| 12 | `12_PRODUCTION_RISK_REGISTER.md` | Top risks, P0–P3, with owner-facing tracking columns |
| 13 | `13_BUSINESS_PLATFORM_MASTER_AUDIT.md` | Multi-channel (WhatsApp/SMS-DLT/Email) adapters, white-label tenancy, template/campaign/automation engines, event catalog — extends 01-12, doesn't replace them |
| 14 | `14_NEURA_BUSINESS_SAAS_SPECIFICATION.md` | Standalone B2B SaaS spec (clone the *product category*, not Meta's tech) — corrects 13's external-approval mirroring since there's no Meta dependency at all; full domain model, API map, screen inventory, phased plan |
| 18 | `18_ADMIN_AND_BUSINESS_SAAS_IMPLEMENTATION_AUDIT.md` | Admin auth, super-admin, business admin, tenant architecture, RBAC, security/billing audit, Meta-model mapping, P0-P3 findings |
| 19 | `19_ADMIN_FORMS_CRUD_GOVERNANCE_MASTER_AUDIT.md` | Full lifecycle (create→approve→suspend→delete→audit) audit of every admin form/entity; corrects/sharpens 18's tenant finding (a real `organizations`-based business CRUD exists, just unnamed as "tenant"); master entity matrix + P0-P3 implementation plan |
| 20 | `20_PRODUCTION_DEPLOYMENT_INTEGRITY_AUDIT.md` | Root-cause: DigitalOcean deployed the committed `dist/` directly, never ran `npm run build` -- every server-touching commit from `6ab722d` through `430c34b` (~22h) was pushed/marked ACTIVE without the runtime artifact ever changing, including the P0 `/api/conversations` security fix. Section 0: the approved Model A fix, implemented |
| 21 | `21_PRODUCTION_DEPLOYMENT_RUNBOOK.md` | Canonical deployment + production-verification procedure going forward: source-is-truth build pipeline, mandatory 5-point verification protocol, rollback steps |

**Visual artifact (current-state + target-state, published earlier this session):** https://claude.ai/code/artifact/444207ba-36c1-4739-8b30-ae16f208719d

## Standing constraints this initiative operates under

- A feature freeze is active: no new application features until the core communication stack (calls, translation, messaging) is physically certified.
- A live translation test (Telugu ↔ English, real devices) is in progress; its result is a hard input to `01_CURRENT_STATE_ARCHITECTURE.md`'s translation classification and is not yet folded in as of this writing.
- **No production code has been touched to produce these documents.** Only this `docs/neura-ecosystem/` folder was created.
- Implementation does not begin until the user has reviewed and approved this architecture, per their explicit instruction.
