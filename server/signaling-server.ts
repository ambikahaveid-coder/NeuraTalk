import { WebSocket, WebSocketServer } from "ws";
import { EventEmitter } from "events";
import jwt from "jsonwebtoken";
import { getICEServersConfigAsync } from "./turn-config";
import { logger } from "./observability";

export interface WsAuthClaims {
  userId: number;
  phoneNumber?: string;
  deviceId?: string;
}

export function verifyWsToken(token: string): WsAuthClaims | null {
  const secret = process.env.SESSION_SECRET;
  if (!secret) return null;
  try {
    const decoded = jwt.verify(token, secret, { algorithms: ["HS256"] }) as any;
    if (typeof decoded?.userId !== "number") return null;
    return {
      userId: decoded.userId,
      phoneNumber: typeof decoded.phoneNumber === "string" ? decoded.phoneNumber : undefined,
      deviceId: typeof decoded.deviceId === "string" ? decoded.deviceId : undefined,
    };
  } catch {
    return null;
  }
}

export function issueWsToken(claims: WsAuthClaims, ttlSeconds = 300): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET required to issue WS tokens");
  return jwt.sign(claims, secret, { algorithm: "HS256", expiresIn: ttlSeconds });
}

const wsAuthMap = new WeakMap<WebSocket, WsAuthClaims>();

// ============================================================================
// ⚠️ DEPRECATED — replaced by server/livekit-service.ts + smart-call-router.ts
// ============================================================================
// This file ships partial WebRTC signaling + an unimplemented media relay.
// New call flow uses LiveKit (production-grade WebRTC SFU) instead.
// Do NOT add features here. Migrate dependents:
//   - server/call-gateway.ts
//   - server/admin-monitor.ts
//   - server/index.ts
// to use smart-call-router.initiateCall() / livekit-service helpers.
// ============================================================================
//
// WHY WE BUILT THIS (not copied from WebRTC/Twilio/SIP patterns):
// 
// 1. FULL LIFECYCLE CONTROL
//    - We must understand and control every step of a call lifecycle
//    - Third-party signaling hides critical decision points where we need
//      to inject emotion detection, consent verification, and translation
//    - Our call states (INIT → RINGING → CONNECTED → HOLD → END) are designed
//      for our specific use case, not generic telephony
//
// 2. TELCO BOUNDARY COMPLIANCE
//    - We are NOT a telecom carrier - we are a communication enhancement layer
//    - This signaling coordinates AI processing, not call termination
//    - We work ON TOP OF existing phone calls, not replacing them
//
// 3. ASSISTIVE SERVICE POSITIONING
//    - User still uses their native phone dialer
//    - We intercept audio streams for processing, not call control
//    - This design keeps us as an assistive overlay, not a dialer replacement
//
// 4. AUDITABILITY
//    - Every message type is documented with its purpose
//    - No black-box SDK behavior - we wrote every line
//    - An investor or regulator can trace any call flow through this code
//
// ARCHITECTURE DECISIONS:
// - WebSocket chosen over SIP for simplicity and web compatibility
// - Custom message types instead of SIP methods for clarity
// - In-memory session storage for low latency (Redis for production scale)
// - Heartbeat monitoring to detect connection issues before audio drops
//
// WHAT THIS IS NOT:
// - This is NOT a VoIP system that assigns phone numbers
// - This is NOT a call termination service
// - This does NOT replace the OS telephony stack
//
// ============================================================================

// ============================================================================
// SIGNALING PROTOCOL SPECIFICATION
// ============================================================================
//
// Message Flow for Standard Call:
// 
// 1. REGISTRATION PHASE
//    Client A → Server: { type: "register", capabilities: {...} }
//    Server → Client A: { type: "ack", sessionId: "..." }
//
// 2. CALL INITIATION
//    Client A → Server: { type: "call_initiate", to: "B", metadata: {...} }
//    Server → Client B: { type: "call_ringing", from: "A", callId: "..." }
//
// 3. CALL ACCEPTANCE
//    Client B → Server: { type: "call_accept", callId: "..." }
//    Server → Client A: { type: "call_accept", callId: "..." }
//
// 4. MEDIA NEGOTIATION (WebRTC flow)
//    Client A → Server: { type: "call_offer", sdp: "..." }
//    Server → Client B: { type: "call_offer", sdp: "..." }
//    Client B → Server: { type: "call_answer", sdp: "..." }
//    Server → Client A: { type: "call_answer", sdp: "..." }
//    Both ↔ Server: { type: "call_ice", candidate: "..." }
//
// 5. ACTIVE CALL
//    Either → Server: { type: "call_hold" | "call_resume" | "call_mute" }
//
// 6. CALL TERMINATION
//    Either → Server: { type: "call_end", reason: "..." }
//    Server → Both: { type: "call_end", reason: "..." }
//
// ============================================================================

