# NEURA BUSINESS — B2B SaaS Product Specification

**Status:** Specification only. No code changed, no migrations run, no UI built.
**Corrects `13_BUSINESS_PLATFORM_MASTER_AUDIT.md`:** that document designed a `TEMPLATE_APPROVAL` table to *mirror* an external provider's (Meta/DLT) approval state. Per this request's explicit correction — **no Meta/WhatsApp dependency of any kind** — NEURA owns 100% of its own template approval workflow. `TEMPLATE_APPROVAL` below is simplified accordingly: it tracks NEURA's own human-reviewer decision, not an external system's state.
**Evidence discipline unchanged:** every REAL/PARTIAL/MISSING/CONFLICTING/REQUIRES-MIGRATION classification is backed by file:line evidence or an explicit verified-absent search, consistent with docs 01-13.

---

## 1. NEURA Business Product Specification

NEURA Business is a standalone B2B SaaS layer on top of the existing NEURA consumer platform. A business gets: an identity, a customer inbox, a template-driven messaging engine, campaigns, automation flows, an optional AI agent, a catalog, and usage-based billing — all running on NEURA-native infrastructure (app messaging, LiveKit calls, the translation pipeline already built). No external platform (Meta, Google Business, etc.) is a dependency at any layer.

## 2. Complete Feature Parity Matrix

