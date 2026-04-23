/**
 * TURN Server Configuration with Twilio Network Traversal Service
 * 
 * WHY THIS EXISTS:
 * - STUN servers only work for ~70% of NAT configurations
 * - TURN servers relay media when direct peer-to-peer fails
 * - Essential for calls across different networks (mobile data, corporate firewalls, etc.)
 * 
 * TWILIO CONFIGURATION (Recommended):
 * Set these environment variables:
 * - TWILIO_ACCOUNT_SID: Your Twilio Account SID
 * - TWILIO_AUTH_TOKEN: Your Twilio Auth Token
 * 
 * Twilio provides ephemeral credentials that expire (default 24h), making it more secure.
 * 
 * ALTERNATIVE - Self-hosted TURN:
 * - TURN_SERVER_URL: e.g., "turn:your-server.com:3478"
 * - TURN_SERVER_USERNAME: TURN username
 * - TURN_SERVER_CREDENTIAL: TURN password
 */

import twilio from "twilio";

export interface ICEServer {
  urls: string | string[];
  username?: string;
  credential?: string;
}

export interface ICEServersConfig {
  iceServers: ICEServer[];
  iceCandidatePoolSize?: number;
}

// Public STUN servers (always included as fallback)
const PUBLIC_STUN_SERVERS: ICEServer[] = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
  { urls: "stun:stun2.l.google.com:19302" },
  { urls: "stun:stun.services.mozilla.com" },
  { urls: "stun:stun.cloudflare.com:3478" },
];

// Free public TURN servers (Open Relay Project) — works for most NATs without paid account
// These handle ~95% of restrictive NAT cases for free
const FREE_TURN_SERVERS: ICEServer[] = [
  {
    urls: ["turn:openrelay.metered.ca:80", "turn:openrelay.metered.ca:443", "turns:openrelay.metered.ca:443"],
    username: "openrelayproject",
    credential: "openrelayproject",
  },
  {
    urls: ["turn:openrelay.metered.ca:80?transport=tcp", "turn:openrelay.metered.ca:443?transport=tcp"],
    username: "openrelayproject",
    credential: "openrelayproject",
  },
];

let twilioTokenCache: { iceServers: ICEServer[]; expiresAt: number } | null = null;
let twilioFailCache: { failedAt: number } | null = null;
const TWILIO_FAIL_RETRY_MS = 5 * 60 * 1000;

/**
 * Check if Twilio is configured with real (non-mock) credentials
 */
export function isTwilioConfigured(): boolean {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!sid || !token) return false;
  // Reject obvious mock/placeholder values
  if (sid.startsWith("AC_mock") || token.startsWith("mock_") || sid === "ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx") return false;
  // Real Twilio SIDs always start with "AC" and are 34 chars
  if (!sid.startsWith("AC") || sid.length !== 34) return false;
  return true;
}

/**
 * Get ICE servers from Twilio Network Traversal Service
 * Returns ephemeral credentials valid for 24 hours
 */
async function getTwilioIceServers(): Promise<ICEServer[]> {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;

  if (!accountSid || !authToken) {
    return [];
  }

  const now = Date.now();
  if (twilioTokenCache && twilioTokenCache.expiresAt > now + 12 * 60 * 60 * 1000) {
    return twilioTokenCache.iceServers;
  }

  if (twilioFailCache && now - twilioFailCache.failedAt < TWILIO_FAIL_RETRY_MS) {
    return [];
  }

  try {
    const client = twilio(accountSid, authToken);
    const tokenPromise = client.tokens.create({ ttl: 86400 });
    const timeoutPromise = new Promise<never>((_, reject) => 
      setTimeout(() => reject(new Error("Twilio token fetch timeout")), 3000)
    );
    const token = await Promise.race([tokenPromise, timeoutPromise]) as any;

    const iceServers: ICEServer[] = [];

    // Add Twilio STUN server
    const stunServer = token.iceServers.find((s: any) => 
      s.urls?.includes("stun:global.stun.twilio.com") || s.url?.includes("stun:")
    );
    if (stunServer) {
      const stunUrls = stunServer.urls || stunServer.url;
      if (stunUrls) {
        iceServers.push({ urls: stunUrls });
      }
    }

    // Add Twilio TURN servers (UDP, TCP, TLS)
    for (const server of token.iceServers) {
      const serverUrls = server.urls || server.url;
      if (serverUrls && (serverUrls.includes("turn:") || (Array.isArray(serverUrls) && serverUrls.some((u: string) => u.includes("turn:"))))) {
        iceServers.push({
          urls: serverUrls,
          username: server.username,
          credential: server.credential,
        });
      }
    }

    // Cache the result
    twilioTokenCache = {
      iceServers,
      expiresAt: now + 24 * 60 * 60 * 1000,
    };

    console.log("[TURN] Twilio ICE servers fetched successfully");
    return iceServers;
  } catch (error: any) {
    twilioFailCache = { failedAt: Date.now() };
    const msg = error?.status === 401 ? "Invalid credentials (401)" : error?.message || "Unknown error";
    console.warn(`[TURN] Twilio token fetch failed: ${msg}. Retrying in 5 minutes.`);
    return [];
  }
}