export interface SignalingMessage {
  type: SignalingMessageType;
  callId?: string;
  sessionId?: string;
  from?: string;
  to?: string;
  payload?: Record<string, unknown>;
  timestamp: number;
}

export type SignalingMessageType =
  | "register"           // Client registers with signaling server
  | "unregister"         // Client disconnects
  | "call_initiate"      // Caller initiates call
  | "call_offer"         // SDP offer (WebRTC)
  | "call_answer"        // SDP answer (WebRTC)
  | "call_ice"           // ICE candidate exchange
  | "call_ringing"       // Call is ringing
  | "call_accept"        // Callee accepts call
  | "call_reject"        // Callee rejects call
  | "call_busy"          // Callee is busy
  | "call_end"           // Either party ends call
  | "call_hold"          // Put call on hold
  | "call_resume"        // Resume call from hold
  | "call_mute"          // Mute audio
  | "call_unmute"        // Unmute audio
  | "media_ready"        // Media stream ready
  | "error"              // Error message
  | "heartbeat"          // Keep-alive ping
  | "ack"                // Acknowledgment
  | "video_enable"       // Enable video stream
  | "video_disable"      // Disable video stream
  | "screen_share_start" // Start screen sharing
  | "screen_share_stop"  // Stop screen sharing
  | "external_handoff"   // Handoff to external platform (Teams/Zoom/WhatsApp)
  | "translation_subtitle" // Real-time translation subtitle
  | "app_metadata";        // App-specific metadata (B2B sync)

export interface RegisteredClient {
  sessionId: string;
  userId?: number;
  phoneNumber?: string;
  deviceId?: string;
  capabilities: ClientCapabilities;
  ws: WebSocket;
  registeredAt: number;
  lastHeartbeat: number;
  activeCallId?: string;
}

export interface ClientCapabilities {
  supportsWebRTC: boolean;
  supportsSIP: boolean;
  supportsNativeTelephony: boolean;
  supportsVideo: boolean;
  audioCodecs: string[];
  videoCodecs: string[];
  maxBitrate?: number;
  screenShareSupported?: boolean;
}

// External platform handoff configuration
export interface ExternalPlatformHandoff {
  platform: "teams" | "zoom" | "whatsapp" | "google_meet";
  meetingUrl?: string;
  phoneNumber?: string;
  deepLinkUrl?: string;
  joinCode?: string;
}

export type SignalingCallType = "audio" | "video" | "screen_share";

export interface CallSession {
  callId: string;
  callerId: string;
  calleeId: string;
  callerSessionId: string;
  calleeSessionId?: string;
  status: CallSessionStatus;
  callType: SignalingCallType;
  offer?: RTCSessionDescriptionInit;
  answer?: RTCSessionDescriptionInit;
  iceCandidates: RTCIceCandidateInit[];
  startedAt: number;
  connectedAt?: number;
  endedAt?: number;
  metadata: Record<string, unknown>;
  externalHandoff?: ExternalPlatformHandoff;
  videoEnabled: boolean;
  screenShareActive: boolean;
}

export type CallSessionStatus =
  | "initiating"
  | "ringing"
  | "connecting"
  | "active"
  | "on_hold"
  | "ended"
  | "failed";

export type RTCSessionDescriptionInit = {
  type: "offer" | "answer";
  sdp: string;
};

export type RTCIceCandidateInit = {
  candidate: string;
  sdpMid?: string;
  sdpMLineIndex?: number;
};

// ============================================================================
// SIGNALING SERVER IMPLEMENTATION
// ============================================================================

export class SignalingServer extends EventEmitter {
  private wss: WebSocketServer | null = null;
  private clients = new Map<string, RegisteredClient>();
  private phoneToSession = new Map<string, string>();
  private userToSession = new Map<number, string>();
  private callSessions = new Map<string, CallSession>();
  private heartbeatInterval: NodeJS.Timeout | null = null;

  private static instance: SignalingServer | null = null;

  static getInstance(): SignalingServer {
    if (!SignalingServer.instance) {
      SignalingServer.instance = new SignalingServer();
    }
    return SignalingServer.instance;
  }

