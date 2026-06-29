/**
 * SIP Trunk Registry — Least Cost Routing (LCR)
 *
 * Manages multiple SIP trunks and selects the optimal one per call.
 * Route selection priority:
 *   1. Number prefix match (most specific wins)
 *   2. Trunk priority (lower = preferred)
 *   3. Trunk weight (weighted random when priority equal)
 *   4. Health status (unhealthy trunks are excluded)
 *
 * Kamailio ultimately executes the SIP routing. This registry:
 *   - Manages trunk configs
 *   - Runs OPTIONS health checks
 *   - Pushes routing decisions to Kamailio via MI/XMLRPC
 *   - Provides LCR decisions for the API layer
 *
 * Environment-driven trunk registration:
 *   SIP_TRUNK_1_HOST=sip.jio.com
 *   SIP_TRUNK_1_NAME=jio
 *   SIP_TRUNK_1_PRIORITY=10
 *   SIP_TRUNK_2_HOST=sip.airtel.in
 *   ...
 */

import { logger } from "../observability";
import { getRedisClient } from "../redis";
import { GenericSIPTrunk } from "./generic-trunk";
import type { SIPProvider, SIPTrunkConfig, SIPProviderHealth } from "./provider";

const HEALTH_CHECK_INTERVAL_MS = 30_000;
const HEALTH_CACHE_KEY = "sip:trunk:health";
const HEALTH_CACHE_TTL = 120;

let _registry: SIPTrunkRegistry | null = null;

export class SIPTrunkRegistry {
  private trunks: Map<string, SIPProvider> = new Map();
  private healthCache: Map<string, SIPProviderHealth> = new Map();
  private healthCheckTimer: NodeJS.Timeout | null = null;

  constructor(configs: SIPTrunkConfig[]) {
    for (const config of configs) {
      const trunk = new GenericSIPTrunk(config);
      this.trunks.set(config.id, trunk);
      logger.info("SIPTrunkRegistry", `Registered trunk: ${config.name} (${config.host}:${config.port}) priority=${config.priority}`);
    }
  }

  /**
   * Select the best available trunk for an outbound call to the given number.
   * Returns null if no healthy trunk is available.
   */
  selectTrunk(toNumber: string): SIPProvider | null {
    const e164 = toNumber.replace(/\s/g, "");
    const candidates = Array.from(this.trunks.values())
      .filter((t) => {
        // Check health — default to healthy if no health data yet
        const health = this.healthCache.get(t.id);
        return !health || health.healthy;
      })
      .filter((t) => {
        // Check prefix support
        if (t.config.supportedPrefixes.length === 0) return true;
        const digits = e164.replace(/^\+/, "");
        return t.config.supportedPrefixes.some((prefix: string) => digits.startsWith(prefix.replace(/^\+/, "")));
      })
      .sort((a, b) => {
        // Sort by priority (lower = preferred), then weight (higher = preferred)
        if (a.config.priority !== b.config.priority) {
          return a.config.priority - b.config.priority;
        }
        return b.config.weight - a.config.weight;
      });

    if (candidates.length === 0) {
      logger.warn("SIPTrunkRegistry", `No healthy trunk available for ${e164}`);
      return null;
    }

    const selected = candidates[0];
    logger.debug("SIPTrunkRegistry", `Selected trunk ${selected.name} for ${e164}`);
    return selected;
  }

  /** Returns all trunks in priority order for failover */
  getFailoverChain(toNumber: string): SIPProvider[] {
    const e164 = toNumber.replace(/\s/g, "");
    return Array.from(this.trunks.values())
      .filter((t) => {
        if (t.config.supportedPrefixes.length === 0) return true;
        const digits = e164.replace(/^\+/, "");
        return t.config.supportedPrefixes.some((p: string) => digits.startsWith(p.replace(/^\+/, "")));
      })
      .sort((a, b) => a.config.priority - b.config.priority || b.config.weight - a.config.weight);
  }

  getTrunk(id: string): SIPProvider | undefined {
    return this.trunks.get(id);
  }

  getTrunks(): SIPProvider[] {
    return Array.from(this.trunks.values());
  }

  getHealth(trunkId: string): SIPProviderHealth | null {
    return this.healthCache.get(trunkId) ?? null;
  }

  getAllHealth(): Record<string, SIPProviderHealth> {
    const out: Record<string, SIPProviderHealth> = {};
    for (const [id, health] of Array.from(this.healthCache)) {
      out[id] = health;
    }
    return out;
  }

  isAvailable(): boolean {
    return this.trunks.size > 0 && Array.from(this.trunks.values()).some((t) => {
      const health = this.healthCache.get(t.id);
      return !health || health.healthy;
    });
  }

  startHealthChecks(): void {
    if (this.healthCheckTimer) return;
    // Run immediately then on schedule
    void this.runHealthChecks();
    this.healthCheckTimer = setInterval(() => {
      void this.runHealthChecks();
    }, HEALTH_CHECK_INTERVAL_MS);
    this.healthCheckTimer.unref?.();
  }

  stopHealthChecks(): void {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = null;
    }
  }

  private async runHealthChecks(): Promise<void> {
    const checks = Array.from(this.trunks.values()).map(async (trunk) => {
      try {
        const health = await trunk.optionsPing();
        this.healthCache.set(trunk.id, health);
        if (!health.healthy) {
          logger.warn("SIPTrunkRegistry", `Trunk ${trunk.name} unhealthy: ${health.message}`);
        }
        // Persist to Redis for cross-process visibility
        await getRedisClient().hset(HEALTH_CACHE_KEY, trunk.id, JSON.stringify(health));
        await getRedisClient().expire(HEALTH_CACHE_KEY, HEALTH_CACHE_TTL);
      } catch (err) {
        logger.warn("SIPTrunkRegistry", `Health check failed for ${trunk.name}: ${String(err)}`);
        const failedHealth: SIPProviderHealth = {
          healthy: false,
          message: String(err),
          lastCheckedAt: new Date().toISOString(),
        };
        this.healthCache.set(trunk.id, failedHealth);
      }
    });
    await Promise.allSettled(checks);
  }
}

