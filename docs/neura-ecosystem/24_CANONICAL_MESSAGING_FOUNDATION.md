# Canonical Messaging Foundation — Phase 0 Design

Resolves the naming/scoping decision flagged as blocking in [23_NEURA_BUSINESS_MESSAGING_MASTER_BUILD_PLAN.md](23_NEURA_BUSINESS_MESSAGING_MASTER_BUILD_PLAN.md) §3.

**Implementation status (2026-08-23): PHASE 0 IMPLEMENTED — NOT DEPLOYED.** Commit `54895d2`. The design below was implemented essentially as written (all 10 tables, all 4 routes, RBAC, tenant isolation, transactional creation), with one deviation worth recording here rather than only in the commit message: **`senderParticipantId` on message creation is validated to belong to the target conversation but is not bound to the authenticated caller's own identity** — this document's §12 API contract didn't specify that binding, and implementing it wasn't in Phase 0's approved scope, so it's flagged as an open risk (added to §16) rather than silently decided one way or the other during implementation. Migration `migrations/0004_canonical_messaging_foundation.sql` was written but **not applied to any database** — no local database exists in this project separate from the single shared production Neon instance, so "run migration locally" / "test rollback locally" could not be literally performed; verification instead relied on 29 new mock-based unit tests plus a full existing-suite re-run (259/259, zero regressions) — also recorded honestly rather than claimed as done when it wasn't.

## 1. Naming decision

Canonical entities, exactly as approved: `Conversation`, `Message`, `MessageParticipant`, `MessageDelivery`, `MessageAttachment`, `MessageReaction`, `MessageTranslation`, `MessageReadState`, `MessageEvent`.

**SQL-level naming conflict, identified and resolved**: `conversations` and `messages` are already taken by the existing AI-chat system (`shared/schema.ts:309,318`). The canonical entities cannot use those bare table names without colliding. Resolution: prefix all canonical tables with `messaging_` at the SQL/Drizzle level (`messagingConversations`, `messagingMessages`, `messagingParticipants`, `messagingDeliveries`, `messagingAttachments`, `messagingReactions`, `messagingTranslations`, `messagingReadStates`, `messagingEvents`) while the *logical/domain* names stay exactly as approved — the prefix is a storage-layer disambiguation, not a renaming of the concept. This is purely additive: no existing table is touched, renamed, or reinterpreted.

## 2. Entity model

### Canonical layer (new, isolated)

