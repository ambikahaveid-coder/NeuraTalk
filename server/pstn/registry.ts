/**
 * PSTN Provider Registry
 *
 * Auto-selects the active provider from ENV config.
 * All call-routing code must go through getPSTNProvider() — never import providers directly.
 *
 * Provider selection:
 *   PSTN_PROVIDER=msg91    → MSG91  (default — India-first)
 *   PSTN_PROVIDER=twilio   → Twilio (global fallback)
 *
 * Failover:
 *   If the primary provider's health check fails and PSTN_FAILOVER_PROVIDER is set,
 *   the registry automatically switches to the failover provider for subsequent calls.
 *   Switch reverts after PSTN_FAILOVER_RESET_MINUTES (default: 10).
 */

import { logger } from "../observability";
import { MSG91Provider } from "./msg91";
import { TwilioProvider } from "./twilio";
import type { PSTNProvider } from "./provider";

const FAILOVER_RESET_MS =
  (parseInt(process.env.PSTN_FAILOVER_RESET_MINUTES || "10", 10) || 10) * 60_000;

let _primary: PSTNProvider | null = null;
let _failover: PSTNProvider | null = null;
let _usingFailover = false;
let _failoverActivatedAt = 0;

function buildProvider(name: string): PSTNProvider {
  switch (name.toLowerCase().trim()) {
    case "msg91":
      return new MSG91Provider();
    case "twilio":
      return new TwilioProvider();
    default:
      throw new Error(`Unknown PSTN provider: "${name}". Valid values: msg91, twilio`);
  }
}

function init(): void {
  if (_primary) return;

  const primaryName = (process.env.PSTN_PROVIDER || "msg91").toLowerCase().trim();
  const failoverName = (process.env.PSTN_FAILOVER_PROVIDER || "").toLowerCase().trim();

  _primary = buildProvider(primaryName);
  logger.info("PSTNRegistry", `Primary PSTN provider: ${_primary.name}`);

  if (failoverName && failoverName !== primaryName) {
    try {
      _failover = buildProvider(failoverName);
      logger.info("PSTNRegistry", `Failover PSTN provider: ${_failover.name}`);
    } catch (err) {
      logger.warn("PSTNRegistry", `Failover provider "${failoverName}" failed to initialize: ${err}`);
    }
  }
}

/**
 * Returns the currently active PSTN provider.
 * Handles automatic failover if the primary is unhealthy.
 */
export function getPSTNProvider(): PSTNProvider {
  init();

  // Reset failover if window has expired
  if (_usingFailover && Date.now() - _failoverActivatedAt > FAILOVER_RESET_MS) {
    logger.info("PSTNRegistry", `Failover window expired — switching back to primary (${_primary!.name})`);
    _usingFailover = false;
  }

  return _usingFailover && _failover ? _failover : _primary!;
}

/**
 * Check provider health and activate failover if needed.
 * Called by the health monitor on a schedule.
 */
export async function checkProviderHealth(): Promise<{
  primary: { name: string; healthy: boolean; latencyMs?: number; message?: string };
  failover?: { name: string; healthy: boolean; latencyMs?: number; message?: string };
  usingFailover: boolean;
}> {
  init();

  const primaryHealth = await _primary!.healthCheck();

  if (!primaryHealth.healthy && _failover && !_usingFailover) {
    logger.warn("PSTNRegistry",
      `Primary provider ${_primary!.name} is unhealthy (${primaryHealth.message}). ` +
      `Activating failover to ${_failover.name}.`
    );
    _usingFailover = true;
    _failoverActivatedAt = Date.now();
  } else if (primaryHealth.healthy && _usingFailover) {
    logger.info("PSTNRegistry", `Primary provider ${_primary!.name} recovered. Switching back.`);
    _usingFailover = false;
  }

  const result: ReturnType<typeof checkProviderHealth> extends Promise<infer T> ? T : never = {
    primary: { name: _primary!.name, ...primaryHealth },
    usingFailover: _usingFailover,
  };

  if (_failover) {
    const fh = await _failover.healthCheck();
    result.failover = { name: _failover.name, ...fh };
  }

  return result;
}

/**
 * Returns true if any PSTN provider is configured and reachable.
 * Used by call router to decide whether PSTN route is available.
 */
export function isPSTNAvailable(): boolean {
  const primaryName = (process.env.PSTN_PROVIDER || "msg91").toLowerCase();
  if (primaryName === "msg91" && !process.env.MSG91_AUTH_KEY) return false;
  if (primaryName === "twilio" && (!process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN)) return false;
  return true;
}

/**
 * Returns provider config status for admin dashboard.
 */
export function getPSTNStatus(): {
  configured: boolean;
  provider: string;
  failoverProvider?: string;
  voiceCallerId?: string;
} {
  const providerName = (process.env.PSTN_PROVIDER || "msg91").toLowerCase();
  const configured = isPSTNAvailable();

  return {
    configured,
    provider: providerName,
    failoverProvider: process.env.PSTN_FAILOVER_PROVIDER || undefined,
    voiceCallerId: process.env.MSG91_VOICE_CALLER_ID || process.env.TWILIO_PHONE_NUMBER || undefined,
  };
}