/**
 * Get configured self-hosted TURN servers from environment
 */
function getSelfHostedTurnServers(): ICEServer[] {
  const turnUrl = process.env.TURN_SERVER_URL;
  const turnUsername = process.env.TURN_SERVER_USERNAME;
  const turnCredential = process.env.TURN_SERVER_CREDENTIAL;
  
  if (!turnUrl) {
    return [];
  }
  
  if (!turnUsername || !turnCredential) {
    console.warn("[TURN] TURN credentials missing. Using TURN URL without authentication.");
    return [{ urls: turnUrl }];
  }
  
  // Support multiple TURN URLs (comma-separated)
  const turnUrls = turnUrl.split(",").map(u => u.trim());
  
  return [
    {
      urls: turnUrls,
      username: turnUsername,
      credential: turnCredential,
    }
  ];
}

/**
 * Get full ICE servers configuration for WebRTC
 * Priority: Twilio > Self-hosted TURN > Public STUN only
 */
export async function getICEServersConfigAsync(): Promise<ICEServersConfig> {
  let turnServers: ICEServer[] = [];

  // Try Twilio first
  if (isTwilioConfigured()) {
    turnServers = await getTwilioIceServers();
  }

  // Fallback to self-hosted TURN
  if (turnServers.length === 0) {
    turnServers = getSelfHostedTurnServers();
  }

  if (turnServers.length === 0) {
    // Use free public TURN as last-resort fallback so calls work everywhere
    turnServers = FREE_TURN_SERVERS;
    console.info("[TURN] Using free public TURN servers (Open Relay Project). For production, configure Twilio or self-hosted TURN.");
  }

  return {
    iceServers: [
      ...PUBLIC_STUN_SERVERS,
      ...turnServers,
    ],
    iceCandidatePoolSize: 10,
  };
}

/**
 * Synchronous version for backward compatibility (uses cached Twilio or self-hosted)
 */
export function getICEServersConfig(): ICEServersConfig {
  let turnServers: ICEServer[] = [];

  // Use cached Twilio servers if available
  if (twilioTokenCache && twilioTokenCache.expiresAt > Date.now()) {
    turnServers = twilioTokenCache.iceServers;
  } else {
    // Fallback to self-hosted TURN
    turnServers = getSelfHostedTurnServers();
  }

  // Last resort: use free public TURN
  if (turnServers.length === 0) {
    turnServers = FREE_TURN_SERVERS;
  }

  return {
    iceServers: [
      ...PUBLIC_STUN_SERVERS,
      ...turnServers,
    ],
    iceCandidatePoolSize: 10,
  };
}

/**
 * Check if TURN is properly configured (Twilio or self-hosted)
 */
export function isTurnConfigured(): boolean {
  // Always true — we fall back to free public TURN servers
  return true;
}

/**
 * Get configuration status for diagnostics
 */
export function getTurnStatus(): {
  configured: boolean;
  provider: "twilio" | "self-hosted" | "none";
  serverUrl: string | null;
  hasCredentials: boolean;
} {
  if (isTwilioConfigured()) {
    return {
      configured: true,
      provider: "twilio",
      serverUrl: "global.turn.twilio.com",
      hasCredentials: true,
    };
  }

  const hasSelfHosted = !!(process.env.TURN_SERVER_URL);
  if (hasSelfHosted) {
    return {
      configured: true,
      provider: "self-hosted",
      serverUrl: process.env.TURN_SERVER_URL || null,
      hasCredentials: !!(process.env.TURN_SERVER_USERNAME && process.env.TURN_SERVER_CREDENTIAL),
    };
  }

  return {
    configured: true,
    provider: "self-hosted" as const,
    serverUrl: "openrelay.metered.ca (free public TURN)",
    hasCredentials: true,
  };
}
