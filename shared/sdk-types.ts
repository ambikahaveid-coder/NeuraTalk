/**
 * NeuraTalk SDK Types
 * 
 * TypeScript types for NeuraTalk API integration.
 * Use these types when building applications that consume NeuraTalk APIs.
 * 
 * @version 2.0.0
 */

// === ROLE DEFINITIONS ===
export type UserRole = "super_admin" | "investor" | "company_admin" | "agent" | "consumer";
export type CompanyStatus = "pending" | "approved" | "rejected" | "suspended";
export type EmotionType = "neutral" | "happy" | "sad" | "angry" | "surprised";
export type VoiceProfile = "alloy" | "echo" | "fable" | "onyx" | "nova" | "shimmer";

// === USER TYPES ===
export interface User {
  id: number;
  email: string | null;
  phone: string | null;
  displayName: string | null;
  role: UserRole;
  organizationId: number | null;
  isActive: boolean;
  preferredLanguage: string;
  avatarUrl: string | null;
  createdAt: string;
}

export interface Organization {
  id: number;
  name: string;
  slug: string;
  status: CompanyStatus;
  plan: "free" | "pro" | "enterprise";
  walletBalancePaise: number;
  primaryLanguage: string;
  supportedLanguages: string[];
  logoUrl: string | null;
  createdAt: string;
}

// === AUTHENTICATION ===
export interface OtpRequestInput {
  identifier: string;
  channel: "email" | "mobile";
}

export interface OtpVerifyInput {
  identifier: string;
  code: string;
}

export interface AuthResponse {
  token: string;
  user: User;
  organization?: Organization;
}

// === TRANSLATION ===
export interface TranslationRequest {
  text: string;
  sourceLanguage?: string;
  targetLanguage: string;
  preserveEmotion?: boolean;
}

export interface TranslationResponse {
  original: string;
  translated: string;
  sourceLanguage: string;
  targetLanguage: string;
  emotion?: EmotionType;
}

export interface SpeechTranslationRequest {
  audio: Blob | ArrayBuffer;
  targetLanguage: string;
  preserveEmotion?: boolean;
}

export interface TtsRequest {
  text: string;
  voice?: VoiceProfile;
  speed?: number;
}

// === VOICE MEMOS ===
export interface VoiceMemo {
  id: number;
  senderId: number;
  recipientId: number | null;
  groupChatId: number | null;
  originalAudioPath: string;
  originalLanguage: string;
  originalTranscript: string | null;
  translations: Record<string, { audioPath: string; transcript: string }>;
  useVoiceCloning: boolean;
  voiceProfileId: number | null;
  duration: number;
  status: "pending" | "transcribing" | "translating" | "ready" | "failed";
  emotionTags: string[] | null;
  isRead: boolean;
  createdAt: string;
}

export interface CreateVoiceMemoInput {
  audioPath: string;
  recipientId?: number;
  groupChatId?: number;
  duration?: number;
  useVoiceCloning?: boolean;
  voiceProfileId?: number;
}

// === GROUP CHATS ===
export interface GroupChat {
  id: number;
  name: string;
  creatorId: number;
  memberCount: number;
  createdAt: string;
}

export interface GroupChatMember {
  id: number;
  userId: number;
  groupId: number;
  preferredLanguage: string;
  role: "admin" | "moderator" | "member";
  displayName: string;
}

export interface GroupMessage {
  id: number;
  groupId: number;
  senderId: number;
  originalText: string;
  originalLanguage: string;
  translations: Record<string, string>;
  emotion?: EmotionType;
  audioPath?: string;
  createdAt: string;
}

// === CALLS ===
export interface Call {
  id: number;
  callerId: number;
  receiverId: number | null;
  status: "initiated" | "ringing" | "active" | "ended" | "failed";
  type: "voice" | "video" | "video_translation";
  startedAt: string | null;
  endedAt: string | null;
  durationSeconds: number | null;
}

export interface CallTranslationConfig {
  enabled: boolean;
  sourceLanguage: string;
  targetLanguage: string;
  translationMode?: "off" | "subtitles" | "voice";
  preserveEmotion: boolean;
  showSubtitles: boolean;
  lipSyncEnabled: boolean;
}

// === LIP-SYNC ===
export type LipSyncModelType = "wav2lip" | "wav2lip-gan" | "sadtalker";
export type LipSyncJobStatus = "queued" | "processing" | "completed" | "failed";

export interface LipSyncStatus {
  enabled: boolean;
  gpuAvailable: boolean;
  modelsLoaded: LipSyncModelType[];
  queueLength: number;
}

export interface LipSyncModelInfo {
  id: LipSyncModelType;
  name: string;
  description: string;
  quality: "standard" | "high" | "ultra";
  speed: "fast" | "balanced" | "quality";
}

export interface LipSyncJobInput {
  videoPath: string;
  audioPath: string;
  model?: LipSyncModelType;
  priority?: "low" | "normal" | "high";
}

