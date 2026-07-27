/**
 * Exotel Bidirectional Voice Streaming Bridge
 *
 * Lets a B2B client keep their existing published number untouched. They add
 * one "Voicebot/Stream Applet" step in their own Exotel call flow pointing at
 * the wss:// URL we generate per config (see service.ts buildExotelWebhookUrl).
 * From that point on, every future call auto-streams here with zero manual
 * action per call — the one-time setup happens once in their Exotel dashboard.
 *
 * Protocol (Exotel AgentStream / Voicebot Applet, per developer.exotel.com):
 *   connected -> start -> media* -> (dtmf | clear)* -> stop
 * Audio is base64-encoded, chunk size multiples of 320 bytes.
 *
 * IMPORTANT — unverified assumption, confirm against a real Exotel payload
 * before production use: this treats media.payload as 8kHz 16-bit linear PCM
 * (not mulaw like Twilio Media Streams). If Exotel's actual payload differs,
 * only mulawToPcm16/pcm16ToMulaw-equivalent conversion needs to change — the
 * STT/translate/TTS pipeline itself is codec-agnostic.
 *
 * SCOPE NOTE: this bridges ONE call leg — it turns the caller's speech into
 * translated speech played back into the SAME call (a translating voicebot).
 * Continuously translating between two *live humans* on two separate legs
 * (customer + human agent) needs Exotel to stream both legs simultaneously
 * and a way to inject audio into each — this has not been confirmed as
 * possible with Exotel's current API and must be validated with their
 * support/docs once real account access exists. Do not claim that scenario
 * works until it has been tested end-to-end on a live Exotel account.
 */

import { WebSocket, WebSocketServer } from "ws";
import { IncomingMessage } from "http";
import { speechToText, textToSpeech } from "../../ai_integrations/audio/client";
import { ultraTranslate, preWarmCacheForCall } from "../../ultra-pipeline";
import { logger } from "../../observability";
import * as service from "./service";
import type { ExotelStreamConfig } from "@shared/schema";

const SAMPLE_RATE = 8000;
const VAD_SILENCE_MS = 200;
const VAD_MIN_PHRASE_MS = 200;
const VAD_MAX_PHRASE_MS = 3000;
const VAD_ENERGY_THRESHOLD = 400; // PCM16 RMS threshold (linear scale, not mulaw)

// Security/operational guardrails — a live bearer-token WS endpoint reachable
// from the internet needs its own limits, independent of anything Exotel enforces.
const MAX_SESSION_DURATION_MS = 65 * 60 * 1000; // Exotel caps streams at ~60min; we hang up just past that so we control the close reason
const MAX_MEDIA_CHUNK_BYTES = 64 * 1024;        // real Exotel frames are ~320 bytes; anything this large is not a legitimate media event
const MAX_BUFFERED_AUDIO_BYTES = 2 * 1024 * 1024; // guards against a stuck flush loop building an unbounded buffer

interface ExotelSession {
  config: ExotelStreamConfig;
  ws: WebSocket;
  streamSid: string | null;
  callSid: string | null;
  audioBuffer: Buffer[];
  audioBufferBytes: number;
  silenceTimer: NodeJS.Timeout | null;
  forceFlushTimer: NodeJS.Timeout | null;
  isProcessing: boolean;
  status: "connecting" | "active" | "ended";
  connectedAt: number;
  lastActivityAt: number;
  durationGuard: NodeJS.Timeout | null;
}

const activeSessions = new Map<string, ExotelSession>();

