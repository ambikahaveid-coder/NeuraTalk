import { SignalingMessage, TranslationMode } from '../types';
import { authApi, getApiBaseUrl } from './api';

type MessageHandler = (message: SignalingMessage) => void;
type ConnectionHandler = () => void;

class SignalingService {
  private ws: WebSocket | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private baseReconnectDelay = 1500;
  private maxReconnectDelay = 30000;
  private messageHandlers: MessageHandler[] = [];
  private onConnectHandlers: ConnectionHandler[] = [];
  private onDisconnectHandlers: ConnectionHandler[] = [];
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private intentionalDisconnect = false;
  private pendingMessages: SignalingMessage[] = [];
  private pendingMessageLimit = 100;
  private userId: number | null = null;
  private authToken: string | null = null;
  private deviceId: string | null = null;

  connect(userId: number, authToken: string, deviceId: string): void {
    this.userId = userId;
    this.authToken = authToken;
    this.deviceId = deviceId;
    this.intentionalDisconnect = false;

    if (this.ws?.readyState === WebSocket.OPEN || this.ws?.readyState === WebSocket.CONNECTING) {
      return;
    }

    void this.openConnection();
  }

  private buildServerUrl(wsToken: string): string {
    const apiBaseUrl = getApiBaseUrl();
    const wsBaseUrl = apiBaseUrl.startsWith('https://')
      ? `wss://${apiBaseUrl.slice('https://'.length)}`
      : `ws://${apiBaseUrl.slice('http://'.length)}`;
    return `${wsBaseUrl}/ws/signaling?token=${encodeURIComponent(wsToken)}`;
  }

  private normalizeIncomingMessage(message: any): SignalingMessage {
    const timestamp = typeof message?.timestamp === 'number' ? message.timestamp : Date.now();

    switch (message?.type) {
      case 'ack':
        if (message.callId) {
          return {
            type: 'call_initiated',
            callId: message.callId,
            sessionId: message.callId,
            payload: message.payload,
            timestamp,
          };
        }
        return { ...message, timestamp };
      case 'call_ringing':
        return {
          type: 'incoming_call',
          callId: message.callId,
          sessionId: message.callId,
          from: message.from,
          payload: message.payload,
          timestamp,
        };
      case 'call_accept':
        return {
          type: 'call_connected',
          callId: message.callId,
          sessionId: message.callId,
          payload: message.payload,
          timestamp,
        };
      case 'call_end':
        return {
          type: 'call_ended',
          callId: message.callId,
          sessionId: message.callId,
          payload: message.payload,
          timestamp,
        };
      default:
        return { ...message, timestamp };
    }
  }

  private async openConnection(): Promise<void> {
    try {
      const wsTokenPayload = await authApi.getWsToken();
      const serverUrl = this.buildServerUrl(wsTokenPayload.token);
      this.ws = new WebSocket(serverUrl);

      this.ws.onopen = () => {
        this.reconnectAttempts = 0;
        if (this.reconnectTimer) {
          clearTimeout(this.reconnectTimer);
          this.reconnectTimer = null;
        }
        this.register();
        this.flushPendingMessages();
        this.onConnectHandlers.forEach((handler) => handler());
      };

      this.ws.onmessage = (event) => {
        try {
          const message = this.normalizeIncomingMessage(JSON.parse(event.data));
          this.messageHandlers.forEach((handler) => handler(message));
        } catch (error) {
          console.error('Failed to parse signaling message:', error);
        }
      };

      this.ws.onclose = () => {
        this.onDisconnectHandlers.forEach((handler) => handler());
        this.ws = null;
        if (!this.intentionalDisconnect) {
          this.attemptReconnect();
        }
      };

      this.ws.onerror = (error) => {
        console.error('Signaling error:', error);
      };
    } catch (error) {
      console.error('Failed to connect to signaling:', error);
      this.attemptReconnect();
    }
  }

  private register(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    this.send({
      type: 'register',
      payload: {
        userId: this.userId,
        deviceId: this.deviceId,
        supportsWebRTC: true,
        supportsSIP: false,
        supportsNativeTelephony: true,
        audioCodecs: ['opus'],
      },
      timestamp: Date.now(),
    });
  }

