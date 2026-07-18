import { describe, it, expect, beforeAll, vi } from "vitest";

beforeAll(() => {
  process.env.SESSION_SECRET = "test-only-session-secret-not-a-real-secret-32chars";
});

// voice-training.ts imports server/db.ts at module scope, which triggers a
// startup guard (server/load-env.ts) that refuses to run if the process env
// doesn't match .env — a real production safety feature, not something to
// weaken. For this unit test we only need the pure encrypt/decrypt functions,
// so db.ts (and the whole DB connection it would open) is mocked out entirely.
vi.mock("../../server/db", () => ({ db: {} }));
vi.mock("../../server/ai_integrations/object_storage", () => ({ ObjectStorageService: class {} }));
vi.mock("../../server/role-middleware", () => ({ loadUser: vi.fn(), requireAuth: vi.fn(), requireSuperAdmin: vi.fn() }));
vi.mock("../../server/audit", () => ({ AuditHelpers: { logUpdate: vi.fn() } }));

describe("voice-training encryption (AES-256-GCM)", () => {
  it("round-trips a realistic object path", async () => {
    const { encrypt, decrypt } = await import("../../server/voice-training");
    const original = "private/uploads/3f9a2b1c-4e5d-6f7a-8b9c-0d1e2f3a4b5c";
    const encrypted = encrypt(original);
    expect(decrypt(encrypted)).toBe(original);
  });

  it("produces ciphertext that does not contain the plaintext", async () => {
    const { encrypt } = await import("../../server/voice-training");
    const original = "private/uploads/some-object-id";
    const encrypted = encrypt(original);
    expect(encrypted).not.toContain(original);
  });

  it("produces different ciphertext for the same input on repeated calls (random IV)", async () => {
    const { encrypt } = await import("../../server/voice-training");
    const a = encrypt("same-input");
    const b = encrypt("same-input");
    expect(a).not.toBe(b);
  });

  it("is in iv:authTag:ciphertext hex format", async () => {
    const { encrypt } = await import("../../server/voice-training");
    const encrypted = encrypt("private/uploads/abc");
    const parts = encrypted.split(":");
    expect(parts).toHaveLength(3);
    expect(parts[0]).toMatch(/^[0-9a-f]{32}$/); // 16-byte IV as hex
    expect(parts[1]).toMatch(/^[0-9a-f]{32}$/); // 16-byte GCM auth tag as hex
  });

  it("fails closed (throws) if SESSION_SECRET is not configured", async () => {
    const original = process.env.SESSION_SECRET;
    delete process.env.SESSION_SECRET;
    // Re-import fresh to bypass any module cache of the secret (getEncryptionKey reads
    // process.env at call time, not import time, so no reset actually needed — this
    // documents that expectation explicitly).
    const { encrypt } = await import("../../server/voice-training");
    expect(() => encrypt("x")).toThrow(/SESSION_SECRET/);
    process.env.SESSION_SECRET = original;
  });

  it("rejects tampered ciphertext (GCM authentication)", async () => {
    const { encrypt, decrypt } = await import("../../server/voice-training");
    const encrypted = encrypt("private/uploads/authentic-path");
    const [iv, authTag, ciphertext] = encrypted.split(":");
    const tamperedCiphertext = ciphertext.slice(0, -2) + (ciphertext.slice(-2) === "00" ? "11" : "00");
    const tampered = `${iv}:${authTag}:${tamperedCiphertext}`;
    expect(() => decrypt(tampered)).toThrow();
  });
});
