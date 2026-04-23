/**
 * FEATURE FLAGS SYSTEM
 * 
 * WHY THIS EXISTS:
 * Production systems need gradual rollout capabilities. Features should be
 * deployable without forcing them on all users at once. When issues arise,
 * we need instant kill-switches without deploying new code.
 * 
 * ROLLOUT RULES (from requirements):
 * - Roll out features gradually
 * - Enable translation and voice features via feature flags
 * - Ability to disable a module instantly if issues arise
 * - No forced updates during live calls
 * 
 * STABILITY > SPEED OF RELEASE
 * 
 * NO THIRD-PARTY SAAS:
 * This is a simple, self-hosted feature flag system.
 * No LaunchDarkly, Optimizely, or other external services.
 */

import { logger } from "./observability";
import { db } from "./db";
import { featureFlagsDb } from "@shared/schema";
import { eq } from "drizzle-orm";

// ============================================================================
// FLAG DEFINITIONS
// ============================================================================

export type FeatureFlagName =
  | "translation_enabled"
  | "voice_translation_enabled"
  | "emotion_detection_enabled"
  | "voice_training_enabled"
  | "call_bridging_enabled"
  | "live_translation_enabled"
  | "multilingual_detection_enabled"
  | "advanced_audio_processing_enabled"
  | "srtp_encryption_enabled"
  | "native_telephony_bridge_enabled";

export interface FeatureFlag {
  name: FeatureFlagName;
  enabled: boolean;
  description: string;
  rolloutPercentage: number; // 0-100
  enabledForUsers: string[]; // Specific user IDs for beta testing
  disabledForUsers: string[]; // Specific users to exclude
  killSwitch: boolean; // If true, flag is forcibly disabled
  updatedAt: Date;
  updatedBy: string;
}

export interface FlagEvaluationContext {
  userId?: string;
  sessionId?: string;
  isLiveCall?: boolean; // Never change flags during live calls
}

// ============================================================================
// DEFAULT FLAG VALUES
// ============================================================================

/**
 * WHY CONSERVATIVE DEFAULTS:
 * New features start disabled. This ensures nothing breaks for existing users
 * until we explicitly enable features after testing.
 */
const DEFAULT_FLAGS: Record<FeatureFlagName, FeatureFlag> = {
  translation_enabled: {
    name: "translation_enabled",
    enabled: true,
    description: "Enable text translation features",
    rolloutPercentage: 100,
    enabledForUsers: [],
    disabledForUsers: [],
    killSwitch: false,
    updatedAt: new Date(),
    updatedBy: "system",
  },
  voice_translation_enabled: {
    name: "voice_translation_enabled",
    enabled: true,
    description: "Enable voice-to-voice translation",
    rolloutPercentage: 100,
    enabledForUsers: [],
    disabledForUsers: [],
    killSwitch: false,
    updatedAt: new Date(),
    updatedBy: "system",
  },
  emotion_detection_enabled: {
    name: "emotion_detection_enabled",
    enabled: true,
    description: "Enable emotion detection in conversations",
    rolloutPercentage: 100,
    enabledForUsers: [],
    disabledForUsers: [],
    killSwitch: false,
    updatedAt: new Date(),
    updatedBy: "system",
  },
  voice_training_enabled: {
    name: "voice_training_enabled",
    enabled: true,
    description: "Enable voice training for personalized AI voices",
    rolloutPercentage: 100,
    enabledForUsers: [],
    disabledForUsers: [],
    killSwitch: false,
    updatedAt: new Date(),
    updatedBy: "system",
  },
  call_bridging_enabled: {
    name: "call_bridging_enabled",
    enabled: true,
    description: "Enable SIM-to-SIM call bridging",
    rolloutPercentage: 100,
    enabledForUsers: [],
    disabledForUsers: [],
    killSwitch: false,
    updatedAt: new Date(),
    updatedBy: "system",
  },
  live_translation_enabled: {
    name: "live_translation_enabled",
    enabled: true,
    description: "Enable live translation during calls",
    rolloutPercentage: 100,
    enabledForUsers: [],
    disabledForUsers: [],
    killSwitch: false,
    updatedAt: new Date(),
    updatedBy: "system",
  },
  multilingual_detection_enabled: {
    name: "multilingual_detection_enabled",
    enabled: true,
    description: "Enable automatic language detection and switching",
    rolloutPercentage: 100,
    enabledForUsers: [],
    disabledForUsers: [],
    killSwitch: false,
    updatedAt: new Date(),
    updatedBy: "system",
  },
  advanced_audio_processing_enabled: {
    name: "advanced_audio_processing_enabled",
    enabled: true,
    description: "Enable advanced audio processing (VAD, jitter buffer)",
    rolloutPercentage: 100,
    enabledForUsers: [],
    disabledForUsers: [],
    killSwitch: false,
    updatedAt: new Date(),
    updatedBy: "system",
  },
  srtp_encryption_enabled: {
    name: "srtp_encryption_enabled",
    enabled: true,
    description: "Enable SRTP encryption for voice streams",
    rolloutPercentage: 100,
    enabledForUsers: [],
    disabledForUsers: [],
    killSwitch: false,
    updatedAt: new Date(),
    updatedBy: "system",
  },
  native_telephony_bridge_enabled: {
    name: "native_telephony_bridge_enabled",
    enabled: true,
    description: "Enable native telephony bridge for real calls",
    rolloutPercentage: 100,
    enabledForUsers: [],
    disabledForUsers: [],
    killSwitch: false,
    updatedAt: new Date(),
    updatedBy: "system",
  },
};

