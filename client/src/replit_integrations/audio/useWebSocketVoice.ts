import { useState, useCallback, useRef, useEffect } from "react";
import { decodePCM16ToFloat32, createAudioPlaybackContext } from "./audio-utils";
import type { PlaybackState } from "./useAudioPlayback";

export interface WebSocketVoiceOptions {
  onUserTranscript?: (text: string) => void;
  onSentence?: (seq: number, text: string) => void;
  onTranscript?: (text: string, fullText: string) => void;
  onComplete?: (fullText: string) => void;
  onError?: (error: Error) => void;
  onLatency?: (latencyMs: number) => void;
}

export function useWebSocketVoice(options: WebSocketVoiceOptions = {}) {
  const [isConnected, setIsConnected] = useState(false);
  const [playbackState, setPlaybackState] = useState<PlaybackState>("idle");
  const [latency, setLatency] = useState<number>(0);
  
  const wsRef = useRef<WebSocket | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<AudioWorkletNode | null>(null);
  const startTimeRef = useRef<number>(0);

  // Connect to WebSocket
  const connect = useCallback(async (conversationId: number) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsPort = 5001; // Fastify WebSocket port
    const wsUrl = `${protocol}//${window.location.hostname}:${wsPort}/ws/voice/${conversationId}`;

    return new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        setIsConnected(true);
        resolve();
      };

      ws.onclose = () => {
        setIsConnected(false);
      };

      ws.onerror = (err) => {
        setIsConnected(false);
        reject(new Error("WebSocket connection failed"));
      };

      ws.onmessage = async (event) => {
        try {
          const message = JSON.parse(event.data);
          
          switch (message.type) {
            case "user_transcript":
              options.onUserTranscript?.(message.data);
              break;
              
            case "sentence":
              options.onSentence?.(message.seq, message.text);
              break;
              
            case "audio":
              // First audio chunk - calculate latency
              if (startTimeRef.current && latency === 0) {
                const responseLatency = Date.now() - startTimeRef.current;
                setLatency(responseLatency);
                options.onLatency?.(responseLatency);
              }
              
              // Play audio
              setPlaybackState("playing");
              await playAudioChunk(message.data);
              break;
              
            case "transcript":
              options.onTranscript?.(message.data, message.full || message.data);
              break;
              
            case "done":
              setPlaybackState("idle");
              options.onComplete?.(message.transcript || "");
              break;
              
            case "error":
              setPlaybackState("idle");
              options.onError?.(new Error(message.error));
              break;
              
            case "pong":
              // Heartbeat response
              break;
          }
        } catch (err) {
          console.error("WebSocket message parse error:", err);
        }
      };
    });
  }, [options, latency]);

  // Disconnect WebSocket
  const disconnect = useCallback(() => {
    wsRef.current?.close();
    wsRef.current = null;
    setIsConnected(false);
  }, []);

  // Send audio for processing
  const sendAudio = useCallback(async (audioBlob: Blob, voice = "nova", locale = "en") => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      throw new Error("WebSocket not connected");
    }

    startTimeRef.current = Date.now();
    setLatency(0);

    // Convert blob to base64 and send
    const arrayBuffer = await audioBlob.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);
    let binary = "";
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    const base64 = btoa(binary);
    
    // Determine format from blob type
    const format = audioBlob.type.includes("webm") ? "webm" : "wav";

    // Send audio data
    wsRef.current.send(JSON.stringify({
      type: "audio_chunk",
      data: base64,
    }));

    // Signal end of audio
    wsRef.current.send(JSON.stringify({
      type: "audio_end",
      format,
      voice,
      locale,
    }));
  }, []);

  // Play audio chunk
  const playAudioChunk = useCallback(async (base64Data: string) => {
    if (!audioContextRef.current) {
      const result = await createAudioPlaybackContext();
      audioContextRef.current = result.ctx;
      processorRef.current = result.worklet;
    }

    const audioContext = audioContextRef.current;
    const processor = processorRef.current;

    if (audioContext && audioContext.state === "suspended") {
      await audioContext.resume();
    }

    const floatData = decodePCM16ToFloat32(base64Data);
    processor?.port.postMessage({ type: "push", samples: floatData });
  }, []);

  // Heartbeat to keep connection alive
  useEffect(() => {
    const interval = setInterval(() => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: "ping" }));
      }
    }, 30000);

    return () => clearInterval(interval);
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      disconnect();
      audioContextRef.current?.close();
    };
  }, [disconnect]);

  return {
    isConnected,
    playbackState,
    latency,
    connect,
    disconnect,
    sendAudio,
  };
}
