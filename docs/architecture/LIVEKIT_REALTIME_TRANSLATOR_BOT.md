# LiveKit Realtime Translator Bot

Production-oriented duplex translator bot for NeuraTalk calls.

## Architecture

```text
User A mic (LiveKit audio track)      User B mic (LiveKit audio track)
              |                                     |
              v                                     v
        VAD + frame slicing                   VAD + frame slicing
              |                                     |
              v                                     v
       Deepgram streaming STT               Deepgram streaming STT
              |                                     |
              v                                     v
   Partial/final transcript router       Partial/final transcript router
              |                                     |
              v                                     v
   Azure Translate / low-latency         Azure Translate / low-latency
     fallback translation cache            fallback translation cache
              |                                     |
              v                                     v
     Azure Neural TTS streaming            Azure Neural TTS streaming
              |                                     |
              v                                     v
 Bot track: translated-for-B-from-A   Bot track: translated-for-A-from-B
              |                                     |
              v                                     v
        User B playback                          User A playback
```

## What Was Added

- `server/translator-bot.ts`
  - LiveKit bot joins each room as a hidden participant.
  - Subscribes to human audio tracks only.
  - Maintains isolated per-speaker STT pipelines.
  - Maintains isolated per-source->target TTS output tracks.
  - Interrupts playback on new speech or barge-in.
  - Publishes targeted translation data messages for subtitles/fallback.
- `server/modules/calls/smart-router.ts`
  - Fixed translator bot dynamic import path.
  - Stops bot worker during call teardown.
- `client/src/hooks/use-livekit-call.ts`
  - Plays only bot tracks targeted to the current participant.
  - Suppresses direct human audio when local/remote languages differ.

## Required Environment Variables

- `LIVEKIT_URL`
- `LIVEKIT_API_KEY`
- `LIVEKIT_API_SECRET`
- `DEEPGRAM_API_KEY`
- `DEEPGRAM_STT_MODEL`
- `DEEPGRAM_STT_ENDPOINTING_MS`
- `AZURE_SPEECH_KEY`
- `AZURE_SPEECH_REGION`
- `AZURE_TRANSLATOR_KEY`
- `AZURE_TRANSLATOR_REGION`

## Optional Runtime Knobs

- `TRANSLATOR_BOT_TARGET_LATENCY_MS=900`
- `TRANSLATOR_BOT_MIN_PARTIAL_WORDS=2`
- `TRANSLATOR_BOT_RESTART_DELTA=8`
- `TRANSLATOR_BOT_VAD_THRESHOLD=0.018`
- `TRANSLATOR_BOT_SILENCE_RESET_FRAMES=6`
- `TRANSLATOR_BOT_ENABLE_LANGUAGE_DETECT=true`
- `TRANSLATOR_BOT_ENABLE_PRECACHE=true`

## Setup

1. Provision LiveKit in India, ideally Mumbai-adjacent infra.
2. Set Deepgram and Azure Speech/Translator keys in `.env`.
3. Ensure call participants publish `metadata.language` or use the in-call language update action.
4. Start a translated voice/video call through the existing `/api/calls/initiate` flow.
5. Verify the bot participant publishes tracks named:
   - `translated-for-<targetIdentity>-from-<sourceIdentity>`

## Operational Notes

- Target latency is tuned for 20 ms PCM frames and early partial transcript restarts.
- Bot audio is never re-processed because tracks from bot participants are ignored.
- If Azure TTS fails, the bot sends a targeted text fallback event instead of blocking the room.
- If a participant changes language mid-call, the bot updates its routing and reconnects STT when needed.

## Current Production Caveats

- Auto-detect language is best-effort. For best STT accuracy, pass the user-selected language in participant metadata.
- End-to-end latency still depends on actual LiveKit, Deepgram, and Azure regions plus mobile network quality.
- This implementation is optimized for 1:1 translated calls first; larger rooms work, but each extra participant increases bot fan-out.