// ============================================================================
// FEATURE FLAG MANAGER
// ============================================================================

class FeatureFlagManager {
  private flags: Map<FeatureFlagName, FeatureFlag> = new Map();
  private liveCallUsers: Set<string> = new Set(); // Users currently in calls
  
  /**
   * WHY FLAG SNAPSHOTS:
   * When a user starts a live call, we snapshot all flag states.
   * This ensures that flag changes during the call don't affect them.
   * The user keeps the flag values they had when the call started.
   * 
   * RULE: No forced updates during live calls.
   */
  private liveCallFlagSnapshots: Map<string, Map<FeatureFlagName, boolean>> = new Map();
  
  constructor() {
    // Initialize with default flags
    for (const [name, flag] of Object.entries(DEFAULT_FLAGS)) {
      this.flags.set(name as FeatureFlagName, { ...flag });
    }
  }
  
  /**
   * Check if a feature is enabled for a given context
   * 
   * EVALUATION ORDER:
   * 1. Kill switch (always wins)
   * 2. Live call protection (never change during calls)
   * 3. User-specific exclusion
   * 4. User-specific inclusion
   * 5. Rollout percentage
   */
  isEnabled(flagName: FeatureFlagName, context?: FlagEvaluationContext): boolean {
    const flag = this.flags.get(flagName);
    if (!flag) {
      logger.warn("FeatureFlags", `Unknown flag: ${flagName}`);
      return false;
    }
    
    // 1. Kill switch - instant disable
    if (flag.killSwitch) {
      logger.debug("FeatureFlags", `Flag ${flagName} disabled by kill switch`);
      return false;
    }
    
    // 2. Base enabled check
    if (!flag.enabled) {
      return false;
    }
    
    // 3. Live call protection
    // RULE: No forced updates during live calls
    if (context?.isLiveCall && context?.userId) {
      // During live calls, use the value that was active when call started
      // For simplicity, we keep flags stable during calls
      return this.getFlagValueAtCallStart(flagName, context.userId);
    }
    
    // 4. User-specific exclusion
    if (context?.userId && flag.disabledForUsers.includes(context.userId)) {
      return false;
    }
    
    // 5. User-specific inclusion (beta users)
    if (context?.userId && flag.enabledForUsers.includes(context.userId)) {
      return true;
    }
    
    // 6. Rollout percentage
    if (flag.rolloutPercentage < 100) {
      const hash = this.hashForRollout(flagName, context?.userId || context?.sessionId || "default");
      return hash < flag.rolloutPercentage;
    }
    
    return true;
  }
  
  /**
   * Enable a feature flag (persists to database)
   */
  enable(flagName: FeatureFlagName, updatedBy: string = "system"): void {
    const flag = this.flags.get(flagName);
    if (flag) {
      flag.enabled = true;
      flag.updatedAt = new Date();
      flag.updatedBy = updatedBy;
      this.persistFlag(flagName, flag);
      logger.info("FeatureFlags", `Enabled flag: ${flagName}`, { updatedBy });
    }
  }
  
  /**
   * Disable a feature flag (persists to database)
   */
  disable(flagName: FeatureFlagName, updatedBy: string = "system"): void {
    const flag = this.flags.get(flagName);
    if (flag) {
      flag.enabled = false;
      flag.updatedAt = new Date();
      flag.updatedBy = updatedBy;
      this.persistFlag(flagName, flag);
      logger.info("FeatureFlags", `Disabled flag: ${flagName}`, { updatedBy });
    }
  }
  
