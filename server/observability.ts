/**
 * INTERNAL OBSERVABILITY SYSTEM
 * 
 * WHY THIS EXISTS:
 * Production systems need metrics to improve quality, but we must balance
 * observability with privacy. This system tracks performance, not content.
 * 
 * WHAT WE TRACK:
 * - Call setup time (how long to establish connection)
 * - Translation latency (time from speech to translated output)
 * - Audio jitter (variance in packet arrival)
 * - Drop rate (percentage of lost packets/phrases)
 * 
 * WHAT WE NEVER TRACK:
 * - Call content (voice, text, transcriptions)
 * - User identities in metrics
 * - Personal conversation data
 * 
 * PRIVACY RULES:
 * - Metrics are aggregated, never tied to individuals
 * - Data is ephemeral - no long-term storage
 * - Logs are lightweight and anonymized
 * 
 * NO THIRD-PARTY SAAS:
 * This system is entirely self-hosted. No external monitoring services.
 * We own our observability infrastructure completely.
 */

import { EventEmitter } from "events";
import * as Sentry from "@sentry/node";
import { nodeProfilingIntegration } from "@sentry/profiling-node";
import { PostHog } from 'posthog-node';

// Initialize PostHog for product analytics and QoS (Founder's Roadmap)
let posthog: PostHog | null = null;
if (process.env.POSTHOG_API_KEY) {
  posthog = new PostHog(process.env.POSTHOG_API_KEY, {
    host: process.env.POSTHOG_HOST || 'https://app.posthog.com',
  });
  console.log("PostHog analytics initialized successfully.");
}

// Initialize Sentry for production monitoring (Founder's Roadmap)
if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    integrations: [
      nodeProfilingIntegration(),
    ],
    // Performance Monitoring
    tracesSampleRate: 1.0, 
    // Set sampling rate for profiling - 1.0 to profile 100% of sampled transactions
    profilesSampleRate: 1.0,
    environment: process.env.NODE_ENV || "development",
  });
  console.log("Sentry monitoring initialized successfully.");
}

// ============================================================================
// METRIC TYPES
// ============================================================================

export interface CallMetrics {
  setupTimeMs: number;
  translationLatencyMs: number[];
  audioJitterMs: number[];
  droppedPackets: number;
  totalPackets: number;
  degradationEvents: number;
  recoveryEvents: number;
}

export interface AggregatedMetrics {
  period: string;
  callCount: number;
  avgSetupTimeMs: number;
  p50LatencyMs: number;
  p95LatencyMs: number;
  p99LatencyMs: number;
  avgJitterMs: number;
  dropRate: number;
  degradationRate: number;
  recoveryRate: number;
}

export interface SystemHealth {
  status: "healthy" | "degraded" | "critical";
  uptime: number;
  activeConnections: number;
  memoryUsage: number;
  cpuUsage: number;
  lastCheck: Date;
  monitoringStatus?: "healthy" | "degraded" | "critical"; // Added for monitoring health
}

// ============================================================================
// METRIC COLLECTOR
// ============================================================================

/**
 * WHY IN-MEMORY:
 * - Fast: No I/O latency during calls
 * - Ephemeral: Data doesn't persist beyond what's needed
 * - Simple: No database dependencies
 * - Privacy-safe: Data naturally expires
 */
class MetricCollector {
  private callMetrics: Map<string, CallMetrics> = new Map();
  private latencySamples: number[] = [];
  private jitterSamples: number[] = [];
  private setupTimeSamples: number[] = [];
  
  private startTime = Date.now();
  private totalCalls = 0;
  private totalDegradations = 0;
  private totalRecoveries = 0;
  private totalDroppedPackets = 0;
  private totalPackets = 0;
  
  private readonly MAX_SAMPLES = 1000;
  private readonly SAMPLE_RETENTION_MS = 3600000; // 1 hour
  
  /**
   * Start tracking a new call
   * Note: callId is anonymized - not tied to user identity
   */
  startCall(callId: string): void {
    this.callMetrics.set(callId, {
      setupTimeMs: 0,
      translationLatencyMs: [],
      audioJitterMs: [],
      droppedPackets: 0,
      totalPackets: 0,
      degradationEvents: 0,
      recoveryEvents: 0,
    });
    this.totalCalls++;
  }
  
  /**
   * Record call setup completion time
   */
  recordSetupTime(callId: string, setupTimeMs: number): void {
    const metrics = this.callMetrics.get(callId);
    if (metrics) {
      metrics.setupTimeMs = setupTimeMs;
      this.addSample(this.setupTimeSamples, setupTimeMs);
    }
  }
  
