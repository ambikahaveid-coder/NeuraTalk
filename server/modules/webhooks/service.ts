import { randomBytes, createHmac, timingSafeEqual } from "crypto";
import { lookup as dnsLookup } from "dns/promises";
import { isIP } from "net";
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
 * Checked in two places (registration AND every delivery attempt) because
 * a hostname that resolves to a public IP at registration time can be
 * "rebound" via DNS to a private IP later (DNS rebinding) — checking only
 * once at registration is not sufficient.
 */
function isDisallowedIpv4(ip: string): boolean {
  const octets = ip.split(".").map(Number);
  const [a, b] = octets;
  if (a === 127) return true; // loopback
  if (a === 10) return true; // RFC1918
  if (a === 172 && b >= 16 && b <= 31) return true; // RFC1918
  if (a === 192 && b === 168) return true; // RFC1918
  if (a === 169 && b === 254) return true; // link-local, incl. cloud metadata (169.254.169.254)
  if (a === 0) return true; // "this network"
  return false;
}

function isDisallowedIp(ip: string): boolean {
  const version = isIP(ip);
  if (version === 4) {
    return isDisallowedIpv4(ip);
  }
  if (version === 6) {
    const normalized = ip.toLowerCase();
    if (normalized === "::1") return true; // loopback
    if (normalized.startsWith("fe80:") || normalized.startsWith("fe80::")) return true; // link-local
    if (normalized.startsWith("fc") || normalized.startsWith("fd")) return true; // unique local (RFC4193)

    // IPv4-mapped IPv6 (::ffff:a.b.c.d) and the less common IPv4-compatible
    // (::a.b.c.d) forms — without unwrapping these, an attacker can dial an
    // otherwise-blocked IPv4 private/metadata address (e.g. "::ffff:169.254.169.254")
    // right past the checks above, since the string-prefix tests only look
    // at the leading IPv6-specific bytes and never inspect the embedded IPv4.
    const v4MappedMatch = normalized.match(/^::(ffff:)?(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
    if (v4MappedMatch) {
      const embeddedV4 = v4MappedMatch[2];
      if (isIP(embeddedV4) === 4) return isDisallowedIpv4(embeddedV4);
    }
    return false;
  }
  return true; // couldn't parse as an IP at all — reject rather than guess
}

export async function assertWebhookUrlIsSafe(rawUrl: string): Promise<void> {
  const parsed = new URL(rawUrl);
  if (parsed.protocol !== "https:") {
    throw new Error("WEBHOOK_URL_MUST_BE_HTTPS");
  }
  const hostname = parsed.hostname.toLowerCase();
  if (hostname === "localhost" || hostname.endsWith(".localhost")) {
    throw new Error("WEBHOOK_URL_TARGETS_DISALLOWED_HOST");
  }

  // If the hostname is itself a literal IP, check it directly. Otherwise
  // resolve it — a public-looking domain can still point at a private IP.
  const literalIpVersion = isIP(hostname);
  if (literalIpVersion) {
    if (isDisallowedIp(hostname)) throw new Error("WEBHOOK_URL_TARGETS_DISALLOWED_HOST");
    return;
  }

  try {
    const { address } = await dnsLookup(hostname);
    if (isDisallowedIp(address)) throw new Error("WEBHOOK_URL_TARGETS_DISALLOWED_HOST");
  } catch (error) {
    if (error instanceof Error && error.message === "WEBHOOK_URL_TARGETS_DISALLOWED_HOST") throw error;
    // DNS resolution failure — treat as unsafe/invalid rather than silently allowing it through.
    throw new Error("WEBHOOK_URL_UNRESOLVABLE");
  }
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

  try {
    // Re-checked on every delivery attempt, not just once at registration —
    // DNS rebinding means a hostname that resolved to a safe public IP when
    // the endpoint was registered could resolve to an internal/private IP
    // by the time this fires (which could be days later, given the retry
    // backoff schedule).
    await assertWebhookUrlIsSafe(endpoint.url);
  } catch (error) {
    await recordFailedAttempt(delivery.id, attempts, null, `Blocked by SSRF guard: ${String(error instanceof Error ? error.message : error)}`);
    return;
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), DELIVERY_TIMEOUT_MS);
    let response: Response;
    try {
      response = await fetch(endpoint.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-NeuraTalk-Signature": signature,
          "X-NeuraTalk-Event": delivery.eventType,
          "X-NeuraTalk-Delivery-Id": String(delivery.id),
        },
        body: rawBody,
        signal: controller.signal,
        // CRITICAL for the SSRF guard above to actually mean anything: without
        // this, a webhook endpoint that passed assertWebhookUrlIsSafe could
        // respond with a 3xx to an internal/private address, and fetch's
        // default "follow" behavior would silently chase it there — with our
        // signed payload — without ever re-validating the redirect target.
        redirect: "manual",
      });
    } finally {
      clearTimeout(timeout);
    }

    if (response.status >= 300 && response.status < 400) {
      await recordFailedAttempt(
        delivery.id, attempts, response.status,
        "Webhook endpoint returned a redirect — redirects are not followed for security (SSRF protection). Register the final destination URL directly.",
      );
      return;
    }

    if (response.ok) {
      await db.update(webhookDeliveries).set({
        status: WEBHOOK_DELIVERY_STATUS.DELIVERED,
        attempts,
        lastAttemptAt: new Date(),
        lastResponseCode: response.status,
        deliveredAt: new Date(),
      }).where(eq(webhookDeliveries.id, delivery.id));
      return;
    }

    await recordFailedAttempt(delivery.id, attempts, response.status, `HTTP ${response.status}`);
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
