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
  confidence?: number;
  latencyMs?: number;
  mixedLanguage?: boolean;
}

export type TranslationMode = 'off' | 'subtitles' | 'voice';
export type VoiceTranslationStatus =
  | 'idle'
  | 'listening'
  | 'synthesizing'
  | 'playing'
  | 'fallback_original'
  | 'unavailable';

export type Emotion = 'happy' | 'calm' | 'angry' | 'sad' | 'stressed' | 'neutral' | 'excited';

export interface CallState {
  status: 'idle' | 'dialing' | 'ringing' | 'connecting' | 'connected' | 'reconnecting' | 'failed' | 'ended';
  callId?: string;
  phoneNumber?: string;
  callerName?: string;
  callType?: 'voice' | 'video';
  callExperience?: 'audio' | 'video' | 'face_to_face';
  startTime?: number;
  duration: number;
  isMuted: boolean;
  isSpeakerOn: boolean;
  myLanguage: string;
  theirLanguage: string;
  translationEnabled: boolean;
  currentEmotion?: Emotion;
  translations: TranslationEntry[];
  errorMessage?: string;
  connectionState?: 'connected' | 'connecting' | 'reconnecting' | 'disconnected';
  audioRoute?: 'earpiece' | 'speaker' | 'bluetooth' | 'headset' | 'unknown';
  networkType?: 'wifi' | 'cellular' | 'ethernet' | 'vpn' | 'other' | 'unknown' | 'offline';
  hasNetwork?: boolean;
  participantCount?: number;
  callerIdentityMode?: 'user_number' | 'masked' | 'provider_number' | 'unknown';
  translationStatus?: 'idle' | 'listening' | 'translating' | 'ready' | 'disabled' | 'unavailable';
  translationWarning?: string;
  translationLatencyMs?: number;
  translationConfidence?: number;
  mixedLanguageDetected?: boolean;
  translationMode?: TranslationMode;
  voiceTranslationStatus?: VoiceTranslationStatus;
  voiceTranslationWarning?: string;
  voiceTranslationLatencyMs?: number;
  translatedAudioUrl?: string;
  originalVoiceSuppressed?: boolean;
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
  { code: 'auto', name: 'Auto Detect' },
  { code: 'en', name: 'English' },
  { code: 'hi', name: 'Hindi' },
  { code: 'te', name: 'Telugu' },
  { code: 'ta', name: 'Tamil' },
  { code: 'kn', name: 'Kannada' },
  { code: 'es', name: 'Spanish' },
  { code: 'fr', name: 'French' },
  { code: 'de', name: 'German' },
  { code: 'zh', name: 'Chinese' },
  { code: 'ja', name: 'Japanese' },
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
