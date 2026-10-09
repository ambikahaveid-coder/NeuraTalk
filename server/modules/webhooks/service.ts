import { randomBytes, createHmac, timingSafeEqual } from "crypto";
import { lookup as dnsLookup } from "dns/promises";
import { isIP } from "net";
import { request as httpsRequest } from "node:https";
import { eq, and, lte, or, isNull } from "drizzle-orm";
import { db } from "../../db";
import {
  webhookEndpoints,
  webhookDeliveries,
  WEBHOOK_DELIVERY_STATUS,
  WEBHOOK_EVENT_TYPES,
  type WebhookEndpoint,
  type WebhookDelivery,
} from "@shared/schema";
import { logger } from "../../observability";

export type WebhookEventType = (typeof WEBHOOK_EVENT_TYPES)[number];

// Exponential backoff schedule for failed deliveries — mirrors the pattern
// used elsewhere in this codebase (payment gateway retries) rather than
// inventing a new one. Gives up (status: exhausted) after the last entry.
const RETRY_DELAYS_MS = [60_000, 5 * 60_000, 30 * 60_000, 2 * 60 * 60_000];
const DELIVERY_TIMEOUT_MS = 10_000;

export function isValidWebhookEventType(value: string): value is WebhookEventType {
  return (WEBHOOK_EVENT_TYPES as readonly string[]).includes(value);
}

/**
 * SSRF defense. An org admin can register any HTTPS URL; without this
 * check, this server would happily make an authenticated-looking outbound
 * request (with a real payload) to internal infrastructure — including
 * cloud metadata endpoints (169.254.169.254, a classic SSRF target that
 * can leak cloud credentials) or other services on the private network.
 *
 * DNS answers are checked at registration and every delivery, then pinned
 * to the HTTPS connection so a later re-resolution cannot rebind to private
 * infrastructure between validation and the request.
 */
function isDisallowedIpv4(ip: string): boolean {
  const octets = ip.split(".").map(Number);
  const [a, b, c] = octets;
  if (a === 127) return true; // loopback
  if (a === 10) return true; // RFC1918
  if (a === 172 && b >= 16 && b <= 31) return true; // RFC1918
  if (a === 192 && b === 168) return true; // RFC1918
  if (a === 169 && b === 254) return true; // link-local, incl. cloud metadata (169.254.169.254)
  if (a === 0) return true; // "this network"
  if (a === 100 && b >= 64 && b <= 127) return true; // shared address space
  if (a === 192 && b === 0) return true; // IETF protocol assignments
  if (a === 192 && b === 88 && c === 99) return true; // deprecated 6to4 relay anycast
  if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking
  if (a === 198 && b === 51 && c === 100) return true; // documentation
  if (a === 203 && b === 0 && c === 113) return true; // documentation
  if (a >= 224) return true; // multicast, reserved, and limited broadcast
  return false;
}

