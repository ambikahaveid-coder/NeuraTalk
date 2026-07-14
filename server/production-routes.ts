/**
 * PRODUCTION READINESS ROUTES
 * 
 * WHY THIS EXISTS:
 * These endpoints support enterprise-grade compliance, monitoring, and safety:
 * - Health monitoring for uptime indicators
 * - Rate limiting for abuse protection
 * - Version management for forced updates
 * - Consent management for privacy compliance
 * - Data subject requests for GDPR/privacy
 * - Abuse reporting for content moderation
 * - Accessibility preferences
 * 
 * AUDIT READY:
 * All routes are designed to pass government, enterprise, and investor scrutiny.
 */

import type { Express, Request, Response, NextFunction } from "express";
import { db } from "./db";
import { 
  appVersions, rateLimitRules, abuseReports, userSuspensions,
  userConsents, dataSubjectRequests, backupJobs, systemHealthLogs,
  userAccessibilityPrefs, dataResidencyPolicies, environmentConfigs,
  users, bridgedCalls, registeredDevices
} from "@shared/schema";
import { eq, desc, and, sql, gte } from "drizzle-orm";
import { z } from "zod";
import { loadUser, requireAuth, requireSuperAdmin } from "./role-middleware";
import { logger } from "./observability";
import { getRedisClient, getRedisRuntimeStatus } from "./redis";
import { isMSG91Healthy } from "./msg91-service";
import { hasWorkingOpenAIKey } from "./openai-config";

// ============================================================================
// RATE LIMITING MIDDLEWARE (In-memory with database-driven config)
// ============================================================================

interface RateLimitEntry {
  count: number;
  windowStart: number;
  blockedUntil?: number;
}

interface RateLimitConfig {
  windowMs: number;
  maxRequests: number;
  keyType: "ip" | "user";
  bypassRoles: string[];
}

const rateLimitStore = new Map<string, RateLimitEntry>();
const rateLimitConfigCache = new Map<string, RateLimitConfig>();
let lastConfigLoad = 0;
const CONFIG_TTL = 60000; // Reload config every 60 seconds

// Default rate limits (fallback if database is unavailable)
const DEFAULT_LIMITS: Record<string, RateLimitConfig> = {
  auth: { windowMs: 60000, maxRequests: 10, keyType: "ip", bypassRoles: ["super_admin"] },
  api: { windowMs: 60000, maxRequests: 100, keyType: "user", bypassRoles: ["super_admin"] },
  upload: { windowMs: 60000, maxRequests: 5, keyType: "user", bypassRoles: [] },
  strict: { windowMs: 60000, maxRequests: 3, keyType: "ip", bypassRoles: ["super_admin"] },
};

// Mapping from rule names in database to middleware type keys
const RULE_NAME_TO_TYPE: Record<string, string> = {
  "auth_limit": "auth",
  "api_general": "api",
  "upload_limit": "upload",
  "investor_signup": "strict",
};

// Load rate limit rules from database
async function loadRateLimitConfig(): Promise<void> {
  const now = Date.now();
  if (now - lastConfigLoad < CONFIG_TTL && rateLimitConfigCache.size > 0) {
    return; // Use cached config
  }
  
  try {
    const rules = await db.select().from(rateLimitRules).where(eq(rateLimitRules.isEnabled, true));
    
    rateLimitConfigCache.clear();
    for (const rule of rules) {
      // Normalize the rule name to a key
      const normalizedName = rule.name.toLowerCase().replace(/\s+/g, "_");
      // Map to middleware type key, or use normalized name as fallback
      const typeKey = RULE_NAME_TO_TYPE[normalizedName] || normalizedName;
      
      rateLimitConfigCache.set(typeKey, {
        windowMs: rule.windowMs,
        maxRequests: rule.maxRequests,
        keyType: rule.keyType as "ip" | "user",
        bypassRoles: (() => {
          try {
            const parsed = JSON.parse(String(rule.bypassRoles || "[]"));
            return Array.isArray(parsed) ? parsed : [parsed];
          } catch {
            return rule.bypassRoles ? [rule.bypassRoles] : [];
          }
        })(),
      });
    }
    lastConfigLoad = now;
  } catch (error) {
    logger.warn("RateLimit", "Failed to load config from database, using defaults", { error });
    // Keep using defaults on error
  }
}

