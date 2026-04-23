export interface User {
  id: number;
  email?: string;
  phone?: string;
  name?: string;
  role: 'super_admin' | 'company_admin' | 'agent' | 'consumer' | 'investor';
  organizationId?: number;
}

export interface TranslationEntry {
  id: string;
  speaker: 'me' | 'them';
  originalText: string;
  translatedText: string;
  sourceLanguage: string;
  targetLanguage: string;
  emotion?: Emotion;
  timestamp: number;
}

export type Emotion = 'happy' | 'calm' | 'angry' | 'sad' | 'stressed' | 'neutral' | 'excited';

export interface CallState {
  status: 'idle' | 'dialing' | 'ringing' | 'active' | 'ended' | 'consent';
  callId?: string;
  phoneNumber?: string;
  callerName?: string;
  startTime?: number;
  duration: number;
  isMuted: boolean;
  isSpeakerOn: boolean;
  myLanguage: string;
  theirLanguage: string;
  translationEnabled: boolean;
  currentEmotion?: Emotion;
  translations: TranslationEntry[];
}

export interface DeviceInfo {
  deviceId: string;
  platform: 'android' | 'ios';
  pushToken?: string;
  voipToken?: string;
  deviceName: string;
  appVersion: string;
  osVersion: string;
  capabilities: DeviceCapabilities;
}

export interface DeviceCapabilities {
  supportsWebRTC: boolean;
  supportsSIM: boolean;
  supportsNativeTelephony: boolean;
  audioCodecs: string[];
  videoCodecs?: string[];
}

export interface CallConsent {
  termsAccepted: boolean;
  translationConsent: boolean;
  recordingConsent: boolean;
}

export interface SignalingMessage {
  type: string;
  from?: string;
  to?: string;
  sessionId?: string;
  payload?: any;
  timestamp: number;
}

export const LANGUAGES = [
  { code: 'en', name: 'English' },
  { code: 'es', name: 'Spanish' },
  { code: 'fr', name: 'French' },
  { code: 'de', name: 'German' },
  { code: 'zh', name: 'Chinese' },
  { code: 'ja', name: 'Japanese' },
  { code: 'hi', name: 'Hindi' },
  { code: 'te', name: 'Telugu' },
  { code: 'ta', name: 'Tamil' },
  { code: 'kn', name: 'Kannada' },
  { code: 'ar', name: 'Arabic' },
  { code: 'pt', name: 'Portuguese' },
  { code: 'ru', name: 'Russian' },
  { code: 'ko', name: 'Korean' },
] as const;

export const EMOTION_COLORS: Record<Emotion, string> = {
  happy: '#eab308',
  calm: '#3b82f6',
  angry: '#ef4444',
  sad: '#a855f7',
  stressed: '#f97316',
  neutral: '#94a3b8',
  excited: '#ec4899',
};
