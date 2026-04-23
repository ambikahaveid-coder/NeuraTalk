import { useRef, useCallback, useState, useEffect } from "react";

export type SignalingMessageType =
  | "register"
  | "unregister"
  | "call_initiate"
  | "call_offer"
  | "call_answer"
  | "call_ice"
  | "call_ringing"
  | "call_accept"
  | "call_reject"
  | "call_busy"
  | "call_end"
  | "call_hold"
  | "call_resume"
  | "call_mute"
  | "call_unmute"
  | "media_ready"
  | "error"
  | "heartbeat"
  | "ack"
  | "video_enable"
  | "video_disable"
  | "translation_subtitle"
  | "app_metadata";

export interface SignalingMessage {
  type: SignalingMessageType;
  callId?: string;
  sessionId?: string;
  from?: string;
  to?: string;
  payload?: Record<string, unknown>;
  timestamp: number;
}

export type ConnectionState = "disconnected" | "connecting" | "connected" | "error";

export interface UseSignalingOptions {
  userId?: number;
  phoneNumber?: string;
  onCallRinging?: (callId: string, from: string) => void;
  onCallOffer?: (callId: string, offer: RTCSessionDescriptionInit) => void;
  onCallAnswer?: (callId: string, answer: RTCSessionDescriptionInit) => void;
  onIceCandidate?: (callId: string, candidate: RTCIceCandidateInit) => void;
  onCallEnd?: (callId: string, reason?: string) => void;
  onTranslationSubtitle?: (data: { subtitle: string; language: string; emotion?: string }) => void;
  onError?: (error: string) => void;
}