function getRateLimitConfig(type: string): RateLimitConfig {
  return rateLimitConfigCache.get(type) || DEFAULT_LIMITS[type] || DEFAULT_LIMITS.api;
}

export function createRateLimiter(type: string = "api") {
  return async (req: Request, res: Response, next: NextFunction) => {
    // Load config (cached, reloads periodically)
    await loadRateLimitConfig();
    
    const config = getRateLimitConfig(type);
    const now = Date.now();
    
    // Check for bypass roles
    const userRole = (req as any).user?.role;
    if (userRole && config.bypassRoles.includes(userRole)) {
      return next(); // Bypass rate limiting for privileged roles
    }
    
    // Build key based on config
    const userId = (req as any).user?.id;
    const keyPart = config.keyType === "user" && userId ? `user:${userId}` : `ip:${req.ip}`;
    const key = `${type}:${keyPart}`;
    
    let entry = rateLimitStore.get(key);
    
    // Check if currently blocked
    if (entry?.blockedUntil && now < entry.blockedUntil) {
      const retryAfter = Math.ceil((entry.blockedUntil - now) / 1000);
      res.set("Retry-After", String(retryAfter));
      res.set("X-RateLimit-Limit", String(config.maxRequests));
      res.set("X-RateLimit-Remaining", "0");
      return res.status(429).json({
        success: false,
        message: "Too many requests. Please try again later.",
        retryAfter,
      });
    }
    
    // Reset window if expired
    if (!entry || now - entry.windowStart > config.windowMs) {
      entry = { count: 0, windowStart: now };
    }
    
    entry.count++;
    
    // Check if limit exceeded
    if (entry.count > config.maxRequests) {
      entry.blockedUntil = now + config.windowMs;
      rateLimitStore.set(key, entry);
      
      const retryAfter = Math.ceil(config.windowMs / 1000);
      res.set("Retry-After", String(retryAfter));
      res.set("X-RateLimit-Limit", String(config.maxRequests));
      res.set("X-RateLimit-Remaining", "0");
      
      logger.warn("RateLimit", "Rate limit exceeded", { ip: req.ip, type, key });
      
      return res.status(429).json({
        success: false,
        message: "Too many requests. Please try again later.",
        retryAfter,
      });
    }
    
    rateLimitStore.set(key, entry);
    
    res.set("X-RateLimit-Limit", String(config.maxRequests));
    res.set("X-RateLimit-Remaining", String(config.maxRequests - entry.count));
    res.set("X-RateLimit-Reset", String(Math.ceil((entry.windowStart + config.windowMs) / 1000)));
    
    next();
  };
}

// Clean up old rate limit entries periodically
setInterval(() => {
  const now = Date.now();
  const keysToDelete: string[] = [];
  rateLimitStore.forEach((entry, key) => {
    if (now - entry.windowStart > 300000) { // 5 minutes
      keysToDelete.push(key);
    }
  });
  keysToDelete.forEach(key => rateLimitStore.delete(key));
}, 60000); // Clean every minute

// ============================================================================
// SCHEMAS
// ============================================================================

const versionCheckSchema = z.object({
  platform: z.enum(["ios", "android", "web"]),
  currentVersion: z.string(),
});

const consentSchema = z.object({
  consentType: z.string(),
  granted: z.boolean(),
  version: z.string(),
  scope: z.string().optional(),
  scopeId: z.number().optional(),
});

const abuseReportSchema = z.object({
  reportedUserId: z.number().optional(),
  reportedEntityType: z.string().optional(),
  reportedEntityId: z.number().optional(),
  category: z.string(),
  description: z.string().optional(),
});

