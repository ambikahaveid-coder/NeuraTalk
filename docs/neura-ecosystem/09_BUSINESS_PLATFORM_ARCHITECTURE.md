# Business Platform Architecture

Covers: business profiles, catalog, messaging templates, campaigns, advertising, commerce, business AI agents. All currently MISSING or PARTIAL per `01_CURRENT_STATE_ARCHITECTURE.md`. This is the largest greenfield area of the whole initiative — nearly nothing here exists today beyond payments and RBAC, which are reused, not rebuilt.

## Identity: one person, many roles

Per the brief's Section 14, a user must not require a separate account to be a business owner, employee, customer, or organization member. The existing schema already gets this partially right: `users.organizationId` (nullable) distinguishes B2C from B2B users within one table, and `/api/b2b/*` + `/api/b2c/current-customer` coexist in the same router sharing `requireAuth` (`b2b-routes.ts`). This pattern extends rather than replaces:

```
Business          new entity — the consumer-facing counterpart to the existing enterprise `organizations` table
Organization       existing — reused as-is for enterprise/call-center tenants
BusinessMember      person's role within a Business (owner, staff, agent)
BusinessRole        permission set for that role — reuses role-middleware.ts's existing RBAC pattern, not a parallel system
BusinessProfile     public-facing identity: name, category, logo, description, verification status
BusinessPage        the rendered storefront a consumer sees
```

**Why `Business` is a new entity rather than reusing `organizations`:** the audit found `organizations` is shaped for enterprise call-center tenants (departments, IVR, DIDs, business hours as call-routing hours) — extending it to also mean "a shop's public profile" would recreate the config-sprawl problem already flagged in `01_CURRENT_STATE_ARCHITECTURE.md`. A small business owner does not need departments or IVR menus. `Business` and `Organization` are siblings under the same person, not one collapsed into the other; an enterprise can have both.

## Catalog

```
Catalog       businessId, name (a business can have more than one, e.g. seasonal)
Product       catalogId, name, description, price, images, availability
Service       catalogId, name, description, price, duration (for bookable services)
```

Genuinely new — no product/service concept exists in the schema today.

## Business messaging templates

Lifecycle, exactly as specified:

```
Draft → Validation → Approval → Published → Active → Paused → Archived
```

Categories: **MARKETING**, **UTILITY**, **AUTHENTICATION** — matching the real-world constraint that messaging providers (and eventually regulators) treat these differently for spam/consent purposes. The one existing template-shaped thing in the codebase — `msg91-service.ts`'s `templateId` passthrough — is an OTP provider template reference, not a reusable pattern; this system is built new, but the AUTHENTICATION category should route through it for consistency, not bypass it as a special case.

Required support: variables, language variants, preview, versioning, approval workflow, audit logs (reuses `auditLogs`), analytics, permissions (reuses RBAC). The approval gate is what prevents uncontrolled spam — no template reaches Active status without passing Validation + Approval, and this is enforced server-side, not just hidden in the UI (per the standing rule against relying on frontend hiding).

## Campaigns & Marketing

```
Audience      businessId, segmentation criteria (reuses customer data owned by that business's BusinessConversation records)
Campaign      businessId, goal, audienceId, templateId, channel, budget, status
Schedule      campaignId, sendAt, timezone
```

AI can generate campaign copy and targeting suggestions (SUGGEST tier, per `06_AI_SECURITY_AND_PERMISSION_MODEL.md`). Launching a campaign that spends money is HIGH-RISK tier — requires explicit human confirmation, not an AI-initiated send.

## Advertising

```
Advertiser → Campaign → Audience → Creative → Placement → Ad → Conversation → AI → Conversion
```

Track impressions, clicks, conversations, leads, conversions, revenue, ROAS — not impressions alone. This is the least-validated area of the whole brief: no evidence of user or business demand exists yet in this codebase or its usage data. Recommend treating this as the lowest-priority Business Platform component (see `10_MASTER_MIGRATION_ROADMAP.md`), built only once Business Profiles and Catalog have real usage to target ads against.

## Commerce

```
Business → Catalog → Product → Conversation → AI Recommendation → Cart → Checkout → Payment → Order → Delivery → Support
```

The **Payment** step is not new work — `payment-service.ts`'s real Razorpay integration is reused as-is. Cart, Checkout-as-a-distinct-flow, Order, and Delivery are new. Bookings (for Services rather than Products) follow the same pattern with a scheduling step instead of a delivery step.

## Business AI Agents

```
Business → Knowledge → Instructions → Tools → Permissions → Agent Runtime → Channels → Customer
```

This is a *consumer* of `05_AI_MODEL_GATEWAY_ARCHITECTURE.md` and `07_RAG_AND_MEMORY_ARCHITECTURE.md`, not a new AI subsystem of its own. It must not be built before those exist — doing so would mean building yet another one-off AI integration, the exact pattern already responsible for today's 13-hardcoded-providers debt.

Supported agent behaviors: support, sales, booking, order status, FAQ, lead qualification, follow-up, voice, translation, human handoff. Every agent action is tagged with a tier from `06`; a "check order status" agent action is READ, a "book an appointment" action is CONFIRM, a "process a refund" action is HIGH-RISK.

## Explicitly out of scope for this document

- Actual UI/UX design for Business Pages, catalog browsing, or agent-builder screens — a design phase that follows architectural approval, not part of this technical plan.
- Specific ad-auction/pricing mechanics — deferred until advertising is actually prioritized (see roadmap).
