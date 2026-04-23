# Ultra Low Latency Voice Assistant

This repo now includes a LiveKit-based voice assistant path designed for sub-second perceived latency.

Code entry points:

- Server session routes: `server/voice-assistant-routes.ts`
- Server worker and streaming pipeline: `server/voice-assistant-service.ts`
- Client hook: `client/src/hooks/use-voice-assistant.ts`
- Client page: `client/src/pages/VoiceAssistantPage.tsx`
- Browser route: `/calls/assistant`

## Architecture

```text
 Browser / Mobile
   |
   |  WebRTC audio publish (LiveKit, audio only)
   v
 LiveKit room in Mumbai / ap-south-1
   |
   |  server participant subscribes to user mic track
   v
 Voice assistant worker (Node.js)
   |
   +--> VAD on 20ms PCM frames
   |
   +--> Deepgram streaming STT
   |      - interim_results=true
   |      - endpointing=150ms
   |
   +--> OpenAI streaming LLM
   |      - starts on stable partial transcript
   |      - short context window
   |
   +--> Azure Neural TTS streaming PCM
   |      - starts on first speakable phrase
   |      - publishes PCM frames immediately
   |
   +--> LiveKit outbound assistant audio track
   |
   +--> LiveKit data channel
          - transcript partial/final
          - latency per turn
          - reconnect/error state
```

## Latency Strategy

- Input audio is normalized to 16kHz mono PCM.
- Frames are processed every 20ms.
- VAD runs before STT so barge-in can interrupt queued TTS quickly.
- The LLM starts on partial transcripts instead of waiting for the final sentence.
- TTS starts as soon as the first speakable phrase is ready.
- Pre-cached phrases provide immediate filler for greetings or slow-first-token moments.
- Transport is audio-only LiveKit to reduce mobile network overhead.

## Target

- Perceived latency target: 500ms to 900ms
- Tuned env default: `VOICE_ASSISTANT_TARGET_LATENCY_MS=900`

## Deployment Notes

- Deploy the Node app and LiveKit close together in `ap-south-1` (Mumbai) for the lowest transport latency.
- LiveKit should run in Mumbai or the closest available India POP.
- Azure Speech should use the closest Indian speech region available to your subscription, typically `centralindia`.
- Keep Redis, Postgres, and app workers in the same region as the Node app.
- Use audio-only rooms for weak mobile networks.

## Setup

1. Configure these env vars:

```env
LIVEKIT_URL=wss://livekit.yourdomain.com
LIVEKIT_API_KEY=...
LIVEKIT_API_SECRET=...

DEEPGRAM_API_KEY=...
DEEPGRAM_STT_MODEL=nova-3
DEEPGRAM_STT_ENDPOINTING_MS=150

AI_INTEGRATIONS_OPENAI_API_KEY=...
AI_INTEGRATIONS_OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_VOICE_ASSISTANT_MODEL=gpt-4.1-mini
OPENAI_VOICE_ASSISTANT_MAX_TOKENS=96

AZURE_SPEECH_KEY=...
AZURE_SPEECH_REGION=centralindia

VOICE_ASSISTANT_TARGET_LATENCY_MS=900
VOICE_ASSISTANT_MAX_CONTEXT_TURNS=6
VOICE_ASSISTANT_MIN_PARTIAL_WORDS=2
VOICE_ASSISTANT_RESTART_DELTA=10
VOICE_ASSISTANT_ENABLE_PRECACHE=true
VOICE_ASSISTANT_SYSTEM_PROMPT=You are NeuraTalk Voice Assistant. Reply in short spoken sentences for live audio.
```

2. Start the app.

```bash
npm run dev
```

3. Open the assistant page.

```text
/calls/assistant
```

4. Start a session and allow microphone access.

## Session Flow

1. Client calls `POST /api/voice-assistant/session`.
2. Server creates a dedicated LiveKit room and issues a client token.
3. Server joins the room as a hidden assistant participant.
4. Client publishes mic audio.
5. Assistant worker subscribes to the audio track and streams PCM to Deepgram.
6. On stable partial transcripts, the worker starts the OpenAI stream.
7. On the first speakable phrase, the worker starts Azure TTS.
8. Azure PCM is published back into the room on the assistant audio track.
9. Transcript and latency data flow over the LiveKit data channel.

## Barge-In

- If RMS-based VAD detects user speech while assistant audio is queued:
  - current OpenAI stream is aborted
  - current Azure stream is aborted
  - LiveKit `AudioSource.clearQueue()` is called
  - the next response is built from the newest transcript

## Logging

The worker logs these timings for every completed turn:

- STT first partial
- STT final
- LLM first token
- TTS first audio
- perceived latency
- total turn duration

## API Endpoints

- `GET /api/voice-assistant/health`
- `POST /api/voice-assistant/session`
- `DELETE /api/voice-assistant/session/:sessionId`
- `GET /api/voice-assistant/sessions` (super admin only)

## Caveats

- The worker is optimized for one human speaker per assistant room.
- Short partial restarts trade a small amount of answer churn for lower latency.
- For larger scale, run the assistant worker as a separate process pool close to LiveKit.