  start(port: number): void {
    if (this.wss) {
      console.log("[Signaling] Server already running");
      return;
    }

    this.wss = new WebSocketServer({ port });
    console.log(`[Signaling] WebSocket server running on port ${port}`);

    this.setupConnectionHandler();
  }

  attachToServer(server: import("http").Server, path: string = "/signaling"): void {
    if (this.wss) {
      console.log("[Signaling] Server already running");
      return;
    }

    this.wss = new WebSocketServer({ noServer: true });

    server.on("upgrade", (request, socket, head) => {
      const url = new URL(request.url || "", `http://${request.headers.host}`);

      if (url.pathname !== path) return;

      const token = url.searchParams.get("token");
      if (!token) {
        socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
        socket.destroy();
        return;
      }

      const claims = verifyWsToken(token);
      if (!claims) {
        socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
        socket.destroy();
        return;
      }

      this.wss!.handleUpgrade(request, socket, head, (ws) => {
        wsAuthMap.set(ws, claims);
        this.wss!.emit("connection", ws, request);
      });
    });

    console.log(`[Signaling] WebSocket server attached to path ${path}`);
    this.setupConnectionHandler();
  }

  private setupConnectionHandler(): void {
    if (!this.wss) return;

    this.wss.on("connection", (ws: WebSocket) => {
      const sessionId = this.generateSessionId();
      console.log(`[Signaling] New connection: ${sessionId}`);

      ws.on("message", (data: Buffer) => {
        try {
          const message = JSON.parse(data.toString()) as SignalingMessage;
          this.handleMessage(sessionId, ws, message);
        } catch (error) {
          console.error("[Signaling] Invalid message:", error);
          this.sendError(ws, "Invalid message format");
        }
      });

      ws.on("close", () => {
        this.handleDisconnect(sessionId);
      });

      ws.on("error", (error) => {
        console.error(`[Signaling] WebSocket error for ${sessionId}:`, error);
      });
    });

    this.startHeartbeatMonitor();
  }

  isRunning(): boolean {
    return this.wss !== null;
  }

  stop(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
    if (this.wss) {
      this.wss.close();
      this.wss = null;
    }
    this.clients.clear();
    this.callSessions.clear();
    console.log("[Signaling] Server stopped");
  }

  private generateSessionId(): string {
    return `sess_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
  }

  private generateCallId(): string {
    return `call_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
  }

  private handleMessage(sessionId: string, ws: WebSocket, message: SignalingMessage): void {
    switch (message.type) {
      case "register":
        this.handleRegister(sessionId, ws, message);
        break;
      case "unregister":
        this.handleDisconnect(sessionId);
        break;
      case "call_initiate":
        this.handleCallInitiate(sessionId, message);
        break;
      case "call_offer":
        this.handleCallOffer(sessionId, message);
        break;
      case "call_answer":
        this.handleCallAnswer(sessionId, message);
        break;
      case "call_ice":
        this.handleIceCandidate(sessionId, message);
        break;
      case "call_accept":
        this.handleCallAccept(sessionId, message);
        break;
      case "call_reject":
        this.handleCallReject(sessionId, message);
        break;
      case "call_end":
        this.handleCallEnd(sessionId, message);
        break;
      case "call_hold":
        this.handleCallHold(sessionId, message);
        break;
      case "call_resume":
        this.handleCallResume(sessionId, message);
        break;
      case "heartbeat":
        this.handleHeartbeat(sessionId);
        break;
      case "video_enable":
        this.handleVideoEnable(sessionId, message);
        break;
      case "video_disable":
        this.handleVideoDisable(sessionId, message);
        break;
      case "screen_share_start":
        this.handleScreenShareStart(sessionId, message);
        break;
      case "screen_share_stop":
        this.handleScreenShareStop(sessionId, message);
        break;
      case "external_handoff":
        this.handleExternalHandoff(sessionId, message);
        break;
      case "translation_subtitle":
        this.handleTranslationSubtitle(sessionId, message);
        break;
      case "app_metadata":
        this.handleAppMetadata(sessionId, message);
        break;
      default:
        console.warn(`[Signaling] Unknown message type: ${message.type}`);
    }
  }

  private handleAppMetadata(sessionId: string, message: SignalingMessage): void {
    const callId = message.callId;
    if (!callId) return;

    const call = this.callSessions.get(callId);
    if (!call) return;

    const otherSessionId = sessionId === call.callerSessionId 
      ? call.calleeSessionId 
      : call.callerSessionId;

    if (otherSessionId) {
      const other = this.clients.get(otherSessionId);
      if (other) {
        this.send(other.ws, {
          type: "app_metadata",
          callId,
          from: sessionId,
          payload: message.payload,
          timestamp: Date.now(),
        });
      }
    }
  }