const accessibilityPrefsSchema = z.object({
  highContrast: z.boolean().optional(),
  reducedMotion: z.boolean().optional(),
  fontSize: z.enum(["small", "medium", "large", "x-large"]).optional(),
  screenReaderOptimized: z.boolean().optional(),
  colorBlindMode: z.enum(["protanopia", "deuteranopia", "tritanopia"]).nullish(),
  keyboardNavigation: z.boolean().optional(),
  captionsEnabled: z.boolean().optional(),
});

const dataRequestSchema = z.object({
  requestType: z.enum(["export", "deletion", "rectification", "restriction", "portability"]),
  requestDetails: z.record(z.any()).optional(),
});

const pushTokenSchema = z.object({
  token: z.string().min(1),
  platform: z.enum(["ios", "android", "web"]),
});

// ============================================================================
// ROUTE REGISTRATION
// ============================================================================

export function registerProductionRoutes(app: Express): void {
  // ========================================================================
  // PUSH NOTIFICATION BRIDGE (Mobile-Web Gap Fix)
  // ========================================================================
  
  /**
   * Register device token for push notifications
   * Required for bridging calls between Web and Mobile
   */
  app.post("/api/push/register", loadUser, requireAuth, async (req, res) => {
    try {
      const { token, platform } = pushTokenSchema.parse(req.body);

      const userId = req.user!.id;
      const existing = await db.select().from(registeredDevices)
        .where(and(eq(registeredDevices.userId, userId), eq(registeredDevices.deviceId, token)))
        .limit(1);
      if (existing.length > 0) {
        await db.update(registeredDevices)
          .set({ pushToken: token, platform, isActive: true, lastSeenAt: new Date() })
          .where(eq(registeredDevices.id, existing[0].id));
      } else {
        await db.insert(registeredDevices).values({
          userId,
          deviceId: token,
          platform,
          pushToken: token,
          isActive: true,
        });
      }
        
      logger.info("PushBridge", "Device token registered", { 
        userId: req.user!.id, 
        platform 
      });
      
      res.json({ success: true, message: "Device registered for calls" });
    } catch (err) {
      logger.error("PushBridge", "Token registration failed", err as Error);
      res.status(500).json({ success: false, message: "Registration failed" });
    }
  });

  // ========================================================================
  // EXCEL EXPORTS (B2B & BDM Request)
  // ========================================================================

  /**
   * Export Call History to Excel
   * Critical for B2B Management and Billing Transparency
   */
  app.get("/api/exports/calls", loadUser, requireAuth, async (req, res) => {
    try {
      const userId = req.user!.id;

      const calls = await db.select().from(bridgedCalls)
        .where(eq(bridgedCalls.callerUserId, userId))
        .orderBy(desc(bridgedCalls.createdAt));

      // In a real scenario, we'd use exceljs here. 
      // For this audit fix, we return a CSV-compatible JSON for immediate utility.
      res.setHeader('Content-Type', 'text/csv');
      res.attachment(`neuratalk_calls_${Date.now()}.csv`);
      res.status(200).send(calls.map(c => `${c.id},${c.callerNumber},${c.receiverNumber},${c.status},${c.duration}`).join('\n'));
    } catch (err) {
      res.status(500).json({ success: false, error: "Export failed" });
    }
  });

  // ========================================================================
  // HEALTH ENDPOINTS
  // ========================================================================
  
  /**
   * Liveness probe - Is the server running?
   * Used by load balancers and orchestrators
   */
  app.get("/healthz", async (req, res) => {
    res.status(200).json({ status: "ok", timestamp: new Date().toISOString() });
  });
  
  /**
   * Readiness probe - Is the server ready to accept traffic?
   * Checks database connectivity and critical services.
   *
   * PERFORMANCE NOTE (fixed after a production incident): the checks below
   * used to run sequentially, each with its own multi-second timeout
   * (DB + authSchema + up to 3s Redis + up to 4s MSG91 in production could
   * sum past 6-7s worst case). A platform edge/proxy in front of the app
   * (DigitalOcean App Platform, in this deployment) has its own upstream
   * timeout that a sequential worst-case chain of this length can exceed,
   * causing the edge to abort the request with a 504 before the app ever
   * finishes — even though the app itself never crashed or hung
   * indefinitely. Running every check concurrently bounds total latency to
   * the single SLOWEST check rather than the SUM of all of them, and every
   * individual check now has an explicit timeout (previously the DB and
   * authSchema queries had none at all).
   */
  app.get("/readyz", async (req, res) => {
    const READYZ_CHECK_TIMEOUT_MS = 3_000;
    const checks: Record<string, { status: string; latencyMs?: number; error?: string }> = {};
    const withTimeout = async <T,>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> => {
      return await Promise.race([
        promise,
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`${label} timed out`)), timeoutMs)),
      ]);
    };

    const overallStart = Date.now();

    const checkDatabase = async (): Promise<void> => {
      const start = Date.now();
      try {
        await withTimeout(db.execute(sql`SELECT 1`), READYZ_CHECK_TIMEOUT_MS, "database");
        checks.database = { status: "healthy", latencyMs: Date.now() - start };
      } catch (err) {
        checks.database = { status: "unhealthy", error: (err as Error).message === "database timed out" ? "timed out" : "Connection failed" };
      }
    };

    const checkAuthSchema = async (): Promise<void> => {
      const start = Date.now();
      try {
        const authTables = ["user_sessions", "users"];
        const result = await withTimeout(
          db.execute(sql`
            select table_name
            from information_schema.tables
            where table_schema = 'public'
              and table_name in (${sql.join(authTables.map((name) => sql`${name}`), sql`, `)})
          `),
          READYZ_CHECK_TIMEOUT_MS,
          "authSchema",
        );
        const presentTables = new Set(
          Array.from((result as { rows?: Array<{ table_name?: string }> }).rows ?? [])
            .map((row) => row.table_name)
            .filter((value): value is string => typeof value === "string"),
        );
        const missingTables = authTables.filter((tableName) => !presentTables.has(tableName));
        if (missingTables.length > 0) {
          throw new Error(`missing tables: ${missingTables.join(",")}`);
        }
        checks.authSchema = { status: "healthy", latencyMs: Date.now() - start };
      } catch (err) {
        checks.authSchema = { status: "unhealthy", error: (err as Error).message };
      }
    };

    const checkRedis = async (): Promise<void> => {
      const start = Date.now();
      try {
        const redisStatus = getRedisRuntimeStatus();
        if (redisStatus.degraded) {
          throw new Error("degraded_in_memory_fallback");
        }
        const client = getRedisClient();
        const pong = await withTimeout(client.ping(), READYZ_CHECK_TIMEOUT_MS, "redis");
        if (pong !== "PONG") throw new Error(`unexpected reply: ${pong}`);
        checks.redis = { status: "healthy", latencyMs: Date.now() - start };
      } catch (err) {
        checks.redis = { status: "unhealthy", error: (err as Error).message };
      }
    };

    const isProd = (process.env.NODE_ENV || "").toLowerCase() === "production";

    const checkProviders = async (): Promise<void> => {
      if (!isProd) return;
      const requiredKeys = [
        "STT_PROVIDER",
        "AZURE_SPEECH_KEY",
        "AZURE_SPEECH_REGION",
        "LIVEKIT_URL",
        "LIVEKIT_API_KEY",
        "LIVEKIT_API_SECRET",
        "LIVEKIT_SIP_DOMAIN",
        "APP_BASE_URL",
      ];
      const missing = requiredKeys.filter((k) => !process.env[k]);
      if (!hasWorkingOpenAIKey()) missing.push("OPENAI_API_KEY");
      if (missing.length === 0) {
        checks.providers = { status: "healthy" };
      } else {
        checks.providers = { status: "unhealthy", error: `missing: ${missing.join(",")}` };
      }
    };

    const checkMsg91 = async (): Promise<void> => {
      if (!isProd || !process.env.MSG91_AUTH_KEY) return;
      const start = Date.now();
      try {
        // isMSG91Healthy() has its own internal 5s fetch timeout and never
        // rejects (catches everything, resolves to false) — no separate
        // outer race needed here. The previous version raced this against
        // an outer 4s timeout, which was SHORTER than isMSG91Healthy's own
        // 5s internal timeout — a real bug: the outer race would "win" and
        // report a false timeout before the inner check ever got a chance
        // to finish, on every single slow-but-not-actually-down MSG91 call.
        const healthy = await isMSG91Healthy();
        if (!healthy) {
          throw new Error("provider reported unhealthy");
        }
        checks.msg91 = { status: "healthy", latencyMs: Date.now() - start };
      } catch (err) {
        checks.msg91 = { status: "unhealthy", error: (err as Error).message };
      }
    };

    // All checks are independent of each other — run them concurrently so
    // total latency is bounded by the slowest single check, not their sum.
    await Promise.all([checkDatabase(), checkAuthSchema(), checkRedis(), checkProviders(), checkMsg91()]);

    const overallHealthy = Object.values(checks).every((c) => c.status === "healthy");

    // Fire-and-forget — logging this check's result must never add latency
    // to the response the platform's proxy is waiting on.
    void db.insert(systemHealthLogs).values({
      service: "system",
      status: overallHealthy ? "healthy" : "unhealthy",
      responseTimeMs: Date.now() - overallStart,
      details: checks,
    }).catch(() => { /* don't fail the health check if logging fails */ });

    res.status(overallHealthy ? 200 : 503).json({
      status: overallHealthy ? "ready" : "not_ready",
      checks,
      timestamp: new Date().toISOString(),
    });
  });
  
  /**
   * Detailed platform health (admin only)
   */
  app.get("/api/admin/health", loadUser, requireSuperAdmin, async (req, res) => {
    try {
      // Get recent health logs
      const recentLogs = await db.query.systemHealthLogs.findMany({
        orderBy: [desc(systemHealthLogs.checkedAt)],
        limit: 100,
      });
      
      // Aggregate by service
      const serviceStatus: Record<string, any> = {};
      const services = ["database", "signaling", "media", "ai", "storage", "system"];
      
      for (const service of services) {
        const serviceLogs = recentLogs.filter(l => l.service === service);
        const latest = serviceLogs[0];
        const healthyCount = serviceLogs.filter(l => l.status === "healthy").length;
        
        serviceStatus[service] = {
          currentStatus: latest?.status || "unknown",
          lastChecked: latest?.checkedAt || null,
          uptimePercent: serviceLogs.length > 0 
            ? Math.round((healthyCount / serviceLogs.length) * 100) 
            : null,
          avgResponseTimeMs: serviceLogs.length > 0
            ? Math.round(serviceLogs.reduce((sum, l) => sum + (l.responseTimeMs || 0), 0) / serviceLogs.length)
            : null,
        };
      }
      
      res.json({
        success: true,
        services: serviceStatus,
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      logger.error("ProductionRoutes", "Health check failed", err as Error);
      res.status(500).json({ success: false, message: "Health check failed" });
    }
  });
  
  // ========================================================================
  // VERSION MANAGEMENT
  // ========================================================================
  
  /**
   * Check app version - Determine if update is required
   */
  app.post("/api/version/check", async (req, res) => {
    try {
      const { platform, currentVersion } = versionCheckSchema.parse(req.body);
      
      // Get latest version for platform
      const latestVersion = await db.query.appVersions.findFirst({
        where: and(
          eq(appVersions.platform, platform),
          eq(appVersions.status, "active")
        ),
        orderBy: [desc(appVersions.createdAt)],
      });
      
      if (!latestVersion) {
        return res.json({
          success: true,
          updateRequired: false,
          forceUpdate: false,
          message: "No version information available",
        });
      }
      
      // Compare versions (simple semver comparison)
      const isOutdated = compareVersions(currentVersion, latestVersion.version) < 0;
      const needsForceUpdate = latestVersion.minSupportedVersion 
        ? compareVersions(currentVersion, latestVersion.minSupportedVersion) < 0
        : false;
      
      res.json({
        success: true,
        currentVersion,
        latestVersion: latestVersion.version,
        updateRequired: isOutdated,
        forceUpdate: needsForceUpdate || latestVersion.forceUpdate,
        releaseNotes: latestVersion.releaseNotes,
        downloadUrl: latestVersion.downloadUrl,
      });
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ success: false, message: err.errors[0].message });
      }
      logger.error("ProductionRoutes", "Version check failed", err as Error);
      res.status(500).json({ success: false, message: "Version check failed" });
    }
  });
  
  // ========================================================================
  // CONSENT MANAGEMENT
  // ========================================================================
  
  /**
   * Get user's current consents
   */
  app.get("/api/user/consents", loadUser, requireAuth, async (req, res) => {
    try {
      const consents = await db.query.userConsents.findMany({
        where: and(
          eq(userConsents.userId, req.user!.id),
          sql`${userConsents.revokedAt} IS NULL`
        ),
      });
      
      res.json({
        success: true,
        consents: consents.map(c => ({
          type: c.consentType,
          granted: c.granted,
          version: c.version,
          grantedAt: c.grantedAt,
          expiresAt: c.expiresAt,
        })),
      });
    } catch (err) {
      logger.error("ProductionRoutes", "Consent fetch failed", err as Error);
      res.status(500).json({ success: false, message: "Failed to fetch consents" });
    }
  });
  
  /**
   * Update user consent
   */
  app.post("/api/user/consents", loadUser, requireAuth, async (req, res) => {
    try {
      const input = consentSchema.parse(req.body);
      
      // Revoke existing consent of same type
      await db.update(userConsents)
        .set({ revokedAt: new Date() })
        .where(and(
          eq(userConsents.userId, req.user!.id),
          eq(userConsents.consentType, input.consentType),
          sql`${userConsents.revokedAt} IS NULL`
        ));
      
      // Create new consent record
      const [consent] = await db.insert(userConsents).values({
        userId: req.user!.id,
        consentType: input.consentType,
        granted: input.granted,
        version: input.version,
        scope: input.scope,
        scopeId: input.scopeId,
        ipAddress: req.ip,
        userAgent: req.get("user-agent"),
      }).returning();
      
      logger.info("ProductionRoutes", "Consent updated", {
        userId: req.user!.id,
        consentType: input.consentType,
        granted: input.granted,
      });
      
      res.json({
        success: true,
        message: "Consent recorded",
        consent: {
          type: consent.consentType,
          granted: consent.granted,
          version: consent.version,
          grantedAt: consent.grantedAt,
        },
      });
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ success: false, message: err.errors[0].message });
      }
      logger.error("ProductionRoutes", "Consent update failed", err as Error);
      res.status(500).json({ success: false, message: "Failed to update consent" });
    }
  });
  
  // ========================================================================
  // DATA SUBJECT REQUESTS (GDPR/Privacy)
  // ========================================================================
  
  /**
   * Get user's data requests
   */
  app.get("/api/user/data-requests", loadUser, requireAuth, async (req, res) => {
    try {
      const requests = await db.query.dataSubjectRequests.findMany({
        where: eq(dataSubjectRequests.userId, req.user!.id),
        orderBy: [desc(dataSubjectRequests.createdAt)],
      });
      
      res.json({
        success: true,
        requests: requests.map(r => ({
          id: r.id,
          type: r.requestType,
          status: r.status,
          createdAt: r.createdAt,
          completedAt: r.completedAt,
          resultUrl: r.resultUrl,
          expiresAt: r.expiresAt,
        })),
      });
    } catch (err) {
      logger.error("ProductionRoutes", "Data requests fetch failed", err as Error);
      res.status(500).json({ success: false, message: "Failed to fetch data requests" });
    }
  });
  
  /**
   * Create data subject request (export, deletion, etc.)
   */
  app.post("/api/user/data-requests", loadUser, requireAuth, createRateLimiter("strict"), async (req, res) => {
    try {
      const input = dataRequestSchema.parse(req.body);
      
      // Check for pending requests of same type
      const existingRequest = await db.query.dataSubjectRequests.findFirst({
        where: and(
          eq(dataSubjectRequests.userId, req.user!.id),
          eq(dataSubjectRequests.requestType, input.requestType),
          eq(dataSubjectRequests.status, "pending")
        ),
      });
      
      if (existingRequest) {
        return res.status(400).json({
          success: false,
          message: "You already have a pending request of this type",
        });
      }
      
      const [request] = await db.insert(dataSubjectRequests).values({
        userId: req.user!.id,
        requestType: input.requestType,
        requestDetails: input.requestDetails || {},
        status: "pending",
      }).returning();
      
      logger.info("ProductionRoutes", "Data subject request created", {
        userId: req.user!.id,
        requestType: input.requestType,
        requestId: request.id,
      });
      
      res.json({
        success: true,
        message: "Your request has been submitted and will be processed within 30 days",
        request: {
          id: request.id,
          type: request.requestType,
          status: request.status,
          createdAt: request.createdAt,
        },
      });
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ success: false, message: err.errors[0].message });
      }
      logger.error("ProductionRoutes", "Data request creation failed", err as Error);
      res.status(500).json({ success: false, message: "Failed to create request" });
    }
  });
  
  // ========================================================================
  // ABUSE REPORTING
  // ========================================================================
  
  /**
   * Submit abuse report
   */
  app.post("/api/abuse/report", loadUser, requireAuth, createRateLimiter("strict"), async (req, res) => {
    try {
      const input = abuseReportSchema.parse(req.body);
      
      const [report] = await db.insert(abuseReports).values({
        reporterUserId: req.user!.id,
        reportedUserId: input.reportedUserId,
        reportedEntityType: input.reportedEntityType,
        reportedEntityId: input.reportedEntityId,
        category: input.category,
        description: input.description,
        status: "pending",
      }).returning();
      
      logger.info("ProductionRoutes", "Abuse report submitted", {
        reporterId: req.user!.id,
        reportId: report.id,
        category: input.category,
      });
      
      res.json({
        success: true,
        message: "Thank you for your report. We will review it shortly.",
        reportId: report.id,
      });
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ success: false, message: err.errors[0].message });
      }
      logger.error("ProductionRoutes", "Abuse report failed", err as Error);
      res.status(500).json({ success: false, message: "Failed to submit report" });
    }
  });
  
  /**
   * Get abuse reports (admin only)
   */
  app.get("/api/admin/abuse-reports", loadUser, requireSuperAdmin, async (req, res) => {
    try {
      const status = req.query.status as string;
      
      const reports = await db.query.abuseReports.findMany({
        where: status ? eq(abuseReports.status, status) : undefined,
        orderBy: [desc(abuseReports.createdAt)],
        limit: 100,
      });
      
      res.json({
        success: true,
        reports,
      });
    } catch (err) {
      logger.error("ProductionRoutes", "Abuse reports fetch failed", err as Error);
      res.status(500).json({ success: false, message: "Failed to fetch reports" });
    }
  });
  
  // ========================================================================
  // ACCESSIBILITY PREFERENCES
  // ========================================================================
  
  /**
   * Get user accessibility preferences
   */
  app.get("/api/user/accessibility", loadUser, requireAuth, async (req, res) => {
    try {
      const prefs = await db.query.userAccessibilityPrefs.findFirst({
        where: eq(userAccessibilityPrefs.userId, req.user!.id),
      });
      
      res.json({
        success: true,
        preferences: prefs || {
          highContrast: false,
          reducedMotion: false,
          fontSize: "medium",
          screenReaderOptimized: false,
          colorBlindMode: null,
          keyboardNavigation: true,
          captionsEnabled: false,
        },
      });
    } catch (err) {
      logger.error("ProductionRoutes", "Accessibility prefs fetch failed", err as Error);
      res.status(500).json({ success: false, message: "Failed to fetch preferences" });
    }
  });
  
  /**
   * Update user accessibility preferences
   */
  app.put("/api/user/accessibility", loadUser, requireAuth, async (req, res) => {
    try {
      const input = accessibilityPrefsSchema.parse(req.body);
      
      const existing = await db.query.userAccessibilityPrefs.findFirst({
        where: eq(userAccessibilityPrefs.userId, req.user!.id),
      });
      
      if (existing) {
        await db.update(userAccessibilityPrefs)
          .set({ ...input, updatedAt: new Date() })
          .where(eq(userAccessibilityPrefs.userId, req.user!.id));
      } else {
        await db.insert(userAccessibilityPrefs).values({
          userId: req.user!.id,
          ...input,
        });
      }
      
      res.json({
        success: true,
        message: "Accessibility preferences updated",
      });
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ success: false, message: err.errors[0].message });
      }
      logger.error("ProductionRoutes", "Accessibility prefs update failed", err as Error);
      res.status(500).json({ success: false, message: "Failed to update preferences" });
    }
  });
  
  // ========================================================================
  // ENVIRONMENT CONFIGURATION
  // ========================================================================
  
  /**
   * Get current environment info
   */
  app.get("/api/environment", async (req, res) => {
    const currentEnv = process.env.NODE_ENV || "development";
    
    try {
      const config = await db.query.environmentConfigs.findFirst({
        where: eq(environmentConfigs.environment, currentEnv),
      });
      
      res.json({
        success: true,
        environment: currentEnv,
        config: config ? {
          displayName: config.displayName,
          features: config.features,
        } : null,
      });
    } catch (err) {
      res.json({
        success: true,
        environment: currentEnv,
        config: null,
      });
    }
  });
  
  // ========================================================================
  // SUSPENSION CHECK MIDDLEWARE HELPER
  // ========================================================================
  
  /**
   * Check if user is suspended (can be used as middleware)
   */
  app.get("/api/user/suspension-status", loadUser, requireAuth, async (req, res) => {
    try {
      const suspension = await db.query.userSuspensions.findFirst({
        where: and(
          eq(userSuspensions.userId, req.user!.id),
          eq(userSuspensions.status, "active"),
          sql`(${userSuspensions.expiresAt} IS NULL OR ${userSuspensions.expiresAt} > NOW())`
        ),
      });
      
      if (suspension) {
        return res.json({
          success: true,
          suspended: true,
          reason: suspension.reason,
          expiresAt: suspension.expiresAt,
        });
      }
      
      res.json({
        success: true,
        suspended: false,
      });
    } catch (err) {
      logger.error("ProductionRoutes", "Suspension check failed", err as Error);
      res.json({ success: true, suspended: false });
    }
  });
  
  // ========================================================================
  // BACKUP STATUS (Admin only)
  // ========================================================================
  
  app.get("/api/admin/backups", loadUser, requireSuperAdmin, async (req, res) => {
    try {
      const backups = await db.query.backupJobs.findMany({
        orderBy: [desc(backupJobs.createdAt)],
        limit: 50,
      });
      
      res.json({
        success: true,
        backups: backups.map(b => ({
          id: b.id,
          type: b.backupType,
          scope: b.dataScope,
          status: b.status,
          sizeBytes: b.sizeBytes,
          startedAt: b.startedAt,
          completedAt: b.completedAt,
          expiresAt: b.expiresAt,
        })),
      });
    } catch (err) {
      logger.error("ProductionRoutes", "Backups fetch failed", err as Error);
      res.status(500).json({ success: false, message: "Failed to fetch backups" });
    }
  });
  
  // ========================================================================
  // DATA RESIDENCY (Admin only)
  // ========================================================================
  
  app.get("/api/admin/data-residency", loadUser, requireSuperAdmin, async (req, res) => {
    try {
      const policies = await db.query.dataResidencyPolicies.findMany();
      
      res.json({
        success: true,
        policies,
      });
    } catch (err) {
      logger.error("ProductionRoutes", "Data residency fetch failed", err as Error);
      res.status(500).json({ success: false, message: "Failed to fetch policies" });
    }
  });
}

// ============================================================================
// HELPERS
// ============================================================================

function compareVersions(v1: string, v2: string): number {
  const parts1 = v1.split(".").map(Number);
  const parts2 = v2.split(".").map(Number);
  
  for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
    const p1 = parts1[i] || 0;
    const p2 = parts2[i] || 0;
    if (p1 < p2) return -1;
    if (p1 > p2) return 1;
  }
  
  return 0;
}

// Export rate limiter for use in other routes
export { createRateLimiter as rateLimiter };
