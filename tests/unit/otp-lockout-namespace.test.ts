import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Business OTP Redis lockout namespace tests (Phase 6).
 * See docs/neura-ecosystem/31_BUSINESS_OTP_AUTHENTICATION_IMPLEMENTATION.md
 * section 2 ("critical separation") and section 13.
 *
 * Proves the parameterized otpVerifyLockoutCheck/recordOtpVerifyFailure/
 * clearOtpVerifyFailures/isOtpVerifyLockedOut in server/rate-limit.ts
 * genuinely use DIFFERENT Redis key namespaces for the platform's own
 * login OTP (namespace "", unchanged) vs business OTP (namespace "biz") --
 * a failed business-customer OTP attempt must never be able to trigger a
 * lockout on that same person's PLATFORM login OTP, and vice versa.
 */

const store = new Map<string, { value: string; expiresAt: number | null }>();

function resetStore() { store.clear(); }

const fakeRedis = {
  async get(key: string) {
    const entry = store.get(key);
    if (!entry) return null;
    if (entry.expiresAt !== null && entry.expiresAt <= Date.now()) { store.delete(key); return null; }
    return entry.value;
  },
  async set(key: string, value: string, ..._args: any[]) {
    // supports the "EX seconds" form used by recordOtpVerifyFailure
    const exIdx = _args.indexOf("EX");
    const expiresAt = exIdx !== -1 ? Date.now() + Number(_args[exIdx + 1]) * 1000 : null;
    store.set(key, { value, expiresAt });
    return "OK";
  },
  async incr(key: string) {
    const entry = store.get(key);
    const next = entry ? String(Number(entry.value) + 1) : "1";
    store.set(key, { value: next, expiresAt: entry?.expiresAt ?? null });
    return Number(next);
  },
  async expire(key: string, seconds: number) {
    const entry = store.get(key);
    if (entry) entry.expiresAt = Date.now() + seconds * 1000;
    return 1;
  },
  async del(key: string) { store.delete(key); return 1; },
  async pttl(key: string) {
    const entry = store.get(key);
    if (!entry || entry.expiresAt === null) return -1;
    return Math.max(entry.expiresAt - Date.now(), 0);
  },
};

vi.mock("../../server/redis", () => ({ getRedisClient: () => fakeRedis }));
vi.mock("../../server/observability", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock("../../server/audit-logging", () => ({ logAuditEvent: vi.fn(async () => {}) }));

beforeEach(() => { resetStore(); vi.clearAllMocks(); });

describe("Business OTP lockout uses a separate Redis key namespace from platform login OTP", () => {
  it("recordOtpVerifyFailure with namespace 'biz' writes to a 'biz-otp-fail:' key, not 'otp-fail:'", async () => {
    const { recordOtpVerifyFailure } = await import("../../server/rate-limit");
    await recordOtpVerifyFailure("+919876543210", "biz");
    const keys = Array.from(store.keys());
    expect(keys.some((k) => k.startsWith("biz-otp-fail:"))).toBe(true);
    expect(keys.some((k) => k.startsWith("otp-fail:") && !k.startsWith("biz-"))).toBe(false);
  });

  it("5 business-OTP failures lock out ONLY the business namespace -- the platform login-OTP namespace for the SAME identifier remains unaffected", async () => {
    const { recordOtpVerifyFailure, isOtpVerifyLockedOut } = await import("../../server/rate-limit");
    const identifier = "shared-identifier@example.com"; // same phone/email could plausibly be both a NEURA login identifier AND a business's customer contact
    for (let i = 0; i < 5; i++) await recordOtpVerifyFailure(identifier, "biz");

    const bizLockout = await isOtpVerifyLockedOut(identifier, "biz");
    expect(bizLockout.locked).toBe(true);

    const platformLockout = await isOtpVerifyLockedOut(identifier, ""); // default namespace = platform login OTP
    expect(platformLockout.locked).toBe(false);
  });

  it("5 platform login-OTP failures lock out ONLY the platform namespace -- business OTP for the same identifier remains unaffected", async () => {
    const { recordOtpVerifyFailure, isOtpVerifyLockedOut } = await import("../../server/rate-limit");
    const identifier = "shared-identifier@example.com";
    for (let i = 0; i < 5; i++) await recordOtpVerifyFailure(identifier); // no namespace = platform default, unchanged behavior

    const platformLockout = await isOtpVerifyLockedOut(identifier);
    expect(platformLockout.locked).toBe(true);

    const bizLockout = await isOtpVerifyLockedOut(identifier, "biz");
    expect(bizLockout.locked).toBe(false);
  });

  it("clearOtpVerifyFailures('biz') only clears the business failure counter, not the platform one", async () => {
    const { recordOtpVerifyFailure, clearOtpVerifyFailures } = await import("../../server/rate-limit");
    const identifier = "9876543210";
    await recordOtpVerifyFailure(identifier, "biz");
    await recordOtpVerifyFailure(identifier);
    await clearOtpVerifyFailures(identifier, "biz");

    const remainingKeys = Array.from(store.keys());
    expect(remainingKeys.some((k) => k.startsWith("biz-otp-fail:"))).toBe(false);
    expect(remainingKeys.some((k) => k.startsWith("otp-fail:") && !k.startsWith("biz-"))).toBe(true);
  });

  it("default namespace (platform) is unchanged from pre-Phase-6 behavior -- backward compatible", async () => {
    const { recordOtpVerifyFailure, isOtpVerifyLockedOut } = await import("../../server/rate-limit");
    for (let i = 0; i < 5; i++) await recordOtpVerifyFailure("legacy@example.com");
    const result = await isOtpVerifyLockedOut("legacy@example.com");
    expect(result.locked).toBe(true);
    expect(result.ttlSec).toBeGreaterThan(0);
  });
});
