/**
 * DATA MINIMIZATION POLICIES
 * 
 * WHY THIS EXISTS:
 * Privacy is a core value. We collect only what is required for functionality,
 * never data "just in case". This module enforces data minimization rules
 * across the system.
 * 
 * DATA MINIMIZATION RULES (from requirements):
 * - Collect only what is required for functionality
 * - Do not collect data "just in case"
 * - Avoid long-term storage of transient data
 * - Default to privacy-first choices
 * 
 * CORE PRINCIPLE:
 * Less data = more trust
 */

import { logger } from "./observability";

// ============================================================================
// DATA CATEGORIES
// ============================================================================

export type DataCategory = 
  | "essential"      // Required for core functionality
  | "functional"     // Improves functionality but not required
  | "analytics"      // Performance metrics (anonymized)
  | "transient";     // Temporary data, never stored

export interface DataField {
  name: string;
  category: DataCategory;
  retentionMs: number; // How long to keep, 0 = session only
  anonymizable: boolean;
  description: string;
}

// ============================================================================
// DATA RETENTION POLICIES
// ============================================================================

/**
 * WHY SPECIFIC RETENTION PERIODS:
 * - Session data (0ms): Never stored beyond the session
 * - Short-term (1 hour): Debugging and recent activity
 * - Medium-term (24 hours): Daily operational needs
 * - Long-term (7 days): Only essential data
 */
export const RETENTION_PERIODS = {
  SESSION_ONLY: 0,
  ONE_HOUR: 3600000,
  ONE_DAY: 86400000,
  SEVEN_DAYS: 604800000,
} as const;

/**
 * Defines what data we collect and why
 * This is our data inventory - exhaustive and honest
 */
export const DATA_INVENTORY: DataField[] = [
  // Essential data - required for functionality
  {
    name: "user_id",
    category: "essential",
    retentionMs: RETENTION_PERIODS.SEVEN_DAYS,
    anonymizable: false,
    description: "User identifier for authentication",
  },
  {
    name: "session_id",
    category: "essential",
    retentionMs: RETENTION_PERIODS.SESSION_ONLY,
    anonymizable: true,
    description: "Session tracking for active connections",
  },
  {
    name: "language_preference",
    category: "essential",
    retentionMs: RETENTION_PERIODS.SEVEN_DAYS,
    anonymizable: false,
    description: "User's preferred language for translation",
  },
  
  // Functional data - improves experience
  {
    name: "voice_profile_id",
    category: "functional",
    retentionMs: RETENTION_PERIODS.SEVEN_DAYS,
    anonymizable: true,
    description: "Reference to trained voice model",
  },
  {
    name: "emotion_preferences",
    category: "functional",
    retentionMs: RETENTION_PERIODS.SEVEN_DAYS,
    anonymizable: true,
    description: "Preferred emotional AI responses",
  },
  
  // Analytics data - anonymized metrics
  {
    name: "call_latency_ms",
    category: "analytics",
    retentionMs: RETENTION_PERIODS.ONE_DAY,
    anonymizable: true,
    description: "Call performance metrics",
  },
  {
    name: "translation_success_rate",
    category: "analytics",
    retentionMs: RETENTION_PERIODS.ONE_DAY,
    anonymizable: true,
    description: "Translation quality metrics",
  },
  
  // Transient data - never stored
  {
    name: "audio_buffer",
    category: "transient",
    retentionMs: RETENTION_PERIODS.SESSION_ONLY,
    anonymizable: false,
    description: "Audio being processed - never persisted",
  },
  {
    name: "transcription_text",
    category: "transient",
    retentionMs: RETENTION_PERIODS.SESSION_ONLY,
    anonymizable: false,
    description: "Speech-to-text output - never persisted",
  },
  {
    name: "call_content",
    category: "transient",
    retentionMs: RETENTION_PERIODS.SESSION_ONLY,
    anonymizable: false,
    description: "Actual call content - NEVER stored",
  },
];

// ============================================================================
// DATA MINIMIZATION ENFORCER
// ============================================================================

class DataMinimizationEnforcer {
  private inventory: Map<string, DataField> = new Map();
  private collectionLog: Map<string, { timestamp: Date; reason: string }[]> = new Map();
  
  constructor() {
    for (const field of DATA_INVENTORY) {
      this.inventory.set(field.name, field);
    }
  }
  
  /**
   * Check if a data field can be collected
   * Returns false if data is not in inventory or should not be collected
   */
  canCollect(fieldName: string, reason?: string): boolean {
    const field = this.inventory.get(fieldName);
    
    if (!field) {
      logger.warn("DataMinimization", `Attempted to collect unlisted data: ${fieldName}`);
      return false;
    }
    
    // Log collection attempt for audit
    if (reason) {
      this.logCollectionAttempt(fieldName, reason);
    }
    
    return true;
  }
  
  /**
   * Get the retention period for a data field
   */
  getRetentionMs(fieldName: string): number {
    const field = this.inventory.get(fieldName);
    return field ? field.retentionMs : 0;
  }
  