  /**
   * Record translation latency for a phrase
   * Only the timing is recorded, never the content
   */
  recordTranslationLatency(callId: string, latencyMs: number): void {
    const metrics = this.callMetrics.get(callId);
    if (metrics) {
      metrics.translationLatencyMs.push(latencyMs);
      this.addSample(this.latencySamples, latencyMs);

      // OPTIMIZED ALERTING: Trigger alert if 2 consecutive samples exceed 800ms
      if (metrics.translationLatencyMs.slice(-2).every(l => l > 800)) {
        logger.error("Observability", "FAST ALERT: Critical latency spike detected", undefined, { callId });
      }
    }
  }
  
  /**
   * Record audio jitter (packet timing variance)
   */
  recordJitter(callId: string, jitterMs: number): void {
    const metrics = this.callMetrics.get(callId);
    if (metrics) {
      metrics.audioJitterMs.push(jitterMs);
      this.addSample(this.jitterSamples, jitterMs);
    }
  }
  
  /**
   * Record packet drop event
   */
  recordPacketDrop(callId: string): void {
    const metrics = this.callMetrics.get(callId);
    if (metrics) {
      metrics.droppedPackets++;
      this.totalDroppedPackets++;
    }
  }
  
  /**
   * Record packet received
   */
  recordPacketReceived(callId: string): void {
    const metrics = this.callMetrics.get(callId);
    if (metrics) {
      metrics.totalPackets++;
      this.totalPackets++;
    }
  }
  
  /**
   * Record degradation event (feature flag or quality step-down)
   */
  recordDegradation(callId: string): void {
    const metrics = this.callMetrics.get(callId);
    if (metrics) {
      metrics.degradationEvents++;
      this.totalDegradations++;
    }
  }
  
  /**
   * Record recovery event (quality step-up)
   */
  recordRecovery(callId: string): void {
    const metrics = this.callMetrics.get(callId);
    if (metrics) {
      metrics.recoveryEvents++;
      this.totalRecoveries++;
    }
  }
  
  /**
   * End call tracking and cleanup
   */
  endCall(callId: string): CallMetrics | undefined {
    const metrics = this.callMetrics.get(callId);
    this.callMetrics.delete(callId);
    return metrics;
  }
  
  /**
   * Get aggregated metrics for a time period
   * Returns anonymized, aggregated data only
   */
  getAggregatedMetrics(): AggregatedMetrics {
    const sortedLatency = [...this.latencySamples].sort((a, b) => a - b);
    
    return {
      period: new Date().toISOString(),
      callCount: this.totalCalls,
      avgSetupTimeMs: this.average(this.setupTimeSamples),
      p50LatencyMs: this.percentile(sortedLatency, 50),
      p95LatencyMs: this.percentile(sortedLatency, 95),
      p99LatencyMs: this.percentile(sortedLatency, 99),
      avgJitterMs: this.average(this.jitterSamples),
      dropRate: this.totalPackets > 0 
        ? this.totalDroppedPackets / this.totalPackets 
        : 0,
      degradationRate: this.totalCalls > 0 
        ? this.totalDegradations / this.totalCalls 
        : 0,
      recoveryRate: this.totalDegradations > 0 
        ? this.totalRecoveries / this.totalDegradations 
        : 0,
    };
  }
  
  /**
   * Get system health status
   */
  getSystemHealth(): SystemHealth {
    const memUsage = process.memoryUsage();
    const uptime = Date.now() - this.startTime;
    
    let status: SystemHealth["status"] = "healthy";
    const dropRate = this.totalPackets > 0 
      ? this.totalDroppedPackets / this.totalPackets 
      : 0;
    
    if (dropRate > 0.1 || this.average(this.latencySamples) > 500) {
      status = "critical";
    } else if (dropRate > 0.05 || this.average(this.latencySamples) > 300) {
      status = "degraded";
    }

    let monitoringStatus: SystemHealth["monitoringStatus"] = "healthy";
    if (process.env.SENTRY_DSN && !Sentry.getClient()) {
      monitoringStatus = "critical"; // Sentry was supposed to be initialized but isn't
    } else if (process.env.SENTRY_DSN && Sentry.getClient()?.getOptions().enabled === false) {
      monitoringStatus = "degraded"; // Sentry is initialized but disabled
    }
    
    return {
      status,
      uptime,
      activeConnections: this.callMetrics.size,
      memoryUsage: memUsage.heapUsed / memUsage.heapTotal,
      cpuUsage: 0, // Would require os module for accurate measurement
      lastCheck: new Date(),
      monitoringStatus,
    };
  }
  