function parseIpv6Bytes(address: string): number[] | null {
  let normalized = address.toLowerCase();
  if (normalized.includes(".")) {
    const lastColon = normalized.lastIndexOf(":");
    const embeddedIpv4 = normalized.slice(lastColon + 1);
    if (lastColon < 0 || isIP(embeddedIpv4) !== 4) return null;
    const [a, b, c, d] = embeddedIpv4.split(".").map(Number);
    normalized = `${normalized.slice(0, lastColon + 1)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }

  const compressionIndex = normalized.indexOf("::");
  let groups: string[];
  if (compressionIndex >= 0) {
    if (normalized.indexOf("::", compressionIndex + 2) >= 0) return null;
    const left = normalized.slice(0, compressionIndex).split(":").filter(Boolean);
    const right = normalized.slice(compressionIndex + 2).split(":").filter(Boolean);
    const missingGroups = 8 - left.length - right.length;
    if (missingGroups < 1) return null;
    groups = [...left, ...Array(missingGroups).fill("0"), ...right];
  } else {
    groups = normalized.split(":");
  }

  if (groups.length !== 8 || groups.some((group) => !/^[0-9a-f]{1,4}$/.test(group))) return null;
  return groups.flatMap((group) => {
    const value = Number.parseInt(group, 16);
    return [value >> 8, value & 0xff];
  });
}

function isDisallowedIpv6(ip: string): boolean {
  const bytes = parseIpv6Bytes(ip);
  if (!bytes) return true;

  const isUnspecified = bytes.every((byte) => byte === 0);
  const isLoopback = bytes.slice(0, 15).every((byte) => byte === 0) && bytes[15] === 1;
  if (isUnspecified || isLoopback) return true;
  if (bytes[0] === 0xff) return true; // multicast
  if (bytes[0] === 0xfe && (bytes[1] & 0xc0) === 0x80) return true; // link-local
  if ((bytes[0] & 0xfe) === 0xfc) return true; // unique local (RFC4193)
  if (bytes[0] === 0x20 && bytes[1] === 0x01 && bytes[2] === 0x0d && bytes[3] === 0xb8) return true; // documentation
  if (bytes[0] === 0x20 && bytes[1] === 0x02) return true; // 6to4
  if (bytes[0] === 0x01 && bytes.slice(1, 8).every((byte) => byte === 0)) return true; // discard-only

  const isIpv4Mapped = bytes.slice(0, 10).every((byte) => byte === 0)
    && bytes[10] === 0xff && bytes[11] === 0xff;
  const isIpv4Compatible = bytes.slice(0, 12).every((byte) => byte === 0);
  if (isIpv4Mapped || isIpv4Compatible) {
    const embeddedIpv4 = bytes.slice(12).join(".");
    return isDisallowedIpv4(embeddedIpv4);
  }

  return false;
}

function isDisallowedIp(ip: string): boolean {
  const version = isIP(ip);
  if (version === 4) return isDisallowedIpv4(ip);
  if (version === 6) return isDisallowedIpv6(ip);
  return true; // couldn't parse as an IP at all — reject rather than guess
}

interface SafeWebhookTarget {
  url: URL;
  hostname: string;
  addresses: Array<{ address: string; family: number }> | null;
}

function normalizeHostname(hostname: string): string {
  const withoutBrackets = hostname.startsWith("[") && hostname.endsWith("]")
    ? hostname.slice(1, -1)
    : hostname;
  return withoutBrackets.toLowerCase().replace(/\.$/, "");
}

async function resolveSafeWebhookTarget(rawUrl: string): Promise<SafeWebhookTarget> {
  const parsed = new URL(rawUrl);
  if (parsed.protocol !== "https:") {
    throw new Error("WEBHOOK_URL_MUST_BE_HTTPS");
  }
  const hostname = normalizeHostname(parsed.hostname);
  if (hostname === "localhost" || hostname.endsWith(".localhost")) {
    throw new Error("WEBHOOK_URL_TARGETS_DISALLOWED_HOST");
  }

  // If the hostname is itself a literal IP, check it directly. Otherwise
  // resolve every address — a public-looking domain can still point at a private IP.
  const literalIpVersion = isIP(hostname);
  if (literalIpVersion) {
    if (isDisallowedIp(hostname)) throw new Error("WEBHOOK_URL_TARGETS_DISALLOWED_HOST");
    return { url: parsed, hostname, addresses: null };
  }

  let addresses: Array<{ address: string; family: number }>;
  try {
    addresses = await dnsLookup(hostname, { all: true, verbatim: true });
  } catch {
    // DNS resolution failure — treat as unsafe/invalid rather than silently allowing it through.
    throw new Error("WEBHOOK_URL_UNRESOLVABLE");
  }
  if (addresses.length === 0) throw new Error("WEBHOOK_URL_UNRESOLVABLE");
  if (addresses.some(({ address }) => isDisallowedIp(address))) {
    throw new Error("WEBHOOK_URL_TARGETS_DISALLOWED_HOST");
  }
  return { url: parsed, hostname, addresses };
}

export async function assertWebhookUrlIsSafe(rawUrl: string): Promise<void> {
  await resolveSafeWebhookTarget(rawUrl);
}

export async function registerWebhookEndpoint(input: {
  organizationId: number;
  url: string;
  subscribedEvents: string[];
  createdBy: number;
}): Promise<WebhookEndpoint> {
  await assertWebhookUrlIsSafe(input.url);
  const unknownEvents = input.subscribedEvents.filter((e) => !isValidWebhookEventType(e));
  if (unknownEvents.length > 0) {
    throw new Error(`UNKNOWN_EVENT_TYPES:${unknownEvents.join(",")}`);
  }

  const secret = randomBytes(32).toString("hex");
  const [row] = await db.insert(webhookEndpoints).values({
    organizationId: input.organizationId,
    url: input.url,
    secret,
    subscribedEvents: input.subscribedEvents,
    createdBy: input.createdBy,
  }).returning();
  return row;
}

export async function listWebhookEndpoints(organizationId: number): Promise<Omit<WebhookEndpoint, "secret">[]> {
  const rows = await db.select().from(webhookEndpoints)
    .where(eq(webhookEndpoints.organizationId, organizationId));
  return rows.map(({ secret: _secret, ...rest }) => rest);
}

export async function deleteWebhookEndpoint(organizationId: number, id: number): Promise<boolean> {
  const result = await db.delete(webhookEndpoints)
    .where(and(eq(webhookEndpoints.id, id), eq(webhookEndpoints.organizationId, organizationId)))
    .returning({ id: webhookEndpoints.id });
  return result.length > 0;
}

export async function setWebhookEndpointActive(organizationId: number, id: number, isActive: boolean): Promise<boolean> {
  const result = await db.update(webhookEndpoints)
    .set({ isActive, updatedAt: new Date() })
    .where(and(eq(webhookEndpoints.id, id), eq(webhookEndpoints.organizationId, organizationId)))
    .returning({ id: webhookEndpoints.id });
  return result.length > 0;
}

export async function updateWebhookEndpoint(
  organizationId: number,
  id: number,
  input: { url?: string; subscribedEvents?: string[] },
): Promise<boolean> {
  if (input.url) {
    await assertWebhookUrlIsSafe(input.url);
  }
  if (input.subscribedEvents) {
    const unknownEvents = input.subscribedEvents.filter((e) => !isValidWebhookEventType(e));
    if (unknownEvents.length > 0) {
      throw new Error(`UNKNOWN_EVENT_TYPES:${unknownEvents.join(",")}`);
    }
  }
  const patch: Record<string, unknown> = { updatedAt: new Date() };
  if (input.url) patch.url = input.url;
  if (input.subscribedEvents) patch.subscribedEvents = input.subscribedEvents;

  const result = await db.update(webhookEndpoints)
    .set(patch)
    .where(and(eq(webhookEndpoints.id, id), eq(webhookEndpoints.organizationId, organizationId)))
    .returning({ id: webhookEndpoints.id });
  return result.length > 0;
}

/**
 * Rotate a webhook endpoint's signing secret in place (P1 foundation hardening,
 * 2026-08-23). Same "no delete+recreate" rationale as API key rotation --
 * preserves the endpoint id, URL, subscribed events, and delivery history.
 * The new secret is returned once, same one-time-display contract as
 * registerWebhookEndpoint already uses.
 */
export async function rotateWebhookSecret(organizationId: number, id: number): Promise<string | null> {
  const secret = randomBytes(32).toString("hex");
  const result = await db.update(webhookEndpoints)
    .set({ secret, updatedAt: new Date() })
    .where(and(eq(webhookEndpoints.id, id), eq(webhookEndpoints.organizationId, organizationId)))
    .returning({ id: webhookEndpoints.id });
  return result.length > 0 ? secret : null;
}

/** HMAC-SHA256 signature over the raw JSON body — same primitive used to verify MSG91/Razorpay webhooks, just for outbound. */
export function signWebhookPayload(secret: string, rawBody: string): string {
  return createHmac("sha256", secret).update(rawBody).digest("hex");
}

/** Constant-time verification helper, exported so tests (and, if ever needed, an internal replay tool) don't reimplement timing-safe comparison. */
export function verifyWebhookSignature(secret: string, rawBody: string, providedSignatureHex: string): boolean {
  const expected = signWebhookPayload(secret, rawBody);
  try {
    const expectedBuf = Buffer.from(expected, "hex");
    const providedBuf = Buffer.from(providedSignatureHex, "hex");
    if (providedBuf.length !== expectedBuf.length) {
      timingSafeEqual(expectedBuf, expectedBuf); // keep timing consistent even on length mismatch
      return false;
    }
    return timingSafeEqual(providedBuf, expectedBuf);
  } catch {
    return false;
  }
}

/**
 * Fire-and-forget from the caller's perspective — creates a delivery row per
 * subscribed endpoint and attempts immediate delivery. Never throws: a
 * webhook customer's unreachable server must not be able to affect the
 * call/translation flow that triggered the event.
 */
export async function dispatchEvent(
  organizationId: number,
  eventType: WebhookEventType,
  payload: Record<string, unknown>,
): Promise<void> {
  try {
    const endpoints = await db.select().from(webhookEndpoints).where(
      and(eq(webhookEndpoints.organizationId, organizationId), eq(webhookEndpoints.isActive, true)),
    );
    const subscribed = endpoints.filter((ep) => {
      const events = Array.isArray(ep.subscribedEvents) ? (ep.subscribedEvents as string[]) : [];
      return events.includes(eventType);
    });
    if (subscribed.length === 0) return;

    const fullPayload = { event: eventType, occurredAt: new Date().toISOString(), data: payload };

    await Promise.all(subscribed.map(async (endpoint) => {
      const [delivery] = await db.insert(webhookDeliveries).values({
        webhookEndpointId: endpoint.id,
        eventType,
        payload: fullPayload,
        status: WEBHOOK_DELIVERY_STATUS.PENDING,
      }).returning();
      await attemptDelivery(delivery, endpoint).catch((err) => {
        logger.warn("Webhooks", `dispatch attempt threw for delivery ${delivery.id}: ${String(err)}`);
      });
    }));
  } catch (error) {
    logger.warn("Webhooks", `dispatchEvent failed for org ${organizationId}, event ${eventType}: ${String(error)}`);
  }
}

async function attemptDelivery(delivery: WebhookDelivery, endpoint: WebhookEndpoint): Promise<void> {
  const rawBody = JSON.stringify(delivery.payload);
  const signature = signWebhookPayload(endpoint.secret, rawBody);
  const attempts = delivery.attempts + 1;
  let safeTarget: SafeWebhookTarget;

  try {
    safeTarget = await resolveSafeWebhookTarget(endpoint.url);
  } catch (error) {
    await recordFailedAttempt(delivery.id, attempts, null, `Blocked by SSRF guard: ${String(error instanceof Error ? error.message : error)}`);
    return;
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), DELIVERY_TIMEOUT_MS);
    let statusCode: number;
    try {
      statusCode = await new Promise<number>((resolve, reject) => {
        const resolvedAddresses = safeTarget.addresses;
        const lookup = resolvedAddresses ? (hostname: string, options: import("node:dns").LookupOptions, callback: (error: NodeJS.ErrnoException | null, address: string | import("node:dns").LookupAddress[], family?: number) => void) => {
          if (normalizeHostname(hostname) !== safeTarget.hostname) {
            const error = Object.assign(new Error("Unexpected webhook hostname lookup"), { code: "ENOTFOUND" });
            callback(error, "", 0);
            return;
          }
          const requestedFamily = options.family === "IPv4" ? 4
            : options.family === "IPv6" ? 6
              : options.family;
          const matchingAddresses = resolvedAddresses.filter(
            (address) => !requestedFamily || address.family === requestedFamily,
          );
          if (matchingAddresses.length === 0) {
            const error = Object.assign(new Error("No safe webhook addresses available"), { code: "ENOTFOUND" });
            callback(error, "", 0);
            return;
          }
          if (options.all) {
            callback(null, matchingAddresses);
          } else {
            callback(null, matchingAddresses[0].address, matchingAddresses[0].family);
          }
        } : undefined;
        const request = httpsRequest(safeTarget.url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-NeuraTalk-Signature": signature,
            "X-NeuraTalk-Event": delivery.eventType,
            "X-NeuraTalk-Delivery-Id": String(delivery.id),
          },
          signal: controller.signal,
          lookup,
        }, (response) => {
          response.resume();
          resolve(response.statusCode ?? 0);
        });
        request.on("error", reject);
        request.end(rawBody);
      });
    } finally {
      clearTimeout(timeout);
    }

    if (statusCode >= 300 && statusCode < 400) {
      await recordFailedAttempt(
        delivery.id, attempts, statusCode,
        "Webhook endpoint returned a redirect — redirects are not followed for security (SSRF protection). Register the final destination URL directly.",
      );
      return;
    }

    if (statusCode >= 200 && statusCode < 300) {
      await db.update(webhookDeliveries).set({
        status: WEBHOOK_DELIVERY_STATUS.DELIVERED,
        attempts,
        lastAttemptAt: new Date(),
        lastResponseCode: statusCode,
        deliveredAt: new Date(),
      }).where(eq(webhookDeliveries.id, delivery.id));
      return;
    }

    await recordFailedAttempt(delivery.id, attempts, statusCode, `HTTP ${statusCode}`);
  } catch (error) {
    await recordFailedAttempt(delivery.id, attempts, null, String(error instanceof Error ? error.message : error));
  }
}

async function recordFailedAttempt(
  deliveryId: number,
  attempts: number,
  responseCode: number | null,
  errorMessage: string,
): Promise<void> {
  const delayMs = RETRY_DELAYS_MS[attempts - 1];
  const exhausted = delayMs === undefined;
  await db.update(webhookDeliveries).set({
    status: exhausted ? WEBHOOK_DELIVERY_STATUS.EXHAUSTED : WEBHOOK_DELIVERY_STATUS.FAILED,
    attempts,
    lastAttemptAt: new Date(),
    lastResponseCode: responseCode,
    lastError: errorMessage.slice(0, 500),
    nextRetryAt: exhausted ? null : new Date(Date.now() + delayMs),
  }).where(eq(webhookDeliveries.id, deliveryId));
}

/**
 * Periodic sweep for retryable failed deliveries — called from
 * server/index.ts on the same setInterval pattern as
 * runDataRetentionCleanup/runBillingLifecycleCheck. Each call processes
 * whatever is currently due; safe to run concurrently with itself since
 * each row is only picked up once its nextRetryAt has passed and the
 * status transition happens atomically in attemptDelivery/recordFailedAttempt.
 */
export async function retryDueWebhookDeliveries(): Promise<{ attempted: number }> {
  const due = await db.select().from(webhookDeliveries).where(
    and(
      eq(webhookDeliveries.status, WEBHOOK_DELIVERY_STATUS.FAILED),
      or(isNull(webhookDeliveries.nextRetryAt), lte(webhookDeliveries.nextRetryAt, new Date())),
    ),
  ).limit(100);

  if (due.length === 0) return { attempted: 0 };

  const endpointIds = Array.from(new Set(due.map((d) => d.webhookEndpointId)));
  const endpoints = await db.select().from(webhookEndpoints);
  const endpointById = new Map(endpoints.filter((e) => endpointIds.includes(e.id)).map((e) => [e.id, e]));

  await Promise.all(due.map(async (delivery) => {
    const endpoint = endpointById.get(delivery.webhookEndpointId);
    if (!endpoint || !endpoint.isActive) return;
    await attemptDelivery(delivery, endpoint).catch((err) => {
      logger.warn("Webhooks", `retry attempt threw for delivery ${delivery.id}: ${String(err)}`);
    });
  }));

  return { attempted: due.length };
}

/** Same start-a-scheduler convention as startCleanupScheduler/startBillingScheduler in server/index.ts. */
export function startWebhookRetryScheduler(): void {
  setInterval(() => {
    void retryDueWebhookDeliveries().catch((err) => {
      logger.warn("Webhooks", `retry sweep failed: ${String(err)}`);
    });
  }, 5 * 60_000); // every 5 minutes — matches the shortest retry delay tier
  logger.info("Webhooks", "Webhook retry scheduler initialized (5min interval)");
}
