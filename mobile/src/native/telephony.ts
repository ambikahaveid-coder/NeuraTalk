import { NativeModules, Platform, NativeEventEmitter } from 'react-native';

const { NeuraTalkTelephony } = NativeModules;

type TelephonyEventType = 
  | 'onIncomingCall'
  | 'onCallConnected'
  | 'onCallEnded'
  | 'onCallFailed'
  | 'onAudioRouteChanged';

interface IncomingCallEvent {
  callId: string;
  phoneNumber: string;
  callerName?: string;
}

interface CallEvent {
  callId: string;
}

interface CallFailedEvent {
  callId: string;
  reason: string;
}

interface AudioRouteEvent {
  route: 'earpiece' | 'speaker' | 'bluetooth' | 'headset';
}

interface TelephonyCapabilities {
  supportsIncomingCallUi: boolean;
  supportsOutgoingCallUi: boolean;
  supportsAudioRouteControl: boolean;
  supportsBluetoothAudio: boolean;
  supportsTranslatedAudioPlayback?: boolean;
}

class NativeTelephonyModule {
  private eventEmitter: NativeEventEmitter | null = null;
  private listeners: Map<TelephonyEventType, ((event: any) => void)[]> = new Map();

  constructor() {
    if (NeuraTalkTelephony) {
      this.eventEmitter = new NativeEventEmitter(NeuraTalkTelephony);
      this.setupListeners();
    }
  }

  private setupListeners() {
    if (!this.eventEmitter) return;

    const events: TelephonyEventType[] = [
      'onIncomingCall',
      'onCallConnected', 
      'onCallEnded',
      'onCallFailed',
      'onAudioRouteChanged',
    ];

    events.forEach(eventType => {
      this.eventEmitter!.addListener(eventType, (event: unknown) => {
        const handlers = this.listeners.get(eventType) || [];
        handlers.forEach(handler => handler(event));
      });
    });
  }

  isAvailable(): boolean {
    return NeuraTalkTelephony != null;
  }

  async initialize(): Promise<void> {
    if (!this.isAvailable()) {
      console.warn('Native telephony module not available');
      return;
    }
    return NeuraTalkTelephony.initialize();
  }

  async showIncomingCall(callId: string, callerName: string): Promise<void> {
    if (!this.isAvailable()) return;
    
    if (Platform.OS === 'ios') {
      return NeuraTalkTelephony.reportIncomingCall(callId, callerName);
    } else {
      return NeuraTalkTelephony.showIncomingCallNotification(callId, callerName);
    }
  }

  async answerCall(callId: string): Promise<void> {
    if (!this.isAvailable()) return;
    return NeuraTalkTelephony.answerCall(callId);
  }

  async endCall(callId: string): Promise<void> {
    if (!this.isAvailable()) return;
    return NeuraTalkTelephony.endCall(callId);
  }

  async startOutgoingCall(phoneNumber: string, callerName: string): Promise<string> {
    if (!this.isAvailable()) {
      return `call_${Date.now()}`;
    }
    return NeuraTalkTelephony.startOutgoingCall(phoneNumber, callerName);
  }

  async setMuted(muted: boolean): Promise<void> {
    if (!this.isAvailable()) return;
    return NeuraTalkTelephony.setMuted(muted);
  }

  async setSpeaker(enabled: boolean): Promise<void> {
    if (!this.isAvailable()) return;
    return NeuraTalkTelephony.setSpeaker(enabled);
  }

  async setAudioRoute(route: 'earpiece' | 'speaker' | 'bluetooth'): Promise<void> {
    if (!this.isAvailable()) return;
    return NeuraTalkTelephony.setAudioRoute(route);
  }

  async getCurrentAudioRoute(): Promise<'earpiece' | 'speaker' | 'bluetooth' | 'headset' | 'unknown'> {
    if (!this.isAvailable() || !NeuraTalkTelephony.getCurrentAudioRoute) {
      return 'unknown';
    }
    return NeuraTalkTelephony.getCurrentAudioRoute();
  }

  async getCapabilities(): Promise<TelephonyCapabilities> {
    if (!this.isAvailable() || !NeuraTalkTelephony.getCapabilities) {
      return {
        supportsIncomingCallUi: false,
        supportsOutgoingCallUi: false,
        supportsAudioRouteControl: true,
        supportsBluetoothAudio: true,
        supportsTranslatedAudioPlayback: false,
      };
    }
    const capabilities = await NeuraTalkTelephony.getCapabilities();
    return {
      ...capabilities,
      supportsTranslatedAudioPlayback: capabilities?.supportsTranslatedAudioPlayback === true,
    };
  }

  async isCallActive(): Promise<boolean> {
    if (!this.isAvailable()) return false;
    return NeuraTalkTelephony.isCallActive();
  }

  async getPhoneAccounts(): Promise<any[]> {
    if (!this.isAvailable()) return [];
    if (Platform.OS !== 'android') return [];
    return NeuraTalkTelephony.getPhoneAccounts();
  }

  async requestPhonePermissions(): Promise<boolean> {
    if (!this.isAvailable()) return false;
    return NeuraTalkTelephony.requestPhonePermissions();
  }

  async playTranslatedAudio(audioUrl: string): Promise<boolean> {
    if (!this.isAvailable() || !NeuraTalkTelephony.playTranslatedAudio) {
      return false;
    }
    return Boolean(await NeuraTalkTelephony.playTranslatedAudio(audioUrl));
  }

  async stopTranslatedAudio(): Promise<void> {
    if (!this.isAvailable() || !NeuraTalkTelephony.stopTranslatedAudio) {
      return;
    }
    return NeuraTalkTelephony.stopTranslatedAudio();
  }

  onIncomingCall(handler: (event: IncomingCallEvent) => void): () => void {
    return this.addListener('onIncomingCall', handler);
  }

  onCallConnected(handler: (event: CallEvent) => void): () => void {
    return this.addListener('onCallConnected', handler);
  }

  onCallEnded(handler: (event: CallEvent) => void): () => void {
    return this.addListener('onCallEnded', handler);
  }

  onCallFailed(handler: (event: CallFailedEvent) => void): () => void {
    return this.addListener('onCallFailed', handler);
  }

  onAudioRouteChanged(handler: (event: AudioRouteEvent) => void): () => void {
    return this.addListener('onAudioRouteChanged', handler);
  }

  private addListener(eventType: TelephonyEventType, handler: (event: any) => void): () => void {
    const handlers = this.listeners.get(eventType) || [];
    handlers.push(handler);
    this.listeners.set(eventType, handlers);

    return () => {
      const currentHandlers = this.listeners.get(eventType) || [];
      this.listeners.set(eventType, currentHandlers.filter(h => h !== handler));
    };
  }
}

export const NativeTelephony = new NativeTelephonyModule();
