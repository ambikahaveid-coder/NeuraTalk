import { SignalingMessage } from '../types';

type MessageHandler = (message: SignalingMessage) => void;
type ConnectionHandler = () => void;

class SignalingService {
  private ws: WebSocket | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 3000;
  private messageHandlers: MessageHandler[] = [];
  private onConnectHandlers: ConnectionHandler[] = [];
  private onDisconnectHandlers: ConnectionHandler[] = [];
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

    if (this.ws?.readyState === WebSocket.OPEN) {
      return;
    }

    try {
      this.ws = new WebSocket(this.serverUrl);

      this.ws.onopen = () => {
        console.log('Signaling connected');
        this.reconnectAttempts = 0;
        this.register();
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
        this.attemptReconnect();
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
    setTimeout(() => {
      if (this.userId && this.authToken && this.deviceId) {
        this.connect(this.userId, this.authToken, this.deviceId);
      }
    }, this.reconnectDelay);
  }

  disconnect(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  send(message: any): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    } else {
      console.warn('Cannot send message: WebSocket not connected');
    }
  }

  initiateCall(targetPhoneNumber: string, options: {
    myLanguage: string;
    theirLanguage: string;
    translationEnabled: boolean;
  }): string {
    const sessionId = `call_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    this.send({
      type: 'initiate_call',
      sessionId,
      target: targetPhoneNumber,
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