  private handleRegister(sessionId: string, ws: WebSocket, message: SignalingMessage): void {
    const payload = message.payload || {};
    const claims = wsAuthMap.get(ws);

    if (!claims) {
      this.sendError(ws, "Unauthenticated connection");
      try { ws.close(1008, "unauthenticated"); } catch {}
      return;
    }

    const client: RegisteredClient = {
      sessionId,
      userId: claims.userId,
      phoneNumber: claims.phoneNumber ?? (payload.phoneNumber as string | undefined),
      deviceId: claims.deviceId ?? (payload.deviceId as string | undefined),
      capabilities: {
        supportsWebRTC: (payload.supportsWebRTC as boolean) ?? true,
        supportsSIP: (payload.supportsSIP as boolean) ?? false,
        supportsNativeTelephony: (payload.supportsNativeTelephony as boolean) ?? false,
        supportsVideo: (payload.supportsVideo as boolean) ?? true,
        audioCodecs: (payload.audioCodecs as string[]) ?? ["opus", "pcmu", "pcma"],
        videoCodecs: (payload.videoCodecs as string[]) ?? ["vp8", "vp9", "h264"],
        screenShareSupported: (payload.screenShareSupported as boolean) ?? true,
      },
      ws,
      registeredAt: Date.now(),
      lastHeartbeat: Date.now(),
    };

    this.clients.set(sessionId, client);

    if (client.phoneNumber) {
      this.phoneToSession.set(client.phoneNumber, sessionId);
    }
    if (client.userId) {
      this.userToSession.set(client.userId, sessionId);
    }

    // Provide ICE servers to the client during registration
    getICEServersConfigAsync().then(rtcConfig => {
      this.send(ws, {
        type: "ack",
        sessionId,
        payload: { 
          registered: true,
          rtcConfig, 
        },
        timestamp: Date.now(),
      });
    });

    this.emit("client_registered", client);
    console.log(`[Signaling] Client registered: ${sessionId}, phone: ${client.phoneNumber}`);
  }

  private handleDisconnect(sessionId: string): void {
    const client = this.clients.get(sessionId);
    if (!client) return;

    if (client.activeCallId) {
      const call = this.callSessions.get(client.activeCallId);
      if (call && call.status !== "ended") {
        this.endCall(client.activeCallId, "disconnect");
      }
    }

    if (client.phoneNumber) {
      this.phoneToSession.delete(client.phoneNumber);
    }
    if (client.userId) {
      this.userToSession.delete(client.userId);
    }
    this.clients.delete(sessionId);

    this.emit("client_disconnected", { sessionId });
    console.log(`[Signaling] Client disconnected: ${sessionId}`);
  }

  private handleCallInitiate(callerSessionId: string, message: SignalingMessage): void {
    const caller = this.clients.get(callerSessionId);
    if (!caller) {
      return this.sendErrorToSession(callerSessionId, "Not registered");
    }

    const targetPhone = message.to;
    const targetUserId = message.payload?.targetUserId as number | undefined;
    const callType = (message.payload?.callType as SignalingCallType) || "audio";
    const videoEnabled = callType === "video" || (message.payload?.videoEnabled as boolean) || false;

    let calleeSessionId: string | undefined;
    if (targetPhone) {
      calleeSessionId = this.phoneToSession.get(targetPhone);
    } else if (targetUserId) {
      calleeSessionId = this.userToSession.get(targetUserId);
    }

    const callId = this.generateCallId();
    const call: CallSession = {
      callId,
      callerId: caller.phoneNumber || callerSessionId,
      calleeId: targetPhone || String(targetUserId) || "unknown",
      callerSessionId,
      calleeSessionId,
      status: calleeSessionId ? "ringing" : "initiating",
      callType,
      iceCandidates: [],
      startedAt: Date.now(),
      metadata: (message.payload?.metadata as Record<string, unknown>) || {},
      videoEnabled,
      screenShareActive: false,
    };

    this.callSessions.set(callId, call);
    caller.activeCallId = callId;

    getICEServersConfigAsync().then(rtcConfig => {
      this.send(caller.ws, {
        type: "ack",
        callId,
        payload: { 
          status: call.status,
          calleeOnline: !!calleeSessionId,
          rtcConfig,
        },
        timestamp: Date.now(),
      });
    });

    if (calleeSessionId) {
      const callee = this.clients.get(calleeSessionId);
      if (callee) {
        callee.activeCallId = callId;
        getICEServersConfigAsync().then(rtcConfig => {
          this.send(callee.ws, {
            type: "call_ringing",
            callId,
            from: caller.phoneNumber || callerSessionId,
            payload: {
              callerId: caller.userId,
              callerPhone: caller.phoneNumber,
              rtcConfig,
            },
            timestamp: Date.now(),
          });
        });
      }
    }

    this.emit("call_initiated", call);
    console.log(`[Signaling] Call initiated: ${callId} from ${callerSessionId}`);
  }

