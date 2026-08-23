# Messaging Consolidation Plan

## Current state (evidence)

Three independently-built messaging systems exist in `shared/schema.ts`, each reimplementing the same primitives (sender, thread, timestamp, delivery/read state) with no shared abstraction:

| System | Tables | Purpose |
|---|---|---|
| AI chat | `conversations`, `messages` | User ↔ NEURA AI assistant |
| Personal chat | `personalChatThreads`, `personalChatMessages` | 1:1 human-to-human |
| Group chat | `groupChats`, `groupChatMembers`, `groupChatMessages` | Group human messaging |

None share a conversation, participant, or message model. Consequences already observed in this codebase:

- Translation logic implemented separately in `personal-chat-routes.ts` and `group-chats.ts` (each with its own `translateText` call site), not shared.
- Encryption applied inconsistently: `group-chats.ts` encrypts voice-audio path only; `personal-chat-routes.ts` has zero encrypt/decrypt calls.
- File/image/location attachment handling was built once (this session) for personal chat; group chat has a separate, independently-maintained message-type union.
- Search, moderation, and read-state semantics would each need to be built three times to cover all messaging.

## Target: one canonical model

```
CONVERSATION            (replaces conversations / personalChatThreads / groupChats)
  id, type: 'ai' | 'direct' | 'group' | 'business'
  createdAt, updatedAt, metadata

CONVERSATION_PARTICIPANT (replaces implicit 1:1 pairing / groupChatMembers)
  conversationId, participantType: 'user' | 'ai_agent' | 'business'
  participantId, role, joinedAt, leftAt, preferredLanguage

MESSAGE                 (replaces messages / personalChatMessages / groupChatMessages)
  id, conversationId, senderParticipantId
  content, originalContent, sourceLanguage, translatedContent, targetLanguage
  messageType: 'text' | 'attachment' | 'file' | 'voice' | 'location' | 'system'
  attachmentUrl, attachmentTitle
  createdAt, editedAt, deletedAt

MESSAGE_DELIVERY_STATE  (new — currently implicit/inconsistent per system)
  messageId, participantId, status: 'sent' | 'delivered' | 'read'
  timestamp
```

A person, a business, and an AI agent all become `CONVERSATION_PARTICIPANT` rows of different `participantType` — this is what lets a future `BusinessConversation` (see `09_BUSINESS_PLATFORM_ARCHITECTURE.md`) reuse the same primitive instead of becoming a fourth parallel system.

## Migration strategy — do not delete existing tables

1. **Map, don't rewrite.** Each existing table gets a compatibility view/adapter that presents it through the canonical shape to new code, while old code keeps reading/writing the original tables unchanged.
2. **Dual-write period.** New messages get written to both the legacy table and the canonical table for a defined window, with a reconciliation job comparing counts/checksums nightly.
3. **Backfill.** One-time migration of historical `messages`/`personalChatMessages`/`groupChatMessages` rows into `MESSAGE`, preserving original IDs as a `legacySourceId` column for traceability.
4. **Cutover.** Once dual-write reconciliation shows zero drift for a full week, flip reads to the canonical table behind a feature flag (existing `feature-flags.ts` infrastructure — no new system needed).
5. **Deprecate.** Legacy tables stop receiving writes; kept read-only for a compatibility period (recommend 90 days) before archival.
6. **Rollback.** At every stage up to cutover, rollback is "stop dual-writing to canonical, keep reading legacy" — zero data loss because legacy tables were never stopped.

## Tests required before cutover

- Migration correctness: row-count and content-hash parity between legacy and canonical tables for a full historical backfill.
- Dual-write integration test: a message sent through each of the 3 existing send paths appears correctly in both schemas.
- Translation regression: existing personal-chat and group-chat translation behavior unchanged after reading from canonical model.
- Load test: canonical schema's join pattern (conversation → participants → messages) performs at or better than current three-table-specific queries under representative message volume.

## Explicitly out of scope for this consolidation

- No change to the AI-chat (NEURA assistant) conversational behavior — only its storage model moves onto the canonical schema.
- No new messaging features (reactions, pinned messages, etc.) — this is a data-model consolidation, not a feature phase.