const SIGNALING_URL = (() => {
  // In development: connect to backend on port 5000
  if (import.meta.env.DEV) {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    return `${protocol}//localhost:5000/ws/signaling`;
  }
  // In production: use the same host
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}/ws/signaling`;
})();
const HEARTBEAT_INTERVAL = 30000;
const RECONNECT_DELAY = 3000;

export function useSignaling(options: UseSignalingOptions = {}) {
  const wsRef = useRef<WebSocket | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const heartbeatRef = useRef<NodeJS.Timeout | null>(null);
  const reconnectRef = useRef<NodeJS.Timeout | null>(null);
  const intentionalDisconnectRef = useRef(false);
  const pendingOfferRef = useRef<RTCSessionDescriptionInit | null>(null);
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const [connectionState, setConnectionState] = useState<ConnectionState>("disconnected");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [currentCallId, setCurrentCallId] = useState<string | null>(null);

  const send = useCallback((message: Partial<SignalingMessage>) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ ...message, timestamp: Date.now() }));
    }
  }, []);

  const startHeartbeat = useCallback(() => {
    if (heartbeatRef.current) clearInterval(heartbeatRef.current);
    heartbeatRef.current = setInterval(() => {
      send({ type: "heartbeat" });
    }, HEARTBEAT_INTERVAL);
  }, [send]);

  const stopHeartbeat = useCallback(() => {
    if (heartbeatRef.current) {
      clearInterval(heartbeatRef.current);
      heartbeatRef.current = null;
    }
  }, []);

  const handleMessage = useCallback((event: MessageEvent) => {
    try {
      const message: SignalingMessage = JSON.parse(event.data);
      const opts = optionsRef.current;

      switch (message.type) {
        case "ack":
          if (message.sessionId) {
            sessionIdRef.current = message.sessionId;
            setSessionId(message.sessionId);
          }
          if (message.callId) {
            setCurrentCallId(message.callId);
            if (pendingOfferRef.current) {
              send({
                type: "call_offer",
                callId: message.callId,
                payload: { offer: pendingOfferRef.current },
              });
              pendingOfferRef.current = null;
            }
          }
          break;

        case "call_ringing":
          if (message.callId && message.from) {
            setCurrentCallId(message.callId);
            opts.onCallRinging?.(message.callId, message.from);
          }
          break;

        case "call_offer":
          if (message.callId && message.payload?.offer) {
            opts.onCallOffer?.(message.callId, message.payload.offer as RTCSessionDescriptionInit);
          }
          break;

        case "call_answer":
          if (message.callId && message.payload?.answer) {
            opts.onCallAnswer?.(message.callId, message.payload.answer as RTCSessionDescriptionInit);
          }
          break;

        case "call_ice":
          if (message.callId && message.payload?.candidate) {
            opts.onIceCandidate?.(message.callId, message.payload.candidate as RTCIceCandidateInit);
          }
          break;

        case "call_end":
          setCurrentCallId(null);
          opts.onCallEnd?.(message.callId || "", message.payload?.reason as string);
          break;

        case "translation_subtitle":
          if (message.payload) {
            opts.onTranslationSubtitle?.({
              subtitle: message.payload.subtitle as string,
              language: message.payload.language as string,
              emotion: message.payload.emotion as string | undefined,
            });
          }
          break;

        case "app_metadata":
          if (message.payload && (message.payload as any).type === "request_translation_setup") {
            // Auto-acknowledge translation parameters for B2B App-to-Web sync
            send({
              type: "app_metadata",
              callId: message.callId,
              payload: { type: "translation_setup_ack", status: "ready" }
            });
          }
          break;

        case "error":
          opts.onError?.(message.payload?.message as string || "Unknown error");
          break;
      }
    } catch (error) {
      console.error("[Signaling] Failed to parse message:", error);
    }
  }, []);

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    intentionalDisconnectRef.current = false;
    setConnectionState("connecting");
    console.log(`[Signaling] Connecting to ${SIGNALING_URL}`);
    const ws = new WebSocket(SIGNALING_URL);
    wsRef.current = ws;

    ws.onopen = () => {
      console.log("[Signaling] ✅ Connected to signaling server");
      setConnectionState("connected");
      send({
        type: "register",
        payload: {
          userId: optionsRef.current.userId,
          phoneNumber: optionsRef.current.phoneNumber,
          supportsWebRTC: true,
          supportsVideo: true,
          audioCodecs: ["opus"],
          videoCodecs: ["vp8", "vp9", "h264"],
        },
      });
      startHeartbeat();
    };

    ws.onmessage = handleMessage;

    ws.onerror = (event) => {
      console.error("[Signaling] ❌ WebSocket error:", event);
      setConnectionState("error");
      optionsRef.current.onError?.("Failed to connect to signaling server. Check if backend is running on port 5000.");
    };

    ws.onclose = (event) => {
      console.warn(`[Signaling] ⚠️ Disconnected (code: ${event.code}, reason: ${event.reason})`);
      setConnectionState("disconnected");
      stopHeartbeat();
      sessionIdRef.current = null;
      setSessionId(null);

      if (!intentionalDisconnectRef.current) {
        console.log(`[Signaling] Reconnecting in ${RECONNECT_DELAY}ms...`);
        reconnectRef.current = setTimeout(() => {
          connect();
        }, RECONNECT_DELAY);
      }
    };
  }, [send, startHeartbeat, stopHeartbeat, handleMessage]);

  const disconnect = useCallback(() => {
    intentionalDisconnectRef.current = true;
    if (reconnectRef.current) {
      clearTimeout(reconnectRef.current);
      reconnectRef.current = null;
    }
    stopHeartbeat();
    if (wsRef.current) {
      send({ type: "unregister" });
      wsRef.current.close();
      wsRef.current = null;
    }
    setConnectionState("disconnected");
    setSessionId(null);
    setCurrentCallId(null);
  }, [send, stopHeartbeat]);

  const initiateCall = useCallback((to: string, callType: "audio" | "video" = "video", metadata?: Record<string, unknown>) => {
    send({
      type: "call_initiate",
      to,
      payload: { callType, videoEnabled: callType === "video", metadata },
    });
  }, [send]);

  const acceptCall = useCallback((callId: string) => {
    send({ type: "call_accept", callId });
  }, [send]);

  const rejectCall = useCallback((callId: string) => {
    send({ type: "call_reject", callId });
  }, [send]);

  const sendOffer = useCallback((callId: string, offer: RTCSessionDescriptionInit) => {
    send({ type: "call_offer", callId, payload: { offer } });
  }, [send]);

  const sendAnswer = useCallback((callId: string, answer: RTCSessionDescriptionInit) => {
    send({ type: "call_answer", callId, payload: { answer } });
  }, [send]);

  const sendIceCandidate = useCallback((callId: string, candidate: RTCIceCandidateInit) => {
    send({ type: "call_ice", callId, payload: { candidate } });
  }, [send]);

  const endCall = useCallback((callId: string, reason?: string) => {
    send({ type: "call_end", callId, payload: { reason } });
    setCurrentCallId(null);
  }, [send]);

  const sendTranslationSubtitle = useCallback((callId: string, subtitle: string, language: string, emotion?: string) => {
    send({
      type: "translation_subtitle",
      callId,
      payload: { subtitle, language, emotion },
    });
  }, [send]);

  const setPendingOffer = useCallback((offer: RTCSessionDescriptionInit) => {
    pendingOfferRef.current = offer;
  }, []);

  useEffect(() => {
    return () => {
      disconnect();
    };
  }, [disconnect]);

  return {
    connectionState,
    sessionId,
    currentCallId,
    connect,
    disconnect,
    initiateCall,
    acceptCall,
    rejectCall,
    sendOffer,
    sendAnswer,
    sendIceCandidate,
    endCall,
    sendTranslationSubtitle,
    setPendingOffer,
  };
}