/** For the admin "live sessions" panel — org-scoped, no audio/PII exposed. */
export function getActiveSessionsForOrg(organizationId: number): Array<{
  configId: number;
  configLabel: string;
  streamSid: string | null;
  callSid: string | null;
  status: string;
  connectedAt: number;
  lastActivityAt: number;
}> {
  const out: ReturnType<typeof getActiveSessionsForOrg> = [];
  for (const session of Array.from(activeSessions.values())) {
    if (session.config.organizationId !== organizationId) continue;
    out.push({
      configId: session.config.id,
      configLabel: session.config.label,
      streamSid: session.streamSid,
      callSid: session.callSid,
      status: session.status,
      connectedAt: session.connectedAt,
      lastActivityAt: session.lastActivityAt,
    });
  }
  return out;
}

export function setupExotelStreamWebSocket(wss: WebSocketServer): void {
  wss.on("connection", (ws: WebSocket, req: IncomingMessage) => {
    const url = req.url || "";
    const match = url.match(/\/ws\/exotel-stream\/([a-f0-9]+)/i);
    if (!match) {
      ws.close();
      return;
    }
    const streamToken = match[1];

    // Exotel starts sending "connected"/"start" the instant the socket opens, and
    // the `ws` library begins parsing incoming frames immediately once this
    // connection callback runs — before we've had a chance to `await` the config
    // lookup below. Any message emitted with no listener attached is silently
    // dropped. Buffer raw frames synchronously now; replay them once the async
    // lookup resolves and the real handler takes over.
    const earlyMessages: (Buffer | string)[] = [];
    let buffering = true;
    const bufferEarly = (data: Buffer | string) => { if (buffering) earlyMessages.push(data); };
    ws.on("message", bufferEarly);

    void (async () => {
      const config = await service.getExotelConfigByToken(streamToken).catch(() => null);
      if (!config || !config.isActive) {
        logger.warn("ExotelBridge", `Rejected connection — unknown or inactive stream token`);
        ws.close();
        return;
      }

      // A stream token is a bearer credential (like an API key embedded in the URL) —
      // reject a second concurrent connection on the same token rather than silently
      // letting it replace the first, so a leaked/reused token can't silently hijack
      // an in-progress call's audio.
      const existing = activeSessions.get(streamToken);
      if (existing && existing.status !== "ended") {
        logger.warn("ExotelBridge", `Rejected duplicate connection for token — one is already active (config ${config.id})`);
        ws.close();
        return;
      }

      const now = Date.now();
      const session: ExotelSession = {
        config,
        ws,
        streamSid: null,
        callSid: null,
        audioBuffer: [],
        audioBufferBytes: 0,
        silenceTimer: null,
        forceFlushTimer: null,
        isProcessing: false,
        status: "connecting",
        connectedAt: now,
        lastActivityAt: now,
        durationGuard: null,
      };
      session.durationGuard = setTimeout(() => {
        logger.warn("ExotelBridge", `Session ${streamToken.slice(0, 8)}… exceeded max duration — closing`);
        cleanupSession(streamToken);
      }, MAX_SESSION_DURATION_MS);
      activeSessions.set(streamToken, session);
      service.markExotelConfigConnected(config.id).catch(() => undefined);

      if (config.defaultSrcLanguage && config.defaultTgtLanguage && config.defaultSrcLanguage !== config.defaultTgtLanguage) {
        preWarmCacheForCall(config.defaultSrcLanguage, config.defaultTgtLanguage).catch(() => undefined);
      }

      const onMessage = (data: Buffer | string) => {
        try {
          const msg = JSON.parse(data.toString());
          handleExotelMessage(streamToken, session, msg);
        } catch (err) {
          logger.warn("ExotelBridge", `Failed to parse message: ${String(err)}`);
        }
      };

      ws.removeListener("message", bufferEarly);
      buffering = false;
      for (const raw of earlyMessages) onMessage(raw); // replay anything that arrived during the lookup
      ws.on("message", onMessage);

      ws.on("close", () => {
        cleanupSession(streamToken);
      });

      ws.on("error", (err) => {
        logger.warn("ExotelBridge", `Socket error: ${String(err)}`);
      });
    })();
  });
}

