import { SignalingMessage, TranslationMode } from '../types';

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
  private pendingMessages: any[] = [];
  private serverUrl: string;
  private userId: number | null = null;
  private authToken: string | null = null;
  private deviceId: string | null = null;

  constructor() {
    this.serverUrl = __DEV__
      ? 'ws://localhost:5000/ws/signaling'
      : 'wss://neuratalk.in/ws/signaling'; // Use your actual production WebSocket URL
  }

  connect(userId: number, authToken: string, deviceId: string): void {
    this.userId = userId;
    this.authToken = authToken;
    this.deviceId = deviceId;
    this.intentionalDisconnect = false;

    if (this.ws?.readyState === WebSocket.OPEN || this.ws?.readyState === WebSocket.CONNECTING) {
      return;
    }

    try {
      this.ws = new WebSocket(this.serverUrl);

      this.ws.onopen = () => {
        console.log('Signaling connected');
        this.reconnectAttempts = 0;
        if (this.reconnectTimer) {
          clearTimeout(this.reconnectTimer);
          this.reconnectTimer = null;
        }
        this.register();
        this.flushPendingMessages();
        this.onConnectHandlers.forEach(handler => handler());
      };

      this.ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data) as SignalingMessage;
          this.messageHandlers.forEach(handler => handler(message));
        } catch (error) {
          console.error('Failed to parse signaling message:', error);
        }
      };

      this.ws.onclose = () => {
        console.log('Signaling disconnected');
        this.onDisconnectHandlers.forEach(handler => handler());
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
      userId: this.userId,
      authToken: this.authToken,
      deviceId: this.deviceId,
      capabilities: {
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
      console.log('Max reconnect attempts reached');
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

  send(message: any): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    } else {
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
    const sessionId = `call_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    this.send({
      type: 'initiate_call',
      sessionId,
      target: targetPhoneNumber,
      callType: options.callType === 'video' ? 'video' : 'audio',
      ...options,
      timestamp: Date.now(),
    });

    return sessionId;
  }

  answerCall(sessionId: string, answer: RTCSessionDescriptionInit): void {
    this.send({
      type: 'answer',
      sessionId,
      payload: { sdp: answer },
      timestamp: Date.now(),
    });
  }

  sendIceCandidate(sessionId: string, targetPeerId: string, candidate: RTCIceCandidate): void {
    this.send({
      type: 'ice_candidate',
      sessionId,
      to: targetPeerId,
      payload: { candidate: candidate.toJSON() },
      timestamp: Date.now(),
    });
  }

  endCall(sessionId: string): void {
    this.send({
      type: 'end_call',
      sessionId,
      timestamp: Date.now(),
    });
  }

  updateTranslationMode(sessionId: string, options: {
    myLanguage: string;
    theirLanguage: string;
    translationEnabled: boolean;
    translationMode: TranslationMode;
  }): void {
    this.send({
      type: 'update_translation_mode',
      sessionId,
      ...options,
      timestamp: Date.now(),
    });
  }

  onMessage(handler: MessageHandler): () => void {
    this.messageHandlers.push(handler);
    return () => {
      this.messageHandlers = this.messageHandlers.filter(h => h !== handler);
    };
  }

  onConnect(handler: ConnectionHandler): () => void {
    this.onConnectHandlers.push(handler);
    return () => {
      this.onConnectHandlers = this.onConnectHandlers.filter(h => h !== handler);
    };
  }

  onDisconnect(handler: ConnectionHandler): () => void {
    this.onDisconnectHandlers.push(handler);
    return () => {
      this.onDisconnectHandlers = this.onDisconnectHandlers.filter(h => h !== handler);
    };
  }

  isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }
}

export const signalingService = new SignalingService();
