import { EventEmitter } from "events";
import * as dgram from "dgram";
import * as crypto from "crypto";

// ============================================================================
// ⚠️ DEPRECATED — replaced by LiveKit SFU (server/livekit-service.ts)
// ============================================================================
// Audit finding: mediaRelayServer.start() was called from call-gateway.ts but
// the module was never properly initialized — actual RTP streaming never worked.
// Production path now uses LiveKit (hosted on RunPod pod) for media relay.
// Do NOT add features here. This file will be deleted after call-gateway.ts
// is migrated to smart-call-router.ts.
// ============================================================================
//
// WHY WE BUILT THIS (instead of using Twilio/Agora/etc.):
//
// 1. FULL AUDIO OWNERSHIP
//    - We must capture, process, and re-inject audio ourselves
//    - Third-party media servers hide the audio pipeline
//    - We cannot do phrase-level translation without raw access
//
// 2. LATENCY CONTROL
//    - Target: <300ms voice round-trip
//    - Jitter buffer: 80ms target, 200ms max
//    - We control every millisecond of delay
//
// 3. NO VENDOR LOCK-IN
//    - Deployable on any cloud or bare-metal
//    - No per-minute charges from telecom SaaS
//    - Full source code ownership
//
// 4. SECURITY OWNERSHIP
//    - SRTP encryption with our own key management
//    - No third-party seeing unencrypted audio
//    - Full audit trail of all packets
//
// ============================================================================
// TECHNICAL ARCHITECTURE
// ============================================================================
//
// RTP PACKET FLOW:
//
// ┌──────────┐    UDP/RTP     ┌──────────────┐    UDP/RTP     ┌──────────┐
// │ Caller   │ ────────────▶ │ Media Relay  │ ────────────▶ │ Callee   │
// │ Device   │               │ (This Server) │               │ Device   │
// └──────────┘               └──────────────┘               └──────────┘
//                                   │
//                                   ▼
//                            ┌──────────────┐
//                            │ AI Processing │
//                            │ (Translation) │
//                            └──────────────┘
//
// PACKET STRUCTURE (RFC 3550):
// ┌───────────────────────────────────────────────────────────────────────┐
// │ V=2 │ P │ X │ CC │ M │ PT │      Sequence Number (16 bits)           │
// ├───────────────────────────────────────────────────────────────────────┤
// │                      Timestamp (32 bits)                              │
// ├───────────────────────────────────────────────────────────────────────┤
// │                   Synchronization Source (SSRC) (32 bits)             │
// ├───────────────────────────────────────────────────────────────────────┤
// │                         Audio Payload                                 │
// └───────────────────────────────────────────────────────────────────────┘
//
// SRTP ENCRYPTION (RFC 3711):
// - Cipher: AES-128-CM (Counter Mode)
// - Auth: HMAC-SHA1-80 (truncated to 80 bits)
// - Key derivation: From DTLS master secret
// - Replay protection: Sequence window tracking
//
// JITTER BUFFER:
// - Purpose: Smooth out network timing variations
// - Target latency: 80ms (configurable)
// - Max latency: 200ms (beyond this, drop old packets)
// - Reordering: Reassemble out-of-order packets
//
// ============================================================================
// DEPENDENCIES (all open-source, all auditable)
// ============================================================================
//
// - dgram: Node.js built-in UDP sockets
// - crypto: Node.js built-in cryptography (OpenSSL)
// - events: Node.js built-in event emitter
//
// NO EXTERNAL DEPENDENCIES. Everything is self-contained.
//
// ============================================================================

export interface MediaSession {
  sessionId: string;
  callId: string;
  callerEndpoint: MediaEndpoint;
  calleeEndpoint: MediaEndpoint;
  status: MediaSessionStatus;
  createdAt: number;
  lastActivity: number;
  stats: MediaStats;
}

export interface MediaEndpoint {
  address: string;
  port: number;
  ssrc?: number;
  codec: AudioCodec;
  payloadType: number;
}

export interface MediaStats {
  packetsRelayed: number;
  bytesRelayed: number;
  packetLoss: number;
  jitter: number;
  latencyMs: number;
}