function cleanupSession(streamToken: string): void {
  const session = activeSessions.get(streamToken);
  if (!session) return;
  session.status = "ended";
  if (session.silenceTimer) clearTimeout(session.silenceTimer);
  if (session.forceFlushTimer) clearTimeout(session.forceFlushTimer);
  if (session.durationGuard) clearTimeout(session.durationGuard);
  if (session.ws.readyState === WebSocket.OPEN || session.ws.readyState === WebSocket.CONNECTING) {
    session.ws.close();
  }
  activeSessions.delete(streamToken);
}

function handleExotelMessage(streamToken: string, session: ExotelSession, msg: any): void {
  session.lastActivityAt = Date.now();

  switch (msg.event) {
    case "connected":
      logger.info("ExotelBridge", `Protocol connected for config ${session.config.id}`);
      break;

    case "start":
      session.streamSid = msg.stream_sid || msg.streamSid || null;
      session.callSid = msg.start?.call_sid || msg.start?.callSid || null;
      session.status = "active";
      logger.info("ExotelBridge", `Stream started — streamSid=${session.streamSid} callSid=${session.callSid}`);
      break;

    case "media":
      if (msg.media?.payload) {
        const audioChunk = Buffer.from(msg.media.payload, "base64");
        if (audioChunk.length > MAX_MEDIA_CHUNK_BYTES) {
          logger.warn("ExotelBridge", `Oversized media chunk (${audioChunk.length}B) — dropping, likely malformed/malicious`);
          break;
        }
        handleIncomingAudio(streamToken, session, audioChunk);
      }
      break;

    case "dtmf":
      logger.debug("ExotelBridge", `DTMF received: ${msg.dtmf?.digit}`);
      break;

    case "clear":
      session.audioBuffer = [];
      session.audioBufferBytes = 0;
      break;

    case "stop":
      logger.info("ExotelBridge", `Stream stopped — streamSid=${session.streamSid}`);
      cleanupSession(streamToken);
      break;
  }
}

function pcm16Rms(pcm: Buffer): number {
  let sum = 0;
  const samples = Math.floor(pcm.length / 2);
  if (samples === 0) return 0;
  for (let i = 0; i < samples; i++) {
    const s = pcm.readInt16LE(i * 2);
    sum += s * s;
  }
  return Math.sqrt(sum / samples);
}

function handleIncomingAudio(streamToken: string, session: ExotelSession, audioChunk: Buffer): void {
  const energy = pcm16Rms(audioChunk);

  if (energy < VAD_ENERGY_THRESHOLD) {
    if (session.audioBuffer.length > 0 && !session.silenceTimer) {
      session.silenceTimer = setTimeout(() => flushAudio(streamToken, session), VAD_SILENCE_MS);
    }
    return;
  }

  if (session.audioBufferBytes + audioChunk.length > MAX_BUFFERED_AUDIO_BYTES) {
    logger.warn("ExotelBridge", `Audio buffer cap hit for session — forcing flush to avoid unbounded memory growth`);
    session.audioBuffer = [];
    session.audioBufferBytes = 0;
  }

  session.audioBuffer.push(audioChunk);
  session.audioBufferBytes += audioChunk.length;

  if (session.silenceTimer) {
    clearTimeout(session.silenceTimer);
    session.silenceTimer = null;
  }
  session.silenceTimer = setTimeout(() => flushAudio(streamToken, session), VAD_SILENCE_MS);

  if (!session.forceFlushTimer) {
    session.forceFlushTimer = setTimeout(() => {
      session.forceFlushTimer = null;
      if (session.audioBuffer.length > 0) flushAudio(streamToken, session);
    }, VAD_MAX_PHRASE_MS);
  }
}