  private handleCallOffer(sessionId: string, message: SignalingMessage): void {
    const callId = message.callId;
    if (!callId) return;

    const call = this.callSessions.get(callId);
    if (!call || call.callerSessionId !== sessionId) {
      return this.sendErrorToSession(sessionId, "Invalid call");
    }

    call.offer = message.payload?.offer as RTCSessionDescriptionInit;

    if (call.calleeSessionId) {
      const callee = this.clients.get(call.calleeSessionId);
      if (callee) {
        this.send(callee.ws, {
          type: "call_offer",
          callId,
          payload: { offer: call.offer },
          timestamp: Date.now(),
        });
      }
    }
  }

  private handleCallAnswer(sessionId: string, message: SignalingMessage): void {
    const callId = message.callId;
    if (!callId) return;

    const call = this.callSessions.get(callId);
    if (!call || call.calleeSessionId !== sessionId) {
      return this.sendErrorToSession(sessionId, "Invalid call");
    }

    call.answer = message.payload?.answer as RTCSessionDescriptionInit;
    call.status = "connecting";

    const caller = this.clients.get(call.callerSessionId);
    if (caller) {
      this.send(caller.ws, {
        type: "call_answer",
        callId,
        payload: { answer: call.answer },
        timestamp: Date.now(),
      });
    }
  }

  private handleIceCandidate(sessionId: string, message: SignalingMessage): void {
    const callId = message.callId;
    if (!callId) return;

    const call = this.callSessions.get(callId);
    if (!call) return;

    const candidate = message.payload?.candidate as RTCIceCandidateInit;
    if (!candidate) return;

    call.iceCandidates.push(candidate);

    const targetSessionId = sessionId === call.callerSessionId 
      ? call.calleeSessionId 
      : call.callerSessionId;

    if (targetSessionId) {
      const target = this.clients.get(targetSessionId);
      if (target) {
        this.send(target.ws, {
          type: "call_ice",
          callId,
          payload: { candidate },
          timestamp: Date.now(),
        });
      }
    }
  }

  private handleCallAccept(sessionId: string, message: SignalingMessage): void {
    const callId = message.callId;
    if (!callId) return;

    const call = this.callSessions.get(callId);
    if (!call || call.calleeSessionId !== sessionId) {
      return this.sendErrorToSession(sessionId, "Invalid call");
    }

    call.status = "active";
    call.connectedAt = Date.now();

    const caller = this.clients.get(call.callerSessionId);
    if (caller) {
      this.send(caller.ws, {
        type: "call_accept",
        callId,
        timestamp: Date.now(),
      });
    }

    this.emit("call_connected", call);
    console.log(`[Signaling] Call connected: ${callId}`);
  }

  private handleCallReject(sessionId: string, message: SignalingMessage): void {
    const callId = message.callId;
    if (!callId) return;

    const call = this.callSessions.get(callId);
    if (!call) return;

    const reason = (message.payload?.reason as string) || "rejected";
    this.endCall(callId, reason);
  }

  private handleCallEnd(sessionId: string, message: SignalingMessage): void {
    const callId = message.callId;
    if (!callId) return;

    this.endCall(callId, "ended");
  }

  private handleCallHold(sessionId: string, message: SignalingMessage): void {
    const callId = message.callId;
    if (!callId) return;

    const call = this.callSessions.get(callId);
    if (!call || call.status !== "active") return;

    call.status = "on_hold";

    const otherSessionId = sessionId === call.callerSessionId 
      ? call.calleeSessionId 
      : call.callerSessionId;

    if (otherSessionId) {
      const other = this.clients.get(otherSessionId);
      if (other) {
        this.send(other.ws, {
          type: "call_hold",
          callId,
          timestamp: Date.now(),
        });
      }
    }
  }