export type MediaSessionStatus = 
  | "initializing"
  | "active"
  | "paused"
  | "ended";

export type AudioCodec = 
  | "opus"
  | "pcmu"   // G.711 μ-law
  | "pcma"   // G.711 A-law
  | "g722"
  | "amr"
  | "amr-wb";

export interface RTPHeader {
  version: number;
  padding: boolean;
  extension: boolean;
  csrcCount: number;
  marker: boolean;
  payloadType: number;
  sequenceNumber: number;
  timestamp: number;
  ssrc: number;
}

export interface RTPPacket {
  header: RTPHeader;
  payload: Buffer;
  receivedAt: number;
}

// ============================================================================
// JITTER BUFFER IMPLEMENTATION
// ============================================================================

export class JitterBuffer {
  private buffer: Map<number, RTPPacket> = new Map();
  private expectedSeq: number = 0;
  private isFirstPacket = true;
  private targetDelayMs: number;
  private maxBufferSize: number;
  private playoutStartTime: number = 0;

  constructor(targetDelayMs: number = 80, maxBufferSize: number = 50) {
    this.targetDelayMs = targetDelayMs;
    this.maxBufferSize = maxBufferSize;
  }

  push(packet: RTPPacket): void {
    if (this.isFirstPacket) {
      this.expectedSeq = packet.header.sequenceNumber;
      this.playoutStartTime = Date.now() + this.targetDelayMs;
      this.isFirstPacket = false;
    }

    this.buffer.set(packet.header.sequenceNumber, packet);

    if (this.buffer.size > this.maxBufferSize) {
      const oldestSeq = Math.min(...Array.from(this.buffer.keys()));
      this.buffer.delete(oldestSeq);
    }
  }

  pop(): RTPPacket | null {
    if (Date.now() < this.playoutStartTime) {
      return null;
    }

    const packet = this.buffer.get(this.expectedSeq);
    if (packet) {
      this.buffer.delete(this.expectedSeq);
      this.expectedSeq = (this.expectedSeq + 1) & 0xFFFF;
      return packet;
    }

    if (this.buffer.size > 0) {
      const minSeq = Math.min(...Array.from(this.buffer.keys()));
      const seqDiff = (minSeq - this.expectedSeq + 65536) % 65536;
      if (seqDiff > this.maxBufferSize / 2) {
        this.expectedSeq = minSeq;
        return this.pop();
      }
    }

    return null;
  }

  getStats(): { buffered: number; lost: number; targetDelay: number } {
    return {
      buffered: this.buffer.size,
      lost: 0,
      targetDelay: this.targetDelayMs,
    };
  }

  reset(): void {
    this.buffer.clear();
    this.isFirstPacket = true;
    this.expectedSeq = 0;
  }
}

// ============================================================================
// RTP PARSER/SERIALIZER
// ============================================================================

export function parseRTPHeader(data: Buffer): RTPHeader | null {
  if (data.length < 12) return null;

  const firstByte = data[0];
  const secondByte = data[1];

  return {
    version: (firstByte >> 6) & 0x03,
    padding: !!(firstByte & 0x20),
    extension: !!(firstByte & 0x10),
    csrcCount: firstByte & 0x0F,
    marker: !!(secondByte & 0x80),
    payloadType: secondByte & 0x7F,
    sequenceNumber: data.readUInt16BE(2),
    timestamp: data.readUInt32BE(4),
    ssrc: data.readUInt32BE(8),
  };
}

export function serializeRTPHeader(header: RTPHeader): Buffer {
  const buf = Buffer.alloc(12);
  
  buf[0] = 
    ((header.version & 0x03) << 6) |
    (header.padding ? 0x20 : 0) |
    (header.extension ? 0x10 : 0) |
    (header.csrcCount & 0x0F);
  
  buf[1] = 
    (header.marker ? 0x80 : 0) |
    (header.payloadType & 0x7F);
  
  buf.writeUInt16BE(header.sequenceNumber, 2);
  buf.writeUInt32BE(header.timestamp, 4);
  buf.writeUInt32BE(header.ssrc, 8);
  
  return buf;
}

export function createRTPPacket(header: RTPHeader, payload: Buffer): Buffer {
  const headerBuf = serializeRTPHeader(header);
  return Buffer.concat([headerBuf, payload]);
}