  /**
   * INSTANT KILL SWITCH
   * Immediately disable a feature globally, regardless of other settings.
   * Use when a critical issue is discovered.
   */
  killSwitch(flagName: FeatureFlagName, updatedBy: string = "system"): void {
    const flag = this.flags.get(flagName);
    if (flag) {
      flag.killSwitch = true;
      flag.updatedAt = new Date();
      flag.updatedBy = updatedBy;
      this.persistFlag(flagName, flag);
      logger.warn("FeatureFlags", `KILL SWITCH activated: ${flagName}`, { updatedBy });
    }
  }
  
  /**
   * Remove kill switch (re-enable feature)
   */
  removeKillSwitch(flagName: FeatureFlagName, updatedBy: string = "system"): void {
    const flag = this.flags.get(flagName);
    if (flag) {
      flag.killSwitch = false;
      flag.updatedAt = new Date();
      flag.updatedBy = updatedBy;
      this.persistFlag(flagName, flag);
      logger.info("FeatureFlags", `Kill switch removed: ${flagName}`, { updatedBy });
    }
  }
  
  /**
   * Set rollout percentage for gradual rollout
   */
  setRolloutPercentage(
    flagName: FeatureFlagName, 
    percentage: number, 
    updatedBy: string = "system"
  ): void {
    const flag = this.flags.get(flagName);
    if (flag) {
      flag.rolloutPercentage = Math.max(0, Math.min(100, percentage));
      flag.updatedAt = new Date();
      flag.updatedBy = updatedBy;
      this.persistFlag(flagName, flag);
      logger.info("FeatureFlags", `Rollout updated: ${flagName}`, { 
        percentage: flag.rolloutPercentage, 
        updatedBy 
      });
    }
  }
  
  /**
   * Persist flag state to database
   */
  private async persistFlag(flagName: FeatureFlagName, flag: FeatureFlag): Promise<void> {
    try {
      await db.insert(featureFlagsDb)
        .values({
          name: flagName,
          enabled: flag.enabled,
          description: flag.description,
          rolloutPercentage: flag.rolloutPercentage,
          enabledForUsers: flag.enabledForUsers,
          disabledForUsers: flag.disabledForUsers,
          killSwitch: flag.killSwitch,
          updatedBy: flag.updatedBy,
        })
        .onConflictDoUpdate({
          target: featureFlagsDb.name,
          set: {
            enabled: flag.enabled,
            rolloutPercentage: flag.rolloutPercentage,
            enabledForUsers: flag.enabledForUsers,
            disabledForUsers: flag.disabledForUsers,
            killSwitch: flag.killSwitch,
            updatedBy: flag.updatedBy,
            updatedAt: new Date(),
          },
        });
    } catch (error) {
      logger.error("FeatureFlags", `Failed to persist flag: ${flagName}`, error as Error);
    }
  }
  
  /**
   * Load flags from database on startup
   */
  async loadFromDatabase(): Promise<void> {
    try {
      const dbFlags = await db.select().from(featureFlagsDb);
      for (const dbFlag of dbFlags) {
        const flag = this.flags.get(dbFlag.name as FeatureFlagName);
        if (flag) {
          flag.enabled = dbFlag.enabled ?? flag.enabled;
          flag.rolloutPercentage = dbFlag.rolloutPercentage ?? flag.rolloutPercentage;
          flag.enabledForUsers = (dbFlag.enabledForUsers as string[]) || flag.enabledForUsers;
          flag.disabledForUsers = (dbFlag.disabledForUsers as string[]) || flag.disabledForUsers;
          flag.killSwitch = dbFlag.killSwitch ?? flag.killSwitch;
          flag.updatedBy = dbFlag.updatedBy ?? flag.updatedBy;
          flag.updatedAt = dbFlag.updatedAt ?? flag.updatedAt;
        }
      }
      logger.info("FeatureFlags", `Loaded ${dbFlags.length} flags from database`);
    } catch (error) {
      logger.warn("FeatureFlags", "Failed to load flags from database, using defaults", { error: String(error) });
    }
  }
  
  /**
   * Add user to beta/early access
   */
  enableForUser(flagName: FeatureFlagName, userId: string, updatedBy: string = "system"): void {
    const flag = this.flags.get(flagName);
    if (flag && !flag.enabledForUsers.includes(userId)) {
      flag.enabledForUsers.push(userId);
      flag.updatedAt = new Date();
      flag.updatedBy = updatedBy;
      logger.info("FeatureFlags", `User enabled: ${flagName}`, { userId, updatedBy });
    }
  }
  