  private handleCallResume(sessionId: string, message: SignalingMessage): void {
    const callId = message.callId;
    if (!callId) return;

    const call = this.callSessions.get(callId);
    if (!call || call.status !== "on_hold") return;

    call.status = "active";

    const otherSessionId = sessionId === call.callerSessionId 
      ? call.calleeSessionId 
      : call.callerSessionId;

    if (otherSessionId) {
      const other = this.clients.get(otherSessionId);
      if (other) {
        this.send(other.ws, {
          type: "call_resume",
          callId,
          timestamp: Date.now(),
        });
      }
    }
  }

  private handleHeartbeat(sessionId: string): void {
    const client = this.clients.get(sessionId);
    if (client) {
      client.lastHeartbeat = Date.now();
    }
  }

  // ============================================================================
  // VIDEO & SCREEN SHARE HANDLERS
  // ============================================================================

  private handleVideoEnable(sessionId: string, message: SignalingMessage): void {
    const callId = message.callId;
    if (!callId) return;

    const call = this.callSessions.get(callId);
    if (!call || call.status !== "active") return;

    call.videoEnabled = true;
    if (call.callType === "audio") {
      call.callType = "video";
    }

    const otherSessionId = sessionId === call.callerSessionId 
      ? call.calleeSessionId 
      : call.callerSessionId;

    if (otherSessionId) {
      const other = this.clients.get(otherSessionId);
      if (other) {
        this.send(other.ws, {
          type: "video_enable",
          callId,
          from: sessionId,
          timestamp: Date.now(),
        });
      }
    }

    this.emit("video_enabled", { callId, sessionId });
    console.log(`[Signaling] Video enabled for call ${callId} by ${sessionId}`);
  }

  private handleVideoDisable(sessionId: string, message: SignalingMessage): void {
    const callId = message.callId;
    if (!callId) return;

    const call = this.callSessions.get(callId);
    if (!call) return;

    call.videoEnabled = false;
    call.callType = "audio";

    const otherSessionId = sessionId === call.callerSessionId 
      ? call.calleeSessionId 
      : call.callerSessionId;

    if (otherSessionId) {
      const other = this.clients.get(otherSessionId);
      if (other) {
        this.send(other.ws, {
          type: "video_disable",
          callId,
          from: sessionId,
          timestamp: Date.now(),
        });
      }
    }

    this.emit("video_disabled", { callId, sessionId });
    console.log(`[Signaling] Video disabled for call ${callId} by ${sessionId}`);
  }

  private handleScreenShareStart(sessionId: string, message: SignalingMessage): void {
    const callId = message.callId;
    if (!callId) return;

    const call = this.callSessions.get(callId);
    if (!call || call.status !== "active") return;

    call.screenShareActive = true;
    call.callType = "screen_share";

    const otherSessionId = sessionId === call.callerSessionId 
      ? call.calleeSessionId 
      : call.callerSessionId;

    if (otherSessionId) {
      const other = this.clients.get(otherSessionId);
      if (other) {
        this.send(other.ws, {
          type: "screen_share_start",
          callId,
          from: sessionId,
          timestamp: Date.now(),
        });
      }
    }

    this.emit("screen_share_started", { callId, sessionId });
    console.log(`[Signaling] Screen share started for call ${callId} by ${sessionId}`);
  }

  private handleScreenShareStop(sessionId: string, message: SignalingMessage): void {
    const callId = message.callId;
    if (!callId) return;

    const call = this.callSessions.get(callId);
    if (!call) return;

    call.screenShareActive = false;
    call.callType = call.videoEnabled ? "video" : "audio";

    const otherSessionId = sessionId === call.callerSessionId 
      ? call.calleeSessionId 
      : call.callerSessionId;

    if (otherSessionId) {
      const other = this.clients.get(otherSessionId);
      if (other) {
        this.send(other.ws, {
          type: "screen_share_stop",
          callId,
          from: sessionId,
          timestamp: Date.now(),
        });
      }
    }

    this.emit("screen_share_stopped", { callId, sessionId });
    console.log(`[Signaling] Screen share stopped for call ${callId} by ${sessionId}`);
  }

  // ============================================================================
  // EXTERNAL PLATFORM HANDOFF HANDLERS
  // ============================================================================
  //
  // These handlers generate deep links for handoff to external platforms.
  // We do NOT integrate with their APIs - we simply generate standard URLs
  // that the user's device can open natively.
  //
  // Supported platforms:
  // - Teams: Uses teams.microsoft.com deep links
  // - Zoom: Uses zoom.us/join links
  // - WhatsApp: Uses wa.me phone links
  // - Google Meet: Uses meet.google.com links
  //
  // This follows our Dependency Zero Policy - no third-party SDKs or APIs.
  // ============================================================================

