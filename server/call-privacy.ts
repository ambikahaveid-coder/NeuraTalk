import { db } from "./db";
import { callConsents, type CallConsent as DBCallConsent } from "@shared/schema";
import { eq } from "drizzle-orm";

// ============================================================================
// CALL PRIVACY & CONSENT MANAGEMENT
// ============================================================================
// Requirements:
// - Inform users that calls may be processed for translation
// - Do not store call audio by default
// - Allow opt-in call recording
// - Encrypt audio streams end-to-end
// - Follow telecom and data protection norms

// ============================================================================
// CONSENT TYPES
// ============================================================================

export interface CallConsent {
  userId: number;
  translationProcessing: boolean;  // Required for service
  audioRecording: boolean;         // Opt-in only
  emotionAnalysis: boolean;        // Part of translation
  dataRetention: "none" | "session" | "7days" | "30days";
  consentTimestamp: Date;
  consentVersion: string;
}

export interface PrivacyDisclosure {
  title: string;
  description: string;
  required: boolean;
  defaultValue: boolean;
}

// Current consent version - bump when terms change
const CONSENT_VERSION = "1.0.0";

// ============================================================================
// PRIVACY DISCLOSURES
// ============================================================================

export const PRIVACY_DISCLOSURES: Record<string, PrivacyDisclosure> = {
  translationProcessing: {
    title: "Real-time Translation",
    description: "Your voice will be processed in real-time to provide translation. Audio is analyzed momentarily and not stored.",
    required: true,
    defaultValue: true,
  },
  emotionAnalysis: {
    title: "Emotion-Aware Translation",
    description: "We detect emotional tone to preserve your speaking style during translation. This helps your translated voice sound natural.",
    required: false,
    defaultValue: true,
  },
  audioRecording: {
    title: "Call Recording",
    description: "Optionally record calls for your personal review. Recordings are encrypted and only you can access them.",
    required: false,
    defaultValue: false,
  },
};

// ============================================================================
// CONSENT MANAGEMENT (Database-backed)
// ============================================================================

// Memory cache for fast lookups (synced with DB)
const consentCache = new Map<number, CallConsent>();

function dbToConsent(record: DBCallConsent): CallConsent {
  return {
    userId: record.userId,
    translationProcessing: record.translationProcessing ?? true,
    audioRecording: record.audioRecording ?? false,
    emotionAnalysis: record.emotionAnalysis ?? true,
    dataRetention: (record.dataRetention as "none" | "session" | "7days" | "30days") ?? "none",
    consentTimestamp: record.consentTimestamp ?? new Date(),
    consentVersion: record.consentVersion,
  };
}

export async function hasValidConsent(userId: number): Promise<boolean> {
  const consent = await getConsent(userId);
  if (!consent) return false;
  
  // Check consent version matches current
  if (consent.consentVersion !== CONSENT_VERSION) return false;
  
  // Must have translation processing consent (required)
  if (!consent.translationProcessing) return false;
  
  return true;
}

export async function getConsent(userId: number): Promise<CallConsent | null> {
  // Check cache first
  if (consentCache.has(userId)) {
    return consentCache.get(userId)!;
  }
  
  // Load from database
  const [record] = await db.select().from(callConsents).where(eq(callConsents.userId, userId)).limit(1);
  
  if (!record) return null;
  
  const consent = dbToConsent(record);
  consentCache.set(userId, consent);
  return consent;
}

export async function grantConsent(
  userId: number,
  options: {
    translationProcessing: boolean;
    audioRecording?: boolean;
    emotionAnalysis?: boolean;
    dataRetention?: "none" | "session" | "7days" | "30days";
  }
): Promise<CallConsent> {
  // Check if existing consent
  const existing = await db.select().from(callConsents).where(eq(callConsents.userId, userId)).limit(1);
  
  const consentData = {
    userId,
    translationProcessing: options.translationProcessing,
    audioRecording: options.audioRecording ?? false,
    emotionAnalysis: options.emotionAnalysis ?? true,
    dataRetention: options.dataRetention ?? "none",
    consentVersion: CONSENT_VERSION,
  };
  
  let record: DBCallConsent;
  
  if (existing.length > 0) {
    // Update existing
    const [updated] = await db.update(callConsents)
      .set(consentData)
      .where(eq(callConsents.userId, userId))
      .returning();
    record = updated;
  } else {
    // Insert new
    const [inserted] = await db.insert(callConsents)
      .values(consentData)
      .returning();
    record = inserted;
  }
  
  const consent = dbToConsent(record);
  consentCache.set(userId, consent);
  return consent;
}

export async function revokeConsent(userId: number): Promise<void> {
  await db.delete(callConsents).where(eq(callConsents.userId, userId));
  consentCache.delete(userId);
}

export async function updateConsent(
  userId: number,
  updates: Partial<Omit<CallConsent, "userId" | "consentTimestamp" | "consentVersion">>
): Promise<CallConsent | null> {
  const existing = await getConsent(userId);
  if (!existing) return null;
  
  const [updated] = await db.update(callConsents)
    .set({
      ...updates,
      consentVersion: CONSENT_VERSION,
    })
    .where(eq(callConsents.userId, userId))
    .returning();
  
  if (!updated) return null;
  
  const consent = dbToConsent(updated);
  consentCache.set(userId, consent);
  return consent;
}

