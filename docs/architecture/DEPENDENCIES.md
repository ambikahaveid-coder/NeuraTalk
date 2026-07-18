# NeuraTalk Dependency Audit

## Dependency Zero Policy

This document audits all external dependencies used by NeuraTalk and ensures compliance with our Dependency Zero Policy:

- **No external SaaS for core functionality**
- **No paid APIs**
- **No cloud vendor-specific services**
- **No black-box SDKs for calling, audio, or messaging**
- **Only open-source libraries**
- **Only self-hosted services**
- **Fully auditable source code**

---

## BANNED Services (Never Import or Use)

| Service | Type | Why Banned |
|---------|------|------------|
| Twilio | Telecom SaaS | Paid API, cloud-dependent, black-box calling |
| Vonage/Nexmo | Telecom SaaS | Paid API, cloud-dependent |
| Plivo | Telecom SaaS | Paid API, cloud-dependent |
| Sinch | Telecom SaaS | Paid API, cloud-dependent |
| Exotel | Telecom SaaS | Paid API, cloud-dependent |
| Agora | Real-time SaaS | Paid API, black-box audio SDK |
| Daily.co | Video SaaS | Paid API, cloud-dependent |
| Zoom SDK | Video SaaS | Proprietary, cloud-dependent |

---

## Allowed Dependencies

### Core Runtime

| Package | Purpose | Isolation Strategy | Replaceable With |
|---------|---------|-------------------|------------------|
| `ws` | WebSocket server | Direct use (open-source) | Any WebSocket lib |
| `dgram` | UDP sockets | Node.js built-in | N/A (native) |
| `crypto` | Encryption | Node.js built-in | N/A (native) |
| `events` | Event emitter | Node.js built-in | N/A (native) |

### AI Services (Behind Abstraction Layer)

| Service | Purpose | Interface Location | Self-Hosted Alternative |
|---------|---------|-------------------|------------------------|
| OpenAI Whisper | Speech-to-Text | `server/ai_integrations/audio/client.ts` | Vosk, Whisper.cpp |
| OpenAI TTS | Text-to-Speech | `server/ai_integrations/audio/client.ts` | Coqui TTS, Piper |
| OpenAI GPT | Translation/Chat | `server/ai_integrations/ai/client.ts` | LLaMA, Mistral |

**Isolation Strategy:** All AI services are accessed through abstracted interfaces. To swap providers:
1. Implement the same interface with the new provider
2. Update the import in the client file
3. No other code changes required

### Database

| Package | Purpose | Isolation Strategy |
|---------|---------|-------------------|
| `drizzle-orm` | ORM | Schema in `shared/schema.ts` |
| `pg` | PostgreSQL driver | Behind Drizzle abstraction |

**Note:** PostgreSQL is self-hosted. No cloud database dependencies.

### Web Framework

| Package | Purpose | Notes |
|---------|---------|-------|
| `express` | HTTP server | Open-source, widely audited |
| `cors` | CORS handling | Open-source |
| `express-session` | Sessions | Open-source |

### Frontend (Client-Side Only)

| Package | Purpose | Notes |
|---------|---------|-------|
| `react` | UI framework | Open-source |
| `vite` | Build tool | Open-source |
| `tailwindcss` | Styling | Open-source |
| `framer-motion` | Animations | Open-source |

---

## Critical Path Dependencies

These are dependencies that are critical to core functionality:

### 1. Signaling Layer
- **Dependency:** `ws` (WebSocket library)
- **What it does:** Provides WebSocket server/client
- **Source:** https://github.com/websockets/ws
- **License:** MIT
- **Audit status:** Widely used, open-source, auditable
- **Can we replace it?** Yes, with any WebSocket implementation

### 2. Media Layer
- **Dependency:** `dgram` (Node.js built-in)
- **What it does:** UDP socket for RTP packets
- **Source:** Node.js core
- **License:** MIT
- **Audit status:** Part of Node.js core
- **Can we replace it?** Native module, no replacement needed

### 3. Encryption Layer
- **Dependency:** `crypto` (Node.js built-in)
- **What it does:** AES encryption, HMAC authentication
- **Source:** Node.js core (OpenSSL bindings)
- **License:** MIT
- **Audit status:** Part of Node.js core, OpenSSL audited
- **Can we replace it?** Native module, no replacement needed

### 4. Speech Processing
- **Dependency:** OpenAI API (via NeuraTalk AI integration)
- **What it does:** Speech-to-text, text-to-speech
- **Isolation:** Behind `speechToText()` and `textToSpeech()` interfaces
- **Can we replace it?** Yes, interface allows drop-in replacement
- **Self-hosted alternative:** Vosk for STT, Coqui for TTS

---

## SDK Avoidance Documentation

We prefer libraries over SDKs. When SDKs are unavoidable, we document exactly what they do:

### Why Libraries > SDKs

| Aspect | Library | SDK |
|--------|---------|-----|
| Control | Full control | Hidden logic |
| Understanding | We know what it does | Magic black box |
| Debugging | Can step through | Can't inspect |
| Replacement | Easy to swap | Tightly coupled |

### Current SDK Usage

**None.** We use only libraries.

---

## Interface Isolation Pattern

All external services are accessed through isolated interfaces:

```typescript
// Example: Audio service interface
interface AudioService {
  speechToText(audio: Buffer, language: string): Promise<string>;
  textToSpeech(text: string, voice: string): Promise<Buffer>;
}

// Implementation can be swapped without changing callers
class OpenAIAudioService implements AudioService { ... }
class VoskAudioService implements AudioService { ... }
class CoquiAudioService implements AudioService { ... }
```

---

## Compliance Checklist

Before adding any new dependency:

1. [ ] Is it open-source?
2. [ ] Can we audit the source code?
3. [ ] Does it work offline/self-hosted?
4. [ ] Is it a library (not an SDK)?
5. [ ] Can it be replaced if needed?
6. [ ] Does it have a clear license?
7. [ ] Is it NOT a paid SaaS?

If any answer is "No", the dependency is not allowed.

---

## Future Self-Hosted Alternatives

For full independence from cloud APIs, these can be deployed:

| Current | Self-Hosted Alternative | Status |
|---------|------------------------|--------|
| OpenAI Whisper API | Whisper.cpp / Vosk | Interface ready |
| OpenAI TTS API | Coqui TTS / Piper | Interface ready |
| OpenAI GPT API | LLaMA / Mistral | Interface ready |

All interfaces are designed to accept these replacements with minimal code changes.


