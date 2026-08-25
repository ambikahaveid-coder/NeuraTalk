import crypto from "crypto";
import type { Request, Response, NextFunction } from "express";
import { getRedisClient } from "./redis";
import { logger } from "./observability";
import { logAuditEvent } from "./audit-logging";

function hashIdentifier(id: string): string {
  return crypto.createHash("sha256").update(id.toLowerCase().trim()).digest("hex").slice(0, 20);
}

function maskIdentifier(id: string): string {
  if (id.includes("@")) {
    const [local, domain] = id.split("@");
    return `${local.slice(0, 2)}***@${domain}`;
  }
  if (id.startsWith("+")) return `${id.slice(0, 4)}****${id.slice(-2)}`;
  return `${id.slice(0, 2)}****`;
}

interface Bucket {
  count: number;
  resetAt: number;
}

interface Options {
  windowMs: number;
  max: number;
  keyFn?: (req: Request) => string;
  message?: string;
}

async function incrementWithRedis(key: string, windowMs: number): Promise<{ count: number; ttlMs: number }> {
  const client = getRedisClient();
  const count = await client.incr(key);

  if (count === 1) {
    await client.pexpire(key, windowMs);
  }

  const ttlMs = Math.max(await client.pttl(key), 0);
  return { count, ttlMs };
}