  private attemptReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      return;
    }

    this.reconnectAttempts++;
    const exponentialBackoff = Math.min(
      this.maxReconnectDelay,
      this.baseReconnectDelay * (2 ** (this.reconnectAttempts - 1)),
    );
    const jitterMs = Math.round(Math.random() * 500);
    const delayMs = exponentialBackoff + jitterMs;

    this.reconnectTimer = setTimeout(() => {
      if (this.userId && this.authToken && this.deviceId) {
        this.connect(this.userId, this.authToken, this.deviceId);
      }
    }, delayMs);
  }

  disconnect(): void {
    this.intentionalDisconnect = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  send(message: SignalingMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    } else {
      if (this.pendingMessages.length >= this.pendingMessageLimit) {
        this.pendingMessages.shift();
      }
      this.pendingMessages.push(message);
      console.warn('Queueing signaling message until WebSocket reconnects');
    }
  }

  reconnectNow(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.userId && this.authToken && this.deviceId) {
      this.connect(this.userId, this.authToken, this.deviceId);
    }
  }

  private flushPendingMessages(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN || this.pendingMessages.length === 0) {
      return;
    }
    const queue = [...this.pendingMessages];
    this.pendingMessages = [];
    queue.forEach((message) => {
      this.ws?.send(JSON.stringify(message));
    });
  }

  initiateCall(targetPhoneNumber: string, options: {
    callType?: 'voice' | 'video';
    myLanguage: string;
    theirLanguage: string;
    translationEnabled: boolean;
    translationMode?: TranslationMode;
    callExperience?: 'audio' | 'video' | 'face_to_face';
  }): string {
    const sessionId = `call_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;

    this.send({
      type: 'call_initiate',
      callId: sessionId,
      sessionId,
      to: targetPhoneNumber,
      payload: {
        callType: options.callType === 'video' ? 'video' : 'audio',
        videoEnabled: options.callType === 'video',
        metadata: {
          myLanguage: options.myLanguage,
          theirLanguage: options.theirLanguage,
          translationEnabled: options.translationEnabled,
          translationMode: options.translationMode,
          callExperience: options.callExperience,
        },
      },
      timestamp: Date.now(),
    });

    return sessionId;
  }

  answerCall(callId: string, answer: RTCSessionDescriptionInit): void {
    this.send({
      type: 'call_answer',
      callId,
      sessionId: callId,
      payload: { answer },
      timestamp: Date.now(),
    });
  }

  acceptCall(callId: string): void {
    this.send({
      type: 'call_accept',
      callId,
      sessionId: callId,
      timestamp: Date.now(),
    });
  }

  sendIceCandidate(callId: string, targetPeerId: string, candidate: RTCIceCandidate): void {
    this.send({
      type: 'call_ice',
      callId,
      sessionId: callId,
      to: targetPeerId,
      payload: { candidate: candidate.toJSON() },
      timestamp: Date.now(),
    });
  }

  endCall(callId: string): void {
    this.send({
      type: 'call_end',
      callId,
      sessionId: callId,
      timestamp: Date.now(),
    });
  }

  updateTranslationMode(callId: string, options: {
    myLanguage: string;
    theirLanguage: string;
    translationEnabled: boolean;
    translationMode: TranslationMode;
  }): void {
    this.send({
      type: 'app_metadata',
      callId,
      sessionId: callId,
      payload: {
        type: 'translation_mode_update',
        ...options,
      },
      timestamp: Date.now(),
    });
  }

  onMessage(handler: MessageHandler): () => void {
    this.messageHandlers.push(handler);
    return () => {
      this.messageHandlers = this.messageHandlers.filter((item) => item !== handler);
    };
  }

  onConnect(handler: ConnectionHandler): () => void {
    this.onConnectHandlers.push(handler);
    return () => {
      this.onConnectHandlers = this.onConnectHandlers.filter((item) => item !== handler);
    };
  }

  onDisconnect(handler: ConnectionHandler): () => void {
    this.onDisconnectHandlers.push(handler);
    return () => {
      this.onDisconnectHandlers = this.onDisconnectHandlers.filter((item) => item !== handler);
    };
  }

  isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }
}

export const signalingService = new SignalingService();