  /**
   * Check if data should be anonymized
   */
  shouldAnonymize(fieldName: string): boolean {
    const field = this.inventory.get(fieldName);
    return field ? field.anonymizable : true; // Default to anonymize
  }
  
  /**
   * Get category of a data field
   */
  getCategory(fieldName: string): DataCategory | undefined {
    return this.inventory.get(fieldName)?.category;
  }
  
  /**
   * Validate that we're not collecting "just in case" data
   * Call this before any data collection
   */
  validateCollectionReason(fieldName: string, reason: string): {
    allowed: boolean;
    message: string;
  } {
    const field = this.inventory.get(fieldName);
    
    if (!field) {
      return {
        allowed: false,
        message: `Data field "${fieldName}" is not in the approved inventory. Collection denied.`,
      };
    }
    
    // Check for "just in case" patterns
    const justInCasePatterns = [
      "might need",
      "just in case",
      "future use",
      "maybe later",
      "could be useful",
    ];
    
    const lowerReason = reason.toLowerCase();
    for (const pattern of justInCasePatterns) {
      if (lowerReason.includes(pattern)) {
        return {
          allowed: false,
          message: `Collection reason "${reason}" suggests "just in case" collection. This violates data minimization policy.`,
        };
      }
    }
    
    return {
      allowed: true,
      message: `Collection approved for ${fieldName}: ${reason}`,
    };
  }
  
  /**
   * Check if data should be deleted based on retention
   */
  shouldDelete(fieldName: string, createdAt: Date): boolean {
    const retentionMs = this.getRetentionMs(fieldName);
    
    // Session-only data should always be deleted
    if (retentionMs === 0) {
      return true;
    }
    
    const age = Date.now() - createdAt.getTime();
    return age > retentionMs;
  }
  
  /**
   * Get all transient fields that should never be stored
   */
  getTransientFields(): string[] {
    return DATA_INVENTORY
      .filter(f => f.category === "transient")
      .map(f => f.name);
  }
  
  /**
   * Generate privacy report for auditing
   */
  generatePrivacyReport(): {
    totalFields: number;
    byCategory: Record<DataCategory, number>;
    transientFields: string[];
    longestRetention: { field: string; days: number };
  } {
    const byCategory: Record<DataCategory, number> = {
      essential: 0,
      functional: 0,
      analytics: 0,
      transient: 0,
    };
    
    let longestRetention = { field: "", days: 0 };
    
    for (const field of DATA_INVENTORY) {
      byCategory[field.category]++;
      const days = field.retentionMs / 86400000;
      if (days > longestRetention.days) {
        longestRetention = { field: field.name, days };
      }
    }
    
    return {
      totalFields: DATA_INVENTORY.length,
      byCategory,
      transientFields: this.getTransientFields(),
      longestRetention,
    };
  }
  
  // ============================================================================
  // PRIVATE HELPERS
  // ============================================================================
  
  private logCollectionAttempt(fieldName: string, reason: string): void {
    const attempts = this.collectionLog.get(fieldName) || [];
    attempts.push({ timestamp: new Date(), reason });
    
    // Keep only last 100 attempts per field
    if (attempts.length > 100) {
      attempts.shift();
    }
    
    this.collectionLog.set(fieldName, attempts);
  }
}

// ============================================================================
// PRIVACY-FIRST DEFAULTS
// ============================================================================

export interface PrivacyDefaults {
  storeCallContent: false;
  shareDataWithThirdParties: false;
  enableAnalytics: boolean;
  anonymizeMetrics: true;
  retentionDays: number;
}

/**
 * WHY THESE DEFAULTS:
 * Privacy-first means the default is always the most protective option.
 * Users can opt-in to less privacy if they choose.
 */
export const PRIVACY_DEFAULTS: PrivacyDefaults = {
  storeCallContent: false, // NEVER store call content
  shareDataWithThirdParties: false, // NEVER share
  enableAnalytics: true, // Anonymized only
  anonymizeMetrics: true, // Always anonymize
  retentionDays: 7, // Maximum 7 days
};

/**
 * Check if a privacy setting is safe
 */
export function isPrivacySafe(setting: string, value: unknown): boolean {
  switch (setting) {
    case "storeCallContent":
      return value === false;
    case "shareDataWithThirdParties":
      return value === false;
    case "retentionDays":
      return typeof value === "number" && value <= 30;
    default:
      return true;
  }
}

// ============================================================================
// SINGLETON EXPORT
// ============================================================================

export const dataMinimization = new DataMinimizationEnforcer();

// ============================================================================
// CONVENIENCE FUNCTIONS
// ============================================================================

/**
 * Quick check if a field should never be stored
 */
export function isTransientData(fieldName: string): boolean {
  return dataMinimization.getCategory(fieldName) === "transient";
}

/**
 * Quick check if data collection is allowed with reason
 */
export function canCollectData(fieldName: string, reason: string): boolean {
  const validation = dataMinimization.validateCollectionReason(fieldName, reason);
  if (!validation.allowed) {
    logger.warn("DataMinimization", validation.message);
  }
  return validation.allowed;
}
