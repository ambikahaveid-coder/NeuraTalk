# AI Model Gateway Architecture

## Why this is mandatory before any AI-agent infrastructure

Current state: 13+ files independently instantiate `new OpenAI(...)`; Azure Speech/Translator, Deepgram, Sarvam, and ElevenLabs are each called ad hoc from their own service file. There is exactly one real registry pattern in the codebase (`server/providers/stt-provider-registry.ts`), and it is scoped only to speech-to-text.

Every feature described in the business-platform brief (agents, campaigns, recommendations, marketing copy generation) is an AI consumer. Building each of them against a direct provider call — the pattern already established 13 times — multiplies today's debt instead of paying it down. The gateway must exist before the first business-facing AI feature is written, not be retrofitted after several exist.

## Pipeline

```
Application
  ↓
Neura AI Gateway
  ↓
Policy / Permission        ← ties into 06_AI_SECURITY_AND_PERMISSION_MODEL.md
  ↓
Model Router                (selects provider/model by capability + cost + health)
  ↓
Provider Adapter            (OpenAI / Azure / Deepgram / Sarvam / ElevenLabs — one adapter per provider)
  ↓
Model
  ↓
Safety / Validation
  ↓
Response
```

## Requirements

| Requirement | Rationale |
|---|---|
| Provider abstraction | No caller knows which provider served a request |
| Model selection | Route by capability (translation vs. chat vs. TTS) and configured preference |
| Fallback | If the primary provider fails, fall back per a configured chain — generalizes the pattern already present in `translateText()` (`server/group-chats.ts:83-` tries Azure Translator then OpenAI) into a first-class gateway feature instead of a one-off in each caller |
| Timeout | Per-call timeout budget, distinct from provider SDK defaults |
| Retry policy | Bounded retries with backoff, not unlimited |
| Rate limiting | Per-tenant/business AI call quotas |
| Cost tracking | Every AI call attributed to a user/business/feature for billing and budget alerts |
| Token tracking | Input/output token counts logged per call |
| Observability | Structured logs + metrics per the platform's existing `server/observability.ts` logger, extended with AI-specific fields (provider, model, latency, cost) |
| Model versioning | Explicit model version pinned per feature, changeable without code deploy |
| Prompt versioning | Prompts stored and versioned outside application code, not inline string literals |
| Error classification | Distinguish provider outage / rate limit / invalid input / content policy — each needs different handling upstream |
| Provider health | Live health signal per provider, feeding the Model Router's fallback decision |
| Tenant/business configuration | A business can pin its agent to a specific model/provider (e.g., data-residency requirements) |

## What migrates through the gateway first

Not a big-bang rewrite of all 13 files. Sequenced by risk and value:

1. **Translation** (`azure-service.ts`, the `translateText()` fallback chain in `group-chats.ts` and `personal-chat-routes.ts`) — highest-value first migration because it already has a real fallback pattern to generalize, and correctness here is the current top product risk (see `01_CURRENT_STATE_ARCHITECTURE.md`).
2. **Call translation** (`translator-bot.ts`'s STT/translate/TTS calls) — same rationale, second-highest risk.
3. New AI features (agents, campaigns) build against the gateway from day one — never against a direct provider call.
4. Existing lower-risk AI call sites (NEURA AI chat assistant, voice-assistant-service.ts) migrate opportunistically, not on a deadline — they work today and are not blocking anything downstream.

## Explicitly out of scope

- Changing which AI providers NEURA uses.
- Building the agent runtime itself (`06`/`07` cover that) — the gateway is a prerequisite, not the agent framework.
