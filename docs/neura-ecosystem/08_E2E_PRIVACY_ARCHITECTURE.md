# End-to-End Encryption & Privacy Architecture

## Honest current state — this system is NOT end-to-end encrypted

Verified by direct code inspection:

- `server/group-chats.ts:18-44` encrypts only the `audioPath` field of group voice messages, using AES-256-GCM with a key derived via `scrypt` from `process.env.SESSION_SECRET`. **The server holds the key.** This is server-side encryption at rest for one narrow field, not end-to-end encryption.
- `server/personal-chat-routes.ts` — zero encrypt/decrypt calls. 1:1 chat message text is stored in plaintext.
- Group chat message text — also never passed through encrypt/decrypt.

No part of this system may be described as "end-to-end encrypted" until the design below (or an equivalent) is actually implemented. This document exists specifically so that claim is never made incorrectly again.

## Why this matters more than a typical gap

NEURA's stated differentiator is *translation* — the platform reads and processes the content of private conversations by design (STT, translation, TTS all require plaintext access to speech/text at some point in the pipeline). This creates real tension with true E2E encryption: a server that cannot read message content cannot translate it either. The brief's own Section 11 recognizes this and asks for separate privacy modes rather than one blanket E2E claim. That's the right instinct — the resolution below formalizes it.

## Target: four privacy modes

| Mode | Guarantee | Applies to |
|---|---|---|
| **PRIVATE** | True end-to-end encryption — server cannot read content, translation/AI features unavailable in this mode | 1:1 or group chat where both parties opt out of AI features entirely |
| **AI-ASSISTED** | Server-side encryption at rest + in transit; content is processed by AI (translation, etc.) only with explicit, per-conversation user authorization, logged and revocable | Default mode for translated conversations — matches what the product is actually for |
| **BUSINESS** | Business-controlled processing subject to a clear, user-visible privacy policy and permission grant | Conversations with a business's AI agent — the business is a data controller, not just a peer |
| **TELECOM** | PSTN/SIP processing subject to applicable telecom and privacy requirements (call recording consent laws, carrier data handling) | Any call touching the PSTN bridge |

A conversation's mode is a property of the conversation (`CONVERSATION.privacyMode` in the canonical messaging model, `03_MESSAGING_CONSOLIDATION_PLAN.md`), set at creation and changeable only with re-consent from all participants — not a global app setting.

## Non-negotiables for implementation

- **Use established cryptographic protocols and libraries.** No custom encryption algorithms. For PRIVATE mode, evaluate the Signal Protocol (or an established equivalent) rather than designing key exchange from scratch.
- **AI-ASSISTED mode's "explicit authorization"** reuses the existing, real consent infrastructure (`call-privacy.ts`'s `checkPreCallConsent`, already enforced and blocking calls needing re-consent) rather than inventing a parallel consent system — extend it to cover chat, not just calls.
- **Key management for AI-ASSISTED/BUSINESS modes**: server-side encryption at rest (proper key rotation, not the current single static `SESSION_SECRET`-derived key applied to one field) is table stakes even without full E2E — this is the minimum bar, not the target.

## Migration from current state

1. Every existing conversation is implicitly AI-ASSISTED mode today (translation/AI already touches content); this becomes the explicit default, not a new restriction.
2. Server-side encryption at rest is extended from "one field in group voice messages" to all message content, immediately — this is a real gap today regardless of the E2E roadmap and doesn't depend on PRIVATE mode existing.
3. PRIVATE mode ships as an opt-in for users who explicitly don't want AI processing — a smaller, well-scoped feature, not a rearchitecture of the whole messaging system.
4. BUSINESS and TELECOM modes formalize consent/policy requirements that mostly already exist in adjacent form (`call-privacy.ts`, GDPR consent routes) rather than building new consent infrastructure from zero.

## Explicitly out of scope

- A concrete cryptographic library/protocol selection — a security-review decision at implementation time, not fixed here.
- Retroactively encrypting historical plaintext messages — a separate, explicit decision to be made (with the user) given real tradeoffs around searchability and support access to old conversations.