| Capability | Status | Evidence |
|---|---|---|
| Business Account / Profile / Identity | PARTIAL | `organizations` table exists (`shared/schema.ts`) but shaped for enterprise call-center tenants, not a SaaS business account — see `09_BUSINESS_PLATFORM_ARCHITECTURE.md` ADR-003 |
| Customer/Contact Management | PARTIAL | `userContacts`, `blockedUsers` exist for consumer contacts (Phase 0); no business-side CRM/customer record concept |
| Groups | REAL | `groupChats`/`groupChatMembers` (consumer-facing; reusable pattern, not business-scoped) |
| Unified Inbox | MISSING | No inbox view spanning multiple conversations for a business across customers |
| 1:1 Messaging | REAL | `personalChatThreads`/`personalChatMessages`, translation verified this session |
| Business Messaging | MISSING | No business-initiated, template-gated messaging path exists |
| Templates (all types/categories) | MISSING | Verified absent in Phase 0 and doc 13 — only an MSG91 OTP template-ID passthrough exists |
| Rich media (buttons/carousels/docs/images/video) | PARTIAL | File/image/video attachment sending exists in consumer chat (`conversation_screen.dart`, built and verified this session); no button/carousel structured-message rendering anywhere |
| Catalog / Catalog Items / Orders / Payments | MISSING | No product/catalog/order tables anywhere (Phase 0, doc 13 §7); Payments infrastructure itself is REAL (Razorpay, `payment-service.ts`, confirmed Phase 0) and reusable once orders exist |
| Live Chat / Agents | REAL (human agent side) | Real call-center agent/queue infrastructure (`agentSkills`, `agentPresence`, ACD queue confirmed working this session) — built for voice, not text live-chat, but the routing/presence primitives are reusable |
| AI Agents / Bot Responders | MISSING | No customer-facing AI agent exists; nearest neighbor is human-agent-assist (`server/enterprise/agent-assist.ts`) — a different feature (Phase 0) |
| Automation / Flows / Keyword triggers | MISSING | No flow/trigger engine anywhere |
| Drip / Scheduled Campaigns | MISSING | Zero "campaign" matches anywhere (Phase 0) |
| Audience / Segmentation / Retargeting | MISSING | No audience or segment concept |
| Campaign/Message/Delivery/Customer/Conversion Analytics | MISSING (business-side) | Real analytics exist for platform admin (`SuperAdminDashboard.tsx`), none for a business's own customers/campaigns |
| API / Webhooks / Developer Keys | PARTIAL | `enterpriseApiKeys` + real, production-grade webhook delivery (HMAC-signed, SSRF-defended, confirmed Phase 0) exist; no self-serve issuance, no public docs |
| Reports | PARTIAL | Real for platform-level (admin); none business-scoped |
| Billing / Credits | REAL (infra), MISSING (business-scoped usage) | Razorpay, subscriptions, wallet, invoices, refunds all REAL and production-grade (Phase 0) — built for consumer/enterprise-call-center billing, not per-business SaaS seat/usage billing |
| Multi-user Teams / Roles / Permissions | REAL (infra) | `role-middleware.ts` RBAC is real and genuinely fine-grained (Phase 0) — vocabulary needs extending for business-specific permissions (§4), not a new engine |
| Approval Workflows | PARTIAL | Real generic pattern exists (org approval in `b2b-routes.ts`, per Phase 0's business audit agent) — no template/campaign-specific approval flow |
| Audit Logs | REAL | `audit.ts`/`audit-logging.ts`, confirmed Phase 0 |
| Compliance (GDPR/DPDP) | REAL | Confirmed Phase 0 |
| Abuse Controls / Fraud Protection | REAL (call-scoped) | Real velocity/prefix fraud detection for calls (Phase 0); not extended to messaging/campaign abuse |
| Business Settings / Notification Settings / AI Settings / Branding | MISSING | No business-level settings surface exists |
| White-label | MISSING | Verified absent (doc 13 §9) |
| Tenant isolation | PARTIAL | Real for `organizations`-scoped data (RBAC + org-scoped queries throughout); no dedicated `Business`/`Tenant` isolation layer yet |

## 3. B2B Tenant Architecture

```
TENANT                 id, type: 'platform'|'business', parentTenantId (nullable — reserved for future reseller layer, not built now per your explicit "don't implement full white-label UI yet")
BUSINESS               id, tenantId, name, category, logoUrl, description, verificationStatus, createdAt
BUSINESS_MEMBER        businessId, userId, role, invitedBy, joinedAt
BUSINESS_SETTINGS      businessId, notificationPrefs, aiSettings, brandingConfig (populated, UI deferred to Phase 11)
```

`BUSINESS` is a new entity, sibling to `organizations` — same reasoning as `09_BUSINESS_PLATFORM_ARCHITECTURE.md` ADR-003: `organizations` remains the enterprise call-center tenant shape; `BUSINESS` is the SaaS-customer shape. A `BUSINESS_MEMBER` row is how RBAC scopes a user's permissions to one business (§4). Every business-scoped table below carries `businessId` as a hard filter — tenant isolation is enforced at the query layer, not just at the RBAC layer, matching the existing pattern already used for `organizationId` scoping throughout `role-middleware.ts` and the billing engine.

## 4. Admin / RBAC Matrix

Extends `role-middleware.ts`'s existing real permission-constant system (confirmed real in Phase 0) — this is a vocabulary addition, not a new engine, per doc 13 §20 and this request's own "no duplicate architecture" rule.

| Level | Scope | Example permissions |
|---|---|---|
| GLOBAL NEURA ADMIN | Platform-wide | `platform.manage`, existing `super_admin` role |
| SUPER ADMIN | Platform-wide, one layer below Global | Existing `super_admin`/`investor` roles (Phase 0) |
| ORGANIZATION/TENANT | One tenant | `tenant.manage_businesses` |
| BUSINESS ADMIN | One business | `messages.send`, `templates.approve`, `campaigns.launch`, `contacts.export`, `billing.manage`, `agents.manage`, `catalog.manage`, `api.manage`, `users.manage`, `compliance.manage` |
| MANAGER | One business, restricted | `messages.send`, `campaigns.create` (not `.launch`), `contacts.read` |
| AGENT | One business, conversation-scoped | `messages.read`, `messages.send` (assigned conversations only) |
| BOT/AI AGENT | One business, tier-scoped | Not a role — governed entirely by `06_AI_SECURITY_AND_PERMISSION_MODEL.md`'s READ/SUGGEST/CONFIRM/EXECUTE/HIGH_RISK tiers per-action, not a static permission set |

Every permission check server-side, never UI-only — matching the existing, already-correct pattern in `role-middleware.ts`.

## 5. Template Architecture

```
TEMPLATE            id, businessId, name, category: 'marketing'|'utility'|'authentication', type, status, currentVersionId, createdBy
TEMPLATE_VERSION     id, templateId, version, content (variables, buttons, media refs), createdAt
TEMPLATE_APPROVAL     id, templateVersionId, reviewerId, decision: 'approved'|'rejected', reason, decidedAt
```

Simplified from doc 13 per this request's correction: `TEMPLATE_APPROVAL` records NEURA's own reviewer decision only — no external provider state to mirror. Lifecycle: `DRAFT → SUBMITTED → UNDER_REVIEW → (APPROVED | REJECTED) → ARCHIVED`, with `edit`/`duplicate` operating on a new `TEMPLATE_VERSION`, not mutating an approved one (preserves audit history, matches the request's explicit "versioning" + "audit history" requirements).

## 6. Campaign Architecture

```
AUDIENCE            id, businessId, name, filterCriteria (segment definition)
CAMPAIGN             id, businessId, templateId, audienceId, type: 'single'|'bulk'|'scheduled'|'drip'|'retargeting'|'trigger'|'event', status, schedule, throttleConfig
CAMPAIGN_SEND        id, campaignId, contactId, messageId (FK into canonical MESSAGE — see §14), status: 'sent'|'delivered'|'failed'|'read'|'replied'
```

Lifecycle exactly as requested: `DRAFT → REVIEW → APPROVED → SCHEDULED → RUNNING → PAUSED → COMPLETED → FAILED`. Every `CAMPAIGN_SEND` produces one canonical `MESSAGE` row (§14) — campaigns are a *sender* of canonical messages, not a parallel message type, directly satisfying this request's "no `CampaignMessage`" rule.

## 7. Flow / Automation Architecture

```
FLOW                id, businessId, name, trigger: 'keyword'|'new_customer'|'order_created'|'payment_received'|'webhook'|'api'|'campaign_event', status
FLOW_NODE            id, flowId, type: 'condition'|'action'|'wait'|'branch'|'ai'|'human_handoff', config, nextNodeId(s)
FLOW_RUN             id, flowId, contactId, currentNodeId, status, startedAt
```

The "AI" node type invokes the AI Agent (§8) through the approved AI Model Gateway (`05_AI_MODEL_GATEWAY_ARCHITECTURE.md`) — a flow never calls an AI provider directly, closing off exactly the kind of ad hoc integration this request explicitly forbids.

## 8. AI Agent Architecture

Reuses, does not duplicate, three already-approved documents:
- `05_AI_MODEL_GATEWAY_ARCHITECTURE.md` — every model call an agent makes goes through the gateway.
- `06_AI_SECURITY_AND_PERMISSION_MODEL.md` — every agent action is tagged READ/SUGGEST/CONFIRM/EXECUTE/HIGH_RISK; e.g. an AI Sales Agent's "answer a product question" is READ/SUGGEST, "create an order" is CONFIRM, an AI Collections Agent's "waive a fee" is HIGH_RISK.
- `07_RAG_AND_MEMORY_ARCHITECTURE.md` — agent knowledge base and per-customer memory both go through the permission-scoped retrieval layer designed there, with the tenant-isolation filter from §3 applied before retrieval, matching that document's "never leak tenant data across organizations" requirement.

```
AI_AGENT            id, businessId, role, instructions, knowledgeSourceIds, escalationRules, workingHours, fallbackBehavior
AI_AGENT_ACTION_LOG  id, agentId, conversationId, tier, action, result, approvedBy (nullable, for CONFIRM/HIGH_RISK actions)
```

No new AI architecture — this is purely a business-facing *configuration* surface over the three documents above.

## 9. Billing / Usage Architecture

Reuses the real, production-grade payment/subscription/wallet/invoice infrastructure (Phase 0, confirmed `payment-service.ts`, `billing-engine.ts`). New, business-SaaS-specific usage dimensions:

```
BUSINESS_SUBSCRIPTION   businessId, planId, seats, addOns
USAGE_RECORD             businessId, dimension: 'messages'|'ai_calls'|'voice_minutes'|'storage_gb'|'seats', quantity, periodStart
```

`USAGE_RECORD` extends the existing `usageRecords` table pattern already in the schema (Phase 0's domain-model audit) rather than creating a parallel usage-tracking system. Message/AI/voice usage dimensions map onto the canonical `MESSAGE` (§14), `AI_AGENT_ACTION_LOG` (§8), and existing call-billing records respectively — one usage pipeline, three sources.

## 10. Developer API Architecture

Extends the real `enterpriseApiKeys` + webhook infrastructure (Phase 0) rather than building new auth/delivery. Gap to close: self-serve key issuance (currently admin-only), API versioning convention (none exists yet — recommend `/api/v1/business/...` prefix for all new Business endpoints specifically, since existing `/api/calls/...` etc. are unversioned and shouldn't be retrofitted), and published docs. Webhook signatures, retry handling, and delivery logs are **already real** (Phase 0) — direct reuse, zero new infrastructure needed there.

## 11. Database Domain Model

Consolidated from §3, 5-10, layered on the canonical `CONVERSATION`/`PARTICIPANT`/`MESSAGE` model from `03_MESSAGING_CONSOLIDATION_PLAN.md` (unchanged, not duplicated):

```
TENANT ──< BUSINESS ──< BUSINESS_MEMBER >── users (existing)
BUSINESS ──< AUDIENCE
BUSINESS ──< TEMPLATE ──< TEMPLATE_VERSION ──< TEMPLATE_APPROVAL
BUSINESS ──< CAMPAIGN >── AUDIENCE, TEMPLATE
CAMPAIGN ──< CAMPAIGN_SEND >── MESSAGE (canonical, from 03_MESSAGING_CONSOLIDATION_PLAN.md)
BUSINESS ──< FLOW ──< FLOW_NODE
FLOW ──< FLOW_RUN >── CONVERSATION (canonical)
BUSINESS ──< AI_AGENT ──< AI_AGENT_ACTION_LOG >── CONVERSATION (canonical)
BUSINESS ──< BUSINESS_SUBSCRIPTION, USAGE_RECORD
BUSINESS ──< enterpriseApiKeys (existing), webhookEndpoints (existing)
```

Every table above that references messaging goes through `CONVERSATION`/`MESSAGE`, not a new message shape — directly enforcing §16's "no duplicate messaging architecture" rule at the schema level, not just as a design intention.

## 12. API Domain Map

All new, under a versioned prefix (§10):

```
POST   /api/v1/business                       create business
GET    /api/v1/business/:id                    read
PATCH  /api/v1/business/:id/settings           branding, notifications, AI settings

GET    /api/v1/business/:id/inbox              unified inbox (reads canonical CONVERSATION, filtered by businessId)
POST   /api/v1/business/:id/conversations/:cid/reply

POST   /api/v1/business/:id/templates
POST   /api/v1/business/:id/templates/:tid/submit
POST   /api/v1/business/:id/templates/:tid/approve   (BUSINESS ADMIN / reviewer only)
POST   /api/v1/business/:id/templates/:tid/reject

POST   /api/v1/business/:id/campaigns
POST   /api/v1/business/:id/campaigns/:cid/launch
GET    /api/v1/business/:id/campaigns/:cid/analytics

POST   /api/v1/business/:id/flows
POST   /api/v1/business/:id/flows/:fid/activate

POST   /api/v1/business/:id/agents
GET    /api/v1/business/:id/agents/:aid/action-log

GET    /api/v1/business/:id/reports/{messaging|customers|campaigns|sales|voice|usage}

POST   /api/v1/business/:id/api-keys           self-serve issuance (gap to close, §10)
POST   /api/v1/business/:id/webhooks
```

Each route requires `requireAuth` + a `BUSINESS_MEMBER` check scoped to `:id`, mirroring the existing `requireCallAccess`/`canAccessSmartCall` pattern already used consistently elsewhere.

## 13. Screen / Admin Panel Inventory

| Screen | Business role | Notes |
|---|---|---|
| Business Dashboard | Business Admin, Manager | KPI summary — messaging, campaigns, revenue |
| Unified Inbox | Business Admin, Manager, Agent | Filtered/assigned views per §9 (Phase 0 request numbering) |
| Contacts / Customers | Business Admin, Manager | CRM-style customer record |
| Templates | Business Admin (approve), Manager (create) | Draft/submit/review/approve UI |
| Campaigns | Business Admin, Manager | Builder + analytics |
| Automation / Flows | Business Admin, Manager | Visual flow builder |
| AI Agents | Business Admin | Configuration + action log |
| Catalog | Business Admin, Manager | Deferred to Phase 6 |
| Reports | Business Admin, Manager | §12's report endpoints |
| API / Webhooks | Business Admin | Developer console |
| Billing | Business Admin | Plan, seats, usage, invoices |
| Team / Roles | Business Admin | Member + permission management |
| Settings | Business Admin | Branding, notifications, AI settings |

Platform-side (existing, unchanged): `SuperAdminDashboard.tsx`/`AdminSections.tsx` gain a "Businesses" section for cross-tenant oversight — not a rebuild.

## 14. Implementation Phases

Matches the request's Phase 1-12 exactly, cross-referenced against the existing `10_MASTER_MIGRATION_ROADMAP.md`:

| Phase | Scope | Depends on existing roadmap |
|---|---|---|
| 1 | Tenant + Business identity + RBAC extension | Existing Phase 2 (Messaging consolidation) not required yet — this phase is schema/identity only |
| 2 | Business inbox + customer management | **Hard dependency: existing Phase 2 (Messaging consolidation) must be done first** — an inbox reading three different message shapes is the exact anti-pattern both this doc and `03_MESSAGING_CONSOLIDATION_PLAN.md` forbid |
| 3 | Templates | Phase 1 |
| 4 | Campaigns | Phase 2, 3 |
| 5 | Automation/Flows | Phase 2 |
| 6 | Catalog/Commerce | Phase 3 |
| 7 | AI Agents | Existing Phase 4 (AI Gateway) + Phase 5 (RAG+Memory+Permission) — **hard dependency, not yet built** |
| 8 | Analytics/Reports | Phases 2-7 (needs real data flowing) |
| 9 | Billing/Usage | Phase 1 (existing billing infra reused, not rebuilt) |
| 10 | Developer APIs | Phase 1 |
| 11 | White-label | Phase 1, deferred UI per this request's own instruction |
| 12 | Advanced AI optimization | Phase 7 |

## 15. Dependency Graph

```
Existing Phase 2 (Messaging Consolidation) ──┬──> NEURA-Business Phase 2 (Inbox)
                                              └──> NEURA-Business Phase 4 (Campaigns, via CAMPAIGN_SEND → MESSAGE)
Existing Phase 4 (AI Gateway) ──┬──> NEURA-Business Phase 7 (AI Agents)
Existing Phase 5 (RAG+Memory+Permission) ──┘
NEURA-Business Phase 1 (Tenant+RBAC) ──> everything else in this spec
NEURA-Business Phase 3 (Templates) ──> Phase 4 (Campaigns), Phase 5 (Flows' "send template" action)
```

**The two hard blockers are unchanged from doc 13: messaging consolidation and the AI Gateway.** Nothing in this specification removes or works around them — Phase 2 and Phase 7 above are explicitly gated on them.

## 16. Security / Compliance Model

Reuses, not replaces: RBAC (`role-middleware.ts`), audit logging (`audit.ts`), rate limiting (real, Redis-backed), webhook HMAC signing + SSRF defense, GDPR export/delete (all confirmed real, Phase 0). New for this spec: tenant-isolation enforcement at the query layer for every `businessId`-scoped table (§3, §11) — every query must filter by `businessId` derived from the authenticated `BUSINESS_MEMBER` row, never trust a client-supplied `businessId`. Encryption status inherited honestly from `08_E2E_PRIVACY_ARCHITECTURE.md` — business messaging is AI-ASSISTED/BUSINESS mode by default (server processes content for templates/campaigns/AI agents), never claimed as E2E.

## 17. Test Strategy

- **Unit**: template lifecycle state machine, campaign lifecycle state machine, flow node execution, RBAC permission checks per role in §4's matrix.
- **Integration**: tenant isolation (a business's query must never return another business's rows — the single most important test class here), template approval → campaign send → canonical `MESSAGE` creation round trip.
- **Security**: cross-tenant data leakage attempts (adversarial `businessId` substitution on every endpoint in §12), webhook signature verification, API key scope enforcement.
- Given this session's established pattern (real mocking gaps found in both the Flutter and server test suites this session), expect the same constraint here: full end-to-end tests touching the canonical messaging model will need the messaging-consolidation work done first to have a stable target to test against.

## 18. Production Readiness Gates

Per the existing `31. PRODUCTION RELEASE GATE` standard already established this session: functional (all Phase 1-3 flows work), security (tenant isolation adversarially tested, not just unit-tested), data (migration verified against real Phase 0 schema), performance (campaign send throughput measured, not assumed), observability (extends the existing `call_setup_latency`-style structured logging pattern, not a new telemetry system), failure (template/campaign/flow failure paths tested), rollback (documented), real integrations (Razorpay billing reuse actually tested, not assumed to work because it works for calls), UX (manually verified on real devices, matching this session's own standard for the consumer app).

---

**No code changes made in this pass.** Waiting for your review and explicit approval before any implementation begins, per your instruction. The two structural blockers (messaging consolidation, AI Gateway) remain unresolved and are not bypassed anywhere in this specification.