async function flushAudio(streamToken: string, session: ExotelSession): Promise<void> {
  if (session.audioBuffer.length === 0 || session.isProcessing) return;

  session.isProcessing = true;
  if (session.silenceTimer) { clearTimeout(session.silenceTimer); session.silenceTimer = null; }
  if (session.forceFlushTimer) { clearTimeout(session.forceFlushTimer); session.forceFlushTimer = null; }

  const combined = Buffer.concat(session.audioBuffer);
  session.audioBuffer = [];
  session.audioBufferBytes = 0;

  const durationMs = (combined.length / 2 / SAMPLE_RATE) * 1000;
  if (durationMs < VAD_MIN_PHRASE_MS) {
    session.isProcessing = false;
    return;
  }

  try {
    const wavBuffer = createWavBuffer(combined, SAMPLE_RATE);
    const srcLang = session.config.defaultSrcLanguage || "auto";
    const tgtLang = session.config.defaultTgtLanguage || "en-US";

    const sttResult = await speechToText(wavBuffer, "wav", srcLang !== "auto" ? srcLang : "en");
    const transcription = typeof sttResult === "string" ? sttResult : (sttResult as any).text;
    if (!transcription || !transcription.trim()) {
      session.isProcessing = false;
      return;
    }

    const translated = srcLang === tgtLang ? transcription : await ultraTranslate(transcription, srcLang, tgtLang);
    logger.info("ExotelBridge", `[${session.config.id}] "${transcription}" (${srcLang}) -> "${translated}" (${tgtLang})`);
    const ttsAudio = await textToSpeech(translated, "alloy", "wav", tgtLang);
    const pcm = wavToPcm16(ttsAudio, SAMPLE_RATE);

    sendAudioToExotel(session, pcm);
  } catch (err) {
    logger.error("ExotelBridge", `Pipeline error: ${String(err)}`);
  } finally {
    session.isProcessing = false;
  }
}

function sendAudioToExotel(session: ExotelSession, pcm: Buffer): void {
  if (session.ws.readyState !== WebSocket.OPEN || !session.streamSid) return;
  const CHUNK_SIZE = 320;
  for (let i = 0; i < pcm.length; i += CHUNK_SIZE) {
    const chunk = pcm.subarray(i, Math.min(i + CHUNK_SIZE, pcm.length));
    session.ws.send(JSON.stringify({
      event: "media",
      stream_sid: session.streamSid,
      media: { payload: chunk.toString("base64") },
    }));
  }
}

function createWavBuffer(pcmData: Buffer, sampleRate: number): Buffer {
  const header = Buffer.alloc(44);
  const dataSize = pcmData.length;
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + dataSize, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(dataSize, 40);
  return Buffer.concat([header, pcmData]);
}

/** Extracts PCM16 data from a WAV buffer and resamples to targetRate if needed. */
function wavToPcm16(wav: Buffer, targetRate: number): Buffer {
  if (wav.length < 44 || wav.toString("ascii", 0, 4) !== "RIFF") {
    return wav; // assume already raw PCM
  }
  const sourceRate = wav.readUInt32LE(24);
  let dataOffset = 12;
  let pcm = wav.subarray(44);
  while (dataOffset < wav.length - 8) {
    const chunkId = wav.toString("ascii", dataOffset, dataOffset + 4);
    const chunkSize = wav.readUInt32LE(dataOffset + 4);
    if (chunkId === "data") {
      pcm = wav.subarray(dataOffset + 8, dataOffset + 8 + chunkSize);
      break;
    }
    dataOffset += 8 + chunkSize;
  }
  if (sourceRate === targetRate) return pcm;

  const ratio = sourceRate / targetRate;
  const numSamples = Math.floor(pcm.length / 2);
  const outSamples = Math.floor(numSamples / ratio);
  const out = Buffer.alloc(outSamples * 2);
  for (let i = 0; i < outSamples; i++) {
    const srcIdx = Math.floor(i * ratio);
    if (srcIdx * 2 + 1 < pcm.length) {
      out.writeInt16LE(pcm.readInt16LE(srcIdx * 2), i * 2);
    }
  }
  return out;
}