export interface LipSyncJob {
  jobId: string;
  status: LipSyncJobStatus;
  model: LipSyncModelType;
  progress: number;
  outputPath: string | null;
  error: string | null;
  createdAt: string;
  completedAt: string | null;
}

// === RTC CONFIGURATION ===
export interface IceServer {
  urls: string[];
  username?: string;
  credential?: string;
}

export interface RtcConfig {
  iceServers: IceServer[];
  turnConfigured: boolean;
  message?: string;
}

export interface RtcStatus {
  signaling: {
    configured: boolean;
    path: string;
  };
  turn: {
    configured: boolean;
  };
  stun: {
    configured: boolean;
    servers: string[];
  };
}

// === BILLING ===
export interface Plan {
  id: string;
  name: string;
  price: number;
  currency: string;
  interval: "month" | "year";
  features: string[];
  limits: {
    callMinutes: number;
    translations: number;
    voiceMemos: number;
  };
}

export interface Subscription {
  id: number;
  userId: number;
  planId: string;
  status: "active" | "cancelled" | "past_due" | "expired";
  currentPeriodStart: string;
  currentPeriodEnd: string;
  cancelAtPeriodEnd: boolean;
}

export interface Invoice {
  id: number;
  userId: number;
  subscriptionId: number;
  amount: number;
  currency: string;
  status: "draft" | "open" | "paid" | "void";
  pdfUrl: string | null;
  createdAt: string;
}

// === B2B ORGANIZATION ===
export interface B2BRegistrationInput {
  organizationName: string;
  email: string;
  phone?: string;
  adminName: string;
  industry?: string;
  website?: string;
}

export interface BillingLedgerEntry {
  id: number;
  organizationId: number;
  userId: number | null;
  amountPaise: number;
  balanceAfterPaise: number;
  entryType: string;
  direction: "credit" | "debit";
  metadata?: Record<string, unknown> | null;
  createdAt: string;
}

// === SUPPORTED LANGUAGES ===
export const SUPPORTED_LANGUAGES = [
  { code: "en", name: "English" },
  { code: "es", name: "Spanish" },
  { code: "fr", name: "French" },
  { code: "de", name: "German" },
  { code: "it", name: "Italian" },
  { code: "pt", name: "Portuguese" },
  { code: "ru", name: "Russian" },
  { code: "ja", name: "Japanese" },
  { code: "ko", name: "Korean" },
  { code: "zh", name: "Chinese" },
  { code: "ar", name: "Arabic" },
  { code: "hi", name: "Hindi" },
  { code: "te", name: "Telugu" },
  { code: "ta", name: "Tamil" },
  { code: "kn", name: "Kannada" },
  { code: "ml", name: "Malayalam" },
  { code: "mr", name: "Marathi" },
  { code: "gu", name: "Gujarati" },
  { code: "bn", name: "Bengali" },
  { code: "pa", name: "Punjabi" },
] as const;

export type LanguageCode = typeof SUPPORTED_LANGUAGES[number]["code"];

// === API CLIENT HELPERS ===
export interface ApiError {
  error: string;
  message?: string;
  code?: string;
  statusCode: number;
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}

// === WEBSOCKET EVENTS ===
export interface SignalingMessage {
  type: "offer" | "answer" | "ice-candidate" | "join" | "leave" | "error";
  roomId?: string;
  peerId?: string;
  payload?: unknown;
}

export interface TranslationEvent {
  type:
    | "transcription"
    | "translation"
    | "translation.partial"
    | "translation.ready"
    | "tts_ready"
    | "tts_failed"
    | "error";
  original?: string;
  translated?: string;
  language?: string;
  emotion?: EmotionType;
  audioUrl?: string;
  sourceIdentity?: string;
  targetIdentity?: string;
  sourceLanguage?: string;
  targetLanguage?: string;
  partial?: boolean;
  latencyMs?: number;
  confidence?: number;
  translationMode?: "off" | "subtitles" | "voice";
  replaceOriginalVoice?: boolean;
  deliveryMode?: "session_injected" | "remote_only" | "local_playback";
  reason?: string;
}

// === SDK CLIENT CLASS (USAGE EXAMPLE) ===
/**
 * Example SDK client usage:
 * 
 * ```typescript
 * import { NeuraTalkClient } from '@neuratalk/sdk';
 * 
 * const client = new NeuraTalkClient({
 *   baseUrl: 'https://api.neuratalk.in',
 *   token: 'your-auth-token'
 * });
 * 
 * // Request OTP
 * await client.auth.requestOtp({ identifier: 'user@example.com', channel: 'email' });
 * 
 * // Verify OTP
 * const { token, user } = await client.auth.verifyOtp({ identifier: 'user@example.com', code: '123456' });
 * 
 * // Translate text
 * const translation = await client.translate.text({
 *   text: 'Hello, how are you?',
 *   targetLanguage: 'te',
 *   preserveEmotion: true
 * });
 * 
 * // Create voice memo
 * const memo = await client.voiceMemos.create({
 *   audio: audioBlob,
 *   targetLanguages: ['te', 'hi', 'es']
 * });
 * ```
 */
