import type { Request, Response, NextFunction } from "express";

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

export function rateLimit(opts: Options) {
  const { windowMs, max, message = "Too many requests, please slow down" } = opts;
  const buckets = new Map<string, Bucket>();
  const keyFn = opts.keyFn ?? ((req) => req.ip ?? "unknown");

  setInterval(() => {
    const now = Date.now();
    buckets.forEach((v, k) => { if (v.resetAt <= now) buckets.delete(k); });
  }, Math.max(windowMs, 30_000)).unref?.();

  return (req: Request, res: Response, next: NextFunction) => {
    const now = Date.now();
    const key = keyFn(req);
    let b = buckets.get(key);
    if (!b || b.resetAt <= now) {
      b = { count: 0, resetAt: now + windowMs };
      buckets.set(key, b);
    }
    b.count++;
    if (b.count > max) {
      const retryAfterSec = Math.ceil((b.resetAt - now) / 1000);
      res.setHeader("Retry-After", String(retryAfterSec));
      res.setHeader("X-RateLimit-Limit", String(max));
      res.setHeader("X-RateLimit-Remaining", "0");
      return res.status(429).json({ success: false, message });
    }
    res.setHeader("X-RateLimit-Limit", String(max));
    res.setHeader("X-RateLimit-Remaining", String(max - b.count));
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
    return `otp-daily:${id || req.ip || "unknown"}`;
  },
  message: "Daily OTP limit reached. Try again tomorrow.",
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