**`messagingConversations`**
| Column | Type | Notes |
|---|---|---|
| `id` | serial PK | |
| `type` | text | `ai` \| `direct` \| `group` \| `business` — enumerated in application code, not a DB enum (matches this codebase's existing convention, e.g. `organizations.status`) |
| `organizationId` | integer, FK → `organizations.id`, nullable | set only when `type = 'business'` |
| `metadata` | jsonb, default `{}` | type-specific extra data |
| `isArchived` | boolean, default false | |
| `createdAt` | timestamp, default now | |
| `updatedAt` | timestamp, default now | |

Note: this table is intentionally **not** where AI/direct/group conversations are migrated to in Phase 0 (§9) — `type` supports all four values so the schema is future-correct for a later consolidation, but only `type = 'business'` rows are actually created by any Phase 0/1 code path.

**`messagingParticipants`**
| Column | Type | Notes |
|---|---|---|
| `id` | serial PK | |
| `conversationId` | integer, FK → `messagingConversations.id`, cascade delete | |
| `participantType` | text | `user` \| `ai_agent` \| `business` \| `customer` \| `system` |
| `participantId` | integer | **polymorphic** — see §13 for why this cannot carry a DB-level FK constraint |
| `role` | text, nullable | e.g. `agent`, `customer`, `owner` |
| `joinedAt` | timestamp, default now | |
| `leftAt` | timestamp, nullable | |

**`messagingMessages`**
| Column | Type | Notes |
|---|---|---|
| `id` | serial PK | |
| `conversationId` | integer, FK → `messagingConversations.id`, cascade delete | |
| `senderParticipantId` | integer, FK → `messagingParticipants.id` | |
| `messageType` | text | `text` \| `image` \| `video` \| `document` \| `template` \| `voice` \| `system` |
| `category` | text, default `conversational` | `authentication` \| `utility` \| `marketing` \| `conversational` \| `system` \| `ai` — see §6 |
| `content` | text | rendered/final content (for template messages, the rendered output, not the template source) |
| `templateId` | integer, nullable, **no FK yet** | forward reference to Phase 2's `templates` table; left as a plain nullable integer column until that table exists (adding the FK constraint then is a trivial additive migration) |
| `replyToMessageId` | integer, nullable, self-FK → `messagingMessages.id` | |
| `createdAt` | timestamp, default now | |
| `editedAt` | timestamp, nullable | |
| `deletedAt` | timestamp, nullable | soft delete — never hard-delete a message (matches the "financial/audit records need retention" caution from doc 19 §14) |

**`messagingDeliveries`**
| Column | Type | Notes |
|---|---|---|
| `id` | serial PK | |
| `messageId` | integer, FK → `messagingMessages.id`, cascade delete | |
| `participantId` | integer, FK → `messagingParticipants.id` | the recipient this delivery record is for |
| `status` | text | `queued` \| `sent` \| `delivered` \| `read` \| `failed` |
| `statusAt` | timestamp, default now | |
| `failureReason` | text, nullable | |
| `providerRef` | text, nullable | external provider's message id, for a future non-in-app channel (SMS/email) — unused by any in-app-only Phase 0/1 code, present so Phase 6/7 (OTP/utility, which may route through MSG91/Resend) don't need a schema change to add it later |

**`messagingAttachments`**
| Column | Type | Notes |
|---|---|---|
| `id` | serial PK | |
| `messageId` | integer, FK → `messagingMessages.id`, cascade delete | |
| `attachmentType` | text | `image` \| `video` \| `document` \| `audio` |
| `url` | text | |
| `mimeType` | text, nullable | |
| `sizeBytes` | integer, nullable | |
| `durationSeconds` | integer, nullable | audio/video only |

**`messagingTranslations`**
| Column | Type | Notes |
|---|---|---|
| `id` | serial PK | |
| `messageId` | integer, FK → `messagingMessages.id`, cascade delete | |
| `language` | text | |
| `translatedContent` | text | |
| `translatedAt` | timestamp, default now | |

**Design choice, explicitly flagged**: the existing personal-chat/group-chat systems store translations as a `jsonb` column directly on the message row (`personalChatMessages.translations`, `groupChatMessages.translations`). The canonical model uses a separate table instead. Rationale: a table supports real queries ("which messages still need a Telugu translation") that a jsonb blob can't index efficiently, and it matches the explicit instruction listing `MessageTranslation` as its own canonical entity. Tradeoff: one extra join for the common "get message with its translations" read — acceptable, this isn't a latency-critical path the way live call signaling is.

**`messagingReadStates`**
| Column | Type | Notes |
|---|---|---|
| `id` | serial PK | |
| `conversationId` | integer, FK → `messagingConversations.id`, cascade delete | |
| `participantId` | integer, FK → `messagingParticipants.id` | |
| `lastReadMessageId` | integer, FK → `messagingMessages.id`, nullable | |
| `lastReadAt` | timestamp, nullable | |
| unique | `(conversationId, participantId)` | |

**Design choice, explicitly flagged**: modeled as one row per (conversation, participant) — a watermark — not one row per (message, participant). A per-message design would explode to `messages × participants` rows and make "unread count" an expensive aggregation; the watermark design makes "unread count" a single indexed range query (`messages after lastReadMessageId`). This is the standard pattern used by essentially every production chat system for this exact reason. `MessageDelivery.status = 'read'` still exists per-message-per-recipient for delivery-receipt purposes (§5) — the two serve different questions (watermark = "where is my unread line," delivery = "did this specific message reach this specific person").

**`messagingReactions`**
| Column | Type | Notes |
|---|---|---|
| `id` | serial PK | |
| `messageId` | integer, FK → `messagingMessages.id`, cascade delete | |
| `participantId` | integer, FK → `messagingParticipants.id` | |
| `reaction` | text | emoji or reaction-type string |
| `createdAt` | timestamp, default now | |
| unique | `(messageId, participantId)` | one active reaction per participant per message; changing reaction = update the row, not insert a second |

**`messagingEvents`**
| Column | Type | Notes |
|---|---|---|
| `id` | serial PK | |
| `conversationId` | integer, FK → `messagingConversations.id`, nullable | |
| `messageId` | integer, FK → `messagingMessages.id`, nullable | |
| `eventType` | text | see §5's event list |
| `payload` | jsonb, default `{}` | |
| `createdAt` | timestamp, default now | |

This is the single feed that both the webhook dispatcher (extending `WEBHOOK_EVENT_TYPES`, per doc 23 §9) and future Reporting (doc 23 §15) read from — one write path, multiple consumers, no duplicated event logging.

### Business domain layer (schema-referenced here, fully designed in later phases)

**`businessConversations`** (the only business-domain table actually needed for Phase 0's acceptance tests, §17)
| Column | Type | Notes |
|---|---|---|
| `id` | serial PK | |
| `conversationId` | integer, FK → `messagingConversations.id`, **unique** | 1:1 with a canonical conversation |
| `businessId` | integer, FK → `organizations.id` | |
| `customerId` | integer, nullable, **no FK yet** | forward reference to Phase 4's `customers` table |
| `status` | text, default `open` | `open` \| `assigned` \| `closed` |
| `assignedToUserId` | integer, FK → `users.id`, nullable | |
| `createdAt` | timestamp, default now | |

`MessageTemplate`, `TemplateVersion`, `ApprovalRequest`, `Campaign`, `Audience`, `BusinessMessagePolicy` are **not** schema-designed in this document — they belong to Phases 2, 3, 4, 5 per doc 23 §23, and designing their exact columns now would be premature (their shape depends on decisions those phases haven't made yet, e.g. the segment-definition AST in doc 23 §6). This document only guarantees the canonical layer they'll all sit on top of is stable and correct.

## 3. ER relationship

```
organizations (existing)                    users (existing)
      │                                            │
      ▼                                            │
businessConversations ──1:1──▶ messagingConversations
      │  (businessId)                 │
      │  (assignedToUserId) ──────────┘
      ▼
   (customerId → future customers table, Phase 4)

messagingConversations
      │
      ├──1:N──▶ messagingParticipants ──(polymorphic, §13)──▶ users / organizations / (future) customers / ai_agents
      │
      ├──1:N──▶ messagingMessages
      │              │
      │              ├──1:N──▶ messagingDeliveries ──▶ messagingParticipants
      │              ├──1:N──▶ messagingAttachments
      │              ├──1:N──▶ messagingTranslations
      │              ├──1:N──▶ messagingReactions ──▶ messagingParticipants
      │              └──(templateId, no FK yet)──▶ future templates table (Phase 2)
      │
      ├──1:N──▶ messagingReadStates ──▶ messagingParticipants, messagingMessages
      └──1:N──▶ messagingEvents ──(also FKs to messagingMessages)
```

Template → Campaign/Trigger → canonical Message → Delivery (the second diagram in the approval prompt) is realized as: a future `templates.id` populates `messagingMessages.templateId` at send time; a future `campaigns`/`utility_message_triggers` row is the *cause* of a `messagingMessages` insert, not a parent table it — campaigns don't own messages, they cause their creation, exactly like the master plan's Section 7 already specified.

## 4. Message lifecycle

```
CREATED (row inserted into messagingMessages)
   │
   ├─▶ (if attachments) messagingAttachments rows inserted
   ├─▶ (if translation requested) messagingTranslations rows inserted (may lag creation)
   │
   ▼
DELIVERY FAN-OUT: one messagingDeliveries row per recipient participant, status=queued
   │
   ▼
(see §5 for per-delivery lifecycle)
   │
   ▼
[optional] EDITED (editedAt set) — content mutated, no new row; original content is NOT
           separately versioned in Phase 0 (out of scope — flag as a future need if
           regulatory/audit requirements demand message-edit history later)
   │
   ▼
[optional] DELETED (deletedAt set, soft delete — row and its children remain in the DB
           for audit purposes; application-layer reads must filter deletedAt IS NULL)
```

A `messagingEvents` row is written at CREATED, at each delivery-status transition (§5), and at DELETED. EDITED does not currently emit an event — flagged as a gap to close if template/campaign auditing later needs "was this message edited after send" visibility (not needed for Phase 0's acceptance tests).

## 5. Delivery lifecycle

```
queued ──▶ sent ──▶ delivered ──▶ read
   │          │          │
   └──────────┴──────────┴──▶ failed (failureReason set, terminal)
```

`queued → sent`: the sending pipeline has handed the message to its delivery mechanism (in-app push, or in Phase 6/7's case, MSG91/Resend). `sent → delivered`: confirmed received by the recipient's client/device (in-app: WebSocket ack; external channel: provider delivery receipt via `providerRef`). `delivered → read`: recipient opened it — for in-app conversations this is also reflected in `messagingReadStates`'s watermark; for a 1:1 delivery-status use case (e.g. "did *this specific* marketing message get read," relevant to Reporting) the per-delivery row is the source of truth, not the watermark. `failed` is reachable from any prior state and is terminal — no retry loop is designed here; retry policy (if any) is a Phase 6/7 concern layered on top (matches the existing `webhookDeliveries` retry pattern, which this can reuse rather than reinvent — `nextRetryAt`/`attempts` columns already proven there).

Each transition writes one `messagingEvents` row with `eventType` from: `message.sent`, `message.delivered`, `message.read`, `message.failed` — these are exactly the four values doc 23 §9 already named for the webhook event-catalog extension; no duplicate naming invented here.

## 6. Category model

`messagingMessages.category` ∈ `{authentication, utility, marketing, conversational, system, ai}`. Default `conversational` (correct default for AI/direct/group conversation types, which don't use categories today — those code paths simply never set it, matching current behavior with zero change).

**Governance, server-side only** (per the explicit instruction "must be governed by server-side business rules"):
- `authentication` and `utility` categories may only be set by server-side send paths that are not campaign-driven (business-initiated OTP/event-trigger code, Phase 6/7) — the campaign-send code path (Phase 5) is structurally incapable of setting these categories; it hardcodes `category: 'marketing'` for every message it creates, it does not accept category as caller input. This is the same "structural, not conventional" enforcement doc 23 §8 already specified for authentication-vs-marketing separation.
- `ai` is set only by AI-agent response paths (Phase 11, gated per doc 23 §13).
- `system`/`conversational` are the defaults for non-business conversation types and are not user-selectable.

No new DB constraint enforces this (a `CHECK` constraint could validate the *value* is one of the 6 strings, but not *which code path* set it) — the real enforcement is in application code structure, consistent with how `MESSAGE.category` was already specified as a structural guarantee in doc 23, not a data-validation one.

## 7. Business integration

A business's messaging surface is entirely mediated by `businessConversations`: creating a business conversation always creates exactly one paired `messagingConversations` row (`type = 'business'`) in the same transaction, never a bare canonical conversation with no business owner. `businessId` on `businessConversations` is the tenant-isolation anchor (§13). Templates/campaigns (later phases) reference `businessConversations`/`messagingConversations` only through this same path — there is no second way for business-domain code to create a canonical conversation.

## 8. AI integration boundary

`messagingParticipants.participantType = 'ai_agent'` and `messagingMessages.category = 'ai'` are the only two schema touchpoints AI agents get in this Phase 0 design — enough to represent "an AI agent is a participant in this business conversation and can send messages into it," nothing more. Per doc 23 §13, no AI-agent *behavior* is designed or implemented here; this section exists only to confirm the canonical schema has a place for AI participation to plug into later, gated behind the AI Gateway/security/RAG docs' own approval.

## 9. Existing-chat coexistence

AI chat (`conversations`/`messages`), personal chat (`personalChatThreads`/`personalChatMessages`), and group chat (`groupChats`/`groupChatMembers`/`groupChatMessages`) are **completely untouched** by this design:
- No existing table is renamed, altered, or dropped.
- No existing route (`server/ai_integrations/chat/routes.ts`, `server/personal-chat-routes.ts`, `server/group-chats.ts`) is modified.
- No dual-write is introduced (explicitly forbidden this phase) — the canonical tables and the legacy tables are written to by entirely disjoint code paths; a message sent via personal chat never touches `messagingMessages`, and vice versa.
- The three legacy systems and the new canonical layer are simply two unrelated sets of tables coexisting in the same database until a separately-scoped future migration (doc 23 §3) decides whether/how to unify them.

**Conflict check, explicit** (per the instruction to identify conflicts): the only actual conflict found is the table-name collision on `conversations`/`messages`, resolved in §1 via the `messaging_` prefix. No column-level, foreign-key-level, or behavioral conflict exists, because the new tables have zero foreign keys pointing into the legacy tables and vice versa.

## 10. Tenant isolation

Every read/write against `businessConversations`, and by extension anything reachable from it (`messagingConversations` via `conversationId`, and everything under that per §3's diagram), must be scoped by `businessConversations.businessId` matching the caller's authenticated business — using the exact same `requireCompanyAccess`/`isOrgAdmin` pattern already proven (and regression-tested) for webhooks and org-scoped B2B routes this session. No route may accept a bare `conversationId`/`messageId` and trust it without first verifying, server-side, that the owning `businessConversations.businessId` matches the caller — this closes the exact IDOR shape doc 19 flagged as the standard risk pattern (ID/URL/body/query-param manipulation). A regression test in the same style as `tests/unit/webhook-idor.test.ts` is a Phase 0 completion requirement (§17, item 7), not deferred to a later phase.

## 11. RBAC

Phase 0 needs exactly one new permission pair to satisfy its acceptance tests (item 8): `MESSAGING_VIEW`, `MESSAGING_SEND` (added to the existing `PERMISSIONS` catalog, `shared/schema.ts`, alongside the other groups). Checked via the existing `requirePermission()` middleware — no new authorization mechanism. The fuller `TEMPLATES_*`/`CAMPAIGNS_*`/etc. permission set from doc 23 §16 is out of scope here (those gate business-domain actions that don't exist until Phases 2+).

## 12. API contract (Phase 0 scope only — enough to run the acceptance tests, §17)

| Route | Method | Purpose | Auth |
|---|---|---|---|
| `/api/business/:businessId/conversations` | POST | Create a `businessConversations` + paired `messagingConversations` row | `requireCompanyAccess`, `MESSAGING_SEND` |
| `/api/business/:businessId/conversations/:id` | GET | Fetch one, with participants | `requireCompanyAccess`, `MESSAGING_VIEW` |
| `/api/business/:businessId/conversations/:id/messages` | POST | Create a `messagingMessages` row + delivery fan-out | `requireCompanyAccess`, `MESSAGING_SEND` |
| `/api/business/:businessId/conversations/:id/messages` | GET | List messages (paginated, `deletedAt IS NULL`) | `requireCompanyAccess`, `MESSAGING_VIEW` |

All four routes 404 (not 403) when `:businessId` doesn't own `:id` — matching this codebase's existing convention of not confirming a resource's existence to a caller who isn't authorized to see it (same behavior already used by the org-lifecycle routes built this session). Request/response body shapes are an implementation-phase deliverable, not designed field-by-field here — the schema in §2 is the authoritative contract for what data exists; JSON shape is a mechanical derivation from it.

## 13. Database design — the polymorphic-participant tradeoff, explicit

`messagingParticipants.participantId` cannot carry a single DB-level foreign key because it references different tables depending on `participantType` (`users.id` for `user`, `organizations.id` for `business`, a future `customers.id` for `customer`, nothing yet for `ai_agent`/`system`). This is a deliberate, named tradeoff: the alternative (separate nullable FK columns per participant type, e.g. `userId`, `businessId`, `customerId`, `aiAgentId`, exactly one non-null) buys referential integrity at the cost of a wider, sparser table and application code that already has to branch on `participantType` anyway to know which column to read. Given `customers` doesn't exist yet (Phase 4) and `ai_agent` has no backing table at all in this phase, the polymorphic-integer approach is chosen for Phase 0, with the explicit risk noted in §16 and the mitigation of application-layer validation (never trust `participantId` without checking it against the table implied by `participantType` before using it in a query).

## 14. Index strategy

- `messagingConversations`: index on `organizationId` (business-scoped listing queries).
- `messagingParticipants`: index on `(conversationId)`, index on `(participantType, participantId)` (resolve "which conversations is this user/business in").
- `messagingMessages`: index on `(conversationId, createdAt)` (the dominant read pattern — paginated message history per conversation), index on `category` (Reporting aggregation, Phase 10), partial consideration: exclude `deletedAt IS NOT NULL` rows via a filtered index if this table grows large — flagged as a later optimization, not required for Phase 0's data volume.
- `messagingDeliveries`: index on `(messageId)`, index on `(participantId, status)` (a recipient's undelivered/failed message lookups).
- `messagingReadStates`: unique index on `(conversationId, participantId)` — doubles as the lookup index.
- `messagingReactions`: unique index on `(messageId, participantId)`.
- `messagingEvents`: index on `(conversationId, createdAt)` and `(messageId)`.
- `businessConversations`: unique index on `conversationId`, index on `businessId`, index on `customerId` (once Phase 4 adds the FK).

## 15. Migration strategy

Purely additive: one new SQL migration file (following this session's established `migrations/000N_*.sql` convention) creating the 10 new tables listed in §2 with `CREATE TABLE IF NOT EXISTS`, zero `ALTER TABLE` against any existing table, zero data movement. Rollback is `DROP TABLE IF EXISTS` for the same 10 tables, safe at any point since nothing in the existing 3 chat systems or any other part of the app references them yet. **Not run in this pass** — this document is the design; the migration file itself is an implementation-phase artifact requiring the separate explicit approval this prompt's strict rules already require.

## 16. Risks

**P1 — sender-participant identity is not bound to the authenticated caller** (found during implementation's security review, not designed against in this document's original version): `createMessage` validates that `senderParticipantId` belongs to the target conversation, but nothing ties it to `req.user.id`. Any business member holding `MESSAGING_SEND` can send a message "as" any other participant already in that conversation — including the business's own top-level participant record, or a co-worker's. This does **not** cross the tenant boundary (§10's non-negotiable requirement is unaffected and is tested) — it's a same-tenant message-attribution integrity gap. Not patched during Phase 0 implementation since binding rules (does sending as "the business" require a specific permission beyond `MESSAGING_SEND`? does a user need their own participant row, auto-created, rather than reusing the business's?) were never specified in Phase 0's approved scope. Recommend resolving explicitly before Phase 1 builds anything (like Inbox, §12 of doc 23) that displays "who sent this" as a trusted fact.

**P1 — polymorphic `participantId`** (§13): no DB-level integrity guarantee that a `messagingParticipants` row's `participantId` actually exists in the table implied by its `participantType`. Mitigation: application-layer validation at every write path (reject a participant insert if the referenced id doesn't resolve), covered by a Phase 0 unit test, not just documented as a hope.

**P1 — `messagingMessages.templateId` and `businessConversations.customerId` have no FK yet** (§2): both are forward references to tables that don't exist until Phase 2/4. Until then, nothing prevents an orphaned integer being stored there. Mitigation: Phase 0/1 code simply never populates them (no code path exists yet that would), and the FK constraint gets added as a trivial additive migration the moment the target table exists — tracked explicitly as a Phase 2/4 completion requirement, not forgotten.

**P2 — message edit history not versioned** (§4): if a compliance requirement later demands "show me what this message said before it was edited," Phase 0's schema doesn't capture that. Cheap to add later (an edit-history table, additive) — not blocking, just flagged so it's a deliberate deferral, not an oversight discovered during an audit.

**P2 — read-state watermark vs per-delivery read status can drift in edge cases** (§5) — e.g., a participant reads message #50 without ever having received a delivery event for message #48 (out-of-order delivery). Both fields would then disagree about whether #48 is "read." Acceptable for Phase 0 (no code path yet stresses this edge case); flagged for Phase 9 (Inbox) to handle explicitly when unread-count UI is actually built.

## 17. Acceptance tests (Phase 0 exit criteria — all 10, mapped to concrete checks)

1. **Create Business** — reuses existing `organizations` create path (already real); no new test needed, just a precondition.
2. **Create BusinessConversation** — `POST /api/business/:businessId/conversations` returns 201, row exists with correct `businessId`.
3. **Create canonical Conversation** — same request, verify a paired `messagingConversations` row exists with `type='business'` and matches `businessConversations.conversationId`.
4. **Create canonical Message** — `POST .../messages` returns 201, `messagingMessages` row exists with correct `conversationId`, `category` defaults to `conversational` if not business-categorized.
5. **Persist MessageDelivery** — after message creation, one `messagingDeliveries` row per other participant exists with `status='queued'`.
6. **Persist MessageEvent** — a `message.sent`-equivalent (or `message.created`, exact event-type list finalized at implementation time) `messagingEvents` row exists.
7. **Verify tenant isolation** — automated test (style of `tests/unit/company-access-tenant-isolation.test.ts`): Business A's token cannot read/write Business B's `businessConversations`/messages via any of the 4 routes, confirmed by direct assertion, not just "no error was thrown."
8. **Verify RBAC** — automated test: a user without `MESSAGING_SEND` gets 403 on the POST routes; a user without `MESSAGING_VIEW` gets 403 on the GET routes.
9. **Verify audit** — every write path in this design produces a `messagingEvents` row (§4-5); confirm via test that the event table is non-empty and correctly attributed after each acceptance-test action. (Note: `auditLogs`, the platform-wide admin audit table, is a separate concern from `messagingEvents` — this Phase 0 layer's own event log is the audit trail for message-lifecycle actions; whether admin-level actions on business conversations, e.g. a moderator viewing another business's flagged message, should *also* write to `auditLogs` is a Phase 3 (Approval Center) / Phase 9 (Inbox) concern, not required for Phase 0.)
10. **Verify no existing chat route is broken** — run the full existing test suite (`npx vitest run`) unchanged; 0 new failures. Since §9 guarantees zero modification to any existing chat file, this should trivially hold, but running the full suite is still the actual verification, not an assumption.

---

**Design complete. No code, no migration, no deployment. Stopping and waiting for explicit approval before writing the actual migration file or any implementation.**