  // Validate URL for safe deep link schemes
  private isValidDeepLinkUrl(url: string): boolean {
    try {
      const parsed = new URL(url);
      // Only allow https and safe platform domains
      const allowedDomains = [
        "teams.microsoft.com",
        "zoom.us",
        "wa.me",
        "whatsapp.com",
        "meet.google.com",
      ];
      return parsed.protocol === "https:" && 
        allowedDomains.some(domain => parsed.hostname.endsWith(domain));
    } catch {
      return false;
    }
  }

  private handleExternalHandoff(sessionId: string, message: SignalingMessage): void {
    const callId = message.callId;
    
    // Allow handoffs even without active call (standalone handoff feature)
    const call = callId ? this.callSessions.get(callId) : undefined;

    const platform = message.payload?.platform as ExternalPlatformHandoff["platform"];
    const phoneNumber = message.payload?.phoneNumber as string | undefined;
    const meetingUrl = message.payload?.meetingUrl as string | undefined;
    const joinCode = message.payload?.joinCode as string | undefined;

    if (!platform) {
      return this.sendErrorToSession(sessionId, "Platform required for external handoff");
    }

    // Generate deep link based on platform
    let deepLinkUrl: string;
    switch (platform) {
      case "teams":
        if (meetingUrl) {
          deepLinkUrl = meetingUrl;
        } else if (joinCode) {
          deepLinkUrl = `https://teams.microsoft.com/l/meetup-join/${encodeURIComponent(joinCode)}`;
        } else {
          deepLinkUrl = "https://teams.microsoft.com/l/call/0/0";
        }
        break;
      case "zoom":
        if (meetingUrl) {
          deepLinkUrl = meetingUrl;
        } else if (joinCode) {
          deepLinkUrl = `https://zoom.us/j/${encodeURIComponent(joinCode)}`;
        } else {
          deepLinkUrl = "https://zoom.us/join";
        }
        break;
      case "whatsapp":
        if (phoneNumber) {
          // Clean phone number for WhatsApp (only allow digits)
          const cleanPhone = phoneNumber.replace(/[^0-9]/g, "");
          deepLinkUrl = `https://wa.me/${cleanPhone}`;
        } else {
          deepLinkUrl = "https://wa.me/";
        }
        break;
      case "google_meet":
        if (meetingUrl) {
          deepLinkUrl = meetingUrl;
        } else if (joinCode) {
          deepLinkUrl = `https://meet.google.com/${encodeURIComponent(joinCode)}`;
        } else {
          deepLinkUrl = "https://meet.google.com/new";
        }
        break;
      default:
        return this.sendErrorToSession(sessionId, `Unknown platform: ${platform}`);
    }

    // Validate user-provided URLs for security
    if (meetingUrl && !this.isValidDeepLinkUrl(deepLinkUrl)) {
      return this.sendErrorToSession(sessionId, "Invalid meeting URL - only official platform URLs allowed");
    }

    // Store handoff info in call session if there is an active call
    if (call) {
      call.externalHandoff = {
        platform,
        meetingUrl,
        phoneNumber,
        deepLinkUrl,
        joinCode,
      };
    }

    // Notify both parties about the handoff
    const client = this.clients.get(sessionId);
    if (client) {
      this.send(client.ws, {
        type: "external_handoff",
        callId,
        payload: {
          platform,
          deepLinkUrl,
          message: `Opening ${platform} call...`,
        },
        timestamp: Date.now(),
      });
    }

    // Only notify other party if in an active call
    if (call) {
      const otherSessionId = sessionId === call.callerSessionId 
        ? call.calleeSessionId 
        : call.callerSessionId;

      if (otherSessionId) {
        const other = this.clients.get(otherSessionId);
        if (other) {
          this.send(other.ws, {
            type: "external_handoff",
            callId,
            payload: {
              platform,
              deepLinkUrl,
              message: `${platform} call initiated by other party`,
            },
            timestamp: Date.now(),
          });
        }
      }
    }

    this.emit("external_handoff", { callId, platform, deepLinkUrl });
    console.log(`[Signaling] External handoff to ${platform}${callId ? ` for call ${callId}` : ''}`);
  }

  // ============================================================================
  // TRANSLATION SUBTITLE HANDLER
  // ============================================================================