export function rateLimit(opts: Options) {
  const { windowMs, max, message = "Too many requests, please slow down" } = opts;
  const buckets = new Map<string, Bucket>();
  const keyFn = opts.keyFn ?? ((req) => req.ip ?? "unknown");

  setInterval(() => {
    const now = Date.now();
    buckets.forEach((value, key) => {
      if (value.resetAt <= now) {
        buckets.delete(key);
      }
    });
  }, Math.max(windowMs, 30_000)).unref?.();

  return async (req: Request, res: Response, next: NextFunction) => {
    const now = Date.now();
    const key = keyFn(req);
    const redisKey = `rate-limit:${key}`;

    try {
      const { count, ttlMs } = await incrementWithRedis(redisKey, windowMs);
      if (count > max) {
        const retryAfterSec = Math.ceil(ttlMs / 1000);
        res.setHeader("Retry-After", String(retryAfterSec));
        res.setHeader("X-RateLimit-Limit", String(max));
        res.setHeader("X-RateLimit-Remaining", "0");
        return res.status(429).json({ success: false, message });
      }

      res.setHeader("X-RateLimit-Limit", String(max));
      res.setHeader("X-RateLimit-Remaining", String(Math.max(0, max - count)));
      next();
      return;
    } catch (error) {
      logger.warn("RateLimit", "Redis-backed rate limit unavailable, falling back to local memory", {
        key: redisKey,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    let bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + windowMs };
      buckets.set(key, bucket);
    }

    bucket.count += 1;
    if (bucket.count > max) {
      const retryAfterSec = Math.ceil((bucket.resetAt - now) / 1000);
      res.setHeader("Retry-After", String(retryAfterSec));
      res.setHeader("X-RateLimit-Limit", String(max));
      res.setHeader("X-RateLimit-Remaining", "0");
      return res.status(429).json({ success: false, message });
    }

    res.setHeader("X-RateLimit-Limit", String(max));
    res.setHeader("X-RateLimit-Remaining", String(Math.max(0, max - bucket.count)));
    next();
  };
}

export const authLimiter = rateLimit({
  windowMs: 60_000,
  max: 10,
  message: "Too many auth attempts. Try again in a minute.",
});

export const otpRequestLimiter = rateLimit({
  windowMs: 60_000,
  max: 3,
  message: "Too many OTP requests. Try again in a minute.",
});

export const otpRequestDailyLimiter = rateLimit({
  windowMs: 24 * 60 * 60_000,
  max: 10,
  keyFn: (req) => {
    const id = (req.body?.identifier as string | undefined) ?? "";
    return `otp-daily:${id ? hashIdentifier(id) : req.ip || "unknown"}`;
  },
  message: "Daily OTP limit reached. Try again tomorrow.",
});

export const otpPhoneRequestLimiter = rateLimit({
  windowMs: 10 * 60_000,
  max: 5,
  keyFn: (req) => {
    const id = (req.body?.identifier as string | undefined) ?? "";
    return `otp-phone:${id ? hashIdentifier(id) : req.ip || "unknown"}`;
  },
  message: "Too many OTP requests for this number. Try again in 10 minutes.",
});

export const otpVerifyLimiter = rateLimit({
  windowMs: 15 * 60_000,
  max: 10,
  message: "Too many verification attempts. Please request a new code.",
});

export const wsTokenLimiter = rateLimit({
  windowMs: 60_000,
  max: 30,
});

export const paymentCreateLimiter = rateLimit({
  windowMs: 60_000,
  max: 10,
  keyFn: (req) => `payment-create:${(req as Request & { user?: { id?: number } }).user?.id ?? req.ip ?? "unknown"}`,
  message: "Too many payment order attempts. Please try again shortly.",
});

export const paymentVerifyLimiter = rateLimit({
  windowMs: 15 * 60_000,
  max: 20,
  keyFn: (req) => `payment-verify:${(req as Request & { user?: { id?: number } }).user?.id ?? req.ip ?? "unknown"}`,
  message: "Too many payment verification attempts. Please wait before retrying.",
});

export const paymentWebhookLimiter = rateLimit({
  windowMs: 60_000,
  max: 120,
  keyFn: (req) => `payment-webhook:${req.ip ?? "unknown"}`,
  message: "Webhook rate limit exceeded.",
});

export const paymentRefundLimiter = rateLimit({
  windowMs: 15 * 60_000,
  max: 10,
  keyFn: (req) => `payment-refund:${(req as Request & { user?: { id?: number } }).user?.id ?? req.ip ?? "unknown"}`,
  message: "Too many refund requests. Please wait before retrying.",
});

// A prior audit found /api/queues/:queueId/join had no rate limit despite
// creating a real, billed LiveKit room per call (via initiateConference)
// before enqueueing — an authenticated user hitting this in a tight loop
// could cheaply spin up unlimited billed rooms. Flagged as inconsistent
// with this same feature set's own PSTN velocity-check intent.
export const queueJoinLimiter = rateLimit({
  windowMs: 60_000,
  max: 10,
  keyFn: (req) => `queue-join:${(req as Request & { user?: { id?: number } }).user?.id ?? req.ip ?? "unknown"}`,
  message: "Too many queue-join attempts. Please wait before retrying.",
});

const OTP_FAIL_MAX = 5;
const OTP_FAIL_WINDOW_SEC = 900;   // 15-minute failure window
const OTP_LOCKOUT_SEC = 1800;      // 30-minute lockout after OTP_FAIL_MAX failures

/**
 * `namespace` defaults to "" (the platform's own login-OTP key space,
 * unchanged from Phase-6-prior behavior) so every existing caller keeps
 * working identically. Phase 6's business OTP module passes a distinct
 * namespace (e.g. "biz") so a failed business-customer OTP attempt can
 * never trigger a lockout on that same person's PLATFORM login OTP, and
 * vice versa -- same mechanism, separate key spaces, not a second limiter.
 */
export function otpVerifyLockoutCheck(namespace = "") {
  const prefix = namespace ? `${namespace}-otp-lockout` : "otp-lockout";
  return async (req: Request, res: Response, next: NextFunction) => {
    const identifier = (req.body?.identifier as string | undefined) ?? "";
    if (!identifier) return next();
    const lockKey = `${prefix}:${hashIdentifier(identifier)}`;
    try {
      const client = getRedisClient();
      const locked = await client.get(lockKey);
      if (locked) {
        const ttlMs = Math.max(await client.pttl(lockKey), 0);
        const ttlSec = Math.ceil(ttlMs / 1000);
        const ttlMin = Math.ceil(ttlSec / 60);
        logger.warn("RateLimit", `OTP verify blocked — identifier locked out`, { masked: maskIdentifier(identifier), ttlSec });
        res.setHeader("Retry-After", String(ttlSec));
        return res.status(429).json({ success: false, message: `Too many failed attempts. Try again in ${ttlMin} minute${ttlMin !== 1 ? "s" : ""}.` });
      }
    } catch {
      // Redis unavailable — allow through (fail-open to avoid blocking legitimate users)
    }
    return next();
  };
}

export async function isOtpVerifyLockedOut(identifier: string, namespace = ""): Promise<{ locked: boolean; ttlSec?: number }> {
  const prefix = namespace ? `${namespace}-otp-lockout` : "otp-lockout";
  const lockKey = `${prefix}:${hashIdentifier(identifier)}`;
  try {
    const client = getRedisClient();
    const locked = await client.get(lockKey);
    if (!locked) return { locked: false };
    const ttlMs = Math.max(await client.pttl(lockKey), 0);
    return { locked: true, ttlSec: Math.ceil(ttlMs / 1000) };
  } catch {
    return { locked: false }; // fail-open, consistent with otpVerifyLockoutCheck
  }
}

export async function recordOtpVerifyFailure(identifier: string, namespace = ""): Promise<void> {
  const failPrefix = namespace ? `${namespace}-otp-fail` : "otp-fail";
  const lockPrefix = namespace ? `${namespace}-otp-lockout` : "otp-lockout";
  const failKey = `${failPrefix}:${hashIdentifier(identifier)}`;
  const lockKey = `${lockPrefix}:${hashIdentifier(identifier)}`;
  try {
    const client = getRedisClient();
    const count = await client.incr(failKey);
    if (count === 1) await client.expire(failKey, OTP_FAIL_WINDOW_SEC);
    if (count >= OTP_FAIL_MAX) {
      await client.set(lockKey, "1", "EX", OTP_LOCKOUT_SEC);
      await client.del(failKey);
      logger.warn("RateLimit", `OTP lockout activated`, { masked: maskIdentifier(identifier), failures: count, namespace: namespace || "platform" });
      void logAuditEvent({
        action: "otp_abuse_lockout",
        details: { masked: maskIdentifier(identifier), failures: count, lockoutSeconds: OTP_LOCKOUT_SEC, namespace: namespace || "platform" },
        severity: "critical",
      });
    }
  } catch {
    // Redis unavailable
  }
}

export async function clearOtpVerifyFailures(identifier: string, namespace = ""): Promise<void> {
  const failPrefix = namespace ? `${namespace}-otp-fail` : "otp-fail";
  try {
    const client = getRedisClient();
    await client.del(`${failPrefix}:${hashIdentifier(identifier)}`);
  } catch {
    // Redis unavailable
  }
}

// --- Business OTP (Phase 6) -- layered on the SAME rateLimit() factory,
// not a second limiter implementation. Per-business and per-IP are the two
// layers this module adds; per-destination/per-customer abuse is covered
// by isOtpVerifyLockedOut/recordOtpVerifyFailure above with the "biz"
// namespace, and per-challenge attempts live in the DB row itself
// (server/modules/otp/service.ts) -- see doc 31 section 13 for the full
// layered picture.

export const businessOtpChallengeLimiter = rateLimit({
  windowMs: 60_000,
  max: 5,
  keyFn: (req) => `biz-otp-challenge:${(req as Request & { user?: { id?: number } }).user?.id ?? req.ip ?? "unknown"}`,
  message: "Too many OTP challenge requests. Please wait before retrying.",
});

export const businessOtpBusinessDailyLimiter = rateLimit({
  windowMs: 24 * 60 * 60_000,
  max: 500, // documented, adjustable placeholder -- not a per-business-configurable policy in this phase, see doc 31 section 13
  keyFn: (req) => `biz-otp-daily:${req.params?.businessId ?? "unknown"}`,
  message: "This business has reached its daily OTP limit.",
});

export const businessOtpVerifyLimiter = rateLimit({
  windowMs: 15 * 60_000,
  max: 20,
  keyFn: (req) => `biz-otp-verify:${(req as Request & { user?: { id?: number } }).user?.id ?? req.ip ?? "unknown"}`,
  message: "Too many verification attempts. Please wait before retrying.",
});

// --- Chat message sending / translation-triggering (P0 fix) --------------
// Personal and group chat message-send routes had NO rate limit at all
// despite each send synchronously calling a paid translation provider
// (Sarvam/Azure/OpenAI/ElevenLabs) -- an authenticated user hitting either
// route in a tight loop could cheaply generate unlimited translation-API
// spend and/or flood a recipient. There is no separate "translate" endpoint
// to limit independently -- translation happens inline inside the same
// send handler, so limiting the send route IS limiting translation
// triggering. Per-user (not per-IP), since both routes already require
// auth and a shared IP (NAT/office wifi) shouldn't penalize unrelated
// users. 30/min is generous for real rapid-fire chat use (WhatsApp-style
// back-and-forth) while capping scripted abuse; same shape as the other
// per-user limiters above, layered on the same rateLimit() factory, not a
// second implementation.
export const personalChatSendLimiter = rateLimit({
  windowMs: 60_000,
  max: 30,
  keyFn: (req) => `personal-chat-send:${(req as Request & { user?: { id?: number } }).user?.id ?? req.ip ?? "unknown"}`,
  message: "You're sending messages too quickly. Please slow down.",
});

export const groupChatSendLimiter = rateLimit({
  windowMs: 60_000,
  max: 30,
  keyFn: (req) => `group-chat-send:${(req as Request & { user?: { id?: number } }).user?.id ?? req.ip ?? "unknown"}`,
  message: "You're sending messages too quickly. Please slow down.",
});
