import type { NextFunction, Request, Response } from "express";
import crypto from "crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "./db";
import { billingPlans, enterpriseApiKeys, organizations, subscriptions } from "@shared/schema";
import { getOrganizationBillingSnapshot } from "./organization-billing";

export const API_KEY_PERMISSIONS = [
  "translate",
  "tts",
  "stt",
  "languages",
  "voice-chat",
  "calls:create",
  "calls:end",
  "calls:read",
  "usage:read",
  "billing:read",
  "ws:subscribe",
  "masking:manage",
  "recording:control",
] as const;

export type ApiKeyPermission = typeof API_KEY_PERMISSIONS[number];

interface RateLimitBucket {
  count: number;
  windowStart: number;
}

export interface AuthenticatedApiKey {
  id: number;
  organizationId: number;
  name: string;
  keyPrefix: string;
  status: string;
  permissions: string[];
  rateLimitPerMinute: number;
  dailyQuota: number | null;
  usageCount: number;
  usageToday: number;
  usageResetDate: string | null;
  lastUsedAt: Date | null;
  expiresAt: Date | null;
  billingModel: string | null;
  balanceUnits: number;
  walletBalancePaise: number;
  includedSecondsRemaining: number;
  includedCreditsRemainingPaise: number;
  subscriptionId: number | null;
  subscriptionEndsAt: Date | null;
}

export interface ApiKeyAuthResult {
  ok: boolean;
  status: number;
  apiKey?: AuthenticatedApiKey;
  body?: Record<string, unknown>;
  headers: Record<string, string>;
}

declare global {
  namespace Express {
    interface Request {
      apiKey?: AuthenticatedApiKey;
    }
  }
}

const apiKeyMinuteBuckets = new Map<number, RateLimitBucket>();
const permissionAliases: Partial<Record<ApiKeyPermission, ApiKeyPermission[]>> = {
  "calls:create": ["voice-chat"],
  "calls:end": ["voice-chat"],
  "calls:read": ["voice-chat"],
  "usage:read": ["voice-chat"],
  "billing:read": ["voice-chat"],
  "ws:subscribe": ["voice-chat"],
  "masking:manage": ["voice-chat"],
  "recording:control": ["voice-chat"],
};

setInterval(() => {
  const now = Date.now();
  apiKeyMinuteBuckets.forEach((bucket, keyId) => {
    if (now - bucket.windowStart >= 60_000) {
      apiKeyMinuteBuckets.delete(keyId);
    }
  });
}, 30_000).unref?.();

export function normalizePermissions(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((permission): permission is string => typeof permission === "string") : [];
}

export function isValidApiKeyPermission(permission: string): permission is ApiKeyPermission {
  return (API_KEY_PERMISSIONS as readonly string[]).includes(permission);
}

export function parseExpiryDateInput(value?: string | null): Date | null {
  if (!value) return null;

  const normalized = /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? `${value}T23:59:59.999Z`
    : value;
  const parsed = new Date(normalized);

  if (Number.isNaN(parsed.getTime())) {
    throw new Error("Invalid expiry date");
  }

  return parsed;
}

function getTodayDateString(): string {
  return new Date().toISOString().split("T")[0];
}

function hasRequiredPermission(effectivePermissions: string[], requiredPermission?: ApiKeyPermission): boolean {
  if (!requiredPermission) return true;
  if (effectivePermissions.includes(requiredPermission)) return true;

  const aliases = permissionAliases[requiredPermission] ?? [];
  return aliases.some((alias) => effectivePermissions.includes(alias));
}

function enforceMinuteRateLimit(
  keyId: number,
  limitPerMinute: number,
): { allowed: boolean; headers: Record<string, string> } {
  const now = Date.now();
  const normalizedLimit = Math.max(1, limitPerMinute || 60);
  const existingBucket = apiKeyMinuteBuckets.get(keyId);
  const bucket = !existingBucket || now - existingBucket.windowStart >= 60_000
    ? { count: 0, windowStart: now }
    : existingBucket;

  bucket.count += 1;
  apiKeyMinuteBuckets.set(keyId, bucket);

  const remaining = Math.max(0, normalizedLimit - bucket.count);
  const resetAt = bucket.windowStart + 60_000;
  const headers: Record<string, string> = {
    "X-RateLimit-Limit": String(normalizedLimit),
    "X-RateLimit-Remaining": String(remaining),
    "X-RateLimit-Reset": String(Math.ceil(resetAt / 1000)),
  };

  if (bucket.count > normalizedLimit) {
    headers["Retry-After"] = String(Math.max(1, Math.ceil((resetAt - now) / 1000)));
    return { allowed: false, headers };
  }

  return { allowed: true, headers };
}