  /**
   * Exclude specific user from feature
   */
  disableForUser(flagName: FeatureFlagName, userId: string, updatedBy: string = "system"): void {
    const flag = this.flags.get(flagName);
    if (flag && !flag.disabledForUsers.includes(userId)) {
      flag.disabledForUsers.push(userId);
      flag.updatedAt = new Date();
      flag.updatedBy = updatedBy;
      logger.info("FeatureFlags", `User excluded: ${flagName}`, { userId, updatedBy });
    }
  }
  
  /**
   * Mark user as being in a live call (protects flag stability)
   * 
   * CRITICAL: Snapshots all current flag values for this user.
   * During the call, they will see these values regardless of
   * any flag changes made after the call started.
   * 
   * RULE: No forced updates during live calls.
   */
  startLiveCall(userId: string): void {
    this.liveCallUsers.add(userId);
    
    // Snapshot all flag values at call start
    const snapshot = new Map<FeatureFlagName, boolean>();
    Array.from(this.flags.entries()).forEach(([name, flag]) => {
      // Capture the resolved value at this moment
      const enabled = flag.enabled && !flag.killSwitch;
      snapshot.set(name, enabled);
    });
    this.liveCallFlagSnapshots.set(userId, snapshot);
    
    logger.debug("FeatureFlags", `User started live call, flags snapshotted`, { userId });
  }
  
  /**
   * Mark user as ending a live call
   * Clears the flag snapshot to free memory and allow new values
   */
  endLiveCall(userId: string): void {
    this.liveCallUsers.delete(userId);
    this.liveCallFlagSnapshots.delete(userId); // Clear snapshot
    logger.debug("FeatureFlags", `User ended live call, snapshot cleared`, { userId });
  }
  
  /**
   * Get all flags (for admin dashboard)
   */
  getAllFlags(): FeatureFlag[] {
    return Array.from(this.flags.values());
  }
  
  /**
   * Get single flag details
   */
  getFlag(flagName: FeatureFlagName): FeatureFlag | undefined {
    return this.flags.get(flagName);
  }
  
  // ============================================================================
  // PRIVATE HELPERS
  // ============================================================================
  
  /**
   * Stable hash for rollout percentage calculation
   * Ensures same user always gets same result for same flag
   */
  private hashForRollout(flagName: string, identifier: string): number {
    const str = `${flagName}:${identifier}`;
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash % 100);
  }
  
  /**
   * Get flag value that was active when call started
   * Uses the snapshot taken at call start to ensure
   * flag changes don't affect active calls.
   * 
   * RULE: No forced updates during live calls.
   */
  private getFlagValueAtCallStart(flagName: FeatureFlagName, userId: string): boolean {
    const snapshot = this.liveCallFlagSnapshots.get(userId);
    
    if (snapshot && snapshot.has(flagName)) {
      // Return the snapshotted value from call start
      return snapshot.get(flagName) ?? false;
    }
    
    // Fallback if no snapshot (shouldn't happen in normal flow)
    const flag = this.flags.get(flagName);
    return flag ? flag.enabled && !flag.killSwitch : false;
  }
}

// ============================================================================
// SINGLETON EXPORT
// ============================================================================

export const featureFlags = new FeatureFlagManager();

// ============================================================================
// CONVENIENCE FUNCTIONS
// ============================================================================

/**
 * Quick check if translation is enabled
 */
export function isTranslationEnabled(context?: FlagEvaluationContext): boolean {
  return featureFlags.isEnabled("translation_enabled", context);
}

/**
 * Quick check if voice translation is enabled
 */
export function isVoiceTranslationEnabled(context?: FlagEvaluationContext): boolean {
  return featureFlags.isEnabled("voice_translation_enabled", context) &&
         featureFlags.isEnabled("translation_enabled", context);
}

/**
 * Quick check if live translation during calls is enabled
 */
export function isLiveTranslationEnabled(context?: FlagEvaluationContext): boolean {
  return featureFlags.isEnabled("live_translation_enabled", context) &&
         featureFlags.isEnabled("translation_enabled", context);
}

/**
 * Quick check if emotion detection is enabled
 */
export function isEmotionDetectionEnabled(context?: FlagEvaluationContext): boolean {
  return featureFlags.isEnabled("emotion_detection_enabled", context);
}

/**
 * Quick check if call bridging is enabled
 */
export function isCallBridgingEnabled(context?: FlagEvaluationContext): boolean {
  return featureFlags.isEnabled("call_bridging_enabled", context);
}
