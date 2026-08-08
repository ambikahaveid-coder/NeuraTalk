export interface NeuraTalkUser {
  id: number;
  username: string;
  email?: string | null;
  phone?: string | null;
  role: "consumer" | "company_admin" | "agent" | "super_admin" | "investor";
  organizationId?: number | null;
}

export interface AuthResult {
  id: number;
  username: string;
  role: string;
  /** Opaque Bearer session token — sess_<64 hex chars>, not a JWT. Valid 24h, auto-renewed on use. */
  token: string;
  organization?: Record<string, unknown> | null;
}

export interface OtpVerifyResult {
  success: boolean;
  userId: number;
  message: string;
  token: string;
  user: NeuraTalkUser;
}

export type CallType = "voice" | "video";

export interface CreateCallInput {
  calleeIdentifier: string;
  callType: CallType;
  myLanguage?: string;
  theirLanguage?: string;
  translationEnabled?: boolean;
  translationMode?: string;
}

export interface CreateConferenceCallInput {
  hostLanguage?: string;
  participantIds: string[];
  title?: string;
}

export interface CallSession {
  callId: string;
  joinMethod?: string;
  livekitUrl: string;
  livekitToken: string;
  estimatedRateInrPerMin?: number | null;
  languageDetectionActive?: boolean;
}

export interface CallHistoryEntry {
  callId: string;
  callType: CallType;
  status: string;
  callerId?: string | null;
  calleeIdentifier?: string | null;
  callerLanguage?: string | null;
  calleeLanguage?: string | null;
  durationSeconds?: number | null;
  costInr?: number | null;
  createdAt: string;
  endedAt?: string | null;
}

export interface TranscriptSegment {
  id: number;
  smartCallId?: string | null;
  callId?: number | null;
  speakerIdentity?: string | null;
  targetIdentity?: string | null;
  originalText: string;
  originalLanguage?: string | null;
  translatedText: string;
  translatedLanguage?: string | null;
  timestamp?: string | null;
}

export interface TranscriptSearchPage {
  query: string;
  results: TranscriptSegment[];
  total: number;
  limit: number;
  offset: number;
}

export type ExportFormat = "txt" | "pdf" | "docx";