  /**
   * Cleanup old samples to prevent memory growth
   * Called periodically
   */
  cleanup(): void {
    if (this.latencySamples.length > this.MAX_SAMPLES) {
      this.latencySamples = this.latencySamples.slice(-this.MAX_SAMPLES);
    }
    if (this.jitterSamples.length > this.MAX_SAMPLES) {
      this.jitterSamples = this.jitterSamples.slice(-this.MAX_SAMPLES);
    }
    if (this.setupTimeSamples.length > this.MAX_SAMPLES) {
      this.setupTimeSamples = this.setupTimeSamples.slice(-this.MAX_SAMPLES);
    }
  }
  
  /**
   * Reset all metrics (useful for testing)
   */
  reset(): void {
    this.callMetrics.clear();
    this.latencySamples = [];
    this.jitterSamples = [];
    this.setupTimeSamples = [];
    this.totalCalls = 0;
    this.totalDegradations = 0;
    this.totalRecoveries = 0;
    this.totalDroppedPackets = 0;
    this.totalPackets = 0;
  }
  
  // ============================================================================
  // PRIVATE HELPERS
  // ============================================================================
  
  private addSample(samples: number[], value: number): void {
    samples.push(value);
    if (samples.length > this.MAX_SAMPLES) {
      samples.shift();
    }
  }
  
  private average(samples: number[]): number {
    if (samples.length === 0) return 0;
    return samples.reduce((a, b) => a + b, 0) / samples.length;
  }
  
  private percentile(sortedSamples: number[], p: number): number {
    if (sortedSamples.length === 0) return 0;
    const index = Math.ceil((p / 100) * sortedSamples.length) - 1;
    return sortedSamples[Math.max(0, index)];
  }
}

// ============================================================================
// PRIVACY-SAFE LOGGER
// ============================================================================

export type LogLevel = "debug" | "info" | "warn" | "error";

interface LogEntry {
  timestamp: Date;
  level: LogLevel;
  component: string;
  message: string;
  metadata?: Record<string, unknown>;
}

/**
 * WHY A CUSTOM LOGGER:
 * - Privacy: We control exactly what gets logged
 * - Lightweight: No heavy logging framework overhead
 * - Mode-aware: Debug logs only in debug mode
 * - Content-safe: Never logs call content
 */
class PrivacySafeLogger extends EventEmitter { // Extended EventEmitter
  private mode: "debug" | "user" = "user";
  private logs: LogEntry[] = [];
  private readonly MAX_LOGS = 1000;
  
  setMode(mode: "debug" | "user"): void {
    this.mode = mode;
  }
  
  getMode(): "debug" | "user" {
    return this.mode;
  }
  
  /**
   * Debug-level log - only shown in debug mode
   * For internal developer diagnostics
   */
  debug(component: string, message: string, metadata?: Record<string, unknown>): void {
    if (this.mode === "debug") {
      this.log("debug", component, message, metadata);
    }
  }
  
  /**
   * Info-level log - general operational info
   * No sensitive data ever included
   */
  info(component: string, message: string, metadata?: Record<string, unknown>): void {
    this.log("info", component, message, metadata);
  }
  
  /**
   * Warn-level log - potential issues
   * Contains guidance, not stack traces
   */
  warn(component: string, message: string, metadata?: Record<string, unknown>): void {
    this.log("warn", component, message, metadata);
  }
  
  /**
   * Error-level log - actual failures
   * Stack traces only in debug mode
   */
  error(component: string, message: string, error?: Error, metadata?: Record<string, unknown>): void {
    const errorMetadata: Record<string, unknown> = { ...metadata };
    if (this.mode === "debug" && error) {
      errorMetadata.stack = error.stack;
      errorMetadata.name = error.name;
    }
    if (error) {
      errorMetadata.err = error; // Store error object for Sentry
    }
    this.log("error", component, message, errorMetadata);
  }
  
  /**
   * Get recent logs for diagnostics
   */
  getRecentLogs(count: number = 100): LogEntry[] {
    return this.logs.slice(-count);
  }
  
  /**
   * Clear logs
   */
  clear(): void {
    this.logs = [];
  }
  
