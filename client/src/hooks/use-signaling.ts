import { useRef, useCallback, useState, useEffect } from "react";
import {
  SIGNALING_MESSAGE,
  normalizeSignalingMessage,
  type SignalingMessage,
} from "@shared/signaling-protocol";
import { getAuthToken } from "./use-auth";

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
  const explicitUrl = import.meta.env.VITE_SIGNALING_URL?.trim();
  if (explicitUrl) {
    return explicitUrl.replace(/\/+$/, "");
  }

  if (import.meta.env.DEV) {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    return `${protocol}//localhost:5000/ws/signaling`;
  }

  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}/ws/signaling`;
})();

const HEARTBEAT_INTERVAL = 30000;
const RECONNECT_DELAY = 3000;

async function fetchSignalingToken(): Promise<string> {
  const authToken = getAuthToken();
  if (!authToken) {
    throw new Error("Authentication required before opening signaling connection");
  }

  const response = await fetch("/api/auth/ws-token", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${authToken}`,
    },
    body: "{}",
  });

  if (!response.ok) {
    throw new Error(`Failed to mint signaling token (${response.status})`);
  }

  const payload = await response.json() as { token?: string };
  if (!payload.token) {
    throw new Error("Signaling token missing in server response");
  }

  return payload.token;
}

// Legacy signaling transport used only by older meeting/join flows.
// Primary production calling should use the LiveKit/Azure-first call stack.
export function useLegacySignaling(options: UseSignalingOptions = {}) {
  const wsRef = useRef<WebSocket | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const heartbeatRef = useRef<number | null>(null);
  const reconnectRef = useRef<number | null>(null);
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
    if (heartbeatRef.current) {
      window.clearInterval(heartbeatRef.current);
    }
    heartbeatRef.current = window.setInterval(() => {
      send({ type: SIGNALING_MESSAGE.HEARTBEAT });
    }, HEARTBEAT_INTERVAL);
  }, [send]);

  const stopHeartbeat = useCallback(() => {
    if (heartbeatRef.current) {
      window.clearInterval(heartbeatRef.current);
      heartbeatRef.current = null;
    }
  }, []);

  const handleMessage = useCallback((event: MessageEvent) => {
    try {
      const message = normalizeSignalingMessage(JSON.parse(event.data));
      if (!message) {
        throw new Error("Unsupported signaling message");
      }

      const opts = optionsRef.current;
      switch (message.type) {
        case SIGNALING_MESSAGE.ACK:
          if (message.sessionId) {
            sessionIdRef.current = message.sessionId;
            setSessionId(message.sessionId);
          }
          if (message.callId) {
            setCurrentCallId(message.callId);
            if (pendingOfferRef.current) {
              send({
                type: SIGNALING_MESSAGE.CALL_OFFER,
                callId: message.callId,
                payload: { offer: pendingOfferRef.current },
              });
              pendingOfferRef.current = null;
            }
          }
          break;

        case SIGNALING_MESSAGE.CALL_RINGING:
          if (message.callId && message.from) {
            setCurrentCallId(message.callId);
            opts.onCallRinging?.(message.callId, message.from);
          }
          break;

        case SIGNALING_MESSAGE.CALL_OFFER:
          if (message.callId && message.payload?.offer) {
            opts.onCallOffer?.(message.callId, message.payload.offer as RTCSessionDescriptionInit);
          }
          break;

        case SIGNALING_MESSAGE.CALL_ANSWER:
          if (message.callId && message.payload?.answer) {
            opts.onCallAnswer?.(message.callId, message.payload.answer as RTCSessionDescriptionInit);
          }
          break;

        case SIGNALING_MESSAGE.CALL_ICE:
          if (message.callId && message.payload?.candidate) {
            opts.onIceCandidate?.(message.callId, message.payload.candidate as RTCIceCandidateInit);
          }
          break;

        case SIGNALING_MESSAGE.CALL_END:
          setCurrentCallId(null);
          opts.onCallEnd?.(message.callId || "", message.payload?.reason as string | undefined);
          break;

        case SIGNALING_MESSAGE.TRANSLATION_SUBTITLE:
          if (message.payload) {
            opts.onTranslationSubtitle?.({
              subtitle: message.payload.subtitle as string,
              language: message.payload.language as string,
              emotion: message.payload.emotion as string | undefined,
            });
          }
          break;

        case SIGNALING_MESSAGE.APP_METADATA:
          if (message.payload?.type === "request_translation_setup") {
            send({
              type: SIGNALING_MESSAGE.APP_METADATA,
              callId: message.callId,
              payload: { type: "translation_setup_ack", status: "ready" },
            });
          }
          break;

        case SIGNALING_MESSAGE.ERROR:
          opts.onError?.(
            (message.payload?.message as string) ||
              (message.payload?.error as string) ||
              "Unknown error",
          );
          break;
      }
    } catch (error) {
      console.error("[Signaling] Failed to parse message:", error);
    }
  }, [send]);

  const connect = useCallback(async () => {
    if (wsRef.current?.readyState === WebSocket.OPEN || wsRef.current?.readyState === WebSocket.CONNECTING) {
      return;
    }

    intentionalDisconnectRef.current = false;
    setConnectionState("connecting");

    try {
      const wsToken = await fetchSignalingToken();
      const wsUrl = `${SIGNALING_URL}?token=${encodeURIComponent(wsToken)}`;
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        setConnectionState("connected");
        send({
          type: SIGNALING_MESSAGE.REGISTER,
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
        console.error("[Signaling] WebSocket error:", event);
        setConnectionState("error");
        optionsRef.current.onError?.("Failed to connect to signaling server.");
      };

      ws.onclose = (event) => {
        setConnectionState("disconnected");
        stopHeartbeat();
        sessionIdRef.current = null;
        setSessionId(null);

        if (!intentionalDisconnectRef.current) {
          reconnectRef.current = window.setTimeout(() => {
            void connect();
          }, RECONNECT_DELAY);
        }

        if (event.reason) {
          optionsRef.current.onError?.(event.reason);
        }
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to open signaling connection";
      console.error("[Signaling] Failed before WebSocket connect:", error);
      setConnectionState("error");
      optionsRef.current.onError?.(message);
    }
  }, [handleMessage, send, startHeartbeat, stopHeartbeat]);

  const disconnect = useCallback(() => {
    intentionalDisconnectRef.current = true;
    if (reconnectRef.current) {
      window.clearTimeout(reconnectRef.current);
      reconnectRef.current = null;
    }
    stopHeartbeat();
    if (wsRef.current) {
      send({ type: SIGNALING_MESSAGE.UNREGISTER });
      wsRef.current.close();
      wsRef.current = null;
    }
    setConnectionState("disconnected");
    setSessionId(null);
    setCurrentCallId(null);
  }, [send, stopHeartbeat]);

  const initiateCall = useCallback((to: string, callType: "audio" | "video" = "video", metadata?: Record<string, unknown>) => {
    send({
      type: SIGNALING_MESSAGE.CALL_INITIATE,
      to,
      payload: { callType, videoEnabled: callType === "video", metadata },
    });
  }, [send]);

  const acceptCall = useCallback((callId: string) => {
    send({ type: SIGNALING_MESSAGE.CALL_ACCEPT, callId });
  }, [send]);

  const rejectCall = useCallback((callId: string) => {
    send({ type: SIGNALING_MESSAGE.CALL_REJECT, callId });
  }, [send]);

  const sendOffer = useCallback((callId: string, offer: RTCSessionDescriptionInit) => {
    send({ type: SIGNALING_MESSAGE.CALL_OFFER, callId, payload: { offer } });
  }, [send]);

  const sendAnswer = useCallback((callId: string, answer: RTCSessionDescriptionInit) => {
    send({ type: SIGNALING_MESSAGE.CALL_ANSWER, callId, payload: { answer } });
  }, [send]);

  const sendIceCandidate = useCallback((callId: string, candidate: RTCIceCandidateInit) => {
    send({ type: SIGNALING_MESSAGE.CALL_ICE, callId, payload: { candidate } });
  }, [send]);

  const endCall = useCallback((callId: string, reason?: string) => {
    send({ type: SIGNALING_MESSAGE.CALL_END, callId, payload: { reason } });
    setCurrentCallId(null);
  }, [send]);

  const sendTranslationSubtitle = useCallback((callId: string, subtitle: string, language: string, emotion?: string) => {
    send({
      type: SIGNALING_MESSAGE.TRANSLATION_SUBTITLE,
      callId,
      payload: { subtitle, language, emotion },
    });
  }, [send]);

  const setPendingOffer = useCallback((offer: RTCSessionDescriptionInit) => {
    pendingOfferRef.current = offer;
  }, []);

  useEffect(() => () => {
    disconnect();
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

export const useSignaling = useLegacySignaling;