  private handleTranslationSubtitle(sessionId: string, message: SignalingMessage): void {
    const callId = message.callId;
    if (!callId) {
      console.log("[Signaling] Translation subtitle received without callId");
      return;
    }

    const call = this.callSessions.get(callId);
    if (!call || call.status !== "active") {
      console.log(`[Signaling] Translation subtitle for inactive/missing call: ${callId}`);
      return;
    }

    const subtitle = message.payload?.subtitle as string;
    const language = message.payload?.language as string;
    const emotion = message.payload?.emotion as string;

    if (!subtitle) {
      return; // No subtitle to forward
    }

    // Determine the other party in the call
    const otherSessionId = sessionId === call.callerSessionId 
      ? call.calleeSessionId 
      : call.callerSessionId;

    if (!otherSessionId) {
      console.log(`[Signaling] No peer connected to forward subtitle for call ${callId}`);
      return;
    }

    const other = this.clients.get(otherSessionId);
    if (!other) {
      console.log(`[Signaling] Peer ${otherSessionId} not found for subtitle forwarding`);
      return;
    }

    // Forward subtitle to the other party
    this.send(other.ws, {
      type: "translation_subtitle",
      callId,
      from: sessionId,
      payload: {
        subtitle,
        language,
        emotion,
        timestamp: Date.now(),
      },
      timestamp: Date.now(),
    });

    // Emit event for any listeners (e.g., for logging/analytics)
    this.emit("translation_subtitle", { callId, sessionId, subtitle, language, emotion });
  }

  private endCall(callId: string, reason: string): void {
    const call = this.callSessions.get(callId);
    if (!call || call.status === "ended") return;

    call.status = "ended";
    call.endedAt = Date.now();

    const caller = this.clients.get(call.callerSessionId);
    if (caller) {
      caller.activeCallId = undefined;
      this.send(caller.ws, {
        type: "call_end",
        callId,
        payload: { reason },
        timestamp: Date.now(),
      });
    }

    if (call.calleeSessionId) {
      const callee = this.clients.get(call.calleeSessionId);
      if (callee) {
        callee.activeCallId = undefined;
        this.send(callee.ws, {
          type: "call_end",
          callId,
          payload: { reason },
          timestamp: Date.now(),
        });
      }
    }

    this.emit("call_ended", { callId, reason, duration: call.endedAt - call.startedAt });
    console.log(`[Signaling] Call ended: ${callId}, reason: ${reason}`);
  }

  private startHeartbeatMonitor(): void {
    const HEARTBEAT_TIMEOUT = 30000;
    
    this.heartbeatInterval = setInterval(() => {
      const now = Date.now();
      const entries = Array.from(this.clients.entries());
      for (const [sessionId, client] of entries) {
        if (now - client.lastHeartbeat > HEARTBEAT_TIMEOUT) {
          console.log(`[Signaling] Heartbeat timeout for ${sessionId}`);
          this.handleDisconnect(sessionId);
        }
      }
    }, 10000);
  }

  private send(ws: WebSocket, message: SignalingMessage): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
    }
  }

  private sendError(ws: WebSocket, error: string): void {
    this.send(ws, {
      type: "error",
      payload: { error },
      timestamp: Date.now(),
    });
  }

  private sendErrorToSession(sessionId: string, error: string): void {
    const client = this.clients.get(sessionId);
    if (client) {
      this.sendError(client.ws, error);
    }
  }

  getRegisteredClients(): RegisteredClient[] {
    return Array.from(this.clients.values());
  }

  getActiveCalls(): CallSession[] {
    return Array.from(this.callSessions.values())
      .filter(call => call.status !== "ended");
  }

  getCallSession(callId: string): CallSession | undefined {
    return this.callSessions.get(callId);
  }

  getClientByPhone(phoneNumber: string): RegisteredClient | undefined {
    const sessionId = this.phoneToSession.get(phoneNumber);
    return sessionId ? this.clients.get(sessionId) : undefined;
  }

  getClientByUserId(userId: number): RegisteredClient | undefined {
    const sessionId = this.userToSession.get(userId);
    return sessionId ? this.clients.get(sessionId) : undefined;
  }

  getStats(): {
    connectedClients: number;
    activeCalls: number;
    totalCallsHandled: number;
  } {
    return {
      connectedClients: this.clients.size,
      activeCalls: this.getActiveCalls().length,
      totalCallsHandled: this.callSessions.size,
    };
  }
}

export const signalingServer = SignalingServer.getInstance();