// ============================================================================
// PRE-CALL CONSENT CHECK
// ============================================================================

export interface ConsentCheckResult {
  canProceed: boolean;
  needsConsent: boolean;
  missingDisclosures: string[];
  currentConsent: CallConsent | null;
}

export async function checkPreCallConsent(userId: number): Promise<ConsentCheckResult> {
  const consent = await getConsent(userId);
  
  if (!consent) {
    return {
      canProceed: false,
      needsConsent: true,
      missingDisclosures: Object.keys(PRIVACY_DISCLOSURES).filter(
        key => PRIVACY_DISCLOSURES[key].required
      ),
      currentConsent: null,
    };
  }
  
  // Check version
  if (consent.consentVersion !== CONSENT_VERSION) {
    return {
      canProceed: false,
      needsConsent: true,
      missingDisclosures: ["translationProcessing"], // Re-consent needed
      currentConsent: consent,
    };
  }
  
  // Check required consents
  if (!consent.translationProcessing) {
    return {
      canProceed: false,
      needsConsent: true,
      missingDisclosures: ["translationProcessing"],
      currentConsent: consent,
    };
  }
  
  return {
    canProceed: true,
    needsConsent: false,
    missingDisclosures: [],
    currentConsent: consent,
  };
}

// ============================================================================
// AUDIO DATA HANDLING
// ============================================================================

export interface EphemeralAudioPolicy {
  shouldStore: boolean;
  maxRetentionMs: number;
  encryptionRequired: boolean;
}

export async function getAudioPolicy(userId: number): Promise<EphemeralAudioPolicy> {
  const consent = await getConsent(userId);
  
  if (!consent || !consent.audioRecording) {
    return {
      shouldStore: false,
      maxRetentionMs: 0,
      encryptionRequired: true,
    };
  }
  
  const retentionMap: Record<string, number> = {
    none: 0,
    session: 0, // Delete after call ends
    "7days": 7 * 24 * 60 * 60 * 1000,
    "30days": 30 * 24 * 60 * 60 * 1000,
  };
  
  return {
    shouldStore: true,
    maxRetentionMs: retentionMap[consent.dataRetention] || 0,
    encryptionRequired: true,
  };
}

// ============================================================================
// COMPLIANCE LOGGING
// ============================================================================

interface ConsentAuditLog {
  timestamp: Date;
  userId: number;
  action: "grant" | "revoke" | "update" | "check";
  details: string;
}

const auditLogs: ConsentAuditLog[] = [];

/**
 * Persistence note (P1 foundation hardening investigation, 2026-08-23):
 * This in-memory array was the ONLY record of consent grant/revoke/update/check
 * actions -- non-persistent (lost on every process restart/deploy) and capped
 * at 1000 entries with silent oldest-first eviction. It was also write-only:
 * getAuditLogs() below has zero callers anywhere in the codebase, so nothing
 * ever read this data even while a process was alive. Consent records carry
 * compliance weight (proving what a user agreed to and when), so this is a
 * real gap, not a cosmetic one.
 *
 * Fix applied here is additive, not a replacement: every consent action is
 * now ALSO written to the existing, already-durable `audit_logs` table (via
 * createAuditLog, the same persistent store used for organization approvals,
 * credit adjustments, etc. -- see server/audit.ts) tagged
 * entityType: "call_consent". The in-memory array and its 1000-entry cap are
 * left in place unchanged, so no existing behavior is removed -- this is a
 * durability layer added alongside it, not a silent swap.
 */
export function logConsentAction(
  userId: number,
  action: "grant" | "revoke" | "update" | "check",
  details: string
): void {
  auditLogs.push({
    timestamp: new Date(),
    userId,
    action,
    details,
  });

  // Keep only last 1000 entries in memory
  if (auditLogs.length > 1000) {
    auditLogs.shift();
  }

  // Fire-and-forget persistent write -- never block or throw into the caller,
  // consistent with createAuditLog's own internal try/catch.
  void import("./audit").then(({ createAuditLog }) => createAuditLog({
    userId,
    action: "consent_action",
    entityType: "call_consent",
    entityId: userId,
    metadata: { consentAction: action, details },
  }));
}

export function getAuditLogs(userId?: number): ConsentAuditLog[] {
  if (userId) {
    return auditLogs.filter(log => log.userId === userId);
  }
  return [...auditLogs];
}

// ============================================================================
// TELCO-SAFE MESSAGING
// ============================================================================

export const TELCO_SAFE_MESSAGING = {
  serviceName: "NeuraTalk Communication Enhancement",
  serviceDescription: "Language assistance and translation enhancement for voice calls",
  disclaimers: [
    "This service enhances communication between parties speaking different languages.",
    "NeuraTalk is not a telecommunications provider or carrier.",
    "Standard carrier charges apply to underlying phone calls.",
    "This is an assistive technology layer, not a replacement for telecom services.",
  ],
  complianceNotes: [
    "Service operates as application layer over existing telecom infrastructure",
    "No alteration of underlying telephony protocols",
    "Users maintain their existing carrier relationships",
    "Translation is provided as an accessibility feature",
  ],
};

export function getServiceDisclaimer(): string {
  return `${TELCO_SAFE_MESSAGING.serviceName}: ${TELCO_SAFE_MESSAGING.disclaimers.join(" ")}`;
}