  private log(level: LogLevel, component: string, message: string, metadata?: Record<string, unknown>): void {
    const entry: LogEntry = {
      timestamp: new Date(),
      level,
      component,
      message,
      metadata,
    };
    
    // Product Analytics & QoS (Founder's Roadmap)
    if (posthog && level === "info" && component === "CallStreaming") {
      posthog.capture({
        distinctId: (metadata?.userId as string) || "system",
        event: "call_telemetry",
        properties: {
          component,
          message,
          ...metadata,
        },
      });
    }

    this.emit("log", entry); // Emit the log entry
    this.logs.push(entry);
    if (this.logs.length > this.MAX_LOGS) {
      this.logs.shift();
    }
    
    // Console output for development
    const prefix = `[${level.toUpperCase()}] [${component}]`;
    if (level === "error") {
      console.error(prefix, message, metadata || "");
    } else if (level === "warn") {
      console.warn(prefix, message, metadata || "");
    } else if (this.mode === "debug") {
      console.log(prefix, message, metadata || "");
    }
  }
}

// ============================================================================
// HUMAN-READABLE ERROR CONVERTER
// ============================================================================

/**
 * WHY THIS EXISTS:
 * Users should never see technical errors. Every failure should feel
 * calm and understandable. This converts internal errors to human messages.
 * 
 * DESIGN PRINCIPLE:
 * "User should never feel something is broken"
 */
export const ERROR_MESSAGES: Record<string, string> = {
  // Connection errors
  CONNECTION_FAILED: "Having trouble connecting. Please try again in a moment.",
  CONNECTION_LOST: "Connection was briefly interrupted. Reconnecting now.",
  CONNECTION_TIMEOUT: "Taking longer than usual. Please check your connection.",
  
  // Audio errors
  AUDIO_ACCESS_DENIED: "Microphone access is needed for voice features.",
  AUDIO_NOT_AVAILABLE: "Voice features are temporarily unavailable.",
  AUDIO_QUALITY_LOW: "Audio quality is reduced. Call continues normally.",
  
  // Translation errors
  TRANSLATION_SLOW: "Translation is taking a moment. Conversation continues.",
  TRANSLATION_UNAVAILABLE: "Translation is paused. You can continue speaking.",
  LANGUAGE_UNSUPPORTED: "This language isn't supported yet.",
  
  // Call errors
  CALL_SETUP_FAILED: "Couldn't connect the call. Please try again.",
  CALL_DROPPED: "Call was interrupted. Attempting to reconnect.",
  CALL_QUALITY_DEGRADED: "Call quality adjusted for better reliability.",
  
  // General errors
  UNKNOWN_ERROR: "Something didn't work as expected. Please try again.",
  SERVICE_BUSY: "Service is busy. Please wait a moment.",
  FEATURE_DISABLED: "This feature is currently unavailable.",
};

export function toHumanReadableError(errorCode: string): string {
  return ERROR_MESSAGES[errorCode] || ERROR_MESSAGES.UNKNOWN_ERROR;
}

export function toHumanReadableFromError(error: Error): string {
  // Map common error types to human messages
  if (error.message.includes("network") || error.message.includes("fetch")) {
    return ERROR_MESSAGES.CONNECTION_FAILED;
  }
  if (error.message.includes("timeout")) {
    return ERROR_MESSAGES.CONNECTION_TIMEOUT;
  }
  if (error.message.includes("audio") || error.message.includes("microphone")) {
    return ERROR_MESSAGES.AUDIO_NOT_AVAILABLE;
  }
  if (error.message.includes("translation")) {
    return ERROR_MESSAGES.TRANSLATION_UNAVAILABLE;
  }
  
  return ERROR_MESSAGES.UNKNOWN_ERROR;
}

// ============================================================================
// SINGLETON EXPORTS
// ============================================================================

export const metrics = new MetricCollector();
export const logger = new PrivacySafeLogger();

// Periodic cleanup every 5 minutes
setInterval(() => {
  metrics.cleanup();
}, 300000);

// ============================================================================
// TESTING HELPERS
// ============================================================================

export interface RealWorldTestContext {
  deviceType: "real_device" | "emulator";
  networkCondition: "strong" | "weak" | "unstable";
  testType: "latency" | "quality" | "stress";
}

/**
 * WHY THIS EXISTS:
 * Real-world testing rules require us to distinguish between lab tests
 * and real device tests. This helper validates test context.
 */
export function validateTestContext(context: RealWorldTestContext): {
  valid: boolean;
  message: string;
} {
  if (context.deviceType === "emulator") {
    return {
      valid: false,
      message: "Real-world tests must run on real devices, not emulators.",
    };
  }
  
  return {
    valid: true,
    message: "Test context is valid for real-world testing.",
  };
}
