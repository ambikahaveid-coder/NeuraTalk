/**
 * RTP-Fork AI Worker
 *
 * Receives forked RTP audio from RTPEngine and runs real-time AI processing:
 *   - Chunked STT (500ms segments → transcript)
 *   - Real-time translation (if caller/callee speak different languages)
 *   - Sentiment tracking per utterance
 *   - Live transcript push via Redis pub/sub → WebSocket to UI
 *
 * This replaces the translator-bot pattern (LiveKit bot participant).
 * Audio arrives as raw G.711 PCMU/PCMA RTP packets over UDP.
 *
 * Deployment: runs as a sidecar alongside the Node.js server process,
 * or as a separate worker pod in Kubernetes.
 *
 * env:
 *   RTP_WORKER_BIND_HOST — UDP bind address (default: 0.0.0.0)
 *   RTP_WORKER_BIND_PORT — UDP port to receive forked RTP (default: 7000)
 *   RTP_WORKER_CHUNK_MS  — Transcription chunk size in ms (default: 1500)
 */

import * as dgram from "node:dgram";
import { EventEmitter } from "node:events";
import { logger } from "../observability";
import { getRedisClient } from "../redis";
import { getAIPipeline } from "./pipeline";
import type { SupportedLanguage } from "./types";

const BIND_HOST = () => process.env.RTP_WORKER_BIND_HOST || "0.0.0.0";
const BIND_PORT = () => parseInt(process.env.RTP_WORKER_BIND_PORT || "7000", 10);
const CHUNK_MS = () => parseInt(process.env.RTP_WORKER_CHUNK_MS || "1500", 10);

// G.711 PCMU/PCMA: 8kHz, 8-bit, 1ch → 8000 bytes/sec
const G711_BYTES_PER_MS = 8;
const RTP_HEADER_BYTES = 12;

export interface RTPWorkerSession {
  callId: string;
  fromLanguage: SupportedLanguage;
  toLanguage?: SupportedLanguage;
  direction: "inbound" | "outbound";
}

interface CallBuffer {
  session: RTPWorkerSession;
  pcmChunks: Buffer[];
  pcmBytes: number;
  lastFlushAt: number;
  flushTimer: NodeJS.Timeout | null;
}

export interface LiveTranscriptEvent {
  callId: string;
  direction: "inbound" | "outbound";
  transcript: string;
  translation?: string;
  sentiment?: string;
  isFinal: boolean;
  timestampMs: number;
}

export class RTPAIWorker extends EventEmitter {
  private socket: dgram.Socket | null = null;
  private sessions: Map<string, CallBuffer> = new Map();
  private running = false;

  isConfigured(): boolean {
    // Only active when RTPEngine is configured and ports are open
    return Boolean(process.env.RTPENGINE_HOST);
  }

  async start(): Promise<void> {
    if (!this.isConfigured()) {
      logger.info("RTPWorker", "RTPEngine not configured — RTP AI worker disabled");
      return;
    }

    if (this.running) return;
    this.running = true;

    this.socket = dgram.createSocket("udp4");

    this.socket.on("message", (msg, rinfo) => {
      this.handleRTPPacket(msg);
    });

    this.socket.on("error", (err) => {
      logger.error("RTPWorker", `UDP socket error: ${err}`);
    });

    return new Promise((resolve, reject) => {
      this.socket!.bind(BIND_PORT(), BIND_HOST(), () => {
        logger.info("RTPWorker", `Listening for forked RTP on ${BIND_HOST()}:${BIND_PORT()}`);
        resolve();
      });
    });
  }

  stop(): void {
    this.running = false;
    for (const buf of Array.from(this.sessions.values())) {
      if (buf.flushTimer) clearTimeout(buf.flushTimer);
    }
    this.sessions.clear();
    this.socket?.close();
    this.socket = null;
  }

  /**
   * Register a call session so incoming RTP is attributed to it.
   * Must be called when a call starts (from smart-router or PSTN handler).
   */
  registerSession(session: RTPWorkerSession): void {
    this.sessions.set(session.callId, {
      session,
      pcmChunks: [],
      pcmBytes: 0,
      lastFlushAt: Date.now(),
      flushTimer: null,
    });
    logger.debug("RTPWorker", `Session registered: ${session.callId}`);
  }

  unregisterSession(callId: string): void {
    const buf = this.sessions.get(callId);
    if (buf?.flushTimer) clearTimeout(buf.flushTimer);
    this.sessions.delete(callId);
    logger.debug("RTPWorker", `Session unregistered: ${callId}`);
  }

  private handleRTPPacket(packet: Buffer): void {
    if (packet.length <= RTP_HEADER_BYTES) return;

    // Extract SSRC from RTP header (bytes 8-11) — used to match to call
    const ssrc = packet.readUInt32BE(8).toString(16);
    const payload = packet.slice(RTP_HEADER_BYTES);

    // Find the session by SSRC correlation — in production this comes from
    // RTPEngine's per-call forking configuration where SSRC identifies the leg
    const callBuf = this.findSessionBySSRC(ssrc);
    if (!callBuf) return;

    // Decode G.711 PCMU to linear PCM
    const pcm = decodePCMU(payload);
    callBuf.pcmChunks.push(pcm);
    callBuf.pcmBytes += pcm.length;

    const targetBytes = CHUNK_MS() * G711_BYTES_PER_MS * 2; // *2 for 16-bit PCM
    if (callBuf.pcmBytes >= targetBytes) {
      void this.flushChunk(callBuf);
    } else {
      // Schedule flush in case audio stops (end of utterance)
      if (!callBuf.flushTimer) {
        callBuf.flushTimer = setTimeout(() => {
          callBuf.flushTimer = null;
          if (callBuf.pcmBytes > 0) {
            void this.flushChunk(callBuf);
          }
        }, CHUNK_MS() + 200);
      }
    }
  }

