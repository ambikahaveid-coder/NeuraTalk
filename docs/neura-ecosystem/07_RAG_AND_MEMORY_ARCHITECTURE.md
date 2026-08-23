# RAG and Memory Architecture

## Current state

Neither exists. No vector DB, embeddings, or retrieval code anywhere in `server/`. No permission-scoped memory system — "memory" today means raw chat history in `messages`/`personalChatMessages`/`groupChatMessages`, read directly by whichever feature needs context, with no retention policy, no export/delete controls beyond the general GDPR workflow, and no per-record permission scoping.

Both are prerequisites for Business AI Agents (`09_BUSINESS_PLATFORM_ARCHITECTURE.md`) — an agent that's supposed to "answer from business data" has nothing to retrieve from today.

## RAG architecture

```
Source              documents, websites, FAQs, product catalogs, policies, business data, structured DB records
  ↓
Ingestion           upload/crawl/sync job, source-typed
  ↓
Normalization       strip formatting, extract text, preserve structure metadata
  ↓
Chunking            size-bounded, overlap-aware, structure-respecting (don't split a table row)
  ↓
Embedding           via AI Gateway (05) — provider-agnostic, not hardcoded to one embedding model
  ↓
Vector / Retrieval Layer     tenant-scoped index (one business's data never shares an index with another's without explicit cross-tenant grant)
  ↓
Permission Filtering   ← enforced HERE, before results reach the model — not as a prompt instruction
  ↓
RAG                 assembled context + citations
  ↓
AI Agent            (06's permission tiers apply to what the agent does with the retrieved context)
```

**The permission-filtering step is non-negotiable and positioned deliberately before the model sees anything.** A prompt instruction ("don't share other tenants' data") is not a security boundary — it's a suggestion a sufficiently adversarial or confused prompt can defeat. Retrieval must be scoped at the query layer (tenant ID as a hard filter on the vector search, not a post-hoc check).

## Memory architecture

| Memory type | Scope | Example |
|---|---|---|
| User memory | Per-consumer | "prefers Telugu", "usually calls in the evening" |
| Business memory | Per-business | "this business's return policy", "typical response time" |
| Conversation memory | Per-conversation | Summary of what's been discussed, not raw transcript |
| Task memory | Per-task | "appointment booking in progress, step 2 of 3" |
| Customer memory | Business's view of a specific customer | "ordered X before", "open support ticket #123" |

### Required operations

Create, retrieve, update, delete, export, disable — matching the brief exactly, and matching the existing GDPR pattern already built for user data (`server/gdpr-routes.ts`) rather than inventing a parallel rights model.

### Required properties

- **Auditable** — every memory write attributable to what triggered it (which conversation, which AI call), reusing the existing `auditLogs` infrastructure rather than a new logging system.
- **Explainable** — a user or business can ask "why does the AI think X" and get a real answer pointing at the memory record and its source, not "the model decided."
- **Permission-aware** — a business's memory of a customer is not visible to that customer's other conversations with a different business.
- **Retention-aware** — every memory record has a retention policy; "unlimited raw chat history as memory" is explicitly rejected by the source brief and by this design.

## Explicitly out of scope

- Choice of vector database / embedding provider — an AI Gateway (05) decision, made when this is actually built, not pinned here.
- Memory UI (view/edit/delete screens) — a Business Platform (09) concern once this backend exists.