export async function authenticateApiKey(
  rawApiKey: string | undefined,
  requiredPermission?: ApiKeyPermission,
): Promise<ApiKeyAuthResult> {
  if (!rawApiKey) {
    return {
      ok: false,
      status: 401,
      body: { error: "Missing X-API-Key header" },
      headers: {},
    };
  }

  try {
    const keyHash = crypto.createHash("sha256").update(rawApiKey).digest("hex");

    const keyRecord = await db.query.enterpriseApiKeys.findFirst({
      where: eq(enterpriseApiKeys.keyHash, keyHash),
    });

    if (!keyRecord) {
      return {
        ok: false,
        status: 401,
        body: { error: "Invalid API key" },
        headers: {},
      };
    }

    if (keyRecord.status !== "active") {
      return {
        ok: false,
        status: 403,
        body: { error: `API key is ${keyRecord.status}` },
        headers: {},
      };
    }

    if (keyRecord.expiresAt && new Date(keyRecord.expiresAt) < new Date()) {
      return {
        ok: false,
        status: 403,
        body: { error: "API key has expired" },
        headers: {},
      };
    }

    const permissions = normalizePermissions(keyRecord.permissions);
    const effectivePermissions = permissions.length > 0 ? permissions : [...API_KEY_PERMISSIONS];
    if (!hasRequiredPermission(effectivePermissions, requiredPermission)) {
      return {
        ok: false,
        status: 403,
        body: {
          error: "API key does not have permission for this endpoint",
          requiredPermission,
        },
        headers: {},
      };
    }

    const [organization] = await db
      .select({
        id: organizations.id,
        status: organizations.status,
        isActive: organizations.isActive,
      })
      .from(organizations)
      .where(eq(organizations.id, keyRecord.organizationId));

    if (!organization || !organization.isActive || organization.status !== "approved") {
      return {
        ok: false,
        status: 403,
        body: { error: "Organization is not active for SDK access" },
        headers: {},
      };
    }

    const [subscription] = await db
      .select({
        id: subscriptions.id,
        status: subscriptions.status,
        billingModel: subscriptions.billingModel,
        endDate: subscriptions.endDate,
        planName: billingPlans.name,
      })
      .from(subscriptions)
      .leftJoin(billingPlans, eq(subscriptions.planId, billingPlans.id))
      .where(and(
        eq(subscriptions.organizationId, keyRecord.organizationId),
        eq(subscriptions.status, "active"),
      ))
      .orderBy(desc(subscriptions.createdAt))
      .limit(1);

    if (!subscription) {
      return {
        ok: false,
        status: 402,
        body: {
          error: "Organization does not have an active subscription",
          code: "SUBSCRIPTION_REQUIRED",
        },
        headers: {},
      };
    }

    if (subscription.endDate && new Date(subscription.endDate) <= new Date()) {
      return {
        ok: false,
        status: 402,
        body: {
          error: "Organization subscription has expired",
          code: "SUBSCRIPTION_EXPIRED",
        },
        headers: {},
      };
    }

    const billingSnapshot = await getOrganizationBillingSnapshot(keyRecord.organizationId);
    const billingModel = billingSnapshot?.billingType || subscription.billingModel || "prepaid";
    const balanceUnits = Math.ceil((billingSnapshot?.availableWalletPaise ?? 0) / 100);
    const hasPaidCapacity = billingSnapshot?.canUsePaidServices ?? false;

    if (!hasPaidCapacity) {
      return {
        ok: false,
        status: 402,
        body: {
          error: billingModel === "postpaid"
            ? "Organization credit limit has been exhausted"
            : "Organization has no prepaid balance remaining",
          code: "PAYMENT_REQUIRED",
        },
        headers: {},
      };
    }

    const rateLimitPerMinute = Math.max(1, keyRecord.rateLimitPerMinute ?? 60);
    const rateLimit = enforceMinuteRateLimit(keyRecord.id, rateLimitPerMinute);
    if (!rateLimit.allowed) {
      return {
        ok: false,
        status: 429,
        body: {
          error: "Per-minute API rate limit exceeded",
          limit: rateLimitPerMinute,
        },
        headers: rateLimit.headers,
      };
    }

    const today = getTodayDateString();
    const usageToday = keyRecord.usageResetDate === today ? keyRecord.usageToday ?? 0 : 0;
    const dailyQuota = keyRecord.dailyQuota ?? null;
    if (dailyQuota && usageToday >= dailyQuota) {
      return {
        ok: false,
        status: 429,
        body: {
          error: "Daily quota exceeded",
          quota: dailyQuota,
          used: usageToday,
        },
        headers: rateLimit.headers,
      };
    }

    const nextUsageToday = usageToday + 1;
    await db.update(enterpriseApiKeys)
      .set({
        usageCount: sql<number>`COALESCE(${enterpriseApiKeys.usageCount}, 0) + 1`,
        usageToday: nextUsageToday,
        usageResetDate: today,
        lastUsedAt: new Date(),
      })
      .where(eq(enterpriseApiKeys.id, keyRecord.id));

    return {
      ok: true,
      status: 200,
      headers: rateLimit.headers,
      apiKey: {
        id: keyRecord.id,
        organizationId: keyRecord.organizationId,
        name: keyRecord.name,
        keyPrefix: keyRecord.keyPrefix,
        status: keyRecord.status,
        permissions: effectivePermissions,
        rateLimitPerMinute,
        dailyQuota,
        usageCount: (keyRecord.usageCount ?? 0) + 1,
        usageToday: nextUsageToday,
        usageResetDate: today,
        lastUsedAt: new Date(),
        expiresAt: keyRecord.expiresAt,
        billingModel,
        balanceUnits,
        walletBalancePaise: billingSnapshot?.walletBalancePaise ?? 0,
        includedSecondsRemaining: billingSnapshot?.includedSecondsRemaining ?? 0,
        includedCreditsRemainingPaise: billingSnapshot?.includedCreditsRemainingPaise ?? 0,
        subscriptionId: subscription.id,
        subscriptionEndsAt: subscription.endDate,
      },
    };
  } catch (error) {
    console.error("API key validation error:", error);
    return {
      ok: false,
      status: 500,
      body: { error: "Internal server error" },
      headers: {},
    };
  }
}

export function createApiKeyMiddleware(requiredPermission?: ApiKeyPermission) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const result = await authenticateApiKey(req.headers["x-api-key"] as string | undefined, requiredPermission);
    Object.entries(result.headers).forEach(([key, value]) => res.setHeader(key, value));

    if (!result.ok || !result.apiKey) {
      res.status(result.status).json(result.body);
      return;
    }

    req.apiKey = result.apiKey;
    next();
  };
}