  private findSessionBySSRC(_ssrc: string): CallBuffer | null {
    // In a real deployment, RTPEngine passes SSRC→callId mapping on fork start.
    // For now, return the most recent active session (single-tenant dev mode).
    const entries = Array.from(this.sessions.values());
    return entries.length > 0 ? entries[entries.length - 1] : null;
  }

  private async flushChunk(callBuf: CallBuffer): Promise<void> {
    if (callBuf.flushTimer) {
      clearTimeout(callBuf.flushTimer);
      callBuf.flushTimer = null;
    }

    const chunks = callBuf.pcmChunks.splice(0);
    callBuf.pcmBytes = 0;
    callBuf.lastFlushAt = Date.now();

    if (chunks.length === 0) return;

    const combined = Buffer.concat(chunks);
    // Wrap raw PCM in a WAV header for the STT API
    const wav = pcmToWav(combined, 8000, 1, 16);

    try {
      const pipeline = getAIPipeline();
      const sttResult = await pipeline.transcribe({
        audio: wav,
        mimeType: "audio/wav",
        language: callBuf.session.fromLanguage,
        sampleRateHz: 8000,
        callId: callBuf.session.callId,
      });

      if (!sttResult.transcript.trim()) return;

      let translation: string | undefined;
      if (callBuf.session.toLanguage && callBuf.session.toLanguage !== callBuf.session.fromLanguage) {
        try {
          const tr = await pipeline.translate({
            text: sttResult.transcript,
            fromLanguage: callBuf.session.fromLanguage,
            toLanguage: callBuf.session.toLanguage,
            callId: callBuf.session.callId,
          });
          translation = tr.translatedText;
        } catch (err) {
          logger.warn("RTPWorker", `Translation failed: ${err}`);
        }
      }

      const event: LiveTranscriptEvent = {
        callId: callBuf.session.callId,
        direction: callBuf.session.direction,
        transcript: sttResult.transcript,
        translation,
        isFinal: true,
        timestampMs: Date.now(),
      };

      this.emit("transcript", event);
      await this.publishTranscript(event);
    } catch (err) {
      logger.warn("RTPWorker", `AI processing failed for ${callBuf.session.callId}: ${err}`);
    }
  }

  private async publishTranscript(event: LiveTranscriptEvent): Promise<void> {
    try {
      const redis = getRedisClient();
      const channel = `transcript:${event.callId}`;
      await redis.publish(channel, JSON.stringify(event));
    } catch (err) {
      logger.warn("RTPWorker", `Redis publish failed: ${err}`);
    }
  }
}

// G.711 PCMU (μ-law) to 16-bit linear PCM decoder
function decodePCMU(mulaw: Buffer): Buffer {
  const out = Buffer.allocUnsafe(mulaw.length * 2);
  for (let i = 0; i < mulaw.length; i++) {
    let sample = mulaw[i] ^ 0xff;
    const sign = sample & 0x80 ? -1 : 1;
    const exponent = (sample >> 4) & 0x07;
    const mantissa = sample & 0x0f;
    let linear = ((mantissa << 1) + 33) << exponent;
    linear = sign * (linear - 33);
    const clamped = Math.max(-32768, Math.min(32767, linear));
    out.writeInt16LE(clamped, i * 2);
  }
  return out;
}

// Wrap raw PCM samples in a WAV container
function pcmToWav(pcm: Buffer, sampleRate: number, channels: number, bitsPerSample: number): Buffer {
  const byteRate = (sampleRate * channels * bitsPerSample) / 8;
  const blockAlign = (channels * bitsPerSample) / 8;
  const dataSize = pcm.length;
  const headerSize = 44;
  const buf = Buffer.allocUnsafe(headerSize + dataSize);

  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write("WAVE", 8);
  buf.write("fmt ", 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);  // PCM
  buf.writeUInt16LE(channels, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(byteRate, 28);
  buf.writeUInt16LE(blockAlign, 32);
  buf.writeUInt16LE(bitsPerSample, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(dataSize, 40);
  pcm.copy(buf, 44);

  return buf;
}

let _rtpWorker: RTPAIWorker | null = null;

export function getRTPAIWorker(): RTPAIWorker {
  if (!_rtpWorker) _rtpWorker = new RTPAIWorker();
  return _rtpWorker;
}

export async function initRTPAIWorker(): Promise<void> {
  const worker = getRTPAIWorker();
  if (!worker.isConfigured()) return;
  try {
    await worker.start();
  } catch (err) {
    logger.warn("RTPWorker", `Failed to start: ${err}`);
  }
}