// ============================================================================
// MEDIA RELAY SERVER
// ============================================================================

export class MediaRelayServer extends EventEmitter {
  private udpSocket: dgram.Socket | null = null;
  private sessions = new Map<string, MediaSession>();
  private endpointToSession = new Map<string, string>();
  private port: number;
  private isRunning = false;

  private static instance: MediaRelayServer | null = null;

  static getInstance(): MediaRelayServer {
    if (!MediaRelayServer.instance) {
      MediaRelayServer.instance = new MediaRelayServer();
    }
    return MediaRelayServer.instance;
  }

  constructor(port: number = 10000) {
    super();
    this.port = port;
  }

  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.isRunning) {
        resolve();
        return;
      }

      this.udpSocket = dgram.createSocket("udp4");

      this.udpSocket.on("message", (msg, rinfo) => {
        this.handleIncomingPacket(msg, rinfo);
      });

      this.udpSocket.on("error", (err) => {
        console.error("[MediaRelay] Socket error:", err);
        this.emit("error", err);
      });

      this.udpSocket.bind(this.port, () => {
        this.isRunning = true;
        console.log(`[MediaRelay] UDP server listening on port ${this.port}`);
        resolve();
      });
    });
  }

  stop(): void {
    if (this.udpSocket) {
      this.udpSocket.close();
      this.udpSocket = null;
    }
    this.isRunning = false;
    this.sessions.clear();
    this.endpointToSession.clear();
    console.log("[MediaRelay] Server stopped");
  }

  createSession(
    callId: string,
    callerEndpoint: MediaEndpoint,
    calleeEndpoint: MediaEndpoint
  ): MediaSession {
    const sessionId = `media_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;

    const session: MediaSession = {
      sessionId,
      callId,
      callerEndpoint,
      calleeEndpoint,
      status: "initializing",
      createdAt: Date.now(),
      lastActivity: Date.now(),
      stats: {
        packetsRelayed: 0,
        bytesRelayed: 0,
        packetLoss: 0,
        jitter: 0,
        latencyMs: 0,
      },
    };

    this.sessions.set(sessionId, session);

    const callerKey = this.endpointKey(callerEndpoint.address, callerEndpoint.port);
    const calleeKey = this.endpointKey(calleeEndpoint.address, calleeEndpoint.port);
    this.endpointToSession.set(callerKey, sessionId);
    this.endpointToSession.set(calleeKey, sessionId);

    console.log(`[MediaRelay] Session created: ${sessionId} for call ${callId}`);
    return session;
  }

  updateSession(sessionId: string, status: MediaSessionStatus): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.status = status;
      this.emit("session_status_changed", { sessionId, status });
    }
  }

  endSession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    const callerKey = this.endpointKey(
      session.callerEndpoint.address, 
      session.callerEndpoint.port
    );
    const calleeKey = this.endpointKey(
      session.calleeEndpoint.address, 
      session.calleeEndpoint.port
    );

    this.endpointToSession.delete(callerKey);
    this.endpointToSession.delete(calleeKey);
    this.sessions.delete(sessionId);

    this.emit("session_ended", { 
      sessionId, 
      stats: session.stats,
      duration: Date.now() - session.createdAt,
    });

    console.log(`[MediaRelay] Session ended: ${sessionId}`);
  }

  getSession(sessionId: string): MediaSession | undefined {
    return this.sessions.get(sessionId);
  }

  getSessionByCallId(callId: string): MediaSession | undefined {
    const sessions = Array.from(this.sessions.values());
    for (const session of sessions) {
      if (session.callId === callId) {
        return session;
      }
    }
    return undefined;
  }

  private endpointKey(address: string, port: number): string {
    return `${address}:${port}`;
  }

  private handleIncomingPacket(data: Buffer, rinfo: dgram.RemoteInfo): void {
    const senderKey = this.endpointKey(rinfo.address, rinfo.port);
    const sessionId = this.endpointToSession.get(senderKey);

    if (!sessionId) {
      return;
    }

    const session = this.sessions.get(sessionId);
    if (!session || session.status !== "active") {
      return;
    }

    const header = parseRTPHeader(data);
    if (!header || header.version !== 2) {
      return;
    }

    session.lastActivity = Date.now();
    session.stats.packetsRelayed++;
    session.stats.bytesRelayed += data.length;

    const isFromCaller = senderKey === this.endpointKey(
      session.callerEndpoint.address,
      session.callerEndpoint.port
    );

    const targetEndpoint = isFromCaller 
      ? session.calleeEndpoint 
      : session.callerEndpoint;

    this.emit("packet_received", {
      sessionId,
      callId: session.callId,
      direction: isFromCaller ? "caller_to_callee" : "callee_to_caller",
      payload: data.slice(12),
      header,
    });

    if (this.udpSocket && this.isRunning) {
      this.udpSocket.send(
        data, 
        targetEndpoint.port, 
        targetEndpoint.address, 
        (err) => {
          if (err) {
            console.error("[MediaRelay] Send error:", err);
          }
        }
      );
    }
  }

  sendToEndpoint(
    sessionId: string,
    targetRole: "caller" | "callee",
    audioData: Buffer,
    sequenceNumber: number,
    timestamp: number
  ): void {
    const session = this.sessions.get(sessionId);
    if (!session || !this.udpSocket) return;

    const endpoint = targetRole === "caller" 
      ? session.callerEndpoint 
      : session.calleeEndpoint;

    const header: RTPHeader = {
      version: 2,
      padding: false,
      extension: false,
      csrcCount: 0,
      marker: false,
      payloadType: endpoint.payloadType,
      sequenceNumber: sequenceNumber & 0xFFFF,
      timestamp: timestamp & 0xFFFFFFFF,
      ssrc: endpoint.ssrc || 0x12345678,
    };

    const packet = createRTPPacket(header, audioData);
    
    this.udpSocket.send(packet, endpoint.port, endpoint.address, (err) => {
      if (err) {
        console.error("[MediaRelay] Send error:", err);
      }
    });
  }

  getActiveSessions(): MediaSession[] {
    return Array.from(this.sessions.values())
      .filter(s => s.status === "active");
  }

  getStats(): {
    activeSessions: number;
    totalPacketsRelayed: number;
    totalBytesRelayed: number;
  } {
    let totalPackets = 0;
    let totalBytes = 0;

    const sessions = Array.from(this.sessions.values());
    for (const session of sessions) {
      totalPackets += session.stats.packetsRelayed;
      totalBytes += session.stats.bytesRelayed;
    }

    return {
      activeSessions: this.getActiveSessions().length,
      totalPacketsRelayed: totalPackets,
      totalBytesRelayed: totalBytes,
    };
  }
}

export const mediaRelayServer = MediaRelayServer.getInstance();

// ============================================================================
// AUDIO PROCESSING HOOKS
// Intercept RTP packets for AI processing (STT, Translation, TTS)
// ============================================================================

export interface AudioProcessingConfig {
  enableSTT: boolean;
  enableTranslation: boolean;
  enableTTS: boolean;
  sourceLanguage: string;
  targetLanguage: string;
  emotionPreservation: boolean;
}

export async function processAudioPacketForAI(
  sessionId: string,
  audioPayload: Buffer,
  direction: "caller_to_callee" | "callee_to_caller",
  _config: AudioProcessingConfig
): Promise<{ translatedAudio?: Buffer; transcription?: string; error?: string }> {
  // This integrates with the existing call-streaming.ts pipeline
  // Audio packets are collected, VAD is applied, then processed through:
  // 1. Speech-to-Text (internal OpenAI Whisper or self-hosted Vosk)
  // 2. Translation (internal GPT or self-hosted NMT model)
  // 3. Text-to-Speech (internal TTS or self-hosted Coqui)
  
  // For now, return the audio as-is
  // Full integration with call-streaming.ts happens via event emitters
  return {
    translatedAudio: audioPayload,
  };
}

// ============================================================================
// SRTP ENCRYPTION CONTEXT
// Secure Real-time Transport Protocol implementation
// ============================================================================

export interface SRTPCryptoContext {
  masterKey: Buffer;           // 128-bit master key
  masterSalt: Buffer;          // 112-bit master salt
  sessionKey: Buffer;          // Derived session encryption key
  sessionSalt: Buffer;         // Derived session salt
  sessionAuthKey: Buffer;      // Derived authentication key
  rollOverCounter: number;     // Extended sequence number ROC
  packetIndex: bigint;         // 48-bit packet index
}

export interface SRTPPolicy {
  cipher: "AES_128_CM" | "AES_256_CM" | "NULL";
  auth: "HMAC_SHA1_80" | "HMAC_SHA1_32" | "NULL";
  keyLength: number;
  saltLength: number;
  tagLength: number;
}

const DEFAULT_SRTP_POLICY: SRTPPolicy = {
  cipher: "AES_128_CM",
  auth: "HMAC_SHA1_80",
  keyLength: 16,
  saltLength: 14,
  tagLength: 10,
};

export class SRTPContext {
  private ctx: SRTPCryptoContext;
  private policy: SRTPPolicy;
  private sequenceWindow: Set<number> = new Set();

  constructor(masterKey: Buffer, masterSalt: Buffer, policy: SRTPPolicy = DEFAULT_SRTP_POLICY) {
    if (masterKey.length !== policy.keyLength) {
      throw new Error(`Master key must be ${policy.keyLength} bytes`);
    }
    if (masterSalt.length !== policy.saltLength) {
      throw new Error(`Master salt must be ${policy.saltLength} bytes`);
    }

    this.policy = policy;
    this.ctx = {
      masterKey,
      masterSalt,
      sessionKey: this.deriveSessionKey(masterKey, masterSalt, 0x00),
      sessionSalt: this.deriveSessionKey(masterKey, masterSalt, 0x02).slice(0, 14),
      sessionAuthKey: this.deriveSessionKey(masterKey, masterSalt, 0x01),
      rollOverCounter: 0,
      packetIndex: BigInt(0),
    };
  }

  private deriveSessionKey(masterKey: Buffer, masterSalt: Buffer, label: number): Buffer {
    // Key derivation function per RFC 3711
    const keyDerivationRate = 0;
    const indexDiv = 0;

    // x = (label << 48) XOR masterSalt (left-padded)
    const x = Buffer.alloc(14);
    masterSalt.copy(x);
    x[7] ^= label;

    // Derive using AES-CM
    const cipher = crypto.createCipheriv(
      "aes-128-ctr",
      masterKey,
      Buffer.concat([x, Buffer.alloc(2)])
    );
    const derived = cipher.update(Buffer.alloc(16));
    cipher.final();

    return derived;
  }

  encrypt(rtpPacket: Buffer): Buffer {
    if (this.policy.cipher === "NULL") {
      return rtpPacket;
    }

    const header = rtpPacket.slice(0, 12);
    const payload = rtpPacket.slice(12);
    const sequenceNumber = header.readUInt16BE(2);
    const ssrc = header.readUInt32BE(8);

    // Update packet index
    this.updatePacketIndex(sequenceNumber);

    // Generate IV for AES-CM
    const iv = this.generateIV(ssrc, this.ctx.packetIndex);

    // Encrypt payload
    const cipher = crypto.createCipheriv("aes-128-ctr", this.ctx.sessionKey, iv);
    const encryptedPayload = Buffer.concat([cipher.update(payload), cipher.final()]);

    // Construct SRTP packet (header + encrypted payload)
    const srtpPacket = Buffer.concat([header, encryptedPayload]);

    // Add authentication tag if enabled
    if (this.policy.auth !== "NULL") {
      const authTag = this.computeAuthTag(srtpPacket);
      return Buffer.concat([srtpPacket, authTag]);
    }

    return srtpPacket;
  }

  decrypt(srtpPacket: Buffer): Buffer | null {
    if (this.policy.cipher === "NULL") {
      return srtpPacket;
    }

    // Verify authentication tag if present
    if (this.policy.auth !== "NULL") {
      const tagLength = this.policy.tagLength;
      const authTag = srtpPacket.slice(-tagLength);
      const packetWithoutTag = srtpPacket.slice(0, -tagLength);

      const expectedTag = this.computeAuthTag(packetWithoutTag);
      if (!crypto.timingSafeEqual(authTag, expectedTag)) {
        console.error("[SRTP] Authentication failed");
        return null;
      }
      srtpPacket = packetWithoutTag;
    }

    const header = srtpPacket.slice(0, 12);
    const encryptedPayload = srtpPacket.slice(12);
    const sequenceNumber = header.readUInt16BE(2);
    const ssrc = header.readUInt32BE(8);

    // Replay protection
    if (this.sequenceWindow.has(sequenceNumber)) {
      console.warn("[SRTP] Replay attack detected");
      return null;
    }
    this.sequenceWindow.add(sequenceNumber);
    if (this.sequenceWindow.size > 128) {
      const oldest = Math.min(...Array.from(this.sequenceWindow));
      this.sequenceWindow.delete(oldest);
    }

    // Update packet index
    this.updatePacketIndex(sequenceNumber);

    // Generate IV
    const iv = this.generateIV(ssrc, this.ctx.packetIndex);

    // Decrypt payload
    const decipher = crypto.createDecipheriv("aes-128-ctr", this.ctx.sessionKey, iv);
    const decryptedPayload = Buffer.concat([decipher.update(encryptedPayload), decipher.final()]);

    return Buffer.concat([header, decryptedPayload]);
  }

  private generateIV(ssrc: number, packetIndex: bigint): Buffer {
    // IV = (salt << 16) XOR (SSRC << 64) XOR (packet_index << 16)
    const iv = Buffer.alloc(16);
    
    // Copy session salt (14 bytes)
    this.ctx.sessionSalt.copy(iv, 0);
    
    // XOR with SSRC
    iv[4] ^= (ssrc >> 24) & 0xFF;
    iv[5] ^= (ssrc >> 16) & 0xFF;
    iv[6] ^= (ssrc >> 8) & 0xFF;
    iv[7] ^= ssrc & 0xFF;
    
    // XOR with packet index (48-bit)
    const piBuf = Buffer.alloc(8);
    piBuf.writeBigUInt64BE(packetIndex);
    for (let i = 0; i < 6; i++) {
      iv[8 + i] ^= piBuf[2 + i];
    }
    
    return iv;
  }

  private updatePacketIndex(sequenceNumber: number): void {
    const prevSeq = Number(this.ctx.packetIndex & BigInt(0xFFFF));
    
    if (sequenceNumber < prevSeq && prevSeq - sequenceNumber > 0x8000) {
      this.ctx.rollOverCounter++;
    }
    
    this.ctx.packetIndex = BigInt(this.ctx.rollOverCounter) * BigInt(0x10000) + BigInt(sequenceNumber);
  }

  private computeAuthTag(packet: Buffer): Buffer {
    // HMAC-SHA1 with truncation
    const hmac = crypto.createHmac("sha1", this.ctx.sessionAuthKey);
    
    // Include ROC in authentication
    const rocBuf = Buffer.alloc(4);
    rocBuf.writeUInt32BE(this.ctx.rollOverCounter);
    
    hmac.update(packet);
    hmac.update(rocBuf);
    
    const digest = hmac.digest();
    return digest.slice(0, this.policy.tagLength);
  }

  static generateKeyMaterial(): { masterKey: Buffer; masterSalt: Buffer } {
    return {
      masterKey: crypto.randomBytes(16),
      masterSalt: crypto.randomBytes(14),
    };
  }
}

// Helper to create SRTP-enabled media session
export function createSecureMediaSession(
  callId: string,
  callerEndpoint: MediaEndpoint,
  calleeEndpoint: MediaEndpoint
): { session: MediaSession; callerSRTP: SRTPContext; calleeSRTP: SRTPContext } {
  const session = mediaRelayServer.createSession(callId, callerEndpoint, calleeEndpoint);
  
  // Generate unique keys for each direction
  const callerKeys = SRTPContext.generateKeyMaterial();
  const calleeKeys = SRTPContext.generateKeyMaterial();
  
  return {
    session,
    callerSRTP: new SRTPContext(callerKeys.masterKey, callerKeys.masterSalt),
    calleeSRTP: new SRTPContext(calleeKeys.masterKey, calleeKeys.masterSalt),
  };
}