/** Build trunk configs from environment variables */
function buildTrunkConfigsFromEnv(): SIPTrunkConfig[] {
  const configs: SIPTrunkConfig[] = [];

  // Support SIP_TRUNK_n_* env pattern
  for (let i = 1; i <= 10; i++) {
    const host = process.env[`SIP_TRUNK_${i}_HOST`]?.trim();
    if (!host) break;

    const config: SIPTrunkConfig = {
      id: `trunk_${i}`,
      name: process.env[`SIP_TRUNK_${i}_NAME`] || `trunk-${i}`,
      provider: (process.env[`SIP_TRUNK_${i}_PROVIDER`] as any) || "generic",
      host,
      port: parseInt(process.env[`SIP_TRUNK_${i}_PORT`] || "5060", 10),
      transport: (process.env[`SIP_TRUNK_${i}_TRANSPORT`] as any) || "UDP",
      username: process.env[`SIP_TRUNK_${i}_USERNAME`],
      password: process.env[`SIP_TRUNK_${i}_PASSWORD`],
      authRealm: process.env[`SIP_TRUNK_${i}_AUTH_REALM`],
      fromDomain: process.env[`SIP_TRUNK_${i}_FROM_DOMAIN`] || host,
      callerIdMode: (process.env[`SIP_TRUNK_${i}_CALLER_ID_MODE`] as any) || "passthrough",
      forcedCallerId: process.env[`SIP_TRUNK_${i}_FORCED_CLI`],
      priority: parseInt(process.env[`SIP_TRUNK_${i}_PRIORITY`] || "100", 10),
      weight: parseInt(process.env[`SIP_TRUNK_${i}_WEIGHT`] || "10", 10),
      maxConcurrentCalls: parseInt(process.env[`SIP_TRUNK_${i}_MAX_CALLS`] || "30", 10),
      supportedCodecs: ["PCMU", "PCMA"],
      supportedPrefixes: (process.env[`SIP_TRUNK_${i}_PREFIXES`] || "").split(",").map((s) => s.trim()).filter(Boolean),
      region: process.env[`SIP_TRUNK_${i}_REGION`] || "IN",
      traiCliVerified: process.env[`SIP_TRUNK_${i}_TRAI_VERIFIED`] === "true",
      dltPeId: process.env[`SIP_TRUNK_${i}_DLT_PE_ID`],
    };
    configs.push(config);
  }

  // Built-in convenience: if JIO_SIP_HOST is set, add it automatically
  if (process.env.JIO_SIP_HOST) {
    configs.push({
      id: "jio_builtin",
      name: "Jio Business SIP",
      provider: "jio",
      host: process.env.JIO_SIP_HOST,
      port: parseInt(process.env.JIO_SIP_PORT || "5060", 10),
      transport: "UDP",
      username: process.env.JIO_SIP_USERNAME,
      password: process.env.JIO_SIP_PASSWORD,
      fromDomain: process.env.JIO_SIP_FROM_DOMAIN || process.env.JIO_SIP_HOST,
      callerIdMode: "asserted",
      priority: 10,
      weight: 100,
      maxConcurrentCalls: 30,
      supportedCodecs: ["PCMU", "PCMA"],
      supportedPrefixes: ["91"],
      region: "IN",
      traiCliVerified: process.env.JIO_SIP_TRAI_VERIFIED === "true",
      dltPeId: process.env.JIO_SIP_DLT_PE_ID,
    });
  }

  if (process.env.AIRTEL_SIP_HOST) {
    configs.push({
      id: "airtel_builtin",
      name: "Airtel Business SIP",
      provider: "airtel",
      host: process.env.AIRTEL_SIP_HOST,
      port: parseInt(process.env.AIRTEL_SIP_PORT || "5060", 10),
      transport: "UDP",
      username: process.env.AIRTEL_SIP_USERNAME,
      password: process.env.AIRTEL_SIP_PASSWORD,
      fromDomain: process.env.AIRTEL_SIP_FROM_DOMAIN || process.env.AIRTEL_SIP_HOST,
      callerIdMode: "asserted",
      priority: 20,
      weight: 80,
      maxConcurrentCalls: 30,
      supportedCodecs: ["PCMU", "PCMA"],
      supportedPrefixes: ["91"],
      region: "IN",
      traiCliVerified: process.env.AIRTEL_SIP_TRAI_VERIFIED === "true",
      dltPeId: process.env.AIRTEL_SIP_DLT_PE_ID,
    });
  }

  return configs;
}

/** Get or initialize the global SIP trunk registry */
export function getSIPTrunkRegistry(): SIPTrunkRegistry {
  if (!_registry) {
    const configs = buildTrunkConfigsFromEnv();
    _registry = new SIPTrunkRegistry(configs);
    if (configs.length > 0) {
      _registry.startHealthChecks();
    } else {
      logger.info("SIPTrunkRegistry", "No SIP trunks configured — using CPaaS fallback (MSG91/Twilio)");
    }
  }
  return _registry;
}

/** True if at least one direct SIP trunk is configured and healthy */
export function hasSIPTrunks(): boolean {
  return getSIPTrunkRegistry().isAvailable();
}
